import { Router } from 'express';
import { get, all, run } from '../db/pg.js';
import { requireDashboardToken } from '../middleware/adminToken.js';
import { refundPayment } from '../services/razorpay.js';
import { notifySlackError } from '../services/slack.js';
import { funnelSummary } from './events.js';

const router = Router();
router.use(requireDashboardToken);

// GET /api/dashboard/funnel
router.get('/funnel', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 90);
        res.json(await funnelSummary(days));
    } catch (err) {
        console.error('Funnel summary failed:', err.message);
        res.status(500).json({ error: 'Could not build the funnel' });
    }
});

const STATUSES = ['requested', 'approved', 'rejected', 'refunded'];

/** What this one item is worth, in paise, from the order's stored lines. */
function itemAmountPaise(order, variantId) {
    let items = [];
    try { items = JSON.parse(order.items || '[]'); } catch { return null; }
    const line = items.find((i) => i.variantId === variantId);
    if (!line || !Number.isFinite(Number(line.price))) return null;
    const paise = Math.round(Number(line.price) * (line.quantity || 1) * 100);
    // Never refund more than was taken, whatever the stored line says.
    return paise > 0 && paise <= Number(order.total_amount) ? paise : null;
}

// GET /api/dashboard/returns?status=requested
router.get('/returns', async (req, res) => {
    try {
        const status = STATUSES.includes(req.query.status) ? req.query.status : null;
        const rows = await all(
            `SELECT r.*, o.total_amount, o.items AS order_items, o.razorpay_payment_id, o.delivered_at
               FROM returns r
               LEFT JOIN orders o ON o.id = r.order_id
              ${status ? 'WHERE r.status = $1' : ''}
              ORDER BY r.created_at DESC
              LIMIT 100`,
            status ? [status] : []
        );
        res.json({
            returns: rows.map((r) => ({
                id: r.id,
                orderNumber: r.shopify_order_number,
                email: r.email,
                fullName: r.full_name,
                phone: r.phone,
                product: r.product_title,
                reasons: JSON.parse(r.reasons || '[]'),
                details: r.details,
                resolution: r.resolution,
                comments: r.comments,
                media: JSON.parse(r.media || '[]'),
                status: r.status,
                adminNote: r.admin_note,
                createdAt: r.created_at,
                deliveredAt: r.delivered_at,
                // Shown next to the button, so the amount is known before the
                // refund is pressed rather than discovered afterwards.
                refundablePaise: r.order_id ? itemAmountPaise(
                    { items: r.order_items, total_amount: r.total_amount }, r.variant_id
                ) : null,
                refundable: Boolean(r.razorpay_payment_id),
            })),
            counts: Object.fromEntries(
                (await all(`SELECT status, COUNT(*)::int AS n FROM returns GROUP BY status`))
                    .map((c) => [c.status, c.n])
            ),
        });
    } catch (err) {
        console.error('admin returns list failed:', err.message);
        res.status(500).json({ error: 'Could not load returns' });
    }
});

/**
 * POST /api/dashboard/returns/:id — approve, reject, or refund.
 *
 * Refund is deliberately a separate step from approve rather than a
 * consequence of it. Approving tells the customer to send the item back;
 * money should move once it has arrived, which is also what the policy
 * promises. Folding the two together would make a single click both a
 * decision and a payment.
 */
router.post('/returns/:id', async (req, res) => {
    const { action, note } = req.body || {};
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

    try {
        const row = await get('SELECT * FROM returns WHERE id = $1', [id]);
        if (!row) return res.status(404).json({ error: 'Not found' });

        if (action === 'approve' || action === 'reject') {
            const next = action === 'approve' ? 'approved' : 'rejected';
            const claimed = await run(
                `UPDATE returns SET status = $1, admin_note = $2, updated_at = now()
                  WHERE id = $3 AND status = 'requested'`,
                [next, typeof note === 'string' ? note.slice(0, 1000) : null, id]
            );
            if (!claimed.rowCount) {
                return res.status(409).json({ error: `Already ${row.status}` });
            }
            return res.json({ id, status: next });
        }

        if (action === 'refund') {
            if (row.status !== 'approved') {
                return res.status(409).json({ error: 'Approve the return before refunding.' });
            }
            const order = await get('SELECT * FROM orders WHERE id = $1', [row.order_id]);
            if (!order?.razorpay_payment_id) {
                return res.status(400).json({ error: 'No captured payment found for this order.' });
            }
            const amount = itemAmountPaise(order, row.variant_id);
            if (!amount) {
                return res.status(400).json({ error: 'Could not work out the amount — refund this one in Razorpay.' });
            }

            // Claim before calling Razorpay, so a double click cannot refund
            // twice. On failure the claim is released and the status restored.
            const claimed = await run(
                `UPDATE returns SET status = 'refunding', updated_at = now()
                  WHERE id = $1 AND status = 'approved'`,
                [id]
            );
            if (!claimed.rowCount) return res.status(409).json({ error: 'Already being refunded' });

            try {
                const refund = await refundPayment(order.razorpay_payment_id, amount);
                await run(
                    `UPDATE returns SET status = 'refunded', admin_note = COALESCE($1, admin_note),
                            updated_at = now() WHERE id = $2`,
                    [typeof note === 'string' ? note.slice(0, 1000) : null, id]
                );
                return res.json({ id, status: 'refunded', refundId: refund.id, amountPaise: amount });
            } catch (err) {
                await run(`UPDATE returns SET status = 'approved', updated_at = now() WHERE id = $1`, [id]);
                console.error(`Return refund failed for ${id}:`, err.message);
                notifySlackError(`return refund failed (return ${id}, order #${row.shopify_order_number})`, err).catch(() => {});
                return res.status(502).json({ error: 'Razorpay refused the refund. Nothing has been charged back.' });
            }
        }

        res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('admin return action failed:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
