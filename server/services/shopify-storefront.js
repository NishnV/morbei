const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const API_VERSION = '2024-01';

const CUSTOMER_QUERY = `
    query getCustomer($customerAccessToken: String!) {
        customer(customerAccessToken: $customerAccessToken) {
            id
            email
            firstName
            lastName
            phone
        }
    }
`;

/**
 * Validate a Shopify customer access token by looking the customer up.
 * Returns the customer object, or null if the token is invalid/expired.
 */
export async function getCustomerByToken(customerAccessToken) {
    const url = `https://${SHOPIFY_DOMAIN}/api/${API_VERSION}/graphql.json`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
        },
        body: JSON.stringify({
            query: CUSTOMER_QUERY,
            variables: { customerAccessToken },
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify Storefront API error ${res.status}: ${text}`);
    }
    const json = await res.json();
    if (json.errors?.length) {
        throw new Error(`Shopify Storefront GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
    }
    return json.data?.customer || null;
}
