/**
 * Hook to fetch paginated product listings from Shopify Storefront API.
 *
 * Returns { data, loading, error, hasNextPage, fetchMore }
 * Products are normalized to the MORBEI frontend shape.
 *
 * The accumulated result — every page loaded so far, plus the cursor — is
 * cached under one key (see lib/shopifyCache), so returning to a grid after
 * visiting a product restores the whole list including any "load more" pages,
 * rather than resetting to page one behind a full-screen loader.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { PRODUCTS_QUERY, PRODUCT_RECOMMENDATIONS_QUERY } from '../graphql/products';
import { normalizeProduct, flattenEdges } from '../utils/normalizeProduct';
import { peek, put, runQuery, keyFor, TTL } from '../lib/shopifyCache';
import { useCachedQuery } from './useCachedQuery';

const EMPTY_PAGE = { products: [], pageInfo: { hasNextPage: false, endCursor: null } };

/**
 * Fetch a paginated list of all products.
 *
 * @param {number} [pageSize=20] - Number of products per page
 * @param {Object} [options={}]
 * @param {boolean} [options.skip] - Skip fetching entirely (the caller isn't using the result)
 * @returns {{ data: Array, loading: boolean, error: Error|null, hasNextPage: boolean, fetchMore: Function }}
 */
export function useProducts(pageSize = 20, { skip = false } = {}) {
  const baseKey = keyFor('products', { pageSize });

  const initial = () => {
    if (skip) return { ...EMPTY_PAGE, loading: false, error: null };
    const hit = peek(baseKey, TTL.LIST);
    return hit ? { ...hit.data, loading: false, error: null } : { ...EMPTY_PAGE, loading: true, error: null };
  };

  const [state, setState] = useState(initial);

  const [renderedKey, setRenderedKey] = useState(baseKey);
  if (baseKey !== renderedKey) {
    setRenderedKey(baseKey);
    setState(initial);
  }

  // fetchMore must not be re-created on every state change, or the effects in
  // consuming components that depend on it would loop.
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(
    async (after = null, append = false) => {
      const pageKey = after ? `${baseKey}@${after}` : baseKey + '@first';
      const page = await runQuery({
        key: pageKey,
        query: PRODUCTS_QUERY,
        variables: { first: pageSize, after },
        transform: (data) => ({
          products: flattenEdges(data.products).map(normalizeProduct).filter(Boolean),
          pageInfo: data.products.pageInfo,
        }),
      });

      const merged = {
        products: append ? [...stateRef.current.products, ...page.products] : page.products,
        pageInfo: page.pageInfo,
      };
      put(baseKey, merged);
      return merged;
    },
    [baseKey, pageSize]
  );

  useEffect(() => {
    if (skip) return;

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
        setState((prev) => (hit ? { ...prev, loading: false } : { ...EMPTY_PAGE, loading: false, error }));
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, skip]);

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
    loading: state.loading,
    error: state.error,
    hasNextPage: state.pageInfo.hasNextPage,
    fetchMore,
  };
}

/**
 * Fetch product recommendations for a given product ID.
 *
 * @param {string} productId - Shopify product GID
 * @returns {{ data: Array, loading: boolean, error: Error|null }}
 */
export function useProductRecommendations(productId) {
  return useCachedQuery({
    key: keyFor('recommendations', productId),
    query: PRODUCT_RECOMMENDATIONS_QUERY,
    variables: { productId },
    transform: (result) => (result.productRecommendations || []).map(normalizeProduct).filter(Boolean),
    // Recommendations are a merchandising choice, not live data.
    ttl: TTL.STATIC,
    skip: !productId,
    empty: [],
  });
}
