/**
 * Funnel tracking — one call, two destinations.
 *
 * track() sends each event to Meta (so campaigns can optimise for purchases
 * rather than clicks) and to our own /api/events (so we have numbers that are
 * actually ours). Both matter, for different reasons:
 *
 *   Meta's copy is what the ad algorithm learns from, but it is systematically
 *   undercounted — Safari's tracking prevention and ad blockers drop a large
 *   share of requests to facebook.com, and nothing we do here changes that.
 *
 *   Our copy goes to our own domain, which almost nothing blocks, so the
 *   dashboard's funnel is closer to what really happened. Purchase is the
 *   exception: the dashboard reads that from the orders table instead, because
 *   an order that was paid for is a fact and does not need a beacon to agree.
 *
 * Nothing here is allowed to break a page. Every call is wrapped, the beacon
 * is fire-and-forget, and a missing fbq is normal rather than an error.
 *
 * No personal data: event name, path, product handle, value. No email, no
 * address, no name. Those belong in the order, not in an analytics row.
 */

const VISITOR_KEY = 'morbei_vid';
const SESSION_KEY = 'morbei_sid';
const SESSION_SEEN_KEY = 'morbei_sid_at';
// The usual definition of a session: same visitor, no more than 30 minutes
// between actions. Without the idle check a tab left open overnight would
// report one session spanning two days.
const SESSION_IDLE_MS = 30 * 60 * 1000;

const uid = () => {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
};

function readWrite(storage, key, make) {
    try {
        const existing = storage.getItem(key);
        if (existing) return existing;
        const fresh = make();
        storage.setItem(key, fresh);
        return fresh;
    } catch {
        // Private mode, or storage disabled. The event still goes out; it just
        // cannot be tied to the visitor's other events.
        return null;
    }
}

function visitorId() {
    return readWrite(localStorage, VISITOR_KEY, uid);
}

function sessionId() {
    try {
        const last = Number(localStorage.getItem(SESSION_SEEN_KEY)) || 0;
        if (last && Date.now() - last > SESSION_IDLE_MS) localStorage.removeItem(SESSION_KEY);
        localStorage.setItem(SESSION_SEEN_KEY, String(Date.now()));
    } catch { /* ignore */ }
    return readWrite(localStorage, SESSION_KEY, uid);
}

const API = import.meta.env.VITE_API_URL || '';

/**
 * @param {string} event  A Meta standard event name: PageView, ViewContent,
 *                        AddToCart, InitiateCheckout, Purchase.
 * @param {object} [props] { value, currency, content_ids, content_name, ... }
 * @param {object} [options] { eventID } to deduplicate repeated sends, and
 *                          { skipMeta } for the initial page load, which the
 *                          inline snippet in index.html has already sent to
 *                          Meta — our own copy still needs recording.
 */
export function track(event, props = {}, options = {}) {
    try {
        if (!options.skipMeta && typeof window.fbq === 'function') {
            window.fbq('track', event, props, options.eventID ? { eventID: options.eventID } : undefined);
        }
    } catch { /* never let analytics break a render */ }

    try {
        const body = JSON.stringify({
            event,
            path: window.location.pathname,
            visitorId: visitorId(),
            sessionId: sessionId(),
            value: typeof props.value === 'number' ? props.value : null,
            currency: props.currency || null,
            productHandle: props.content_ids?.[0] || null,
            eventId: options.eventID || null,
        });
        // sendBeacon survives the page being unloaded, which matters when the
        // event is the last thing a shopper does before navigating away.
        if (navigator.sendBeacon) {
            navigator.sendBeacon(`${API}/events`, new Blob([body], { type: 'application/json' }));
        } else {
            fetch(`${API}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
                .catch(() => {});
        }
    } catch { /* ignore */ }
}
