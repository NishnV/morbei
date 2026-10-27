/**
 * Microsoft Clarity — session recordings and heatmaps.
 *
 * Loaded from an environment variable rather than hardcoded, so the site runs
 * unchanged with it switched off and nothing is sent to Microsoft until a
 * project id exists. Set VITE_CLARITY_PROJECT_ID in Vercel to enable it.
 *
 * Why this rather than more analytics: at low traffic a funnel chart cannot
 * tell you anything with confidence — ten sessions is not a sample. Watching
 * ten real recordings can. Clarity also flags rage clicks and dead clicks,
 * which is how a tap that silently does nothing gets noticed.
 */
export function installClarity() {
    const id = import.meta.env.VITE_CLARITY_PROJECT_ID;
    if (!id) return;
    try {
        (function (c, l, a, r, i) {
            c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
            const t = l.createElement(r);
            t.async = 1;
            t.src = 'https://www.clarity.ms/tag/' + i;
            const y = l.getElementsByTagName(r)[0];
            y.parentNode.insertBefore(t, y);
        })(window, document, 'clarity', 'script', id);
    } catch {
        // Analytics is never allowed to stop the site booting.
    }
}
