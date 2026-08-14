/**
 * Shopify Storefront API Client
 *
 * Initializes a reusable GraphQL fetch wrapper for the Shopify Storefront API.
 * Uses environment variables for store domain, access token, and API version.
 * All queries and mutations throughout the app should use the exported `shopifyFetch` function.
 */

const domain = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;
const storefrontToken = import.meta.env.VITE_SHOPIFY_STOREFRONT_TOKEN;
// Keep in sync with SHOPIFY_API_VERSION in server/services/shopify-version.js.
// Shopify serves requests to a retired version using the oldest accessible one
// rather than failing, so a stale pin drifts silently — this was '2024-01'.
const apiVersion = import.meta.env.VITE_SHOPIFY_API_VERSION || '2026-04';

const endpoint = `https://${domain}/api/${apiVersion}/graphql.json`;

/**
 * Sends a GraphQL request to the Shopify Storefront API.
 *
 * @param {Object} options
 * @param {string} options.query - The GraphQL query or mutation string
 * @param {Object} [options.variables={}] - Variables to pass to the query
 * @returns {Promise<Object>} The `data` property from the Shopify response
 * @throws {Error} If the network request fails or Shopify returns GraphQL errors
 */
export async function shopifyFetch({ query, variables = {} }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': storefrontToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error (${response.status}): ${text}`);
  }

  const json = await response.json();

  if (json.errors) {
    const messages = json.errors.map((e) => e.message).join('\n');
    throw new Error(`Shopify GraphQL errors:\n${messages}`);
  }

  return json.data;
}

/**
 * Helper to extract user-facing errors from Shopify mutation responses.
 * Most mutations return a `userErrors` array — this throws if any exist.
 *
 * @param {Array} userErrors - Array of { field, message } from the mutation response
 * @throws {Error} If userErrors is non-empty
 */
export function handleUserErrors(userErrors) {
  if (userErrors && userErrors.length > 0) {
    const messages = userErrors.map((e) => `${e.field?.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Shopify user error: ${messages}`);
  }
}
