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
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    return data;
}

// Auth — exchanges the Shopify customer token for a backend JWT
export const authAPI = {
    shopifyLogin: (customerAccessToken) =>
        apiFetch('/auth/shopify-login', { method: 'POST', body: JSON.stringify({ customerAccessToken }) }),
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
    newsletter: (email) => apiFetch('/contact/newsletter', { method: 'POST', body: JSON.stringify({ email }) }),
    notifyStock: (email, product) => apiFetch('/contact/notify-stock', { method: 'POST', body: JSON.stringify({ email, product }) }),
};

// Wishlist
export const wishlistAPI = {
    get: () => apiFetch('/wishlist'),
    add: (body) => apiFetch('/wishlist', { method: 'POST', body: JSON.stringify(body) }),
    remove: (productId) => apiFetch(`/wishlist/${productId}`, { method: 'DELETE' }),
    sync: (items) => apiFetch('/wishlist/sync', { method: 'POST', body: JSON.stringify({ items }) }),
};

