/**
 * A note-to-self that a payment was started and not yet seen through to a
 * confirmation screen.
 *
 * The confirmation page is the only thing that clears the Shopify cart, so a
 * customer who closes the tab after paying — the exact case the webhook exists
 * to handle — used to come back to a bag still holding the items they had just
 * bought. Nothing told them the order went through, and the obvious reading of
 * a full cart is that the payment failed. Some of them would pay again.
 *
 * Written the moment an order is created (before the gateway opens, so it
 * survives the tab closing) and cleared once a confirmation has been shown.
 */

const KEY = 'morbei_pending_order';

// Old enough that the customer is no longer mid-purchase; the marker is
// forgotten rather than acted on.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Recent enough that showing them the confirmation is welcome rather than an
// unexpected redirect out of whatever they came back to do.
export const FRESH_MS = 30 * 60 * 1000;

export function rememberPendingOrder(orderId) {
    try {
        localStorage.setItem(KEY, JSON.stringify({ orderId, at: Date.now() }));
    } catch { /* private mode — recovery is best-effort */ }
}

export function forgetPendingOrder() {
    try {
        localStorage.removeItem(KEY);
    } catch { /* nothing to do */ }
}

/** The pending order, or null if there isn't one or it has aged out. */
export function readPendingOrder() {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (!raw?.orderId || typeof raw.at !== 'number') return null;
        const age = Date.now() - raw.at;
        if (age > MAX_AGE_MS) {
            forgetPendingOrder();
            return null;
        }
        return { orderId: raw.orderId, age, fresh: age < FRESH_MS };
    } catch {
        return null;
    }
}
