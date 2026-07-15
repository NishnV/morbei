#!/bin/bash
# Deploy MORBEI to Railway
# This script helps you prepare and deploy both backend and frontend

set -e

echo "🚀 MORBEI Railway Deployment Helper"
echo "=================================="
echo ""

# Check if Git is initialized
if [ ! -d .git ]; then
    echo "❌ Error: Not a git repository. Initialize with: git init"
    exit 1
fi

echo "📋 Pre-deployment Checklist"
echo "=================================="
echo ""

# Check for .env files
echo "1. Environment Variables Setup:"
if [ -f "server/.env" ]; then
    echo "   ✅ server/.env exists"
else
    echo "   ⚠️  server/.env missing - create it with: cp server/.env.production server/.env"
fi

if [ -f ".env" ]; then
    echo "   ✅ .env exists (frontend)"
else
    echo "   ⚠️  .env missing - create it with: cp .env.production .env"
fi

echo ""
echo "2. Backend Configuration:"
if grep -q "JWT_SECRET=replace_with" server/.env 2>/dev/null; then
    echo "   ❌ JWT_SECRET not configured!"
else
    echo "   ✅ JWT_SECRET configured"
fi

echo ""
echo "3. Frontend Build:"
npm run build > /dev/null 2>&1 && echo "   ✅ Frontend builds successfully" || echo "   ❌ Frontend build failed"

echo ""
echo "4. Backend Health Check:"
if [ -f "server/index.js" ]; then
    grep -q "api/health" server/index.js && echo "   ✅ Health endpoint available" || echo "   ⚠️  No health endpoint"
fi

echo ""
echo "=================================="
echo "📝 Next Steps for Railway:"
echo "=================================="
echo ""
echo "1. Backend Service:"
echo "   - Go to railway.app → New Project"
echo "   - Select 'Deploy from GitHub' and connect your repo"
echo "   - Service name: morbei-backend"
echo "   - Add environment variables from server/.env.production"
echo "   - Deploy!"
echo ""
echo "2. Frontend Service (Option A - Railway):"
echo "   - New service → Select repo"
echo "   - Build command: npm run build"
echo "   - Start command: npm run preview"
echo "   - Add VITE_API_URL pointing to backend"
echo ""
echo "2. Frontend Service (Option B - Vercel, RECOMMENDED):"
echo "   - Go to vercel.com → Import Project"
echo "   - Select this repo"
echo "   - Add VITE_API_URL env var"
echo "   - Deploy!"
echo ""
echo "3. Update Configuration:"
echo "   - Backend: Update CLIENT_URL env var to frontend domain"
echo "   - Frontend: Update VITE_API_URL env var to backend domain"
echo ""
echo "✨ Deployment guide available: RAILWAY_DEPLOYMENT_CHECKLIST.md"
echo ""
