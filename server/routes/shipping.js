import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { cancelOrder, getOrderTracking } from '../services/shopify-admin.js';
import { refundPayment, fetchOrderPayments } from '../services/razorpay.js';
import { sendOrderCancellation, sendRefundFailureAlert } from '../services/email.js';
import { notifySlackError } from '../services/slack.js';
import { get, run } from '../db/pg.js';

const router = Router();

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
            'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
            [req.params.orderId, req.user.id]
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
            'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
            [req.params.orderId, req.user.id]
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

        // Atomically claim the cancellation so a double-click / concurrent call
        // can't refund twice. Only one caller flips it out of its current state.
        const claim = await run(
            `UPDATE orders SET status = 'cancelling' WHERE id = $1 AND status IN ('pending', 'paid')`,
            [order.id]
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
            } catch (err) {
                // Money is still with us — revert the claim so it can be retried,
                // and alert the owner to refund manually.
                console.error(`Refund failed for order ${order.id}:`, err.message);
                await run(`UPDATE orders SET status = $1 WHERE id = $2 AND status = 'cancelling'`, [order.status, order.id]);
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

        await run('UPDATE orders SET status = $1, refund_id = $2 WHERE id = $3', ['cancelled', refundId, order.id]);

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
