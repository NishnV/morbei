import { promises as dns } from 'node:dns';

/**
 * Can this address's domain receive mail at all?
 *
 * A syntax check passes anything shaped like an address, which is how an
 * order reached us addressed to "@ail.com" — a mistyped gmail.com that
 * publishes no MX record, so nothing could ever be delivered there. The
 * customer got no confirmation, no shipping notice and no way to track, and
 * nobody found out until they wrote in on Instagram.
 *
 * Only a missing domain or a domain with no MX is treated as bad. Every other
 * outcome — a resolver timeout, a network blip, a rate limit — lets the
 * address through: refusing a sale because DNS hiccupped is far worse than
 * accepting the occasional undeliverable address.
 *
 * Note this says nothing about the mailbox. "nobody@gmail.com" passes; only
 * sending finds that out.
 */

const TTL_MS = 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 3000;
const cache = new Map();

export async function domainAcceptsMail(email) {
    const domain = String(email || '').split('@')[1]?.trim().toLowerCase();
    if (!domain) return false;

    const hit = cache.get(domain);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;

    let ok = true;
    try {
        const records = await Promise.race([
            dns.resolveMx(domain),
            new Promise((_, reject) =>
                setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), LOOKUP_TIMEOUT_MS)
            ),
        ]);
        ok = Array.isArray(records) && records.some((r) => r.exchange);
    } catch (err) {
        // ENOTFOUND: no such domain. ENODATA: the domain exists but publishes
        // no MX. Both are definitive. Anything else is our problem, not the
        // customer's, so let it through.
        ok = !(err.code === 'ENOTFOUND' || err.code === 'ENODATA');
        if (ok) console.warn(`MX check for ${domain} inconclusive (${err.code}) — allowing`);
    }

    cache.set(domain, { ok, at: Date.now() });
    return ok;
}
