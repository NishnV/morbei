import { Router } from 'express';
import { run, all } from '../db/pg.js';

const router = Router();

/**
 * Funnel events, recorded first-party.
 *
 * Unauthenticated by necessity — the whole point is to measure people who
 * have not signed in. That makes it the one write endpoint a stranger can
 * reach, so it is deliberately narrow: a fixed list of event names, every
 * string truncated, no free text stored, and nothing here can affect an
 * order. The worst a flood achieves is noise in a chart.
 */

// Meta's standard event names, which are also the funnel we report on.
// Anything else is dropped rather than stored, so a typo in a future caller
// shows up as a missing number instead of a new row nobody queries.
const ALLOWED = new Set(['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']);

const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null);

router.post('/', async (req, res) => {
    // Answer before writing. This is called from sendBeacon during page
    // unload; the browser does not wait for the response and the shopper
    // must never wait for analytics.
    res.status(204).end();

    try {
        const { event, path, visitorId, sessionId, value, currency, productHandle, eventId } = req.body || {};
        if (!ALLOWED.has(event)) return;

        await run(
            `INSERT INTO site_events
               (event, path, visitor_id, session_id, product_handle, value_rupees, currency, event_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                event,
                str(path, 200),
                str(visitorId, 64),
                str(sessionId, 64),
                str(productHandle, 120),
                Number.isFinite(value) && value >= 0 && value < 10_000_000 ? value : null,
                str(currency, 8),
                str(eventId, 80),
            ]
        );
    } catch (err) {
        // Never alerts. A dropped analytics row is not worth waking anyone.
        console.error('site_events insert failed:', err.message);
    }
});

/**
 * The funnel, aggregated. Purchases come from the orders table rather than
 * from site_events: a paid order is a fact, while a Purchase beacon is a
 * request that may never have been sent.
 */
export async function funnelSummary(days = 7) {
    const since = `now() - interval '${Number(days)} days'`;

    const [events, orders, daily, products] = await Promise.all([
        all(`SELECT event,
                    COUNT(*)::int                      AS events,
                    COUNT(DISTINCT session_id)::int    AS sessions,
                    COUNT(DISTINCT visitor_id)::int    AS visitors
             FROM site_events
             WHERE created_at > ${since}
             GROUP BY event`),
        // razorpay_payment_id, not status: payment is captured before
        // fulfilment runs, and a fulfilment that failed sets status back to
        // 'pending'. Those are real purchases and must not vanish from the
        // conversion rate because Shopify had a bad minute.
        all(`SELECT COUNT(*)::int AS orders,
                    COALESCE(SUM(total_amount), 0)::bigint AS revenue_paise
             FROM orders
             WHERE created_at > ${since} AND razorpay_payment_id IS NOT NULL
               AND is_test = false
               -- A free replacement carries the parent's payment id so the
               -- returns lookup can find it. It is not a second sale.
               AND replacement_for_order_id IS NULL`),
        all(`SELECT date_trunc('day', created_at)::date AS day,
                    COUNT(DISTINCT session_id)::int     AS sessions,
                    COUNT(*) FILTER (WHERE event = 'ViewContent')::int      AS view_content,
                    COUNT(*) FILTER (WHERE event = 'AddToCart')::int        AS add_to_cart,
                    COUNT(*) FILTER (WHERE event = 'InitiateCheckout')::int AS initiate_checkout
             FROM site_events
             WHERE created_at > ${since}
             GROUP BY 1 ORDER BY 1`),
        // Which products pull interest, and which of them convert it. A
        // product with many views and no adds is a different problem from one
        // nobody opens: the first is the page or the price, the second is the
        // photograph or where it sits in the grid.
        all(`SELECT product_handle,
                    COUNT(*) FILTER (WHERE event = 'ViewContent')::int                   AS views,
                    COUNT(DISTINCT session_id) FILTER (WHERE event = 'ViewContent')::int AS view_sessions,
                    COUNT(*) FILTER (WHERE event = 'AddToCart')::int                     AS adds
             FROM site_events
             WHERE created_at > ${since} AND product_handle IS NOT NULL
             GROUP BY product_handle
             HAVING COUNT(*) FILTER (WHERE event = 'ViewContent') > 0
                 OR COUNT(*) FILTER (WHERE event = 'AddToCart') > 0
             ORDER BY views DESC, adds DESC
             LIMIT 25`),
    ]);

    const by = Object.fromEntries(events.map((r) => [r.event, r]));
    const sessions = Math.max(...events.map((r) => r.sessions), 0);
    const visitors = Math.max(...events.map((r) => r.visitors), 0);
    const purchases = orders[0]?.orders || 0;

    const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0);

    return {
        days: Number(days),
        sessions,
        visitors,
        pageView: by.PageView?.events || 0,
        viewContent: by.ViewContent?.events || 0,
        viewContentSessions: by.ViewContent?.sessions || 0,
        addToCart: by.AddToCart?.events || 0,
        addToCartSessions: by.AddToCart?.sessions || 0,
        initiateCheckout: by.InitiateCheckout?.events || 0,
        initiateCheckoutSessions: by.InitiateCheckout?.sessions || 0,
        purchases,
        revenueRupees: Math.round((orders[0]?.revenue_paise || 0) / 100),
        // Sessions, not visitors: the usual e-commerce convention, and the one
        // the step-to-step rates below are consistent with.
        purchaseConversionRate: pct(purchases, sessions),
        stepConversion: {
            sessionToProduct: pct(by.ViewContent?.sessions || 0, sessions),
            productToCart: pct(by.AddToCart?.sessions || 0, by.ViewContent?.sessions || 0),
            cartToCheckout: pct(by.InitiateCheckout?.sessions || 0, by.AddToCart?.sessions || 0),
            checkoutToPurchase: pct(purchases, by.InitiateCheckout?.sessions || 0),
        },
        daily,
        products: products.map((p) => ({
            handle: p.product_handle,
            views: p.views,
            viewSessions: p.view_sessions,
            adds: p.adds,
            addRate: pct(p.adds, p.views),
        })),
    };
}

export default router;
