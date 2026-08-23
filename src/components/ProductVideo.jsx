import React, { useEffect, useMemo, useRef } from 'react';

/**
 * A Shopify-hosted product video.
 *
 * Played as ambient motion rather than as a player: muted, looping, inline and
 * without chrome. That combination is also what lets it start on its own —
 * browsers refuse to autoplay anything with sound. The lightbox is the one
 * place that passes `controls`, because that is where someone has chosen to
 * look properly.
 *
 * Only the visible item plays. The mobile slider keeps every slide mounted so
 * it can translate between them, so without the `active` gate a three-item
 * gallery would decode every video at once behind a single visible frame.
 */

/**
 * Pick one MP4 rendition.
 *
 * Shopify returns 1080p/720p/480p, but these are portrait clips, so those
 * labels are heights — the widths are 606, 404 and 270. Listing them all as
 * <source> elements does not choose between them either: the browser takes
 * the first it can decode, which is always the largest.
 *
 * The choice is made in device pixels, not CSS pixels. Every surface this
 * plays on asks for more width than the source has: the desktop column is
 * about 640 CSS px, or ~1280 device pixels on a retina screen, and a phone at
 * 375 CSS px with DPR 3 asks for 1125. Nothing here covers either, so the
 * widest rendition is always the sharpest available answer and the smaller
 * ones are reserved for the data-saver case.
 *
 * `sources` arrives sorted widest-first from normalizeProduct.
 */
function pickSource(sources) {
    if (!sources?.length) return null;

    // An explicit request to spend less data outranks sharpness.
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) {
        return sources[sources.length - 1];
    }

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    // Portrait phone: full-bleed slide. Desktop: the main column is ~44vw.
    const needed = (cssWidth < 768 ? cssWidth : cssWidth * 0.44) * dpr;

    // Smallest rendition that still covers the frame, widest otherwise. Today
    // this lands on the widest everywhere; it stops doing so the moment a
    // higher-resolution master is uploaded, which is the point.
    const covering = [...sources].reverse().find((s) => (s.width || 0) >= needed);
    return covering || sources[0];
}

const ProductVideo = ({ item, active = true, controls = false, className, alt }) => {
    const ref = useRef(null);
    const source = useMemo(() => pickSource(item?.sources), [item]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (active) {
            // Rejects when the browser declines to start (a tab in the
            // background, a data-saver policy). The poster stays up, which is
            // the right outcome — there is nothing to recover from.
            el.play?.().catch(() => {});
        } else {
            el.pause?.();
            // Back to the first frame so returning to this slide starts the
            // clip over rather than resuming mid-motion.
            try { el.currentTime = 0; } catch { /* not seekable yet */ }
        }
    }, [active]);

    if (!source) return null;

    return (
        <video
            ref={ref}
            className={className}
            src={source.url}
            poster={item.poster || undefined}
            muted
            loop
            playsInline
            controls={controls}
            // Nothing is fetched until this item becomes the visible one; the
            // poster carries the slide in the meantime.
            preload={active ? 'auto' : 'none'}
            aria-label={alt || item.alt || undefined}
        />
    );
};

export default ProductVideo;
