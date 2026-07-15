/**
 * Hook to fetch paginated product listings from Shopify Storefront API.
 *
 * Returns { products, loading, error, hasNextPage, fetchMore }
 * Products are normalized to the MORBEI frontend shape.
 */

import { useState, useEffect, useCallback } from 'react';
import { shopifyFetch } from '../lib/shopify';
import { PRODUCTS_QUERY, PRODUCT_RECOMMENDATIONS_QUERY } from '../graphql/products';
import { normalizeProduct, flattenEdges } from '../utils/normalizeProduct';

/**
 * Fetch a paginated list of all products.
 *
 * @param {number} [pageSize=20] - Number of products per page
 * @returns {{ products: Array, loading: boolean, error: Error|null, hasNextPage: boolean, fetchMore: Function }}
 */
export function useProducts(pageSize = 20) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });

  const fetchProducts = useCallback(
    async (after = null, append = false) => {
      try {
        setLoading(true);
        setError(null);

        const data = await shopifyFetch({
          query: PRODUCTS_QUERY,
          variables: { first: pageSize, after },
        });

        const rawProducts = flattenEdges(data.products);
        const normalized = rawProducts.map(normalizeProduct).filter(Boolean);

        setProducts((prev) => (append ? [...prev, ...normalized] : normalized));
        setPageInfo(data.products.pageInfo);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const fetchMore = useCallback(() => {
    if (pageInfo.hasNextPage && pageInfo.endCursor) {
      fetchProducts(pageInfo.endCursor, true);
    }
  }, [pageInfo, fetchProducts]);

  return {
    data: products,
    loading,
    error,
    hasNextPage: pageInfo.hasNextPage,
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
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!productId) return;

    let cancelled = false;

    async function fetch() {
      try {
        setLoading(true);
        setError(null);

        const result = await shopifyFetch({
          query: PRODUCT_RECOMMENDATIONS_QUERY,
          variables: { productId },
        });

        if (!cancelled) {
          const recs = (result.productRecommendations || []).map(normalizeProduct).filter(Boolean);
          setData(recs);
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
  }, [productId]);

  return { data, loading, error };
}
