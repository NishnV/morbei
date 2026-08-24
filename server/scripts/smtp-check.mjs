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

const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
});

try {
    await transporter.verify();
    console.log(`login ok — ${host}:${port} accepts ${user}`);
    process.exit(0);
} catch (err) {
    console.error(`login failed — ${err.code || ''} ${err.message}`);
    // A reachable port with a failed login is a credentials problem; an
    // unreachable one above is a network problem. They have different fixes.
    process.exit(1);
}
