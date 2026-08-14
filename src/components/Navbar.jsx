import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Loader2 } from 'lucide-react';
import { useShop } from '../context/ShopContext';
import { useCart } from '../hooks/useCart';
import { useCustomer } from '../hooks/useCustomer';
import { usePredictiveSearch } from '../hooks/useSearch';
import { formatPrice } from '../utils/formatPrice';
import { parseShopifyId } from '../utils/parseShopifyId';
import './Navbar.css';
import { shopifyImage } from '../utils/shopifyImage';

const Navbar = () => {
    const [isScrolled, setIsScrolled] = useState(false);
    const [lastScrollY, setLastScrollY] = useState(0);
    const { wishlist, toggleWishlist, isInWishlist, isCartOpen, setIsCartOpen } = useShop();
    const { cart, updateQuantity, removeFromCart, loading: cartLoading, checkoutUrl } = useCart();
    const { isAuthenticated } = useCustomer();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { data: searchData, loading: isSearching } = usePredictiveSearch(searchQuery, 300, 5);
    const navigate = useNavigate();
    const location = useLocation();
    const isHomePage = location.pathname === '/';

    const lines = cart?.lines || [];
    const cartCount = lines.reduce((sum, l) => sum + l.quantity, 0);
    const suggestions = searchData?.products || [];

    const handleSearchInput = (e) => {
        setSearchQuery(e.target.value);
    };

    const handleSearchSubmit = (e) => {
        if (e.key === 'Enter' && searchQuery.trim()) {
            setIsSearchOpen(false);
            setSearchQuery('');
            navigate(`/shop/all?search=${encodeURIComponent(searchQuery.trim())}`);
        }
    };

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            setIsScrolled(currentScrollY > 50);
            setLastScrollY(currentScrollY);
        };

        window.addEventListener('scroll', handleScroll);
        handleScroll();
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const hideNavLeft = isHomePage && !isScrolled;

    return (
        <>
        <nav className={`navbar ${isScrolled ? 'scrolled' : ''} ${!isHomePage ? 'solid-bg' : ''}`}>
            <div className="nav-container">
                <div className="nav-left">
                    <button
                        className={`mobile-menu-btn ${isMenuOpen ? 'active' : ''}`}
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        type="button"
                        aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
                        aria-expanded={isMenuOpen}
                    >
                        <div className="hamburger-icon" aria-hidden="true">
                            <span></span>
                            <span></span>
                        </div>
                    </button>
                    <Link to="/" className="mobile-navbar-logo" aria-label="MORBEI home">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 871.75 250.29" fill="white" aria-label="MORBEI" className="centered-logo">
                            <path d="M0,196.75h3.56c10.74,0,14.72-3.92,14.72-14.5v-117.88c0-7.75-1.05-10.83-11.63-10.83H0v-1.84h32.76c22.47,39.02,44.95,78.04,67.42,117.06,2.31,4.01,3.56,7.56,3.56,8.78h1.19c0-1.22,1.6-5.75,3.32-8.78,22.08-39.02,44.16-78.04,66.24-117.06h35.37v1.84h-7.12c-12.37,0-13.06,4.6-13.06,14.51v114.2c0,10.59,4.1,14.5,15.19,14.5h5.22v1.84h-61.96v-1.84h8.55c10.57,0,14.48-3.36,14.48-12.46v-106.64c0-3.27,0-6.74.24-8.99h-1.66c-.24.61-1.9,4.09-4.04,8.38-22.87,40.79-45.74,81.58-68.61,122.37-.29.57-.43.86-.71,1.43h-.47c-.29-.57-.43-.86-.71-1.43-22.95-40.04-45.9-80.08-68.85-120.12-2.14-4.09-3.09-7.97-3.09-8.58h-.95c.24,1.84.24,3.32.24,6.95v106.64c0,9.1,3.97,12.46,14.72,12.46h8.55v1.84H0v-1.84Z"/>
                            <path d="M215.8,125.04c.07-45.91,46.11-74.93,88.08-74.97,44.69-.04,87.68,26.31,87.61,74.97-.07,45.82-45.56,75.14-87.61,75.18-44.82.04-88.16-26.29-88.08-75.18ZM370.83,128.92c-.06-37.63-28.1-75.1-67.9-75.18-38.81-.07-66.53,29.17-66.47,67.62.06,37.74,28.29,75.1,68.14,75.18,38.79.07,66.3-29.29,66.24-67.62Z"/>
                            <path d="M399.55,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h61.96c26.56.22,63.73,12.88,63.15,45.35-.47,26.25-26.65,41.84-50.33,44.13-1.9.08-2.85.12-4.75.2v1.23c9.33.55,20.83,6.4,26.35,14.1,4.75,6.46,7.12,9.68,11.87,16.14,5.68,8.02,13.7,20.09,23.24,21.01,1.98.19,4.47-.73,6.79-2.44,2.09-1.55,3.13-2.33,5.22-3.88.52.58.78.87,1.3,1.46-2.09,1.55-3.13,2.33-5.22,3.88-7.57,5.61-14.11,7.97-19.6,7.86-12.32-.25-21.23-11.06-27.88-20.53-6.65-8.83-9.97-13.24-16.62-22.06-5.51-8.09-12.91-16.03-23.5-15.73h-2.85v-3.47h10.92c23.12,0,44.4-18.07,44.4-41.88,0-23.78-21.36-41.68-44.4-41.68h-24.69v.2c2.85,2.45,4.04,5.92,4.04,10.62v119.71c0,9.81,1.42,10.83,12.82,10.83h13.77v1.84h-66v-1.84Z"/>
                            <path d="M542.23,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h57.93c19.68.08,56.31,5.77,56.27,30.85-.03,15.93-19.36,27.51-34.19,28.6v.82c23.55,1.39,52.37,18.25,52.23,44.13-.17,31.53-39.57,42.25-65.52,42.49h-66.71v-1.84ZM604.67,194.91c23.69-.16,48.47-12.56,49.14-38.82.69-26.97-26.76-41.87-50.57-42.08h-12.58v-3.47h9.5c16.21.68,36.03-9.27,36.09-27.58.06-20.29-22.77-27.76-39.41-27.58h-19.23v.2c2.85,2.45,4.04,5.92,4.04,10.62v117.88c0,4.7-1.19,7.97-4.04,10.42v.41h27.07Z"/>
                            <path d="M682.54,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h94.73c3.8,0,7.12.41,8.78,1.84h.24c-.28-3.79-.42-5.69-.71-9.48.85-.05,1.28-.07,2.13-.12,1.42,18.45,2.85,36.91,4.27,55.36h-4.27c-.38-5.72-.57-8.58-.95-14.3-.77-21.48-16.8-30.04-36.56-29.62h-33.47v.2c2.85,2.45,5.22,6.13,5.22,10.62v53.52h9.5c14.05.21,26.52-5.13,25.64-21.66v-7.15h2.14v65.58h-2.14v-11.24c.86-16.49-11.54-22.05-25.64-21.86h-9.5v60.67c0,4.49-2.37,8.17-5.22,10.62v.2h47.24c18.59.4,34.2-7.38,35.37-27.58.57-6.54.85-9.81,1.42-16.34h3.8c-1.34,18.45-2.69,36.91-4.04,55.36-.85-.05-1.28-.07-2.13-.11.28-3.8.42-5.69.71-9.49h-.24c-1.66,1.43-4.99,1.84-8.78,1.84h-107.55v-1.84Z"/>
                            <path d="M811.21,196.75h8.31c11.4,0,12.58-.82,12.58-10.62v-121.96c0-9.81-1.19-10.62-12.58-10.62h-8.31v-1.84h60.54v2.25h-8.31c-11.4,0-12.82.82-12.82,10.62v121.55c0,9.81,1.42,10.62,12.82,10.62h8.31v1.84h-60.54v-1.84Z"/>
                        </svg>
                    </Link>
                </div>

                <div className="nav-center">
                    <Link to="/" className="logo">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 871.75 250.29" fill="white" aria-label="MORBEI" className="centered-logo">
                            <path d="M0,196.75h3.56c10.74,0,14.72-3.92,14.72-14.5v-117.88c0-7.75-1.05-10.83-11.63-10.83H0v-1.84h32.76c22.47,39.02,44.95,78.04,67.42,117.06,2.31,4.01,3.56,7.56,3.56,8.78h1.19c0-1.22,1.6-5.75,3.32-8.78,22.08-39.02,44.16-78.04,66.24-117.06h35.37v1.84h-7.12c-12.37,0-13.06,4.6-13.06,14.51v114.2c0,10.59,4.1,14.5,15.19,14.5h5.22v1.84h-61.96v-1.84h8.55c10.57,0,14.48-3.36,14.48-12.46v-106.64c0-3.27,0-6.74.24-8.99h-1.66c-.24.61-1.9,4.09-4.04,8.38-22.87,40.79-45.74,81.58-68.61,122.37-.29.57-.43.86-.71,1.43h-.47c-.29-.57-.43-.86-.71-1.43-22.95-40.04-45.9-80.08-68.85-120.12-2.14-4.09-3.09-7.97-3.09-8.58h-.95c.24,1.84.24,3.32.24,6.95v106.64c0,9.1,3.97,12.46,14.72,12.46h8.55v1.84H0v-1.84Z"/>
                            <path d="M215.8,125.04c.07-45.91,46.11-74.93,88.08-74.97,44.69-.04,87.68,26.31,87.61,74.97-.07,45.82-45.56,75.14-87.61,75.18-44.82.04-88.16-26.29-88.08-75.18ZM370.83,128.92c-.06-37.63-28.1-75.1-67.9-75.18-38.81-.07-66.53,29.17-66.47,67.62.06,37.74,28.29,75.1,68.14,75.18,38.79.07,66.3-29.29,66.24-67.62Z"/>
                            <path d="M399.55,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h61.96c26.56.22,63.73,12.88,63.15,45.35-.47,26.25-26.65,41.84-50.33,44.13-1.9.08-2.85.12-4.75.2v1.23c9.33.55,20.83,6.4,26.35,14.1,4.75,6.46,7.12,9.68,11.87,16.14,5.68,8.02,13.7,20.09,23.24,21.01,1.98.19,4.47-.73,6.79-2.44,2.09-1.55,3.13-2.33,5.22-3.88.52.58.78.87,1.3,1.46-2.09,1.55-3.13,2.33-5.22,3.88-7.57,5.61-14.11,7.97-19.6,7.86-12.32-.25-21.23-11.06-27.88-20.53-6.65-8.83-9.97-13.24-16.62-22.06-5.51-8.09-12.91-16.03-23.5-15.73h-2.85v-3.47h10.92c23.12,0,44.4-18.07,44.4-41.88,0-23.78-21.36-41.68-44.4-41.68h-24.69v.2c2.85,2.45,4.04,5.92,4.04,10.62v119.71c0,9.81,1.42,10.83,12.82,10.83h13.77v1.84h-66v-1.84Z"/>
                            <path d="M542.23,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h57.93c19.68.08,56.31,5.77,56.27,30.85-.03,15.93-19.36,27.51-34.19,28.6v.82c23.55,1.39,52.37,18.25,52.23,44.13-.17,31.53-39.57,42.25-65.52,42.49h-66.71v-1.84ZM604.67,194.91c23.69-.16,48.47-12.56,49.14-38.82.69-26.97-26.76-41.87-50.57-42.08h-12.58v-3.47h9.5c16.21.68,36.03-9.27,36.09-27.58.06-20.29-22.77-27.76-39.41-27.58h-19.23v.2c2.85,2.45,4.04,5.92,4.04,10.62v117.88c0,4.7-1.19,7.97-4.04,10.42v.41h27.07Z"/>
                            <path d="M682.54,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h94.73c3.8,0,7.12.41,8.78,1.84h.24c-.28-3.79-.42-5.69-.71-9.48.85-.05,1.28-.07,2.13-.12,1.42,18.45,2.85,36.91,4.27,55.36h-4.27c-.38-5.72-.57-8.58-.95-14.3-.77-21.48-16.8-30.04-36.56-29.62h-33.47v.2c2.85,2.45,5.22,6.13,5.22,10.62v53.52h9.5c14.05.21,26.52-5.13,25.64-21.66v-7.15h2.14v65.58h-2.14v-11.24c.86-16.49-11.54-22.05-25.64-21.86h-9.5v60.67c0,4.49-2.37,8.17-5.22,10.62v.2h47.24c18.59.4,34.2-7.38,35.37-27.58.57-6.54.85-9.81,1.42-16.34h3.8c-1.34,18.45-2.69,36.91-4.04,55.36-.85-.05-1.28-.07-2.13-.11.28-3.8.42-5.69.71-9.49h-.24c-1.66,1.43-4.99,1.84-8.78,1.84h-107.55v-1.84Z"/>
                            <path d="M811.21,196.75h8.31c11.4,0,12.58-.82,12.58-10.62v-121.96c0-9.81-1.19-10.62-12.58-10.62h-8.31v-1.84h60.54v2.25h-8.31c-11.4,0-12.82.82-12.82,10.62v121.55c0,9.81,1.42,10.62,12.82,10.62h8.31v1.84h-60.54v-1.84Z"/>
                        </svg>
                    </Link>
                </div>

                <div className="nav-right">
                    <div className={`nav-search-container ${isSearchOpen ? 'active' : ''}`}>
                        <button className="nav-icon-btn" onClick={() => setIsSearchOpen(true)} aria-label="Search">
                            <svg width="15" height="15" viewBox="0 0 15 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="6" cy="6" r="5.6" stroke="white" strokeWidth="0.8"/>
                                <line x1="9.28284" y1="10.7172" x2="14.2828" y2="15.7172" stroke="white" strokeWidth="0.8"/>
                            </svg>
                        </button>
                        <div className="nav-search-bar">
                            <input
                                type="text"
                                placeholder="search for products"
                                className="nav-search-input"
                                value={searchQuery}
                                onChange={handleSearchInput}
                                onKeyDown={handleSearchSubmit}
                                autoFocus={isSearchOpen}
                            />
                            {isSearching && <Loader2 size={16} className="search-loader animate-spin" />}
                            <button className="search-close-inline" onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}>
                                <X size={18} />
                            </button>
                        </div>
                        {suggestions.length > 0 && (
                            <div className="search-suggestions">
                                {suggestions.map(p => (
                                    <Link key={p.id} to={`/product/${p.handle || p.id}`} className="suggestion-item" onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}>
                                        <div className="suggestion-img">
                                            <img src={shopifyImage(p.featuredImage?.url || p.images?.[0] || p.img, 200)} loading="lazy" decoding="async" alt={p.title || p.name} />
                                        </div>
                                        <div className="suggestion-info">
                                            <span className="suggestion-name">{p.title || p.name}</span>
                                            <span className="suggestion-price">{p.priceRange ? formatPrice(p.priceRange.minVariantPrice) : p.price}</span>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>

                    <Link to="/profile" className="nav-icon-btn" aria-label="Profile">
                        <svg width="16" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="8.3999" cy="5" r="4.6" stroke="white" strokeWidth="0.8"/>
                            <path d="M6.3999 9C1.3999 10.5 0.399902 15.5 0.399902 16" stroke="white" strokeWidth="0.8"/>
                            <path d="M10.3999 9C15.3999 10.5 16.3999 15.5 16.3999 16" stroke="white" strokeWidth="0.8"/>
                        </svg>
                    </Link>

                        <Link to="/wishlist" className="nav-icon-btn" style={{position:'relative', top:'-0.25px'}} aria-label="Wishlist">
                            <svg width="12" height="15.5" viewBox="0 0 12 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 1H11V15L6 11.5L1 15V1Z" stroke="white" strokeWidth="0.8" fill={wishlist.length > 0 ? 'white' : 'none'} strokeLinejoin="round"/>
                            </svg>
                            {wishlist.length > 0 && <sup className="icon-superscript icon-superscript--wishlist">{wishlist.length}</sup>}
                        </Link>
                        <button onClick={() => setIsCartOpen(true)} className="nav-icon-btn" style={{position:'relative', top:'-0.5px'}} aria-label="Shopping Bag">
                            <svg width="12.5" height="15.89" viewBox="0 0 14 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12.9355 15.8926H0.435547L1.39009 4.67503H11.9355L12.9355 15.8926Z" stroke="white" strokeWidth="0.8"/>
                                <path d="M3.93555 6.81172C3.93555 6.81172 3.93555 4.67505 3.93555 2.53837C3.93555 0.401703 6.43555 0.401703 6.43555 0.401703" stroke="white" strokeWidth="0.8"/>
                                <path d="M9.43555 6.81172C9.43555 6.81172 9.43555 4.67505 9.43555 2.53837C9.43555 0.401703 6.93555 0.401703 6.93555 0.401703" stroke="white" strokeWidth="0.8"/>
                                <path d="M6.60449 0V0.800781" stroke="white" strokeWidth="0.8"/>
                            </svg>
                            {cartCount > 0 && <sup className="icon-superscript">{cartCount}</sup>}
                        </button>
                </div>
            </div>
        </nav>

            {/* Menu Overlay Backdrop */}
            <div
                className={`menu-overlay-backdrop ${isMenuOpen ? 'visible' : ''}`}
                onClick={() => setIsMenuOpen(false)}
                role="button"
                tabIndex={0}
                aria-label="Close menu"
            />

            {/* Menu Overlay */}
            <div className={`menu-overlay ${isMenuOpen ? 'open' : ''}`}>
                <div className="menu-container">
                    <ul className="menu-links">
                        <li><Link to="/shop/all" onClick={() => setIsMenuOpen(false)}>ALL PRODUCTS</Link></li>
                        <li><Link to="/shop/new-in" onClick={() => setIsMenuOpen(false)}>NEW IN</Link></li>
                        <li><Link to="/shop/tops" onClick={() => setIsMenuOpen(false)}>TOPS</Link></li>
                        <li><Link to="/shop/dresses" onClick={() => setIsMenuOpen(false)}>DRESSES</Link></li>
                        <li><Link to="/shop/bottoms" onClick={() => setIsMenuOpen(false)}>BOTTOMS</Link></li>
                        <li><Link to="/editorials" onClick={() => setIsMenuOpen(false)}>EDITORIALS</Link></li>
                    </ul>
                </div>
            </div>

            {/* Cart Panel Backdrop & Panel */}
            <div
                className={`cart-panel-backdrop ${isCartOpen ? 'visible' : ''}`}
                onClick={() => setIsCartOpen(false)}
                role="button"
                tabIndex={0}
                aria-label="Close cart"
            />
            <div className={`cart-panel ${isCartOpen ? 'open' : ''}`}>
                <div className="cart-panel-header">
                    <div></div>
                    <button type="button" className="close-btn" onClick={() => setIsCartOpen(false)} aria-label="Close">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round">
                            <line x1="2" y1="2" x2="18" y2="18" />
                            <line x1="18" y1="2" x2="2" y2="18" />
                        </svg>
                    </button>
                </div>
                <div className="cart-panel-content">
                    {lines.length === 0 ? (
                        <p className="empty-cart-msg">YOUR BAG IS EMPTY</p>
                    ) : (
                        <div className="cart-items-list">
                            {lines.map(line => {
                                const merch = line.merchandise;
                                const productHandle = merch.product?.handle;
                                const title = merch.product?.title || merch.title;
                                const imgUrl = merch.image?.url;
                                const selectedOptions = merch.selectedOptions || [];
                                const color = selectedOptions.find(o => o.name === 'Color')?.value || '';
                                const size = selectedOptions.find(o => o.name === 'Size')?.value || '';
                                const linePrice = formatPrice(line.cost?.totalAmount);
                                // Use the same parsed numeric id as every other page (Shop/ProductDetail/Cart) —
                                // using the raw GID here caused isInWishlist() mismatches and duplicate entries.
                                const productId = parseShopifyId(merch.product?.id);

                                return (
                                    <div key={line.id} className="cart-item">
                                        <div className="cart-item-details">
                                            <span className="cart-item-name">{title}</span>
                                            <div className="cart-item-meta-price">
                                                <span className="cart-item-meta">{color}{color && size ? ' | ' : ''}{size}</span>
                                                <span className="cart-item-price">{linePrice}</span>
                                            </div>
                                            <div className="cart-controls-row">
                                                <div className="quantity-controls">
                                                    <button onClick={() => updateQuantity(line.id, line.quantity - 1)} disabled={cartLoading}>-</button>
                                                    <span>{line.quantity}</span>
                                                    <button onClick={() => updateQuantity(line.id, line.quantity + 1)} disabled={cartLoading}>+</button>
                                                </div>
                                                <button
                                                    className={`add-to-wishlist-btn ${isInWishlist(productId) ? 'active' : ''}`}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        toggleWishlist({ id: productId, handle: productHandle, name: title, price: linePrice, img: imgUrl, variantId: merch.id });
                                                    }}
                                                    aria-label={isInWishlist(productId) ? 'Remove from wishlist' : 'Add to wishlist'}
                                                >
                                                    {isInWishlist(productId) ? 'In wishlist' : 'Add to wishlist'}
                                                </button>
                                            </div>
                                        </div>
                                        <Link
                                            to={`/product/${productHandle}`}
                                            className="cart-item-img-wrap"
                                            onClick={() => setIsCartOpen(false)}
                                        >
                                            <img src={shopifyImage(imgUrl || '/placeholder.png', 200)} loading="lazy" decoding="async" alt={title} />
                                        </Link>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                {lines.length > 0 && (
                    <div className="cart-panel-footer">
                        <Link to="/cart" className="go-to-bag-btn" onClick={() => setIsCartOpen(false)}>GO TO BAG</Link>
                    </div>
                )}
            </div>
        </>
    );
};

export default Navbar;
