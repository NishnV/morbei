# MORBEI codebase audit

Five parallel audits — money path, returns/admin, auth/identity, frontend, infrastructure.
Every claim below was re-verified against the code before being written down.

**Verification key:** ✅ confirmed by me · ⚠️ plausible, unverified · 🔵 needs your decision, not a fix

> **Status:** Tiers 1–4 have been fixed and pushed. Two items remain open and
> need you rather than code, both called out in Tier 4: the registered office
> address disagrees between `src/data/business.js` and `src/data/terms.json`,
> and the Grievance Officer section stays hidden until a real name is set.

---

## Tier 1 — live harm, fix first

### 1. ✅ Anyone who knows a customer's email can take over their account
`server/routes/auth.js:22` refuses an email only when the row is a *real* account:
```js
if (existing && existing.password !== GUEST_PASSWORD) return 409;
```
A **guest** row passes. Execution reaches `ON CONFLICT (email) DO UPDATE … RETURNING *`,
which returns the existing row with the existing `user.id`, and signs a 7-day JWT for it.
Ownership of the address is never proven.

That token grants:
- `GET /api/orders` — every order with full shipping address, phone (`orders.js:115`)
- `POST /api/shipping/cancel/:orderId` — cancels and fires a real Razorpay refund (`shipping.js:54`)
- returns, wishlist

The file's own comments claim two defences; neither holds. "The session can only see orders
that session itself placed" is false (everything is keyed on `user_id`). "A real Shopify login
bumps token_version" only fires on a Shopify login, which a guest-only customer never has.

**Blast radius today:** small — needs an email you've sold to, `/api/auth` allows 60/15min.
Grows with every guest order.

**Fix (recommended):** give the guest token a session-id claim, stamp it on orders created
with it, filter `/api/orders` and cancel by it. Checkout untouched.
**Stopgap (minutes):** refuse guest tokens on `/api/orders` and `/api/shipping/cancel`;
guests use the order-number + email lookup instead. They lose nothing usable — their token is
wiped on every page reload anyway (#12).

### 2. ✅ The pay button shows a price we don't charge
`src/pages/Checkout.jsx:133` renders `cost.totalAmount` from the Shopify cart — items only.
The server charges `itemsPaise + shippingCost * 100` (`payment.js:209`).
**A customer choosing PRIORITY sees ₹4,000 and Razorpay asks for ₹4,200.** There is no order
summary on the payment step at all — no subtotal, no shipping line.

**Fix:** display `cart total + DELIVERY_OPTIONS[method].priceRupees`, render a three-line
summary, and assert the displayed total equals `orderData.amount` before opening Razorpay.
Also `Checkout.jsx:353` hardcodes `priority ? 200 : 0`, duplicating the constant it imports.

### 3. ✅ A fresh database cannot boot — restore-from-backup is broken
`server/db/pg.js:116` runs `ALTER TABLE contact_submissions` **two lines above** the
`CREATE TABLE` at `:118`. `IF NOT EXISTS` guards the column, not the table. The whole schema is
one multi-statement `pool.query()` = one implicit transaction, so on an empty database the ALTER
errors, **every other statement rolls back**, and the process exits (`index.js:227`). With
Railway's `restartPolicyType = "on_failure"`, that's a crash loop.

Production survives only because the table predates the ALTER. You cannot stand up staging,
cannot restore a backup into a new service, cannot run locally from a clean clone.

**Fix:** move line 116 below 122 today. Then split the 190-line DDL string into numbered
migrations with a `schema_migrations` table.

---

## Tier 2 — silent money and data loss

### 4. ✅ Two return states can get permanently stuck
`refunding` (`admin.js:404`) and `exchanging` (`:475`) are written as real statuses but are
absent from `STATUSES` (`:226`) and from every transition guard. If the process dies between the
claim and the final update — deploy, OOM, the 10s query timeout — the row is unreachable
forever. No action accepts either state.

**Root cause:** `status` is overloaded as a mutex. The orders table already solved this properly
with a separate `claimed_at` (`pg.js:98`). Do the same: keep `status='received'`, claim with
`refund_claimed_at`, release stale claims by age in the existing sweep.

### 5. ✅ My regression from today — the new return states have no queue
`src/pages/AdminReturns.jsx:28` still lists only requested/approved/refunded/exchanged/rejected.
I added `in_transit` and `received` this afternoon and never added their tabs. A return marked
"coming back" vanishes from NEW and APPROVED into ALL. The two states that exist to show you what
you're waiting on are the two with no queue. Two lines.

### 6. ✅ The same item can be refunded twice
The unique index covers only `requested`/`approved` (`pg.js:250`). Once a return reaches
`refunded`, the item is fully re-requestable and walks the queue again. `itemAmountPaise` caps at
the *order* total, not at what's already been refunded.

### 7. ✅ A received item that fails inspection has nowhere to go
`reject` is reachable only from `requested` (`admin.js:312`). Once at `received`, the only actions
are refund and exchange. The most likely real outcome of a declaration-based policy — it arrives
worn, without tags, or isn't the item claimed — has no state, no email, and no way out.

### 8. ✅ Refunds never reach Shopify, and stock is never restocked
There is no inventory adjustment anywhere in the codebase (grep: zero hits). A refunded garment
stays "sold" in Shopify forever — it sits on your shelf while the product page says sold out, and
Shopify's revenue permanently overstates takings. The exchange path meanwhile *decrements* stock
again. **At 3 orders invisible; at 50 it silently shrinks your sellable catalogue.**

### 9. ✅ An exchange replacement exists only in Shopify
`admin.js:485` creates the draft order and records only the number — no local `orders` row. So a
replacement can never be marked delivered (the dashboard reads the local table), never starts a
return window, can't be tracked, and can't itself be returned.

### 10. ✅ `cancelling` is a dead end, and `refund_id` is written too late
`shipping.js:78` claims the status, refunds, cancels in Shopify, and only then writes
`cancelled` + `refund_id`. Die in between and nothing recovers it — the reconciler sweeps only
`pending`/`processing`. Worst case the Razorpay refund succeeded and there is **no local record
the customer was paid back**. Persist `refund_id` immediately after the Razorpay call returns.

### 11. ✅ A paid-but-unfulfilled order is invisible to everyone
`status='pending'` is excluded from the customer's history (`orders.js:115`) *and* your dashboard
(`admin.js:40`), and the reconciler gives up silently after 72h (`reconcile.js:31`). Money
captured, no order, no record either of you can see — and it re-alerts hourly for three days
before going quiet.

### 12. ✅ The guest session is destroyed on every page load
`AuthContext.jsx:174` calls `clearAuth()` whenever no *Shopify* token is present. A guest has none
by definition, so their backend session is wiped on the next mount. Their just-placed order
disappears from `/order-details`, and guests have **no cancellation path at all** while signed-in
customers get an automatic refund. Meanwhile the server-side token stays valid for 7 days — too
fragile for the customer, too durable for an attacker.

---

## Tier 3 — cheap, high leverage

### 13. ✅ No CI, and lint is already red
No `.github/` exists. `npx eslint .` reports **114 problems, 107 errors** — including the
swallowed `error` variables that cause #14. A ~40-line GitHub Action running lint, both builds,
and **`initDB()` against an empty throwaway Postgres** would have caught #3 and will catch every
future ordering mistake in that DDL string.

### 14. ✅ A failed fetch renders as "nothing exists"
`Shop.jsx:167` and `:172` destructure `error` and never use it, so a dropped request on mobile
data renders **"NO PRODUCTS FOUND"**. `ProductDetail.jsx:68` never destructures `error` at all, so
a shared Instagram link that fails to load says **"PRODUCT NOT FOUND"**. There is no retry
anywhere without a reload.

### 15. ✅ The checkout form has no labels and no autofill
`Checkout.jsx:531-563` — seven inputs, placeholder-only, zero `<label htmlFor>`, zero `aria-*`,
**zero `autoComplete`**. Mobile browsers and password managers cannot fill an Indian shipping
address. Likely the cheapest conversion fix in this document.

### 16. ✅ Missing indexes on the endpoints strangers can call
No index on `orders.shopify_order_number`, and `lower(u.email)` can't use the `users.email`
unique index. Both the guest order lookup and the returns lookup therefore seq-scan both tables
on every call. With `statement_timeout: 10000` these become customer-visible timeouts, not slow
pages, as the table grows.

### 17. ✅ The admin dashboard is one shared secret with no floor
No dedicated rate limit — `/api/dashboard` inherits the global 1000/15min while returns and
contact both got tight buckets. No minimum entropy (it isn't in `REQUIRED_ENV`). Stored in
`localStorage` indefinitely. `/dashboard` is **not in robots.txt**, though other sensitive routes
are. That one header reads every customer's PII, issues refunds, and raises Shopify orders.

### 18. ✅ ~180 KB of react-dom ships in the app chunk on every deploy
`vite.config.js:14` lists `react-dom`, but `main.jsx` imports `react-dom/client` — a different
module id — so the renderer was never pulled into the vendor chunk. Verified in the committed
build: `createRoot` and `__reactContainer` appear in `index-*.js` (287 KB) and not in
`react-vendor-*.js` (49 KB). Add `react-dom/client` and `react/jsx-runtime` to the list.

---

## Tier 4 — your decision, not a code fix

### 19. 🔵 Third-party tracking fires before any consent
Meta Pixel fires `PageView` at document load (`index.html:66`), and Microsoft Clarity —
**session recordings**, which capture form interaction — installs before React renders
(`main.jsx:13`). There is no consent mechanism of any kind. `PrivacyPolicy.jsx:63` says "with
your consent, where required" for consent that is never requested. Under DPDP the model is
notice-and-consent *before* processing; both scripts have transmitted before the visitor sees
anything. Your first-party funnel is the careful part (`pg.js:152` deliberately stores no IP or
UA) — the third-party scripts bypass all of it. Not legal advice; worth an hour with counsel.

### 20. 🔵 No Grievance Officer
Consumer Protection (E-Commerce) Rules 2020 require one, displayed with name, designation and
contact. Grep across pages, components and public finds nothing. Legal name, GSTIN and phone are
already present, so this is an addition to pages that exist.

### 21. ✅ Your registered address disagrees with itself — and I picked one today
- `Contact.jsx:53` — Vigneshwara Nagar, Gerugambakkam, Chennai 600128
- `terms.json:302` — same
- `terms.json:18` — **Vigneshwara Nagar, Kancheepuram, Tamil Nadu 600122**

I put the Chennai 600128 version on the returns page and into the email templates this afternoon
without knowing the terms disagreed. For the address a customer posts a return to — and the one
they'd serve a legal complaint at — one of these is wrong. Pick one, put it in a single constant,
have all three read it.

---

## Automation: worth it now

**Abandoned-checkout email.** The rows already exist — `pending` orders hold email, items and
address, written before the gateway opens. One query in the existing hourly sweep, one column,
one template reusing `itemRowsHtml`. ~60 lines. At three orders, recovering one is a third more
revenue, and abandonment is the known problem.

**Nudges on the two manual gates.** Forgetting MARK DELIVERED means the customer can never start
a return. Forgetting MARK RECEIVED leaves them waiting on money. A few lines in the sweep to
Slack a reminder for orders fulfilled >N days with no `delivered_at`, and returns stuck
`in_transit`. The failure mode is forgetting the one return you have, which is exactly what
happens when there's no queue pressure.

**Restock on refund.** Needs an `inventoryAdjust` helper. Make it an explicit "put back on the
shelf" button, not implicit — damaged returns must not restock. Half a day; justified at any
volume because #8 costs sales, not time.

**CI.** See #13.

## Automation: not yet

**Shopify fulfilment webhook.** `FULFILLMENTS_CREATE` does exist — the comment I wrote in
`reconcile.js` today claiming there is no callback is **wrong** and should be corrected so the
next reader doesn't inherit a false constraint. But the hourly poll is written, idempotent, and
"within the hour" is indistinguishable from instant for a hand-packed parcel. Revisit at volume.

**Shiprocket reverse pickup.** High effort, manual path works. Revisit past ~5 returns/week.

**Razorpay refund reconciliation.** Not yet — but **store `refund_id` now** (#10). Near-zero cost
today, unrecoverable for refunds already issued.

---

## Design decisions worth revisiting

| Decision | Why it's wrong | Better |
|---|---|---|
| Identity keyed on email, account type smuggled into `password` as `'!guest'`/`'!shopify'` | Any email collision transfers order history (#1); an email change in Shopify orphans the account silently | `shopify_customer_id` as the key, email as mutable data, explicit `auth_kind` column |
| Schema as one 190-line DDL string run on every boot | Ordering is remembered, not enforced — produced #3 | Numbered migrations + `schema_migrations` |
| `status` overloaded as a mutex | Produced #4 and #10 | Separate `*_claimed_at` timestamps, released by age |
| Cart bypasses `normalizeProduct` | Raw Shopify shapes reach the payment payload; per-unit price reconstructed by division with a two-shape fallback (`Checkout.jsx:307`) | Apply the already-written `normalizeCartLine`, which is currently imported by nothing |
| `trust proxy 1` on Railway | **Not** a spoofing hole — Railway overwrites `X-Forwarded-For`. But a fixed hop count isn't guaranteed to land on the visitor; if the chain lengthens, every shopper collapses into one rate-limit bucket | Key limiters on `x-real-ip` as Railway recommends |
| `authLimiter` 60/15min per IP | Covers `/auth/guest` — the identity step of guest checkout — at one fifth of the budget already proven to 429 real shoppers on CGNAT | Key per submitted email, raise the IP ceiling |

---

## Known-good (don't re-audit)

Secret handling is clean — no `.env` tracked, nothing in git history. Graceful shutdown, pool
timeouts, raw-body HMAC on the Razorpay webhook, and the two-tier health check are all better
than typical. SEO for a client-rendered store is handled properly via `prerender-og.mjs`. Image
performance is good — CDN transforms, `srcSet`/`sizes`, explicit dimensions, preconnect,
self-hosted preloaded fonts. `src/lib/api.js` is the strongest file in the frontend.
`normalizeProduct` is a genuine seam for products — no raw Shopify shapes reach any page.

## Corrections to things I said or wrote

- `reconcile.js` — my comment claiming Shopify has no fulfilment callback is false.
- `AdminReturns.jsx` — I shipped two states today without their tabs (#5).
- `CLAUDE.md:41` says the backend JWT is 30 days. It is 7 (`middleware/auth.js:8`).
- I added the Chennai address today not knowing `terms.json` disagrees (#21).
