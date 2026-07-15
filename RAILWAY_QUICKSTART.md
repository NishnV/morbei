# Quick Start: Deploy MORBEI to Railway (5 Steps)

## ⚡ TL;DR - Fastest Path

### Step 1: Fix Backend for Railway (5 min)
```bash
# Already done - just verify
cat server/railway.toml
# Should have: volumes = ["/app/server/db"]
```

### Step 2: Prepare Environment Variables (10 min)
```bash
# Copy production templates
cp server/.env.production server/.env
cp .env.production .env

# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Copy output to server/.env JWT_SECRET
```

### Step 3: Push to Git
```bash
git add .
git commit -m "Add Railway deployment configs"
git push origin main
```

### Step 4: Deploy Backend to Railway (5 min)
1. Go to railway.app
2. New Project → Deploy from GitHub
3. Select repo, confirm
4. Add environment variables (from `server/.env`)
5. Deploy! ✅

### Step 5: Deploy Frontend to Vercel (3 min) - RECOMMENDED
1. Go to vercel.com
2. Import Project → Select repo
3. Add env var: `VITE_API_URL=https://your-railway-backend.up.railway.app/api`
4. Deploy! ✅

---

## 🔗 Connection Setup (After Deploy)

**In Backend Service:**
Update `CLIENT_URL` env var to your Vercel frontend URL

**In Frontend Deploy:**
Already set `VITE_API_URL` to backend

**Test:**
```bash
# Verify backend health
curl https://your-backend.up.railway.app/api/health
# Should return: {"status":"ok"}
```

---

## ✅ What's Included Now

### Configuration Files Created:
- ✅ `server/railway.toml` - Updated with persistent volume + Python for build
- ✅ `.nvmrc` & `server/.nvmrc` - Node v20
- ✅ `.env.production` - Frontend production template
- ✅ `server/.env.production` - Backend production template
- ✅ `Dockerfile` & `server/Dockerfile` - Container files
- ✅ `deploy.sh` - Deployment helper script

### Documentation Created:
- ✅ `RAILWAY_DEPLOYMENT_CHECKLIST.md` - Complete guide (critical issues explained)
- ✅ `FRONTEND_DEPLOYMENT.md` - Frontend deployment options (Railway vs Vercel)
- ✅ `RAILWAY_ENV_SETUP.md` - Environment variables reference

---

## 🚨 Critical Issues Fixed

| Issue | Solution | Status |
|-------|----------|--------|
| SQLite data loss on restart | Added persistent volume in railway.toml | ✅ Fixed |
| better-sqlite3 build errors | Added Python to Nixpacks providers | ✅ Fixed |
| Frontend not specified | Created deployment guide (Vercel recommended) | ✅ Fixed |
| No Node version lock | Added .nvmrc files | ✅ Fixed |
| Missing env templates | Created .env.production files | ✅ Fixed |

---

## 📊 Your Project Structure for Railway

```
Frontend (React/Vite)          Backend (Node.js/Express)
└─ Deployed on Vercel          └─ Deployed on Railway
   - dist/ built               - /api/* routes
   - env: VITE_API_URL         - env: JWT_SECRET, etc
   - talks to backend          - SQLite with persistent volume

         ↔ HTTPS ↔
```

---

## 🎯 Next Immediate Actions

1. **Generate JWT_SECRET** (required for backend security):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Update `server/.env`** with all production values:
   - JWT_SECRET (generated above)
   - Shopify Admin Token
   - Razorpay credentials
   - Gmail App Password

3. **Push to Git:**
   ```bash
   git add .
   git commit -m "Add Railway deployment configs"
   git push
   ```

4. **Deploy on Railway.app:**
   - Backend service first (has the data)
   - Copy its URL: https://xxxx.up.railway.app
   - Update VITE_API_URL to point there

5. **Deploy on Vercel.com:**
   - Frontend with VITE_API_URL set to Railway backend

---

## 🐛 Troubleshooting

**Backend won't start?**
- Check logs in Railway dashboard
- Common issues:
  - JWT_SECRET not set
  - better-sqlite3 build failed (check nixpacks.providers in railway.toml)
  - Shopify credentials missing

**Frontend can't reach backend?**
- Check VITE_API_URL env var
- Check backend's CLIENT_URL includes frontend domain
- Check browser console for CORS errors

**Database disappears after restart?**
- Check if `volumes = ["/app/server/db"]` is in railway.toml
- Restart the service

---

## 📚 Key Files to Know

- `server/index.js` - Express app entry point
- `server/db/sqlite.js` - Database initialization
- `server/middleware/auth.js` - JWT authentication
- `src/lib/api.js` - Frontend API client
- `server/railway.toml` - Railway deployment config ⭐
- `.env.production` - Frontend production env template
- `server/.env.production` - Backend production env template

---

## 💡 Pro Tips

1. **Test locally first:**
   ```bash
   npm run dev --prefix server  # Terminal 1
   npm run dev                   # Terminal 2
   ```

2. **Use Railway's `--watch` during development:**
   Already enabled in start command

3. **Monitor logs after deploy:**
   Railway Dashboard → Services → Logs

4. **Database migration later:**
   When ready to scale, migrate from SQLite to PostgreSQL via Railway plugin

---

**Ready? Start with Step 1 above! 🚀**
