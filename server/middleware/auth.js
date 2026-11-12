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
async function resolveUser(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return { status: 401, error: 'Authentication required' };
    }

    let payload;
    try {
        payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch {
        return { status: 401, error: 'Invalid or expired token' };
    }

    try {
        const user = await get('SELECT id, email, token_version FROM users WHERE id = $1', [payload.id]);
        if (!user) {
            return { status: 401, error: 'Invalid or expired token' };
        }
        // Tokens issued before this file existed have no `tv` claim; treat them
        // as version 0 so existing sessions survive the deploy rather than
        // logging every customer out mid-checkout.
        const tokenVersion = payload.tv ?? 0;
        if (tokenVersion !== user.token_version) {
            return { status: 401, error: 'Session ended, please sign in again' };
        }
        // gsid rides on the token rather than the users row: it identifies the
        // session, not the person, and a person can have several.
        return { user: { id: user.id, email: user.email, gsid: payload.gsid || null } };
    } catch (err) {
        // A database blip must not read as an auth failure — that would log
        // people out and, worse, hide the real problem behind a 401.
        console.error('authenticate: user lookup failed:', err.message);
        return { status: 503, error: 'Service temporarily unavailable, please retry' };
    }
}

export async function authenticate(req, res, next) {
    const result = await resolveUser(req);
    if (result.user) {
        req.user = result.user;
        return next();
    }
    return res.status(result.status).json({ error: result.error });
}

/**
 * Identify the caller when they are signed in, and carry on when they are not.
 *
 * For the return form, which serves both: a signed-in shopper picks from their
 * own orders and is authenticated outright, while a guest — who by definition
 * has no password, having never been asked for one — proves themselves with
 * the order number and the email that placed it. A failed or expired token
 * degrades to the guest path rather than blocking, because someone chasing a
 * refund should never be stopped by a stale session.
 */
export async function optionalAuthenticate(req, _res, next) {
    const result = await resolveUser(req);
    if (result.user) req.user = result.user;
    next();
}

/**
 * Issue a session.
 *
 * `gsid` marks a guest session and scopes it. A guest session is handed out on
 * an email alone — nobody proves they own the address — so it must not be able
 * to reach orders it did not place. Orders created while holding one are
 * stamped with the same id, and the order routes filter on it.
 *
 * A Shopify login passes no gsid: that caller proved who they are, so they see
 * everything on the account, including guest orders placed earlier.
 */
export function signToken(userId, email, tokenVersion = 0, guestSessionId = null) {
    return jwt.sign(
        { id: userId, email, tv: tokenVersion, ...(guestSessionId ? { gsid: guestSessionId } : {}) },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_TTL }
    );
}
