# Railway Deployment Checklist for MORBEI

## 🚨 CRITICAL ISSUES

### 1. **SQLite Database Persistence (BLOCKER)**
**Problem:** SQLite database file (`server/db/morbei.db`) is on Railway's ephemeral filesystem and **will be lost on every deployment or restart**.

**Current Setup:**
```javascript
// server/db/sqlite.js
const db = new Database(join(__dirname, 'morbei.db'));
```

**Solutions (Choose One):**

#### Option A: Use Railway's PostgreSQL (RECOMMENDED for production)
```bash
# Create a PostgreSQL service in Railway dashboard
# Add Railway PostgreSQL plugin → automatically sets DATABASE_URL
```
Then update `server/db/sqlite.js` to use `pg` or `postgres` package instead of `better-sqlite3`.

#### Option B: Persistent Volume on Railway (Simpler migration)
Add to `server/railway.toml`:
```toml
[deploy]
volumes = ["/app/server/db"]  # Persist the db folder
```
This keeps SQLite but ensures data persists.

#### Option C: Use `server/morbei.db-wal` + WAL checkpointing
Already enabled but won't solve ephemeral filesystem issue.

**Recommendation:** Start with **Option B** for quickest migration, upgrade to PostgreSQL later.

---

### 2. **better-sqlite3 Native Module Compilation**
**Problem:** `better-sqlite3` requires native compilation. May fail on Railway's Nixpacks builder.

**Solution:** Add explicit build instructions:

Create `server/build.sh`:
```bash
#!/bin/bash
npm install --build-from-source better-sqlite3
```

Or use prebuilt binaries in `railway.toml`:
```toml
[build]
builder = "nixpacks"
nixpacks.providers = ["nodejs", "python"]  # Python needed for better-sqlite3 build
```

---

### 3. **Frontend Deployment Not Specified**
**Problem:** Frontend (React/Vite) is **NOT being served** by your Express backend. Two separate services needed.

**Options:**
1. **Railway Frontend Service** (recommended): Deploy `dist/` output
2. **Vercel/Netlify**: Simpler for SPA, still calls Railway backend API
3. **Combine on Railway**: Serve built frontend from Express (requires changes)

---

## ✅ REQUIRED CONFIGURATION

### Backend: `server/railway.toml` (NEEDS UPDATE)

```toml
[build]
builder = "nixpacks"
# For better-sqlite3 compilation
nixpacks.providers = ["nodejs", "python"]

[deploy]
# Add this for database persistence (Option B)
volumes = ["/app/server/db"]

startCommand = "node --env-file=.env index.js"
healthcheckPath = "/api/health"
healthcheckTimeout = 10
restartPolicyType = "on_failure"
```

---

### Backend: Environment Variables Required on Railway

Create these in Railway dashboard under your service:

```env
# Server
PORT=4000
NODE_ENV=production

# Client URL (Frontend URL on Railway or external)
CLIENT_URL=https://your-frontend-railway.up.railway.app,https://your-domain.com

# JWT
JWT_SECRET=<generate-a-long-random-string>

# Shopify Admin API
SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxx

# Razorpay (Production)
RAZORPAY_KEY_ID=rzp_live_xxxxxx
RAZORPAY_KEY_SECRET=xxxxx_secret

# Email/SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your_app_password
STORE_NOTIFICATION_EMAIL=orders@morbei.com
```

---

### Frontend: Environment Variables Required

For Vite build, create `.env.production` or set in Railway build:

```env
VITE_SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
VITE_SHOPIFY_STOREFRONT_TOKEN=your_storefront_token_here
VITE_SHOPIFY_API_VERSION=2024-01
VITE_RAZORPAY_KEY_ID=rzp_live_your_key_id
VITE_API_URL=https://your-backend-railway.up.railway.app/api
```

---

## 📋 CHECKLIST: Deploy to Railway

### Phase 1: Prepare Backend
- [ ] Choose database persistence strategy (SQLite volume OR PostgreSQL)
- [ ] Update `server/railway.toml` with volumes (if using SQLite)
- [ ] Add Node version: Create `.nvmrc` with `20` or `22`
- [ ] Test locally: `npm run dev` in server folder
- [ ] Verify health endpoint: `curl http://localhost:4000/api/health`

### Phase 2: Deploy Backend
- [ ] Push code to Git
- [ ] Create Railway project
- [ ] Connect GitHub repo
- [ ] Add all env variables (see list above)
- [ ] Deploy backend service
- [ ] Verify: Check logs, hit `/api/health`

### Phase 3: Deploy Frontend
**Option A: Railway Service**
- [ ] Create new Railway service
- [ ] Add build command: `npm run build`
- [ ] Set start command: `npm run preview` OR use Node/Express to serve `dist/`
- [ ] Add `VITE_API_URL` env var pointing to backend

**Option B: Vercel/Netlify**
- [ ] Connect Git repo to Vercel
- [ ] Set env var: `VITE_API_URL` to your Railway backend
- [ ] Deploy

### Phase 4: Verify Integration
- [ ] Frontend loads
- [ ] Login/signup works (hits `/api/auth/login`)
- [ ] Cart operations work
- [ ] Payment flow works (Razorpay)
- [ ] Orders display correctly

---

## 🔧 MISSING CONFIGURATIONS TO ADD NOW

### 1. `.nvmrc` (Root & Server)
```
20
```
Create this file in both `/` and `/server` directories.

### 2. Dockerfile (Optional, for better control)
Create `Dockerfile` in `/server`:
```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 4000
CMD ["node", "--env-file=.env", "index.js"]
```

### 3. Root `package.json` Scripts (For Monorepo)
Update root `package.json`:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev\"",
    "build": "npm run build",
    "build:all": "npm run build && npm run build --prefix server",
    "start:server": "npm start --prefix server"
  }
}
```

### 4. `server/.env` Example Production
```env
PORT=4000
NODE_ENV=production
CLIENT_URL=https://your-frontend.com
JWT_SECRET=<64-char-random-string>
```

---

## ⚠️ WARNINGS & GOTCHAS

1. **CORS Issues**: Update `CLIENT_URL` in backend to match your frontend domain
2. **Razorpay**: Ensure webhook URL is set in Razorpay dashboard
3. **Email**: Gmail requires App Passwords (not regular password)
4. **SQLite Locks**: With concurrent requests, consider PostgreSQL upgrade
5. **Cold Starts**: Railway has ~5s cold start; use health checks

---

## 🚀 RECOMMENDED DEPLOYMENT ORDER

1. **Backend** → SQLite with persistent volume
2. **Frontend** → Vercel (simplest SPA deployment)
3. **Connect** → Update env vars, test integration
4. **Monitor** → Check Railway logs, error tracking
5. **Upgrade** → PostgreSQL when needed for scale

---

## 📚 Railway Resources

- [Railway Docs](https://docs.railway.app)
- [Deploying Node.js](https://docs.railway.app/deploy/deployments)
- [Nixpacks Configuration](https://nixpacks.com/docs/configuration)
- [Environment Variables](https://docs.railway.app/develop/variables)
