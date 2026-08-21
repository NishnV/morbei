/**
 * Hooks to fetch a single product from the Shopify Storefront API.
 *
 * Used on the Product Detail Page. Returns the normalized product with
 * all variants, images, metafields, and SEO data.
 *
 * Results are cached in-memory (see lib/shopifyCache): revisiting a product
 * renders instantly from cache while a fresh copy revalidates behind it. The
 * TTL is deliberately short — this page shows live stock counts.
 */

import { PRODUCT_BY_HANDLE_QUERY, PRODUCT_BY_ID_QUERY } from '../graphql/products';
import { normalizeProduct } from '../utils/normalizeProduct';
import { keyFor, prefetch, TTL } from '../lib/shopifyCache';
import { useCachedQuery } from './useCachedQuery';

const byHandleKey = (handle) => keyFor('product', handle);
const byIdKey = (id) => keyFor('productById', id);

const fromHandle = (result) => normalizeProduct(result.productByHandle);
const fromId = (result) => normalizeProduct(result.product);

/**
 * Fetch a single product by its handle (URL slug).
 *
 * @param {string} handle - The product handle (e.g., "hillary-blazer")
 * @returns {{ data: Object|null, loading: boolean, error: Error|null }}
 */
export function useProduct(handle) {
  return useCachedQuery({
    key: byHandleKey(handle),
    query: PRODUCT_BY_HANDLE_QUERY,
    variables: { handle },
    transform: fromHandle,
    ttl: TTL.PRODUCT,
    skip: !handle,
  });
}

/**
 * Fetch a single product by its Shopify GID.
 *
 * @param {string} id - The full Shopify GID (e.g., "gid://shopify/Product/123")
 * @returns {{ data: Object|null, loading: boolean, error: Error|null }}
 */
export function useProductById(id) {
  return useCachedQuery({
    key: byIdKey(id),
    query: PRODUCT_BY_ID_QUERY,
    variables: { id },
    transform: fromId,
    ttl: TTL.PRODUCT,
    skip: !id,
  });
}

/**
 * Warm the cache for a product the shopper has signalled interest in but not
 * opened yet — hovering a grid tile, or the touchstart before a tap completes.
 * By the time the route transition and the lazy-loaded page chunk are ready,
 * the data is usually already there.
 *
 * Safe to call on every pointer event: it no-ops when the entry is cached or
 * a request is already in flight, and it never throws.
 */
export function prefetchProduct(handle) {
  if (!handle) return;
  prefetch({
    key: byHandleKey(handle),
    query: PRODUCT_BY_HANDLE_QUERY,
    variables: { handle },
    transform: fromHandle,
  });
}
