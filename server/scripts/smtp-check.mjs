/**
 * Where exactly does outbound mail break?
 *
 * "Connection timeout" from nodemailer means the TCP socket never opened —
 * it says nothing about credentials, TLS or Gmail. This separates the two
 * questions: can this host reach the port at all, and if so, does the login
 * work. Run it where the server actually runs, not on a laptop:
 *
 *   railway run node server/scripts/smtp-check.mjs
 *
 * A laptop almost always passes, which is exactly why it proves nothing.
 */
import net from 'node:net';
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const port = parseInt(process.env.SMTP_PORT || '587');
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

// Raw TCP reach, with a timeout short enough to be worth watching.
function probe(h, p, ms = 8000) {
    return new Promise((resolve) => {
        const started = Date.now();
        const sock = net.connect({ host: h, port: p });
        const done = (result) => {
            sock.destroy();
            resolve({ ...result, ms: Date.now() - started });
        };
        sock.setTimeout(ms);
        sock.on('connect', () => done({ ok: true }));
        sock.on('timeout', () => done({ ok: false, reason: 'timed out — traffic dropped, not refused' }));
        sock.on('error', (e) => done({ ok: false, reason: e.code || e.message }));
    });
}

const secure = process.env.SMTP_SECURE !== undefined
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;

console.log(`env: SMTP_USER=${user ? 'set' : 'MISSING'}  SMTP_PASS=${pass ? 'set' : 'MISSING'}`);
console.log(`     SMTP_HOST=${host}  SMTP_PORT=${port}  secure=${secure}` +
    `${process.env.SMTP_SECURE === undefined ? ' (derived from port)' : ''}`);
console.log(`     STORE_NOTIFICATION_EMAIL=${process.env.STORE_NOTIFICATION_EMAIL || '(unset — falls back to SMTP_USER)'}`);
console.log('');

// 587 is STARTTLS, 465 implicit TLS. If 465 answers and 587 does not, the
// fix is two environment variables. 2525 is only probed for hosts that
// actually serve it — Gmail does not, so including it there would report a
// block that is really just a closed door.
const isGmail = /(^|\.)gmail\.com$/i.test(host) || /(^|\.)googlemail\.com$/i.test(host);
const ports = [...new Set([port, 587, 465, ...(isGmail ? [] : [2525])])];
for (const p of ports) {
    const r = await probe(host, p);
    console.log(`tcp ${host}:${p} — ${r.ok ? `open (${r.ms}ms)` : `unreachable: ${r.reason} (${r.ms}ms)`}`);
}
console.log('');

if (!user || !pass) {
    console.log('skipping login: credentials are not set in this environment');
    process.exit(1);
}

/**
 * Try one (port, TLS mode) pair. A 535 here is a completely different
 * finding from a timeout: it means the server heard us and said no, so the
 * network is fine and the credentials, the mailbox, or the host are not.
 */
async function tryLogin(p, isSecure) {
    const t = nodemailer.createTransport({
        host,
        port: p,
        secure: isSecure,
        auth: { user, pass },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
    });
    try {
        await t.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, code: err.code, message: err.message };
    } finally {
        t.close();
    }
}

// 465 is implicit TLS, 587 is STARTTLS. Providers usually accept one and not
// the other, and a wrong pairing fails in ways that look like other faults.
const combos = [
    { port: 465, secure: true, label: '465 implicit TLS' },
    { port: 587, secure: false, label: '587 STARTTLS' },
];

let authenticated = false;
for (const c of combos) {
    const r = await tryLogin(c.port, c.secure);
    if (r.ok) {
        authenticated = true;
        console.log(`login ok    ${host}:${c.label} accepts ${user}`);
    } else {
        console.log(`login fail  ${host}:${c.label} — ${r.code || ''} ${r.message}`);
    }
}
console.log('');

if (authenticated) {
    console.log('At least one combination works. Set SMTP_PORT and SMTP_SECURE to match it.');
    process.exit(0);
}

// 535 is worth spelling out, because it is the one failure people read as
// "email is broken" when it is really "this mailbox will not accept a
// password over SMTP".
console.log('Nothing authenticated. If the failures above say 535:');
console.log('  - the connection and TLS are fine; the mailbox rejected the password');
console.log('  - SMTP_USER must be the full address, not the part before the @');
console.log('  - a Microsoft 365 mailbox (which is what GoDaddy now sells) has');
console.log('    authenticated SMTP disabled by default, and its real host is');
console.log('    smtp.office365.com:587 — not smtpout.secureserver.net');
console.log('  - with 2FA on the mailbox, only an app password will work');
process.exit(1);
