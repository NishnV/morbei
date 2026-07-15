import { Router } from 'express';
import db from '../db/sqlite.js';
import { sendContactNotification } from '../services/email.js';

const router = Router();

// POST /api/contact — save submission and email store
router.post('/', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;
        if (!name?.trim() || !email?.trim() || !message?.trim()) {
            return res.status(400).json({ error: 'name, email and message are required' });
        }

        db.prepare(
            `INSERT INTO contact_submissions (name, email, subject, message) VALUES (?, ?, ?, ?)`
        ).run(name.trim(), email.trim(), subject?.trim() || '', message.trim());

        // Non-blocking email — don't let email failure break the response
        sendContactNotification({ name, email, subject, message }).catch(err =>
            console.error('Contact email error:', err.message)
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/contact/newsletter — subscribe email
router.post('/newsletter', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

        try {
            db.prepare(`INSERT INTO newsletter (email) VALUES (?)`).run(email.trim().toLowerCase());
        } catch (e) {
            // UNIQUE constraint — already subscribed, treat as success
            if (!e.message.includes('UNIQUE')) throw e;
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
