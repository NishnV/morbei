import { getOrderTracking } from './shopify-admin.js';

/**
 * A short-lived cache in front of Shopify's order tracking.
 *
 * Shopify tracking rarely changes minute to minute, but the order list made
 * one Admin API call per order — a customer with 20 orders triggered 20
 * external round-trips on every page load. Shared by the customer order
 * routes and the admin order list so they cannot each keep their own copy
 * and disagree.
 */
const TRACKING_TTL_MS = 5 * 60 * 1000;
const trackingCache = new Map(); // shopifyOrderId -> { at, value }

export async function getCachedTracking(shopifyOrderId) {
    const key = String(shopifyOrderId);
    const hit = trackingCache.get(key);
    if (hit && Date.now() - hit.at < TRACKING_TTL_MS) return hit.value;

    const value = await getOrderTracking(key);
    trackingCache.set(key, { at: Date.now(), value });

    // Bound the map — this process is long-lived and the cache is unbounded
    // otherwise. Cheap eviction: drop expired entries once it gets large.
    if (trackingCache.size > 500) {
        const cutoff = Date.now() - TRACKING_TTL_MS;
        for (const [k, v] of trackingCache) {
            if (v.at < cutoff) trackingCache.delete(k);
        }
    }
    return value;
}

/** Seed the cache from a bulk read, so one list call serves many orders. */
export function primeTracking(map) {
    const at = Date.now();
    for (const [id, value] of map) trackingCache.set(String(id), { at, value });
}

/**
 * Forget one order. Needed the moment we change an order's state in Shopify
 * ourselves — without it the next five minutes of page loads would keep
 * reporting the parcel as undelivered after it had been marked delivered.
 */
export function invalidateTracking(shopifyOrderId) {
    trackingCache.delete(String(shopifyOrderId));
}
