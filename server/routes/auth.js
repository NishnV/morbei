import { Router } from 'express';
import { get, run } from '../db/pg.js';
import { signToken, authenticate } from '../middleware/auth.js';
import { getCustomerByToken, createCustomerViaStorefront } from '../services/shopify-storefront.js';
import { createCustomer } from '../services/shopify-admin.js';
import { notifySlackError } from '../services/slack.js';
import { domainAcceptsMail, suggestDomain } from '../services/email-domain.js';
import { sendVerificationCode, sendAccountWelcome } from '../services/email.js';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

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

/**
 * Email verification by code.
 *
 * A customer mistyped her address at checkout. The order was paid, every
 * message about it went nowhere, and nobody knew until she wrote in on
 * Instagram. The MX check catches a domain that cannot receive mail; the
 * typo check catches a near-miss of a common one. Neither catches a valid
 * address belonging to somebody else, and only a code sent to the address
 * and typed back can.
 *
 * Verified addresses are remembered, so a returning customer does this once
 * and never again. That is what makes it bearable in front of a payment.
 *
 * The obvious danger of an unauthenticated "send mail to this address"
 * endpoint is that it is a free way to post mail to strangers, and a free
 * way to burn our sending quota. Hence the limits below, which live in
 * Postgres rather than in memory — a limit that forgets itself on every
 * deploy is not a limit — on top of the per-IP limiter in index.js.
 */
const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;      // per code, then it is destroyed
const CODE_RESEND_SECONDS = 60;   // between sends to one address
const CODE_MAX_PER_WINDOW = 5;    // sends to one address per hour
const CODE_WINDOW_MINUTES = 60;

/**
 * Hashed, not stored plainly, and keyed to the server secret so a leaked
 * table alone is not a book of working codes.
 */
function hashCode(email, code) {
    return crypto.createHmac('sha256', process.env.JWT_SECRET)
        .update(`${email}:${code}`)
        .digest('hex');
}

/** Has this address already proved it can receive mail? */
async function isVerified(email) {
    return Boolean(await get('SELECT 1 FROM verified_emails WHERE email = $1', [email]));
}

/**
 * Proof that whoever is asking typed back a code sent to this address.
 *
 * verified_emails cannot be that proof. It is a deliverability record — it
 * says mail sent here arrives — and it is permanent and shared: once the
 * owner of an address has verified it at checkout, every later caller is
 * "verified" too. /signup used to accept it, which meant anyone who knew a
 * guest customer's email could register that address with a password of
 * their own choosing, sign in, and be handed the guest's orders, address and
 * phone number, with the ability to cancel what had not shipped.
 *
 * So an accepted code now comes back with a short-lived signed token naming
 * the address, and creating an account requires it. It is held by the
 * browser that entered the code and by nobody else.
 *
 * Signed with a key derived from JWT_SECRET rather than JWT_SECRET itself,
 * so a proof can never be presented as a session token or the reverse.
 */
const EMAIL_PROOF_TTL = '2h';
const emailProofSecret = () => `${process.env.JWT_SECRET}:email-proof`;

function signEmailProof(email) {
    return jwt.sign({ email, typ: 'email-proof' }, emailProofSecret(), { expiresIn: EMAIL_PROOF_TTL });
}

function emailProofValid(proof, email) {
    if (typeof proof !== 'string' || !proof) return false;
    try {
        const payload = jwt.verify(proof, emailProofSecret());
        return payload.typ === 'email-proof' && payload.email === email;
    } catch {
        return false; // expired, tampered with, or not a proof at all
    }
}

/**
 * POST /api/auth/email/code — send a code, or explain why not.
 *
 * Answers identically whether or not the address is already known to us. It
 * would otherwise be a way to ask "does this person shop here", which is not
 * a question a stranger gets to ask about a customer.
 */
router.post('/email/code', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        // Already proved — the caller can go straight on. No mail is sent,
        // which is both the point of remembering and one fewer thing to abuse.
        //
        // Not for signup. Remembering is fine for a guest checkout, whose
        // session can only reach what it buys; an account is the whole
        // address, so it needs a code from whoever is asking now. The
        // per-address limits below apply to these sends like any other.
        const forSignup = req.body?.purpose === 'signup';
        if (!forSignup && (await isVerified(email))) return res.json({ verified: true });

        if (!(await domainAcceptsMail(email))) {
            return res.status(400).json({
                error: 'We could not find a mail server for that address — please check the spelling.',
            });
        }
        // Only after the MX check: a domain that cannot receive mail is
        // already definitively wrong, and guessing at it invents an intent
        // nobody expressed.
        const suggestion = suggestDomain(email);
        if (suggestion) {
            const local = email.slice(0, email.lastIndexOf('@'));
            return res.status(400).json({
                error: `Did you mean ${local}@${suggestion}?`,
                suggestion: `${local}@${suggestion}`,
            });
        }

        const existing = await get('SELECT * FROM email_codes WHERE email = $1', [email]);
        if (existing) {
            const sinceSent = (Date.now() - new Date(existing.last_sent_at)) / 1000;
            if (sinceSent < CODE_RESEND_SECONDS) {
                return res.status(429).json({
                    error: `Please wait ${Math.ceil(CODE_RESEND_SECONDS - sinceSent)} seconds before asking for another code.`,
                    retryAfter: Math.ceil(CODE_RESEND_SECONDS - sinceSent),
                });
            }
            const windowAge = (Date.now() - new Date(existing.window_started_at)) / 60000;
            if (windowAge < CODE_WINDOW_MINUTES && existing.sent_count >= CODE_MAX_PER_WINDOW) {
                return res.status(429).json({
                    error: 'Too many codes requested for this address. Please try again later.',
                });
            }
        }

        // randomInt, not Math.random: this is a credential, however short.
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const windowExpired = !existing
            || (Date.now() - new Date(existing.window_started_at)) / 60000 >= CODE_WINDOW_MINUTES;

        await run(
            `INSERT INTO email_codes (email, code_hash, expires_at)
             VALUES ($1, $2, now() + make_interval(mins => $3::int))
             ON CONFLICT (email) DO UPDATE SET
                code_hash = EXCLUDED.code_hash,
                expires_at = EXCLUDED.expires_at,
                -- A new code starts its own attempt budget; the send budget
                -- carries on, or restarts if the hour has rolled over.
                attempts = 0,
                sent_count = CASE WHEN $4 THEN 1 ELSE email_codes.sent_count + 1 END,
                window_started_at = CASE WHEN $4 THEN now() ELSE email_codes.window_started_at END,
                last_sent_at = now()`,
            [email, hashCode(email, code), CODE_TTL_MINUTES, windowExpired]
        );

        try {
            await sendVerificationCode(email, code, CODE_TTL_MINUTES);
        } catch (err) {
            // The row is left in place: it records the attempt against the
            // limits, and the customer can ask again in a minute. Telling
            // them it worked when it did not would leave them staring at an
            // empty inbox.
            console.error(`Verification code to ${email} failed:`, err.message);
            return res.status(502).json({ error: 'We could not send the code. Please try again in a moment.' });
        }

        return res.json({ sent: true, expiresInMinutes: CODE_TTL_MINUTES });
    } catch (err) {
        console.error('verification code error:', err);
        notifySlackError('sending a verification code failed', err).catch(() => {});
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
});

/** POST /api/auth/email/verify — hand the code back. */
router.post('/email/verify', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const code = String(req.body?.code || '').trim();
        if (!EMAIL_RE.test(email) || !/^[0-9]{6}$/.test(code)) {
            return res.status(400).json({ error: 'Enter the six-digit code from your email.' });
        }

        // For signup the code is always checked, even for an address already
        // on record: the answer wanted is "did this caller receive the code",
        // not "has anyone ever". No proof is issued on this shortcut.
        const forSignup = req.body?.purpose === 'signup';
        if (!forSignup && (await isVerified(email))) return res.json({ verified: true });

        const row = await get('SELECT * FROM email_codes WHERE email = $1', [email]);
        if (!row || new Date(row.expires_at) < new Date()) {
            return res.status(400).json({ error: 'That code has expired. Ask for a new one.' });
        }

        // Counted before it is checked. Counting afterwards, or only on
        // failure, lets a client that hangs up mid-request guess for free.
        const used = await get(
            `UPDATE email_codes SET attempts = attempts + 1
              WHERE email = $1 RETURNING attempts`,
            [email]
        );
        if (used.attempts > CODE_MAX_ATTEMPTS) {
            await run('DELETE FROM email_codes WHERE email = $1', [email]);
            return res.status(429).json({ error: 'Too many wrong codes. Ask for a new one.' });
        }

        const expected = Buffer.from(row.code_hash, 'hex');
        const given = Buffer.from(hashCode(email, code), 'hex');
        // Length is fixed by the hash, so the compare cannot throw; it is
        // timing-safe because a six-digit space is small enough that leaking
        // the position of the first wrong digit would genuinely matter.
        if (!crypto.timingSafeEqual(expected, given)) {
            return res.status(400).json({
                error: 'That code is not right.',
                attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - used.attempts),
            });
        }

        await run(
            `INSERT INTO verified_emails (email) VALUES ($1)
             ON CONFLICT (email) DO NOTHING`,
            [email]
        );
        await run('DELETE FROM email_codes WHERE email = $1', [email]);
        // The proof is issued here and only here — on a code that was
        // actually checked and matched.
        return res.json({ verified: true, proof: signEmailProof(email) });
    } catch (err) {
        console.error('verification error:', err);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
});

/**
 * POST /api/auth/signup — create the customer account.
 *
 * Moved off the browser, where it called Shopify's Storefront customerCreate
 * directly, for two reasons.
 *
 * Shopify sends its own "customer account welcome" on every storefront
 * account creation and there is no switch for it on a non-Plus plan, so a new
 * customer's first email from the shop was Shopify's default template
 * pointing at the myshopify domain. The Admin API takes send_email_welcome,
 * so creating the account here means ours is the only welcome sent — it goes
 * out from /shopify-login the moment the new account signs in.
 *
 * And the email check was not a check. While the mutation ran in the browser,
 * the verification step in front of it was decoration: anyone could call
 * Shopify from a console and register an address they had never proved. The
 * only route to an account now runs through here, and here it is refused.
 *
 * The password is relayed to Shopify and never stored by us. Our users table
 * holds '!shopify' in that column precisely so there is nothing to leak.
 */
router.post('/signup', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        const firstName = String(req.body?.firstName || '').trim().slice(0, 80);
        const lastName = String(req.body?.lastName || '').trim().slice(0, 80);
        const phone = String(req.body?.phone || '').trim().slice(0, 40);

        if (!EMAIL_RE.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Please choose a password of at least 8 characters.' });
        }
        if (!firstName || !lastName) {
            return res.status(400).json({ error: 'Please enter your full name (first and last).' });
        }
        if (!(await domainAcceptsMail(email))) {
            return res.status(400).json({
                error: 'We could not find a mail server for that address — please check the spelling.',
            });
        }
        const suggestion = suggestDomain(email);
        if (suggestion) {
            const local = email.slice(0, email.lastIndexOf('@'));
            return res.status(400).json({
                error: `Did you mean ${local}@${suggestion}?`,
                suggestion: `${local}@${suggestion}`,
            });
        }
        // The enforcement, not a hint. 428 so the client shows the code box
        // rather than an error, the same answer /guest gives.
        //
        // A proof from this caller, not the shared verified_emails record —
        // see signEmailProof for why that record was never enough here.
        if (!emailProofValid(req.body?.emailProof, email)) {
            return res.status(428).json({ error: 'emailNotVerified' });
        }

        const details = {
            email, password, firstName, lastName,
            phone: phone || null,
            acceptsMarketing: req.body?.acceptsMarketing === true,
        };

        try {
            try {
                await createCustomer(details);
            } catch (err) {
                // 403 means the write_customers scope is not granted — never
                // added, or dropped by a reinstall, which has happened on this
                // store before. Falling back keeps people able to register;
                // the only thing lost is the suppression, so they get
                // Shopify's welcome as well as ours until it is restored.
                //
                // Refusing instead would turn a missing scope into "nobody can
                // open an account", which is a far worse outcome than a
                // duplicate email.
                if (err.status !== 403) throw err;
                console.error('write_customers missing — falling back to the Storefront API:', err.message);
                notifySlackError(
                    'Signups are falling back to the Storefront API: the Shopify app is missing '
                    + 'write_customers, so new customers are getting Shopify\'s welcome email too',
                    err
                ).catch(() => {});
                await createCustomerViaStorefront(details);
            }
        } catch (err) {
            // Shopify's own wording is not written for customers, so the case
            // worth distinguishing is mapped and the rest stay generic.
            if (/has already been taken|already exists|TAKEN/i.test(err.message)
                || err.shopifyCodes?.includes('TAKEN')) {
                return res.status(409).json({ error: 'accountExists' });
            }
            throw err;
        }

        // No session is issued here. The browser signs in through Shopify
        // exactly as it always has, which keeps one path to a customer token
        // instead of two, and that sign-in is what sends our welcome.
        return res.status(201).json({ created: true });
    } catch (err) {
        console.error('signup error:', err);
        notifySlackError('customer signup failed', err).catch(() => {});
        return res.status(500).json({ error: 'Could not create your account. Please try again.' });
    }
});

router.post('/guest', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        // Shape is not deliverability. An order once arrived addressed to a
        // mistyped "@ail.com", which publishes no MX record, so every message
        // for it — confirmation, shipping, tracking — went nowhere and nobody
        // knew until the customer wrote in on Instagram. A guest has no other
        // way to hear from us, so this is the last chance to catch it.
        if (!(await domainAcceptsMail(email))) {
            return res.status(400).json({
                error: 'We could not find a mail server for that address — please check the spelling.',
            });
        }
        // And the address has to have proved itself. A domain that can
        // receive mail says nothing about whether this particular mailbox
        // exists or belongs to the person typing it, which is how an order
        // was once paid for and then addressed into the void. 428, not 400:
        // nothing is wrong with the request, a step is simply missing, and
        // the client uses that to put the code box on screen rather than
        // showing an error.
        if (!(await isVerified(email))) {
            return res.status(428).json({ error: 'emailNotVerified' });
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

        // Scoped to this session, not to the address. Nobody proved they own
        // the email, so the token must only reach orders placed while holding
        // it — see signToken and the order routes. Previously this returned a
        // full session for whatever row the email resolved to, which handed
        // anyone who knew a past guest customer's address their order history,
        // their shipping details, and the ability to cancel and refund.
        const guestSessionId = crypto.randomUUID();
        const token = signToken(user.id, user.email, user.token_version, guestSessionId);
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

        // Our own welcome, for an account we have not welcomed before.
        //
        // Here rather than on the client because this endpoint has already
        // validated a real Shopify customer token: the browser cannot ask for
        // a welcome email to an address it does not own, which an endpoint
        // the client called directly would allow.
        //
        // The UPDATE is the claim. Two tabs finishing signup together both
        // reach this line, and only the one that flips the column sends —
        // the same shape as every other send-once in this codebase.
        const claimed = await run(
            `UPDATE users SET welcomed_at = now() WHERE id = $1 AND welcomed_at IS NULL`,
            [user.id]
        );
        if (claimed.rowCount > 0) {
            // Not awaited: a mail failure must not turn a successful login
            // into an error. The column stays set either way — a welcome is
            // not worth retrying into a possible duplicate.
            sendAccountWelcome({ email: user.email, firstName: customer.firstName })
                .catch((err) => console.error(`Welcome email to ${user.email} failed:`, err.message));
        }

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
