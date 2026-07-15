/**
 * Collection-related GraphQL queries for the Shopify Storefront API.
 *
 * Covers: listing all collections, fetching products within a collection
 * with filtering and sorting, and collection metafields.
 */

/** Shared fragment for collection fields */
const COLLECTION_FRAGMENT = `
  fragment CollectionFields on Collection {
    id
    title
    handle
    description
    descriptionHtml
    image {
      id
      url
      altText
      width
      height
    }
    seo {
      title
      description
    }
    metafields(identifiers: [
      { namespace: "custom", key: "banner_image" },
      { namespace: "custom", key: "seo_description" }
    ]) {
      key
      value
      type
      namespace
    }
  }
`;

/**
 * Fetch all collections with pagination.
 */
export const COLLECTIONS_QUERY = `
  ${COLLECTION_FRAGMENT}
  query Collections($first: Int!) {
    collections(first: $first) {
      edges {
        cursor
        node {
          ...CollectionFields
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Fetch a single collection by handle, including its products.
 * Supports sorting via sortKey and reverse flag.
 * Supports Shopify's native product filters.
 *
 * sortKey values: TITLE, PRICE, BEST_SELLING, CREATED, MANUAL, COLLECTION_DEFAULT
 * filters: array of ProductFilter input objects (e.g., { variantOption: { name: "Size", value: "M" } })
 */
export const COLLECTION_PRODUCTS_QUERY = `
  query CollectionProducts(
    $handle: String!
    $first: Int!
    $after: String
    $sortKey: ProductCollectionSortKeys
    $reverse: Boolean
    $filters: [ProductFilter!]
  ) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
      description
      image {
        url
        altText
      }
      seo {
        title
        description
      }
      metafields(identifiers: [
        { namespace: "custom", key: "banner_image" },
        { namespace: "custom", key: "seo_description" }
      ]) {
        key
        value
        type
        namespace
      }
      products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse, filters: $filters) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        filters {
          id
          label
          type
          values {
            id
            label
            count
            input
          }
        }
        edges {
          cursor
          node {
            id
            title
            handle
            availableForSale
            vendor
            productType
            tags
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
            }
            images(first: 4) {
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
            variants(first: 20) {
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
                    url
                    altText
                  }
                }
              }
            }
            metafields(identifiers: [
              { namespace: "custom", key: "badge" }
            ]) {
              key
              value
            }
          }
        }
      }
    }
  }
`;
