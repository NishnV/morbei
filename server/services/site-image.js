import { SHOPIFY_API_VERSION } from './shopify-version.js';

/**
 * The owner-chosen photograph for a named slot, for use in email.
 *
 * The site already lets the owner swap any hero or editorial image from the
 * Shopify admin — see SITE_IMAGES.md and useSiteImages.js. An email with a
 * photograph hardcoded into the server would be the one picture on the whole
 * site that needed a deploy to change, which is exactly the trap those slots
 * were built to avoid.
 *
 * So the welcome email reads a slot too. Add an "email-welcome" slot in the
 * admin to give it its own shot; until then it borrows "account-side", which
 * is the same shoot and already the first image a new customer sees.
 *
 * Best-effort by design: a Shopify outage costs the email its photograph, not
 * its delivery. Everything here returns null rather than throwing.
 */

const TTL_MS = 30 * 60 * 1000;
let cache = { at: 0, map: null };

async function loadSlots() {
    if (cache.map && Date.now() - cache.at < TTL_MS) return cache.map;

    const res = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_STOREFRONT_TOKEN,
            },
            body: JSON.stringify({
                query: `{ metaobjects(type: "site_image", first: 50) { edges { node {
                    slot: field(key: "slot") { value }
                    alt: field(key: "alt") { value }
                    image: field(key: "image") { reference { ... on MediaImage {
                        image { url width height altText } } } }
                } } } }`,
            }),
        }
    );
    const body = await res.json();
    const map = {};
    for (const edge of body?.data?.metaobjects?.edges || []) {
        const slot = edge.node?.slot?.value?.trim();
        const image = edge.node?.image?.reference?.image;
        if (!slot || !image?.url) continue;
        map[slot] = { url: image.url, alt: edge.node?.alt?.value || image.altText || '' };
    }
    cache = { at: Date.now(), map };
    return map;
}

/**
 * @param {string[]} slots tried in order; the first one with an image wins.
 * @param {number} width Shopify's CDN resizes on request, so the email is not
 *        made to carry a 3500px original.
 */
export async function emailImage(slots, width = 1100) {
    try {
        const map = await loadSlots();
        for (const slot of slots) {
            const hit = map[slot];
            if (!hit) continue;
            const url = new URL(hit.url);
            url.searchParams.set('width', String(width));
            return { url: url.toString(), alt: hit.alt };
        }
    } catch (err) {
        console.error('site image lookup for email failed:', err.message);
    }
    return null;
}
