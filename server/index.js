import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initDB } from './db/pg.js';
import authRoutes from './routes/auth.js';
import paymentRoutes from './routes/payment.js';
import orderRoutes from './routes/orders.js';
import shippingRoutes from './routes/shipping.js';
import contactRoutes from './routes/contact.js';
import wishlistRoutes from './routes/wishlist.js';
import { notifySlackError } from './services/slack.js';

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
if (!process.env.SLACK_WEBHOOK_URL) {
  console.warn('SLACK_WEBHOOK_URL not set — server error alerts will not be sent to Slack');
}

// Railway/Vercel sit behind a proxy — needed for correct client IPs in rate limiting
app.set('trust proxy', 1);

app.use(helmet());

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
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: limitMsg });

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/contact', contactLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/wishlist', wishlistRoutes);

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

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
    app.listen(PORT, () => console.log(`MORBEI server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exit(1);
  });
