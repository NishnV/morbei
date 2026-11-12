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
/**
 * POST /api/orders/lookup — an order number and an email, for a guest.
 *
 * A guest checkout issues a session token, but it lives in the browser that
 * placed the order: a different device, or a cleared cache, and there is no
 * way back to the order at all. This is the same pair the returns flow
 * already asks for, answered with the same tracking the signed-in page shows.
 *
 * Deliberately a POST: an order number and an email in a query string end up
 * in browser history, server logs and any referrer sent to a third party.
 */
router.post('/lookup', async (req, res) => {
    try {
        const raw = String(req.body?.orderNumber ?? '').replace(/[^0-9]/g, '');
        const number = parseInt(raw, 10);
        const email = String(req.body?.email ?? '').trim();
        if (!Number.isFinite(number) || !email) {
            return res.status(400).json({ error: 'An order number and an email are required.' });
        }

        const order = await get(
            `SELECT o.*
               FROM orders o
               JOIN users u ON u.id = o.user_id
              WHERE o.shopify_order_number = $1
                AND lower(u.email) = lower($2)
                AND o.razorpay_payment_id IS NOT NULL`,
            [number, email]
        );

        // One answer for "no such order" and "wrong email", so the endpoint
        // cannot be walked to discover which order numbers exist.
        if (!order) {
            return res.status(404).json({ error: 'We could not find an order with those details.' });
        }

        const full = await withTracking(serializeOrder(order));

        // Least privilege for an unauthenticated caller. Knowing an order
        // number and an email is enough to see where the parcel is; it is not
        // a reason to hand over the Razorpay and Shopify identifiers behind
        // it, which this page never renders anyway.
        const { razorpayOrderId, shopifyOrderId, shiprocketOrderId, refundId, ...safe } = full;
        res.json(safe);
    } catch (err) {
        console.error('order lookup failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

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
