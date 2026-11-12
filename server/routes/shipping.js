import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { cancelOrder, getOrderTracking } from '../services/shopify-admin.js';
import { refundPayment, fetchOrderPayments } from '../services/razorpay.js';
import { sendOrderCancellation, sendRefundFailureAlert } from '../services/email.js';
import { notifySlackError } from '../services/slack.js';
import { get, run } from '../db/pg.js';

const router = Router();

// How long a cancellation claim may sit before another attempt may take it.
// Covers a slow Razorpay call without blocking the customer for long if the
// process died holding it.
const CANCEL_CLAIM_STALE_MINUTES = 10;

// Find the captured payment for an order. Paid orders record the id directly;
// orders still 'pending' (verify never completed) may still have a captured
// payment on the Razorpay order — look it up so money is never left behind.
async function findCapturedPayment(order) {
    if (order.razorpay_payment_id) {
        return { id: order.razorpay_payment_id };
    }
    if (!order.razorpay_order_id) return null;
    try {
        const payments = await fetchOrderPayments(order.razorpay_order_id);
        return payments.find(p => p.status === 'captured' || p.status === 'refunded') || null;
    } catch (err) {
        console.error('findCapturedPayment failed:', err.message);
        notifySlackError('findCapturedPayment failed', err).catch(() => {});
        return null;
    }
}

// GET /api/shipping/track-order/:orderId — get order status from DB
router.get('/track-order/:orderId', authenticate, async (req, res) => {
    try {
        const order = await get(
            // Guest sessions are scoped to the orders they placed; see
            // signToken. A signed-in customer is scoped by user_id alone.
            `SELECT * FROM orders WHERE id = $1 AND user_id = $2
                ${req.user.gsid ? 'AND guest_session_id = $3' : ''}`,
            req.user.gsid
                ? [req.params.orderId, req.user.id, req.user.gsid]
                : [req.params.orderId, req.user.id]
        );
        if (!order) return res.status(404).json({ error: 'Order not found' });

        res.json({
            status: order.status,
            orderId: order.id,
            shopifyOrderId: order.shopify_order_id,
            shippingMethod: order.shipping_method,
            createdAt: order.created_at,
        });
    } catch (err) {
        console.error(err);
        notifySlackError('track-order failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/shipping/cancel/:orderId — cancel an order and refund the payment.
// Allowed only before the order ships; refunds are automatic and idempotent.
router.post('/cancel/:orderId', authenticate, async (req, res) => {
    try {
        const order = await get(
            // Guest sessions are scoped to the orders they placed; see
            // signToken. A signed-in customer is scoped by user_id alone.
            `SELECT * FROM orders WHERE id = $1 AND user_id = $2
                ${req.user.gsid ? 'AND guest_session_id = $3' : ''}`,
            req.user.gsid
                ? [req.params.orderId, req.user.id, req.user.gsid]
                : [req.params.orderId, req.user.id]
        );
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.status === 'cancelled') return res.status(400).json({ error: 'Order already cancelled' });
        if (order.status === 'processing') {
            return res.status(409).json({ error: 'Order is being processed, please try again shortly' });
        }

        // Once fulfilled/shipped in Shopify it can't be self-cancelled — the
        // customer must request a return instead.
        if (order.shopify_order_id) {
            const tracking = await getOrderTracking(order.shopify_order_id);
            if (tracking && (tracking.fulfillmentStatus === 'fulfilled' || tracking.fulfillmentStatus === 'partial')) {
                return res.status(409).json({ error: 'Order has already shipped. Please request a return instead.' });
            }
        }

        // Atomically claim the cancellation so a double-click or a concurrent
        // call can't refund twice — in a column of its own, not by moving the
        // status to 'cancelling'. That value was accepted by no transition and
        // swept by nothing, so a deploy or a crash anywhere between here and
        // the final update stranded the order permanently: the reconciler only
        // looks at 'pending' and 'processing', the webhook only at 'pending',
        // and the customer's retry met a 409 forever. Worse, if the Razorpay
        // refund had already succeeded there was no local record of it. A
        // stale claim is now released by age.
        const claim = await run(
            `UPDATE orders SET cancel_claimed_at = now()
              WHERE id = $1 AND status IN ('pending', 'paid')
                AND (cancel_claimed_at IS NULL
                     OR cancel_claimed_at < now() - make_interval(mins => $2::int))`,
            [order.id, CANCEL_CLAIM_STALE_MINUTES]
        );
        if (claim.rowCount === 0) {
            return res.status(409).json({ error: 'Order cannot be cancelled in its current state' });
        }

        // Refund whatever was actually captured (paid orders, or pending orders
        // whose payment went through but never got verified).
        const payment = await findCapturedPayment(order);
        let refundId = null;
        let refundedPaise = 0;

        if (payment) {
            try {
                const refund = await refundPayment(payment.id, Number(order.total_amount));
                refundId = refund.id;
                refundedPaise = Number(order.total_amount);
                // Write it down before doing anything else. The Shopify call
                // below, a crash, or a deploy must never be able to lose the
                // only record that this customer's money went back.
                await run('UPDATE orders SET refund_id = $1 WHERE id = $2', [refundId, order.id])
                    .catch((e) => console.error(`Could not persist refund id for order ${order.id}:`, e.message));
            } catch (err) {
                // Money is still with us — revert the claim so it can be retried,
                // and alert the owner to refund manually.
                console.error(`Refund failed for order ${order.id}:`, err.message);
                await run(`UPDATE orders SET cancel_claimed_at = NULL WHERE id = $1`, [order.id]);
                // Alert on BOTH channels. This is the one failure where the
                // customer has been told "our team has been notified" — if the
                // only notification is an email and SMTP is having a bad day,
                // that sentence is a lie and someone is owed money nobody knows
                // about. Slack carries the Razorpay code so the cause is visible
                // without opening the dashboard: an unfunded account and a
                // payment that doesn't exist need completely different fixes.
                notifySlackError(
                    `REFUND FAILED for order ${order.id} — ₹${Number(order.total_amount) / 100} is still owed to the customer`
                    + (err.code ? ` [${err.code}${err.reason && err.reason !== 'NA' ? `/${err.reason}` : ''}]` : ''),
                    err
                ).catch(() => {});
                sendRefundFailureAlert({
                    orderId: order.id,
                    paymentId: payment.id,
                    amountPaise: Number(order.total_amount),
                    errorMessage: err.message,
                }).catch(() => { });
                return res.status(502).json({ error: 'Could not process refund. Our team has been notified — please contact support.' });
            }
        }

        // Cancel the Shopify order so it never gets packed/shipped. Best-effort:
        // the money (the critical part) is already refunded above.
        if (order.shopify_order_id) {
            try { await cancelOrder(order.shopify_order_id); }
            catch (err) {
                console.error(`Shopify cancel failed for order ${order.id}:`, err.message);
                notifySlackError(`Shopify cancel failed for order ${order.id}`, err).catch(() => {});
            }
        }

        // COALESCE so a refund id already persisted above survives, and the
        // claim is released in the same statement that settles the status.
        await run(
            `UPDATE orders SET status = 'cancelled', refund_id = COALESCE($1, refund_id),
                    cancel_claimed_at = NULL
              WHERE id = $2`,
            [refundId, order.id]
        );

        const user = await get('SELECT * FROM users WHERE id = $1', [order.user_id]).catch(() => null);
        if (user) {
            sendOrderCancellation({ order, user, refundAmountPaise: refundedPaise, refundId })
                .catch(err => {
                    console.error('Cancellation email failed:', err.message);
                    notifySlackError('cancellation email failed', err).catch(() => {});
                });
        }

        res.json({
            success: true,
            message: refundedPaise > 0 ? 'Order cancelled and refund initiated' : 'Order cancelled',
            refunded: refundedPaise > 0,
            refundAmount: refundedPaise / 100,
        });
    } catch (err) {
        console.error(err);
        notifySlackError('order cancel failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
