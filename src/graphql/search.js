/**
 * Search-related GraphQL queries for the Shopify Storefront API.
 *
 * Covers: full-text product search with filters, and predictive/autocomplete search.
 */

/**
 * Full-text search across all products.
 * Supports type filters, price ranges, availability, and sorting.
 *
 * The `query` variable uses Shopify's search syntax, e.g.:
 *   - "red dress" — keyword search
 *   - "product_type:Dresses" — filter by type
 *   - "tag:sale" — filter by tag
 *   - "available_for_sale:true" — only in-stock
 *   - Combine: "red dress product_type:Dresses tag:new"
 *
 * sortKey values: RELEVANCE, PRICE
 */
export const SEARCH_PRODUCTS_QUERY = `
  query SearchProducts(
    $query: String!
    $first: Int!
    $after: String
    $sortKey: SearchSortKeys
    $reverse: Boolean
    $productFilters: [ProductFilter!]
  ) {
    search(
      query: $query
      first: $first
      after: $after
      sortKey: $sortKey
      reverse: $reverse
      types: [PRODUCT]
      productFilters: $productFilters
    ) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ... on Product {
            id
            title
            handle
            description
            vendor
            productType
            tags
            availableForSale
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

/**
 * Predictive search for live autocomplete suggestions.
 * Returns matching products, collections, and query suggestions.
 */
export const PREDICTIVE_SEARCH_QUERY = `
  query PredictiveSearch($query: String!, $limit: Int, $limitScope: PredictiveSearchLimitScope) {
    predictiveSearch(query: $query, limit: $limit, limitScope: $limitScope, types: [PRODUCT, COLLECTION, QUERY]) {
      products {
        id
        title
        handle
        availableForSale
        priceRange {
          minVariantPrice {
            amount
            currencyCode
          }
        }
        images(first: 1) {
          edges {
            node {
              url
              altText
            }
          }
        }
        variants(first: 1) {
          edges {
            node {
              price {
                amount
                currencyCode
              }
              compareAtPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
      collections {
        id
        title
        handle
        image {
          url
          altText
        }
      }
      queries {
        text
        styledText
      }
    }
  }
`;
