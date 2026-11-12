/**
 * Whether the visitor has agreed to third-party analytics.
 *
 * Two scripts needed gating. Meta's pixel ran from an inline tag in the
 * document head, and Microsoft Clarity — which records sessions, including
 * interaction with form fields — installed before React rendered. Both had
 * loaded and transmitted before a visitor saw anything on the page, so no
 * banner placed anywhere in the app could have made them lawful: under the
 * DPDP Act consent comes before processing, not after.
 *
 * The store's own funnel is deliberately outside this. /api/events holds no
 * personal data by design — no IP, no user agent, a random id in
 * localStorage — so it keeps counting whatever is decided here. Losing it to
 * a declined banner would mean losing the only honest numbers the shop has.
 *
 * Three states, and the difference matters: 'granted', 'denied', and null for
 * a visitor who has not been asked yet. Null must never read as granted.
 */

const KEY = 'morbei_consent';
const VERSION = 1;

const listeners = new Set();

function read() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // A stored decision from an older version of this notice is not a
        // decision about the current one.
        if (parsed?.version !== VERSION) return null;
        return parsed.state === 'granted' ? 'granted' : 'denied';
    } catch {
        // Private mode, blocked storage. Treat as not-yet-asked rather than
        // as consent, and the banner will simply show again.
        return null;
    }
}

export function getConsent() {
    return read();
}

export function hasAnalyticsConsent() {
    return read() === 'granted';
}

export function setConsent(granted) {
    const state = granted ? 'granted' : 'denied';
    try {
        localStorage.setItem(KEY, JSON.stringify({
            state,
            version: VERSION,
            at: new Date().toISOString(),
        }));
    } catch {
        // Can't remember it; the visitor will be asked again. Still honour the
        // choice for this page view.
    }
    listeners.forEach((fn) => {
        try { fn(state); } catch { /* one bad listener must not stop the rest */ }
    });
    return state;
}

/** Fires when a decision is made, so scripts can start without a reload. */
export function onConsentChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
