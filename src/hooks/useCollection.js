/**
 * Hook to fetch collection data and products within a collection
 * from the Shopify Storefront API.
 *
 * Supports sorting, filtering, and pagination.
 */

import { useState, useEffect, useCallback } from 'react';
import { shopifyFetch } from '../lib/shopify';
import { COLLECTIONS_QUERY, COLLECTION_PRODUCTS_QUERY } from '../graphql/collections';
import { normalizeProduct, normalizeCollection, flattenEdges } from '../utils/normalizeProduct';

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

/**
 * Fetch all collections.
 *
 * @param {number} [first=50] - Number of collections to fetch
 * @returns {{ data: Array, loading: boolean, error: Error|null }}
 */
export function useCollections(first = 50) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      try {
        setLoading(true);
        setError(null);

        const result = await shopifyFetch({
          query: COLLECTIONS_QUERY,
          variables: { first },
        });

        if (!cancelled) {
          const collections = flattenEdges(result.collections).map(normalizeCollection).filter(Boolean);
          setData(collections);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [first]);

  return { data, loading, error };
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
 * @returns {{ collection: Object|null, products: Array, loading: boolean, error: Error|null,
 *             availableFilters: Array, hasNextPage: boolean, fetchMore: Function }}
 */
export function useCollection(handle, { sortBy, filters, pageSize = 20 } = {}) {
  const [collection, setCollection] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [availableFilters, setAvailableFilters] = useState([]);
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });

  const sortConfig = SORT_MAP[sortBy] || { sortKey: 'COLLECTION_DEFAULT', reverse: false };

  const fetchCollection = useCallback(
    async (after = null, append = false) => {
      if (!handle) return;

      try {
        setLoading(true);
        setError(null);

        const data = await shopifyFetch({
          query: COLLECTION_PRODUCTS_QUERY,
          variables: {
            handle,
            first: pageSize,
            after,
            sortKey: sortConfig.sortKey,
            reverse: sortConfig.reverse,
            filters: filters || [],
          },
        });

        const col = data.collectionByHandle;
        if (!col) {
          setCollection(null);
          setProducts([]);
          return;
        }

        setCollection(normalizeCollection(col));

        const rawProducts = flattenEdges(col.products);
        const normalized = rawProducts.map(normalizeProduct).filter(Boolean);
        setProducts((prev) => (append ? [...prev, ...normalized] : normalized));

        setPageInfo(col.products.pageInfo);
        setAvailableFilters(col.products.filters || []);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [handle, pageSize, sortConfig.sortKey, sortConfig.reverse, JSON.stringify(filters)]
  );

  useEffect(() => {
    fetchCollection();
  }, [fetchCollection]);

  const fetchMore = useCallback(() => {
    if (pageInfo.hasNextPage && pageInfo.endCursor) {
      fetchCollection(pageInfo.endCursor, true);
    }
  }, [pageInfo, fetchCollection]);

  return {
    data: { collection, products },
    loading,
    error,
    availableFilters,
    hasNextPage: pageInfo.hasNextPage,
    fetchMore,
  };
}
