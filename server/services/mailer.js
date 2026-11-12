import nodemailer from 'nodemailer';

/**
 * How mail actually leaves this process.
 *
 * SMTP from a cloud host turned out to be the fragile part. GoDaddy stopped
 * answering Railway's egress altogether after a spell of failed logins — the
 * symptom changed from "535 Authentication Failed" to a TCP connect that
 * never completes, which no SMTP setting can fix and which took every order
 * confirmation down with it. The same credentials authenticate fine from
 * another IP, so the blocked thing is the address we send from, not the
 * mailbox.
 *
 * An HTTPS API avoids that class of failure: port 443 is not filtered, there
 * is no shared sending IP to lose reputation on, and the provider owns SPF
 * and DKIM so the mail is less likely to be binned as spam at the far end.
 *
 * Resend is used when RESEND_API_KEY is set and the original SMTP transport
 * otherwise, so switching over is one environment variable — and so is
 * rolling back.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_SEND_URL = 'https://api.resend.com/emails';
const RESEND_DOMAINS_URL = 'https://api.resend.com/domains';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');

// 465 is implicit TLS: the server sends nothing and waits for the client to
// open the handshake. Connecting to it in plaintext is not an error either
// side reports — both just wait, until nodemailer gives up with "Greeting
// never received". Deriving this from the port removes a way to be wrong;
// SMTP_SECURE still wins where it is set, for hosts that are unusual.
const SMTP_SECURE = process.env.SMTP_SECURE !== undefined
    ? process.env.SMTP_SECURE === 'true'
    : SMTP_PORT === 465;

export const usingResend = Boolean(RESEND_API_KEY);
export const mailTarget = usingResend ? 'resend (https)' : `${SMTP_HOST}:${SMTP_PORT}`;

const transporter = usingResend ? null : nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    // Nodemailer waits two minutes before giving up on a TCP connect, and ten
    // on an idle socket. When the host's egress drops SMTP the send does not
    // fail — it hangs, holding the request's callback open for the whole two
    // minutes and reporting "Connection timeout" long after the customer has
    // gone. Fail in seconds instead, so the error reaches the logs while the
    // event that caused it is still legible.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
});

const SEND_TIMEOUT_MS = 15000;

/**
 * Send one message. Takes nodemailer's option names whichever transport is in
 * use, so the templates never have to know which one that is.
 *
 * Throws on failure, like sendMail did — every caller already treats a
 * rejected send as non-fatal and logs or alerts on it.
 */
export async function deliver({ from, to, replyTo, subject, html }) {
    if (!usingResend) {
        return transporter.sendMail({ from, to, replyTo, subject, html });
    }

    const body = {
        from,
        // Resend wants an array. Some callers pass a comma-separated string,
        // which SMTP accepted and this would otherwise send as one address.
        to: Array.isArray(to) ? to : String(to).split(',').map((s) => s.trim()).filter(Boolean),
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
    };

    let res;
    try {
        res = await fetch(RESEND_SEND_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
    } catch (err) {
        // A hung provider must not hold a customer's request open. Name the
        // cause rather than letting an AbortError surface as "The operation
        // was aborted", which says nothing about mail.
        throw new Error(
            err.name === 'TimeoutError' || err.name === 'AbortError'
                ? `Resend did not respond within ${SEND_TIMEOUT_MS / 1000}s`
                : `Could not reach Resend: ${err.message}`
        );
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(`Resend refused the message (${res.status}): ${data?.message || data?.name || 'no detail given'}`);
    }
    return data;
}

/**
 * Is the mail path usable from here? Resolves to null on success or an error
 * on failure — never throws, so a caller can log it without wrapping. Worth
 * running at boot: otherwise a broken mail path is discovered by a customer
 * whose order confirmation never arrives.
 */
export async function verifyMail() {
    if (!usingResend) {
        try {
            await transporter.verify();
            return null;
        } catch (err) {
            return err;
        }
    }

    // Resend has no no-op endpoint. Listing domains proves the key is live
    // and, more usefully, that a domain is actually verified — sending from
    // an unverified domain is the failure that looks like nothing is wrong.
    try {
        const res = await fetch(RESEND_DOMAINS_URL, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
            // A sending-only key is not allowed to list domains. That is a
            // deliberate, correct configuration, so it must not page anyone.
            if (data?.name === 'restricted_api_key') {
                console.log('Resend key is sending-only, so the domain check was skipped');
                return null;
            }
            if (res.status === 401 || res.status === 403) {
                return new Error('Resend rejected the API key');
            }
            return new Error(`Resend returned ${res.status} when listing domains`);
        }

        const domains = data?.data || [];
        const verified = domains.filter((d) => d.status === 'verified');
        if (verified.length === 0) {
            // Say what the key can actually see. "No verified domain" is
            // equally true when the domain is sitting unverified and when the
            // key belongs to a different Resend team from the one the domain
            // was added to, and those have opposite fixes — one is a click in
            // the dashboard, the other is the wrong key in Railway.
            const seen = domains.length === 0
                ? 'this API key can see no domains at all, so it probably belongs to a different Resend team than the one the domain was added under'
                : `the key can see ${domains.map((d) => `${d.name} (${d.status})`).join(', ')}`;
            return new Error(`No verified sending domain — ${seen}. Every send will be refused.`);
        }

        // A verified domain is not enough on its own: Resend refuses any From
        // address outside it, and MAIL_FROM is set separately in Railway.
        const fromDomain = String(process.env.MAIL_FROM || process.env.SMTP_USER || '').split('@')[1];
        if (fromDomain && !verified.some((d) => d.name.toLowerCase() === fromDomain.toLowerCase())) {
            return new Error(
                `MAIL_FROM is @${fromDomain} but the verified domain(s) are `
                + `${verified.map((d) => d.name).join(', ')} — Resend will refuse every send.`
            );
        }
        return null;
    } catch (err) {
        return new Error(`Could not reach Resend: ${err.message}`);
    }
}
