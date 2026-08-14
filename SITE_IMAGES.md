# Changing site images without a developer

Everything outside the product catalogue — the homepage hero, the editorial
spreads, the About photos, the account page panel — can now be swapped from the
Shopify admin. No code change, no deploy.

Product photos are **not** here; those already live on the products themselves
in Shopify.

---

## One-time setup (~10 minutes, do this once)

### 1. Create the metaobject definition

Shopify admin → **Settings → Custom data → Metaobjects → Add definition**

- **Name:** `Site Image`
- **Type:** must be exactly `site_image` (Shopify derives this from the name —
  check it, and correct it if it differs)

Add three fields:

| Field name | Type | Settings |
|---|---|---|
| `slot` | Single line text | ✅ Required · ✅ "Limit to unique values" |
| `image` | File | ✅ Required · accept images only |
| `alt` | Single line text | optional |

> The field **keys** must be `slot`, `image` and `alt` exactly. Shopify shows
> the key under the field name when you create it — if it generated something
> like `slot_name`, edit it. The site looks these up by key.

### 2. Expose it to the storefront

Still in the definition, find **Access → Storefronts** and set it to
**Read**.

This is the step people miss. Without it the API returns nothing and every
image silently falls back to the old built-in file — which looks like "my
changes did nothing".

### 3. Check the Storefront API token can read metaobjects

Shopify admin → **Settings → Apps and sales channels → Develop apps** → your
app → **Configuration → Storefront API** → ensure
**`unauthenticated_read_metaobjects`** is checked. Save.

If you had to change this, the token itself does not change — no env var update
needed.

---

## Changing an image (~30 seconds)

1. **Content → Files → Upload files** — drop the new image in.
2. **Content → Metaobjects → Site Image**
   - Editing an existing slot? Open it, change the **image** field, save.
   - New slot? **Add entry**, type the slot key from the table below into
     `slot`, pick the image, save.
3. Reload the site. Give it up to an hour, or hard-refresh
   (<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>) to see it immediately —
   see [Caching](#caching) below.

That's it. Nothing to deploy.

---

## Slot reference

Slot keys are named after **the position on the page**, not the file. Two slots
can point at the same photo — `campaign-1.webp` currently backs both the
homepage editorial-left panel and the Dresses category tile, so renaming by file
would have made those impossible to change independently.

### Homepage

| Slot | Where it appears | Current fallback | Notes |
|---|---|---|---|
| `home-hero` | Full-screen hero, first thing on the site | `newhome/herosec.webp` | **Largest visual impact.** Upload at least 2400px wide. |
| `home-editorial-left` | Left half of the split editorial section | `campaign-1.webp` | |
| `home-editorial-right` | Right half of the split editorial section | `split-right.webp` | |
| `home-category-dresses` | "DRESSES" category tile | `campaign-1.webp` | Portrait crops work best |
| `home-category-tops` | "TOPS" category tile | `campaign-2.webp` | Portrait crops work best |
| `home-category-bottoms` | "BOTTOMS" category tile | `edit5.webp` | Portrait crops work best |

### Editorials page

| Slot | Where it appears | Current fallback |
|---|---|---|
| `editorial-crosswalk` | Top image, under the CROSSWALK title | `edit1.webp` |
| `editorial-feature` | Full-width feature band | `hero-slide-3.webp` |
| `editorial-run-late` | Left column of the "Run Late" split | `edit3.webp` |
| `editorial-gallery` | Full-width merged gallery | `edit4.1.webp` |
| `editorial-frugal-chic` | "Frugal Chic" main image | `edit5.webp` |
| `editorial-final` | Closing full-width image | `edit5.webp` |

### About page

| Slot | Where it appears | Current fallback |
|---|---|---|
| `about-design` | "Our Design" section | `about-our-design.jpg` |
| `about-craft` | "Our Craft" section | `about-our-craft.jpg` |
| `about-standards` | "Our Standards" section | `about-our-standards.jpg` |

> ⚠️ `about-craft` and `about-standards` currently show stock photos with
> **visible "Saint Laurent" branding** (flagged in the audit as a trademark
> risk). These two are the most urgent to replace.

### Account page

| Slot | Where it appears | Current fallback |
|---|---|---|
| `account-side` | Side panel on the sign-in / account screen | `login-side.webp` |

### Not managed here

| Image | Where to change it |
|---|---|
| Product photos | On the product in Shopify — already works this way |
| `og-image.jpg` | Social share card. Static file in `public/`; needs a deploy |
| Favicon / apple-touch-icon | Static files in `public/`; needs a deploy |

---

## Image guidance

- **Format:** upload the highest-quality JPG or PNG you have. Shopify's CDN
  converts to WebP and resizes per device automatically — don't pre-optimise.
- **Size:** upload large. `home-hero` wants 2400px+ wide; the rest 1600px+.
  The CDN scales down, but it cannot invent detail it wasn't given.
  *(The current product photos are only ~320px wide, which is why they look
  soft — same principle applies here.)*
- **Aspect ratio:** match the image you're replacing. The layouts crop with
  `object-fit: cover`, so a very different ratio will crop in unexpected ways.
- **Alt text:** fill in the `alt` field. It's what screen readers announce and
  what Google reads. If you leave it blank the site falls back to the alt text
  set on the file in Shopify, then to the original hardcoded text.

---

## Caching

The slot map is cached in the visitor's browser for **one hour**, and is used to
paint the page instantly on repeat visits rather than waiting on a network call.

Consequences:

- A change can take **up to an hour** to appear for someone who visited recently.
- A hard refresh shows it immediately.
- First-time visitors always get the current version.

This is deliberate: the homepage hero is the single biggest element on the page,
and blocking the first paint on a CMS lookup would make the site measurably
slower than the hardcoded files this replaced. To change the window, adjust
`CACHE_TTL_MS` in [src/hooks/useSiteImages.js](src/hooks/useSiteImages.js).

---

## If an image doesn't change

Work down this list — the first two cause almost every case:

1. **Storefront access not set.** Definition → Access → Storefronts → **Read**.
2. **Slot key typo.** It must match the table exactly: lowercase, hyphens, no
   spaces. `home_hero` and `Home-Hero` will both silently do nothing.
3. **Waiting on the cache.** Hard-refresh.
4. **Entry saved without an image.** A slot with no file attached is skipped and
   the fallback shows.
5. **Missing API scope.** `unauthenticated_read_metaobjects` on the Storefront
   API config.

To confirm what the site is actually receiving, open the browser console on the
live site and run:

```js
JSON.parse(localStorage.getItem('morbei_site_images'))
```

That prints every slot the site currently knows about. An empty `map` means
nothing is reaching the storefront — that's step 1 or 5.

---

## How it works (for whoever maintains this)

| File | Role |
|---|---|
| [src/graphql/siteImages.js](src/graphql/siteImages.js) | Storefront API query for `site_image` metaobjects |
| [src/hooks/useSiteImages.js](src/hooks/useSiteImages.js) | Fetch, module + localStorage cache, background revalidation |
| [src/components/SiteImage.jsx](src/components/SiteImage.jsx) | The `<SiteImage slot="…" fallback="…" />` component |

Design notes:

- **Fallbacks are load-bearing.** Every slot keeps its original file in
  `public/`. An empty CMS, an unfilled slot, a missing API scope or a Shopify
  outage all degrade to exactly how the site looked before. It is never possible
  for a CMS problem to produce a broken image.
- **One fetch per page load**, shared through a module-level cache and
  deduplicated while in flight. These change maybe monthly; per-component
  fetching would be pure waste.
- **Never blocks render.** The fallback paints immediately and the managed image
  swaps in. On repeat visits the localStorage seed means there's no swap at all.
- Images resolve to the Shopify CDN, so `shopifyImage()` / `shopifySrcSet()`
  apply automatically — managed images get the same responsive `srcset`
  treatment as product photos.

### Adding a new slot

1. Use it in the JSX:
   ```jsx
   <SiteImage slot="my-new-slot" fallback="/existing-file.webp" alt="…" />
   ```
2. Add a row to the slot reference above.
3. Create the matching entry in Shopify. No other change needed — the hook
   fetches all entries and looks up by key.
