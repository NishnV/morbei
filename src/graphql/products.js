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
      { namespace: "custom", key: "size_guide" },
      { namespace: "custom", key: "material" },
      { namespace: "custom", key: "care_instructions" },
      { namespace: "custom", key: "fit_type" },
      { namespace: "custom", key: "badge" }
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
export const PRODUCT_BY_HANDLE_QUERY = `
  ${PRODUCT_FRAGMENT}
  query ProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      ...ProductFields
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
