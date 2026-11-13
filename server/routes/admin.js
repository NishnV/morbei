import { Router } from 'express';
import { get, all, run } from '../db/pg.js';
import { requireDashboardToken } from '../middleware/adminToken.js';
import { refundPayment } from '../services/razorpay.js';
import { createDraftOrder, completeDraftOrder, getOrder, gidToNumeric, findSiblingVariant, fulfillOrder,
    refundOrderLine,
    listOrdersTracking, markFulfillmentDelivered, lineDetailsForVariant,
    setOrderEmail } from '../services/shopify-admin.js';
import { primeTracking, invalidateTracking } from '../services/order-tracking.js';
import { recipientFor } from '../services/recipient.js';
import { domainAcceptsMail } from '../services/email-domain.js';
import { notifySlackError, notifySlackNotice } from '../services/slack.js';
import { sendReturnUpdate, sendDeliveryNotice, sendShipmentNotice } from '../services/email.js';
import { funnelSummary } from './events.js';

// Shape only. domainAcceptsMail does the part that matters.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = Router();
router.use(requireDashboardToken);

// GET /api/dashboard/funnel
router.get('/funnel', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 90);
        res.json(await funnelSummary(days));
    } catch (err) {
        console.error('Funnel summary failed:', err.message);
        res.status(500).json({ error: 'Could not build the funnel' });
    }
});

/**
 * GET /api/dashboard/orders — recent orders with their live fulfillment state.
 *
 * One Shopify call covers every row: the state of all of them is wanted at
 * once, and asking per order would spend 25 requests against a bucket that
 * refills at two a second.
 */
router.get('/orders', async (req, res) => {
    try {
        const rows = await all(
            // The recipient is COALESCE'd and joined rather than read off the
            // shipping address, which is what this list used to show. Those
            // are two different fields: mail goes to the account (or to the
            // order's own corrected address), while the card was displaying
            // whatever was typed into the address form. Showing one and
            // sending to the other is how an operator confirms an address
            // that was never going to receive anything.
            `SELECT o.id, o.shopify_order_id, o.shopify_order_number, o.status, o.total_amount,
                    o.items, o.shipping_address, o.shipping_method, o.delivered_at, o.created_at,
                    o.is_test, o.shipped_email_at, o.shopify_order_missing_at,
                    o.razorpay_payment_id, o.replacement_for_order_id,
                    COALESCE(o.email, u.email) AS recipient,
                    (o.email IS NOT NULL) AS email_corrected
               FROM orders o
               LEFT JOIN users u ON u.id = o.user_id
              -- 'pending' normally means an abandoned checkout, which is noise.
              -- But a pending order WITH a captured payment is the worst state
              -- in the system: the customer paid, fulfilment failed, and it was
              -- hidden from their order history and from this screen alike
              -- while the reconciler retried for three days and then gave up in
              -- silence. Those belong at the top of this list, not nowhere.
              WHERE o.status <> 'pending' OR o.razorpay_payment_id IS NOT NULL
              ORDER BY (o.status = 'pending' AND o.razorpay_payment_id IS NOT NULL) DESC,
                       o.created_at DESC
              LIMIT 25`
        );

        // A Shopify outage should leave the list usable with local state only,
        // not blank the page the operator works from.
        let tracking = new Map();
        try {
            tracking = await listOrdersTracking(50);
            primeTracking(tracking);
        } catch (err) {
            console.error('admin orders tracking failed:', err.message);
        }

        // One lookup per distinct domain, and the helper caches by domain for
        // an hour on top of that, so a page of orders from gmail.com costs a
        // single DNS query. An inconclusive answer counts as deliverable:
        // this is a warning on a card, and crying wolf over a resolver blip
        // would train the operator to ignore it.
        const deliverable = new Map();
        await Promise.all(
            [...new Set(rows.map((o) => o.recipient).filter(Boolean))]
                .map(async (addr) => deliverable.set(addr, await domainAcceptsMail(addr)))
        );

        res.json({
            orders: rows.map((o) => {
                let addr = {};
                try { addr = JSON.parse(o.shipping_address || '{}'); } catch { /* best effort */ }
                let items = [];
                try { items = JSON.parse(o.items || '[]'); } catch { /* best effort */ }
                const t = (o.shopify_order_id && tracking.get(String(o.shopify_order_id))) || {};

                return {
                    id: o.id,
                    // Postgres hands back BIGINT as a string; the customer
                    // routes already number it, so match them.
                    orderNumber: o.shopify_order_number ? Number(o.shopify_order_number) : null,
                    status: o.status,
                    totalPaise: Number(o.total_amount),
                    customer: [addr.firstName, addr.lastName].filter(Boolean).join(' ') || null,
                    // Where mail for this order actually goes.
                    email: o.recipient || null,
                    emailCorrected: Boolean(o.email_corrected),
                    // False only when the domain definitively cannot receive
                    // mail. It says nothing about the mailbox.
                    emailDeliverable: o.recipient ? deliverable.get(o.recipient) !== false : false,
                    // What was typed into the address form, shown only when it
                    // disagrees — a second address worth noticing.
                    addressEmail: addr.email && addr.email !== o.recipient ? addr.email : null,
                    phone: addr.phone || null,
                    // The whole line, not just a title. Marking an order
                    // delivered is a claim about a specific parcel, and the
                    // person making it should be looking at what was in it.
                    items: items.map((i) => ({
                        title: i.title,
                        quantity: i.quantity,
                        image: i.image || null,
                        options: (i.selectedOptions || [])
                            .map((o2) => o2.value)
                            .filter((v) => v && v.toLowerCase() !== 'default title')
                            .join(' / '),
                    })),
                    address: [addr.address, addr.city, addr.state, addr.zip, addr.country]
                        .filter(Boolean).join(', ') || null,
                    shippingMethod: o.shipping_method || null,
                    isTest: Boolean(o.is_test),
                    // Paid, but no Shopify order was ever created for it.
                    needsAttention: o.status === 'pending' && Boolean(o.razorpay_payment_id),
                    isReplacement: Boolean(o.replacement_for_order_id),
                    shippedEmailAt: o.shipped_email_at,
                    shopifyOrderMissing: Boolean(o.shopify_order_missing_at),
                    deliveredAt: o.delivered_at,
                    createdAt: o.created_at,
                    hasShopifyOrder: Boolean(o.shopify_order_id),
                    fulfillmentStatus: t.fulfillmentStatus || null,
                    shipmentStatus: t.shipmentStatus || null,
                    trackingNumber: t.trackingNumber || null,
                };
            }),
        });
    } catch (err) {
        console.error('admin orders list failed:', err.message);
        res.status(500).json({ error: 'Could not load orders' });
    }
});

/**
 * POST /api/dashboard/orders/:id/test — exclude an order from the figures.
 *
 * Deliberately a separate judgement from shopify_order_missing_at, which the
 * system discovers for itself. An order deleted in Shopify is not necessarily
 * a test — someone can delete a real one by accident — and quietly dropping
 * real money out of the books would be worse than leaving a stale row in
 * them. So the fact is recorded automatically and the verdict is pressed by
 * hand, here.
 *
 * Reversible on purpose: marking the wrong order should cost one more click,
 * not a database session.
 */
/**
 * POST /api/dashboard/orders/:id/email — correct where this order's mail goes.
 *
 * A customer mistyped her address at checkout. The order was paid, every
 * message for it went nowhere, and nobody found out until she wrote in on
 * Instagram. The domain check added since would have caught that one, but it
 * only catches a domain that cannot receive mail at all — a valid domain with
 * a wrong mailbox, which is the commoner mistake, still sails through. So
 * there has to be a way to fix an address after the fact.
 *
 * It writes the order's own address rather than the account's. The account's
 * address is her login identity: changing it could collide with a real
 * account holding the correct address, would rewrite every other order she
 * has placed, and would be undone the next time she signed in through
 * Shopify, which upserts by email.
 *
 * Shopify is told too, in the same breath, so its own mail and the invoice
 * follow. That call is allowed to fail without failing the correction: our
 * notices are the ones that matter and a stored address can be retried,
 * whereas refusing the whole edit would leave the operator with no way
 * forward at all.
 */
router.post('/orders/:id/email', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad request' });

        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'That does not look like an email address.' });
        }
        // The check that would have caught the original typo. Deliberately
        // blocking here rather than warning: an operator typing a corrected
        // address has the customer in front of them and can ask again, which
        // is the one moment this is cheap to get right.
        if (!(await domainAcceptsMail(email))) {
            return res.status(400).json({
                error: `No mail server exists for ${email.split('@')[1]} — check the spelling with the customer.`,
            });
        }

        const order = await get('SELECT * FROM orders WHERE id = $1', [id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });

        const previous = order.email
            || (await get('SELECT email FROM users WHERE id = $1', [order.user_id]))?.email
            || null;
        if (previous === email) {
            return res.json({ id, email, changed: false, shopifyUpdated: null });
        }

        await run('UPDATE orders SET email = $1 WHERE id = $2', [email, id]);

        let shopifyUpdated = null;
        if (order.shopify_order_id) {
            try {
                await setOrderEmail(order.shopify_order_id, email);
                shopifyUpdated = true;
            } catch (err) {
                shopifyUpdated = false;
                console.error(`Could not set Shopify email for order ${id}:`, err.message);
            }
        }

        // Changing where a customer's mail goes is worth a trail. If it was
        // ever done wrongly, or maliciously, this is the only record of it.
        notifySlackNotice(
            `Order #${order.shopify_order_number || id}: notification email changed from `
            + `${previous || '(none)'} to ${email}`
            + (shopifyUpdated === false
                ? ' — :warning: Shopify was NOT updated, its own mail still goes to the old address'
                : '')
        ).catch(() => {});

        return res.json({ id, email, previous, changed: true, shopifyUpdated });
    } catch (err) {
        console.error('order email update failed:', err.message);
        return res.status(500).json({ error: 'Could not update the email' });
    }
});

router.post('/orders/:id/test', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });
    const isTest = req.body?.isTest !== false;

    try {
        const updated = await run('UPDATE orders SET is_test = $1 WHERE id = $2', [isTest, id]);
        if (!updated.rowCount) return res.status(404).json({ error: 'Not found' });
        res.json({ id, isTest });
    } catch (err) {
        console.error('mark test failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

/**
 * POST /api/dashboard/orders/:id/fulfil — ship it, from here.
 *
 * Fulfilling meant leaving this screen for Shopify and then waiting up to an
 * hour for the sweep to notice and tell the customer. This does both in one
 * action, and the tracking number typed here is the one that reaches them.
 *
 * Shopify's own notification is suppressed; the shipping notice below is the
 * only one the customer gets. shipped_email_at is stamped either way so the
 * hourly sweep does not send a second.
 */
router.post('/orders/:id/fulfil', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

    const carrier = typeof req.body?.carrier === 'string' ? req.body.carrier.trim().slice(0, 80) : '';
    const trackingNumber = typeof req.body?.trackingNumber === 'string'
        ? req.body.trackingNumber.trim().slice(0, 80) : '';

    try {
        const order = await get('SELECT * FROM orders WHERE id = $1', [id]);
        if (!order) return res.status(404).json({ error: 'Not found' });
        if (order.status === 'cancelled') return res.status(409).json({ error: 'This order was cancelled.' });
        if (!order.shopify_order_id) {
            return res.status(400).json({ error: 'No Shopify order on this one — fulfilment never completed.' });
        }

        let fulfillment;
        try {
            fulfillment = await fulfillOrder(order.shopify_order_id, { carrier, trackingNumber });
        } catch (err) {
            if (err.message === 'NOTHING_TO_FULFILL') {
                return res.status(409).json({ error: 'Nothing left to fulfil — it may already be shipped.' });
            }
            if (err.status === 404) {
                await run(`UPDATE orders SET shopify_order_missing_at = now()
                            WHERE id = $1 AND shopify_order_missing_at IS NULL`, [id]).catch(() => {});
                return res.status(409).json({ error: 'This order no longer exists in Shopify.' });
            }
            console.error(`Fulfil failed for order ${id}:`, err.message);
            notifySlackError(`fulfil failed (order #${order.shopify_order_number || id})`, err).catch(() => {});
            return res.status(502).json({ error: 'Shopify refused the fulfilment. Nothing was changed.' });
        }

        invalidateTracking(order.shopify_order_id);

        // Claim the email before sending, exactly as the sweep does, so a
        // failure here cannot result in the customer being told twice.
        const claimed = await run(
            `UPDATE orders SET shipped_email_at = now() WHERE id = $1 AND shipped_email_at IS NULL`,
            [id]
        );
        if (claimed.rowCount > 0) {
            get('SELECT * FROM users WHERE id = $1', [order.user_id])
                .then((account) => {
                    // The order's own address if it has one — a mistyped
                    // address corrected here must not be undone by the send.
                    const user = recipientFor(account, order);
                    let cartLines = [];
                    try { cartLines = JSON.parse(order.items); } catch { /* the notice stands without a list */ }
                    return sendShipmentNotice({
                        order,
                        user,
                        cartLines,
                        tracking: {
                            trackingCompany: carrier || fulfillment?.tracking_company || null,
                            trackingNumber: trackingNumber || fulfillment?.tracking_number || null,
                            trackingUrl: fulfillment?.tracking_url || null,
                        },
                    });
                })
                .catch((err) => {
                    console.error(`Shipping email failed for order ${id}:`, err.message);
                    notifySlackError(
                        `Shipping email failed for order #${order.shopify_order_number || id} — tell them by hand`,
                        err
                    ).catch(() => {});
                });
        }

        res.json({
            id,
            fulfilled: true,
            trackingNumber: trackingNumber || fulfillment?.tracking_number || null,
            emailSent: claimed.rowCount > 0,
        });
    } catch (err) {
        console.error('fulfil failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

/**
 * POST /api/dashboard/orders/:id/delivered — record that a parcel landed.
 *
 * Shopify has no delivered status of its own and no button for one: delivery
 * comes from posted fulfillment events, which only carrier-integrated labels
 * create. This store fulfils by hand, so this is the only thing that will
 * ever start a returns window.
 */
router.post('/orders/:id/delivered', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

    try {
        const order = await get(
            `SELECT id, user_id, items, is_test, shopify_order_id, shopify_order_number, status, delivered_at
               FROM orders WHERE id = $1`,
            [id]
        );
        if (!order) return res.status(404).json({ error: 'Not found' });
        if (order.status === 'cancelled') return res.status(409).json({ error: 'This order was cancelled.' });
        if (order.delivered_at) return res.status(409).json({ error: 'Already marked delivered.' });
        if (!order.shopify_order_id) {
            return res.status(400).json({ error: 'No Shopify order on this one — fulfilment never completed.' });
        }

        // Shopify first, local column second. If the event is refused the
        // column stays null, so the two can never disagree about whether the
        // parcel landed — and the returns window is measured from the column.
        try {
            await markFulfillmentDelivered(order.shopify_order_id);
        } catch (err) {
            if (err.message === 'NO_FULFILLMENT') {
                return res.status(409).json({
                    error: 'Fulfil this order in Shopify first — there is no shipment to mark delivered.',
                });
            }
            // Deliberately no Slack alert: a row pointing at an order that was
            // deleted in Shopify is stale data, and paging someone about it
            // every time the button is pressed teaches them to ignore alerts.
            if (err.message === 'ORDER_GONE') {
                // Shopify answered 404 for an id we hold: definitive, and it
                // will not change. Write it down so the dashboard stops
                // offering a button that can never work, instead of making
                // someone rediscover it on every click.
                await run(
                    `UPDATE orders SET shopify_order_missing_at = now()
                      WHERE id = $1 AND shopify_order_missing_at IS NULL`,
                    [id]
                ).catch((e) => console.error(`Could not flag order ${id} as missing:`, e.message));
                return res.status(409).json({
                    error: 'This order no longer exists in Shopify — it was deleted there. Nothing to mark.',
                });
            }
            console.error(`mark delivered failed for order ${id}:`, err.message);
            notifySlackError(`mark delivered failed (order #${order.shopify_order_number})`, err).catch(() => {});
            return res.status(502).json({ error: 'Shopify refused the delivery event. Nothing was changed.' });
        }

        const marked = await run(
            'UPDATE orders SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL',
            [id]
        );
        invalidateTracking(order.shopify_order_id);

        // After the column, not before: the email tells the customer their
        // return window has opened, and the window is counted from that
        // column. Only on the update that actually set it, so pressing the
        // button twice cannot send it twice. Not awaited — a mail failure
        // must not make a recorded delivery look like it failed.
        if (marked.rowCount > 0) {
            get('SELECT * FROM users WHERE id = $1', [order.user_id])
                .then((account) => {
                    // The order's own address if it has one — a mistyped
                    // address corrected here must not be undone by the send.
                    const user = recipientFor(account, order);
                    let cartLines = [];
                    try { cartLines = JSON.parse(order.items); } catch { /* the notice stands without a list */ }
                    return sendDeliveryNotice({ order, user, cartLines });
                })
                .catch((err) => {
                    console.error(`Delivery notice failed for order ${id}:`, err.message);
                    notifySlackError(
                        `Delivery email failed for order #${order.shopify_order_number || id}`,
                        err
                    ).catch(() => {});
                });
        }

        res.json({ id, deliveredAt: new Date().toISOString() });
    } catch (err) {
        console.error('mark delivered failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// How long a refund or exchange claim may sit before another attempt may take
// it. Long enough that a slow Razorpay or Shopify call is never cut off,
// short enough that a crash does not block the return for a working day.
const STALE_CLAIM_MINUTES = 10;

const STATUSES = ['requested', 'approved', 'in_transit', 'received', 'rejected', 'inspection_failed',
    'refunded', 'exchanged'];

/** What this one item is worth, in paise, from the order's stored lines. */
/** The line's face value, uncapped — shown beside the refundable amount. */
function lineValuePaise(itemsJson, variantId) {
    try {
        const line = JSON.parse(itemsJson || '[]').find((i) => i.variantId === variantId);
        if (!line || !Number.isFinite(Number(line.price))) return null;
        return Math.round(Number(line.price) * (line.quantity || 1) * 100);
    } catch { return null; }
}

/**
 * What this line is worth, bounded by what is actually left on the payment.
 *
 * This used to return null whenever the line was worth more than the whole
 * capture, which reads as "no refund possible" and disabled the button with
 * no explanation. On a one-rupee test order that is every line — the stored
 * price is the real one, the capture is ₹1 — so a test order could be taken
 * all the way to the shelf and then never refunded.
 *
 * Refusing was the wrong shape for the rule. The rule is never to send back
 * more than came in, which is a cap, not a veto.
 */
function itemAmountPaise(order, variantId, alreadyRefundedPaise = 0) {
    let items = [];
    try { items = JSON.parse(order.items || '[]'); } catch { return null; }
    const line = items.find((i) => i.variantId === variantId);
    if (!line || !Number.isFinite(Number(line.price))) return null;

    const lineValue = Math.round(Number(line.price) * (line.quantity || 1) * 100);
    if (lineValue <= 0) return null;

    const remaining = Number(order.total_amount) - Number(alreadyRefundedPaise || 0);
    if (remaining <= 0) return null;

    return Math.min(lineValue, remaining);
}

// GET /api/dashboard/returns?status=requested
router.get('/returns', async (req, res) => {
    try {
        const status = STATUSES.includes(req.query.status) ? req.query.status : null;
        const rows = await all(
            `SELECT r.*, o.total_amount, o.items AS order_items, o.razorpay_payment_id, o.delivered_at,
                    COALESCE((SELECT SUM(r2.refund_amount_paise) FROM returns r2
                               WHERE r2.order_id = r.order_id AND r2.status = 'refunded'), 0)
                      AS order_refunded_paise
               FROM returns r
               LEFT JOIN orders o ON o.id = r.order_id
              ${status ? 'WHERE r.status = $1' : ''}
              ORDER BY r.created_at DESC
              LIMIT 100`,
            status ? [status] : []
        );
        res.json({
            returns: rows.map((r) => ({
                id: r.id,
                orderNumber: r.shopify_order_number,
                email: r.email,
                fullName: r.full_name,
                phone: r.phone,
                product: r.product_title,
                reasons: JSON.parse(r.reasons || '[]'),
                details: r.details,
                resolution: r.resolution,
                exchangeSize: r.exchange_size,
                replacementOrderNumber: r.replacement_order_number,
                comments: r.comments,
                media: JSON.parse(r.media || '[]'),
                status: r.status,
                adminNote: r.admin_note,
                createdAt: r.created_at,
                deliveredAt: r.delivered_at,
                // The journey back, so the queue shows what is being waited on
                // rather than a row that looks the same from approval to refund.
                returnCarrier: r.return_carrier,
                returnAwb: r.return_awb,
                receivedAt: r.received_at,
                // Shown next to the button, so the amount is known before the
                // refund is pressed rather than discovered afterwards.
                refundablePaise: r.order_id ? itemAmountPaise(
                    { items: r.order_items, total_amount: r.total_amount },
                    r.variant_id,
                    Number(r.order_refunded_paise || 0)
                ) : null,
                // So a ₹1 refund against a ₹2,550 line reads as a cap rather
                // than a mistake.
                lineValuePaise: r.order_id ? lineValuePaise(r.order_items, r.variant_id) : null,
                refundedPaise: r.refund_amount_paise ? Number(r.refund_amount_paise) : null,
                refundId: r.refund_id,
                // Null means Shopify was never told — the refund and the
                // Shopify record are separate calls and the second can fail
                // alone, so the retry button keys off this.
                restockedAt: r.restocked_at,
                refundable: Boolean(r.razorpay_payment_id),
            })),
            counts: Object.fromEntries(
                (await all(`SELECT status, COUNT(*)::int AS n FROM returns GROUP BY status`))
                    .map((c) => [c.status, c.n])
            ),
        });
    } catch (err) {
        console.error('admin returns list failed:', err.message);
        res.status(500).json({ error: 'Could not load returns' });
    }
});

/**
 * POST /api/dashboard/returns/:id — approve, reject, or refund.
 *
 * Refund is deliberately a separate step from approve rather than a
 * consequence of it. Approving tells the customer to send the item back;
 * money should move once it has arrived, which is also what the policy
 * promises. Folding the two together would make a single click both a
 * decision and a payment.
 */
router.post('/returns/:id', async (req, res) => {
    const { action, note, selfShip, carrier, awb, restockOnRefund } = req.body || {};
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

    try {
        const row = await get('SELECT * FROM returns WHERE id = $1', [id]);
        if (!row) return res.status(404).json({ error: 'Not found' });

        if (action === 'approve' || action === 'reject') {
            const next = action === 'approve' ? 'approved' : 'rejected';
            const claimed = await run(
                `UPDATE returns SET status = $1, admin_note = $2, updated_at = now()
                  WHERE id = $3 AND status = 'requested'`,
                [next, typeof note === 'string' ? note.slice(0, 1000) : null, id]
            );
            if (!claimed.rowCount) {
                return res.status(409).json({ error: `Already ${row.status}` });
            }
            sendReturnUpdate(action === 'approve' ? 'approved' : 'rejected', {
                to: row.email,
                name: row.full_name,
                orderNumber: row.shopify_order_number,
                product: row.product_title,
                note: typeof note === 'string' ? note : '',
                // Decides which approval the customer reads: post it to us, or
                // wait for the pickup we are booking.
                selfShip: Boolean(selfShip),
            }).catch((err) => console.error(`return ${next} email failed:`, err.message));
            return res.json({ id, status: next });
        }

        // Record the journey back. Either we booked a pickup or the customer
        // posted it and sent the tracking; from here the return is visibly in
        // transit rather than sitting indistinguishable from every other
        // approved row.
        if (action === 'in_transit') {
            if (row.status !== 'approved') {
                return res.status(409).json({ error: 'Approve the return first.' });
            }
            const c = typeof carrier === 'string' ? carrier.trim().slice(0, 80) : '';
            const a = typeof awb === 'string' ? awb.trim().slice(0, 80) : '';
            if (!c && !a) {
                return res.status(400).json({ error: 'Give a carrier or a tracking number.' });
            }
            const claimed = await run(
                `UPDATE returns SET status = 'in_transit', return_carrier = $1, return_awb = $2, updated_at = now()
                  WHERE id = $3 AND status = 'approved'`,
                [c || null, a || null, id]
            );
            if (!claimed.rowCount) return res.status(409).json({ error: `Already ${row.status}` });

            sendReturnUpdate('in_transit', {
                to: row.email,
                name: row.full_name,
                orderNumber: row.shopify_order_number,
                product: row.product_title,
                returnCarrier: c,
                returnAwb: a,
            }).catch((err) => console.error('return in_transit email failed:', err.message));
            return res.json({ id, status: 'in_transit', returnCarrier: c, returnAwb: a });
        }

        // The parcel is on the shelf. This is the gate the refund and exchange
        // actions below check, so money cannot go back before the piece does.
        if (action === 'received') {
            if (row.status !== 'approved' && row.status !== 'in_transit') {
                return res.status(409).json({ error: 'Approve the return first.' });
            }
            const claimed = await run(
                `UPDATE returns SET status = 'received', received_at = now(), updated_at = now()
                  WHERE id = $1 AND status IN ('approved', 'in_transit')`,
                [id]
            );
            if (!claimed.rowCount) return res.status(409).json({ error: `Already ${row.status}` });

            sendReturnUpdate('arrived', {
                to: row.email,
                name: row.full_name,
                orderNumber: row.shopify_order_number,
                product: row.product_title,
            }).catch((err) => console.error('return arrived email failed:', err.message));
            return res.json({ id, status: 'received' });
        }

        // The piece came back and failed inspection — worn, no tags, or not
        // what was claimed. Previously this had nowhere to go: reject was
        // reachable only from 'requested', so the most likely real outcome of
        // a declaration-based policy left the return sitting at 'received'
        // forever with live refund and exchange buttons on it.
        if (action === 'inspection_failed') {
            if (row.status !== 'received') {
                return res.status(409).json({ error: 'Mark the item received first.' });
            }
            const inspectionNote = typeof note === 'string' ? note.trim().slice(0, 1000) : '';
            const claimed = await run(
                `UPDATE returns SET status = 'inspection_failed', inspection_note = $1,
                        return_awb = COALESCE($2, return_awb), updated_at = now()
                  WHERE id = $3 AND status = 'received'`,
                [inspectionNote || null, typeof awb === 'string' && awb.trim() ? awb.trim().slice(0, 80) : null, id]
            );
            if (!claimed.rowCount) return res.status(409).json({ error: `Already ${row.status}` });

            sendReturnUpdate('inspection_failed', {
                to: row.email,
                name: row.full_name,
                orderNumber: row.shopify_order_number,
                product: row.product_title,
                note: inspectionNote,
                returnAwb: typeof awb === 'string' ? awb.trim() : '',
            }).catch((err) => console.error('inspection_failed email failed:', err.message));
            return res.json({ id, status: 'inspection_failed' });
        }

        // Tell Shopify about a refund that already happened.
        //
        // The Razorpay refund and the Shopify record are two calls, and the
        // second is deliberately non-fatal: the customer's money must go back
        // even if Shopify is unreachable. That left the only recovery as
        // "do it by hand", which is how the first real refund ended up
        // half-recorded when the variant lookup failed. This retries it.
        if (action === 'sync_shopify') {
            if (row.status !== 'refunded') {
                return res.status(409).json({ error: 'Only a refunded return needs recording in Shopify.' });
            }
            const order = await get('SELECT * FROM orders WHERE id = $1', [row.order_id]);
            if (!order?.shopify_order_id) {
                return res.status(400).json({ error: 'No Shopify order on this one.' });
            }
            const restock = restockOnRefund !== false;
            try {
                await refundOrderLine(order.shopify_order_id, row.variant_id, {
                    restock,
                    note: `Return ${row.id} — refunded via Razorpay`,
                });
                if (restock) {
                    await run('UPDATE returns SET restocked_at = now() WHERE id = $1', [id]);
                }
                return res.json({ id, syncedToShopify: true, restocked: restock });
            } catch (err) {
                console.error(`Shopify sync retry failed for return ${id}:`, err.message);
                return res.status(502).json({
                    error: err.message === 'LINE_NOT_FOUND'
                        ? 'Could not find that item on the Shopify order. Record it there by hand.'
                        : 'Shopify refused it. Nothing was changed there.',
                });
            }
        }

        if (action === 'refund') {
            if (row.status !== 'received') {
                return res.status(409).json({ error: 'Mark the item received before refunding.' });
            }
            const order = await get('SELECT * FROM orders WHERE id = $1', [row.order_id]);
            if (!order?.razorpay_payment_id) {
                return res.status(400).json({ error: 'No captured payment found for this order.' });
            }
            const prior = await get(
                `SELECT COALESCE(SUM(refund_amount_paise), 0)::bigint AS paid
                   FROM returns WHERE order_id = $1 AND status = 'refunded'`,
                [row.order_id]
            );
            const amount = itemAmountPaise(order, row.variant_id, Number(prior?.paid || 0));
            if (!amount) {
                return res.status(400).json({
                    error: Number(prior?.paid || 0) >= Number(order.total_amount)
                        ? 'This order has already been refunded in full.'
                        : 'Could not work out the amount — refund this one in Razorpay.',
                });
            }

            // Claim before calling Razorpay, so a double click cannot refund
            // twice — but in a column of its own rather than by moving the
            // status to 'refunding'. That value was accepted by no transition
            // and swept by nothing, so a deploy or a timeout between here and
            // the update below stranded the return permanently. A stale claim
            // can now be released by age; the status stays honest throughout.
            const claimed = await run(
                `UPDATE returns SET refund_claimed_at = now(), updated_at = now()
                  WHERE id = $1 AND status = 'received'
                    AND (refund_claimed_at IS NULL
                         OR refund_claimed_at < now() - make_interval(mins => $2::int))`,
                [id, STALE_CLAIM_MINUTES]
            );
            if (!claimed.rowCount) return res.status(409).json({ error: 'Already being refunded' });

            try {
                const refund = await refundPayment(order.razorpay_payment_id, amount);
                // Razorpay's id is written in the same statement that records
                // the refund. It used to be returned to the browser and
                // dropped, leaving nothing to reconcile a dispute against.
                await run(
                    `UPDATE returns SET status = 'refunded', refund_id = $3, refund_amount_paise = $4,
                            admin_note = COALESCE($1, admin_note),
                            updated_at = now() WHERE id = $2`,
                    [typeof note === 'string' ? note.slice(0, 1000) : null, id, refund.id || null, amount]
                );
                // Shopify is the order of record and the inventory of record,
                // and until now neither heard about a return: the order stayed
                // fully paid there and the garment stayed sold, so a piece back
                // on the shelf still read out of stock on the storefront.
                // Non-fatal — the customer's money has already gone back, and
                // an inventory correction must never undo that.
                if (order.shopify_order_id) {
                    const restock = restockOnRefund !== false;
                    refundOrderLine(order.shopify_order_id, row.variant_id, {
                        restock,
                        note: `Return ${row.id} — refunded ₹${(amount / 100).toFixed(2)} via Razorpay`,
                    }).then(() => (
                        restock
                            ? run('UPDATE returns SET restocked_at = now() WHERE id = $1', [id])
                            : null
                    )).catch((err) => {
                        console.error(`Shopify refund/restock failed for return ${id}:`, err.message);
                        notifySlackError(
                            `Shopify was not told about return ${row.id} (order #${row.shopify_order_number}) — `
                            + 'record the refund and restock there by hand',
                            err
                        ).catch(() => {});
                    });
                }

                sendReturnUpdate('refunded', {
                    to: row.email,
                    name: row.full_name,
                    orderNumber: row.shopify_order_number,
                    product: row.product_title,
                    amount: (amount / 100).toFixed(2),
                }).catch((err) => console.error('refund email failed:', err.message));
                return res.json({ id, status: 'refunded', refundId: refund.id, amountPaise: amount });
            } catch (err) {
                // Release the claim; the status never moved, so there is
                // nothing to restore.
                await run(`UPDATE returns SET refund_claimed_at = NULL, updated_at = now() WHERE id = $1`, [id]);
                console.error(`Return refund failed for ${id}:`, err.message);
                notifySlackError(`return refund failed (return ${id}, order #${row.shopify_order_number})`, err).catch(() => {});
                return res.status(502).json({ error: 'Razorpay refused the refund. Nothing has been charged back.' });
            }
        }

        if (action === 'exchange') {
            if (row.status !== 'received') {
                return res.status(409).json({ error: 'Mark the item received before sending a replacement.' });
            }
            if (!row.resolution?.startsWith('exchange')) {
                return res.status(400).json({ error: 'This request asked for a refund, not an exchange.' });
            }

            const order = await get('SELECT * FROM orders WHERE id = $1', [row.order_id]);
            if (!order) return res.status(400).json({ error: 'Original order not found.' });

            // The admin may name a variant directly — that is how an exchange
            // for a different product is handled, since the customer describes
            // it in words and only a person can decide what they meant.
            const override = req.body?.variantId ? String(req.body.variantId) : null;
            let variantId = override ? gidToNumeric(override) || override : null;
            let label = override ? `variant ${variantId}` : null;
            let resolved = {};

            if (!variantId) {
                if (!row.exchange_size) {
                    return res.status(400).json({ error: 'No size was requested — supply a variant id.' });
                }
                // Resolving the size talks to Shopify, so it can fail for
                // reasons that have nothing to do with the request. Caught
                // here rather than left to the generic handler, which would
                // report "something went wrong" and leave the operator
                // guessing whether the size was wrong or Shopify was down.
                let found;
                try {
                    found = await findSiblingVariant(gidToNumeric(row.variant_id), row.exchange_size);
                } catch (err) {
                    console.error(`Variant lookup failed for return ${id}:`, err.message);
                    return res.status(502).json({ error: 'Could not reach Shopify to find that size. Nothing was sent.' });
                }
                if (found.error) return res.status(409).json({ error: found.error });
                variantId = found.variant.id;
                label = `${found.product.title} — ${row.exchange_size}`;
                // Already fetched; handed on so building the line item below
                // costs no further Shopify calls.
                resolved = { variant: found.variant, product: found.product };
            }

            // Claim first: raising two replacement orders is as bad as
            // refunding twice, and a slow Shopify call invites a second click.
            const claimed = await run(
                // Same reasoning as the refund claim above: a column, not a
                // status value nothing accepts.
                `UPDATE returns SET exchange_claimed_at = now(), updated_at = now()
                  WHERE id = $1 AND status = 'received'
                    AND (exchange_claimed_at IS NULL
                         OR exchange_claimed_at < now() - make_interval(mins => $2::int))`,
                [id, STALE_CLAIM_MINUTES]
            );
            if (!claimed.rowCount) return res.status(409).json({ error: 'Already in progress' });

            try {
                let shippingAddress = {};
                try { shippingAddress = JSON.parse(order.shipping_address || '{}'); } catch { /* best effort */ }

                const draft = await createDraftOrder({
                    lineItems: [{ variant_id: Number(variantId), quantity: 1 }],
                    shippingAddress,
                    note: `Exchange for order #${row.shopify_order_number} — return ${row.id}`,
                    // Already paid for on the original order.
                    appliedDiscount: {
                        description: `Exchange for #${row.shopify_order_number}`,
                        value_type: 'percentage',
                        value: '100.0',
                        title: 'Exchange',
                    },
                });
                const completed = await completeDraftOrder(draft.draft_order.id);
                const newOrderId = completed.draft_order.order_id;

                // Same reason as a normal order, and the same correction: the
                // draft is completed without an email so Shopify has nobody to
                // notify, and the customer is attached by the hourly sweep
                // rather than here. Doing it immediately raced Shopify's own
                // decision to send, and sometimes lost.

                let newNumber = null;
                try {
                    const fresh = await getOrder(newOrderId);
                    newNumber = fresh?.order?.order_number ?? null;
                } catch { /* the order exists either way */ }

                // Give the replacement a local row. Without one it existed
                // only in Shopify, so it could never be marked delivered (the
                // dashboard reads this table), never started a returns window,
                // could not be tracked by the customer, and could not itself
                // be returned if it arrived damaged.
                //
                // It carries the parent's payment id so the returns and lookup
                // queries, which require one, can find it — economically it is
                // the same payment — and total_amount 0 because nothing more
                // was charged. replacement_for_order_id keeps it out of being
                // mistaken for a second sale.

                // The picture and the full option set, from the variant that
                // is actually being sent. Without them the replacement row
                // drew an empty box wherever an order is shown and listed
                // only its size, which read as a different, lesser thing than
                // the order it replaces. Best-effort: null here just means
                // the line falls back to what it said before.
                const details = await lineDetailsForVariant(variantId, resolved);

                try {
                    await run(
                        `INSERT INTO orders (user_id, total_amount, status, shipping_method, shipping_address,
                                             items, shopify_order_id, shopify_order_number,
                                             razorpay_payment_id, replacement_for_order_id, is_test)
                         SELECT user_id, 0, 'paid', shipping_method, shipping_address,
                                $1, $2, $3, razorpay_payment_id, id, is_test
                           FROM orders WHERE id = $4`,
                        [
                            JSON.stringify([{
                                title: details?.title || row.product_title,
                                quantity: 1,
                                price: 0,
                                variantId: String(variantId),
                                image: details?.image || null,
                                selectedOptions: details?.selectedOptions?.length
                                    ? details.selectedOptions
                                    : (row.exchange_size ? [{ name: 'Size', value: row.exchange_size }] : []),
                            }]),
                            String(newOrderId),
                            newNumber,
                            row.order_id,
                        ]
                    );
                } catch (rowErr) {
                    console.error(`Could not record replacement order for return ${id}:`, rowErr.message);
                    notifySlackError(
                        `Replacement #${newNumber || newOrderId} has no local order row — it cannot be `
                        + 'marked delivered or tracked until one is added',
                        rowErr
                    ).catch(() => {});
                }

                await run(
                    `UPDATE returns SET status = 'exchanged', replacement_order_number = $1,
                            admin_note = COALESCE($2, admin_note), updated_at = now()
                      WHERE id = $3`,
                    [newNumber, typeof note === 'string' ? note.slice(0, 1000) : null, id]
                );
                sendReturnUpdate('exchanged', {
                    to: row.email,
                    name: row.full_name,
                    orderNumber: row.shopify_order_number,
                    product: row.product_title,
                    size: row.exchange_size,
                    replacementOrderNumber: newNumber,
                }).catch((err) => console.error('exchange email failed:', err.message));
                return res.json({ id, status: 'exchanged', replacementOrderNumber: newNumber, sent: label });
            } catch (err) {
                await run(`UPDATE returns SET exchange_claimed_at = NULL, updated_at = now() WHERE id = $1`, [id]);
                console.error(`Exchange order failed for return ${id}:`, err.message);
                notifySlackError(`exchange replacement failed (return ${id}, order #${row.shopify_order_number})`, err).catch(() => {});
                return res.status(502).json({ error: 'Shopify refused the replacement order. Nothing was sent.' });
            }
        }

        res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('admin return action failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
