#!/usr/bin/env node
/**
 * Generate public/sitemap.xml from the live Shopify catalog at build time.
 *
 * Runs as a `prebuild` step. Deliberately non-fatal: a Shopify outage or a
 * missing token during CI must not break the deploy. It falls back to writing
 * the static routes alone and warns, because shipping the site without a
 * sitemap is a bad day, and not shipping at all is a worse one.
 *
 * Env: VITE_SHOPIFY_STORE_DOMAIN, VITE_SHOPIFY_STOREFRONT_TOKEN,
 *      VITE_SHOPIFY_API_VERSION, VITE_SITE_URL
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, fetchAllProducts, siteUrl, xmlEscape } from './shopify-products.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/sitemap.xml');

loadEnvFile();

// Keep in sync with SITE_URL in src/components/Seo.jsx and the Sitemap line in
// public/robots.txt when the custom domain lands.
const SITE = siteUrl();

// path, changefreq, priority
const STATIC_ROUTES = [
    ['/', 'daily', '1.0'],
    ['/shop/all', 'daily', '0.9'],
    ['/shop/dresses', 'weekly', '0.8'],
    ['/shop/tops', 'weekly', '0.8'],
    ['/shop/bottoms', 'weekly', '0.8'],
    ['/about', 'monthly', '0.5'],
    ['/contact', 'monthly', '0.4'],
    ['/faqs', 'monthly', '0.4'],
    ['/shipping', 'monthly', '0.3'],
    ['/returns', 'monthly', '0.3'],
    ['/privacy', 'yearly', '0.2'],
    ['/terms', 'yearly', '0.2'],
];




function buildXml(products) {
    const today = new Date().toISOString().split('T')[0];
    const urls = [
        ...STATIC_ROUTES.map(([path, freq, pri]) =>
            `  <url>\n    <loc>${xmlEscape(SITE + path)}</loc>\n    <lastmod>${today}</lastmod>\n` +
            `    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`),
        ...products.map((p) =>
            `  <url>\n    <loc>${xmlEscape(`${SITE}/product/${p.handle}`)}</loc>\n` +
            `    <lastmod>${(p.updatedAt || today).split('T')[0]}</lastmod>\n` +
            `    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

let products = [];
try {
    products = await fetchAllProducts();
    console.log(`sitemap: fetched ${products.length} products from Shopify`);
} catch (err) {
    console.warn(`sitemap: could not fetch products (${err.message}) — writing static routes only`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buildXml(products));
console.log(`sitemap: wrote ${STATIC_ROUTES.length + products.length} URLs to public/sitemap.xml`);
