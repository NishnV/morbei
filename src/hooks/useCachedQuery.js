/**
 * Shared plumbing for the single-result Storefront hooks.
 *
 * Handles the three things every one of them was getting wrong: serving a
 * cached copy on mount instead of a spinner, de-duplicating concurrent callers
 * of the same query, and resetting cleanly when the key changes so a route
 * change never paints the previous product's data.
 */

import { useState, useEffect, useRef } from 'react';
import { peek, runQuery, TTL } from '../lib/shopifyCache';

/**
 * @param {Object}   options
 * @param {string}   options.key        Stable cache key (build it with keyFor).
 * @param {string}   options.query      GraphQL document.
 * @param {Object}   options.variables  Query variables.
 * @param {Function} options.transform  Raw response → the shape components want.
 * @param {number}   [options.ttl]      Freshness window; stale data still renders.
 * @param {boolean}  [options.skip]     Don't fetch (e.g. the id isn't known yet).
 * @param {*}        [options.empty]    Value used while skipped or before first load.
 */
export function useCachedQuery({ key, query, variables, transform, ttl = TTL.LIST, skip = false, empty = null }) {
    // Keep the non-primitive arguments in a ref so the effect can depend on the
    // cache key alone — objects and closures get new identities every render.
    const latest = useRef({ query, variables, transform });
    latest.current = { query, variables, transform };

    const initial = () => {
        if (skip) return { data: empty, loading: false, error: null };
        const hit = peek(key, ttl);
        return { data: hit ? hit.data : empty, loading: !hit, error: null };
    };

    const [state, setState] = useState(initial);

    // React's documented pattern for resetting state when an input changes:
    // adjust during render rather than in an effect, so there is never a frame
    // showing the previous key's data.
    const [renderedKey, setRenderedKey] = useState(key);
    if (key !== renderedKey) {
        setRenderedKey(key);
        setState(initial);
    }

    useEffect(() => {
        if (skip) return;

        let cancelled = false;
        const hit = peek(key, ttl);

        if (hit) {
            setState({ data: hit.data, loading: false, error: null });
            if (!hit.stale) return; // fresh enough — no network at all
        }

        const { query: q, variables: v, transform: t } = latest.current;
        runQuery({ key, query: q, variables: v, transform: t })
            .then((data) => {
                if (!cancelled) setState({ data, loading: false, error: null });
            })
            .catch((error) => {
                // A failed revalidation must not blow away good cached data —
                // only surface the error when we have nothing to show.
                if (cancelled) return;
                setState((prev) => (hit ? { ...prev, loading: false } : { data: empty, loading: false, error }));
            });

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, skip, ttl]);

    return state;
}
