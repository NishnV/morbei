import { Router } from 'express';
import crypto from 'crypto';
import { run } from '../db/pg.js';
import { sendContactNotification, sendRestockRequest, sendNewsletterWelcome } from '../services/email.js';
import { subscribeToMarketing, setMarketingConsentRevoked } from '../services/shopify-admin.js';
import { notifySlackError, notifySlackContact } from '../services/slack.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321

/**
 * Unsubscribe links must work from an email client with no session, so the
 * token is an HMAC of the address rather than a stored secret — no lookup
 * table, nothing to leak, and it can't be guessed or enumerated.
 */
function unsubscribeToken(email) {
    return crypto
        .createHmac('sha256', process.env.JWT_SECRET)
        .update(`unsubscribe:${email}`)
        .digest('hex')
        .slice(0, 32);
}

function unsubscribeUrl(email) {
    const base = (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
    if (!base) return null;
    return `${base}/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubscribeToken(email)}`;
}

// POST /api/contact — save submission and email store
router.post('/', async (req, res) => {
    try {
        const { name, email, subject, message, phone } = req.body;
        if (!name?.trim() || !email?.trim() || !message?.trim()) {
            return res.status(400).json({ error: 'name, email and message are required' });
        }
        // Optional, and capped rather than validated: people write numbers in
        // every shape there is, and rejecting a reachable one to enforce a
        // format would cost more than it saves. The bound is what matters.
        const contactPhone = String(phone || '').trim().slice(0, 40);

        await run(
            'INSERT INTO contact_submissions (name, email, subject, message, phone) VALUES ($1, $2, $3, $4, $5)',
            [name.trim(), email.trim(), subject?.trim() || '', message.trim(), contactPhone]
        );

        const submission = { name, email, subject, message, phone: contactPhone };

        // Slack is the delivery path. Outbound SMTP is blocked from the host,
        // and the alert that reported it arrived over this same webhook — so
        // this is the one route out of the box known to work.
        notifySlackContact(submission).then(delivered => {
            if (!delivered) console.error('Contact Slack delivery failed — message is still in contact_submissions');
        });

        // Email stays as a second copy for whenever SMTP is reachable again.
        // Its failure is logged, not alerted: Slack already carried the
        // message, and an alert per submission would be pure noise.
        sendContactNotification(submission).catch(err => {
            console.error('Contact email error:', err.message);
        });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        notifySlackError('contact form submission failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/contact/newsletter — subscribe email
router.post('/newsletter', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        // Previously any non-empty string was stored — the sibling
        // /notify-stock route validated properly and this one didn't.
        if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        const source = String(req.body?.source || 'footer').slice(0, 40);

        // Local table is the durable consent log; Shopify is the marketing
        // system of record. Re-subscribing clears a previous opt-out.
        const inserted = await run(
            `INSERT INTO newsletter (email, source, consent_ip) VALUES ($1, $2, $3)
             ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL
             WHERE newsletter.unsubscribed_at IS NOT NULL`,
            [email, source, req.ip]
        );
        // rowCount 0 means the address was already actively subscribed.
        const isNew = inserted.rowCount > 0;

        // Both best-effort: a subscriber must never see an error because a
        // downstream marketing system was slow or unreachable.
        subscribeToMarketing(email).catch(err => {
            console.error('Shopify marketing sync failed:', err.message);
            notifySlackError('newsletter → Shopify sync failed', err).catch(() => {});
        });
        if (isNew) {
            sendNewsletterWelcome(email, unsubscribeUrl(email))
                .catch(err => console.error('Welcome email failed:', err.message));
        }

        res.json({ success: true, alreadySubscribed: !isNew });
    } catch (err) {
        console.error(err);
        notifySlackError('newsletter subscribe failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// GET /api/contact/unsubscribe — honour an unsubscribe link from an email.
// Unauthenticated by necessity: the recipient has no session in their mail
// client. The HMAC token proves they hold the link we sent.
router.get('/unsubscribe', async (req, res) => {
    try {
        const email = String(req.query.email || '').trim().toLowerCase();
        const token = String(req.query.token || '');
        if (!EMAIL_RE.test(email) || !token) {
            return res.status(400).json({ error: 'Invalid unsubscribe link' });
        }

        const expected = unsubscribeToken(email);
        const a = Buffer.from(token);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return res.status(400).json({ error: 'Invalid unsubscribe link' });
        }

        await run(
            `UPDATE newsletter SET unsubscribed_at = now() WHERE email = $1 AND unsubscribed_at IS NULL`,
            [email]
        );
        // Shopify holds the marketing consent that actually gates sending, so
        // reflect it there too — best-effort, the local flag is already set.
        setMarketingConsentRevoked(email).catch(err => {
            console.error('Shopify unsubscribe sync failed:', err.message);
            notifySlackError('newsletter unsubscribe → Shopify sync failed', err).catch(() => {});
        });

        res.json({ success: true, email });
    } catch (err) {
        console.error(err);
        notifySlackError('newsletter unsubscribe failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// POST /api/contact/notify-stock — request a back-in-stock notification.
// Unauthenticated (guests can ask too); covered by the contact rate limit.
router.post('/notify-stock', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const product = String(req.body?.product || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !product) {
            return res.status(400).json({ error: 'A valid email and product are required' });
        }

        await sendRestockRequest({ email, product });
        res.json({ success: true });
    } catch (err) {
        console.error('Restock request error:', err.message);
        notifySlackError('restock request failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});

export default router;
