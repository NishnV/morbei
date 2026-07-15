import { Router } from 'express';
import { get, run } from '../db/pg.js';
import { signToken } from '../middleware/auth.js';
import { getCustomerByToken } from '../services/shopify-storefront.js';

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

        // Find or create the local user record keyed by email
        let user = await get('SELECT * FROM users WHERE email = $1', [customer.email]);
        if (!user) {
            user = await get(
                `INSERT INTO users (email, password, first_name, last_name, phone)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [customer.email, '!shopify', customer.firstName || '', customer.lastName || '', customer.phone || '']
            );
        } else {
            // Keep name/phone in sync with Shopify
            await run(
                'UPDATE users SET first_name = $1, last_name = $2, phone = $3 WHERE id = $4',
                [customer.firstName || user.first_name, customer.lastName || user.last_name, customer.phone || user.phone, user.id]
            );
        }

        const token = signToken(user.id, user.email);
        res.json({
            token,
            user: { id: user.id, email: user.email, firstName: customer.firstName, lastName: customer.lastName },
        });
    } catch (err) {
        console.error('shopify-login error:', err);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

export default router;
