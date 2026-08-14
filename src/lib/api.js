const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getToken() {
    return localStorage.getItem('morbei_token');
}

export function setToken(token) {
    localStorage.setItem('morbei_token', token);
}

export function clearToken() {
    localStorage.removeItem('morbei_token');
}

export async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
        // Keep the status and the full body on the error — some responses carry
        // structured detail (e.g. which cart lines went out of stock) that the
        // message string alone can't express.
        const err = new Error(data.error || `API error ${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
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

