# MORBEI — Pre-Launch Engineering & Security Audit

> **STATUS: R1–R13 implemented and verified (2026-08-11).** Everything in §5 has
> been applied except **R14 (guest checkout)**, which remains deliberately
> deferred. Score re-assessed at **83/100** — see "Post-remediation status" at
> the end. Nothing is committed; all changes are in the working tree for review.


**Auditor role:** Principal Software Engineer / Senior Cyber Security Auditor
**Scope:** Full repo — `src/` (React 19 SPA), `server/` (Express 5 + Postgres), configs, git history
**Date:** 2026-08-11 · **Target launch:** T-7 days
**HEAD:** `6e5aee1` — *"Added about us page, added a new feature to swipe in mobile screens…"*

---

## 1. Executive Summary & Production Readiness Score

### Score: **61 / 100** — Launch-capable, but not launch-ready in 7 days without triage

| Area | Score | Verdict |
|---|---|---|
| Payment integrity (pricing, signatures, idempotency) | **88** | Genuinely well built. Best part of the codebase. |
| Auth & access control | **78** | Sound model; JWT lifecycle and login rate-limiting are weak. |
| Secrets hygiene | **95** | Clean. No real secrets in the repo or history. |
| Inventory & order correctness | **35** | **No stock validation anywhere.** Overselling is inevitable. |
| Data integrity / address quality | **45** | Missing `city` field corrupts every shipping label. |
| E-commerce feature completeness | **50** | No guest checkout, no coupons, no returns flow, no admin panel. |
| SEO & discoverability | **22** | SPA with one static `<title>`. No structured data, no sitemap, no robots.txt. |
| Frontend performance | **48** | Zero code-splitting, raw full-resolution Shopify images. |
| Operability (admin, reconciliation, monitoring) | **40** | Slack alerts exist; no admin UI, no stuck-order recovery. |

### The honest read

The **money path is the strongest part of this codebase** and I want to say that plainly, because it's unusual. `server/routes/payment.js` does the things most shops get wrong: it re-prices every line server-side from the Shopify Admin API and never trusts the client, it verifies the Razorpay webhook HMAC over the **raw** request bytes with `crypto.timingSafeEqual`, and it enforces idempotency with an atomic `UPDATE … WHERE status='pending'` claim so `/verify` and the webhook can race safely. The refund path in `server/routes/shipping.js` uses the same claim pattern and reverts on failure. Whoever wrote this understood the failure modes.

The problems are on either side of that core.

**What will actually break in week one:**

1. **You will oversell.** Nothing in `create-order` checks inventory. The only stock gate is a client-side `available` boolean rendered at page load. Two customers on the last size-M dress both pay, both get Shopify orders, one gets an apology email you'll write by hand.
2. **Every shipping label will have the wrong city.** The checkout form has no city input. The server does `city: shippingAddress.city || shippingAddress.state` — so `city` is always the state name. This is already a known-and-worked-around bug: `AuthContext.jsx:38` literally comments *"Checkout-created copies mangle city (state-as-city)"*. It was patched at the display layer, never at the source.
3. **You are invisible to Google.** The whole SPA ships one `<title>` and one OG image from `index.html`. Every product page shares them. No JSON-LD, no sitemap, no robots.txt. A product link shared on WhatsApp shows the generic homepage card.
4. **Guest checkout does not exist.** `/create-order` is behind `authenticate`. A shopper who fills in the entire address form gets an `alert()` and a redirect to `/profile` at the payment step. For a new fashion brand this is the single largest conversion leak.
5. **The Shopify API version is `2024-01`** — roughly two and a half years past release, well outside Shopify's support window, hardcoded in three places.

**What is genuinely fine:** no SQL injection (100% parameterized), no CSRF exposure (bearer tokens, not cookies), no secrets in git history, correct CORS, `helmet()` on, error messages that don't leak internals, sensible rate limits on contact/auth.

**Recommendation:** the 12 items in §2 are ~3–4 focused days of work. They are achievable before launch. The feature gaps in §3 (coupons, returns, admin panel) are not, and should be scheduled post-launch with manual workarounds documented for the store operator.

---

## 1b. Architecture Map

**Stack**

| Layer | Technology |
|---|---|
| Frontend | React 19.2, Vite 7, react-router-dom 7, framer-motion, plain CSS per page |
| Backend | Express 5 (ESM), Node 20, `pg` 8 pool, jsonwebtoken, nodemailer, razorpay SDK |
| Data | Railway Postgres (`users`, `orders`, `wishlist`, `contact_submissions`, `newsletter`) |
| Product/identity system | Shopify (Storefront API for catalog+auth, Admin API for orders) |
| Payments | Razorpay (custom checkout — this is the entire reason the backend exists) |
| Hosting | Vercel (SPA) + Railway (API) |
| Tests | **None.** No test runner, no test files, no CI. |

**Request topology** — the frontend talks to two backends directly:

```
Browser ──► Shopify Storefront API   (products, collections, cart, customer login)
       │      src/lib/shopify.js, src/graphql/*, src/hooks/*
       │
       └──► Express API              (payments, orders, wishlist, contact, cancel/refund)
              src/lib/api.js  →  server/routes/*
```

**Auth bridge (two tokens — do not confuse them):**

```
Shopify customerAccessToken  →  localStorage 'morbei_customer_token'
        │
        └─► POST /api/auth/shopify-login  (validates token server-side against Shopify)
                    │
                    └─► backend JWT (30d)  →  localStorage 'morbei_token'
                                              attached by apiFetch as Bearer
```

**Money path:**

```
Checkout.jsx
  └─► POST /api/payment/create-order   ── re-prices from Shopify Admin, writes orders(status=pending)
  └─► Razorpay popup
        ├─► handler  → POST /api/payment/verify   ─┐
        └─► (tab closed)                            ├─► fulfillPaidOrder()  [atomic claim]
              Razorpay → POST /api/payment/webhook ─┘      └─► Shopify draft order → complete → email
```

Fulfillment is **manual by design** — paid orders email the store. `server/services/shiprocket.js` (112 lines) is dormant on purpose, an upgrade path, not dead code.

**State management:** four React contexts, no external state library, no data-fetching cache.

| Context | Owns |
|---|---|
| `AuthContext` | Shopify customer, token expiry, backend JWT exchange |
| `CartContext` | Shopify cart (server-side cart object) |
| `ShopContext` | Wishlist (localStorage-first, merged on login), cart drawer open state |
| `LoadingContext` | Global loading screen |

### Dead code & incomplete implementations

| Location | Finding |
|---|---|
| `src/pages/Checkout.jsx:90-95` | `cardForm` state (`number`, `name`, `expiry`, `cvv`) and `handleCard` — **declared, never rendered**. Raw card fields in a React component are a PCI-DSS scope trap. Delete before launch. |
| `src/pages/Checkout.jsx:57` | `paymentMethod` state — set once, never read, never updated. |
| `src/pages/ProductDetail.jsx:546` | `<button className="pd-guide-link">Size Guide</button>` — **no `onClick`**. Dead button on every product page. |
| `src/utils/normalizeProduct.js:65` | `metafields.sizeGuide` is parsed and then never referenced anywhere in `src/`. |
| `src/utils/normalizeProduct.js:156` | `quantityAvailable` normalized from Shopify, never used. Low-stock warnings are one line away. |
| `src/hooks/useProducts.js:72` | `useProductRecommendations` — full Shopify-native recommendations hook, **never imported**. ProductDetail uses a `Math.random()` shuffle instead (see §5). |
| `src/context/CartContext.jsx:229,257` | `applyDiscount` / `removeDiscount` fully implemented, **no UI calls them**. See §3 — this is also a landmine. |
| `src/pages/About.jsx:39,57` | Two `TODO` comments: placeholder photos contain **visible "Saint Laurent" branding**. Trademark exposure on a public About page. |
| `Dockerfile` (root) | `CMD ["node", "--env-file=server/.env", …]` — `.env` is gitignored so it can't exist in the image; the container would crash on boot. Railway uses nixpacks per `railway.toml`. Stale and misleading — delete. |
| `src/assets/react.svg` | Vite scaffold leftover. |

**Unused dependencies:** ~~none found~~ — **correction:** `framer-motion` was entirely unused (nothing in `src/` imported it). The original sweep here was wrong. Removed. `lucide-react` is genuinely used (Navbar, Shop, TrackOrder). Backend `package.json` is minimal and fully consumed.

**Corrections to this report (found during remediation):**

| Original claim | Reality |
|---|---|
| "Unused dependencies: none found" | `framer-motion` was dead weight. Removed. |
| Three contradictory shipping policies | **Six.** Missed `Shipping.jsx:16` (₹5000), the FAQ's "over 50 countries", and a hardcoded 7-14 day delivery estimate shown even for paid 3-5 day priority. |
| No dependency-vulnerability section | Never ran `npm audit`. It found **3 high-severity advisories** — two in `react-router` (including an open redirect via protocol-relative URLs) and one in `ip-address` via `express-rate-limit`. All patched. |
| International shipping not flagged as a blocker | Checkout accepted US/UK/CA addresses, charged ₹0 shipping in INR, and the policy page promised DHL/FedEx. Now India-only, enforced server-side. |

---

## 2. Critical Security Blockers (must fix before launch)

### 🔴 BLOCKER-1 — No inventory validation anywhere in the checkout path

**Files:** `server/routes/payment.js:39-54`, `server/services/shopify-admin.js:61-64`

`getVariant()` fetches the Shopify variant — which includes `inventory_quantity` and `inventory_policy` — and uses **only** `variant.price`:

```js
const variant = await getVariant(numericId);
return {
    variantId: line.variantId,
    price: parseFloat(variant.price), // authoritative price — but availability is never checked
    ...
};
```

The only stock gate in the entire system is the client-side `available` flag rendered at page load (`ProductDetail.jsx:533`). Consequences:

- Two concurrent buyers of the last unit both succeed. Both are charged. Both get Shopify orders.
- A stale tab can buy an item that sold out an hour ago.
- An attacker can `POST /create-order` with any valid variant GID regardless of stock.

There is also **no inventory reservation during checkout** — the window between `create-order` and payment capture is completely unprotected.

---

### 🔴 BLOCKER-2 — Shipping address has no `city`; every label is wrong

**Files:** `src/pages/Checkout.jsx:64-81, 379-380`, `server/routes/payment.js:119-128`

The checkout form collects `firstName, lastName, phone, email, country, state, address, zip`. **No city.** The server then papers over it:

```js
city: shippingAddress.city || shippingAddress.state,   // payment.js:123
```

Every Shopify order and every courier label gets the *state* in the city field. This is a known defect that was patched downstream instead of fixed — `src/context/AuthContext.jsx:38` comments *"Checkout-created copies mangle city (state-as-city) and phone (+91 prefix)"*, and `server/services/email.js:46` comments *"The checkout form has no city field"*. Two workarounds, zero fixes.

Server-side validation compounds it — `payment.js:31` requires only `['address','state','zip']`. `phone`, `firstName`, `lastName` are enforced **client-side only** and are trivially bypassed by calling the API directly, producing an unshippable order.

---

### 🔴 BLOCKER-3 — Shopify API version `2024-01` is far outside the support window

**Files:** `server/services/shopify-admin.js:3`, `server/services/shopify-storefront.js:3`, `src/lib/shopify.js:11`

```js
const API_VERSION = '2024-01';
```

Shopify ships quarterly versions with a minimum 12-month support window. `2024-01` is ~2.5 years old. Shopify's documented behaviour for requests to an unsupported version is to serve them from the **oldest currently supported version** — meaning you are not running on a pinned API at all; you're running on a moving target that can change under you without a deploy. Pin all three to a current supported version and smoke-test the draft-order flow before launch.

---

### 🔴 BLOCKER-4 — `/verify` fulfills on `authorized`, not just `captured`

**File:** `server/routes/payment.js:197`

```js
if (payment.status !== 'captured' && payment.status !== 'authorized') {
```

An **authorized** payment is not money in your account — it's a hold that can expire or fail to capture. Accepting it means the Shopify order is created, the confirmation email goes out, and the item is packed for a payment that may never settle. If your Razorpay account uses auto-capture this is theoretical; if auto-capture is ever turned off, it is free merchandise. Require `captured`.

---

### 🟠 HIGH-5 — Customer login is not rate-limited at all

**Files:** `server/index.js:70,74`, `src/context/AuthContext.jsx`

`authLimiter` (60 / 15 min) protects `/api/auth/*` — but **that route only exchanges an already-valid Shopify token.** The actual login (`customerAccessTokenCreate`) is called from the **browser straight to Shopify**, bypassing your backend entirely. Your rate limiter protects a door nobody attacks. Credential stuffing against MORBEI customer accounts hits Shopify's Storefront API directly and is bounded only by Shopify's generic per-IP throttle — there is no login-specific lockout, no CAPTCHA, no failed-attempt tracking.

Same gap applies to password reset (`customerRecover`) — an unlimited email-enumeration and mail-bomb primitive.

---

### 🟠 HIGH-6 — JWT: 30-day expiry, no revocation, no refresh

**File:** `server/middleware/auth.js:17-19`

```js
return jwt.sign({ id: userId, email }, process.env.JWT_SECRET, { expiresIn: '30d' });
```

Stored in `localStorage` (XSS-readable). Logout only calls `localStorage.removeItem` — **the token stays valid on the server for the full 30 days.** There is no `jti`, no denylist, no token version column. A token lifted from a shared or compromised device grants a month of order placement, order history reads, and cancellation/refund triggering. 30 days is far too long for a token that can move money.

---

### 🟠 HIGH-7 — Orders can strand in `processing` with no recovery

**File:** `server/routes/payment.js:96-107, 165`

`fulfillPaidOrder` claims the order by setting `status='processing'`. On a *caught* error it reverts to `'pending'` so the webhook can retry — correct. But if the **process dies** between the claim and the catch (Railway restart, OOM, deploy mid-request), the row is permanently `'processing'`. The webhook then skips it forever:

```js
if (order && order.status === 'pending' && payment.amount === Number(order.total_amount)) {
```

Result: money captured, no Shopify order, no alert, no email, and the order is invisible to the customer (`orders.js:41` filters out non-`paid` rows). It fails **silently**. There is no reconciliation job and no admin view to find these.

---

### 🟠 HIGH-8 — Razorpay's webhook is subject to your global IP rate limit

**File:** `server/index.js:69,73`

```js
const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 300, … });
app.use('/api', apiLimiter);
```

`/api/payment/webhook` sits under `/api`, so Razorpay's callbacks are counted against a **300-per-15-min per-IP** budget shared with everything else. Razorpay delivers from a small IP pool. During a sale, legitimate webhooks can be 429'd — and the webhook is your only safety net when a customer closes the tab before `/verify` runs. Exempt it.

---

### 🟠 HIGH-9 — No per-user throttle on order creation

**File:** `server/routes/payment.js:17`

`/create-order` is authenticated but otherwise unbounded within the global 300/15min. One token can create ~300 pending orders and ~300 Razorpay orders per window — DB bloat, Razorpay quota burn, and noise that buries real stuck orders.

---

### 🟡 MEDIUM-10 — Unsanitized `dangerouslySetInnerHTML` on product descriptions

**File:** `src/pages/ProductDetail.jsx:582`

```jsx
<div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
```

Source is Shopify admin content, so this is store-operator-controlled, not attacker-controlled — genuinely low risk today. But it becomes stored XSS the moment a Shopify staff account is phished or a third-party app gains write access to product descriptions, and the payload would run on a page where users are logged in with a 30-day JWT in `localStorage`. Sanitize; it's cheap.

---

### 🟡 MEDIUM-11 — No email validation on newsletter subscription

**File:** `server/routes/contact.js:36-45`

```js
const { email } = req.body;
if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
await run('INSERT INTO newsletter (email) VALUES ($1) …', [email.trim().toLowerCase()]);
```

Any string up to the 200 KB body limit is stored. Note the sibling endpoint `/notify-stock` (line 61) **does** validate with a regex — the newsletter route just wasn't given the same treatment. Also no length cap, so the column accepts arbitrarily long junk.

---

### 🟡 MEDIUM-12 — `helmet()` defaults with no CSP for the SPA

**File:** `server/index.js:43`

`helmet()` on the API is fine. But the **Vercel-hosted frontend** has no security headers at all — `vercel.json` contains only a rewrite. No `Content-Security-Policy`, no `X-Frame-Options`, no `Referrer-Policy`, no HSTS directive. A CSP is the meaningful second line of defence for the `dangerouslySetInnerHTML` above and for any compromised dependency in a 410 KB bundle.

### ✅ Verified clean

- **SQL injection** — every query in `server/` uses parameterized `$1, $2` placeholders. No string concatenation into SQL. Clean.
- **CSRF** — bearer tokens in `Authorization` headers, no cookie auth. Not applicable by design.
- **IDOR / broken access control** — every order query is scoped `WHERE id = $1 AND user_id = $2` (`orders.js:41,57`, `shipping.js:33,57`). Wishlist likewise. Correct.
- **Price tampering** — client-sent `price` in `cartLines` is accepted and then **discarded**; the server re-fetches from Shopify. Exactly right.
- **Webhook signature** — HMAC-SHA256 over `req.rawBody` (`index.js:63` preserves it) with `crypto.timingSafeEqual` and a length pre-check. Textbook.
- **Payment↔order binding** — `verify` checks `payment.order_id === order.razorpay_order_id` **and** `payment.amount === Number(order.total_amount)`, with the `Number()` coercion Postgres `BIGINT`-as-string requires. Correct.
- **Secrets** — no `.env` file has ever been committed (`git log --diff-filter=A` confirms). The only matches across all 17 commits are placeholders (`rzp_live_your_key_id`, `shpat_xxxxxxxxxxxx`) in deployment docs since deleted. `.gitignore` is comprehensive.
- **SSRF** — no user-controlled URLs reach any server-side fetch.
- **Password hashing** — N/A and correctly so. Passwords live entirely in Shopify; the local `users.password` column stores the sentinel `'!shopify'` (`auth.js:35`). No local password auth exists to get wrong.
- **Error hygiene** — generic client messages, real errors logged server-side + Slack.

---

## 3. Missing Essential Features

### HIGH — fix before or immediately at launch

| # | Feature | Status | Impact |
|---|---|---|---|
| H1 | **Guest checkout** | Absent | `create-order` requires `authenticate`. The user fills the full address form, hits pay, gets `alert('Please log in…')` and a redirect (`Checkout.jsx:157-161`). Largest single conversion leak for a new brand. |
| H2 | **Inventory locking during checkout** | Absent | See BLOCKER-1. |
| H3 | **Low-stock warnings** | Absent | `quantityAvailable` is already fetched and normalized (`normalizeProduct.js:156`) and simply never rendered. "Only 2 left" is one line of JSX. |
| H4 | **Size guide** | Dead button | `ProductDetail.jsx:546` has no handler; `metafields.sizeGuide` is parsed and unused. For a fashion store this directly drives the return rate. |
| H5 | **Order status / shipping emails** | Only confirmation + cancellation | `email.js` sends order confirmation, cancellation, and three internal alerts. **No "your order has shipped" email** exists — the customer must poll `/track`. |
| H6 | **Admin / merchant controls** | Absent | No admin routes, no RBAC, no `role` column. All order management, status updates, refunds and inventory adjustment happen in the Shopify admin UI. That's a legitimate MVP choice — but the **local `orders` table drifts out of sync with Shopify** and nothing reconciles them. Stuck orders (HIGH-7) are unfindable. |
| H7 | **City field in checkout** | Absent | See BLOCKER-2. |

### MEDIUM

| # | Feature | Status | Notes |
|---|---|---|---|
| M1 | **Coupons / discount codes** | Implemented but unwired — **and a landmine** | `CartContext.applyDiscount` (line 229) works against the Shopify cart, but **no UI calls it**. Critical: `create-order` re-prices from raw variant prices and ignores discounts entirely. If anyone wires up the UI without touching the backend, customers will see a discounted cart and be **charged full price**. Add a code comment at `payment.js:58` before someone finds out the hard way. |
| M2 | **Return / exchange request flow** | Policy page only | `Returns.jsx` is static copy. No RMA form, no request endpoint, no status tracking. Customers must email. |
| M3 | **Tax calculation** | Not computed | Pricing is MRP-inclusive (`ProductDetail.jsx:498`), which is self-consistent for India. But `Cart.jsx:168` renders tax as **"Calculated at checkout"** — and checkout never calculates it. Either display "Incl. of all taxes" or implement it. |
| M4 | **Shipping rules engine** | Hardcoded + **three contradictory policies** | `payment.js:12` `{ standard: 0, priority: 200 }`. Meanwhile `Checkout.jsx:453` says *"free standard delivery for all orders above Rs.6790"* (standard is always free — the copy is meaningless) and `ProductDetail.jsx:614` says *"Free shipping on orders over RS. 10000"*. Three different published promises. Pick one. |
| M5 | **Address autocomplete / PIN lookup** | Absent | Indian PIN codes deterministically resolve city+state. Would fix BLOCKER-2 *and* reduce failed deliveries. |
| M6 | **Recently viewed** | Absent | No implementation. |
| M7 | **Real product recommendations** | Homegrown random shuffle | `ProductDetail.jsx:222-245` fetches **40 full products** (each with 10 images + 50 variants) to render 4 tiles, filters by `productType`, then pads with `.sort(() => Math.random() - 0.5)`. Shopify's native `productRecommendations` hook already exists at `useProducts.js:72` and is never imported. |
| M8 | **Quantity selector on PDP** | Absent | `handleAddToCart` hardcodes `shopifyAddToCart(variant.id, 1)` (line 285). |
| M9 | **Newsletter lifecycle** | Insert-only | See §6. |

### LOW

- Colour swatches use the raw option name as a CSS colour: `style={{ background: color.toLowerCase() }}` (`ProductDetail.jsx:509`). Works for `Black`/`White`/`Ivory`; silently renders nothing for fashion names like `Ecru`, `Sand`, `Taupe`. Needs a name→hex map or a Shopify metafield.
- No product reviews / ratings.
- No back-in-stock UI — the `/contact/notify-stock` **endpoint exists and works** but nothing in `src/` calls it.
- No order-level notes/gift messaging.
- Sizes fall back to a hardcoded `['S','M','L']` when a product has no size option (`normalizeProduct.js:142`).

---

## 4. Data Integrity & Edge Case Risks

### 4.1 Race conditions

| Risk | Verdict |
|---|---|
| **Two users buying the last item** | 🔴 **Unmitigated.** No stock check, no reservation, no locking. Both succeed. See BLOCKER-1. |
| Double-fulfilment (`/verify` + webhook) | ✅ **Correctly handled.** Atomic claim `UPDATE … SET status='processing' WHERE id=$1 AND status='pending'` — `rowCount === 0` means the other caller won (`payment.js:96-107`). |
| Double refund (double-click cancel) | ✅ **Correctly handled.** Same pattern via `status='cancelling'` (`shipping.js:77-83`), with revert-on-failure. |
| Concurrent `shopify-login` for a new user | ✅ **Correctly handled.** `INSERT … ON CONFLICT (email) DO UPDATE` (`auth.js:27-36`). |
| Wishlist sync collision | ✅ Handled by `ON CONFLICT (user_id, product_id)` inside a transaction. |
| Crash mid-fulfilment | 🔴 **Unhandled.** Permanent `processing` state, silent. See HIGH-7. |

The concurrency work that *was* done is genuinely good. Inventory is the one place the same discipline wasn't applied.

### 4.2 Floating-point arithmetic

**File:** `server/routes/payment.js:58-59`

```js
const itemsTotal = pricedLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
const totalPaise = Math.round((itemsTotal + shippingCost) * 100);
```

**Assessed risk: LOW — I'm not going to inflate this one.** Accumulating in float and rounding **once** at the end is the resilient form of this pattern. `3 × 1999.99 = 5999.969999999999` → `Math.round(599996.9999…)` → `599997`. Correct. With INR two-decimal prices and a 30-line cart cap you'd need pathological inputs to drift a paisa.

It is still worth converting to integer paise at parse time (§5 R7) because the pattern is fragile under future change — multi-currency, per-line discounts, or percentage tax would each break it.

**The real money-mismatch risk is elsewhere**, and it's material:

**File:** `server/services/shopify-admin.js:22-36` — `createDraftOrder` sends `line_items`, `shipping_address`, `email`, `note`. It sends **no `shipping_line`** and **no tax directives**. So:

- Customer selects Priority, pays **₹200 shipping via Razorpay** → the Shopify order records **₹0 shipping**. Revenue silently misattributed on every priority order.
- If tax is configured on the Shopify store, Shopify computes tax on the draft order → **Shopify order total ≠ amount captured**, and the order is marked fully paid regardless. Your books won't reconcile.

**Verify your Shopify tax settings before launch.** If taxes are enabled, this is a blocker, not a medium.

### 4.3 Error handling & third-party failure

| Scenario | Handling | Verdict |
|---|---|---|
| Shopify order creation fails post-payment | Status reverted to `pending`, "ACTION NEEDED" email to owner, Slack alert | ✅ Good |
| Refund API fails | Claim reverted, alert email, `502` to client | ✅ Good |
| Shopify cancel fails after successful refund | Logged + Slack; money already returned | ✅ Correct priority |
| Order-number lookup fails | Falls back to local id | ✅ Good |
| Postgres idle-client error | `pool.on('error')` handler prevents process crash | ✅ Good |
| Email send fails | Non-blocking `.catch()` everywhere | ✅ Good |
| **DB unreachable at request time** | ⚠️ Generic 500. No retry, no circuit breaker, no `connectionTimeoutMillis`/`statement_timeout` on the pool (`pg.js:9-13`) | 🟡 Gap |
| **Razorpay API down during `create-order`** | ⚠️ Order row already inserted, then `createRazorpayOrder` throws → **orphaned `pending` row with no `razorpay_order_id`**, never cleaned up | 🟡 Gap |
| **Shopify Storefront down** | ⚠️ Frontend renders an error; no retry, no cached fallback, no stale-while-revalidate | 🟡 Gap |
| **Webhook arrives before `create-order` commits** | Order not found → silently ignored, Razorpay gets `200`, **never retried** (`payment.js:237-244`) | 🟠 Real gap |
| Stuck `processing` orders | None | 🔴 See HIGH-7 |

### 4.4 Other integrity notes

- `orders.shipping_address` and `orders.items` are `TEXT` holding JSON. `JSON.parse` at `orders.js:16-17` and `payment.js:110-111` is **unguarded** — one malformed row throws a 500 and breaks the customer's *entire* order list, not just that row. Use `JSONB` columns, or guard the parse.
- `orders.status` is free-text with no `CHECK` constraint. Six values are used across the codebase (`pending`, `processing`, `paid`, `cancelling`, `cancelled`, plus reverts). A typo in a future migration corrupts state silently.
- `GET /api/orders/:id` passes `req.params.id` straight into an `INTEGER` comparison — `/api/orders/abc` throws a Postgres cast error → 500 instead of 400.
- No `ON DELETE` behaviour on `orders.user_id` / `wishlist.user_id` FKs. Deleting a user for a GDPR/DPDP request will fail on the constraint.

---

## 5. Step-by-Step Remediation Checklist

Ordered by launch impact. Times are focused-work estimates.

---

### R1 — Validate inventory before taking money `[BLOCKER-1]` · 2h

**File:** `server/routes/payment.js`

```js
// Validate and re-price every line against Shopify
const pricedLines = await Promise.all(cartLines.map(async (line) => {
    const numericId = gidToNumeric(line.variantId);
    const quantity = Number(line.quantity);
    if (!numericId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
        throw Object.assign(new Error('Invalid cart line'), { statusCode: 400 });
    }
    const variant = await getVariant(numericId);

    // Availability is as authoritative as price — never take money for stock
    // we don't have. 'continue' policy means the store explicitly allows
    // overselling this variant (made-to-order); anything else must be in stock.
    if (variant.inventory_management === 'shopify' &&
        variant.inventory_policy !== 'continue' &&
        Number(variant.inventory_quantity) < quantity) {
        throw Object.assign(
            new Error(`${line.title || 'An item'} is no longer available in the requested quantity`),
            { statusCode: 409 }
        );
    }

    return {
        variantId: line.variantId,
        title: line.title,
        quantity,
        price: parseFloat(variant.price),
        image: line.image,
        selectedOptions: line.selectedOptions,
    };
}));
```

Then surface `409` in `Checkout.jsx` — replace the `alert()` at line 268 with an inline error and a "return to cart" action.

> **Note on true reservation:** a hard inventory *lock* needs Shopify's `inventorySetQuantities` or a local reservation table with TTL. That's a post-launch project. The check above closes the stale-tab and slow-checkout cases, which is the overwhelming majority of real oversells. It does **not** close the sub-second simultaneous-click race — accept that residual risk for launch and monitor.

---

### R2 — Add the city field `[BLOCKER-2]` · 1h

**`src/pages/Checkout.jsx`** — add to `REQUIRED_FIELDS` (line 13):

```js
const REQUIRED_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'address', 'city', 'state', 'zip'];
```

Add to the form default state (line 71-80): `city: defaultAddr?.city || '',`

Add the input after `address` (line 379):

```jsx
<div className="form-row-v3">
    <input className="checkout-input-v3" name="city" placeholder="CITY" value={form.city} onChange={handleForm} />
    <input className="checkout-input-v3" name="zip" placeholder="PIN/ ZIP CODE" value={form.zip} onChange={handleForm} />
</div>
```

Add to `validateStep0` (after line 117):

```js
if (!form.city.trim()) {
    setValidationError('PLEASE ENTER CITY');
    return false;
}
```

**`server/routes/payment.js`** — enforce it server-side and validate the Indian formats properly (line 30-36):

```js
const addr = shippingAddress || {};
const requiredAddr = ['firstName', 'lastName', 'phone', 'address', 'city', 'state', 'zip'];
for (const field of requiredAddr) {
    if (typeof addr[field] !== 'string' || !addr[field].trim() || addr[field].length > 300) {
        return res.status(400).json({ error: `Invalid shipping address: ${field}` });
    }
}
// India: 6-digit PIN, 10-digit mobile. Reject early rather than at the courier.
const country = (addr.country || 'India').trim();
if (country.toLowerCase() === 'india') {
    if (!/^\d{6}$/.test(addr.zip.trim())) {
        return res.status(400).json({ error: 'Invalid shipping address: PIN code must be 6 digits' });
    }
    if (!/^(\+?91[-\s]?)?[6-9]\d{9}$/.test(addr.phone.replace(/[\s-]/g, ''))) {
        return res.status(400).json({ error: 'Invalid shipping address: phone must be a valid 10-digit mobile number' });
    }
}
```

Then remove the fallback at line 123 — `city: shippingAddress.city,`.

---

### R3 — Pin the Shopify API version `[BLOCKER-3]` · 30m + testing

Set `SHOPIFY_API_VERSION` / `VITE_SHOPIFY_API_VERSION` in env, defaulting to a **currently supported** version (check https://shopify.dev/docs/api/usage/versioning for the current list on the day you deploy):

```js
// server/services/shopify-admin.js:3  and  server/services/shopify-storefront.js:3
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';  // ← verify current
```

```js
// src/lib/shopify.js:11
const apiVersion = import.meta.env.VITE_SHOPIFY_API_VERSION || '2026-04';
```

Add `SHOPIFY_API_VERSION` to `REQUIRED_ENV` in `server/index.js:19` so it can never silently fall back again. **Then smoke-test the whole draft-order → complete → order-number flow** — this is the change most likely to surface a breaking schema difference.

---

### R4 — Require `captured` payments `[BLOCKER-4]` · 5m

**`server/routes/payment.js:197`**

```js
// 'authorized' is a hold, not money in the account — it can expire or fail to
// capture. Never fulfil against it.
if (payment.status !== 'captured') {
    return res.status(400).json({ error: `Payment status: ${payment.status}` });
}
```

---

### R5 — Exempt the webhook from rate limiting + throttle checkout `[HIGH-8, HIGH-9]` · 20m

**`server/index.js`** (replace lines 66-75):

```js
const limitMsg = { error: 'Too many requests, please try again shortly' };
const apiLimiter   = rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false, message: limitMsg,
    // Razorpay's webhook is our safety net for closed-tab payments — it must
    // never be throttled by traffic from other clients sharing an IP.
    skip: (req) => req.path === '/payment/webhook',
});
const authLimiter    = rateLimit({ windowMs: 15*60*1000, max: 60,  standardHeaders: true, legacyHeaders: false, message: limitMsg });
const contactLimiter = rateLimit({ windowMs: 60*60*1000, max: 10,  standardHeaders: true, legacyHeaders: false, message: limitMsg });

// Checkout attempts are keyed per authenticated user, not per IP — shared
// office/mobile-carrier NAT would otherwise punish innocent shoppers.
const checkoutLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: limitMsg,
    keyGenerator: (req) => req.headers.authorization?.slice(7, 60) || req.ip,
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/contact', contactLimiter);
app.use('/api/payment/create-order', checkoutLimiter);
```

---

### R6 — Shorten JWT life + add revocation `[HIGH-6]` · 1.5h

**`server/middleware/auth.js`:**

```js
export function signToken(userId, email) {
    // 7 days. This token authorises payments, refunds and order history —
    // 30 days is far too long for a bearer token living in localStorage.
    return jwt.sign({ id: userId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
}
```

For real revocation, add a token version to `db/pg.js` `initDB()`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
```

Include `tv: user.token_version` in the payload, verify it in `authenticate` against the DB, and bump it on logout / "sign out everywhere". Note this adds a DB read per authenticated request — acceptable at launch volume, cache later if needed.

**Minimum viable for launch if time is short:** ship the 7-day expiry alone. It's 5 minutes and removes most of the exposure.

---

### R7 — Send shipping (and tax) on the Shopify draft order `[§4.2]` · 1h

**`server/services/shopify-admin.js:22`:**

```js
export async function createDraftOrder({ lineItems, shippingAddress, email, note, shippingLine }) {
    const body = {
        draft_order: {
            line_items: lineItems.map(li => ({
                variant_id: li.variant_id,
                quantity: li.quantity,
            })),
            shipping_address: shippingAddress,
            // Without this the customer pays shipping via Razorpay but the
            // Shopify order records ₹0 — revenue silently misattributed.
            ...(shippingLine ? { shipping_line: shippingLine } : {}),
            email,
            note: note || 'Order via MORBEI website',
        },
    };
    return adminFetch('draft_orders.json', { method: 'POST', body: JSON.stringify(body) });
}
```

**`server/routes/payment.js:130`:**

```js
const shippingCostRupees = SHIPPING_COST_RUPEES[order.shipping_method] ?? 0;
const draft = await createDraftOrder({
    lineItems: shopifyLineItems,
    shippingAddress: shopifyAddr,
    email: user.email,
    note: `Razorpay Payment: ${razorpayPaymentId}`,
    shippingLine: {
        title: order.shipping_method === 'priority' ? 'Priority' : 'Standard',
        price: shippingCostRupees.toFixed(2),
    },
});
```

**Also verify Shopify tax settings.** If tax is enabled on the store, the draft order total will exceed what Razorpay captured. Since your pricing is MRP-inclusive (`ProductDetail.jsx:498`), you almost certainly want `taxes_included: true` on the store — confirm in Shopify admin, then reconcile one test order end-to-end before launch.

While here, switch to integer paise for defence in depth (`payment.js:50-59`):

```js
price: Math.round(parseFloat(variant.price) * 100),   // store paise, not rupees
...
const itemsPaise = pricedLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
const totalPaise = itemsPaise + shippingCost * 100;
```

(If you do this, update the two consumers that assume rupees: `email.js:39` `l.price * l.quantity` and `OrderConfirmed`/`OrderDetails` item rendering.)

---

### R8 — Recover stuck `processing` orders `[HIGH-7]` · 1h

Two parts. First, let the webhook rescue them — **`server/routes/payment.js:241`:**

```js
// Also rescue orders stranded in 'processing' by a crash mid-fulfilment.
// fulfillPaidOrder's own atomic claim makes this safe to attempt.
const RECOVERABLE = ['pending', 'processing'];
if (order && RECOVERABLE.includes(order.status) && payment.amount === Number(order.total_amount)) {
    if (order.status === 'processing') {
        // Only unstick rows older than 5 minutes — a live fulfilment is
        // legitimately 'processing' and must not be double-claimed.
        const ageMs = Date.now() - new Date(order.created_at).getTime();
        if (ageMs > 5 * 60 * 1000) {
            await run(`UPDATE orders SET status='pending' WHERE id=$1 AND status='processing'`, [order.id]);
            order.status = 'pending';
        }
    }
    if (order.status === 'pending') {
        await fulfillPaidOrder(order, payment.id);
    }
}
```

Second — and this is the part that actually saves you — **add a startup + hourly sweep** that finds orders `processing` or `pending` for >30 min that have a captured Razorpay payment, and Slack-alerts them. `fetchOrderPayments` in `services/razorpay.js:40` already does the lookup. Without this, silent failures stay silent.

---

### R9 — Sanitize product HTML + add frontend security headers `[MEDIUM-10, MEDIUM-12]` · 45m

```bash
npm i dompurify
```

**`src/pages/ProductDetail.jsx`:**

```jsx
import DOMPurify from 'dompurify';
...
<div dangerouslySetInnerHTML={{
    __html: DOMPurify.sanitize(product.descriptionHtml, {
        ALLOWED_TAGS: ['p','br','strong','em','b','i','u','ul','ol','li','h3','h4','span','a'],
        ALLOWED_ATTR: ['href','target','rel'],
    })
}} />
```

**`vercel.json`** — currently a bare rewrite:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=()" },
        { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://cdn.shopify.com; connect-src 'self' https://*.myshopify.com https://*.railway.app https://api.razorpay.com https://lumberjack.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com" }
      ]
    }
  ]
}
```

⚠️ **Test the CSP against a real Razorpay payment in a preview deploy before promoting.** Razorpay's checkout iframe pulls from several subdomains and a too-tight `frame-src`/`connect-src` will break payments — which is worse than the risk you're mitigating. If anything fails, ship the other five headers now and iterate on CSP with `Content-Security-Policy-Report-Only` first.

---

### R10 — Validate newsletter email `[MEDIUM-11]` · 10m

**`server/routes/contact.js:36`** — mirror what `/notify-stock` already does correctly:

```js
router.post('/newsletter', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        await run('INSERT INTO newsletter (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
        res.json({ success: true });
    } catch (err) { /* unchanged */ }
});
```

---

### R11 — SEO: per-page meta, structured data, sitemap, robots `[§ below]` · 4h

**Install:**
```bash
npm i react-helmet-async
```

**`src/main.jsx`** — wrap with `<HelmetProvider>`.

**Create `src/components/Seo.jsx`:**

```jsx
import { Helmet } from 'react-helmet-async';

const SITE = 'https://morbei.com';   // ← set to the real production domain

export default function Seo({ title, description, image, path = '', type = 'website', jsonLd }) {
    const url = `${SITE}${path}`;
    const img = image || `${SITE}/og-image.jpg`;
    return (
        <Helmet>
            <title>{title}</title>
            <meta name="description" content={description} />
            <link rel="canonical" href={url} />
            <meta property="og:type" content={type} />
            <meta property="og:title" content={title} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={img} />
            <meta property="og:url" content={url} />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={title} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={img} />
            {jsonLd && <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>}
        </Helmet>
    );
}
```

**`src/pages/ProductDetail.jsx`** — replace the `document.title` effect at lines 31-33:

```jsx
{product && (
    <Seo
        title={product.seo?.title || `${product.name} | MORBEI`}
        description={product.seo?.description || product.description?.slice(0, 155)}
        image={product.images?.[0]}
        path={`/product/${product.handle}`}
        type="product"
        jsonLd={{
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            image: product.images,
            description: product.description,
            sku: selectedVariant?.id,
            brand: { '@type': 'Brand', name: 'MORBEI' },
            offers: {
                '@type': 'Offer',
                url: `${SITE}/product/${product.handle}`,
                priceCurrency: product.currency,
                price: product.priceNum,
                availability: product.availableForSale
                    ? 'https://schema.org/InStock'
                    : 'https://schema.org/OutOfStock',
            },
        }}
    />
)}
```

Add `BreadcrumbList` JSON-LD on Shop/PDP and `Organization` on Home.

**Create `public/robots.txt`:**

```
User-agent: *
Allow: /
Disallow: /checkout
Disallow: /order-confirmed
Disallow: /order-failed
Disallow: /order-details
Disallow: /profile

Sitemap: https://morbei.com/sitemap.xml
```

**Generate `public/sitemap.xml`** at build time from the Shopify product list — add a `prebuild` script that queries the Storefront API and writes the file.

> ⚠️ **Structural caveat, stated plainly:** this is a client-rendered SPA. `react-helmet-async` injects tags *after* JS executes. Googlebot renders JS and will see them; **most social crawlers (WhatsApp, Instagram, Slack, Twitter) do not** — they read the raw HTML and will keep showing the generic `index.html` card for every product link. For a fashion brand where Instagram is the primary channel, that matters a lot. The real fix is SSR/SSG (migrate to Next.js or add `vite-plugin-ssr`/prerendering), which is **not a 7-day change**. Ship Helmet now for Google; schedule prerendering for the product routes immediately post-launch.

---

### R12 — Delete the PCI-scope card form and other dead code · 15m

**`src/pages/Checkout.jsx`** — remove lines 57 and 90-95:

```js
// DELETE — never rendered; raw PAN/CVV fields in a React component put the
// whole app in PCI-DSS scope for no functional benefit. Razorpay's popup
// handles all card data.
const [cardForm, setCardForm] = useState({ number: '', name: '', expiry: '', cvv: '' });
const handleCard = (e) => setCardForm({ ...cardForm, [e.target.name]: e.target.value });
const [paymentMethod, setPaymentMethod] = useState('card');   // also unused
```

Also: delete the root `Dockerfile` (broken — see §1b), and replace the placeholder images in `src/pages/About.jsx:39,57` that carry visible "Saint Laurent" branding.

---

### R13 — Reconcile the three shipping policies `[M4]` · 15m

Pick one number. Then update all three: `server/routes/payment.js:12`, `src/pages/Checkout.jsx:453`, `src/pages/ProductDetail.jsx:614`. If free-shipping-over-threshold is real, implement it server-side:

```js
const FREE_SHIPPING_THRESHOLD_RUPEES = 6790;
const method = shippingMethod === 'priority' ? 'priority' : 'standard';
const itemsTotal = pricedLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
const shippingCost = (method === 'standard' && itemsTotal >= FREE_SHIPPING_THRESHOLD_RUPEES)
    ? 0
    : SHIPPING_COST_RUPEES[method];
```

And fix `src/pages/Cart.jsx:168` — "Calculated at checkout" is a promise nothing keeps. Use "Incl. of all taxes".

---

### R14 — Guest checkout `[H1]` · 4h · *scope call required*

This is the highest-revenue item and the most invasive. Sketch:

1. `orders.user_id` → nullable; add `guest_email TEXT`, `guest_phone TEXT`.
2. Replace `authenticate` on `/create-order` with an `optionalAuthenticate` that populates `req.user` when a token is present and otherwise requires a validated `email` in the body.
3. Issue a short-lived (2h), order-scoped JWT on guest order creation so `/verify` and the confirmation page work without an account.
4. `fulfillPaidOrder` — take email/name from `guest_email` when `user_id` is null.
5. Guest order tracking by `order number + email` on `/track`.

**Honest assessment:** 4 hours is optimistic for something on the money path with no test suite. If the week is tight, **defer this and do R1–R13 properly instead.** A working store that converts at 60% is better than a broken store that converts at 80%.

---

### Suggested 7-day plan

| Day | Work |
|---|---|
| **1** | R1 (inventory), R4 (captured), R12 (dead code) — all money-path, all small |
| **2** | R2 (city + validation), R13 (shipping policy), R10 (newsletter) |
| **3** | R3 (API version) + **full end-to-end payment regression test** |
| **4** | R7 (shipping line + tax verification), R8 (stuck orders) |
| **5** | R5 (rate limits), R6 (JWT — at minimum the 7-day expiry), R9 (CSP, in Report-Only first) |
| **6** | R11 (SEO) + P1/P2 from §7 (images, code splitting) |
| **7** | Freeze. Full manual QA: guest→signup→cart→checkout→pay→cancel→refund on a real device. Load-test `create-order`. |

**Explicitly deferred:** R14 (guest checkout), coupons, returns flow, admin panel, SSR.

---

## 6. Newsletter Subscription — How It Works Today

You asked specifically about this, so here is the complete path.

### The flow, end to end

```
Footer.jsx  (rendered on most pages except /, /about, /cart, /checkout, /profile, /wishlist)
   │  <form className="signup-form" onSubmit={handleNewsletterSubmit}>
   │  <input type="email" required />   ← only browser-native validation
   ▼
contactAPI.newsletter(email)                          src/lib/api.js:53
   │  POST { email }
   ▼
apiFetch → POST /api/contact/newsletter               src/lib/api.js:15
   │  (rate-limited: 10 requests / hour / IP via contactLimiter — index.js:71,75)
   ▼
router.post('/newsletter')                            server/routes/contact.js:36
   │  if (!email?.trim()) → 400
   │  INSERT INTO newsletter (email) VALUES ($1) ON CONFLICT (email) DO NOTHING
   ▼
Postgres `newsletter` table                           server/db/pg.js:97
   id | email (UNIQUE) | created_at
```

**And that is the entire feature.** The table is write-only — nothing in the codebase ever reads from it.

### What's missing

| Gap | Detail |
|---|---|
| **No server-side email validation** | Any non-empty string is stored (see R10). The sibling `/notify-stock` route validates properly at line 61 — this one just didn't get it. |
| **Optimistic UI lies** | `Footer.jsx:18-23` — the `catch` block is empty, then `setSubscribed(true)` runs unconditionally. **Network down, rate-limited, server 500 — the user still sees "THANK YOU FOR SUBSCRIBING!"** |
| **No welcome email** | Nothing is sent. The heading promises "GET PRE LAUNCH ACCESS" and the subscriber then hears nothing at all. |
| **No unsubscribe** | No route, no token, no UI. Sending marketing mail to this list without a working unsubscribe link violates CAN-SPAM/GDPR and, in India, the DPDP Act's consent-withdrawal requirement. |
| **No double opt-in** | Anyone can subscribe anyone else's address. |
| **No ESP integration** | Not connected to Shopify Marketing, Klaviyo, Mailchimp — anything. To actually mail this list you'd `SELECT` from Postgres and paste into a tool by hand. |
| **No consent record** | No timestamp of consent source, no IP, no `acceptsMarketing` sync. `AuthContext.jsx:72` normalizes Shopify's `acceptsMarketing` — and never uses it. |
| **No source attribution** | Can't tell footer signups from any future popup. |
| **No admin view** | No way to see or export subscribers. |

### Recommended: sync to Shopify instead of building a mailer

You already pay for Shopify, and it has customer marketing consent, segments, and email campaigns built in — with unsubscribe handling that's legally correct out of the box. Keep the local table as a durable log, and mirror each subscription into Shopify as the system of record. This matches the architecture you already chose everywhere else (Shopify = system of record, backend = the thin custom layer).

**`server/services/shopify-admin.js`** — add:

```js
/**
 * Record marketing consent in Shopify. Shopify owns marketing state for the
 * same reason it owns catalog and identity — it has the campaign tooling and,
 * more importantly, a compliant unsubscribe flow we should not reimplement.
 * Best-effort: a failure here must never fail the subscriber's request.
 */
export async function subscribeToMarketing(email) {
    const existing = await adminFetch(`customers/search.json?query=email:${encodeURIComponent(email)}`);
    const found = existing.customers?.[0];

    if (found) {
        return adminFetch(`customers/${found.id}.json`, {
            method: 'PUT',
            body: JSON.stringify({
                customer: {
                    id: found.id,
                    email_marketing_consent: {
                        state: 'subscribed',
                        opt_in_level: 'single_opt_in',
                        consent_updated_at: new Date().toISOString(),
                    },
                },
            }),
        });
    }

    return adminFetch('customers.json', {
        method: 'POST',
        body: JSON.stringify({
            customer: {
                email,
                tags: 'newsletter,website-footer',
                email_marketing_consent: {
                    state: 'subscribed',
                    opt_in_level: 'single_opt_in',
                    consent_updated_at: new Date().toISOString(),
                },
            },
        }),
    });
}
```

**`server/routes/contact.js`** — the full replacement route:

```js
import { subscribeToMarketing } from '../services/shopify-admin.js';
import { sendNewsletterWelcome } from '../services/email.js';

router.post('/newsletter', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            return res.status(400).json({ error: 'A valid email is required' });
        }

        const source = String(req.body?.source || 'footer').slice(0, 40);

        // Local table is the durable log; Shopify is the marketing system of record.
        const inserted = await run(
            `INSERT INTO newsletter (email, source, consent_ip)
             VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
            [email, source, req.ip]
        );
        const isNew = inserted.rowCount > 0;

        // Both best-effort — a subscriber must never see an error because a
        // downstream marketing system was slow or down.
        subscribeToMarketing(email).catch(err => {
            console.error('Shopify marketing sync failed:', err.message);
            notifySlackError('newsletter → Shopify sync failed', err).catch(() => {});
        });
        if (isNew) {
            sendNewsletterWelcome(email).catch(err =>
                console.error('Welcome email failed:', err.message));
        }

        res.json({ success: true, alreadySubscribed: !isNew });
    } catch (err) {
        console.error(err);
        notifySlackError('newsletter subscribe failed', err).catch(() => {});
        res.status(500).json({ error: 'Something went wrong' });
    }
});
```

**Schema — add to `initDB()` in `server/db/pg.js`** (after line 101):

```sql
-- Consent provenance: required to demonstrate lawful basis under DPDP/GDPR.
ALTER TABLE newsletter ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'footer';
ALTER TABLE newsletter ADD COLUMN IF NOT EXISTS consent_ip TEXT;
ALTER TABLE newsletter ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;
```

---

## 7. Client-Side Newsletter Customisation — Suggestions

You asked what you can do on the client side. Here's what's worth building, in order of value.

### 7a. Fix the honest-feedback problem first (30 min, highest value)

The current component tells everyone they succeeded. Replace `handleNewsletterSubmit` in `src/components/Footer.jsx:15-26`:

```jsx
const [email, setEmail] = useState('');
const [status, setStatus] = useState('idle');   // idle | loading | success | already | error
const [message, setMessage] = useState('');

const handleNewsletterSubmit = async (e) => {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setStatus('error');
        setMessage('PLEASE ENTER A VALID EMAIL');
        return;
    }

    setStatus('loading');
    try {
        const res = await contactAPI.newsletter(value);
        setStatus(res.alreadySubscribed ? 'already' : 'success');
        setMessage(res.alreadySubscribed
            ? "YOU'RE ALREADY ON THE LIST"
            : 'THANK YOU — CHECK YOUR INBOX');
        setEmail('');
    } catch (err) {
        // Never silently claim success: a subscriber who thinks they signed up
        // and hears nothing is worse than one who knows to retry.
        setStatus('error');
        setMessage(err.message?.includes('Too many')
            ? 'TOO MANY ATTEMPTS — PLEASE TRY AGAIN LATER'
            : "COULDN'T SUBSCRIBE — PLEASE TRY AGAIN");
    }
};
```

Render `status`-driven states with `aria-live="polite"` on the message so screen readers announce it, and `disabled={status === 'loading'}` on the button.

### 7b. Client-side ideas ranked by ROI

| # | Idea | Effort | Why |
|---|---|---|---|
| 1 | **Honest status states** (7a) | 30m | You're currently losing subscribers silently and can't tell. |
| 2 | **Exit-intent modal** (desktop) + **scroll-depth trigger** (mobile) | 3h | Typically 3–5× the footer form's conversion. `Modal.jsx` already exists. Fire once per session via `sessionStorage`, never on `/checkout`. |
| 3 | **Offer a reason to subscribe** | 1h | "BE A MEMBER, GET PRE LAUNCH ACCESS" is a promise with nothing behind it. "10% off your first order" with a real code converts several times better. |
| 4 | **Persist dismissal + subscribed state** | 30m | `localStorage.setItem('morbei_newsletter', 'subscribed')` — hide the footer form for anyone who already signed up. Currently it re-prompts forever. |
| 5 | **Source attribution** | 15m | Pass `source: 'footer' \| 'exit-intent' \| 'pdp'` so you can tell what works. Backend already accepts it in the §6 code. |
| 6 | **Inline debounced validation** | 45m | Validate on blur, not on submit. Catch `gmial.com`-class typos with a common-domain suggestion. |
| 7 | **Honeypot field** | 15m | A hidden input bots fill and humans don't — cheap spam filter that needs no CAPTCHA. |
| 8 | **Checkout opt-in checkbox** | 1h | Highest-intent moment you have. Checkout already collects `form.email` — one checkbox, one extra call. Must be **unchecked by default** for DPDP consent to be valid. |
| 9 | **Wire `acceptsMarketing`** | 1h | Already normalized at `AuthContext.jsx:72` and unused. Surface it as a toggle in `Profile.jsx` so account holders can manage consent. |

### 7c. Reusable hook

Extract the logic so the footer, exit-intent modal, and checkout checkbox all share it — `src/hooks/useNewsletter.js`:

```js
import { useState, useCallback } from 'react';
import { contactAPI } from '../lib/api';

const STORAGE_KEY = 'morbei_newsletter';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useNewsletter(source = 'footer') {
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');

    const subscribe = useCallback(async (rawEmail) => {
        const email = String(rawEmail || '').trim();
        if (!EMAIL_RE.test(email)) {
            setStatus('error');
            setMessage('PLEASE ENTER A VALID EMAIL');
            return false;
        }
        setStatus('loading');
        try {
            const res = await contactAPI.newsletter(email, source);
            // Remember locally so we stop prompting someone who already signed up.
            localStorage.setItem(STORAGE_KEY, 'subscribed');
            setStatus(res.alreadySubscribed ? 'already' : 'success');
            setMessage(res.alreadySubscribed
                ? "YOU'RE ALREADY ON THE LIST"
                : 'THANK YOU — CHECK YOUR INBOX');
            return true;
        } catch (err) {
            setStatus('error');
            setMessage(err.message?.includes('Too many')
                ? 'TOO MANY ATTEMPTS — PLEASE TRY AGAIN LATER'
                : "COULDN'T SUBSCRIBE — PLEASE TRY AGAIN");
            return false;
        }
    }, [source]);

    const isSubscribed = () => localStorage.getItem(STORAGE_KEY) === 'subscribed';

    return { subscribe, status, message, isSubscribed };
}
```

Update `src/lib/api.js:53` to pass the source through:

```js
newsletter: (email, source = 'footer') =>
    apiFetch('/contact/newsletter', { method: 'POST', body: JSON.stringify({ email, source }) }),
```

---

## 8. Performance — Making the Site Fast

You asked how to speed things up. The two biggest wins are P1 and P2, and together they're about a day of work.

### Current state

| Metric | Value | Assessment |
|---|---|---|
| JS bundle | **410 KB** (uncompressed, single chunk) | No code splitting whatsoever |
| CSS bundle | **157 KB** (single file) | All 20+ page stylesheets on every route |
| Static assets | 24 files, mostly WebP, largest 184 KB | ✅ Already well optimized |
| Product images | Raw Shopify CDN URLs, **no transform params** | 🔴 The single biggest problem |
| Code splitting | None — 22 pages eagerly imported (`App.jsx:15-36`) | 🔴 |
| Data caching | None — every mount refetches from Shopify | 🔴 |
| Font loading | Google Fonts render-blocking `<link>` (`index.html:29`) | 🟡 |

### P1 — Serve correctly-sized images 🔴 *biggest single win* · 2h

**No image in the app uses Shopify's CDN transform parameters.** Every product image is the **full-resolution original** — typically 2000–3000 px and 500 KB–2 MB. On a phone showing a 400 px-wide grid tile, you're shipping roughly 20× more bytes than the device can display. On Indian 4G this is the difference between a 2-second and a 12-second product grid.

Shopify's CDN does the resizing for free. Add `src/utils/shopifyImage.js`:

```js
/**
 * Add Shopify CDN transform params to a product image URL.
 * The CDN resizes and re-encodes on the fly — serving the 3000px original to
 * a 400px grid tile is the single most expensive thing this site does.
 */
export function shopifyImage(url, width, { format = 'webp' } = {}) {
    if (!url || !url.includes('cdn.shopify.com')) return url;
    const u = new URL(url);
    u.searchParams.set('width', String(width));
    if (format) u.searchParams.set('format', format);
    return u.toString();
}

/** Build a srcset across the widths that matter for a given layout slot. */
export function shopifySrcSet(url, widths = [400, 800, 1200, 1600]) {
    if (!url || !url.includes('cdn.shopify.com')) return undefined;
    return widths.map((w) => `${shopifyImage(url, w)} ${w}w`).join(', ');
}
```

Apply in `src/pages/Shop.jsx:450` (the grid — highest impact):

```jsx
<img
    loading="lazy"
    decoding="async"
    width="800" height="1200"        {/* reserve space — kills layout shift */}
    className="img-primary"
    src={shopifyImage(imgUrl, 800)}
    srcSet={shopifySrcSet(imgUrl)}
    sizes="(max-width: 768px) 50vw, 25vw"
    alt={product.name}
/>
```

And in `ProductDetail.jsx` — main image at 1600, thumbnails at 200, lightbox at 2048.

**Also:** the PDP main image (line 371) is the LCP element and has **no `fetchPriority`**. Add `fetchPriority="high"` and make sure it is *not* `loading="lazy"`. Same for the homepage hero.

### P2 — Code-split the routes 🔴 · 2h

`App.jsx` imports all 22 pages eagerly. A visitor landing on the homepage downloads Checkout, Profile, the lightbox machinery, and every policy page before anything renders.

```jsx
import React, { Suspense, lazy } from 'react';

// Eager — needed for first paint on the most common entry points
import Home from './pages/Home';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

// Lazy — everything else. Checkout in particular pulls in the heaviest tree
// and is reached by a small fraction of sessions.
const Shop          = lazy(() => import('./pages/Shop'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Checkout      = lazy(() => import('./pages/Checkout'));
const Profile       = lazy(() => import('./pages/Profile'));
const Cart          = lazy(() => import('./pages/Cart'));
const Wishlist      = lazy(() => import('./pages/Wishlist'));
const About         = lazy(() => import('./pages/About'));
const Editorials    = lazy(() => import('./pages/Editorials'));
const FAQ           = lazy(() => import('./pages/FAQ'));
const Contact       = lazy(() => import('./pages/Contact'));
const TrackOrder    = lazy(() => import('./pages/TrackOrder'));
const Shipping      = lazy(() => import('./pages/Shipping'));
const Returns       = lazy(() => import('./pages/Returns'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const Terms         = lazy(() => import('./pages/Terms'));
const CookiePolicy  = lazy(() => import('./pages/CookiePolicy'));
const OrderDetails  = lazy(() => import('./pages/OrderDetails'));
const OrderConfirmed= lazy(() => import('./pages/OrderConfirmed'));
const OrderFailed   = lazy(() => import('./pages/OrderFailed'));
const NotFound      = lazy(() => import('./pages/NotFound'));

// …then wrap <Routes> in <Suspense fallback={<LoadingScreen />}>
```

Because each page imports its own CSS, this splits the 157 KB stylesheet too. Expect the initial bundle to land around 120–160 KB.

Add vendor chunking in `vite.config.js`:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'motion': ['framer-motion'],
        },
      },
    },
  },
});
```

### P3 — Stop refetching everything · 3h

There is no caching layer. `useProduct`, `useProducts`, `useCollection` refetch from Shopify on **every mount**. Shop → PDP → back = a full refetch of the grid.

Worse, `ProductDetail.jsx:23` calls `useProducts(40)` — **40 products, each with 10 images and 50 variants** — purely to render 4 recommendation tiles. That is a multi-hundred-KB GraphQL response on every product page view.

Two fixes:

1. **Use the recommendations hook that already exists.** `useProductRecommendations` at `useProducts.js:72` calls Shopify's native `productRecommendations` — better results, tiny payload, already written, never imported. Swap it in and delete the `Math.random()` shuffle at `ProductDetail.jsx:222-245`.

2. **Add a cache.** Either `npm i @tanstack/react-query` (proper solution — dedup, stale-while-revalidate, background refresh) or, if you want zero new dependencies before launch, a 5-minute in-memory `Map` in `src/lib/shopify.js` keyed on `JSON.stringify({query, variables})` for GET-shaped queries. The latter is 20 lines and captures most of the benefit.

### P4 — Fonts · 30m

`index.html:29` loads Google Fonts via a render-blocking `<link rel="stylesheet">`. The `preconnect` hints help, but the stylesheet still blocks first paint on a third-party round trip.

Self-host instead: download the Montserrat and Nunito woff2 subsets into `public/fonts/`, declare `@font-face` with `font-display: swap` in `src/index.css`, and preload only the weights used above the fold:

```html
<link rel="preload" href="/fonts/montserrat-400.woff2" as="font" type="font/woff2" crossorigin />
```

Also note `public/fonts/CastoroTitling-Regular.ttf` is a 55 KB **TTF** — converting to woff2 typically cuts it to ~20 KB.

### P5 — Backend · 1h

- **`pg` pool has no timeouts** (`db/pg.js:9-13`). A hung query holds a connection from a pool of 10 indefinitely. Add:
  ```js
  export const pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
  });
  ```
- **`GET /api/orders` is N+1** (`orders.js:44`): one Shopify Admin API call **per order** via `withTracking`. A customer with 20 orders triggers 20 sequential-ish external calls. Cache tracking data for ~5 min, or only enrich orders from the last 30 days.
- **Add `compression`** middleware — JSON responses aren't gzipped.
- Add an index: `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status) WHERE status IN ('pending','processing');` — the reconciliation sweep in R8 will need it.

### Expected impact

| Change | Effort | Est. LCP improvement (mobile 4G) |
|---|---|---|
| P1 image transforms | 2h | **−3 to −6 s** on product grids |
| P2 code splitting | 2h | −0.8 to −1.5 s |
| P3 caching + native recommendations | 3h | −1 to −2 s on PDP |
| P4 self-hosted fonts | 30m | −0.2 to −0.4 s |
| P5 backend | 1h | −0.3 s on account pages |

**Do P1 first.** It's the cheapest and by a wide margin the largest win.

---

## Appendix — Verification Commands

```bash
# Confirm no secrets in history
git log --all --diff-filter=A --name-only --pretty=format: | sort -u | grep -iE "\.env|secret|\.pem"

# Bundle size after code splitting
npm run build && ls -lhS dist/assets/

# Confirm inventory fields are available on the variant payload
curl -s -H "X-Shopify-Access-Token: $SHOPIFY_ADMIN_TOKEN" \
  "https://$SHOPIFY_STORE_DOMAIN/admin/api/2026-04/variants/<VARIANT_ID>.json" \
  | jq '.variant | {price, inventory_quantity, inventory_policy, inventory_management}'

# Find stuck orders (run this daily post-launch until R8 ships)
psql "$DATABASE_URL" -c \
  "SELECT id, status, total_amount, razorpay_order_id, created_at FROM orders
   WHERE status IN ('pending','processing')
     AND created_at < now() - interval '30 minutes'
   ORDER BY created_at DESC;"
```

---

---

## Post-remediation status (2026-08-11)

### Score: **83 / 100** (was 61)

| Area | Before | After | What changed |
|---|---|---|---|
| Payment integrity | 88 | **95** | Stock validation before capture; `captured`-only fulfilment; shipping line on the Shopify order; total-mismatch alerting |
| Auth & access control | 78 | **88** | JWT 30d → 7d with `token_version` revocation and a real logout endpoint |
| Secrets hygiene | 95 | **95** | Unchanged — was already clean |
| Inventory & order correctness | 35 | **75** | Server-side stock check + stuck-order reconciler. Sub-second race still open (needs true reservation) |
| Data integrity / addresses | 45 | **85** | `city` collected and enforced; PIN/phone validated; India-only enforced server-side |
| Feature completeness | 50 | **62** | Newsletter lifecycle, unsubscribe, real recommendations. Guest checkout / coupons / returns / admin still absent |
| SEO | 22 | **80** | Per-route meta, Product + Breadcrumb + Organization JSON-LD, robots.txt, sitemap, **static OG prerendering** |
| Frontend performance | 48 | **80** | CDN image transforms + srcset, route code-splitting, self-hosted fonts, native recommendations |
| Operability | 40 | **70** | Hourly reconciler with Slack alerts, DB timeouts, tracking cache. Still no admin UI |

### Verification performed

- **Stock decision table** — 16 cases. Caught a real fail-closed bug pre-ship: `Number(null)` is `0`, so an untracked variant would have blocked every order.
- **Address validator** — 26 cases, including the `+91` / spaced / dashed phone formats real customers type.
- **Paise refactor** — 12 carts; old and new math agree on every one, so no charge changed.
- **Schema + reconciler SQL** — run against a real Postgres (throwaway DB; `morbei_dev` untouched). Confirmed the partial index, `token_version`, `initDB()` idempotency, correct candidate selection, and single-winner atomic claims.
- **Module graph** — full server import to rule out cycles after extracting `fulfillment.js`.
- **Browser** — homepage, shop grid, and a product page rendered with zero console errors; verified image transforms, JSON-LD, and canonical/OG output live.
- **Builds and audits** — frontend builds clean; 0 vulnerabilities in both `package.json`s.

### Still open

| Item | Why it's still open |
|---|---|
| **R14 — guest checkout** | Deliberately deferred. Invasive surgery on the money path with no test suite. Highest-revenue remaining item. |
| Sub-second oversell race | Needs Shopify `inventorySetQuantities` or a local reservation table with TTL. The added check closes stale-tab and slow-checkout cases, not two simultaneous clicks. |
| CSP is **Report-Only** | Intentional. Watch the console through one real Razorpay payment, then rename the header key to enforce. |
| Coupons / returns flow / admin panel | Unbuilt. Manual workarounds via Shopify admin. |
| Size guide button | Still has no handler; `metafields.sizeGuide` still unused. |
| `npm run lint` fails repo-wide | ~20 pre-existing unused vars and react-refresh warnings. Untouched — mechanical, but not worth the churn in launch week. |
| Mixed line endings | Three files are CRLF, the rest LF. Worth a `.gitattributes` after launch. |
| Shopify tax settings | Verify before launch. If tax is enabled on the store, the new mismatch alert will fire on the first order. |
| `VITE_SITE_URL` | Set to `morbei.vercel.app`. Change it, plus `robots.txt`'s Sitemap line, when a custom domain lands. |

*End of report.*
