/**
 * Meta Pixel, loaded only after the visitor has agreed to it.
 *
 * This used to be an inline tag in the document head, which initialised and
 * fired PageView before React mounted — before anything on the page could
 * ask. Moving it here is the whole point: nothing reaches Meta until
 * installMetaPixel() is called, and the consent banner is what calls it.
 *
 * The id is the same one the inline tag used. connect.facebook.net and
 * www.facebook.com are already allowed in the CSP in vercel.json; if the
 * pixel ever goes quiet, check there first.
 */

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID || '1626259335567493';

let installed = false;

export function installMetaPixel() {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    try {
        !function (f, b, e, v, n, t, s) {
            if (f.fbq) return; n = f.fbq = function () {
                n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
            };
            if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
            n.queue = []; t = b.createElement(e); t.async = !0;
            t.src = v; s = b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t, s);
        }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        window.fbq('init', PIXEL_ID);
        // The PageView the inline tag used to fire at document load. It fires
        // here instead, once, at the moment consent is given.
        window.fbq('track', 'PageView');
    } catch {
        // Analytics is never allowed to stop the site working.
        installed = false;
    }
}

/** True once the pixel is loaded, so callers can skip queuing into nothing. */
export function metaPixelReady() {
    return installed && typeof window !== 'undefined' && typeof window.fbq === 'function';
}
