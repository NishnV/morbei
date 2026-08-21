/**
 * A tiny stale-while-revalidate cache for Storefront API queries.
 *
 * Every product, collection and search hook used to fetch on mount with no
 * cache and no de-duplication, so Shop → Product → back to Shop was a full
 * round-trip and a full-screen loader each way. On mobile data that is 300-800ms
 * of spinner on the exact navigation shoppers repeat most.
 *
 * The design is lifted from useSiteImages, which already proved the pattern in
 * this codebase: a module-level map, one in-flight promise per key so
 * concurrent callers share a request, and cached data served immediately while
 * a fresh copy revalidates behind it.
 *
 * Deliberately memory-only. Site images persist to localStorage because they
 * change monthly; prices and stock must not survive a page load.
 */

import { shopifyFetch } from './shopify';

/** Per-kind freshness. Stale entries still render instantly, then revalidate. */
export const TTL = {
    /** Stock counts show on the PDP — keep this tight. */
    PRODUCT: 60 * 1000,
    /** Grids tolerate more drift; a background refresh corrects them. */
    LIST: 3 * 60 * 1000,
    SEARCH: 2 * 60 * 1000,
    /** Recommendations are a merchandising choice, not live data. */
    STATIC: 10 * 60 * 1000,
};

const MAX_ENTRIES = 120;

const entries = new Map();  // key -> { at, data }
const inFlight = new Map(); // key -> Promise

/**
 * Read a cached value without touching the network.
 * Returns null on a miss, otherwise { data, stale }.
 */
export function peek(key, ttl = TTL.LIST) {
    const hit = entries.get(key);
    if (!hit) return null;
    // Re-insert to keep iteration order least-recently-used first.
    entries.delete(key);
    entries.set(key, hit);
    // >= so that a ttl of 0 means "always revalidate" rather than "fresh for
    // the rest of this millisecond".
    return { data: hit.data, stale: Date.now() - hit.at >= ttl };
}

/** Store a value under a key, evicting the least recently used if needed. */
export function put(key, data) {
    entries.delete(key);
    entries.set(key, { at: Date.now(), data });

    if (entries.size > MAX_ENTRIES) {
        const excess = entries.size - MAX_ENTRIES;
        let dropped = 0;
        for (const k of entries.keys()) {
            entries.delete(k);
            if (++dropped >= excess) break;
        }
    }
}

/**
 * Run a Storefront query, sharing one request between concurrent callers.
 *
 * `transform` runs once per network response rather than once per caller, so
 * the cache holds normalized data and every consumer gets the same object.
 * Results are always cached; whether a caller *waits* for this promise or
 * renders a stale copy first is the hook's decision, not this function's.
 */
export function runQuery({ key, query, variables, transform }) {
    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = shopifyFetch({ query, variables })
        .then((raw) => {
            const data = transform ? transform(raw) : raw;
            put(key, data);
            return data;
        })
        .finally(() => {
            inFlight.delete(key);
        });

    inFlight.set(key, promise);
    return promise;
}

/**
 * Warm the cache ahead of a navigation the user has signalled but not made —
 * hovering a product card, or touching it before the tap registers. Never
 * throws and never rejects: a prefetch that fails just means the real fetch
 * happens normally a moment later.
 */
export function prefetch(options) {
    const { key } = options;
    if (entries.has(key) || inFlight.has(key)) return;
    runQuery(options).catch(() => { /* the real navigation will retry */ });
}

/** Drop cached entries whose key starts with `prefix` (all of them if omitted). */
export function invalidate(prefix) {
    if (!prefix) {
        entries.clear();
        return;
    }
    for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
    }
}

/** Stable cache key from a name and any set of query variables. */
export function keyFor(name, parts) {
    return `${name}:${JSON.stringify(parts ?? null)}`;
}
