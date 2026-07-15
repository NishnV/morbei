/**
 * Hooks for full-text product search and predictive/autocomplete search
 * using the Shopify Storefront API.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { shopifyFetch } from '../lib/shopify';
import { SEARCH_PRODUCTS_QUERY, PREDICTIVE_SEARCH_QUERY } from '../graphql/search';
import { normalizeProduct } from '../utils/normalizeProduct';

/**
 * Sort key mapping for search results.
 */
const SEARCH_SORT_MAP = {
  relevance: { sortKey: 'RELEVANCE', reverse: false },
  'price-low': { sortKey: 'PRICE', reverse: false },
  'price-high': { sortKey: 'PRICE', reverse: true },
};

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
  const [products, setProducts] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });

  const sortConfig = SEARCH_SORT_MAP[sortBy] || SEARCH_SORT_MAP.relevance;

  const search = useCallback(
    async (after = null, append = false) => {
      if (!query || !query.trim()) {
        setProducts([]);
        setTotalCount(0);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const data = await shopifyFetch({
          query: SEARCH_PRODUCTS_QUERY,
          variables: {
            query: query.trim(),
            first: pageSize,
            after,
            sortKey: sortConfig.sortKey,
            reverse: sortConfig.reverse,
            productFilters: productFilters || [],
          },
        });

        const results = data.search;
        const items = results.edges
          .map((edge) => normalizeProduct(edge.node))
          .filter(Boolean);

        setProducts((prev) => (append ? [...prev, ...items] : items));
        setTotalCount(results.totalCount);
        setPageInfo(results.pageInfo);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [query, pageSize, sortConfig.sortKey, sortConfig.reverse, JSON.stringify(productFilters)]
  );

  useEffect(() => {
    search();
  }, [search]);

  const fetchMore = useCallback(() => {
    if (pageInfo.hasNextPage && pageInfo.endCursor) {
      search(pageInfo.endCursor, true);
    }
  }, [pageInfo, search]);

  return {
    data: products,
    totalCount,
    loading,
    error,
    hasNextPage: pageInfo.hasNextPage,
    fetchMore,
  };
}

/**
 * Predictive search for live autocomplete suggestions, with debouncing.
 *
 * @param {string} query - The search input value
 * @param {number} [debounceMs=300] - Debounce time in ms
 * @param {number} [limit=5] - Max number of results per type
 * @returns {{ products: Array, collections: Array, queries: Array, loading: boolean, error: Error|null }}
 */
export function usePredictiveSearch(query, debounceMs = 300, limit = 5) {
  const [products, setProducts] = useState([]);
  const [collections, setCollections] = useState([]);
  const [queries, setQueries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (!query || !query.trim()) {
      setProducts([]);
      setCollections([]);
      setQueries([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    timeoutRef.current = setTimeout(async () => {
      try {
        setError(null);

        const data = await shopifyFetch({
          query: PREDICTIVE_SEARCH_QUERY,
          variables: { query: query.trim(), limit, limitScope: 'EACH' },
        });

        const result = data.predictiveSearch;

        // Normalize predictive products into MORBEI shape
        const normalizedProducts = (result.products || []).map((p) => ({
          id: p.id,
          title: p.title,
          handle: p.handle,
          availableForSale: p.availableForSale,
          img: p.images?.edges?.[0]?.node?.url || '/placeholder.png',
          price: p.priceRange?.minVariantPrice,
          compareAtPrice: p.variants?.edges?.[0]?.node?.compareAtPrice,
        }));

        setProducts(normalizedProducts);
        setCollections(
          (result.collections || []).map((c) => ({
            id: c.id,
            title: c.title,
            handle: c.handle,
            image: c.image?.url || null,
          }))
        );
        setQueries(result.queries || []);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, debounceMs, limit]);

  return {
    data: { products, collections, queries },
    loading,
    error,
  };
}
