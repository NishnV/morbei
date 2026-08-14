/**
 * Shopify CDN image transforms.
 *
 * Every image in the app was previously rendered from the raw Shopify CDN URL,
 * which serves the original upload — typically 2000-3000px and several hundred
 * KB. A 400px-wide grid tile on a phone was downloading roughly twenty times
 * the pixels it could display. The CDN resizes and re-encodes on demand for
 * free; this just asks it to.
 *
 * Non-Shopify URLs (local /placeholder.png, imported assets) pass through
 * untouched.
 */

const CDN_HOST = 'cdn.shopify.com';

/** Widths worth generating for a full-bleed or grid image. */
export const DEFAULT_WIDTHS = [400, 600, 800, 1200, 1600];

function isShopifyCdn(url) {
    return typeof url === 'string' && url.includes(CDN_HOST);
}

/**
 * Resize/re-encode a Shopify CDN image.
 * @param {string} url
 * @param {number} width  target width in CSS pixels
 * @param {{format?: 'webp'|'jpg'|null}} [opts]  null format keeps the original
 */
export function shopifyImage(url, width, { format = 'webp' } = {}) {
    if (!isShopifyCdn(url)) return url;
    try {
        const u = new URL(url);
        u.searchParams.set('width', String(Math.round(width)));
        if (format) u.searchParams.set('format', format);
        return u.toString();
    } catch {
        return url; // malformed URL — better to serve the original than nothing
    }
}

/**
 * A srcset across the given widths, so the browser picks by viewport and DPR.
 * Returns undefined for non-Shopify URLs so the attribute is simply omitted.
 */
export function shopifySrcSet(url, widths = DEFAULT_WIDTHS) {
    if (!isShopifyCdn(url)) return undefined;
    return widths.map((w) => `${shopifyImage(url, w)} ${w}w`).join(', ');
}
