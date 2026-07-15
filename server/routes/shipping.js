import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { cancelOrder } from '../services/shopify-admin.js';
import { get, run } from '../db/pg.js';

const router = Router();

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
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/shipping/cancel/:orderId — cancel order
router.post('/cancel/:orderId', authenticate, async (req, res) => {
    try {
        const order = await get(
            'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
            [req.params.orderId, req.user.id]
        );
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.status === 'cancelled') return res.status(400).json({ error: 'Already cancelled' });

        if (order.shopify_order_id) {
            try { await cancelOrder(order.shopify_order_id); } catch {}
        }

        await run('UPDATE orders SET status = $1 WHERE id = $2', ['cancelled', order.id]);
        res.json({ success: true, message: 'Order cancelled' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
