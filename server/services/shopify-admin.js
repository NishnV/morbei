const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = '2024-01';

async function adminFetch(endpoint, options = {}) {
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/${endpoint}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ADMIN_TOKEN,
            ...options.headers,
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify Admin API error ${res.status}: ${text}`);
    }
    return res.json();
}

export async function createDraftOrder({ lineItems, shippingAddress, email, note }) {
    // lineItems: [{ variant_id (numeric), quantity }]
    const body = {
        draft_order: {
            line_items: lineItems.map(li => ({
                variant_id: li.variant_id,
                quantity: li.quantity,
            })),
            shipping_address: shippingAddress,
            email,
            note: note || 'Order via MORBEI website',
        },
    };
    return adminFetch('draft_orders.json', { method: 'POST', body: JSON.stringify(body) });
}

export async function completeDraftOrder(draftOrderId) {
    return adminFetch(`draft_orders/${draftOrderId}/complete.json`, { method: 'PUT' });
}

export async function getOrder(orderId) {
    return adminFetch(`orders/${orderId}.json`);
}

export async function cancelOrder(orderId) {
    return adminFetch(`orders/${orderId}/cancel.json`, { method: 'POST' });
}

export async function listOrders(email) {
    return adminFetch(`orders.json?email=${encodeURIComponent(email)}&status=any&limit=50`);
}

// Fetch a variant's real price from Shopify — never trust client-sent prices
export async function getVariant(variantId) {
    const data = await adminFetch(`variants/${variantId}.json`);
    return data.variant; // { id, price: "1999.00", title, product_id, ... }
}

// Convert Shopify GID to numeric ID: "gid://shopify/ProductVariant/12345" → 12345
export function gidToNumeric(gid) {
    if (!gid) return null;
    const parts = gid.split('/');
    return parseInt(parts[parts.length - 1], 10);
}
