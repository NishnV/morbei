/**
 * Hook to fetch a single product by handle from Shopify Storefront API.
 *
 * Used on the Product Detail Page. Returns the normalized product with
 * all variants, images, metafields, and SEO data.
 */

import { useState, useEffect } from 'react';
import { shopifyFetch } from '../lib/shopify';
import { PRODUCT_BY_HANDLE_QUERY, PRODUCT_BY_ID_QUERY } from '../graphql/products';
import { normalizeProduct } from '../utils/normalizeProduct';

/**
 * Fetch a single product by its handle (URL slug).
 *
 * @param {string} handle - The product handle (e.g., "hillary-blazer")
 * @returns {{ data: Object|null, loading: boolean, error: Error|null }}
 */
export function useProduct(handle) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!handle) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetch() {
      try {
        setLoading(true);
        setError(null);

        const result = await shopifyFetch({
          query: PRODUCT_BY_HANDLE_QUERY,
          variables: { handle },
        });

        if (!cancelled) {
          setData(normalizeProduct(result.productByHandle));
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
  }, [handle]);

  return { data, loading, error };
}

/**
 * Fetch a single product by its Shopify GID.
 *
 * @param {string} id - The full Shopify GID (e.g., "gid://shopify/Product/123")
 * @returns {{ data: Object|null, loading: boolean, error: Error|null }}
 */
export function useProductById(id) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetch() {
      try {
        setLoading(true);
        setError(null);

        const result = await shopifyFetch({
          query: PRODUCT_BY_ID_QUERY,
          variables: { id },
        });

        if (!cancelled) {
          setData(normalizeProduct(result.product));
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
  }, [id]);

  return { data, loading, error };
}
