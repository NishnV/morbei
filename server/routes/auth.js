import { Router } from 'express';
import { get } from '../db/pg.js';
import { signToken } from '../middleware/auth.js';
import { getCustomerByToken } from '../services/shopify-storefront.js';
import { notifySlackError } from '../services/slack.js';

const router = Router();

// Exchange a Shopify customer access token for a backend JWT.
// The frontend authenticates with Shopify (login/signup/password reset all live
// there); this bridge gives it access to our own APIs (payment, orders, wishlist).
router.post('/shopify-login', async (req, res) => {
    try {
        const { customerAccessToken } = req.body;
        if (!customerAccessToken) {
            return res.status(400).json({ error: 'customerAccessToken is required' });
        }

        const customer = await getCustomerByToken(customerAccessToken);
        if (!customer?.email) {
            return res.status(401).json({ error: 'Invalid or expired Shopify session' });
        }

        // Upsert keyed by email — atomic, so two concurrent exchanges for the
        // same brand-new account (e.g. signup + an immediate checkout retry)
        // can't race a select-then-insert and collide on the email unique constraint.
        const user = await get(
            `INSERT INTO users (email, password, first_name, last_name, phone)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (email) DO UPDATE SET
                first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
                last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), users.last_name),
                phone = COALESCE(NULLIF(EXCLUDED.phone, ''), users.phone)
             RETURNING *`,
            [customer.email, '!shopify', customer.firstName || '', customer.lastName || '', customer.phone || '']
        );

        const token = signToken(user.id, user.email);
        res.json({
            token,
            user: { id: user.id, email: user.email, firstName: customer.firstName, lastName: customer.lastName },
        });
    } catch (err) {
        console.error('shopify-login error:', err);
        notifySlackError('shopify-login failed', err).catch(() => {});
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

export default router;
