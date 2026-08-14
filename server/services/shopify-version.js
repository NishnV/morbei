/**
 * The Shopify API version every server-side Shopify call uses.
 *
 * Shopify ships quarterly versions and keeps each accessible for ~12 months.
 * A request to a retired version does NOT fail — Shopify "falls forward" and
 * serves it using the oldest accessible version, so an out-of-date pin means
 * you are silently running on a moving target. This repo sat on '2024-01' for
 * over two years and was being served by whatever Shopify considered oldest.
 *
 * Keep in sync with VITE_SHOPIFY_API_VERSION (src/lib/shopify.js), which the
 * browser uses for the Storefront API.
 *
 * Supported window at time of writing (2026-08): 2025-10 … 2026-07.
 * Default is 2026-04 — mature, REST Admin endpoints confirmed present, and
 * accessible until 2027-04. Override with SHOPIFY_API_VERSION to roll forward
 * or back without a code change.
 */
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

/**
 * Shopify echoes the version that actually served a request in this header.
 * If it ever differs from what we asked for, our pin has been retired and we
 * are being silently upgraded — worth knowing before behaviour changes under us.
 */
export function warnOnVersionMismatch(res, endpoint) {
    const served = res.headers?.get?.('X-Shopify-API-Version');
    if (served && served !== SHOPIFY_API_VERSION) {
        console.warn(
            `Shopify API version mismatch on ${endpoint}: requested ${SHOPIFY_API_VERSION}, ` +
            `served ${served}. The pinned version has likely been retired — update SHOPIFY_API_VERSION.`
        );
    }
}
