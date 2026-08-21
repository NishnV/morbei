import React, { useRef, useEffect, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useShop } from '../context/ShopContext';
import { useCart } from '../hooks/useCart';
import { useCustomer } from '../hooks/useCustomer';
import { contactAPI } from '../lib/api';
import { useCollection } from '../hooks/useCollection';
import { useSearch } from '../hooks/useSearch';
import { useProducts } from '../hooks/useProducts';
import { useGlobalLoading } from '../context/LoadingContext';
import Seo, { breadcrumbJsonLd } from '../components/Seo';
import { shopifyImage, shopifySrcSet } from '../utils/shopifyImage';
import ErrorBoundary from '../components/ErrorBoundary';
import Modal from '../components/ui/Modal';
import './Shop.css';

/** Map frontend sort keys to Shopify-compatible sort keys */
const SORT_KEY_MAP = {
    'price-low': 'price-low',
    'price-high': 'price-high',
    'name-asc': 'name-asc',
    'name-desc': 'name-desc',
    '': 'featured',
};

const Shop = ({ category = "ALL" }) => {
    const navigate = useNavigate();
    const { toggleWishlist, isInWishlist, setIsCartOpen } = useShop();
    const { addToCart } = useCart();
    const { customer } = useCustomer();
    // Product ids whose restock request was sent this session
    const [notifiedIds, setNotifiedIds] = React.useState([]);
    // Product awaiting an email in the notify modal (guests only)
    const [notifyModalProduct, setNotifyModalProduct] = React.useState(null);

    const submitNotify = async (product, email) => {
        try {
            await contactAPI.notifyStock(email.trim(), product.name);
            setNotifiedIds(prev => [...prev, product.id]);
        } catch (err) {
            console.error('Notify request failed:', err);
        }
    };

    const handleNotifyMe = (e, product) => {
        e.preventDefault();
        e.stopPropagation();
        if (notifiedIds.includes(product.id)) return;
        if (customer?.email) {
            submitNotify(product, customer.email);
        } else {
            setNotifyModalProduct(product);
        }
    };
    const [viewMode, setViewMode] = React.useState(() => {
        const saved = localStorage.getItem('shop-view-mode');
        return saved ? parseInt(saved, 10) : 2;
    });

    const handleSetViewMode = (mode) => {
        setViewMode(mode);
        localStorage.setItem('shop-view-mode', mode);
    };
    const [searchParams] = useSearchParams();
    const searchQuery = searchParams.get('search');
    const [showScrollTop, setShowScrollTop] = React.useState(false);
    const lastScrollY = React.useRef(0);
    const shopRef = React.useRef(null);

    // Filter and Sort states
    const [isFilterOpen, setIsFilterOpen] = React.useState(false);
    const [isSortOpen, setIsSortOpen] = React.useState(false);
    const [selectedSizes, setSelectedSizes] = React.useState([]);
    const [selectedColors, setSelectedColors] = React.useState([]);
    const [priceRange, setPriceRange] = React.useState({ min: 0, max: 15000 });
    const [sortBy, setSortBy] = React.useState('');

    const filterRef = useRef(null);
    const sortRef = useRef(null);

    // Mobile swipe-to-change-image + long-press to preview alternate image
    const [swipeIndices, setSwipeIndices] = React.useState({});
    const [heldProductKey, setHeldProductKey] = React.useState(null);
    const touchStartX = useRef(null);
    const longPressTimer = useRef(null);
    const touchHasMoved = useRef(false);

    const handleTouchStart = (e, product, idx) => {
        touchStartX.current = e.touches[0].clientX;
        touchHasMoved.current = false;
        if (product.images?.length > 1) {
            const key = product.id || idx;
            // Kick off a prefetch so the alternate image is in cache when the hold fires
            const altSrc = shopifyImage(product.images[product.images.length - 1], 800);
            const preload = new window.Image();
            preload.src = altSrc;
            longPressTimer.current = setTimeout(() => {
                if (!touchHasMoved.current) setHeldProductKey(key);
            }, 350);
        }
    };

    const handleTouchMove = (e) => {
        if (touchStartX.current === null) return;
        if (Math.abs(e.touches[0].clientX - touchStartX.current) > 8) {
            touchHasMoved.current = true;
            clearTimeout(longPressTimer.current);
        }
    };

    const handleTouchEnd = (e, product, idx) => {
        clearTimeout(longPressTimer.current);
        setHeldProductKey(null);
        if (touchStartX.current === null) return;
        const delta = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        const images = product.images && product.images.length > 1 ? product.images : null;
        if (!images || Math.abs(delta) < 40) return;
        e.preventDefault();
        const key = product.id || idx;
        const current = swipeIndices[key] || 0;
        const next = delta < 0
            ? (current + 1) % images.length
            : (current - 1 + images.length) % images.length;
        setSwipeIndices(prev => ({ ...prev, [key]: next }));
    };

    // Handle special category cases
    let fetchCategory = category?.toUpperCase().replace("-", " ") || "ALL";
    if (fetchCategory === "NEW IN 1") fetchCategory = "NEW IN";

    let currentCategory = fetchCategory;
    if (currentCategory === "ALL") currentCategory = "ALL PRODUCTS";

    // Build Shopify collection handle from category
    const collectionHandle = useMemo(() => {
        if (!fetchCategory || fetchCategory === 'ALL') return null;
        return fetchCategory.toLowerCase().replace(/\s+/g, '-');
    }, [fetchCategory]);

    // Build Shopify filters from selected UI filters
    const shopifyFilters = useMemo(() => {
        const filters = [];
        selectedSizes.forEach(size => {
            filters.push({ variantOption: { name: 'Size', value: size } });
        });
        selectedColors.forEach(color => {
            filters.push({ variantOption: { name: 'Color', value: color } });
        });
        if (priceRange.min > 0 || priceRange.max < 15000) {
            filters.push({ price: { min: Number(priceRange.min), max: Number(priceRange.max) } });
        }
        return filters;
    }, [selectedSizes, selectedColors, priceRange]);

    // Fetch from Shopify — either collection or all products
    const { data: collectionData, loading: collectionLoading, error: collectionError, hasNextPage: collectionHasNext, fetchMore: collectionFetchMore } = useCollection(
        collectionHandle,
        { sortBy: SORT_KEY_MAP[sortBy] || 'featured', filters: shopifyFilters, pageSize: 40 }
    );

    const { data: allProducts, loading: allLoading, error: allError, hasNextPage: allHasNext, fetchMore: allFetchMore } = useProducts(40);

    // Fetch from Shopify search when search query is present
    const { data: searchResults, loading: searchLoading, totalCount: searchTotal } = useSearch(
        searchQuery || '',
        { sortBy: SORT_KEY_MAP[sortBy] || 'relevance', pageSize: 40 }
    );

    // Determine which product list to use
    const { products: shopifyProducts, loading: isLoading, hasNextPage, fetchMore } = useMemo(() => {
        if (searchQuery) {
            return { products: searchResults, loading: searchLoading, hasNextPage: false, fetchMore: () => {} };
        }
        if (collectionHandle) {
            return { products: collectionData.products, loading: collectionLoading, hasNextPage: collectionHasNext, fetchMore: collectionFetchMore };
        }
        return { products: allProducts, loading: allLoading, hasNextPage: allHasNext, fetchMore: allFetchMore };
    }, [searchQuery, searchResults, searchLoading, collectionHandle, collectionData, collectionLoading, collectionHasNext, collectionFetchMore, allProducts, allLoading, allHasNext, allFetchMore]);

    // Override category title for search
    if (searchQuery) {
        currentCategory = `SEARCH RESULTS FOR: ${searchQuery.toUpperCase()}`;
    }

    // Show loading screen only while Shopify data is actually being fetched
    const { startLoading, stopLoading } = useGlobalLoading();
    useEffect(() => {
        if (isLoading) startLoading();
        else stopLoading();
    }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const sortedProducts = useMemo(() => {
        const display = (shopifyProducts || []).map(p => ({
            id: p.id,
            handle: p.handle,
            name: p.name,
            price: p.price,
            priceNum: p.priceNum,
            compareAtPrice: p.compareAtPrice,
            isOnSale: p.isOnSale,
            img: p.img,
            images: p.images,
            sizes: p.sizes || ['S', 'M', 'L'],
            availableForSale: p.availableForSale,
            variants: p.variants,
        }));

        // Client-side sorting fallback (Shopify handles most sorting server-side)
        if (sortBy === 'name-asc') return display.sort((a, b) => a.name.localeCompare(b.name));
        if (sortBy === 'name-desc') return display.sort((a, b) => b.name.localeCompare(a.name));
        return display;
    }, [shopifyProducts, sortBy]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterRef.current && !filterRef.current.contains(event.target)) {
                setIsFilterOpen(false);
            }
            if (sortRef.current && !sortRef.current.contains(event.target)) {
                setIsSortOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const handleScroll = () => {
            const current = window.scrollY;
            if (current > 300 && current < lastScrollY.current) {
                setShowScrollTop(true);
            } else {
                setShowScrollTop(false);
            }
            lastScrollY.current = current;
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const toggleSize = (size) => {
        setSelectedSizes(prev =>
            prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]
        );
    };

    const toggleColor = (color) => {
        setSelectedColors(prev =>
            prev.includes(color) ? prev.filter(c => c !== color) : [...prev, color]
        );
    };

    const clearFilters = () => {
        setSelectedSizes([]);
        setSelectedColors([]);
        setPriceRange({ min: 0, max: 15000 });
    };

    const categoryLabel = (category || 'ALL').replace(/-/g, ' ').toUpperCase();
    const categoryPath = `/shop/${(category || 'all').toLowerCase()}`;

    return (
        <>
            <Seo
                title={categoryLabel === 'ALL' ? 'SHOP | MORBEI' : `${categoryLabel} | MORBEI`}
                description={
                    categoryLabel === 'ALL'
                        ? 'Shop the full MORBEI collection — minimalist dresses, tops and bottoms crafted in India.'
                        : `Shop MORBEI ${categoryLabel.toLowerCase()} — minimalist pieces crafted in India.`
                }
                path={categoryPath}
                jsonLd={breadcrumbJsonLd([
                    { name: 'Home', path: '/' },
                    { name: categoryLabel === 'ALL' ? 'Shop' : categoryLabel, path: categoryPath },
                ])}
            />
            <div className="shop-page-v2">
            <div className="shop-controls-bar">
                <div className="left-controls">
                    <div className="view-options">
                        <button
                            className={`view-btn ${viewMode === 1 ? 'active' : ''}`}
                            onClick={() => handleSetViewMode(1)}
                        >
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor">
                                <rect x="1" y="1" width="16" height="16" strokeWidth="1.2" />
                            </svg>
                        </button>
                        <button
                            className={`view-btn ${viewMode === 2 ? 'active' : ''}`}
                            onClick={() => handleSetViewMode(2)}
                        >
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor">
                                <rect x="1" y="1" width="16" height="16" strokeWidth="1.2" />
                                <line x1="9" y1="1" x2="9" y2="17" strokeWidth="1.2" />
                            </svg>
                        </button>
                        <button
                            className={`view-btn ${viewMode === 4 ? 'active' : ''}`}
                            onClick={() => handleSetViewMode(4)}
                        >
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor">
                                <rect x="1" y="1" width="16" height="16" strokeWidth="1.2" />
                                <line x1="9" y1="1" x2="9" y2="17" strokeWidth="1.2" />
                                <line x1="1" y1="9" x2="17" y2="9" strokeWidth="1.2" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="shop-category-title">{currentCategory}</div>
                <div className="filter-sort-group">
                    <button className="dropdown-trigger filter-btn" onClick={() => setIsFilterOpen(true)}>
                        FILTER
                    </button>
                    <button className="dropdown-trigger sort-trigger sort-btn" onClick={() => setIsSortOpen(true)}>
                        SORT
                    </button>
                </div>
            </div>

            {/* SIDE PANELS BACKDROP */}
            <div
                className={`side-panel-backdrop ${(isFilterOpen || isSortOpen) ? 'visible' : ''}`}
                onClick={() => {
                    setIsFilterOpen(false);
                    setIsSortOpen(false);
                }}
            />

            {/* FILTER SIDE PANEL */}
            <div className={`side-panel filter-panel ${isFilterOpen ? 'open' : ''}`}>
                <div className="filter-panel-header">
                    <button className="side-panel-close" onClick={() => setIsFilterOpen(false)}>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round">
                            <line x1="2" y1="2" x2="18" y2="18" />
                            <line x1="18" y1="2" x2="2" y2="18" />
                        </svg>
                    </button>
                </div>
                <div className="filter-panel-content">
                    {/* COLOUR */}
                    <div className="filter-section">
                        <h4 className="filter-section-title">COLOUR</h4>
                        <div className="filter-list">
                            {['White', 'Beige', 'Black'].map(color => (
                                <label key={color} className="filter-check-row" onClick={() => toggleColor(color)}>
                                    <span className={`filter-sq-check ${selectedColors.includes(color) ? 'checked' : ''}`} />
                                    <span className="filter-check-label">{color.toUpperCase()}</span>
                                    <input type="checkbox" checked={selectedColors.includes(color)} onChange={() => {}} style={{ display: 'none' }} />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* PRICE */}
                    <div className="filter-section">
                        <h4 className="filter-section-title">PRICE</h4>
                        <div className="price-slider-container">
                            <div className="price-slider-track-wrapper">
                                <div className="price-slider-base" />
                                <div
                                    className="price-slider-fill"
                                    style={{
                                        left: `${(priceRange.min / 15000) * 100}%`,
                                        right: `${100 - (priceRange.max / 15000) * 100}%`
                                    }}
                                />
                                <input
                                    type="range"
                                    min="0"
                                    max="15000"
                                    step="100"
                                    value={priceRange.min}
                                    onChange={(e) => {
                                        const val = Math.min(Number(e.target.value), priceRange.max - 500);
                                        setPriceRange(prev => ({ ...prev, min: val }));
                                    }}
                                    className="price-range-input price-range-min"
                                />
                                <input
                                    type="range"
                                    min="0"
                                    max="15000"
                                    step="100"
                                    value={priceRange.max}
                                    onChange={(e) => {
                                        const val = Math.max(Number(e.target.value), priceRange.min + 500);
                                        setPriceRange(prev => ({ ...prev, max: val }));
                                    }}
                                    className="price-range-input price-range-max"
                                />
                            </div>
                            <div className="price-slider-labels">
                                <span>RS. {Number(priceRange.min).toLocaleString('en-IN')}</span>
                                <span>RS. {Number(priceRange.max).toLocaleString('en-IN')}</span>
                            </div>
                        </div>
                    </div>

                    {/* SIZE */}
                    <div className="filter-section">
                        <h4 className="filter-section-title">SIZE</h4>
                        <div className="filter-size-grid">
                            {['XXS', 'XS', 'L', 'S', 'M', 'XL'].map(size => (
                                <label key={size} className="filter-check-row" onClick={() => toggleSize(size)}>
                                    <span className={`filter-sq-check ${selectedSizes.includes(size) ? 'checked' : ''}`} />
                                    <span className="filter-check-label">{size}</span>
                                    <input type="checkbox" checked={selectedSizes.includes(size)} onChange={() => {}} style={{ display: 'none' }} />
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="filter-panel-footer">
                    <button className="show-items-btn" onClick={() => setIsFilterOpen(false)}>
                        SHOW ITEMS
                    </button>
                    <button className="clear-filter-btn" onClick={clearFilters}>
                        CLEAR FILTER
                    </button>
                </div>
            </div>

            {/* SORT SIDE PANEL */}
            <div className={`side-panel sort-panel ${isSortOpen ? 'open' : ''}`}>
                <div className="side-panel-header">
                    <h3>SORT</h3>
                    <button className="side-panel-close" onClick={() => setIsSortOpen(false)}>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round">
                            <line x1="2" y1="2" x2="18" y2="18" />
                            <line x1="18" y1="2" x2="2" y2="18" />
                        </svg>
                    </button>
                </div>
                <div className="side-panel-content">
                    <button
                        className={`sort-option ${sortBy === 'price-low' ? 'active' : ''}`}
                        onClick={() => { setSortBy('price-low'); setIsSortOpen(false); }}
                    >
                        PRICE: LOW TO HIGH
                    </button>
                    <button
                        className={`sort-option ${sortBy === 'price-high' ? 'active' : ''}`}
                        onClick={() => { setSortBy('price-high'); setIsSortOpen(false); }}
                    >
                        PRICE: HIGH TO LOW
                    </button>
                    <button
                        className={`sort-option ${sortBy === 'name-asc' ? 'active' : ''}`}
                        onClick={() => { setSortBy('name-asc'); setIsSortOpen(false); }}
                    >
                        NAME: A-Z
                    </button>
                    <button
                        className={`sort-option ${sortBy === 'name-desc' ? 'active' : ''}`}
                        onClick={() => { setSortBy('name-desc'); setIsSortOpen(false); }}
                    >
                        NAME: Z-A
                    </button>
                    <button
                        className={`sort-option ${sortBy === '' ? 'active' : ''}`}
                        onClick={() => { setSortBy(''); setIsSortOpen(false); }}
                    >
                        DEFAULT
                    </button>
                </div>
            </div>

            <div className="shop-main-content">
                {isLoading ? (
                    <div style={{ minHeight: '80vh', background: '#000' }} />
                ) : sortedProducts.length > 0 ? (
                    <>
                    <div className={`products-grid col-${viewMode}`}>
                        {sortedProducts.map((product, idx) => (
                            <div className={`product-item reveal reveal-up reveal-delay-${(idx % 4) + 1}`} key={product.id || idx}>
                                <Link to={`/product/${product.handle || product.id}`} className="product-link">
                                    <div
                                        className="product-image-container"
                                        onTouchStart={(e) => handleTouchStart(e, product, idx)}
                                        onTouchMove={handleTouchMove}
                                        onTouchEnd={(e) => handleTouchEnd(e, product, idx)}
                                    >
                                        {(() => {
                                            const key = product.id || idx;
                                            const isHeld = heldProductKey === key;
                                            const currentIdx = swipeIndices[key] || 0;
                                            const hover = product.images?.length > 1
                                                ? product.images[product.images.length - 1]
                                                : null;
                                            const primary = product.images?.length > 0
                                                ? product.images[isHeld && hover ? product.images.length - 1 : currentIdx]
                                                : product.img;
                                            const imgSizes = viewMode === 4
                                                ? '(orientation: portrait) and (max-width: 1200px) 34vw, (max-width: 600px) 34vw, 17vw'
                                                : viewMode === 1
                                                    ? '(orientation: portrait) and (max-width: 1200px) 100vw, (max-width: 600px) 100vw, 50vw'
                                                    : '(orientation: portrait) and (max-width: 1200px) 100vw, (max-width: 600px) 100vw, 25vw';
                                            return (
                                                <>
                                                    <img
                                                        loading={idx < 4 ? 'eager' : 'lazy'}
                                                        fetchPriority={idx === 0 ? 'high' : undefined}
                                                        decoding="async"
                                                        width="800"
                                                        height="1200"
                                                        className={`img-primary${hover ? '' : ' img-primary--only'}`}
                                                        src={shopifyImage(primary, 800)}
                                                        srcSet={shopifySrcSet(primary)}
                                                        sizes={imgSizes}
                                                        alt={product.name}
                                                    />
                                                    {hover && (
                                                        <img
                                                            loading={idx < 4 ? 'eager' : 'lazy'}
                                                            decoding="async"
                                                            width="800"
                                                            height="1200"
                                                            className="img-hover"
                                                            src={shopifyImage(hover, 800)}
                                                            srcSet={shopifySrcSet(hover)}
                                                            sizes={imgSizes}
                                                            alt={product.name}
                                                        />
                                                    )}
                                                </>
                                            );
                                        })()}
                                        {product.isOnSale && (
                                            <div className="sale-badge-overlay">SALE</div>
                                        )}
                                        {(product.availableForSale === false ||
                                            (product.variants?.length > 0 && !product.variants.some(v => v.available))) ? (
                                            <div className="product-sizes product-sizes--oos">
                                                <span className="oos-label">OUT OF STOCK</span>
                                                <span
                                                    className="notify-me-link"
                                                    onClick={(e) => handleNotifyMe(e, product)}
                                                >
                                                    {notifiedIds.includes(product.id) ? "WE'LL NOTIFY YOU" : 'NOTIFY ME'}
                                                </span>
                                            </div>
                                        ) : (
                                        <div className="product-sizes">
                                            {[...(product.sizes || ['S', 'M', 'L'])].sort((a, b) => {
                                                const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL'];
                                                return order.indexOf(a) - order.indexOf(b);
                                            }).map(size => {
                                                const sizeVariants = (product.variants || []).filter(v => v.size === size);
                                                const sizeAvailable = sizeVariants.length === 0 || sizeVariants.some(v => v.available);
                                                return (
                                                <span
                                                    key={size}
                                                    className={sizeAvailable ? '' : 'size-unavailable'}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        if (!sizeAvailable) return;
                                                        const variant = product.variants?.find(v => v.size === size && v.available);
                                                        if (variant?.id) {
                                                            addToCart(variant.id, 1);
                                                            setIsCartOpen(true);
                                                        } else {
                                                            navigate(`/product/${product.handle || product.id}?size=${encodeURIComponent(size)}`);
                                                        }
                                                    }}
                                                >{size}</span>
                                                );
                                            })}
                                        </div>
                                        )}
                                    </div>
                                    <div className="product-footer">
                                        <div className="p-detail">
                                            <span className="p-name">{product.name}</span>
                                            <span className="p-price">
                                                {product.isOnSale && (
                                                    <span style={{ textDecoration: 'line-through', opacity: 0.5, marginRight: '0.5rem' }}>{product.compareAtPrice}</span>
                                                )}
                                                {product.price}
                                            </span>
                                        </div>
                                        <button
                                            className={`wishlist-black ${isInWishlist(product.id) ? 'active' : ''}`}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                toggleWishlist(product);
                                            }}
                                        >
                                            <svg
                                                width="24"
                                                height="32"
                                                viewBox="0 0 21 29"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <path
                                                    d="M4 25V4H17V25L10.7097 20.5319L4 25Z"
                                                    stroke="currentColor"
                                                    strokeWidth="0.5"
                                                    fill={isInWishlist(product.id) ? "currentColor" : "none"}
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                </Link>
                            </div>
                        ))}
                    </div>
                    </>
                ) : (
                    <div className="no-products-found">
                        <h2>NO PRODUCTS FOUND</h2>
                        <p>SORRY, WE COULDN'T FIND ANY PRODUCTS MATCHING YOUR SEARCH.</p>
                        <Link to="/shop/all" className="back-to-shop">VIEW ALL PRODUCTS</Link>
                    </div>
                )}

                {hasNextPage && !isLoading && (
                    <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                        <button
                            onClick={() => { if (!isLoading) fetchMore(); }}
                            className="dropdown-trigger"
                            style={{ cursor: 'pointer' }}
                            disabled={isLoading}
                        >
                            LOAD MORE
                        </button>
                    </div>
                )}
            </div>

            {/* Inline back-to-top (mobile, per Figma) */}
            {!isLoading && sortedProducts.length > 0 && (
                <button className="back-to-top-inline" onClick={scrollToTop}>BACK TO TOP</button>
            )}

            {/* Space before footer */}
            <div className="shop-spacer"></div>

            {/* Scroll to Top Arrow */}
            <button
                className={`scroll-top-btn${showScrollTop ? ' scroll-top-btn--visible' : ''}`}
                onClick={scrollToTop}
                aria-label="Back to top"
            >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 12V2M7 2L2 7M7 2L12 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </button>

            {/* Back-in-stock email prompt (guests — logged-in users skip this) */}
            <Modal
                open={!!notifyModalProduct}
                title="NOTIFY ME"
                message={notifyModalProduct ? `WE'LL EMAIL YOU WHEN ${notifyModalProduct.name} IS BACK IN STOCK.` : ''}
                input
                inputType="email"
                inputPlaceholder="YOUR EMAIL"
                validate={(v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'PLEASE ENTER A VALID EMAIL'}
                confirmLabel="NOTIFY ME"
                cancelLabel="CANCEL"
                onConfirm={(email) => {
                    submitNotify(notifyModalProduct, email);
                    setNotifyModalProduct(null);
                }}
                onClose={() => setNotifyModalProduct(null)}
            />
            </div>
        </>
    );
};

const ShopWithBoundary = (props) => (
    <ErrorBoundary>
        <Shop {...props} />
    </ErrorBoundary>
);

export default ShopWithBoundary;
