import React, { useEffect, useRef, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useLocation, Navigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ShopProvider } from './context/ShopContext';
import { CartProvider } from './context/CartContext';
import { AuthProvider } from './context/AuthContext';
import { LoadingProvider, useGlobalLoading } from './context/LoadingContext';
import { routeChunks } from './lib/routeChunks';
import ScrollToTop from './components/ScrollToTop';
import LoadingScreen from './components/LoadingScreen';

// Components
import Navbar from './components/Navbar';
import Footer from './components/Footer';

// Pages
//
// Home is eager — it is the most common entry point and lazy-loading it would
// add a chunk round-trip to the very first paint. Everything else is split:
// all 22 pages used to be in one bundle, so a visitor landing on the homepage
// downloaded Checkout, Profile, the lightbox and every policy page first.
// Each page imports its own CSS, so this splits the stylesheet too.
import Home from './pages/Home';

// The routes shoppers reach most are imported through routeChunks so the same
// thunk can be prefetched on hover/touch before the click lands.
const Shop = lazy(routeChunks.shop);
const About = lazy(routeChunks.about);
const Cart = lazy(routeChunks.cart);
const Checkout = lazy(routeChunks.checkout);
// Unlinked internal tool; lazy so it never ships in the shopper's bundle.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const ReturnRequest = lazy(() => import('./pages/ReturnRequest'));
const ProductDetail = lazy(routeChunks.product);
const FAQ = lazy(() => import('./pages/FAQ'));
const Contact = lazy(() => import('./pages/Contact'));
const TrackOrder = lazy(() => import('./pages/TrackOrder'));
const Shipping = lazy(() => import('./pages/Shipping'));
const Returns = lazy(() => import('./pages/Returns'));
const Wishlist = lazy(routeChunks.wishlist);
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const Terms = lazy(() => import('./pages/Terms'));
const OrderDetails = lazy(() => import('./pages/OrderDetails'));
const OrderConfirmed = lazy(() => import('./pages/OrderConfirmed'));
const OrderFailed = lazy(() => import('./pages/OrderFailed'));
const Profile = lazy(routeChunks.profile);
const NotFound = lazy(() => import('./pages/NotFound'));
const Unsubscribe = lazy(() => import('./pages/Unsubscribe'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
import ErrorBoundary from './components/ErrorBoundary';
import ConsentBanner from './components/ConsentBanner';
import { useCustomer } from './hooks/useCustomer';
import { hasRecoverableSession } from './lib/api';
import { useCart } from './hooks/useCart';
import { useOrderRecovery } from './hooks/useOrderRecovery';
import { track } from './lib/analytics';

// Per-route document titles — ProductDetail overrides with the product name once loaded
const ROUTE_TITLES = [
  [/^\/$/, 'MORBEI'],
  [/^\/shop\/?([a-z-]*)/, (m) => m[1] && m[1] !== 'all' ? `${m[1].replace(/-/g, ' ').toUpperCase()} | MORBEI` : 'SHOP | MORBEI'],
  [/^\/product\//, 'MORBEI'],
  [/^\/about/, 'ABOUT | MORBEI'],
  [/^\/cart/, 'CART | MORBEI'],
  [/^\/checkout/, 'CHECKOUT | MORBEI'],
  [/^\/profile/, 'ACCOUNT | MORBEI'],
  [/^\/wishlist/, 'WISHLIST | MORBEI'],
  [/^\/faqs/, 'FAQ | MORBEI'],
  [/^\/contact/, 'CONTACT | MORBEI'],
  [/^\/track/, 'TRACK ORDER | MORBEI'],
  [/^\/order-failed/, 'PAYMENT FAILED | MORBEI'],
  [/^\/order-/, 'YOUR ORDER | MORBEI'],
  [/^\/shipping/, 'SHIPPING | MORBEI'],
  [/^\/returns\/request/, 'RETURN REQUEST | MORBEI'],
  [/^\/returns/, 'RETURNS | MORBEI'],
  [/^\/privacy/, 'PRIVACY POLICY | MORBEI'],
  [/^\/terms/, 'TERMS | MORBEI'],
  [/^\/unsubscribe/, 'EMAIL PREFERENCES | MORBEI'],
  [/^\/account\/reset/, 'RESET PASSWORD | MORBEI'],
];

function titleForPath(pathname) {
  for (const [pattern, title] of ROUTE_TITLES) {
    const match = pathname.match(pattern);
    if (match) return typeof title === 'function' ? title(match) : title;
  }
  return 'MORBEI';
}

const ShopWrapper = () => {
  const { category } = useParams();
  return <Shop category={category?.toUpperCase()} />;
};

/**
 * One ProductDetail per product, not one for the route.
 *
 * React Router keeps the same element mounted when only the :id changes, so
 * the colour, size and gallery position chosen on one product carried over to
 * the next. A colour the new product does not come in matched no variant, and
 * the page then fell back to the first one — picking M added XXS. Keying on
 * the id gives each product its own state.
 */
const ProductRoute = () => {
  const { id } = useParams();
  return <ProductDetail key={id} />;
};

/**
 * A session of any kind — a Shopify account, or a guest's backend token.
 *
 * This used to require a Shopify customer, which predates guest checkout and
 * quietly broke it: a guest who had just paid had a backend session but no
 * Shopify customer, so /order-confirmed bounced them to the sign-in page
 * instead of their confirmation. They lost the order summary, the Purchase
 * event never fired, and the cart was never cleared — all three happen on
 * that page. Their order history did the same thing, despite the backend
 * being built to serve exactly that case.
 *
 * hasRecoverableSession covers both: a backend JWT, or a Shopify token that
 * can still be exchanged for one.
 */
const RequireAuth = ({ children }) => {
  const { customer, loading } = useCustomer();
  if (loading) return null;
  if (!customer && !hasRecoverableSession()) return <Navigate to="/profile" replace />;
  return children;
};

const RequireCart = ({ children }) => {
  const { cart, loading } = useCart();
  if (loading) return null;
  const lines = cart?.lines || [];
  if (lines.length === 0) return <Navigate to="/cart" replace />;
  return children;
};

const AppContent = () => {
  const location = useLocation();
  const { loading } = useGlobalLoading();

  // Close the loop on any payment the browser never saw confirmed.
  useOrderRecovery();

  useEffect(() => {
    document.title = titleForPath(location.pathname);
  }, [location.pathname]);

  // PageView, to Meta and to our own funnel table.
  //
  // The snippet in index.html tracks the document load, which in a single-page
  // app happens once; every route after that is a render, not a load. Without
  // this Meta would see a shopper land on the home page and never go anywhere.
  //
  // The first route is not skipped outright, only skipMeta'd. The inline
  // snippet told Meta about it but not us, and our table needs that row — it
  // is where the session count comes from, so a visitor who lands and bounces
  // would otherwise be invisible and every conversion rate below would be
  // computed against too small a denominator.
  const firstRoute = useRef(true);
  useEffect(() => {
    // The operator's own visits were counted. Opening the dashboard added a
    // session and a visitor to the very figure being read — one with no
    // ViewContent, so it dragged the first conversion step down too.
    if (location.pathname.startsWith('/dashboard')) return;
    const skipMeta = firstRoute.current;
    firstRoute.current = false;
    track('PageView', {}, { skipMeta });
  }, [location.pathname]);

  // Scroll to top on route change
  // Loading screen is controlled by data-fetching pages (Shop, ProductDetail) only

  useEffect(() => {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    const revealElements = document.querySelectorAll('.reveal');
    revealElements.forEach(el => observer.observe(el));

    const mutationObserver = new MutationObserver(() => {
      const newElements = document.querySelectorAll('.reveal:not(.active)');
      newElements.forEach(el => observer.observe(el));
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [location.pathname]);

  return (
    <>
      {loading && <LoadingScreen />}
      <div className="app">
        <Navbar />
      <main>
        {/* Lazy routes suspend on first visit. LoadingScreen is the same
            component the data-fetching pages already use, so a chunk fetch and
            a product fetch look identical to the user. */}
        <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop/:category" element={<ShopWrapper />} />
          <Route path="/shop" element={<ShopWrapper />} />
          <Route path="/about" element={<About />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/returns/request" element={<ReturnRequest />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/checkout" element={<RequireCart><Checkout /></RequireCart>} />
          <Route path="/checkout/:step" element={<RequireCart><Checkout /></RequireCart>} />
          <Route path="/product/:id" element={<ProductRoute />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/faqs" element={<FAQ />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/track" element={<TrackOrder />} />
          <Route path="/order-confirmed" element={<RequireAuth><OrderConfirmed /></RequireAuth>} />
          <Route path="/order-failed" element={<OrderFailed />} />
          <Route path="/order-details" element={<RequireAuth><OrderDetails /></RequireAuth>} />
          <Route path="/shipping" element={<Shipping />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/unsubscribe" element={<Unsubscribe />} />
          {/* Landing pages for the reset link in Shopify's recovery email.
              The query-string form is what our notification template sends;
              the path form matches the URL Shopify generates natively. */}
          <Route path="/account/reset" element={<ResetPassword />} />
          <Route path="/account/reset/:customerId/:resetToken" element={<ResetPassword />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
      {location.pathname !== '/profile' && location.pathname !== '/' && location.pathname !== '/about' && location.pathname !== '/checkout' && location.pathname !== '/cart' && location.pathname !== '/wishlist' && <Footer />}
      {/* Outside the route switch and the footer's exclusions: the question
          has to be asked wherever a visitor lands, including the pages that
          hide the footer. It renders nothing once answered. */}
      <ConsentBanner />
      </div>
    </>
  );
};

function App() {
  return (
    <HelmetProvider>
    <AuthProvider>
      <CartProvider>
        <ShopProvider>
          <LoadingProvider>
            <Router>
              <ScrollToTop />
              <ErrorBoundary>
                <AppContent />
              </ErrorBoundary>
            </Router>
          </LoadingProvider>
        </ShopProvider>
      </CartProvider>
    </AuthProvider>
    </HelmetProvider>
  );
}

export default App;
