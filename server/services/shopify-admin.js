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

export async function cancelOrder(orderId, { restock = true, reason = 'customer' } = {}) {
    // restock returns the cancelled order's items to inventory (no-op for
    // products that don't have inventory tracking enabled). email:false —
    // we send our own cancellation email, so suppress Shopify's.
    return adminFetch(`orders/${orderId}/cancel.json`, {
        method: 'POST',
        body: JSON.stringify({ restock, reason, email: false }),
    });
}

export async function listOrders(email) {
    return adminFetch(`orders.json?email=${encodeURIComponent(email)}&status=any&limit=50`);
}

// Fetch a variant's real price from Shopify — never trust client-sent prices
export async function getVariant(variantId) {
    const data = await adminFetch(`variants/${variantId}.json`);
    return data.variant; // { id, price: "1999.00", title, product_id, ... }
}

/**
 * Fetch an order's fulfillment + shipment tracking from Shopify.
 * The store fulfils manually and sets tracking/courier + delivered status in
 * Shopify admin; this reads that back so the customer's order page reflects it.
 * Returns null on any failure so the caller can fall back to local status.
 */
export async function getOrderTracking(orderId) {
    try {
        const data = await adminFetch(
            `orders/${orderId}.json?fields=id,fulfillment_status,cancelled_at,fulfillments`
        );
        const order = data.order || {};
        const fulfillments = order.fulfillments || [];
        // Use the most recent successful fulfillment for tracking details.
        const latest = [...fulfillments]
            .filter(f => f.status !== 'cancelled')
            .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))[0];

        return {
            fulfillmentStatus: order.fulfillment_status || null, // null | 'partial' | 'fulfilled'
            shipmentStatus: latest?.shipment_status || null,     // null | 'in_transit' | 'out_for_delivery' | 'delivered' | ...
            trackingNumber: latest?.tracking_number || latest?.tracking_numbers?.[0] || null,
            trackingCompany: latest?.tracking_company || null,
            trackingUrl: latest?.tracking_url || latest?.tracking_urls?.[0] || null,
        };
    } catch (err) {
        console.error(`getOrderTracking failed for order ${orderId}:`, err.message);
        return null;
    }
}

// Convert Shopify GID to numeric ID: "gid://shopify/ProductVariant/12345" → 12345
export function gidToNumeric(gid) {
    if (!gid) return null;
    const parts = gid.split('/');
    return parseInt(parts[parts.length - 1], 10);
}
