/**
 * Editable site imagery, stored as Shopify metaobjects.
 *
 * Everything outside the product catalogue — the homepage hero, the editorial
 * spreads, the About photos — used to be a hardcoded path to a file in public/,
 * so changing one meant a code edit and a deploy. These live in Shopify instead
 * (Content → Files for the upload, Content → Metaobjects for the slot mapping)
 * so the store owner can swap them without a developer.
 *
 * Shopify was the obvious host: it is already the system of record for products
 * and identity here, the owner already logs into it, and its CDN means
 * shopifyImage() resizing applies to these for free.
 *
 * See SITE_IMAGES.md for the metaobject definition and setup steps.
 */

export const SITE_IMAGES_QUERY = `
  query SiteImages($first: Int!) {
    metaobjects(type: "site_image", first: $first) {
      edges {
        node {
          handle
          slot: field(key: "slot") { value }
          alt: field(key: "alt") { value }
          image: field(key: "image") {
            reference {
              ... on MediaImage {
                image {
                  url
                  altText
                  width
                  height
                }
              }
            }
          }
        }
      }
    }
  }
`;
