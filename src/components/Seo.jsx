import { Helmet } from 'react-helmet-async';

/**
 * Per-route document head.
 *
 * The whole SPA previously shipped one <title>, one description and one OG
 * image from index.html, so every product shared the homepage's card. Product
 * links posted to Instagram or WhatsApp all previewed identically.
 *
 * IMPORTANT LIMITATION: this is client-rendered. Googlebot executes JS and will
 * see these tags, but most social crawlers (WhatsApp, Instagram, Slack, X) read
 * the raw HTML response and will still see index.html's defaults. Fixing that
 * properly needs SSR or prerendering of the product routes — see the audit.
 */

// The canonical origin — must match the domain customers actually visit, or
// every canonical and og:url advertises the wrong host and search engines
// split ranking signals between two domains.
// Override per environment with VITE_SITE_URL (e.g. the vercel.app preview).
// Kept in sync with: public/robots.txt (Sitemap line) and CLIENT_URL on the
// backend, which is the CORS allowlist — a mismatch there fails every API call.
export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://morbei.com').replace(/\/$/, '');

const DEFAULT_DESCRIPTION =
    'MORBEI — minimalist fashion crafted in India. Dresses, tops and bottoms designed with restraint.';

export default function Seo({
    title,
    description = DEFAULT_DESCRIPTION,
    image,
    path = '',
    type = 'website',
    noindex = false,
    jsonLd,
}) {
    const url = `${SITE_URL}${path}`;
    const img = image || `${SITE_URL}/og-image.jpg`;

    return (
        <Helmet prioritizeSeoTags>
            <title>{title}</title>
            <meta name="description" content={description} />
            <link rel="canonical" href={url} />
            {noindex && <meta name="robots" content="noindex, nofollow" />}

            <meta property="og:type" content={type} />
            <meta property="og:site_name" content="MORBEI" />
            <meta property="og:title" content={title} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={img} />
            <meta property="og:url" content={url} />

            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={title} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={img} />

            {jsonLd && (
                <script type="application/ld+json">
                    {JSON.stringify(jsonLd)}
                </script>
            )}
        </Helmet>
    );
}

/** Breadcrumb structured data. crumbs: [{ name, path }] */
export function breadcrumbJsonLd(crumbs) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: c.name,
            item: `${SITE_URL}${c.path}`,
        })),
    };
}
