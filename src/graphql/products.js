/**
 * Product-related GraphQL queries for the Shopify Storefront API.
 *
 * Covers: product listing with pagination, single product by handle,
 * product recommendations, and product variants with metafields.
 */

/** Shared fragment for product fields used across multiple queries */
const PRODUCT_FRAGMENT = `
  fragment ProductFields on Product {
    id
    title
    handle
    description
    descriptionHtml
    vendor
    productType
    tags
    availableForSale
    createdAt
    seo {
      title
      description
    }
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
        currencyCode
      }
    }
    compareAtPriceRange {
      minVariantPrice {
        amount
        currencyCode
      }
      maxVariantPrice {
        amount
        currencyCode
      }
    }
    images(first: 10) {
      edges {
        node {
          id
          url
          altText
          width
          height
        }
      }
    }
    variants(first: 50) {
      edges {
        node {
          id
          title
          availableForSale
          quantityAvailable
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
          selectedOptions {
            name
            value
          }
          image {
            id
            url
            altText
            width
            height
          }
        }
      }
    }
    metafields(identifiers: [
      { namespace: "custom", key: "product_measurement" },
      { namespace: "custom", key: "composition_and_care" },
      { namespace: "custom", key: "shipping" },
      { namespace: "custom", key: "size_guide" },
      { namespace: "custom", key: "material" },
      { namespace: "custom", key: "care_instructions" },
      { namespace: "custom", key: "fit_type" },
      { namespace: "custom", key: "badge" },
      { namespace: "custom", key: "model_info" },
      { namespace: "custom", key: "measurements" }
    ]) {
      key
      value
      type
      namespace
    }
  }
`;

/**
 * Fetch a paginated list of products.
 * @param {number} first - Number of products to fetch (default 20)
 * @param {string|null} after - Cursor for pagination
 */
export const PRODUCTS_QUERY = `
  ${PRODUCT_FRAGMENT}
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ...ProductFields
        }
      }
    }
  }
`;

/**
 * Fetch a single product by its handle (URL slug).
 * Used on the Product Detail Page.
 */
/**
 * Shopify's standard product-taxonomy colour, set in the admin under
 * Product → Metafields → "Color". It resolves to a built-in metaobject that
 * carries both a display label ("Black") and the actual hex ("#000000"), so
 * the swatch is the merchant's real colour rather than a guess from the name.
 *
 * Requested only on the single-product queries: the swatch renders on the
 * product page, and resolving metaobject references for every tile in a 40-item
 * grid would multiply the query cost for nothing.
 */
const COLOR_PATTERN_FIELDS = `
  colorPattern: metafield(namespace: "shopify", key: "color-pattern") {
    references(first: 5) {
      edges {
        node {
          ... on Metaobject {
            handle
            fields { key value }
          }
        }
      }
    }
  }
`;

/**
 * Product media — images *and* video, in the order set in the Shopify admin.
 *
 * The `images` connection in ProductFields returns images only, so a video
 * uploaded against a product was silently dropped from the gallery and the
 * media order collapsed. This is the connection that carries both.
 *
 * Single-product queries only, for the same reason as the colour metafield
 * above: the grid tiles need one still each, and pulling every rendition URL
 * for 40 products would multiply the query cost for nothing.
 *
 * Shopify transcodes each upload into an HLS stream plus MP4 renditions at
 * 1080p/720p/480p. `sources` lists all of them; the UI picks from there.
 */
const MEDIA_FIELDS = `
  media(first: 12) {
    edges {
      node {
        mediaContentType
        alt
        ... on MediaImage {
          image { url width height }
        }
        ... on Video {
          previewImage { url width height }
          sources { url mimeType format width height }
        }
      }
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `
  ${PRODUCT_FRAGMENT}
  query ProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      ...ProductFields
      ${COLOR_PATTERN_FIELDS}
      ${MEDIA_FIELDS}
    }
  }
`;

/**
 * Fetch a single product by its Shopify GID.
 * Useful when you have the product ID from cart or other sources.
 */
export const PRODUCT_BY_ID_QUERY = `
  ${PRODUCT_FRAGMENT}
  query ProductById($id: ID!) {
    product(id: $id) {
      ...ProductFields
      ${COLOR_PATTERN_FIELDS}
      ${MEDIA_FIELDS}
    }
  }
`;

/**
 * Fetch recommended products for a given product ID.
 * Shopify returns up to 10 recommendations based on purchase patterns and product data.
 */
export const PRODUCT_RECOMMENDATIONS_QUERY = `
  ${PRODUCT_FRAGMENT}
  query ProductRecommendations($productId: ID!) {
    productRecommendations(productId: $productId) {
      ...ProductFields
    }
  }
`;
