/**
 * Hooks for full-text product search and predictive/autocomplete search
 * using the Shopify Storefront API.
 *
 * Both are cached by query text (see lib/shopifyCache). That matters most for
 * the autocomplete: typing "dress", backspacing to "dres" and retyping used to
 * fire a fresh request for every keystroke the debounce let through, including
 * ones we had already answered a second earlier.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SEARCH_PRODUCTS_QUERY, PREDICTIVE_SEARCH_QUERY } from '../graphql/search';
import { normalizeProduct } from '../utils/normalizeProduct';
import { peek, put, runQuery, keyFor, TTL } from '../lib/shopifyCache';

/**
 * Sort key mapping for search results.
 */
const SEARCH_SORT_MAP = {
  relevance: { sortKey: 'RELEVANCE', reverse: false },
  'price-low': { sortKey: 'PRICE', reverse: false },
  'price-high': { sortKey: 'PRICE', reverse: true },
};

const EMPTY = { products: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } };
const EMPTY_PREDICTIVE = { products: [], collections: [], queries: [] };

/**
 * Full-text product search with filtering and pagination.
 *
 * @param {string} query - Search query text
 * @param {Object} [options={}]
 * @param {string} [options.sortBy] - Sort option ("relevance", "price-low", "price-high")
 * @param {Array} [options.productFilters] - Shopify ProductFilter array
 * @param {number} [options.pageSize=20] - Results per page
 * @returns {{ data: Array, totalCount: number, loading: boolean, error: Error|null,
 *             hasNextPage: boolean, fetchMore: Function }}
 */
export function useSearch(query, { sortBy, productFilters, pageSize = 20 } = {}) {
  const sortConfig = SEARCH_SORT_MAP[sortBy] || SEARCH_SORT_MAP.relevance;
  const term = (query || '').trim();
  const inactive = !term;

  const baseKey = keyFor('search', {
    term,
    sortKey: sortConfig.sortKey,
    reverse: sortConfig.reverse,
    filters: productFilters || [],
    pageSize,
  });

  const initial = () => {
    if (inactive) return { ...EMPTY, loading: false, error: null };
    const hit = peek(baseKey, TTL.SEARCH);
    return hit ? { ...hit.data, loading: false, error: null } : { ...EMPTY, loading: true, error: null };
  };

  const [state, setState] = useState(initial);

  const [renderedKey, setRenderedKey] = useState(baseKey);
  if (baseKey !== renderedKey) {
    setRenderedKey(baseKey);
    setState(initial);
  }

  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(
    async (after = null, append = false) => {
      const pageKey = after ? `${baseKey}@${after}` : `${baseKey}@first`;
      const page = await runQuery({
        key: pageKey,
        query: SEARCH_PRODUCTS_QUERY,
        variables: {
          query: term,
          first: pageSize,
          after,
          sortKey: sortConfig.sortKey,
          reverse: sortConfig.reverse,
          productFilters: productFilters || [],
        },
        transform: (data) => ({
          products: data.search.edges.map((edge) => normalizeProduct(edge.node)).filter(Boolean),
          totalCount: data.search.totalCount,
          pageInfo: data.search.pageInfo,
        }),
      });

      const merged = {
        ...page,
        products: append ? [...stateRef.current.products, ...page.products] : page.products,
      };
      put(baseKey, merged);
      return merged;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseKey, term, pageSize, sortConfig.sortKey, sortConfig.reverse]
  );

  useEffect(() => {
    if (inactive) return;

    let cancelled = false;
    const hit = peek(baseKey, TTL.SEARCH);

    if (hit) {
      setState({ ...hit.data, loading: false, error: null });
      if (!hit.stale) return;
    }

    load(null, false)
      .then((merged) => {
        if (!cancelled) setState({ ...merged, loading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setState((prev) => (hit ? { ...prev, loading: false } : { ...EMPTY, loading: false, error }));
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, inactive]);

  const fetchMore = useCallback(() => {
    const { pageInfo } = stateRef.current;
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) return;

    setState((prev) => ({ ...prev, loading: true }));
    load(pageInfo.endCursor, true)
      .then((merged) => setState({ ...merged, loading: false, error: null }))
      .catch((error) => setState((prev) => ({ ...prev, loading: false, error })));
  }, [load]);

  return {
    data: state.products,
    totalCount: state.totalCount,
    loading: state.loading,
    error: state.error,
    hasNextPage: state.pageInfo.hasNextPage,
    fetchMore,
  };
}

/**
 * Predictive search for live autocomplete suggestions, with debouncing.
 *
 * @param {string} query - The search input value
 * @param {number} [debounceMs=300] - Debounce time in ms
 * @param {number} [limit=5] - Max number of results per type
 * @returns {{ data: Object, loading: boolean, error: Error|null }}
 */
export function usePredictiveSearch(query, debounceMs = 300, limit = 5) {
  const term = (query || '').trim();
  // State is tagged with the term it belongs to, so results for a term the
  // shopper has already typed past are never rendered against the new one —
  // and clearing the box needs no state update at all, just a different derivation.
  const [state, setState] = useState({ term: '', ...EMPTY_PREDICTIVE, error: null });
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!term) return;

    const key = keyFor('predictive', { term, limit });
    const hit = peek(key, TTL.SEARCH);
    // A term we have already answered this session — very common when
    // backspacing — needs no debounce and no request, just the next tick.
    const isWarm = Boolean(hit && !hit.stale);
    const delay = isWarm ? 0 : debounceMs;

    let cancelled = false;
    timeoutRef.current = setTimeout(() => {
      if (isWarm) {
        setState({ term, ...hit.data, error: null });
        return;
      }

      runQuery({
        key,
        query: PREDICTIVE_SEARCH_QUERY,
        variables: { query: term, limit, limitScope: 'EACH' },
        transform: (data) => {
          const result = data.predictiveSearch;
          return {
            // Predictive results carry a slimmer shape than the full product
            // query, so they're normalized here rather than via normalizeProduct.
            products: (result.products || []).map((p) => ({
              id: p.id,
              title: p.title,
              handle: p.handle,
              availableForSale: p.availableForSale,
              img: p.images?.edges?.[0]?.node?.url || '/placeholder.png',
              price: p.priceRange?.minVariantPrice,
              compareAtPrice: p.variants?.edges?.[0]?.node?.compareAtPrice,
            })),
            collections: (result.collections || []).map((c) => ({
              id: c.id,
              title: c.title,
              handle: c.handle,
              image: c.image?.url || null,
            })),
            queries: result.queries || [],
          };
        },
      })
        .then((data) => {
          if (!cancelled) setState({ term, ...data, error: null });
        })
        .catch((error) => {
          if (!cancelled) setState({ term, ...EMPTY_PREDICTIVE, error });
        });
    }, delay);

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [term, debounceMs, limit]);

  const settled = state.term === term;

  return {
    data: settled
      ? { products: state.products, collections: state.collections, queries: state.queries }
      : EMPTY_PREDICTIVE,
    // Anything typed but not yet answered is loading — no state update needed
    // to represent it, which is what let the old version flash stale results.
    loading: Boolean(term) && !settled,
    error: settled ? state.error : null,
  };
}
