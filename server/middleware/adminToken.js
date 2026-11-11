import crypto from 'node:crypto';

/**
 * Gate for the admin surface — the funnel and the returns queue.
 *
 * A shared secret rather than an account, because there is one operator and
 * building a second identity system to hold one password would be the wrong
 * trade. Refuses outright when the secret is unset: an admin page that opens
 * to everyone because a variable was forgotten is worse than one that does
 * not work.
 */
export function requireDashboardToken(req, res, next) {
    const expected = process.env.ADMIN_DASHBOARD_TOKEN;
    if (!expected) return res.status(503).json({ error: 'Dashboard is not configured' });

    const given = req.get('x-dashboard-token') || '';
    // Length first: timingSafeEqual throws on a mismatch rather than
    // returning false, so a one-character token would crash the route.
    if (given.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
