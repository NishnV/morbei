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
        // Carry the status on the error. Callers that need to tell "this is
        // gone" from "Shopify is broken" were reduced to matching on the
        // message text, which is how a deleted order became a 502 page.
        const err = new Error(`Shopify Admin API error ${res.status}: ${text}`);
        err.status = res.status;
        err.endpoint = endpoint;
        throw err;
    }
    return res.json();
}

/**
 * Build a draft order — deliberately without the customer's email address.
 *
 * Completing a draft order makes Shopify send its own order confirmation, and
 * there is no API flag and no admin setting that turns that off. A draft with
 * no email has nobody to notify, so the order is created in silence and the
 * address goes on afterwards with setOrderEmail. That leaves this store's own
 * confirmation as the only one the customer receives, which is the point: the
 * Shopify copy carried myshopify links and, sending as morbei.com against an
 * SPF record that does not authorise Shopify, was being rejected unread.
 *
 * Callers must follow this with setOrderEmail, or the order of record will
 * have no customer on it.
 */
export async function createDraftOrder({ lineItems, shippingAddress, note, shippingLine, appliedDiscount, tags }) {
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
            // A replacement for an exchange is sent at no charge: the customer
            // already paid on the original order. A 100% discount rather than
            // zero-priced lines, so the order still records what the garment
            // is worth and stock and reporting stay honest.
            ...(appliedDiscount ? { applied_discount: appliedDiscount } : {}),
            note: note || 'Order via MORBEI website',
            ...(tags ? { tags } : {}),
        },
    };
    return adminFetch('draft_orders.json', { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Attach the customer's email to an order that was created without one.
 *
 * Run this immediately after completeDraftOrder. Updating an order's email
 * does not trigger a confirmation, so the order gains its customer without
 * Shopify mailing them. The address matters beyond the record: listOrders
 * searches on it, which is how the returns lookup finds an order.
 */
export async function setOrderEmail(orderId, email) {
    return adminFetch(`orders/${orderId}.json`, {
        method: 'PUT',
        body: JSON.stringify({ order: { id: Number(orderId), email } }),
    });
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

/**
 * Record a return against the Shopify order and put the piece back on sale.
 *
 * Shopify is the order of record, but the money moved through Razorpay, so
 * without this an order stayed "fully paid" there forever and the returned
 * garment stayed sold: it sits on the shelf while the product page says sold
 * out, and the revenue reports permanently overstate takings.
 *
 * The refund is created with no `transactions`, which records the return and
 * the restock without Shopify trying to move money it never held. The line is
 * matched by variant, because that is what the return row stores.
 *
 * `restock: false` for a piece that came back damaged — recording the return
 * is still right, putting it back on sale is not.
 */
export async function refundOrderLine(orderId, variantId, { restock = true, note } = {}) {
    const data = await adminFetch(`orders/${orderId}.json?fields=id,line_items`);

    // Orders store the variant as a Storefront GID, because that is what the
    // cart deals in; REST line items carry a plain numeric id. Comparing the
    // two as strings never matched, which is why the first real refund
    // reported LINE_NOT_FOUND after the money had already gone back.
    // gidToNumeric is the same conversion fulfillment.js does when it builds
    // the draft order in the first place.
    const numeric = gidToNumeric(variantId) || Number(variantId);
    const line = (data.order?.line_items || []).find(
        (li) => Number(li.variant_id) === numeric || Number(li.id) === numeric
    );
    if (!line) throw new Error('LINE_NOT_FOUND');

    const body = {
        refund: {
            note: note || 'Returned via MORBEI returns',
            notify: false,
            refund_line_items: [{
                line_item_id: line.id,
                quantity: 1,
                // 'return' puts it back into sellable stock; 'no_restock'
                // records the return and leaves inventory alone.
                restock_type: restock ? 'return' : 'no_restock',
                ...(restock ? { location_id: null } : {}),
            }],
            // Deliberately empty: Razorpay moved the money. A transaction here
            // would ask Shopify to refund through a gateway it does not hold.
            transactions: [],
        },
    };
    return adminFetch(`orders/${orderId}/refunds.json`, {
        method: 'POST',
        body: JSON.stringify(body),
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

/** The most recent fulfillment that was not cancelled, or undefined. */
function latestFulfillment(order) {
    return [...(order.fulfillments || [])]
        .filter(f => f.status !== 'cancelled')
        .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))[0];
}

/**
 * Flatten a Shopify order into the shape every page uses to show progress.
 *
 * The answer is split across two fields and both are needed: fulfillment_status
 * says the parcel left, while delivery lives on fulfillments[].shipment_status.
 */
function trackingFromOrder(order) {
    const latest = latestFulfillment(order);
    return {
        fulfillmentStatus: order.fulfillment_status || null, // null | 'partial' | 'fulfilled'
        shipmentStatus: latest?.shipment_status || null,     // null | 'in_transit' | 'out_for_delivery' | 'delivered' | ...
        trackingNumber: latest?.tracking_number || latest?.tracking_numbers?.[0] || null,
        trackingCompany: latest?.tracking_company || null,
        trackingUrl: latest?.tracking_url || latest?.tracking_urls?.[0] || null,
    };
}

const TRACKING_FIELDS = 'id,order_number,fulfillment_status,cancelled_at,fulfillments';

/**
 * Fetch an order's fulfillment + shipment tracking from Shopify.
 * The store fulfils manually and sets tracking/courier + delivered status in
 * Shopify admin; this reads that back so the customer's order page reflects it.
 * Returns null on any failure so the caller can fall back to local status.
 */
export async function getOrderTracking(orderId) {
    try {
        const data = await adminFetch(`orders/${orderId}.json?fields=${TRACKING_FIELDS}`);
        return trackingFromOrder(data.order || {});
    } catch (err) {
        console.error(`getOrderTracking failed for order ${orderId}:`, err.message);
        return null;
    }
}

/**
 * The same tracking for the most recent orders in ONE request, keyed by
 * Shopify order id. The admin order list needs the state of every row at
 * once; asking per order would spend 25 calls against a bucket that refills
 * at two a second.
 */
export async function listOrdersTracking(limit = 50) {
    const data = await adminFetch(
        `orders.json?status=any&limit=${Math.min(limit, 250)}&fields=${TRACKING_FIELDS}`
    );
    return new Map((data.orders || []).map(o => [String(o.id), trackingFromOrder(o)]));
}

/**
 * Tell Shopify a parcel has been delivered.
 *
 * Shopify has no delivered status on an order. shipment_status is driven by
 * posted fulfillment events — carrier-integrated labels post them, manual
 * fulfillment posts none, and the admin screen has no button for it. This
 * store fulfils by hand, so without this call nothing would ever report a
 * delivery and the whole returns window would have no start date.
 *
 * Throws Error('NO_FULFILLMENT') when the order has not been fulfilled yet:
 * an event has to attach to a shipment that exists.
 */
export async function markFulfillmentDelivered(orderId) {
    let data;
    try {
        data = await adminFetch(`orders/${orderId}.json?fields=id,fulfillments`);
    } catch (err) {
        // An order deleted in Shopify leaves its row behind in our table, so
        // the dashboard still offers a button for it. That is a stale record,
        // not an outage, and it should read as one.
        if (err.status === 404) throw new Error('ORDER_GONE');
        throw err;
    }
    const latest = latestFulfillment(data.order || {});
    if (!latest) throw new Error('NO_FULFILLMENT');

    await adminFetch(`orders/${orderId}/fulfillments/${latest.id}/events.json`, {
        method: 'POST',
        body: JSON.stringify({ event: { status: 'delivered' } }),
    });
    return { fulfillmentId: latest.id };
}

// Convert Shopify GID to numeric ID: "gid://shopify/ProductVariant/12345" → 12345
export function gidToNumeric(gid) {
    if (!gid) return null;
    const parts = gid.split('/');
    return parseInt(parts[parts.length - 1], 10);
}

/**
 * A product with all of its variants, used to find the size a customer wants
 * in exchange for the one they are sending back.
 */
export async function getProduct(productId) {
    const data = await adminFetch(`products/${productId}.json`);
    return data.product;
}

/**
 * The same garment in a different size.
 *
 * Resolved from the variant that was bought rather than from a product handle,
 * because the order stores variant ids and nothing else. Returns null when the
 * size does not exist or is out of stock, which the caller reports instead of
 * creating an order that cannot be fulfilled.
 */
export async function findSiblingVariant(originalVariantId, wantedSize) {
    const original = await getVariant(originalVariantId);
    if (!original?.product_id) return { error: 'Could not find the original product.' };

    const product = await getProduct(original.product_id);
    const variants = product?.variants || [];

    const wanted = String(wantedSize).trim().toUpperCase();
    const match = variants.find((v) =>
        [v.option1, v.option2, v.option3]
            .filter(Boolean)
            .some((o) => String(o).trim().toUpperCase() === wanted)
    );

    if (!match) return { error: `${product?.title || 'This product'} is not available in ${wantedSize}.` };
    // inventory_quantity can be negative when oversold, so compare rather than
    // trusting truthiness, and respect "continue selling" the way the shop does.
    const inStock = match.inventory_policy === 'continue' || Number(match.inventory_quantity) > 0;
    if (!inStock) return { error: `${product?.title || 'This product'} is out of stock in ${wantedSize}.` };

    return { variant: match, product };
}
