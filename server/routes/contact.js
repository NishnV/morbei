import { Router } from 'express';
import { run } from '../db/pg.js';
import { sendContactNotification, sendRestockRequest } from '../services/email.js';
import { notifySlackError } from '../services/slack.js';

const router = Router();

// POST /api/contact — save submission and email store
router.post('/', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;
        if (!name?.trim() || !email?.trim() || !message?.trim()) {
            return res.status(400).json({ error: 'name, email and message are required' });
        }

        await run(
            'INSERT INTO contact_submissions (name, email, subject, message) VALUES ($1, $2, $3, $4)',
            [name.trim(), email.trim(), subject?.trim() || '', message.trim()]
        );

        // Non-blocking email — don't let email failure break the response
        sendContactNotification({ name, email, subject, message }).catch(err => {
            console.error('Contact email error:', err.message);
            notifySlackError('contact notification email failed', err).catch(() => {});
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
        const { email } = req.body;
        if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

        // Already subscribed → conflict is silently ignored, treat as success
        await run(
            'INSERT INTO newsletter (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
            [email.trim().toLowerCase()]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        notifySlackError('newsletter subscribe failed', err).catch(() => {});
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
