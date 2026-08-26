/**
 * Recovering from a stale chunk after a deploy.
 *
 * The build gives every lazy route a content-hashed filename, and a deploy
 * replaces the whole set. A visitor whose tab still holds the previous
 * index.html goes on asking for the previous names, so the first route they
 * navigate to after a deploy 404s and the dynamic import rejects:
 *
 *   Failed to fetch dynamically imported module: .../assets/Cart-CwPpZol7.js
 *
 * Nothing in the page can repair that. React.lazy caches the rejected promise,
 * so retrying the same component fails without even making a request, and the
 * URL is genuinely gone besides. Only a document reload picks up the new
 * index.html and with it the new filenames — which is why the old TRY AGAIN
 * button, which cleared error state and re-rendered, could never work.
 */

const KEY = 'morbei_chunk_reload_at';
// Long enough to cover a slow reload, short enough that a visitor who hits a
// second deploy later in the same session still gets recovered automatically.
const COOLDOWN_MS = 20000;

export function isChunkLoadError(error) {
    const message = String(error?.message || error || '');
    return (
        /failed to fetch dynamically imported module/i.test(message) ||
        /error loading dynamically imported module/i.test(message) ||
        /importing a module script failed/i.test(message) ||   // Safari
        /loading chunk \d+ failed/i.test(message)              // older bundlers
    );
}

/**
 * Reload once to pick up the current build. Returns false if a reload was
 * already attempted a moment ago, which means reloading did not help and the
 * caller should show the error rather than loop.
 */
export function reloadForChunkError() {
    let last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* private mode */ }
    if (Date.now() - last < COOLDOWN_MS) return false;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ }
    window.location.reload();
    return true;
}

/**
 * Vite fires this when a modulepreload for a lazy route fails, which is the
 * same staleness one step earlier — before React ever sees it.
 */
export function installChunkErrorHandler() {
    window.addEventListener('vite:preloadError', (event) => {
        // Suppress the error only when a reload is actually happening. If the
        // cooldown says we already tried and it did not help, let Vite rethrow:
        // swallowing it leaves the import resolving to undefined, and the
        // failure resurfaces further down as "Cannot read properties of
        // undefined (reading 'default')" — which names nothing a shopper or a
        // stale-chunk check can recognise.
        if (reloadForChunkError()) event.preventDefault();
    });
}
