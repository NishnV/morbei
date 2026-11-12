import { all, get, run } from '../db/pg.js';
import { fetchOrderPayments } from './razorpay.js';
import { fulfillPaidOrder } from './fulfillment.js';
import { notifySlackError } from './slack.js';
import { listOrdersTracking } from './shopify-admin.js';
import { sendShipmentNotice } from './email.js';

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
            const user = await get('SELECT * FROM users WHERE id = $1', [order.user_id]);
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
