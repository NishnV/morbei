#!/usr/bin/env node
/**
 * Snapshot the Shopify slot → image map into the bundle at build time.
 *
 * Without this, useSiteImages has nothing to show on a first visit until a
 * network round-trip finishes, so <SiteImage> paints the file in public/ and
 * then swaps to the real one. A returning visitor never sees it — the
 * localStorage cache seeds the first render — which is why it looks like an
 * incognito-only bug when it is really every first-time visitor.
 *
 * Baking the map in means the first paint already carries the Shopify URL.
 * The runtime fetch still runs and still wins, so changing an image in the
 * admin takes effect without a deploy; the snapshot only covers the gap
 * before that fetch resolves.
 *
 * Runs as a `prebuild` step. Non-fatal by design, like generate-sitemap: a
 * Shopify outage during CI must not break the deploy. On failure an existing
 * snapshot is left untouched, because a slightly stale map beats an empty one.
 *
 * Env: VITE_SHOPIFY_STORE_DOMAIN, VITE_SHOPIFY_STOREFRONT_TOKEN,
 *      VITE_SHOPIFY_API_VERSION
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './shopify-products.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/generated/site-images.json');

const QUERY = `
  query SiteImages($first: Int!) {
    metaobjects(type: "site_image", first: $first) {
      edges {
        node {
          slot: field(key: "slot") { value }
          alt: field(key: "alt") { value }
          image: field(key: "image") {
            reference { ... on MediaImage { image { url altText width height } } }
          }
        }
      }
    }
  }
`;

function bail(reason) {
    // An existing snapshot is more useful than a fresh empty one.
    if (existsSync(OUT)) {
        console.warn(`site-images: ${reason} — keeping the existing snapshot`);
    } else {
        mkdirSync(dirname(OUT), { recursive: true });
        writeFileSync(OUT, '{}\n');
        console.warn(`site-images: ${reason} — wrote an empty snapshot, local fallbacks will show`);
    }
    process.exit(0);
}

loadEnvFile();

const domain = process.env.VITE_SHOPIFY_STORE_DOMAIN;
const token = process.env.VITE_SHOPIFY_STOREFRONT_TOKEN;
const version = process.env.VITE_SHOPIFY_API_VERSION || '2026-04';

if (!domain || !token) bail('Shopify credentials are not set');

let data;
try {
    const res = await fetch(`https://${domain}/api/${version}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
        body: JSON.stringify({ query: QUERY, variables: { first: 100 } }),
    });
    if (!res.ok) bail(`Shopify returned HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) bail(`Shopify returned errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
    data = json.data;
} catch (err) {
    bail(err.message);
}

const map = {};
for (const edge of data?.metaobjects?.edges || []) {
    const node = edge.node;
    const slot = node.slot?.value?.trim();
    const image = node.image?.reference?.image;
    // A slot with no image is a half-finished admin entry, not an error.
    if (!slot || !image?.url) continue;
    map[slot] = {
        url: image.url,
        alt: node.alt?.value || image.altText || '',
        width: image.width || null,
        height: image.height || null,
    };
}

if (!Object.keys(map).length) bail('no slots came back');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(map, null, 2) + '\n');
console.log(`site-images: snapshotted ${Object.keys(map).length} slots`);
