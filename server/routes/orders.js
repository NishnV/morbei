import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { get, all } from '../db/pg.js';
import { getOrderTracking } from '../services/shopify-admin.js';
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
    };
}

// Shopify tracking rarely changes minute to minute, but the order list made one
// Admin API call per order — a customer with 20 orders triggered 20 external
// round-trips on every page load. Cache briefly, keyed by Shopify order id.
const TRACKING_TTL_MS = 5 * 60 * 1000;
const trackingCache = new Map(); // shopifyOrderId -> { at, value }

// Orders delivered long ago will never change again; skip the lookup entirely.
const TRACKING_MAX_AGE_DAYS = 60;

async function getCachedTracking(shopifyOrderId) {
    const hit = trackingCache.get(shopifyOrderId);
    if (hit && Date.now() - hit.at < TRACKING_TTL_MS) return hit.value;

    const value = await getOrderTracking(shopifyOrderId);
    trackingCache.set(shopifyOrderId, { at: Date.now(), value });

    // Bound the map — this process is long-lived and the cache is unbounded
    // otherwise. Cheap eviction: drop expired entries once it gets large.
    if (trackingCache.size > 500) {
        const cutoff = Date.now() - TRACKING_TTL_MS;
        for (const [k, v] of trackingCache) {
            if (v.at < cutoff) trackingCache.delete(k);
        }
    }
    return value;
}

// Attach live fulfillment/tracking from Shopify. Only paid orders that have a
// Shopify order are worth looking up; anything else keeps local status only.
async function withTracking(order) {
    if (!order.shopifyOrderId || order.status === 'cancelled') return order;

    const ageDays = (Date.now() - new Date(order.createdAt).getTime()) / 86400000;
    if (ageDays > TRACKING_MAX_AGE_DAYS) return order;

    const tracking = await getCachedTracking(order.shopifyOrderId);
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
