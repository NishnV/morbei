import { notifySlackError } from './slack.js';

/**
 * A Shopify Admin token that renews itself.
 *
 * The store's app is configured with expiring access tokens — the Shopify
 * admin shows it plainly: "Expiring access tokens · Expires every 24 hours".
 * A token pasted into SHOPIFY_ADMIN_TOKEN therefore works for a day and then
 * stops, and because every Admin call goes through one helper, the whole
 * backend fails together: checkout prices carts against the Admin API, so a
 * dead token means nobody can buy anything.
 *
 * That is exactly what happened. The app was installed on 13 November, the
 * last Admin call Shopify logged succeeded at 12:03 the next day, and every
 * call after it came back 401 "Invalid API key or access token" — on a store
 * where the app was still installed, with both client secrets intact. The
 * reinstall that fixed it the previous day had not fixed anything; it had
 * reset the same 24-hour clock.
 *
 * The documented answer for an app acting on a store in its own organisation
 * is the client credentials grant: post the client id and secret to the
 * store's token endpoint and get a fresh token, as often as needed. So the
 * server mints its own and keeps it current, and there is no longer a
 * credential for anyone to paste, rotate, or forget.
 *
 * SHOPIFY_ADMIN_TOKEN still works as a fallback when the client credentials
 * are not configured, so this can be deployed before the new variables are
 * set without taking anything else down.
 *
 * Nothing here logs a token or returns one to a caller outside this module's
 * use. Shopify ignores a `scope` parameter on this grant — the token always
 * carries whatever the install granted — so none is sent.
 */

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET?.trim();
const STATIC_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN?.trim();

export const canMintTokens = Boolean(CLIENT_ID && CLIENT_SECRET);

// Shopify says 86399 seconds. Renew an hour early: a token that expires
// mid-request is the failure this exists to prevent, and a wasted mint costs
// one HTTP call a day.
const RENEW_BEFORE_MS = 60 * 60 * 1000;

let cached = null;       // { token, expiresAt }
let inFlight = null;     // dedupes concurrent mints at boot

async function mint() {
    const res = await fetch(
        `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
            }),
        }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
        // The error text can name the client id; the secret is never echoed.
        const detail = body.error_description || body.error || `HTTP ${res.status}`;
        throw new Error(`Could not mint a Shopify Admin token: ${detail}`);
    }
    const lifetimeMs = (Number(body.expires_in) || 86399) * 1000;
    cached = { token: body.access_token, expiresAt: Date.now() + lifetimeMs };
    console.log(`Shopify Admin token minted; valid for ${Math.round(lifetimeMs / 3600000)}h.`);
    return cached.token;
}

/**
 * The token to put in X-Shopify-Access-Token.
 *
 * Falls back to the static one when client credentials are absent, and also
 * when minting fails but a static token exists — during the changeover the
 * pasted token may still have hours left on it, and using it beats failing.
 */
export async function adminToken() {
    if (!canMintTokens) {
        if (!STATIC_TOKEN) throw new Error('No Shopify Admin credentials configured');
        return STATIC_TOKEN;
    }
    if (cached && Date.now() < cached.expiresAt - RENEW_BEFORE_MS) return cached.token;
    if (inFlight) return inFlight;

    inFlight = mint()
        .catch((err) => {
            console.error(err.message);
            notifySlackError('Could not mint a Shopify Admin token', err).catch(() => {});
            if (STATIC_TOKEN) return STATIC_TOKEN;
            throw err;
        })
        .finally(() => { inFlight = null; });
    return inFlight;
}

/**
 * Throw the cached token away.
 *
 * Called when Shopify rejects it, which can happen before our own clock says
 * it expired — a secret rotated, the app reinstalled, the install's scopes
 * changed. The next call mints a new one.
 */
export function forgetAdminToken() {
    cached = null;
}

/** For the readiness endpoint: how the server is authenticating, and for how long. */
export function tokenStatus() {
    if (!canMintTokens) return STATIC_TOKEN ? 'static' : 'missing';
    if (!cached) return 'minting';
    const hours = Math.max(0, Math.round((cached.expiresAt - Date.now()) / 3600000));
    return `self-renewing (${hours}h left)`;
}
