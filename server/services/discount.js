import { SHOPIFY_API_VERSION } from './shopify-version.js';
import { notifySlackError } from './slack.js';
import { adminToken } from './shopify-token.js';

/**
 * Is the welcome email's discount code real?
 *
 * The welcome design promised "use code WELCOMEMB10 for 10% off your first
 * order". That code did not exist — the shop had no discount codes at all —
 * so every new customer would have been handed a code that fails at
 * checkout, in the first email they ever got from the shop.
 *
 * Nothing in the email could have known that. The code and the percentage
 * were words in a template, and words in a template are always true.
 *
 * So the offer is now a question asked of Shopify rather than a constant:
 * the code has to exist, be ACTIVE, and describe itself. The wording comes
 * from the discount, not from configuration, because a code worth 5% and an
 * email claiming 10% is the same failure wearing a different hat.
 *
 * Checked at boot so a misconfiguration is visible immediately, and again at
 * send time behind a cache, because a code deleted or expired an hour after
 * a deploy is no more real than one that never existed.
 */

const CODE = process.env.WELCOME_DISCOUNT_CODE?.trim();
const TTL_MS = 15 * 60 * 1000;

/** Last answer, and the last GOOD answer, which are not the same thing. */
let cache = { at: 0, offer: null };
let lastKnownGood = null;

const money = (amount, currency) => {
    const n = Math.round(Number(amount));
    return currency === 'INR' ? `Rs ${n.toLocaleString('en-IN')}` : `${n} ${currency}`;
};

/**
 * @returns {Promise<{code: string, label: string}|null>} null means say
 *          nothing about a discount, which is always safe.
 */
export async function welcomeOffer() {
    if (!CODE) return null;
    if (cache.offer !== undefined && Date.now() - cache.at < TTL_MS) return cache.offer;

    let offer = null;
    try {
        const res = await fetch(
            `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': await adminToken(),
                },
                body: JSON.stringify({
                    query: `query($code: String!) { codeDiscountNodeByCode(code: $code) { codeDiscount {
                        __typename
                        ... on DiscountCodeBasic { status appliesOncePerCustomer
                            customerGets { value {
                                ... on DiscountPercentage { percentage }
                                ... on DiscountAmount { amount { amount currencyCode } } } } }
                        ... on DiscountCodeFreeShipping { status appliesOncePerCustomer }
                        ... on DiscountCodeBxgy { status }
                    } } }`,
                    variables: { code: CODE },
                }),
            }
        );
        const body = await res.json();
        if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 200));

        const d = body?.data?.codeDiscountNodeByCode?.codeDiscount;
        if (!d) {
            offer = { error: `no discount code "${CODE}" exists in this shop` };
        } else if (d.status !== 'ACTIVE') {
            // SCHEDULED and EXPIRED both read as a working code in an email
            // and fail at the till.
            offer = { error: `the code "${CODE}" is ${String(d.status).toLowerCase()}, not active` };
        } else {
            const v = d.customerGets?.value;
            if (v?.percentage != null) {
                offer = { code: CODE, label: `${Math.round(v.percentage * 100)}% off your first order` };
            } else if (v?.amount?.amount != null) {
                offer = { code: CODE, label: `${money(v.amount.amount, v.amount.currencyCode)} off your first order` };
            } else if (d.__typename === 'DiscountCodeFreeShipping') {
                offer = { code: CODE, label: 'free shipping on your first order' };
            } else {
                // Buy-X-get-Y and anything else cannot be summarised in a
                // clause without risking a claim the discount does not keep.
                offer = { error: `the code "${CODE}" is a ${d.__typename} — too complex to describe in one line` };
            }
        }
    } catch (err) {
        // Shopify unreachable is our problem, not the customer's. Falling
        // back to the last answer we trusted beats both lying and silently
        // dropping a discount that is perfectly valid.
        console.error('welcome discount lookup failed:', err.message);
        cache = { at: Date.now(), offer: lastKnownGood };
        return lastKnownGood;
    }

    if (offer?.error) {
        cache = { at: Date.now(), offer: null };
        return null;
    }
    lastKnownGood = offer;
    cache = { at: Date.now(), offer };
    return offer;
}

/**
 * The boot-time check. Says plainly which of the three states the shop is in,
 * because a silently-absent discount line looks identical to a working one
 * from the server's side.
 */
export async function checkWelcomeOffer() {
    if (!CODE) {
        console.log('Welcome email: no WELCOME_DISCOUNT_CODE set — no discount is offered.');
        return;
    }
    // Reach past the cache to get the reason, not just the null.
    cache = { at: 0, offer: null };
    const offer = await welcomeOffer();
    if (offer) {
        console.log(`Welcome email: offering ${offer.label} with code ${offer.code}.`);
        return;
    }
    const message = `WELCOME_DISCOUNT_CODE is set to "${CODE}" but it cannot be offered — `
        + 'the welcome email will go out without a discount line. Create the code in '
        + 'Shopify, or unset the variable.';
    console.warn(`Welcome email: ${message}`);
    notifySlackError('Welcome email discount is misconfigured', new Error(message)).catch(() => {});
}
