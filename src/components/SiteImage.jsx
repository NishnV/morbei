import { useSiteImages } from '../hooks/useSiteImages';
import { shopifyImage, shopifySrcSet } from '../utils/shopifyImage';

/**
 * An image slot the store owner can change from the Shopify admin.
 *
 * Replaces a hardcoded `<img src="/campaign-1.webp">` with a named slot. If the
 * slot has an image assigned in Shopify it wins; otherwise the file in public/
 * shows. That fallback is the whole safety story — an empty CMS, an unfilled
 * slot, or a Shopify outage all degrade to exactly what the site looked like
 * before, rather than to a broken image.
 *
 * Slots are documented in SITE_IMAGES.md. Note the same file can back two
 * different slots (campaign-1.webp does today), which is why slots are named
 * after the position on the page, not after the file.
 *
 * @param {string}  slot      Slot key, e.g. "home-hero". Must match the metaobject.
 * @param {string}  fallback  Path under public/ used when the slot is unset.
 * @param {string}  alt       Fallback alt text; Shopify's alt wins when present.
 * @param {number}  width     Render width hint, drives the CDN transform.
 * @param {number[]} widths   srcset widths. Omit for a single-size image.
 * @param {boolean} priority  Set on the LCP image — eager + high fetchPriority.
 */
export default function SiteImage({
    slot,
    fallback,
    alt = '',
    width = 1600,
    widths,
    sizes,
    priority = false,
    className,
    ...rest
}) {
    const images = useSiteImages();
    const managed = images[slot];

    const src = managed ? shopifyImage(managed.url, width) : fallback;
    // shopifySrcSet returns undefined for non-Shopify URLs, so the local
    // fallback simply renders without a srcset.
    const srcSet = managed && widths ? shopifySrcSet(managed.url, widths) : undefined;

    return (
        <img
            src={src}
            srcSet={srcSet}
            sizes={srcSet ? sizes : undefined}
            alt={managed?.alt || alt}
            className={className}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : undefined}
            decoding="async"
            {...rest}
        />
    );
}
