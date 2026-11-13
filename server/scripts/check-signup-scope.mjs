/**
 * Does server-side signup actually work on this store?
 *
 * Accounts are created through the Admin API so Shopify's own "customer
 * account welcome" can be suppressed — there is no switch for that
 * notification on a non-Plus plan, and it was the first email a new customer
 * ever received, in Shopify's template, pointing at the myshopify domain.
 *
 * That needs the write_customers scope. Without it signup still works, by
 * falling back to the Storefront API, but Shopify's welcome goes out again
 * alongside ours. This says which of the two is happening.
 *
 * Run it where the credentials are:
 *
 *   railway run node server/scripts/check-signup-scope.mjs
 *
 * It creates one customer at example.com — IANA-reserved, which discards all
 * mail, so nothing can reach a real person either way — signs in as them to
 * prove the account is usable, and deletes them again.
 */
import { createCustomer } from '../services/shopify-admin.js';
import { SHOPIFY_API_VERSION } from '../services/shopify-version.js';

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const ADMIN = { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN };
const email = `morbei-scope-check-${Date.now()}@example.com`;
const password = `Check-${Math.random().toString(36).slice(2)}-9aZ`;

let customer;
try {
    customer = await createCustomer({
        email, password, firstName: 'Scope', lastName: 'Check',
        phone: null, acceptsMarketing: false,
    });
} catch (err) {
    if (err.status === 403) {
        console.log('write_customers is NOT granted.\n');
        console.log('  Signup still works — it falls back to the Storefront API — but every');
        console.log("  new customer gets Shopify's welcome email as well as ours.\n");
        console.log('  Add write_customers to the app, release a new version, reinstall it on');
        console.log('  the store, put the new token in SHOPIFY_ADMIN_TOKEN, then run this again.');
        process.exit(1);
    }
    console.log('Creation failed for another reason:', err.message.slice(0, 400));
    process.exit(1);
}

console.log('write_customers IS granted — accounts are created Admin-side.\n');
console.log(`  id             : ${customer.id}`);
console.log(`  state          : ${customer.state}   ${customer.state === 'enabled' ? '(usable)' : '(NOT usable — the password did not take)'}`);
console.log(`  verified_email : ${customer.verified_email}`);

// The site signs in through the Storefront API. If that fails, the account
// exists but nobody can get into it, which is worse than not creating one.
const res = await fetch(`https://${DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({
        query: `mutation($input: CustomerAccessTokenCreateInput!) {
            customerAccessTokenCreate(input: $input) {
                customerAccessToken { accessToken }
                customerUserErrors { code message } } }`,
        variables: { input: { email, password } },
    }),
});
const result = (await res.json()).data?.customerAccessTokenCreate;
console.log(`  sign-in        : ${result?.customerAccessToken
    ? 'works — a real customer could log in with this'
    : `FAILED — ${JSON.stringify(result?.customerUserErrors)}`}`);

const del = await fetch(`https://${DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/customers/${customer.id}.json`,
    { method: 'DELETE', headers: ADMIN });
console.log(`\n  cleanup        : ${del.ok ? 'the check customer was deleted' : `FAILED (${del.status}) — delete customer ${customer.id} by hand`}`);

console.log('\nShopify sends no welcome for an Admin-created customer, so the only');
console.log('welcome a new customer now gets is ours.');
process.exit(0);
