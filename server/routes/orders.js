import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import db from '../db/sqlite.js';

const router = Router();

// List all orders for authenticated user
router.get('/', authenticate, (req, res) => {
    const orders = db.prepare(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);

    res.json(
        orders.map(o => ({
            id: o.id,
            status: o.status,
            totalAmount: o.total_amount / 100,
            shippingMethod: o.shipping_method,
            shippingAddress: JSON.parse(o.shipping_address || '{}'),
            items: JSON.parse(o.items || '[]'),
            razorpayOrderId: o.razorpay_order_id,
            shopifyOrderId: o.shopify_order_id,
            shiprocketOrderId: o.shiprocket_order_id,
            awb: o.shiprocket_awb,
            createdAt: o.created_at,
        }))
    );
});

// Get single order
router.get('/:id', authenticate, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(
        req.params.id,
        req.user.id
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
        id: order.id,
        status: order.status,
        totalAmount: order.total_amount / 100,
        shippingMethod: order.shipping_method,
        shippingAddress: JSON.parse(order.shipping_address || '{}'),
        items: JSON.parse(order.items || '[]'),
        razorpayOrderId: order.razorpay_order_id,
        shopifyOrderId: order.shopify_order_id,
        shiprocketOrderId: order.shiprocket_order_id,
        awb: order.shiprocket_awb,
        createdAt: order.created_at,
    });
});

export default router;
