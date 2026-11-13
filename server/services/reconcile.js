import { all, get, run } from '../db/pg.js';
import { fetchOrderPayments } from './razorpay.js';
import { fulfillPaidOrder } from './fulfillment.js';
import { notifySlackError } from './slack.js';
import { listOrdersTracking, setOrderEmail } from './shopify-admin.js';
import { sendShipmentNotice } from './email.js';
import { recipientFor } from './recipient.js';

/**
 * Sweep for orders where money was captured but fulfilment never completed.
 *
 * Two ways an order gets stranded:
 *
 *  1. `pending` with a captured payment — /verify never ran (tab closed, network
 *     died) AND the webhook never arrived or arrived before the order row was
 *     committed. The webhook is the primary safety net; this is the net below it.
 *
 *  2. `processing` — fulfillPaidOrder claimed the order and the process died
 *     before its catch block could revert the claim (deploy, OOM, restart).
 *     Nothing ever retries these: the webhook only acts on `pending`, so they
 *     sit forever, invisible to the customer (the orders list hides non-paid
 *     rows) and to the store. Silent, and the worst failure mode in the system.
 *
 * Abandoned checkouts — `pending` with no captured payment — are normal and
 * deliberately ignored. Only real money triggers an alert.
 */

// Old enough that a live checkout can't still be in flight.
const STUCK_AFTER_MINUTES = 30;
// Don't re-scan ancient history on every pass; anything older than this has
// long since been dealt with by hand.
const LOOK_BACK_HOURS = 72;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000; // let the app settle after boot

export async function reconcileStuckOrders() {
    const candidates = await all(
        // make_interval() rather than string-concatenating an interval literal:
        // Postgres can't always infer a bare parameter's type next to ||, which
        // fails at runtime with "operator is not unique".
        `SELECT * FROM orders
         WHERE status IN ('pending', 'processing')
           AND created_at < now() - make_interval(mins => $1::int)
           AND created_at > now() - make_interval(hours => $2::int)
           -- Never fulfil an order someone is cancelling, or one whose money
           -- has already gone back. The cancellation claim used to live in
           -- the status column, which this query ignored by accident; now
           -- that it is a column of its own the order sits here at 'pending'
           -- while the refund may already have succeeded, and fulfilling it
           -- would ship goods against a refunded payment.
           AND refund_id IS NULL
           AND cancel_claimed_at IS NULL
         ORDER BY created_at ASC`,
        [STUCK_AFTER_MINUTES, LOOK_BACK_HOURS]
    );

    if (candidates.length === 0) return { scanned: 0, recovered: 0, failed: 0 };

    let recovered = 0;
    let failed = 0;

    for (const order of candidates) {
        try {
            // Did the customer actually pay? Abandoned carts have no payment.
            let paymentId = order.razorpay_payment_id;
            if (!paymentId) {
                if (!order.razorpay_order_id) continue;
                const payments = await fetchOrderPayments(order.razorpay_order_id);
                paymentId = payments.find(p => p.status === 'captured')?.id;
            }
            if (!paymentId) continue; // abandoned checkout — nothing owed, nothing to do

            // A stranded claim has to be released before fulfillPaidOrder can
            // re-claim it — but only if the claim itself is old, not merely the
            // order. This row being >30min old says nothing: a customer can sit
            // in the Razorpay flow for an hour and have /verify claim the order
            // seconds before this sweep reads it. Releasing a live claim lets
            // two callers fulfil the same payment, which is exactly the
            // duplicate-order bug this guard exists to avoid.
            if (order.status === 'processing') {
                const released = await run(
                    `UPDATE orders SET status = 'pending'
                     WHERE id = $1
                       AND status = 'processing'
                       AND (claimed_at IS NULL OR claimed_at < now() - make_interval(mins => $2::int))`,
                    [order.id, STUCK_AFTER_MINUTES]
                );
                // Someone is actively working on it — leave it for the next sweep.
                if (released.rowCount === 0) continue;
                order.status = 'pending';
            }

            const result = await fulfillPaidOrder(order, paymentId);
            if (!result.alreadyProcessed) {
                recovered++;
                const msg = `Recovered stranded order ${order.id} (payment ${paymentId}, `
                    + `₹${Number(order.total_amount) / 100}) — Shopify order ${result.shopifyOrderId}`;
                console.warn(msg);
                notifySlackError('Order recovered by reconciler', new Error(msg)).catch(() => {});
            }
        } catch (err) {
            failed++;
            console.error(`Reconciler could not recover order ${order.id}:`, err.message);
            notifySlackError(
                `Reconciler FAILED for order ${order.id} — money is captured, fulfil this by hand`,
                err
            ).catch(() => {});
        }
    }

    return { scanned: candidates.length, recovered, failed };
}

// How far back to look for orders that have been fulfilled but not yet
// announced. Generous, because this only runs hourly and a parcel fulfilled
// on a Friday evening should still be announced over the weekend.
const SHIPPED_LOOK_BACK_DAYS = 30;

/**
 * Tell customers whose orders have been fulfilled since the last sweep.
 *
 * Shopify does not tell us when someone fulfils an order — there is no
 * callback and no field that records when it happened — so this compares the
 * orders we have not announced against Shopify's current fulfilment state.
 * One bulk call covers every order rather than one call each: the REST Admin
 * API allows two requests a second, and a per-order loop would spend that
 * budget on a screen nobody is looking at.
 *
 * shipped_email_at is claimed BEFORE the send, not after. A send that fails
 * is a customer who hears nothing once; a crash between send and update
 * would make every later sweep announce the same parcel again.
 */
export async function notifyShippedOrders() {
    const pending = await all(
        `SELECT id, user_id, shopify_order_id, shopify_order_number, items, is_test
           FROM orders
          WHERE status = 'paid'
            AND shopify_order_id IS NOT NULL
            AND shipped_email_at IS NULL
            AND created_at > now() - make_interval(days => $1::int)`,
        [SHIPPED_LOOK_BACK_DAYS]
    );
    if (pending.length === 0) return { checked: 0, sent: 0 };

    const tracking = await listOrdersTracking(250);
    let sent = 0;

    for (const order of pending) {
        const t = tracking.get(String(order.shopify_order_id));
        // Not in the window Shopify returned, or not fulfilled yet. Either way
        // there is nothing to announce; look again next hour.
        if (!t || t.fulfillmentStatus !== 'fulfilled') continue;

        const claimed = await run(
            `UPDATE orders SET shipped_email_at = now()
              WHERE id = $1 AND shipped_email_at IS NULL`,
            [order.id]
        );
        if (claimed.rowCount === 0) continue; // another sweep got there first

        try {
            const user = recipientFor(
                await get('SELECT * FROM users WHERE id = $1', [order.user_id]),
                order
            );
            let cartLines = [];
            try { cartLines = JSON.parse(order.items); } catch { /* the notice still stands without a list */ }

            await sendShipmentNotice({ order, user, cartLines, tracking: t });
            sent++;
            console.log(`Shipment notice sent for order ${order.id} (#${order.shopify_order_number})`);
        } catch (err) {
            // The column stays set. Announcing a parcel twice is worse than
            // once not at all, and the failure is reported rather than retried
            // blindly every hour until it is noticed.
            console.error(`Shipment notice failed for order ${order.id}:`, err.message);
            notifySlackError(
                `Shipping email failed for order #${order.shopify_order_number || order.id} — tell them by hand`,
                err
            ).catch(() => {});
        }
    }

    return { checked: pending.length, sent };
}

// A cancellation claim older than this was abandoned by a process that died.
const STRANDED_CANCEL_MINUTES = 30;

/**
 * Surface cancellations that never finished.
 *
 * The claim is released so the customer can try again — but only when no
 * refund was issued. If one was, the money is already back and finishing the
 * cancellation is a judgement call about a real customer's order, so it is
 * reported rather than guessed at.
 */
// Shopify makes its send-or-not decision within a second or two of the order
// being created. Well past that, and generous, because being late here costs
// nothing at all.
const EMAIL_BACKFILL_AFTER_MINUTES = 15;

/**
 * Put the customer on Shopify orders that were deliberately created without
 * one.
 *
 * Draft orders are completed with no email so that Shopify has nobody to send
 * its own confirmation to — the store sends its own, and two confirmations for
 * one order is worse than none. Attaching the customer immediately afterwards
 * looked like it worked, and was in fact a race: on one order the update
 * landed a second late and Shopify stayed quiet, on the next it landed in the
 * same second and Shopify sent a duplicate.
 *
 * So it happens here instead, an hour or so later, where the race cannot be
 * lost. Nothing reads the email off the Shopify order — every lookup joins our
 * own users table — so the delay costs nothing but a gap in the Shopify admin
 * that closes by itself.
 */
export async function backfillOrderEmails() {
    const candidates = await all(
        // COALESCE, not u.email: an address corrected on the order is the
        // one Shopify should be told about. Taking the account's would hand
        // Shopify back the typo this column exists to fix.
        `SELECT o.id, o.shopify_order_id, o.shopify_order_number,
                COALESCE(o.email, u.email) AS email
           FROM orders o
           JOIN users u ON u.id = o.user_id
          WHERE o.shopify_order_id IS NOT NULL
            AND o.shopify_order_missing_at IS NULL
            AND COALESCE(o.email, u.email) IS NOT NULL
            AND o.created_at < now() - make_interval(mins => $1::int)
            AND o.created_at > now() - make_interval(days => 30)`,
        [EMAIL_BACKFILL_AFTER_MINUTES]
    );
    if (candidates.length === 0) return { checked: 0, set: 0 };

    const tracking = await listOrdersTracking(250);
    let set = 0;

    for (const order of candidates) {
        const t = tracking.get(String(order.shopify_order_id));
        // Not in the window Shopify returned, or already has a customer.
        if (!t || t.email) continue;
        try {
            await setOrderEmail(order.shopify_order_id, order.email);
            set++;
            console.log(`Attached ${order.email} to Shopify order #${order.shopify_order_number}`);
        } catch (err) {
            console.error(`Could not attach email to Shopify order ${order.shopify_order_id}:`, err.message);
            notifySlackError(
                `Could not put the customer on Shopify order #${order.shopify_order_number || order.shopify_order_id}`,
                err
            ).catch(() => {});
        }
    }
    return { checked: candidates.length, set };
}

/**
 * Say so before giving up.
 *
 * reconcileStuckOrders only looks back LOOK_BACK_HOURS, so an order it could
 * never fix simply fell out of the window — after three days of hourly alerts,
 * silence, which reads exactly like "resolved". This fires once, at the edge,
 * for anything about to be abandoned with the customer's money captured.
 */
export async function reportAbandonedRecoveries() {
    const giving_up = await all(
        `SELECT id, total_amount, razorpay_payment_id
           FROM orders
          WHERE status IN ('pending', 'processing')
            AND razorpay_payment_id IS NOT NULL
            AND shopify_order_id IS NULL
            AND created_at < now() - make_interval(hours => $1::int)
            AND created_at > now() - make_interval(hours => $2::int)`,
        [LOOK_BACK_HOURS, LOOK_BACK_HOURS + 1]
    );

    for (const order of giving_up) {
        notifySlackError(
            `GIVING UP on order ${order.id} — ₹${Number(order.total_amount) / 100} captured `
            + `(Razorpay ${order.razorpay_payment_id}) and no Shopify order after ${LOOK_BACK_HOURS}h. `
            + 'The reconciler will stop retrying it. Fulfil or refund this by hand.',
            new Error('reconciler look-back window exceeded')
        ).catch(() => {});
    }
    return { abandoned: giving_up.length };
}

export async function releaseStrandedCancellations() {
    const stranded = await all(
        `SELECT id, status, refund_id, total_amount
           FROM orders
          WHERE cancel_claimed_at IS NOT NULL
            AND status NOT IN ('cancelled')
            AND cancel_claimed_at < now() - make_interval(mins => $1::int)`,
        [STRANDED_CANCEL_MINUTES]
    );
    if (stranded.length === 0) return { stranded: 0 };

    for (const order of stranded) {
        if (order.refund_id) {
            notifySlackError(
                `Cancellation did not finish for order ${order.id} — Razorpay refund ${order.refund_id} `
                + `(₹${Number(order.total_amount) / 100}) WAS issued but the order is still '${order.status}'. `
                + 'Cancel it in Shopify and mark it cancelled by hand.',
                new Error('stranded cancellation with refund issued')
            ).catch(() => {});
            continue;
        }
        await run('UPDATE orders SET cancel_claimed_at = NULL WHERE id = $1', [order.id]);
        console.warn(`Released stranded cancellation claim on order ${order.id} (no refund was issued)`);
    }
    return { stranded: stranded.length };
}

/**
 * Start the periodic sweep. Never throws — a broken reconciler must not be able
 * to take down the server it is meant to protect.
 */
export function startReconciler() {
    const sweep = async () => {
        try {
            const result = await reconcileStuckOrders();
            if (result.scanned > 0) {
                console.log(
                    `Reconciler: scanned ${result.scanned}, recovered ${result.recovered}, failed ${result.failed}`
                );
            }

            try {
                const filled = await backfillOrderEmails();
                if (filled.set > 0) console.log(`Reconciler: attached customers to ${filled.set} Shopify order(s)`);
            } catch (err) {
                console.error('Email backfill failed:', err.message);
                notifySlackError('Shopify email backfill failed', err).catch(() => {});
            }

            try {
                await reportAbandonedRecoveries();
            } catch (err) {
                console.error('Abandoned-recovery report failed:', err.message);
            }

            try {
                await releaseStrandedCancellations();
            } catch (err) {
                console.error('Stranded cancellation sweep failed:', err.message);
                notifySlackError('Stranded cancellation sweep failed', err).catch(() => {});
            }

            // Separately caught: a Shopify outage must not stop the sweep that
            // recovers captured payments, which is the one that involves money.
            try {
                const shipped = await notifyShippedOrders();
                if (shipped.sent > 0) {
                    console.log(`Reconciler: announced ${shipped.sent} shipment(s) of ${shipped.checked} awaiting`);
                }
            } catch (err) {
                console.error('Shipment sweep failed:', err.message);
                notifySlackError('Shipment notice sweep failed', err).catch(() => {});
            }
        } catch (err) {
            console.error('Reconciler sweep failed:', err.message);
            notifySlackError('Reconciler sweep failed', err).catch(() => {});
        }
    };

    setTimeout(sweep, FIRST_SWEEP_DELAY_MS).unref?.();
    const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
    timer.unref?.(); // don't hold the process open on shutdown
    return timer;
}
