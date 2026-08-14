import { all, run } from '../db/pg.js';
import { fetchOrderPayments } from './razorpay.js';
import { fulfillPaidOrder } from './fulfillment.js';
import { notifySlackError } from './slack.js';

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
            // re-claim it. Safe here: this row is >30min old, so no live request
            // is still working on it.
            if (order.status === 'processing') {
                await run(
                    `UPDATE orders SET status = 'pending' WHERE id = $1 AND status = 'processing'`,
                    [order.id]
                );
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
