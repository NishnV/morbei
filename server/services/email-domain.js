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

/**
 * "Did you mean gmail.com?"
 *
 * The MX check above catches a domain that cannot receive mail at all, which
 * is what "@ail.com" was. It cannot catch "@gmial.com" or "@yahoo.co", which
 * may be real domains owned by other people — mail sent there leaves,
 * arrives somewhere, and is never seen again. That is worse than bouncing.
 *
 * So: a near-miss against the handful of domains almost every Indian
 * customer actually uses.
 *
 * Only ever ONE edit away, counting a swap of two adjacent letters as one —
 * without that "gmial.com" and "hotmial.com", which are the commonest typos
 * there are, score 2 and go unnoticed. Two edits reaches far enough to
 * "correct" a real address into somebody else's, which is the mistake this
 * exists to stop.
 *
 * Call it only for a domain that passed domainAcceptsMail. A domain with no
 * MX is already definitively wrong and gets told so; guessing at it on top
 * invents an intent nobody expressed. "ail.com" is one edit from "aol.com"
 * and two from "gmail.com" — so the guess would have been confidently wrong
 * about the very address this was written for.
 *
 * Deliberately a small list. A long one starts telling customers their own
 * company address is a typo, which is a worse failure than the one it
 * prevents.
 */
const COMMON_DOMAINS = [
    'gmail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com',
    'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'rediffmail.com',
    'protonmail.com', 'proton.me', 'zoho.com', 'zohomail.in', 'aol.com',
    // Real providers that sit one edit from a bigger one. Listed so they are
    // recognised as themselves rather than "corrected" into it.
    'mail.com', 'gmx.com', 'ymail.com',
];

/**
 * Damerau-Levenshtein, bailing out as soon as it cannot be within `max`.
 * The transposition case is the whole reason this is not plain Levenshtein.
 */
function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let twoAgo = [];
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            row[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
            // "gmial" -> "gmail": one swap, not two substitutions.
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                row[j] = Math.min(row[j], twoAgo[j - 2] + 1);
            }
            if (row[j] < best) best = row[j];
        }
        if (best > max) return max + 1;
        twoAgo = prev;
        prev = row;
    }
    return prev[b.length];
}

/** The domain this address probably meant, or null. */
export function suggestDomain(email) {
    const at = String(email || '').lastIndexOf('@');
    if (at < 0) return null;
    const domain = email.slice(at + 1).trim().toLowerCase();
    if (!domain || COMMON_DOMAINS.includes(domain)) return null;

    // Closest wins, and the list is ordered by how common each is, so a tie
    // resolves towards the likelier intent.
    let best = null;
    let bestDistance = 2;
    for (const candidate of COMMON_DOMAINS) {
        const d = editDistance(domain, candidate, 1);
        if (d < bestDistance) { best = candidate; bestDistance = d; }
    }
    return best;
}
