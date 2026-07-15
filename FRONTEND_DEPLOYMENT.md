# MORBEI Frontend Deployment on Railway

## Quick Start for Frontend on Railway

### Option A: Deploy Frontend on Railway (Simple)

1. **Create new service in Railway:**
   ```
   railway.app → Dashboard → New Service → Deploy from GitHub
   ```

2. **Configure Build & Start:**
   - Build Command: `npm run build`
   - Start Command: `npm run preview`
   - Root Directory: `/` (if monorepo structure)

3. **Add Environment Variables:**
   ```env
   VITE_API_URL=https://your-backend-railway-app.up.railway.app/api
   VITE_SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
   VITE_SHOPIFY_STOREFRONT_TOKEN=your_storefront_token_here
   VITE_SHOPIFY_API_VERSION=2024-01
   VITE_RAZORPAY_KEY_ID=rzp_live_your_key_id
   ```

4. **Deploy!**

### Option B: Deploy Frontend on Vercel (RECOMMENDED - Better for SPA)

Vercel is optimized for SPA/Vite deployments:

1. **Connect Repository:**
   - Go to vercel.com
   - Click "Import Project"
   - Select your GitHub repo

2. **Configure Build Settings:**
   - Framework: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`

3. **Add Environment Variables:**
   ```env
   VITE_API_URL=https://your-backend-railway-app.up.railway.app/api
   VITE_SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
   VITE_SHOPIFY_STOREFRONT_TOKEN=your_storefront_token_here
   VITE_SHOPIFY_API_VERSION=2024-01
   VITE_RAZORPAY_KEY_ID=rzp_live_your_key_id
   ```

4. **Deploy!**

### Option C: Serve Frontend from Backend (Advanced)

If you want both on one Railway service:

**Update `server/index.js`:**
```javascript
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Serve static frontend files
app.use(express.static(join(__dirname, '../dist')));

// API routes
app.use('/api/auth', authRoutes);
// ... other routes

// SPA fallback - serve index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => console.log(`MORBEI app running on port ${PORT}`));
```

**Update `package.json` (root):**
```json
{
  "scripts": {
    "build": "npm run build && npm run build --prefix server",
    "start": "npm start --prefix server"
  }
}
```

**Update `server/railway.toml`:**
```toml
[build]
builder = "nixpacks"
buildCommand = "npm run build"

[deploy]
volumes = ["/app/server/db"]
startCommand = "npm start --prefix server"
```

---

## Environment Variables for Railway

### Backend Environment Variables (in Railway dashboard):

```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://your-frontend-vercel-app.vercel.app
JWT_SECRET=<generate-random-64-char-string>
SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxx
RAZORPAY_KEY_ID=rzp_live_xxxxxx
RAZORPAY_KEY_SECRET=xxxxx_secret
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your_app_password
STORE_NOTIFICATION_EMAIL=orders@morbei.com
```

### Frontend Environment Variables (in Railway/Vercel dashboard):

```env
VITE_API_URL=https://morbei-backend.up.railway.app/api
VITE_SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
VITE_SHOPIFY_STOREFRONT_TOKEN=your_storefront_token_here
VITE_SHOPIFY_API_VERSION=2024-01
VITE_RAZORPAY_KEY_ID=rzp_live_your_key_id
```

---

## Troubleshooting

### Frontend not connecting to backend
- Check `VITE_API_URL` env var
- Check CORS: Backend's `CLIENT_URL` should match frontend domain
- Check browser console for errors

### Build fails on Railway
- Ensure `npm run build` works locally
- Check for missing dependencies
- Check buildCommand in railway.toml

### Static files not loading
- Ensure `dist/` is built and uploaded
- Check server is serving static files correctly
- Verify path to dist folder

### SPA routing not working
- Ensure fallback to `index.html` is configured
- Check vercel.json (has `rewrites` for SPA)
- Verify `_redirects` file exists (for Netlify)

---

## Recommended Deployment Architecture

```
┌─────────────────────────────┐
│   Frontend: Vercel/Railway  │
│   (React + Vite)            │
│   - dist/ folder            │
│   - Env: VITE_API_URL       │
└──────────────┬──────────────┘
               │ (CORS-enabled)
               ▼
┌─────────────────────────────┐
│   Backend: Railway          │
│   (Node.js + Express)       │
│   - /api/* routes           │
│   - SQLite + persistent vol │
│   - Razorpay webhook        │
│   - Shiprocket integration  │
└─────────────────────────────┘
               │
         ┌─────┼─────┐
         ▼     ▼     ▼
      [Shopify API]
      [Razorpay API]
      [Shiprocket API]
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Build frontend locally | `npm run build` |
| Preview production build | `npm run preview` |
| Test backend locally | `npm run dev --prefix server` |
| Generate JWT secret | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| Check health | `curl https://your-backend.up.railway.app/api/health` |

---

## Need Help?

- Railway Docs: https://docs.railway.app
- Vercel Docs: https://vercel.com/docs
- Vite Deployment: https://vite.dev/guide/static-deploy
