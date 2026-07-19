import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { get, all } from '../db/pg.js';
import { getOrderTracking } from '../services/shopify-admin.js';

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
    };
}

// Attach live fulfillment/tracking from Shopify. Only paid orders that have a
// Shopify order are worth looking up; anything else keeps local status only.
async function withTracking(order) {
    if (!order.shopifyOrderId || order.status === 'cancelled') return order;
    const tracking = await getOrderTracking(order.shopifyOrderId);
    return tracking ? { ...order, ...tracking } : order;
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
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
