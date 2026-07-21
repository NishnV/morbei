import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { all, run, withTransaction } from '../db/pg.js';
import { notifySlackError } from '../services/slack.js';

const router = Router();

function parseWishlistRows(rows) {
    return rows.map(row => ({
        ...JSON.parse(row.product_data || '{}'),
        product_id: row.product_id,
        variant_id: row.variant_id,
    }));
}

// GET /api/wishlist — get user's wishlist
router.get('/', authenticate, async (req, res) => {
    try {
        const items = await all(
            'SELECT product_id, variant_id, product_data FROM wishlist WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ wishlist: parseWishlistRows(items) });
    } catch (err) {
        console.error(err);
        notifySlackError('wishlist get failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/wishlist — add item
router.post('/', authenticate, async (req, res) => {
    try {
        const { product_id, variant_id, product_data } = req.body;
        if (!product_id) return res.status(400).json({ error: 'product_id is required' });

        await run(
            `INSERT INTO wishlist (user_id, product_id, variant_id, product_data)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, product_id)
             DO UPDATE SET variant_id = EXCLUDED.variant_id, product_data = EXCLUDED.product_data`,
            [req.user.id, product_id, variant_id || null, JSON.stringify(product_data || {})]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        notifySlackError('wishlist add failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// DELETE /api/wishlist/:productId — remove item
router.delete('/:productId', authenticate, async (req, res) => {
    try {
        await run(
            'DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2',
            [req.user.id, req.params.productId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        notifySlackError('wishlist remove failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/wishlist/sync — merge local wishlist into server (called on login)
router.post('/sync', authenticate, async (req, res) => {
    try {
        const { items } = req.body; // [{ product_id, variant_id, product_data }]
        if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

        await withTransaction(async (client) => {
            for (const item of items) {
                if (item.product_id) {
                    await client.query(
                        `INSERT INTO wishlist (user_id, product_id, variant_id, product_data)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (user_id, product_id) DO NOTHING`,
                        [req.user.id, item.product_id, item.variant_id || null, JSON.stringify(item.product_data || {})]
                    );
                }
            }
        });

        const rows = await all(
            'SELECT product_id, variant_id, product_data FROM wishlist WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ wishlist: parseWishlistRows(rows) });
    } catch (err) {
        console.error(err);
        notifySlackError('wishlist sync failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
