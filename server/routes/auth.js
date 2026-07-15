import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/sqlite.js';
import { authenticate, signToken } from '../middleware/auth.js';

const router = Router();

// Sign up
router.post('/signup', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone } = req.body;
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'Email, password, first name and last name are required' });
        }

        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existing) return res.status(409).json({ error: 'Email already registered' });

        const hash = await bcrypt.hash(password, 12);
        const result = db.prepare(
            'INSERT INTO users (email, password, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?)'
        ).run(email, hash, firstName, lastName, phone || '');

        const token = signToken(result.lastInsertRowid, email);
        res.status(201).json({
            token,
            user: { id: result.lastInsertRowid, email, firstName, lastName, phone: phone || '' },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = signToken(user.id, user.email);
        res.json({
            token,
            user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, phone: user.phone },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current user profile
router.get('/me', authenticate, (req, res) => {
    const user = db.prepare('SELECT id, email, first_name, last_name, phone, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        createdAt: user.created_at,
    });
});

// Update profile
router.put('/me', authenticate, async (req, res) => {
    try {
        const { firstName, lastName, phone, password } = req.body;
        const updates = [];
        const params = [];

        if (firstName) { updates.push('first_name = ?'); params.push(firstName); }
        if (lastName) { updates.push('last_name = ?'); params.push(lastName); }
        if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
        if (password) {
            const hash = await bcrypt.hash(password, 12);
            updates.push('password = ?');
            params.push(hash);
        }

        if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
        params.push(req.user.id);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        const user = db.prepare('SELECT id, email, first_name, last_name, phone FROM users WHERE id = ?').get(req.user.id);
        res.json({ id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, phone: user.phone });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
