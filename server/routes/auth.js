import { Router } from 'express';
import { get, run } from '../db/pg.js';
import { signToken, authenticate } from '../middleware/auth.js';
import { getCustomerByToken } from '../services/shopify-storefront.js';
import { notifySlackError } from '../services/slack.js';

const router = Router();

// Exchange a Shopify customer access token for a backend JWT.
// The frontend authenticates with Shopify (login/signup/password reset all live
// there); this bridge gives it access to our own APIs (payment, orders, wishlist).
/**
 * A checkout session for someone who has not signed in.
 *
 * Paying needs a backend JWT, and until now the only way to get one was to
 * exchange a Shopify customer token — so checkout redirected anyone without
 * an account to the login page, which is where the funnel was losing people.
 *
 * The risk this has to avoid is obvious: an endpoint that mints a session for
 * any address typed into a form is an account-takeover vector. Two things
 * stop that here.
 *
 * First, an address that already belongs to a real account is refused. The
 * caller is told to sign in instead, so a guest session can never be issued
 * for someone else's existing account.
 *
 * Second, when a guest address is later claimed by a real Shopify login, that
 * login bumps token_version (see shopify-login below), which invalidates every
 * guest token ever issued for it. So the worst case — someone types a
 * stranger's unregistered address — ends the moment the real owner signs in,
 * and until then the session can only see orders that session itself placed.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST_PASSWORD = '!guest';

router.post('/guest', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        const firstName = String(req.body?.firstName || '').trim().slice(0, 80);
        const lastName = String(req.body?.lastName || '').trim().slice(0, 80);
        const phone = String(req.body?.phone || '').trim().slice(0, 40);

        const existing = await get('SELECT password FROM users WHERE email = $1', [email]);
        if (existing && existing.password !== GUEST_PASSWORD) {
            // 409, not 401: nothing is wrong with the request, the address just
            // belongs to someone. The client turns this into "you have an
            // account — sign in" rather than an error.
            return res.status(409).json({ error: 'accountExists' });
        }

        // Same upsert shape as shopify-login, for the same reason: two tabs
        // finishing checkout at once must not race on the email unique index.
        const user = await get(
            `INSERT INTO users (email, password, first_name, last_name, phone)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (email) DO UPDATE SET
                first_name = COALESCE(NULLIF(EXCLUDED.first_name, ''), users.first_name),
                last_name = COALESCE(NULLIF(EXCLUDED.last_name, ''), users.last_name),
                phone = COALESCE(NULLIF(EXCLUDED.phone, ''), users.phone)
             RETURNING *`,
            [email, GUEST_PASSWORD, firstName, lastName, phone]
        );

        const token = signToken(user.id, user.email, user.token_version);
        res.json({ token, user: { id: user.id, email: user.email, firstName, lastName, guest: true } });
    } catch (err) {
        console.error('guest session error:', err);
        notifySlackError('guest checkout session failed', err).catch(() => {});
        res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
});

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
                phone = COALESCE(NULLIF(EXCLUDED.phone, ''), users.phone),
                -- Claiming a row that was only ever a guest: take ownership of
                -- it and invalidate every guest token issued against it. The
                -- token signed below carries the bumped version, so this
                -- session stays valid and only the older ones die.
                password = CASE WHEN users.password = '!guest' THEN '!shopify' ELSE users.password END,
                token_version = CASE WHEN users.password = '!guest'
                                     THEN users.token_version + 1
                                     ELSE users.token_version END
             RETURNING *`,
            [customer.email, '!shopify', customer.firstName || '', customer.lastName || '', customer.phone || '']
        );

        const token = signToken(user.id, user.email, user.token_version);
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

// Revoke every backend token issued to the caller.
// Clearing localStorage on the client does nothing to a bearer token that was
// already copied elsewhere — bumping token_version is what actually ends the
// session. Idempotent and safe to call with an already-expired token.
router.post('/logout', authenticate, async (req, res) => {
    try {
        await run('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('logout error:', err);
        notifySlackError('logout failed', err).catch(() => {});
        res.status(500).json({ error: 'Could not sign out. Please try again.' });
    }
});

export default router;
