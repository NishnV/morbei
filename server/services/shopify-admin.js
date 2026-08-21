import { SHOPIFY_API_VERSION, warnOnVersionMismatch } from './shopify-version.js';
import { notifySlackError } from './slack.js';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

async function adminFetch(endpoint, options = {}) {
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ADMIN_TOKEN,
            ...options.headers,
        },
    });
    warnOnVersionMismatch(res, endpoint);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify Admin API error ${res.status}: ${text}`);
    }
    return res.json();
}

export async function createDraftOrder({ lineItems, shippingAddress, email, note, shippingLine }) {
    // lineItems: [{ variant_id (numeric), quantity }]
    // shippingLine: { title, price } in rupees — omitted for free shipping.
    // Without it the customer pays for priority delivery via Razorpay but the
    // Shopify order records ₹0 shipping, so the totals never reconcile.
    const body = {
        draft_order: {
            line_items: lineItems.map(li => ({
                variant_id: li.variant_id,
                quantity: li.quantity,
            })),
            shipping_address: shippingAddress,
            ...(shippingLine ? { shipping_line: shippingLine } : {}),
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

/**
 * Record marketing consent in Shopify.
 *
 * Shopify owns marketing state for the same reason it owns catalog and
 * identity here: it already has campaign tooling and, more importantly, a
 * compliant unsubscribe flow. Reimplementing that on top of a local email
 * column would mean owning legal correctness we get for free.
 *
 * The local `newsletter` table stays as the durable log of who signed up,
 * when, and from where.
 */
export async function subscribeToMarketing(email) {
    const existing = await adminFetch(`customers/search.json?query=${encodeURIComponent(`email:${email}`)}`);
    const found = existing.customers?.[0];

    const consent = {
        state: 'subscribed',
        opt_in_level: 'single_opt_in',
        consent_updated_at: new Date().toISOString(),
    };

    if (found) {
        return adminFetch(`customers/${found.id}.json`, {
            method: 'PUT',
            body: JSON.stringify({
                customer: { id: found.id, email_marketing_consent: consent },
            }),
        });
    }

    return adminFetch('customers.json', {
        method: 'POST',
        body: JSON.stringify({
            customer: { email, tags: 'newsletter,website', email_marketing_consent: consent },
        }),
    });
}

/**
 * Withdraw marketing consent in Shopify. Called when someone uses an
 * unsubscribe link — Shopify is what actually gates campaign sending, so the
 * local flag alone would not stop mail going out.
 * No-ops if the address was never synced to a Shopify customer.
 */
export async function setMarketingConsentRevoked(email) {
    const existing = await adminFetch(`customers/search.json?query=${encodeURIComponent(`email:${email}`)}`);
    const found = existing.customers?.[0];
    if (!found) return null;

    return adminFetch(`customers/${found.id}.json`, {
        method: 'PUT',
        body: JSON.stringify({
            customer: {
                id: found.id,
                email_marketing_consent: {
                    state: 'unsubscribed',
                    opt_in_level: 'single_opt_in',
                    consent_updated_at: new Date().toISOString(),
                },
            },
        }),
    });
}

/**
 * Short-lived cache of variant reads.
 *
 * getVariant has exactly one caller — the checkout's re-pricing/stock loop in
 * routes/payment.js — and it is the hottest path against Shopify's Admin API.
 * Shopify Basic allows ~2 REST requests/second (burst 40) per app, per store.
 * A drop is the worst case for that budget and the best case for a cache:
 * everyone buys the same handful of variants at the same moment, so 300
 * concurrent lookups collapse into one call per distinct variant per window.
 *
 * Caching the *price* is free — we set prices, they don't move mid-drop.
 * Caching the *stock* number looks riskier than it is: nothing reserves
 * inventory between create-order and payment, so that check is already a
 * snapshot that goes stale over the minutes a customer spends in the Razorpay
 * flow. A 20-second TTL makes an already-advisory check negligibly looser,
 * and the real oversell guard is Shopify's own inventory at draft completion.
 */
const VARIANT_TTL_MS = Number(process.env.VARIANT_CACHE_TTL_MS || 20 * 1000);
// How long a cached copy may still be served *after* it expires, when Shopify
// itself is failing. A one-minute-old price beats losing the sale to a 429.
const VARIANT_STALE_IF_ERROR_MS = 60 * 1000;
const VARIANT_CACHE_MAX = 300;

const variantCache = new Map();    // numeric variant id -> { at, variant }
const inFlightVariants = new Map(); // numeric variant id -> Promise

function cacheVariant(variantId, variant) {
    // Re-insert so Map iteration order is least-recently-written first.
    variantCache.delete(variantId);
    variantCache.set(variantId, { at: Date.now(), variant });

    if (variantCache.size > VARIANT_CACHE_MAX) {
        const excess = variantCache.size - VARIANT_CACHE_MAX;
        let dropped = 0;
        for (const key of variantCache.keys()) {
            variantCache.delete(key);
            if (++dropped >= excess) break;
        }
    }
}

// Fetch a variant's real price from Shopify — never trust client-sent prices
export async function getVariant(variantId) {
    const hit = variantCache.get(variantId);
    if (hit && Date.now() - hit.at < VARIANT_TTL_MS) {
        return hit.variant;
    }

    // A TTL alone doesn't help the case that matters most. When a drop opens,
    // every shopper checks out within the same few seconds — they all miss the
    // cache simultaneously, so a plain cache would still send one request per
    // shopper per variant. Sharing the in-flight promise collapses that
    // thundering herd into a single Admin API call.
    const pending = inFlightVariants.get(variantId);
    if (pending) return pending;

    const request = (async () => {
        try {
            const data = await adminFetch(`variants/${variantId}.json`);
            cacheVariant(variantId, data.variant);
            return data.variant; // { id, price: "1999.00", title, product_id, ... }
        } catch (err) {
            // Shopify is rate-limiting or down. Serving a slightly stale variant
            // is far better than failing a checkout — but say so loudly, because
            // it means we are over the API budget and the next customer may not
            // be so lucky.
            if (hit && Date.now() - hit.at < VARIANT_STALE_IF_ERROR_MS) {
                const ageMs = Date.now() - hit.at;
                console.warn(
                    `getVariant(${variantId}) failed (${err.message}) — serving cached copy ${ageMs}ms old`
                );
                notifySlackError(
                    'Shopify variant fetch failed — served stale price/stock from cache',
                    err
                ).catch(() => {});
                return hit.variant;
            }
            throw err;
        } finally {
            inFlightVariants.delete(variantId);
        }
    })();

    inFlightVariants.set(variantId, request);
    return request;
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
