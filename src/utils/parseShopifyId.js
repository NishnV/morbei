/**
 * Utility to parse Shopify's base64-encoded Global IDs (GIDs).
 *
 * Shopify GIDs look like: "gid://shopify/Product/1234567890"
 * They are sometimes base64-encoded in responses.
 */

/**
 * Decode a base64-encoded Shopify GID and extract the numeric ID.
 *
 * @param {string} gid - The Shopify GID (e.g., "gid://shopify/Product/123" or base64-encoded)
 * @returns {string} The numeric ID portion
 */
export function parseShopifyId(gid) {
  if (!gid) return '';

  let decoded = gid;

  // If it looks like base64 (no "gid://" prefix), decode it
  if (!gid.startsWith('gid://')) {
    try {
      decoded = atob(gid);
    } catch {
      return gid;
    }
  }

  // Extract the last segment (the numeric ID)
  const parts = decoded.split('/');
  return parts[parts.length - 1];
}

/**
 * Get the resource type from a Shopify GID.
 *
 * @param {string} gid - The Shopify GID
 * @returns {string} The resource type (e.g., "Product", "Collection", "ProductVariant")
 */
export function getResourceType(gid) {
  if (!gid) return '';

  let decoded = gid;
  if (!gid.startsWith('gid://')) {
    try {
      decoded = atob(gid);
    } catch {
      return '';
    }
  }

  const parts = decoded.split('/');
  return parts.length >= 4 ? parts[3] : '';
}

/**
 * Encode a numeric ID back into a Shopify GID.
 *
 * @param {string} type - The resource type (e.g., "Product", "ProductVariant")
 * @param {string|number} id - The numeric ID
 * @returns {string} Full GID string (e.g., "gid://shopify/Product/123")
 */
export function toShopifyGid(type, id) {
  return `gid://shopify/${type}/${id}`;
}
