/**
 * Fetch the product catalog from the Shopify Storefront API at build time.
 * Shared by the sitemap generator (prebuild) and the OG prerenderer (postbuild).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Vite loads .env itself, but these scripts run outside that lifecycle. */
export function loadEnvFile() {
    const path = resolve(ROOT, '.env');
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}

const PRODUCTS_QUERY = `
  query BuildProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          handle
          title
          description
          updatedAt
          availableForSale
          seo { title description }
          featuredImage { url }
          priceRange { minVariantPrice { amount currencyCode } }
        }
      }
    }
  }
`;

export async function fetchAllProducts() {
    const domain = process.env.VITE_SHOPIFY_STORE_DOMAIN;
    const token = process.env.VITE_SHOPIFY_STOREFRONT_TOKEN;
    const version = process.env.VITE_SHOPIFY_API_VERSION || '2026-04';
    if (!domain || !token) {
        throw new Error('VITE_SHOPIFY_STORE_DOMAIN / VITE_SHOPIFY_STOREFRONT_TOKEN not set');
    }

    const endpoint = `https://${domain}/api/${version}/graphql.json`;
    const products = [];
    let after = null;

    for (let page = 0; page < 20; page++) { // hard cap — never loop forever in CI
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Storefront-Access-Token': token,
            },
            body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { first: 250, after } }),
        });
        if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
        const json = await res.json();
        if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));

        const conn = json.data.products;
        products.push(...conn.edges.map(e => e.node));
        if (!conn.pageInfo.hasNextPage) break;
        after = conn.pageInfo.endCursor;
    }
    return products;
}

// Keep in sync with SITE_URL in src/components/Seo.jsx.
export const siteUrl = () =>
    (process.env.VITE_SITE_URL || 'https://morbei.com').replace(/\/$/, '');

export const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
