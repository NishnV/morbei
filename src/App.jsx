import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useParams, useLocation, Navigate } from 'react-router-dom';
import { ShopProvider } from './context/ShopContext';
import { CartProvider } from './context/CartContext';
import { AuthProvider } from './context/AuthContext';
import { LoadingProvider, useGlobalLoading } from './context/LoadingContext';
import ScrollToTop from './components/ScrollToTop';
import LoadingScreen from './components/LoadingScreen';

// Components
import Navbar from './components/Navbar';
import Footer from './components/Footer';

// Pages
import Home from './pages/Home';
import Shop from './pages/Shop';
import Editorials from './pages/Editorials';
import About from './pages/About';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import ProductDetail from './pages/ProductDetail';
import FAQ from './pages/FAQ';
import Contact from './pages/Contact';
import TrackOrder from './pages/TrackOrder';
import Shipping from './pages/Shipping';
import Returns from './pages/Returns';
import Wishlist from './pages/Wishlist';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Terms from './pages/Terms';
import CookiePolicy from './pages/CookiePolicy';
import OrderDetails from './pages/OrderDetails';
import OrderConfirmed from './pages/OrderConfirmed';
import OrderFailed from './pages/OrderFailed';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';
import ErrorBoundary from './components/ErrorBoundary';
import { useCustomer } from './hooks/useCustomer';
import { useCart } from './hooks/useCart';

// Per-route document titles — ProductDetail overrides with the product name once loaded
const ROUTE_TITLES = [
  [/^\/$/, 'MORBEI | Minimalist Fashion'],
  [/^\/shop\/?([a-z-]*)/, (m) => m[1] && m[1] !== 'all' ? `${m[1].replace(/-/g, ' ').toUpperCase()} | MORBEI` : 'SHOP | MORBEI'],
  [/^\/product\//, 'MORBEI'],
  [/^\/editorials/, 'EDITORIALS | MORBEI'],
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
  [/^\/returns/, 'RETURNS | MORBEI'],
  [/^\/privacy/, 'PRIVACY POLICY | MORBEI'],
  [/^\/terms/, 'TERMS | MORBEI'],
  [/^\/cookies/, 'COOKIE POLICY | MORBEI'],
];

function titleForPath(pathname) {
  for (const [pattern, title] of ROUTE_TITLES) {
    const match = pathname.match(pattern);
    if (match) return typeof title === 'function' ? title(match) : title;
  }
  return 'MORBEI | Minimalist Fashion';
}

const ShopWrapper = () => {
  const { category } = useParams();
  return <Shop category={category?.toUpperCase()} />;
};

const RequireAuth = ({ children }) => {
  const { customer, loading } = useCustomer();
  if (loading) return null;
  if (!customer) return <Navigate to="/profile" replace />;
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

  useEffect(() => {
    document.title = titleForPath(location.pathname);
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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/shop/:category" element={<ShopWrapper />} />
          <Route path="/shop" element={<ShopWrapper />} />
          <Route path="/editorials" element={<Editorials />} />
          <Route path="/about" element={<About />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<RequireCart><Checkout /></RequireCart>} />
          <Route path="/checkout/:step" element={<RequireCart><Checkout /></RequireCart>} />
          <Route path="/product/:id" element={<ProductDetail />} />
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
          <Route path="/cookies" element={<CookiePolicy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {location.pathname !== '/profile' && location.pathname !== '/' && location.pathname !== '/about' && location.pathname !== '/checkout' && location.pathname !== '/cart' && location.pathname !== '/wishlist' && <Footer />}
      </div>
    </>
  );
};

function App() {
  return (
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
  );
}

export default App;
