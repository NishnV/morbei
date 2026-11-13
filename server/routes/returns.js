import { Router } from 'express';
import { get, all, run } from '../db/pg.js';
import { notifySlackError, notifySlackReturn } from '../services/slack.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import { sendReturnUpdate } from '../services/email.js';
import { signUpload, uploadsConfigured } from '../services/cloudinary.js';

const router = Router();

/**
 * Return and exchange requests.
 *
 * The form asks for an order number and an email rather than a login, which
 * is right for conversion — a shopper chasing a refund should not have to
 * remember an account — but it means the order number alone must never be
 * enough to see anything. Order numbers are sequential, so if it were, anyone
 * could walk #1000 upwards and read what every customer bought.
 *
 * So the lookup matches on order number AND the email that placed it, answers
 * identically whether the number does not exist or the email does not match,
 * and returns only that order's line items.
 */

// The six on the form. Anything else is dropped rather than stored, so the
// admin list can be filtered on these without sanitising free text.
const REASONS = new Set([
    'size_fit', 'damaged', 'wrong_product', 'quality', 'not_as_expected', 'other',
]);
const RESOLUTIONS = new Set(['refund', 'exchange_size', 'exchange_product']);

const RETURN_WINDOW_DAYS = 7;   // Matches the Returns policy page.

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Only our own Cloudinary account, so a request cannot carry links anywhere else. */
function cleanMedia(value) {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloud || !Array.isArray(value)) return [];
    const prefix = `https://res.cloudinary.com/${cloud}/`;
    return value
        .filter((u) => typeof u === 'string' && u.startsWith(prefix) && u.length < 500)
        .slice(0, 6);
}

/**
 * The order behind an order number + email, or null. Shared by lookup and
 * submit: submit re-runs it rather than trusting what the browser sends back,
 * since nothing stops a caller skipping the lookup entirely.
 */
async function findOrder(orderNumber, email) {
    const n = parseInt(String(orderNumber).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(n) || !email) return null;
    return get(
        `SELECT o.*, u.email AS user_email
           FROM orders o
           JOIN users u ON u.id = o.user_id
          WHERE o.shopify_order_number = $1
            AND lower(u.email) = lower($2)
            AND o.razorpay_payment_id IS NOT NULL`,
        [n, String(email).trim()]
    );
}

function eligibility(order) {
    // delivered_at is the honest basis. When it is missing — Shopify only
    // reports delivery when carrier tracking was attached — the request is
    // still accepted and flagged, because refusing every return until the
    // tracking integration exists would be worse than reviewing by hand.
    if (!order.delivered_at) {
        return { eligible: true, basis: 'unknown', daysSinceDelivery: null };
    }
    const days = Math.floor((Date.now() - new Date(order.delivered_at)) / 86400000);
    return { eligible: days <= RETURN_WINDOW_DAYS, basis: 'delivered_at', daysSinceDelivery: days };
}

/** The order's line items, with the ones already under review marked. */
async function itemsFor(order) {
    let items = [];
    try { items = JSON.parse(order.items || '[]'); } catch { items = []; }
    const openRows = await all(
        `SELECT variant_id FROM returns
          WHERE order_id = $1 AND status IN ('requested', 'approved')`,
        [order.id]
    );
    const open = new Set(openRows.map((r) => r.variant_id));
    return items.map((i) => ({
        variantId: i.variantId,
        title: i.title,
        quantity: i.quantity,
        options: i.selectedOptions || [],
        image: i.image || null,
        alreadyRequested: open.has(i.variantId),
    }));
}

/**
 * GET /api/returns/orders — the signed-in shopper's own orders.
 *
 * The other half of the dual path. Someone signed in should not have to go
 * and find an order number: they pick from a list, and are authenticated
 * outright rather than by knowing two matching fields.
 */
router.get('/orders', authenticate, async (req, res) => {
    try {
        const orders = await all(
            // Scoped like every other authenticated order read: a guest
            // session may only raise returns against what it bought.
            `SELECT * FROM orders
              WHERE user_id = $1 AND razorpay_payment_id IS NOT NULL
                ${req.user.gsid ? 'AND guest_session_id = $2' : ''}
              ORDER BY created_at DESC LIMIT 25`,
            req.user.gsid ? [req.user.id, req.user.gsid] : [req.user.id]
        );
        res.json({
            email: req.user.email,
            orders: await Promise.all(orders.map(async (o) => ({
                orderNumber: o.shopify_order_number,
                placedAt: o.created_at,
                deliveredAt: o.delivered_at,
                ...eligibility(o),
                items: await itemsFor(o),
                // Carried on each order, redundantly, because the form reads
                // it off whichever order is selected — and a signed-in
                // customer's order comes from this list rather than from the
                // lookup below. Omitting it here meant the upload control was
                // hidden for everyone with an account, with the form claiming
                // uploads were unconfigured when they were working.
                uploadsEnabled: uploadsConfigured,
            }))),
        });
    } catch (err) {
        console.error('return orders failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/returns/lookup — the order's items, for the product dropdown.
router.post('/lookup', async (req, res) => {
    try {
        const order = await findOrder(req.body?.orderNumber, req.body?.email);
        if (!order) {
            // Same answer for "no such order" and "wrong email", so the
            // response cannot be used to discover which numbers exist.
            return res.status(404).json({ error: 'We could not find an order with those details.' });
        }

        res.json({
            orderNumber: order.shopify_order_number,
            placedAt: order.created_at,
            deliveredAt: order.delivered_at,
            ...eligibility(order),
            items: await itemsFor(order),
            // Decided by the server now. The browser used to work this out
            // from its own build-time variables, which meant the upload UI
            // could appear while the backend had no idea what Cloudinary was.
            uploadsEnabled: uploadsConfigured,
        });
    } catch (err) {
        console.error('return lookup failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/returns — submit a request.
/**
 * POST /api/returns/upload-signature — permission to upload one file.
 *
 * The same order number and email the lookup asks for, checked the same way,
 * because the alternative is what this replaces: an unsigned preset that
 * anyone could find in the page source and post to directly.
 *
 * A signature is short-lived and says nothing about which file follows, so
 * this is not a perfect bound — someone with a real order can still upload
 * more than they should. It does mean an uploader must hold a genuine order
 * number and the address on it, which is the difference between a gate and
 * an open door, and it puts every attempt through the returns rate limit.
 */
router.post('/upload-signature', async (req, res) => {
    try {
        if (!uploadsConfigured) {
            return res.status(503).json({ error: 'Uploads are not configured.' });
        }
        const order = await findOrder(req.body?.orderNumber, req.body?.email);
        if (!order) {
            // Same answer the lookup gives, for the same reason.
            return res.status(404).json({ error: 'We could not find an order with those details.' });
        }
        return res.json(signUpload());
    } catch (err) {
        console.error('upload signature failed:', err.message);
        return res.status(500).json({ error: 'Something went wrong' });
    }
});

router.post('/', optionalAuthenticate, async (req, res) => {
    try {
        const b = req.body || {};
        // Signed in: the order has to be theirs, and the email they typed is
        // irrelevant — a session is the stronger claim. Signed out: the order
        // number and the email that placed it, both.
        const order = req.user
            ? await get(
                `SELECT o.*, u.email AS user_email
                   FROM orders o JOIN users u ON u.id = o.user_id
                  WHERE o.shopify_order_number = $1
                    AND o.user_id = $2
                    AND o.razorpay_payment_id IS NOT NULL`,
                [parseInt(String(b.orderNumber).replace(/[^0-9]/g, ''), 10) || 0, req.user.id]
            )
            : await findOrder(b.orderNumber, b.email);
        if (!order) {
            return res.status(404).json({ error: 'We could not find an order with those details.' });
        }

        if (b.declaration !== true) {
            return res.status(400).json({ error: 'Please confirm the declaration to continue.' });
        }

        const reasons = (Array.isArray(b.reasons) ? b.reasons : []).filter((r) => REASONS.has(r));
        if (!reasons.length) return res.status(400).json({ error: 'Please choose a reason for the return.' });

        const resolution = RESOLUTIONS.has(b.resolution) ? b.resolution : null;
        if (!resolution) return res.status(400).json({ error: 'Please choose a refund or an exchange.' });

        // The item has to be one this order actually contains.
        let items = [];
        try { items = JSON.parse(order.items || '[]'); } catch { items = []; }
        const item = items.find((i) => i.variantId === b.variantId);
        if (!item) return res.status(400).json({ error: 'Please choose a product from your order.' });

        // An exchange is not actionable without knowing what to send instead.
        const exchangeSize = resolution === 'exchange_size'
            ? str(b.exchangeSize, 20)
            : null;
        if (resolution === 'exchange_size' && !exchangeSize) {
            return res.status(400).json({ error: 'Please choose the size you would like instead.' });
        }

        const media = cleanMedia(b.media);
        // Photographs are what make a damage claim reviewable without posting
        // the item back first, so they are required for exactly those reasons.
        const needsPhotos = reasons.some((r) => ['damaged', 'wrong_product', 'quality'].includes(r));
        if (needsPhotos && media.length === 0) {
            return res.status(400).json({ error: 'Please upload a photo or video showing the issue.' });
        }

        const inserted = await run(
            `INSERT INTO returns
               (order_id, shopify_order_number, email, full_name, phone, variant_id,
                product_title, reasons, details, resolution, comments, media, exchange_size, declaration)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
             ON CONFLICT (order_id, variant_id)
               WHERE status IN ('requested', 'approved') DO NOTHING
             RETURNING id`,
            [
                order.id, order.shopify_order_number, order.user_email,
                str(b.fullName, 120), str(b.phone, 40), item.variantId,
                str(item.title, 200), JSON.stringify(reasons), str(b.details, 2000),
                resolution, str(b.comments, 2000), JSON.stringify(media), exchangeSize,
            ]
        );

        if (!inserted.rows?.length) {
            // The unique index caught a second request for the same item.
            return res.status(409).json({ error: 'A return request for this item is already being reviewed.' });
        }

        const el = eligibility(order);
        // Fire-and-forget, both of them: a failed notification must not undo a
        // request the shopper has already been told we have.
        sendReturnUpdate('received', {
            to: order.user_email,
            name: str(b.fullName, 120) || '',
            orderNumber: order.shopify_order_number,
            product: item.title,
        }).catch((err) => console.error('return received email failed:', err.message));

        notifySlackReturn({
            id: inserted.rows[0].id,
            orderNumber: order.shopify_order_number,
            product: item.title,
            reasons,
            resolution,
            email: order.user_email,
            mediaCount: media.length,
            outsideWindow: !el.eligible,
            daysSinceDelivery: el.daysSinceDelivery,
        }).catch(() => {});

        res.status(201).json({ id: inserted.rows[0].id, status: 'requested' });
    } catch (err) {
        console.error('return request failed:', err.message);
        notifySlackError('return request failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
});

export default router;
