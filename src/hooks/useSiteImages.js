import { useState, useEffect } from 'react';
import { shopifyFetch } from '../lib/shopify';
import { SITE_IMAGES_QUERY } from '../graphql/siteImages';
import SNAPSHOT from '../generated/site-images.json';

/**
 * Loads the slot → image map from Shopify metaobjects.
 *
 * Three things this has to get right:
 *
 * 1. **Never block a render.** The homepage hero is the LCP element. Waiting on
 *    a network round-trip before painting it would make the page measurably
 *    slower than the hardcoded paths it replaces.
 *
 * 2. **Never break the page.** If Shopify is down, the metaobject is empty, or
 *    a slot simply hasn't been filled in yet, <SiteImage> falls back to the file
 *    in public/. The site is never image-less because a CMS lookup failed.
 *
 * 3. **Don't flash, ever.** The map is cached in localStorage for returning
 *    visitors, and seeded from a build-time snapshot for everyone else, so the
 *    first paint already carries the real image while a fresh copy revalidates
 *    in the background. Without the snapshot, a first-time visitor watched the
 *    public/ fallback get replaced a moment after load — visible in incognito,
 *    but not remotely limited to it.
 *
 * One fetch per page load, shared across every consumer via the module-level
 * cache — these change maybe monthly, so per-component fetching would be waste.
 */

const CACHE_KEY = 'morbei_site_images';
const CACHE_TTL_MS = 60 * 60 * 1000; // revalidate hourly; content changes rarely

let memoryCache = null;      // slot -> { url, alt, width, height }
let inFlight = null;         // dedupes concurrent callers on first load
const subscribers = new Set();

function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { at, map } = JSON.parse(raw);
        if (!map || typeof map !== 'object') return null;
        return { stale: Date.now() - at > CACHE_TTL_MS, map };
    } catch {
        return null; // private mode or corrupted — treat as a cold start
    }
}

function writeCache(map) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), map }));
    } catch { /* storage full or blocked — the memory cache still works */ }
}

function parseResponse(data) {
    const map = {};
    for (const edge of data?.metaobjects?.edges || []) {
        const node = edge.node;
        const slot = node.slot?.value?.trim();
        const image = node.image?.reference?.image;
        // A slot with no image attached is a half-finished entry in the admin,
        // not an error — skip it so the local fallback keeps showing.
        if (!slot || !image?.url) continue;
        map[slot] = {
            url: image.url,
            alt: node.alt?.value || image.altText || '',
            width: image.width || null,
            height: image.height || null,
        };
    }
    return map;
}

async function fetchSiteImages() {
    const data = await shopifyFetch({ query: SITE_IMAGES_QUERY, variables: { first: 100 } });
    const map = parseResponse(data);
    memoryCache = map;
    writeCache(map);
    subscribers.forEach((fn) => fn(map));
    return map;
}

/** Kick off a load if one isn't already running. Errors are swallowed on purpose. */
function ensureLoaded() {
    if (inFlight) return inFlight;
    inFlight = fetchSiteImages()
        .catch((err) => {
            // Falling back to public/ is a perfectly good outcome — log for
            // diagnosis, don't surface anything to the shopper.
            console.warn('Site images unavailable, using local fallbacks:', err.message);
            return memoryCache || {};
        })
        .finally(() => { inFlight = null; });
    return inFlight;
}

export function useSiteImages() {
    const [map, setMap] = useState(() => {
        if (memoryCache) return memoryCache;
        const cached = readCache();
        if (cached) {
            memoryCache = cached.map;
            return cached.map;
        }
        // Nothing visitor-specific yet — first visit, or a private window.
        // The snapshot is what this slot map looked like at build time, which
        // is right until someone changes an image in the admin, and the fetch
        // below corrects even that within the same page load. Deliberately
        // last: a real cache is always fresher than a build artefact.
        if (Object.keys(SNAPSHOT).length) {
            memoryCache = SNAPSHOT;
            return SNAPSHOT;
        }
        return {};
    });

    useEffect(() => {
        const cached = readCache();
        // Revalidate when the cache is missing or past its TTL. A fresh copy in
        // memory this page load means someone else already did it.
        const needsFetch = !cached || cached.stale;
        if (needsFetch) ensureLoaded();

        subscribers.add(setMap);
        return () => { subscribers.delete(setMap); };
    }, []);

    return map;
}
