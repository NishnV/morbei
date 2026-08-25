#!/usr/bin/env node
/**
 * Write a static HTML shell per product with correct Open Graph tags.
 *
 * Why this exists: <Seo> sets per-page tags with react-helmet-async, but that
 * runs in JavaScript. Googlebot renders JS and sees them; the crawlers that
 * generate link previews — WhatsApp, Instagram, Slack, X, iMessage — read the
 * raw HTML response and stop. For a brand whose traffic arrives through
 * Instagram, every shared product link previewing as the generic homepage card
 * is a direct conversion cost.
 *
 * This emits dist/product/<handle>/index.html: a copy of the built shell with
 * the OG/Twitter tags rewritten for that product. Vercel serves a matching
 * static file before it applies the SPA rewrite, so crawlers get real metadata
 * while browsers still boot the same SPA from the same markup.
 *
 * Runs as `postbuild`. Non-fatal by design — a Shopify outage must not break a
 * deploy, so it warns and leaves the SPA rewrite to handle those routes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile, fetchAllProducts, siteUrl } from './shopify-products.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const SHELL = resolve(DIST, 'index.html');

loadEnvFile();
const SITE = siteUrl();

if (!existsSync(SHELL)) {
    console.error('prerender-og: dist/index.html not found — run after vite build');
    process.exit(0);
}

const attrEscape = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const htmlEscape = attrEscape;

const SEO_BLOCK = /<!--seo:start-->[\s\S]*?<!--seo:end-->/;

const DEFAULT_DESCRIPTION =
    'MORBEI — minimalist fashion crafted in India. Dresses, tops and bottoms designed with restraint.';

/** Build the tag block for one route. Must mirror what <Seo> emits at runtime. */
function seoBlock({ title, description, image, path, type = 'website', extra = [] }) {
    const url = `${SITE}${path}`;
    const img = image || `${SITE}/og-image.jpg`;
    return [
        '<!--seo:start-->',
        `<title>${htmlEscape(title)}</title>`,
        `<meta name="description" content="${attrEscape(description)}" />`,
        `<link rel="canonical" href="${attrEscape(url)}" />`,
        `<meta property="og:type" content="${type}" />`,
        `<meta property="og:site_name" content="MORBEI" />`,
        `<meta property="og:title" content="${attrEscape(title)}" />`,
        `<meta property="og:description" content="${attrEscape(description)}" />`,
        `<meta property="og:image" content="${attrEscape(img)}" />`,
        `<meta property="og:url" content="${attrEscape(url)}" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${attrEscape(title)}" />`,
        `<meta name="twitter:description" content="${attrEscape(description)}" />`,
        `<meta name="twitter:image" content="${attrEscape(img)}" />`,
        ...extra,
        '<!--seo:end-->',
    ].join('\n    ');
}

function writeShell(routePath, block, shell) {
    const dir = routePath === '/' ? DIST : resolve(DIST, routePath.replace(/^\//, ''));
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'index.html'), shell.replace(SEO_BLOCK, block));
}

const shell = readFileSync(SHELL, 'utf8');
if (!SEO_BLOCK.test(shell)) {
    console.warn('prerender-og: <!--seo:start--> markers missing from dist/index.html — skipping');
    process.exit(0);
}

// Static routes. Titles/descriptions mirror src/components/Seo.jsx usage.
const STATIC_ROUTES = [
    { path: '/', title: 'MORBEI', description: 'Minimalist fashion crafted in India. Designed with restraint.' },
    { path: '/shop/all', title: 'SHOP | MORBEI', description: 'Shop the full MORBEI collection — minimalist dresses, tops and bottoms crafted in India.' },
    { path: '/shop/dresses', title: 'DRESSES | MORBEI', description: 'Shop MORBEI dresses — minimalist pieces crafted in India.' },
    { path: '/shop/tops', title: 'TOPS | MORBEI', description: 'Shop MORBEI tops — minimalist pieces crafted in India.' },
    { path: '/shop/bottoms', title: 'BOTTOMS | MORBEI', description: 'Shop MORBEI bottoms — minimalist pieces crafted in India.' },
    { path: '/about', title: 'ABOUT | MORBEI', description: DEFAULT_DESCRIPTION },
    { path: '/contact', title: 'CONTACT | MORBEI', description: 'Get in touch with MORBEI.' },
    { path: '/faqs', title: 'FAQ | MORBEI', description: 'Answers to common questions about MORBEI orders, shipping and returns.' },
    { path: '/shipping', title: 'SHIPPING | MORBEI', description: 'Free standard shipping on all domestic orders within India.' },
    { path: '/returns', title: 'RETURNS | MORBEI', description: 'MORBEI returns and exchanges — 14 days from delivery.' },
];

let written = 0;
for (const route of STATIC_ROUTES) {
    writeShell(route.path, seoBlock(route), shell);
    written++;
}

let products = [];
try {
    products = await fetchAllProducts();
} catch (err) {
    console.warn(`prerender-og: product fetch failed (${err.message}) — static routes still written`);
}

for (const product of products) {
    const price = product.priceRange?.minVariantPrice;
    const block = seoBlock({
        path: `/product/${product.handle}`,
        type: 'product',
        title: product.seo?.title || `${product.title.toUpperCase()} | MORBEI`,
        description:
            product.seo?.description ||
            (product.description ? product.description.replace(/\s+/g, ' ').trim().slice(0, 155) : '') ||
            DEFAULT_DESCRIPTION,
        image: product.featuredImage?.url,
        extra: [
            ...(price ? [
                `<meta property="product:price:amount" content="${attrEscape(price.amount)}" />`,
                `<meta property="product:price:currency" content="${attrEscape(price.currencyCode)}" />`,
            ] : []),
            `<meta property="product:availability" content="${product.availableForSale ? 'in stock' : 'out of stock'}" />`,
        ],
    });
    writeShell(`/product/${product.handle}`, block, shell);
    written++;
}

console.log(`prerender-og: wrote ${written} shells (${products.length} products, ${STATIC_ROUTES.length} static routes)`);
