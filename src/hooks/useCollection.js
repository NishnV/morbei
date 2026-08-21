/**
 * Hook to fetch collection data and products within a collection
 * from the Shopify Storefront API.
 *
 * Supports sorting, filtering, and pagination.
 *
 * Each distinct combination of handle, sort and filters is cached separately
 * (see lib/shopifyCache), so toggling a filter off and back on, or returning
 * from a product page, is instant instead of a fresh round-trip.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { COLLECTIONS_QUERY, COLLECTION_PRODUCTS_QUERY } from '../graphql/collections';
import { normalizeProduct, normalizeCollection, flattenEdges } from '../utils/normalizeProduct';
import { peek, put, runQuery, keyFor, TTL } from '../lib/shopifyCache';
import { useCachedQuery } from './useCachedQuery';

/**
 * Sort key mapping: frontend sort values → Shopify ProductCollectionSortKeys + reverse flag.
 */
const SORT_MAP = {
  featured: { sortKey: 'MANUAL', reverse: false },
  'price-low': { sortKey: 'PRICE', reverse: false },
  'price-high': { sortKey: 'PRICE', reverse: true },
  newest: { sortKey: 'CREATED', reverse: true },
  'best-selling': { sortKey: 'BEST_SELLING', reverse: false },
  'name-asc': { sortKey: 'TITLE', reverse: false },
  'name-desc': { sortKey: 'TITLE', reverse: true },
};

const EMPTY = {
  collection: null,
  products: [],
  availableFilters: [],
  pageInfo: { hasNextPage: false, endCursor: null },
};

/**
 * Fetch all collections.
 *
 * @param {number} [first=50] - Number of collections to fetch
 * @returns {{ data: Array, loading: boolean, error: Error|null }}
 */
export function useCollections(first = 50) {
  return useCachedQuery({
    key: keyFor('collections', { first }),
    query: COLLECTIONS_QUERY,
    variables: { first },
    transform: (result) => flattenEdges(result.collections).map(normalizeCollection).filter(Boolean),
    // The navigation's collection list changes far less often than its contents.
    ttl: TTL.STATIC,
    empty: [],
  });
}

/**
 * Fetch products within a specific collection by handle.
 * Supports sorting, filtering, and pagination.
 *
 * @param {string} handle - The collection handle (e.g., "dresses")
 * @param {Object} [options={}]
 * @param {string} [options.sortBy] - Sort key from SORT_MAP (e.g., "price-low", "newest")
 * @param {Array} [options.filters] - Shopify ProductFilter input array
 * @param {number} [options.pageSize=20] - Products per page
 * @param {boolean} [options.skip] - Skip fetching entirely
 * @returns {{ data: Object, loading: boolean, error: Error|null,
 *             availableFilters: Array, hasNextPage: boolean, fetchMore: Function }}
 */
export function useCollection(handle, { sortBy, filters, pageSize = 20, skip = false } = {}) {
  const sortConfig = SORT_MAP[sortBy] || { sortKey: 'COLLECTION_DEFAULT', reverse: false };
  const inactive = skip || !handle;

  const baseKey = keyFor('collection', {
    handle,
    sortKey: sortConfig.sortKey,
    reverse: sortConfig.reverse,
    filters: filters || [],
    pageSize,
  });

  const initial = () => {
    if (inactive) return { ...EMPTY, loading: false, error: null };
    const hit = peek(baseKey, TTL.LIST);
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
        query: COLLECTION_PRODUCTS_QUERY,
        variables: {
          handle,
          first: pageSize,
          after,
          sortKey: sortConfig.sortKey,
          reverse: sortConfig.reverse,
          filters: filters || [],
        },
        transform: (data) => {
          const col = data.collectionByHandle;
          if (!col) return EMPTY;
          return {
            collection: normalizeCollection(col),
            products: flattenEdges(col.products).map(normalizeProduct).filter(Boolean),
            availableFilters: col.products.filters || [],
            pageInfo: col.products.pageInfo,
          };
        },
      });

      const merged = {
        ...page,
        products: append ? [...stateRef.current.products, ...page.products] : page.products,
      };
      put(baseKey, merged);
      return merged;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseKey, handle, pageSize, sortConfig.sortKey, sortConfig.reverse]
  );

  useEffect(() => {
    if (inactive) return;

    let cancelled = false;
    const hit = peek(baseKey, TTL.LIST);

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
    data: { collection: state.collection, products: state.products },
    loading: state.loading,
    error: state.error,
    availableFilters: state.availableFilters,
    hasNextPage: state.pageInfo.hasNextPage,
    fetchMore,
  };
}
