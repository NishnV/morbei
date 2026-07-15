import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import db from '../db/sqlite.js';

const router = Router();

// GET /api/wishlist — get user's wishlist
router.get('/', authenticate, (req, res) => {
    try {
        const items = db.prepare(
            `SELECT product_id, variant_id, product_data FROM wishlist WHERE user_id = ? ORDER BY created_at DESC`
        ).all(req.user.id);

        const parsed = items.map(item => ({
            ...JSON.parse(item.product_data || '{}'),
            product_id: item.product_id,
            variant_id: item.variant_id,
        }));

        res.json({ wishlist: parsed });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/wishlist — add item
router.post('/', authenticate, (req, res) => {
    try {
        const { product_id, variant_id, product_data } = req.body;
        if (!product_id) return res.status(400).json({ error: 'product_id is required' });

        db.prepare(
            `INSERT OR REPLACE INTO wishlist (user_id, product_id, variant_id, product_data)
             VALUES (?, ?, ?, ?)`
        ).run(req.user.id, product_id, variant_id || null, JSON.stringify(product_data || {}));

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// DELETE /api/wishlist/:productId — remove item
router.delete('/:productId', authenticate, (req, res) => {
    try {
        db.prepare(
            `DELETE FROM wishlist WHERE user_id = ? AND product_id = ?`
        ).run(req.user.id, req.params.productId);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/wishlist/sync — bulk replace wishlist (called on login to merge local + server)
router.post('/sync', authenticate, (req, res) => {
    try {
        const { items } = req.body; // [{ product_id, variant_id, product_data }]
        if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

        const insert = db.prepare(
            `INSERT OR IGNORE INTO wishlist (user_id, product_id, variant_id, product_data)
             VALUES (?, ?, ?, ?)`
        );
        const syncAll = db.transaction((rows) => {
            for (const item of rows) {
                if (item.product_id) {
                    insert.run(req.user.id, item.product_id, item.variant_id || null, JSON.stringify(item.product_data || {}));
                }
            }
        });
        syncAll(items);

        const all = db.prepare(
            `SELECT product_id, variant_id, product_data FROM wishlist WHERE user_id = ? ORDER BY created_at DESC`
        ).all(req.user.id);

        const parsed = all.map(row => ({
            ...JSON.parse(row.product_data || '{}'),
            product_id: row.product_id,
            variant_id: row.variant_id,
        }));

        res.json({ wishlist: parsed });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
