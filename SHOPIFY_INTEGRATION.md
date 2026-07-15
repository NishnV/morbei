# MORBEI — Shopify Storefront API Integration Guide

This document explains how to connect the existing MORBEI frontend components
to the Shopify Storefront API backend layer.

---

## Quick Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your Shopify credentials:

```bash
cp .env.example .env
```

```env
VITE_SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
VITE_SHOPIFY_STOREFRONT_TOKEN=your_storefront_access_token
VITE_SHOPIFY_API_VERSION=2024-01
```

> **Where to find these:**
> 1. Go to your Shopify Admin → Settings → Apps and sales channels → Develop apps
> 2. Create a new app or select an existing one
> 3. Configure Storefront API access scopes:
>    - `unauthenticated_read_product_listings`
>    - `unauthenticated_read_product_inventory`
>    - `unauthenticated_read_product_tags`
>    - `unauthenticated_read_customers`
>    - `unauthenticated_write_checkouts`
>    - `unauthenticated_read_checkouts`
>    - `unauthenticated_read_content`
>    - `unauthenticated_read_customer_tags`
>    - `unauthenticated_write_customers`
> 4. Install the app and copy the Storefront API access token

### 2. No Extra Dependencies Needed

The integration uses the native `fetch` API — no extra packages required.

---

## Architecture Overview

```
src/
├── lib/
│   └── shopify.js              ← Storefront API client (shopifyFetch)
├── graphql/
│   ├── products.js             ← Product queries (list, single, recommendations)
│   ├── collections.js          ← Collection queries (list, products in collection)
│   ├── cart.js                 ← Cart mutations & queries
│   ├── customer.js             ← Auth & account queries/mutations
│   └── search.js               ← Search & predictive search queries
├── hooks/
│   ├── useProducts.js          ← Paginated product list + recommendations
│   ├── useProduct.js           ← Single product by handle or ID
│   ├── useCollection.js        ← Collection products with filter/sort
│   ├── useCart.js               ← Cart actions (wraps CartContext)
│   ├── useSearch.js             ← Full-text search + predictive search
│   └── useCustomer.js           ← Auth actions (wraps AuthContext)
├── context/
│   ├── CartContext.jsx          ← Shopify cart state (persists cart ID)
│   ├── AuthContext.jsx          ← Customer auth state (persists token)
│   └── ShopContext.jsx          ← Existing local state (remains for admin/offline)
└── utils/
    ├── formatPrice.js           ← MoneyV2 → "RS. X,XXX" formatting
    ├── parseShopifyId.js        ← GID decoding/encoding
    └── normalizeProduct.js      ← Shopify response → MORBEI frontend shape
```

---

## How to Connect Each Component

### Home.jsx

**Current:** Uses `getAllProducts()` from ShopContext (local data).

**Shopify integration:**
```jsx
import { useProducts } from '../hooks/useProducts';

const Home = () => {
    const { data: products, loading, error } = useProducts(20);

    // Filter upcoming products
    const upcomingProducts = products.filter(p => p.tags.includes('upcoming'));

    // The normalized products have the same shape as local data:
    // { id, name, price, priceNum, images, img, category, ... }
};
```

### Shop.jsx

**Current:** Uses `getProductsByCategory()` with local filtering/sorting.

**Shopify integration (with collection):**
```jsx
import { useCollection } from '../hooks/useCollection';

const Shop = ({ category }) => {
    const handle = category.toLowerCase().replace(' ', '-'); // e.g., "new-in"

    const { data, loading, error, availableFilters, hasNextPage, fetchMore } = useCollection(handle, {
        sortBy: 'price-low',  // or 'newest', 'best-selling', etc.
        filters: [
            // Example: filter by size
            { variantOption: { name: "Size", value: "M" } },
            // Example: filter by price range
            { price: { min: 1000, max: 5000 } },
            // Example: filter by availability
            { available: true },
        ],
        pageSize: 20,
    });

    const { collection, products } = data;

    // `products` already has the MORBEI shape: { id, name, price, img, sizes, ... }

    // For "load more" pagination:
    // <button onClick={fetchMore} disabled={!hasNextPage}>Load More</button>

    // Shopify provides available filter values in `availableFilters`
    // Use them to build dynamic filter UI
};
```

**Shopify integration (with search):**
```jsx
import { useSearch } from '../hooks/useSearch';

const Shop = () => {
    const searchQuery = searchParams.get('search');

    const { data: products, totalCount, loading } = useSearch(searchQuery, {
        sortBy: 'relevance',
        pageSize: 20,
    });
};
```

### ProductDetail.jsx

**Current:** Uses `getProductById()` to find local product.

**Shopify integration:**
```jsx
import { useProduct } from '../hooks/useProduct';
import { useProductRecommendations } from '../hooks/useProducts';
import { useCart } from '../hooks/useCart';

const ProductDetail = () => {
    const { handle } = useParams(); // Change route from :id to :handle
    const { data: product, loading, error } = useProduct(handle);
    const { data: recommendations } = useProductRecommendations(product?.shopifyId);
    const { addToCart } = useCart();

    // Variant selection:
    const [selectedSize, setSelectedSize] = useState('');
    const [selectedColor, setSelectedColor] = useState('');

    const selectedVariant = product?.variants.find(v =>
        v.size === selectedSize && v.color === selectedColor
    );

    const handleAddToCart = () => {
        if (selectedVariant) {
            addToCart(selectedVariant.id, 1);
        }
    };

    // product.metafields.sizeGuide — size guide from metafield
    // product.metafields.material — material info
    // product.metafields.careInstructions — care info
    // product.metafields.badge — "New", "Sale", etc.

    // product.seo — { title, description } for <head> meta
};
```

### Cart.jsx

**Current:** Uses cart array from ShopContext with local price parsing.

**Shopify integration:**
```jsx
import { useCart } from '../hooks/useCart';
import { formatPrice } from '../utils/formatPrice';

const Cart = () => {
    const {
        cartItems,
        cartCount,
        subtotal,
        total,
        tax,
        discountCodes,
        checkoutUrl,
        loading,
        error,
        updateQuantity,
        removeFromCart,
        applyDiscount,
    } = useCart();

    // Cart items have: { lineId, id, name, img, size, color, quantity, priceNum }

    // Update quantity: updateQuantity(item.lineId, item.quantity + 1)
    // Remove item: removeFromCart(item.lineId)
    // Apply discount: applyDiscount('SAVE10')

    // Prices: formatPrice(subtotal) → "RS. 5,000"
    // Checkout: <a href={checkoutUrl}>Proceed to Checkout</a>
};
```

### Checkout.jsx

**Current:** Mock multi-step checkout form.

**Shopify integration:**
```jsx
import { useCart } from '../hooks/useCart';

const Checkout = () => {
    const { checkoutUrl, cartItems, total } = useCart();

    // Instead of mock payment, redirect to Shopify checkout:
    const handleCheckout = () => {
        if (checkoutUrl) {
            window.location.href = checkoutUrl;
        }
    };

    // Shopify handles all payment, shipping, and tax calculation
    // After checkout, Shopify redirects back to your site
};
```

### Navbar.jsx (Search)

**Current:** Local product search with 3-second debounce.

**Shopify integration:**
```jsx
import { usePredictiveSearch } from '../hooks/useSearch';

const Navbar = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const { data: searchResults, loading: isSearching } = usePredictiveSearch(searchQuery, 300, 5);

    // searchResults.products — product suggestions with { title, handle, img, price }
    // searchResults.collections — collection suggestions
    // searchResults.queries — query suggestions

    // Link to product: /product/${result.handle}
};
```

### Wishlist.jsx

**Current:** Uses localStorage via ShopContext.

**Shopify integration:** Wishlist can remain in localStorage (using ShopContext)
since Shopify's Storefront API doesn't have a native wishlist feature.
Optionally, store wishlist in customer metafields for logged-in users.

### Customer Authentication (Profile Page)

**New — create a Profile/Account page:**
```jsx
import { useCustomer } from '../hooks/useCustomer';

const Profile = () => {
    const {
        customer,
        isAuthenticated,
        loading,
        login,
        signUp,
        logout,
        updateProfile,
        addAddress,
        updateAddress,
        deleteAddress,
        setDefaultAddress,
        recoverPassword,
    } = useCustomer();

    // customer.firstName, customer.lastName, customer.email
    // customer.addresses — array of addresses
    // customer.orders — array of orders with line items

    // Login: login('email@example.com', 'password')
    // Sign up: signUp({ firstName, lastName, email, password })
    // Update: updateProfile({ firstName: 'New Name' })
    // Add address: addAddress({ address1: '...', city: '...', country: 'IN', zip: '...' })
};
```

---

## Data Shape Comparison

The `normalizeProduct()` utility transforms Shopify's response to match
the existing MORBEI frontend shape, so most components work with minimal changes:

| MORBEI Frontend | Shopify Normalized | Notes |
|---|---|---|
| `product.id` | `parseShopifyId(product.id)` → numeric string | Use `shopifyId` for API calls |
| `product.name` | `product.title` | Mapped to `name` by normalizer |
| `product.price` | `"RS. 5,000"` | Formatted from MoneyV2 |
| `product.priceNum` | `5000` | Numeric from MoneyV2.amount |
| `product.images[]` | Array of URL strings | Extracted from edges/nodes |
| `product.img` | First image URL | Fallback to placeholder |
| `product.sizes[]` | `['S', 'M', 'L']` | From variant selectedOptions |
| `product.category` | `'DRESSES'` | Mapped from productType |

---

## Discount / Sale Price Display

Products with `compareAtPrice > price` are automatically detected:

```jsx
import { isOnSale, getDiscountPercentage, formatPrice } from '../utils/formatPrice';

// In a product card:
{product.isOnSale && (
    <>
        <span className="original-price">{product.compareAtPrice}</span>
        <span className="sale-badge">-{getDiscountPercentage(
            { amount: product.priceNum.toString(), currencyCode: 'INR' },
            { amount: product.compareAtPriceNum.toString(), currencyCode: 'INR' }
        )}%</span>
    </>
)}
<span className="current-price">{product.price}</span>
```

---

## SEO / JSON-LD Structured Data

Each product from Shopify includes `seo.title` and `seo.description`.
Add structured data to the ProductDetail page:

```jsx
const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name,
    "description": product.description,
    "image": product.images,
    "brand": { "@type": "Brand", "name": product.vendor || "MORBEI" },
    "offers": {
        "@type": "Offer",
        "price": product.priceNum,
        "priceCurrency": product.currency,
        "availability": product.availableForSale
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
    }
};

// In JSX:
<script type="application/ld+json">{JSON.stringify(structuredData)}</script>
```

---

## Important Notes

1. **Dual mode:** ShopContext (local data) and Shopify hooks can coexist during migration.
   Gradually replace local calls with Shopify hooks.

2. **Route change for PDP:** Consider changing `/product/:id` to `/product/:handle`
   since Shopify identifies products by handle in URLs.

3. **Cart migration:** The ShopContext cart (localStorage) and the Shopify CartContext
   are separate. Once you switch to Shopify cart, the old `addToCart`/`removeFromCart`
   from ShopContext should be replaced with `useCart()` from CartContext.

4. **Checkout:** Shopify handles the actual checkout. Replace the current mock checkout
   flow with a redirect to `checkoutUrl` from the cart.

5. **Token security:** The Storefront API token is a public token (safe for frontend use).
   Never expose your Admin API token.
