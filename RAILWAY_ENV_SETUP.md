# Railway Environment Variables Configuration

## Step 1: Set Backend Environment Variables in Railway Dashboard

Go to: Railway Dashboard → Your Backend Service → Variables → Add New

### Required Backend Variables:

```
PORT=4000
NODE_ENV=production
CLIENT_URL=https://your-frontend-domain.com
JWT_SECRET=your_secure_random_string_here
SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_your_token_here
RAZORPAY_KEY_ID=rzp_live_your_key
RAZORPAY_KEY_SECRET=your_secret_here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your_gmail_app_password
STORE_NOTIFICATION_EMAIL=orders@morbei.com
```

## Step 2: Set Frontend Environment Variables

### For Railway Frontend Service:
```
VITE_API_URL=https://your-backend-railway.up.railway.app/api
VITE_SHOPIFY_STORE_DOMAIN=morbei.myshopify.com
VITE_SHOPIFY_STOREFRONT_TOKEN=your_storefront_token_here
VITE_SHOPIFY_API_VERSION=2024-01
VITE_RAZORPAY_KEY_ID=rzp_live_your_key_id
```

### For Vercel Frontend (RECOMMENDED):
Same as above, set in Vercel dashboard

## How to Generate JWT_SECRET

Run this in terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and paste in Railway dashboard.

## Gmail App Password Setup (for SMTP)

1. Go to myaccount.google.com/security
2. Enable 2-Factor Authentication
3. Go to App passwords
4. Generate a 16-char password for Mail
5. Use this as SMTP_PASS

## Verifying Variables

After deployment, check if variables loaded:
```bash
curl https://your-backend.up.railway.app/api/health
# Should return: {"status":"ok"}
```

If 500 error, check Railway logs for missing environment variable errors.
