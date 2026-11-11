import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { get, all, run } from '../db/pg.js';
import { getCachedTracking } from '../services/order-tracking.js';
import { notifySlackError } from '../services/slack.js';

const router = Router();

function serializeOrder(o) {
    return {
        id: o.id,
        orderNumber: o.shopify_order_number ? Number(o.shopify_order_number) : null,
        status: o.status,
        totalAmount: Number(o.total_amount) / 100,
        shippingMethod: o.shipping_method,
        shippingAddress: JSON.parse(o.shipping_address || '{}'),
        items: JSON.parse(o.items || '[]'),
        razorpayOrderId: o.razorpay_order_id,
        shopifyOrderId: o.shopify_order_id,
        shiprocketOrderId: o.shiprocket_order_id,
        awb: o.shiprocket_awb,
        refundId: o.refund_id,
        createdAt: o.created_at,
        deliveredAt: o.delivered_at,
    };
}

// Orders delivered long ago will never change again; skip the lookup entirely.
const TRACKING_MAX_AGE_DAYS = 60;

// Attach live fulfillment/tracking from Shopify. Only paid orders that have a
// Shopify order are worth looking up; anything else keeps local status only.
async function withTracking(order) {
    if (!order.shopifyOrderId || order.status === 'cancelled') return order;

    // Already known to have landed — the state cannot change again, and the
    // local column answers the question without an external call.
    if (order.deliveredAt) return order;

    const ageDays = (Date.now() - new Date(order.createdAt).getTime()) / 86400000;
    if (ageDays > TRACKING_MAX_AGE_DAYS) return order;

    const tracking = await getCachedTracking(order.shopifyOrderId);
    if (!tracking) return order;

    // The first time Shopify reports a delivery, write it down. The returns
    // window is measured from this timestamp and nothing else sets it, so
    // without this the seven days could never start counting.
    if (tracking.shipmentStatus === 'delivered') {
        const deliveredAt = new Date().toISOString();
        run('UPDATE orders SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL', [order.id])
            .catch(err => console.error(`Could not record delivery for order ${order.id}:`, err.message));
        return { ...order, ...tracking, deliveredAt };
    }

    return { ...order, ...tracking };
}

// List all orders for authenticated user
router.get('/', authenticate, async (req, res) => {
    try {
        // Exclude 'pending' orders — those are checkouts that were started but
        // never paid (abandoned). Customers should only see real orders.
        const orders = await all(
            `SELECT * FROM orders WHERE user_id = $1 AND status <> 'pending' ORDER BY created_at DESC`,
            [req.user.id]
        );
        const enriched = await Promise.all(orders.map(o => withTracking(serializeOrder(o))));
        res.json(enriched);
    } catch (err) {
        console.error(err);
        notifySlackError('list orders failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// Get single order
router.get('/:id', authenticate, async (req, res) => {
    try {
        const order = await get(
            'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (!order) return res.status(404).json({ error: 'Order not found' });
        res.json(await withTracking(serializeOrder(order)));
    } catch (err) {
        console.error(err);
        notifySlackError('get order failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
