const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const BACKEND_TOKEN_KEY = 'morbei_token';
const SHOPIFY_TOKEN_KEY = 'morbei_customer_token';

function getToken() {
    return localStorage.getItem(BACKEND_TOKEN_KEY);
}

export function setToken(token) {
    localStorage.setItem(BACKEND_TOKEN_KEY, token);
}

export function clearToken() {
    localStorage.removeItem(BACKEND_TOKEN_KEY);
}

/**
 * Trade the Shopify customer session for a fresh backend JWT.
 *
 * The backend token lives 7 days; the Shopify session outlives it and renews
 * itself. Nothing reconciled the two: an expired-but-present backend token was
 * never replaced, because every re-exchange was guarded on the token being
 * *absent*. A customer returning on day 8 was still signed in as far as the UI
 * knew, filled in the whole checkout, pressed Pay, and got "Invalid or expired
 * token" with no way out short of clearing site data.
 *
 * De-duplicated: several requests failing at once must not fire several
 * exchanges. Returns the new token, or null if there is no Shopify session to
 * exchange (genuinely signed out).
 */
let refreshInFlight = null;

function refreshBackendSession() {
    if (refreshInFlight) return refreshInFlight;

    const shopifyToken = localStorage.getItem(SHOPIFY_TOKEN_KEY);
    if (!shopifyToken) return Promise.resolve(null);

    const run = async () => {
        try {
            const res = await fetch(`${API_BASE}/auth/shopify-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerAccessToken: shopifyToken }),
            });
            if (!res.ok) return null;
            const data = await res.json().catch(() => null);
            if (!data?.token) return null;
            setToken(data.token);
            return data.token;
        } catch {
            return null; // offline, or the backend is down — caller reports the original failure
        }
    };

    refreshInFlight = run().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
}

/**
 * Read a response body without assuming it is JSON.
 *
 * Railway's edge answers with an HTML error page when the service is
 * restarting, cold-starting or out of memory — which happens on every deploy.
 * Parsing that unconditionally threw `Unexpected token '<'`, and that string is
 * what the checkout showed the customer.
 */
async function parseBody(res) {
    const text = await res.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { nonJson: true };
    }
}

function genericMessage(status) {
    if (status === 502 || status === 503 || status === 504) {
        return "We're having trouble reaching our servers. Please try again in a moment.";
    }
    if (status === 429) return 'Too many requests, please try again shortly';
    return 'Something went wrong. Please try again.';
}

async function request(endpoint, options, isRetry) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res;
    try {
        res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    } catch {
        // fetch only rejects on a transport failure — no response ever arrived.
        const err = new Error('Could not reach the server. Check your connection and try again.');
        err.status = 0;
        err.offline = true;
        throw err;
    }

    // An expired backend token is recoverable as long as the Shopify session is
    // still good. Retry once, transparently. Auth endpoints are excluded so a
    // genuinely rejected exchange can't recurse.
    if (res.status === 401 && !isRetry && !endpoint.startsWith('/auth/')) {
        clearToken();
        const refreshed = await refreshBackendSession();
        if (refreshed) return request(endpoint, options, true);
    }

    const data = await parseBody(res);
    if (!res.ok) {
        const err = new Error(data.error || genericMessage(res.status));
        err.status = res.status;
        // Keep the full body on the error — some responses carry structured
        // detail (e.g. which cart lines went out of stock) that the message
        // string alone can't express.
        err.data = data;
        throw err;
    }
    return data;
}

export async function apiFetch(endpoint, options = {}) {
    return request(endpoint, options, false);
}

/** Whether a backend session can be obtained without the customer signing in again. */
export function hasRecoverableSession() {
    return Boolean(getToken() || localStorage.getItem(SHOPIFY_TOKEN_KEY));
}

/** Ensure a usable backend JWT exists, exchanging the Shopify session if needed. */
export async function ensureBackendSession() {
    if (getToken()) return true;
    return Boolean(await refreshBackendSession());
}

// Auth — exchanges the Shopify customer token for a backend JWT
export const authAPI = {
    shopifyLogin: (customerAccessToken) =>
        apiFetch('/auth/shopify-login', { method: 'POST', body: JSON.stringify({ customerAccessToken }) }),
    // Bumps the user's token_version server-side, invalidating every JWT
    // already issued to them — not just the copy in this browser.
    logout: () => apiFetch('/auth/logout', { method: 'POST' }),
};

// Payment
export const paymentAPI = {
    createOrder: (body) => apiFetch('/payment/create-order', { method: 'POST', body: JSON.stringify(body) }),
    verify: (body) => apiFetch('/payment/verify', { method: 'POST', body: JSON.stringify(body) }),
};

// Orders
export const ordersAPI = {
    list: () => apiFetch('/orders'),
    get: (id) => apiFetch(`/orders/${id}`),
};

// Shipping
export const shippingAPI = {
    trackOrder: (orderId) => apiFetch(`/shipping/track-order/${orderId}`),
    cancel: (orderId) => apiFetch(`/shipping/cancel/${orderId}`, { method: 'POST' }),
};

// Contact & Newsletter
export const contactAPI = {
    submit: (body) => apiFetch('/contact', { method: 'POST', body: JSON.stringify(body) }),
    newsletter: (email, source = 'footer') =>
        apiFetch('/contact/newsletter', { method: 'POST', body: JSON.stringify({ email, source }) }),
    unsubscribe: (email, token) =>
        apiFetch(`/contact/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`),
    notifyStock: (email, product) => apiFetch('/contact/notify-stock', { method: 'POST', body: JSON.stringify({ email, product }) }),
};

// Wishlist
export const wishlistAPI = {
    get: () => apiFetch('/wishlist'),
    add: (body) => apiFetch('/wishlist', { method: 'POST', body: JSON.stringify(body) }),
    remove: (productId) => apiFetch(`/wishlist/${productId}`, { method: 'DELETE' }),
    sync: (items) => apiFetch('/wishlist/sync', { method: 'POST', body: JSON.stringify({ items }) }),
};
