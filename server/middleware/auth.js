import jwt from 'jsonwebtoken';
import { get } from '../db/pg.js';

// This token authorises payments, refunds and order history. It lives in
// localStorage (readable by any XSS) and logout can only delete the client's
// copy — the server has no idea it happened. 30 days was far too long a window
// for a bearer token that can move money.
const TOKEN_TTL = '7d';

/**
 * Verify the bearer token and load the caller.
 *
 * Checks the token's version against the user's current `token_version`, which
 * is what makes logout and "sign out everywhere" actually revoke access rather
 * than just clearing localStorage. Costs one indexed primary-key lookup per
 * authenticated request — cheap at this volume, and the alternative is a token
 * that stays valid for a week after the user believes they signed out.
 */
export async function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    let payload;
    try {
        payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const user = await get('SELECT id, email, token_version FROM users WHERE id = $1', [payload.id]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        // Tokens issued before this file existed have no `tv` claim; treat them
        // as version 0 so existing sessions survive the deploy rather than
        // logging every customer out mid-checkout.
        const tokenVersion = payload.tv ?? 0;
        if (tokenVersion !== user.token_version) {
            return res.status(401).json({ error: 'Session ended, please sign in again' });
        }
        req.user = { id: user.id, email: user.email };
        next();
    } catch (err) {
        // A database blip must not read as an auth failure — that would log
        // people out and, worse, hide the real problem behind a 401.
        console.error('authenticate: user lookup failed:', err.message);
        return res.status(503).json({ error: 'Service temporarily unavailable, please retry' });
    }
}

export function signToken(userId, email, tokenVersion = 0) {
    return jwt.sign(
        { id: userId, email, tv: tokenVersion },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_TTL }
    );
}
