import { SHOPIFY_API_VERSION } from './shopify-version.js';

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;

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
    const url = `https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
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

/**
 * Create a customer the old way, as a fallback only.
 *
 * Accounts are made through the Admin API so Shopify's own welcome email can
 * be suppressed — see createCustomer in shopify-admin.js. That needs the
 * write_customers scope, which an app reinstall can silently drop; it has
 * happened on this store once already.
 *
 * Without a fallback, losing the scope would mean nobody can register at all.
 * With it, signup keeps working and the only thing lost is the suppression:
 * the customer gets Shopify's welcome as well as ours until the scope is
 * restored, and Slack says so.
 *
 * This is the same mutation the browser used to call, moved behind the
 * server. That difference is the point — the email verification in front of
 * it is now something a caller cannot step around.
 */
export async function createCustomerViaStorefront({ email, password, firstName, lastName, phone, acceptsMarketing }) {
    const res = await fetch(`https://${SHOPIFY_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
        },
        body: JSON.stringify({
            query: `mutation CustomerCreate($input: CustomerCreateInput!) {
                customerCreate(input: $input) {
                    customer { id email }
                    customerUserErrors { field message code }
                } }`,
            variables: {
                input: {
                    email,
                    password,
                    firstName: firstName || '',
                    lastName: lastName || '',
                    acceptsMarketing: Boolean(acceptsMarketing),
                    ...(phone ? { phone } : {}),
                },
            },
        }),
    });
    const body = await res.json();
    const errors = body?.data?.customerCreate?.customerUserErrors || [];
    if (errors.length) {
        const err = new Error(errors.map((e) => e.message).join('; '));
        err.shopifyCodes = errors.map((e) => e.code);
        throw err;
    }
    if (!body?.data?.customerCreate?.customer) {
        throw new Error('Shopify did not create the account.');
    }
    return body.data.customerCreate.customer;
}
