import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { get, all } from '../db/pg.js';

const router = Router();

function serializeOrder(o) {
    return {
        id: o.id,
        status: o.status,
        totalAmount: Number(o.total_amount) / 100,
        shippingMethod: o.shipping_method,
        shippingAddress: JSON.parse(o.shipping_address || '{}'),
        items: JSON.parse(o.items || '[]'),
        razorpayOrderId: o.razorpay_order_id,
        shopifyOrderId: o.shopify_order_id,
        shiprocketOrderId: o.shiprocket_order_id,
        awb: o.shiprocket_awb,
        createdAt: o.created_at,
    };
}

// List all orders for authenticated user
router.get('/', authenticate, async (req, res) => {
    try {
        const orders = await all(
            'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(orders.map(serializeOrder));
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
        res.json(serializeOrder(order));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
