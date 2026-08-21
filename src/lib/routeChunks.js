/**
 * Lazy-route imports, in one place so they can be both mounted and prefetched.
 *
 * Every page except Home is code-split, which keeps the initial bundle small
 * but moves a chunk download onto the click that navigates. Prefetching on
 * intent — a hover, or the touchstart that precedes a tap by ~100ms — overlaps
 * that download with the user's own reaction time, so the chunk is usually
 * parsed and ready by the time the route actually changes.
 *
 * The thunks are shared with React.lazy in App.jsx: the module registry
 * de-duplicates dynamic imports, so calling one twice costs nothing.
 */

export const routeChunks = {
    shop: () => import('../pages/Shop'),
    product: () => import('../pages/ProductDetail'),
    cart: () => import('../pages/Cart'),
    checkout: () => import('../pages/Checkout'),
    wishlist: () => import('../pages/Wishlist'),
    profile: () => import('../pages/Profile'),
    about: () => import('../pages/About'),
    editorials: () => import('../pages/Editorials'),
};

const started = new Set();

/**
 * Start downloading a route's chunk. Safe to call on every pointer event —
 * it runs at most once per route and swallows failures, since the real
 * navigation will surface any genuine problem through Suspense.
 */
export function prefetchRoute(name) {
    if (started.has(name)) return;
    const load = routeChunks[name];
    if (!load) return;
    started.add(name);
    load().catch(() => { started.delete(name); });
}
