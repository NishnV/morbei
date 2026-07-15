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

const app = express();
const PORT = process.env.PORT || 4000;

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

// Rate limits: generous globally, strict where abuse hurts
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

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
