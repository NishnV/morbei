import { Router } from 'express';
import { get, all, run } from '../db/pg.js';
import { requireDashboardToken } from '../middleware/adminToken.js';
import { refundPayment } from '../services/razorpay.js';
import { createDraftOrder, completeDraftOrder, setOrderEmail, getOrder, gidToNumeric, findSiblingVariant,
    listOrdersTracking, markFulfillmentDelivered } from '../services/shopify-admin.js';
import { primeTracking, invalidateTracking } from '../services/order-tracking.js';
import { notifySlackError } from '../services/slack.js';
import { sendReturnUpdate } from '../services/email.js';
import { funnelSummary } from './events.js';

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
            `SELECT id, shopify_order_id, shopify_order_number, status, total_amount,
                    items, shipping_address, delivered_at, created_at
               FROM orders
              WHERE status <> 'pending'
              ORDER BY created_at DESC
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
                    items: items.map((i) => i.title).filter(Boolean),
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
            `SELECT id, shopify_order_id, shopify_order_number, status, delivered_at
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
                return res.status(409).json({
                    error: 'This order no longer exists in Shopify — it was deleted there. Nothing to mark.',
                });
            }
            console.error(`mark delivered failed for order ${id}:`, err.message);
            notifySlackError(`mark delivered failed (order #${order.shopify_order_number})`, err).catch(() => {});
            return res.status(502).json({ error: 'Shopify refused the delivery event. Nothing was changed.' });
        }

        await run('UPDATE orders SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL', [id]);
        invalidateTracking(order.shopify_order_id);
        res.json({ id, deliveredAt: new Date().toISOString() });
    } catch (err) {
        console.error('mark delivered failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

const STATUSES = ['requested', 'approved', 'rejected', 'refunded', 'exchanged'];

/** What this one item is worth, in paise, from the order's stored lines. */
function itemAmountPaise(order, variantId) {
    let items = [];
    try { items = JSON.parse(order.items || '[]'); } catch { return null; }
    const line = items.find((i) => i.variantId === variantId);
    if (!line || !Number.isFinite(Number(line.price))) return null;
    const paise = Math.round(Number(line.price) * (line.quantity || 1) * 100);
    // Never refund more than was taken, whatever the stored line says.
    return paise > 0 && paise <= Number(order.total_amount) ? paise : null;
}

// GET /api/dashboard/returns?status=requested
router.get('/returns', async (req, res) => {
    try {
        const status = STATUSES.includes(req.query.status) ? req.query.status : null;
        const rows = await all(
            `SELECT r.*, o.total_amount, o.items AS order_items, o.razorpay_payment_id, o.delivered_at
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
                // Shown next to the button, so the amount is known before the
                // refund is pressed rather than discovered afterwards.
                refundablePaise: r.order_id ? itemAmountPaise(
                    { items: r.order_items, total_amount: r.total_amount }, r.variant_id
                ) : null,
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
    const { action, note } = req.body || {};
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
            }).catch((err) => console.error(`return ${next} email failed:`, err.message));
            return res.json({ id, status: next });
        }

        if (action === 'refund') {
            if (row.status !== 'approved') {
                return res.status(409).json({ error: 'Approve the return before refunding.' });
            }
            const order = await get('SELECT * FROM orders WHERE id = $1', [row.order_id]);
            if (!order?.razorpay_payment_id) {
                return res.status(400).json({ error: 'No captured payment found for this order.' });
            }
            const amount = itemAmountPaise(order, row.variant_id);
            if (!amount) {
                return res.status(400).json({ error: 'Could not work out the amount — refund this one in Razorpay.' });
            }

            // Claim before calling Razorpay, so a double click cannot refund
            // twice. On failure the claim is released and the status restored.
            const claimed = await run(
                `UPDATE returns SET status = 'refunding', updated_at = now()
                  WHERE id = $1 AND status = 'approved'`,
                [id]
            );
            if (!claimed.rowCount) return res.status(409).json({ error: 'Already being refunded' });

            try {
                const refund = await refundPayment(order.razorpay_payment_id, amount);
                await run(
                    `UPDATE returns SET status = 'refunded', admin_note = COALESCE($1, admin_note),
                            updated_at = now() WHERE id = $2`,
                    [typeof note === 'string' ? note.slice(0, 1000) : null, id]
                );
                sendReturnUpdate('refunded', {
                    to: row.email,
                    name: row.full_name,
                    orderNumber: row.shopify_order_number,
                    product: row.product_title,
                    amount: (amount / 100).toFixed(2),
                }).catch((err) => console.error('refund email failed:', err.message));
                return res.json({ id, status: 'refunded', refundId: refund.id, amountPaise: amount });
            } catch (err) {
                await run(`UPDATE returns SET status = 'approved', updated_at = now() WHERE id = $1`, [id]);
                console.error(`Return refund failed for ${id}:`, err.message);
                notifySlackError(`return refund failed (return ${id}, order #${row.shopify_order_number})`, err).catch(() => {});
                return res.status(502).json({ error: 'Razorpay refused the refund. Nothing has been charged back.' });
            }
        }

        if (action === 'exchange') {
            if (row.status !== 'approved') {
                return res.status(409).json({ error: 'Approve the return before sending a replacement.' });
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
            }

            // Claim first: raising two replacement orders is as bad as
            // refunding twice, and a slow Shopify call invites a second click.
            const claimed = await run(
                `UPDATE returns SET status = 'exchanging', updated_at = now()
                  WHERE id = $1 AND status = 'approved'`,
                [id]
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

                // Same reason as a normal order: the draft is completed without
                // an email so Shopify stays quiet, and the customer is attached
                // afterwards. Not fatal — the replacement has been created, and
                // failing the request here would strand the return in-progress.
                try {
                    await setOrderEmail(newOrderId, row.email);
                } catch (emailErr) {
                    notifySlackError(`Replacement order ${newOrderId} has no customer email (${row.email})`, emailErr).catch(() => {});
                }

                let newNumber = null;
                try {
                    const fresh = await getOrder(newOrderId);
                    newNumber = fresh?.order?.order_number ?? null;
                } catch { /* the order exists either way */ }

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
                await run(`UPDATE returns SET status = 'approved', updated_at = now() WHERE id = $1`, [id]);
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
