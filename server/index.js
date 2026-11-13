import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { initDB, pool } from './db/pg.js';
import authRoutes from './routes/auth.js';
import paymentRoutes from './routes/payment.js';
import orderRoutes from './routes/orders.js';
import shippingRoutes from './routes/shipping.js';
import contactRoutes from './routes/contact.js';
import eventsRoutes from './routes/events.js';
import returnsRoutes from './routes/returns.js';
import adminRoutes from './routes/admin.js';
import wishlistRoutes from './routes/wishlist.js';
import { notifySlackError } from './services/slack.js';
import { startReconciler } from './services/reconcile.js';
import { checkWelcomeOffer } from './services/discount.js';
import { verifyMail, mailTarget } from './services/mailer.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Fail fast on missing configuration — a half-configured payment server
// is worse than one that refuses to boot.
const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_ADMIN_TOKEN',
  'SHOPIFY_STOREFRONT_TOKEN',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
  console.warn('RAZORPAY_WEBHOOK_SECRET not set — the payment webhook will reject all events until configured');
}
// Nothing checked this, and REQUIRED_ENV does not list it, so a short token
// was silently accepted on the most powerful surface in the system.
const ADMIN_TOKEN_MIN_LENGTH = 32;
if (process.env.ADMIN_DASHBOARD_TOKEN && process.env.ADMIN_DASHBOARD_TOKEN.length < ADMIN_TOKEN_MIN_LENGTH) {
    console.warn(
        `ADMIN_DASHBOARD_TOKEN is ${process.env.ADMIN_DASHBOARD_TOKEN.length} characters — `
        + `use at least ${ADMIN_TOKEN_MIN_LENGTH}. It reads every customer's address and can issue refunds.`
    );
}
if (!process.env.SLACK_WEBHOOK_URL) {
  console.warn('SLACK_WEBHOOK_URL not set — server error alerts will not be sent to Slack');
}
// The From address falls back to SMTP_USER, which exists only because this
// store used to send over SMTP. Once those variables are cleared, nothing
// would supply one and every message would go out from "MORBEI <undefined>".
if (!process.env.MAIL_FROM && !process.env.SMTP_USER) {
  console.warn('Neither MAIL_FROM nor SMTP_USER is set — outgoing mail has no From address');
}

// Railway/Vercel sit behind a proxy — needed for correct client IPs in rate limiting
app.set('trust proxy', 1);

app.use(helmet());
// Order list responses carry full item JSON per order and were going out uncompressed.
app.use(compression());

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Keep the raw body around — Razorpay webhook signatures are computed over it
app.use(express.json({
  limit: '200kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Rate limits: generous globally, strict where abuse hurts.
// message must be JSON — the frontend parses every response as JSON.
const limitMsg = { error: 'Too many requests, please try again shortly' };
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Generous on purpose. Browsing never touches this server (the storefront
  // talks to Shopify directly), so this budget is only spent on real intent —
  // and Indian mobile carriers run large-scale CGNAT, which can put a whole
  // city's shoppers behind one address. 300 was low enough to start 429-ing
  // paying customers during a busy hour.
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMsg,
  // Razorpay's webhook is the safety net for payments where the customer closed
  // the tab before /verify ran. It arrives from a small pool of Razorpay IPs, so
  // under load it would burn the shared per-IP budget and get 429'd — dropping
  // exactly the notifications we most need during a sale.
  // Analytics is chatty by design — several events per session — and must
  // never spend the budget a checkout needs. It carries its own limit below.
  skip: (req) => req.path === '/payment/webhook' || req.path.startsWith('/events'),
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: limitMsg });

// Checkout attempts are keyed per authenticated user rather than per IP —
// shared office wifi and mobile-carrier NAT put many real shoppers behind one
// address, and throttling them collectively would block genuine purchases.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMsg,
  // ipKeyGenerator, not a bare req.ip: it collapses an IPv6 address to its /64
  // subnet. A raw IPv6 address is effectively unlimited — a client can source
  // each request from a different address in a range it already owns and never
  // hit the limit. express-rate-limit rejects a bare req.ip here for that reason.
  keyGenerator: (req) => req.headers.authorization?.slice(7, 60) || ipKeyGenerator(req.ip),
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
// Tighter than the rest of /api/auth, because this one posts mail to an
// address a stranger chose. The per-address limits in routes/auth.js are the
// real control — they survive a restart and cannot be dodged by changing IP —
// but this bounds how much one source can send in total. Not lower: Indian
// carrier NAT puts a great many shoppers behind one address, and a limit that
// stops a real customer verifying is a limit that stops a sale.
app.use('/api/auth/email/code', rateLimit({
    windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: limitMsg,
}));
app.use('/api/contact', contactLimiter);
app.use('/api/payment/create-order', checkoutLimiter);
// Generous: a real session fires a handful of these, and Indian carrier NAT
// puts many shoppers on one address. Bounded so an open endpoint cannot be
// used to fill the table.
app.use('/api/events', rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, message: limitMsg }));
// The return lookup takes an order number and an email and says whether they
// go together, which is a guessing game if it is cheap to play. Tight enough
// that walking the order-number range is not worth the effort, loose enough
// that a shopper mistyping their own number a few times is fine.
app.use('/api/returns', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: limitMsg }));
// Same shape of question as the return lookup — an order number and an email,
// answered yes or no — so it needs the same tight budget. Walking the order
// number range must not be cheap.
app.use('/api/orders/lookup', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: limitMsg }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/returns', returnsRoutes);

// Admin surface: the funnel and the returns queue, behind
// ADMIN_DASHBOARD_TOKEN (see middleware/adminToken.js).
// The one endpoint guarded by a single shared secret had no limiter of its
// own, so it inherited the global 1000 per 15 minutes — roughly 96,000 guesses
// a day per address — while returns and the order lookup, which are far less
// powerful, were each capped at 30. This token reads every customer's address
// and issues refunds.
app.use('/api/dashboard', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: limitMsg,
}));
app.use('/api/dashboard', adminRoutes);

app.use('/api/wishlist', wishlistRoutes);

// Liveness — the process is up and serving. This is what Railway's deploy
// healthcheck gates on, so it must not depend on anything that could make a
// good deploy look bad.
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Readiness — the process is up AND can reach its database. Point external
// uptime monitoring at this one: a server that has lost Postgres answers every
// real request with a 500 while /api/health cheerfully reports 'ok'.
app.get('/api/health/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    console.error('Readiness check failed:', err.message);
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

// Central error handler — never leak internals to clients
app.use((err, _req, res, _next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error('Unhandled error:', err);
  notifySlackError('Unhandled error', err).catch(() => {});
  res.status(500).json({ error: 'Something went wrong' });
});

// Ensure tables exist before accepting traffic
initDB()
  .then(() => {
    const server = app.listen(PORT, () => console.log(`MORBEI server running on port ${PORT}`));

    // Prove the mail path before a customer needs it. Non-blocking: a store
    // that cannot send email should still take orders, but it should say so
    // loudly rather than discovering it one failed confirmation at a time.
    verifyMail().then((err) => {
      if (!err) return console.log(`Mail ready (${mailTarget})`);
      console.error(`Mail unusable (${mailTarget}): ${err.message}`);
      notifySlackError(`Mail unusable at boot (${mailTarget})`, err).catch(() => {});
    });
    // Say what the welcome email is actually going to promise. The first
    // draft of it offered a discount code that did not exist in the shop,
    // and nothing anywhere would have said so — an email template is always
    // confident. Non-blocking, and the send path re-checks anyway; this is
    // so a misconfiguration is visible at deploy rather than discovered by
    // a customer typing a dead code at checkout.
    checkWelcomeOffer().catch((err) =>
      console.error('Welcome discount check failed:', err.message));

    // Safety net below the webhook: recovers orders where money was captured
    // but fulfilment never completed. Runs shortly after boot, then hourly.
    startReconciler();

    // Every redeploy sends SIGTERM. Without a handler the process dies
    // instantly, killing whatever was in flight — including a /verify that has
    // taken the customer's money and is partway through creating the Shopify
    // order. The reconciler would eventually recover that, but finishing the
    // request is better than recovering from it.
    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received — draining in-flight requests`);

      server.close(() => {
        pool.end()
          .catch((err) => console.error('Error closing Postgres pool:', err.message))
          .finally(() => process.exit(0));
      });

      // A wedged connection must not hold the deploy open until the platform
      // SIGKILLs us; give real work a window, then go.
      setTimeout(() => {
        console.error('Shutdown timed out — exiting with requests still open');
        process.exit(1);
      }, 15000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exit(1);
  });
