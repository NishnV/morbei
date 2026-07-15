/**
 * Customer authentication and account GraphQL queries/mutations
 * for the Shopify Storefront API.
 *
 * Covers: sign up, login, logout, password recovery/reset,
 * profile management, address book, and order history.
 */

/** Shared fragment for customer fields */
const CUSTOMER_FRAGMENT = `
  fragment CustomerFields on Customer {
    id
    firstName
    lastName
    email
    phone
    acceptsMarketing
    createdAt
    updatedAt
    defaultAddress {
      id
      firstName
      lastName
      company
      address1
      address2
      city
      province
      provinceCode
      country
      countryCodeV2
      zip
      phone
    }
    addresses(first: 20) {
      edges {
        node {
          id
          firstName
          lastName
          company
          address1
          address2
          city
          province
          provinceCode
          country
          countryCodeV2
          zip
          phone
        }
      }
    }
    orders(first: 20, sortKey: PROCESSED_AT, reverse: true) {
      edges {
        node {
          id
          orderNumber
          name
          processedAt
          financialStatus
          fulfillmentStatus
          currentTotalPrice {
            amount
            currencyCode
          }
          currentSubtotalPrice {
            amount
            currencyCode
          }
          currentTotalTax {
            amount
            currencyCode
          }
          totalShippingPrice {
            amount
            currencyCode
          }
          statusUrl
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                variant {
                  id
                  title
                  image {
                    url
                    altText
                  }
                  price {
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
          }
          shippingAddress {
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            phone
          }
          successfulFulfillments(first: 5) {
            trackingCompany
            trackingInfo {
              number
              url
            }
          }
        }
      }
    }
  }
`;

// ─── Authentication Mutations ─────────────────────────────────────────

/**
 * Create a new customer account.
 */
export const CUSTOMER_CREATE_MUTATION = `
  mutation CustomerCreate($input: CustomerCreateInput!) {
    customerCreate(input: $input) {
      customer {
        id
        firstName
        lastName
        email
      }
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Log in a customer and receive an access token.
 */
export const CUSTOMER_ACCESS_TOKEN_CREATE_MUTATION = `
  mutation CustomerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
    customerAccessTokenCreate(input: $input) {
      customerAccessToken {
        accessToken
        expiresAt
      }
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Log out by deleting the customer access token.
 */
export const CUSTOMER_ACCESS_TOKEN_DELETE_MUTATION = `
  mutation CustomerAccessTokenDelete($customerAccessToken: String!) {
    customerAccessTokenDelete(customerAccessToken: $customerAccessToken) {
      deletedAccessToken
      deletedCustomerAccessTokenId
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Renew a customer access token before it expires.
 */
export const CUSTOMER_ACCESS_TOKEN_RENEW_MUTATION = `
  mutation CustomerAccessTokenRenew($customerAccessToken: String!) {
    customerAccessTokenRenew(customerAccessToken: $customerAccessToken) {
      customerAccessToken {
        accessToken
        expiresAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ─── Password Recovery ────────────────────────────────────────────────

/**
 * Send a password recovery email to the customer.
 */
export const CUSTOMER_RECOVER_MUTATION = `
  mutation CustomerRecover($email: String!) {
    customerRecover(email: $email) {
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Reset a customer's password using the reset URL token.
 */
export const CUSTOMER_RESET_BY_URL_MUTATION = `
  mutation CustomerResetByUrl($resetUrl: URL!, $password: String!) {
    customerResetByUrl(resetUrl: $resetUrl, password: $password) {
      customer {
        id
        email
      }
      customerAccessToken {
        accessToken
        expiresAt
      }
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

// ─── Profile & Account Queries ────────────────────────────────────────

/**
 * Fetch the currently authenticated customer's full profile.
 * Requires a valid customer access token in the header.
 */
export const CUSTOMER_QUERY = `
  ${CUSTOMER_FRAGMENT}
  query Customer($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      ...CustomerFields
    }
  }
`;

/**
 * Update the current customer's profile fields.
 */
export const CUSTOMER_UPDATE_MUTATION = `
  mutation CustomerUpdate($customerAccessToken: String!, $customer: CustomerUpdateInput!) {
    customerUpdate(customerAccessToken: $customerAccessToken, customer: $customer) {
      customer {
        id
        firstName
        lastName
        email
        phone
        acceptsMarketing
      }
      customerAccessToken {
        accessToken
        expiresAt
      }
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

// ─── Address Book Mutations ───────────────────────────────────────────

/**
 * Add a new address to the customer's address book.
 */
export const CUSTOMER_ADDRESS_CREATE_MUTATION = `
  mutation CustomerAddressCreate($customerAccessToken: String!, $address: MailingAddressInput!) {
    customerAddressCreate(customerAccessToken: $customerAccessToken, address: $address) {
      customerAddress {
        id
        address1
        address2
        city
        province
        country
        zip
        phone
      }
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Update an existing address in the customer's address book.
 */
export const CUSTOMER_ADDRESS_UPDATE_MUTATION = `
  mutation CustomerAddressUpdate($customerAccessToken: String!, $id: ID!, $address: MailingAddressInput!) {
    customerAddressUpdate(customerAccessToken: $customerAccessToken, id: $id, address: $address) {
      customerAddress {
        id
        address1
        address2
        city
        province
        country
        zip
        phone
      }
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Delete an address from the customer's address book.
 */
export const CUSTOMER_ADDRESS_DELETE_MUTATION = `
  mutation CustomerAddressDelete($customerAccessToken: String!, $id: ID!) {
    customerAddressDelete(customerAccessToken: $customerAccessToken, id: $id) {
      deletedCustomerAddressId
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Set a default address for the customer.
 */
export const CUSTOMER_DEFAULT_ADDRESS_UPDATE_MUTATION = `
  mutation CustomerDefaultAddressUpdate($customerAccessToken: String!, $addressId: ID!) {
    customerDefaultAddressUpdate(customerAccessToken: $customerAccessToken, addressId: $addressId) {
      customer {
        id
        defaultAddress {
          id
        }
      }
      customerUserErrors {
        field
        message
        code
      }
    }
  }
`;
