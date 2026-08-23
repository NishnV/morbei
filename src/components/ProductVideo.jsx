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
 * Shopify returns 1080p/720p/480p at roughly 7.2/4.5/1.5 Mbps. Listing them
 * all as <source> elements does not help: the browser takes the first it can
 * decode, which is always the largest, so the choice has to be made here.
 *
 * `sources` arrives sorted widest-first from normalizeProduct.
 */
function pickSource(sources) {
    if (!sources?.length) return null;
    const smallest = sources[sources.length - 1];

    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return smallest;

    // These are portrait clips, so "1080p" is 606px wide. On a phone the frame
    // is roughly 400 CSS px, and the extra 2.7 Mbps of the top rendition buys
    // almost nothing over cellular.
    const narrow = typeof window !== 'undefined' && window.innerWidth < 768;
    if (!narrow) return sources[0];

    const mid = sources.find((s) => (s.width || 0) <= 450);
    return mid || smallest;
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
