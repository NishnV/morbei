# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MORBEI — a fashion e-commerce store. Two apps in one repo, each with its own package.json:

- **Root** — React 19 SPA (Vite, react-router-dom, plain CSS files per page). Deployed to Vercel.
- **server/** — Express 5 backend (ESM). Deployed to Railway with Railway Postgres.

No test suite exists.

## Commands

```bash
# Frontend (repo root)
npm run dev        # Vite dev server
npm run build      # production build
npm run lint       # eslint

# Backend
cd server && npm run dev   # node --env-file=.env --watch index.js (needs server/.env)
```

Node 20 (`.nvmrc`). Backend refuses to boot if any required env var is missing (see `REQUIRED_ENV` in [server/index.js](server/index.js)) — locally it needs a running Postgres (`DATABASE_URL`).

## Architecture: hybrid Shopify + custom checkout

Shopify is the **product system** (catalog, inventory, orders of record) and **identity system** (customer accounts, password reset). The custom backend exists for one reason: owning checkout with Razorpay instead of Shopify's checkout.

The frontend talks to **two backends**:

1. **Shopify Storefront API directly** — products, collections, cart, customer auth. Client in [src/lib/shopify.js](src/lib/shopify.js), queries in [src/graphql/](src/graphql/), consumed via hooks in [src/hooks/](src/hooks/). Raw Shopify responses are flattened by [src/utils/normalizeProduct.js](src/utils/normalizeProduct.js) — components only ever see that flat shape.
2. **Express backend** via [src/lib/api.js](src/lib/api.js) — payments, orders, wishlist sync, contact, shipping/tracking.

### Auth bridge

Users log in with Shopify customer accounts ([src/context/AuthContext.jsx](src/context/AuthContext.jsx)). The backend requires its own JWT: after Shopify login, the frontend calls `POST /api/auth/shopify-login`, which validates the Shopify customer token server-side, upserts a local user, and issues a 30-day backend JWT (stored as `morbei_token` in localStorage, attached by `apiFetch`). Two tokens exist — don't confuse them.

### The money path (handle with care)

Flow in [server/routes/payment.js](server/routes/payment.js):
- `POST /create-order` — server fetches real variant prices from the Shopify Admin API and computes the total itself. **Never trust client-sent prices/amounts.**
- `POST /verify` (browser) and `POST /webhook` (Razorpay `payment.captured`) can both attempt fulfillment. Idempotency is enforced by atomically claiming the order: `UPDATE ... SET status='processing' WHERE status='pending'` — only one caller wins. Anything on this path must stay safe to trigger twice.
- The webhook HMAC is verified over the **raw** request body (re-serializing JSON changes bytes) with a timing-safe compare.
- The local `orders` table tracks the payment lifecycle (`pending → processing → paid/cancelled`), which exists *before* a Shopify order does; if Shopify order creation fails after payment, the owner gets an "ACTION NEEDED" email rather than a silent stuck order.

Fulfillment is **manual by design**: paid orders email the store with items/size/color/address/phone. [server/services/shiprocket.js](server/services/shiprocket.js) is intentionally dormant — the upgrade path, not dead code.

### Backend conventions

- Postgres via `pg` pool in [server/db/pg.js](server/db/pg.js); schema created by `initDB()` on boot. Gotcha: Postgres returns `BIGINT` as a **string** in JS — `Number()` before comparing amounts.
- Error hygiene: log the real error server-side, return a generic message to the client (raw `err.message` leaked internals before).
- All user-supplied content going into emails must be HTML-escaped (the contact form is unauthenticated).
- CORS is exact-origin match against `CLIENT_URL`; rate limits via express-rate-limit return JSON, not plain text.

## Frontend responsive system

There are exactly **two designs**, switched primarily by orientation: portrait handhelds (phones + iPads upright) get the mobile design; anything landscape (iPads sideways, laptops) gets the desktop design.

- Breakpoints are `@custom-media` tokens in [src/styles/breakpoints.css](src/styles/breakpoints.css), injected into every CSS file at build time by postcss (`postcss.config.js`) — **never write raw orientation/width media queries in page CSS; use the tokens** (`--mobile`, `--phone`, `--tablet`, `--touch-landscape`, `--narrow-desktop*`, etc.).
- [src/lib/viewport.js](src/lib/viewport.js) mirrors these tokens for JS (`matchMedia`) — keep the two files in sync when changing breakpoints.

Other frontend notes:

- Global state via contexts in [src/context/](src/context/): Auth (Shopify customer + backend JWT exchange), Cart (Shopify cart), Shop (wishlist — localStorage first, merged with server on login — and cart drawer), Loading.
- Per-route document titles live in `ROUTE_TITLES` in [src/App.jsx](src/App.jsx) — add an entry when adding a route.
- Razorpay's script is **not** globally loaded; Checkout lazy-loads it. Don't reintroduce it in index.html.

## Reference

`PROJECT_SUMMARY.md` (untracked, repo root) documents the full architecture rationale, deployment env vars for Railway/Vercel, and launch-verification steps — read it before touching payments, auth, or deployment.
