import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { useShop } from '../context/ShopContext';
import { useProduct } from '../hooks/useProduct';
import { useProductRecommendations } from '../hooks/useProducts';
import { useCart } from '../hooks/useCart';
import { useGlobalLoading } from '../context/LoadingContext';
import { useCustomer } from '../hooks/useCustomer';
import ErrorBoundary from '../components/ErrorBoundary';
import Seo, { SITE_URL, breadcrumbJsonLd } from '../components/Seo';
import { shopifyImage, shopifySrcSet } from '../utils/shopifyImage';
import { isMobileViewport } from '../lib/viewport';
import './ProductDetail.css';

const LB_ZOOMS = [1, 2, 3.5, 5]; // lightbox zoom levels: 0=fit, then 2x/3.5x/5x

// Product descriptions come from Shopify admin, so they're store-operator
// content rather than attacker input — but this renders on a page where the
// customer holds a session token, so a compromised Shopify staff account or a
// third-party app with product write access would otherwise get stored XSS.
// Allow the formatting a description legitimately needs, nothing else.
const DESCRIPTION_HTML = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'h3', 'h4', 'span', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
};

const ProductDetail = () => {
    const { id } = useParams();
    const [searchParams] = useSearchParams();
    const { toggleWishlist, isInWishlist, setIsCartOpen } = useShop();
    const { addToCart: shopifyAddToCart } = useCart();
    const { customer } = useCustomer();

    const { data: product, loading } = useProduct(id);
    // Shopify's own recommendation engine. This used to fetch 40 full products
    // (each with 10 images and 50 variants) and shuffle them with Math.random()
    // to fill four tiles — a large payload on every product view, results that
    // reshuffled on re-render, and an impure call during render.
    const { data: recommendations } = useProductRecommendations(product?.shopifyId);
    const { startLoading, stopLoading } = useGlobalLoading();

    useEffect(() => {
        if (loading) startLoading();
        else stopLoading();
    }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

    // Title/meta are now owned by <Seo> below — one source, and it carries the
    // OG tags and structured data with it.

    const [selectedSize, setSelectedSize] = useState(searchParams.get('size') || '');
    const [sizeError, setSizeError] = useState(false);
    const [hoveredSize, setHoveredSize] = useState(null);
    const [showMobileSizeOverlay, setShowMobileSizeOverlay] = useState(false);
    const [selectedColor, setSelectedColor] = useState('');
    const [isAnimating, setIsAnimating] = useState(false);
    const [activeAccordion, setActiveAccordion] = useState(null);
    const [mainImageIndex, setMainImageIndex] = useState(0);
    const [prevImageIndex, setPrevImageIndex] = useState(null);
    const [mainSlideDir, setMainSlideDir] = useState(null); // null = default crossfade; 1/-1 = wheel-triggered vertical slide direction
    const [bgColor, setBgColor] = useState('#fff');
    const mainImgWheelLock = useRef(false);

    const sampleImageBg = useCallback((img) => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            // Sample top-left corner pixel (product bg color)
            const px = ctx.getImageData(4, 4, 1, 1).data;
            setBgColor(`rgb(${px[0]},${px[1]},${px[2]})`);
        } catch (e) {
            setBgColor('#fff');
        }
    }, []);

    const handleImageSelect = (idx) => {
        if (idx === mainImageIndex) return;
        setMainSlideDir(null); // thumbnail clicks keep the crossfade, not the wheel's vertical slide
        setPrevImageIndex(mainImageIndex);
        setMainImageIndex(idx);
        setTimeout(() => setPrevImageIndex(null), 1350);
    };

    // Desktop: scrolling over the main image slides vertically to the next/previous
    // image, mirroring the mobile touch-swipe slider but wheel-driven. Locked for the
    // animation's duration so one wheel gesture only advances one image at a time.
    const handleMainImageWheel = (e) => {
        if (!product.images || product.images.length <= 1) return;
        if (Math.abs(e.deltaY) < 12) return;
        e.preventDefault();
        if (mainImgWheelLock.current) return;
        const dir = e.deltaY > 0 ? 1 : -1;
        const next = Math.max(0, Math.min(product.images.length - 1, mainImageIndex + dir));
        if (next === mainImageIndex) return;
        mainImgWheelLock.current = true;
        setTimeout(() => { mainImgWheelLock.current = false; }, 650);
        setMainSlideDir(dir);
        setPrevImageIndex(mainImageIndex);
        setMainImageIndex(next);
        setTimeout(() => { setPrevImageIndex(null); setMainSlideDir(null); }, 650);
    };

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [lightboxZoom, setLightboxZoom] = useState(0); // 0=fit, 1/2/3 = zoom levels
    const [lbMouse, setLbMouse] = useState({ visible: false, cx: 0, cy: 0 });
    const [lbOrigin, setLbOrigin] = useState({ x: 50, y: 50 });
    const [col2AtBottom, setCol2AtBottom] = useState(false);
    const lbNatRect = useRef(null);
    const lbMainRef = useRef(null);
    const lbImgRef = useRef(null);
    const col2Ref = useRef(null);
    const mobileTouchStartX = useRef(null);
    const mobileTouchStartY = useRef(null);
    const lbTouchStartX = useRef(null);
    const lbTouchStartY = useRef(null);
    const lbPanOrigin = useRef({ x: 50, y: 50 });
    const lbPinchStartDist = useRef(null);
    const lbPinchStartZoom = useRef(0);

    // Lightbox pinch-to-zoom + pan + horizontal swipe (mobile). Reuses the same
    // lbOrigin/lbNatRect machinery as the desktop hover-zoom above: transform-origin
    // percentages are relative to the image's *unscaled* box, so lbNatRect is only
    // re-measured while zoom is 0 and stays frozen (still valid) while zoomed in.
    const lbTouchMidpointOrigin = (touches, nr) => {
        const midX = (touches[0].clientX + touches[1].clientX) / 2;
        const midY = (touches[0].clientY + touches[1].clientY) / 2;
        return {
            x: Math.max(0, Math.min(100, ((midX - nr.left) / nr.width) * 100)),
            y: Math.max(0, Math.min(100, ((midY - nr.top) / nr.height) * 100)),
        };
    };

    const handleLbTouchStart = useCallback((e) => {
        if (e.touches.length === 2) {
            lbTouchStartX.current = null;
            lbPinchStartDist.current = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            lbPinchStartZoom.current = lightboxZoom;
            if (!lbNatRect.current) lbNatRect.current = lbImgRef.current?.getBoundingClientRect() || null;
            if (lbNatRect.current) setLbOrigin(lbTouchMidpointOrigin(e.touches, lbNatRect.current));
            return;
        }
        if (e.touches.length === 1) {
            lbTouchStartX.current = e.touches[0].clientX;
            lbTouchStartY.current = e.touches[0].clientY;
            lbPanOrigin.current = lbOrigin;
            if (lightboxZoom === 0) lbNatRect.current = lbImgRef.current?.getBoundingClientRect() || null;
        }
    }, [lightboxZoom, lbOrigin]);

    const handleLbTouchMove = useCallback((e) => {
        if (e.touches.length === 2 && lbPinchStartDist.current) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const ratio = dist / lbPinchStartDist.current;
            let targetZoom = lbPinchStartZoom.current;
            if (ratio > 1.15) targetZoom = Math.min(LB_ZOOMS.length - 1, lbPinchStartZoom.current + 1);
            else if (ratio < 0.87) targetZoom = Math.max(0, lbPinchStartZoom.current - 1);
            if (targetZoom !== lightboxZoom) setLightboxZoom(targetZoom);
            return;
        }
        if (e.touches.length === 1 && lbTouchStartX.current !== null && lightboxZoom > 0) {
            const nr = lbNatRect.current;
            if (!nr) return;
            e.preventDefault();
            const dx = e.touches[0].clientX - lbTouchStartX.current;
            const dy = e.touches[0].clientY - lbTouchStartY.current;
            setLbOrigin({
                x: Math.max(0, Math.min(100, lbPanOrigin.current.x - (dx / nr.width) * 100)),
                y: Math.max(0, Math.min(100, lbPanOrigin.current.y - (dy / nr.height) * 100)),
            });
        }
    }, [lightboxZoom]);

    const handleLbTouchEnd = useCallback((e) => {
        if (lbPinchStartDist.current !== null) {
            lbPinchStartDist.current = null;
            if (lightboxZoom === 0) { setLbOrigin({ x: 50, y: 50 }); lbNatRect.current = null; }
            lbTouchStartX.current = null;
            lbTouchStartY.current = null;
            return;
        }
        if (lbTouchStartX.current === null) return;
        const deltaX = e.changedTouches[0].clientX - lbTouchStartX.current;
        const deltaY = e.changedTouches[0].clientY - lbTouchStartY.current;
        lbTouchStartX.current = null;
        lbTouchStartY.current = null;
        if (lightboxZoom > 0) return; // was panning a zoomed image, not swiping
        if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
            setLightboxIndex(prev => deltaX < 0
                ? Math.min(prev + 1, product.images.length - 1)
                : Math.max(prev - 1, 0));
        }
    }, [lightboxZoom, product]);

    const handleLbMouseMove = useCallback((e) => {
        const cRect = lbMainRef.current?.getBoundingClientRect();
        if (!cRect) return;
        const cx = e.clientX - cRect.left;
        const cy = e.clientY - cRect.top;
        if (lbImgRef.current) {
            if (lightboxZoom === 0) lbNatRect.current = lbImgRef.current.getBoundingClientRect();
            const nr = lbNatRect.current;
            if (nr) {
                setLbOrigin({
                    x: Math.max(0, Math.min(100, ((e.clientX - nr.left) / nr.width) * 100)),
                    y: Math.max(0, Math.min(100, ((e.clientY - nr.top) / nr.height) * 100)),
                });
            }
        }
        setLbMouse({ visible: true, cx, cy });
    }, [lightboxZoom]);

    const handleLbMouseLeave = useCallback(() => {
        setLbMouse(m => ({ ...m, visible: false }));
    }, []);

    // Set default color when product loads (size left unselected)
    React.useEffect(() => {
        if (product) {
            if (product.colors?.length > 0 && !selectedColor) setSelectedColor(product.colors[0]);
            const sizeFromUrl = searchParams.get('size');
            if (sizeFromUrl && product.sizes?.includes(sizeFromUrl)) setSelectedSize(sizeFromUrl);
        }
    }, [product]);

    // Shopify already excludes the current product from its recommendations;
    // filter defensively anyway and cap at the four the grid is built for.
    const categoryRecs = useMemo(() => {
        if (!product || !recommendations?.length) return [];
        return recommendations.filter(p => p.id !== product.id).slice(0, 4);
    }, [product, recommendations]);

    if (loading) {
        return <div style={{ minHeight: '100vh', background: '#000' }} />;
    }

    if (!product) {
        return (
            <div style={{ padding: '10rem 2rem', textAlign: 'center' }}>
                <h2 style={{ fontSize: '0.8rem', letterSpacing: '0.2em' }}>PRODUCT NOT FOUND</h2>
                <Link to="/shop/all" style={{ marginTop: '2rem', display: 'inline-block', textDecoration: 'underline', fontSize: '0.75rem', letterSpacing: '0.15em' }}>BACK TO SHOP</Link>
            </div>
        );
    }

    const selectedVariant = product.variants?.find(v =>
        (!selectedSize || v.size === selectedSize) &&
        (!selectedColor || v.color === selectedColor)
    ) || product.variants?.[0];

    const toggleAccordion = (section) => {
        setActiveAccordion(activeAccordion === section ? null : section);
    };

    const handleAddToCart = async (e) => {
        // On the mobile design (portrait phones + iPads), the size overlay lives on the
        // product image — scroll back up to it so it's actually visible, then show it.
        if (isMobileViewport()) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setShowMobileSizeOverlay(true);
            return;
        }

        if (!selectedSize) {
            setSizeError(true);
            return;
        }
        setIsAnimating(true);
        try {
            if (selectedVariant?.id) {
                await shopifyAddToCart(selectedVariant.id, 1);
                setIsCartOpen(true);
            }
        } catch (err) {
            console.error('Failed to add to cart:', err);
        }
        setTimeout(() => setIsAnimating(false), 600);
    };

    const handleAddToCartFromSize = async (size) => {
        const variant = product.variants?.find(v => v.size === size && (!selectedColor || v.color === selectedColor));
        if (!variant?.id || !variant.available) return;
        setIsAnimating(true);
        try {
            await shopifyAddToCart(variant.id, 1);
            setIsCartOpen(true);
        } catch (err) {
            console.error('Failed to add to cart:', err);
        }
        setTimeout(() => setIsAnimating(false), 600);
    };

    const handleToggleWishlist = () => {
        toggleWishlist({
            id: product.id,
            handle: product.handle,
            name: product.name,
            price: product.price,
            img: product.images[0],
            variantId: selectedVariant?.id,
            variants: product.variants   // stored so wishlist size picker works without allProducts lookup
        });
    };

    // Mobile swipe slider
    const handleMobileTouchStart = (e) => {
        mobileTouchStartX.current = e.touches[0].clientX;
        mobileTouchStartY.current = e.touches[0].clientY;
    };
    const handleMobileTouchEnd = (e) => {
        if (mobileTouchStartX.current === null) return;
        const deltaX = e.changedTouches[0].clientX - mobileTouchStartX.current;
        const deltaY = e.changedTouches[0].clientY - mobileTouchStartY.current;
        mobileTouchStartX.current = null;
        mobileTouchStartY.current = null;
        // A mostly-vertical drag is the user scrolling the page, not interacting with
        // the slider — ignore it so it can't be misread as a tap (deltaX ~ 0) and pop
        // the lightbox open, or as a swipe and flip the image.
        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
            return;
        }
        if (Math.abs(deltaX) < 40) {
            // Not a swipe — treat as a tap on the image, same as clicking it on desktop
            setLightboxIndex(mainImageIndex);
            setLightboxZoom(0);
            setLbOrigin({ x: 50, y: 50 });
            lbNatRect.current = null;
            setLightboxOpen(true);
            return;
        }
        e.preventDefault();
        if (deltaX < 0) {
            setMainImageIndex(prev => Math.min(prev + 1, product.images.length - 1));
        } else {
            setMainImageIndex(prev => Math.max(prev - 1, 0));
        }
    };

    const productUrl = `/product/${product.handle || product.id}`;
    const inStock = product.variants?.some(v => v.available) ?? product.availableForSale;

    return (
        <div className="product-detail-page">
            <Seo
                title={product.seo?.title || `${product.name.toUpperCase()} | MORBEI`}
                description={
                    product.seo?.description
                    || (product.description ? product.description.slice(0, 155) : undefined)
                }
                image={product.images?.[0]}
                path={productUrl}
                type="product"
                jsonLd={[
                    {
                        '@context': 'https://schema.org',
                        '@type': 'Product',
                        name: product.name,
                        image: product.images,
                        description: product.description || undefined,
                        sku: String(product.id),
                        brand: { '@type': 'Brand', name: 'MORBEI' },
                        ...(product.productType ? { category: product.productType } : {}),
                        offers: {
                            '@type': 'Offer',
                            url: `${SITE_URL}${productUrl}`,
                            priceCurrency: product.currency,
                            price: product.priceNum,
                            availability: inStock
                                ? 'https://schema.org/InStock'
                                : 'https://schema.org/OutOfStock',
                            seller: { '@type': 'Organization', name: 'MORBEI' },
                        },
                    },
                    breadcrumbJsonLd([
                        { name: 'Home', path: '/' },
                        { name: 'Shop', path: '/shop/all' },
                        { name: product.name, path: productUrl },
                    ]),
                ]}
            />
            <div className="pd-container">
                {/* Column 1 — 50%: Main image — click to open lightbox */}
                <div
                    className="pd-main-image-col"
                    onClick={() => { setLightboxIndex(mainImageIndex); setLightboxZoom(0); setLightboxOpen(true); }}
                    onWheel={handleMainImageWheel}
                    style={{ background: bgColor, cursor: 'pointer' }}
                >
                    {prevImageIndex !== null && (
                        <img
                            src={shopifyImage(product.images[prevImageIndex], 1200)}
                            alt=""
                            decoding="async"
                            className={`pd-main-img pd-main-img-exit${mainSlideDir ? (mainSlideDir > 0 ? ' pd-main-img-slide-out-up' : ' pd-main-img-slide-out-down') : ''}`}
                            style={{ position: 'absolute', inset: 0 }}
                        />
                    )}
                    <img
                        key={mainImageIndex}
                        src={shopifyImage(product.images[mainImageIndex], 1200)}
                        srcSet={shopifySrcSet(product.images[mainImageIndex], [800, 1200, 1600, 2000])}
                        sizes="(max-width: 768px) 100vw, 50vw"
                        alt={product.name}
                        // This is the LCP element on every product page — never
                        // lazy, and tell the browser to prioritise it.
                        fetchPriority="high"
                        decoding="async"
                        className={`pd-main-img${mainSlideDir ? (mainSlideDir > 0 ? ' pd-main-img-slide-in-up' : ' pd-main-img-slide-in-down') : ''}`}
                        crossOrigin="anonymous"
                        onLoad={(e) => sampleImageBg(e.currentTarget)}
                    />
                </div>

                {/* Column 2 — 25%: Scrollable thumbnail strip — all images, active one highlighted */}
                <div className="pd-col2-wrapper">
                    <div className="pd-secondary-images-col" ref={col2Ref} onScroll={() => {
                        const el = col2Ref.current;
                        if (!el) return;
                        setCol2AtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 10);
                    }}>
                        {product.images.map((img, idx) => (
                            <div
                                className={`pd-secondary-img${idx === mainImageIndex ? ' active' : ''}${idx === prevImageIndex ? ' pd-secondary-img-enter' : ''}`}
                                key={idx}
                                style={{ cursor: 'pointer', display: idx === mainImageIndex ? 'none' : 'block', pointerEvents: idx === mainImageIndex ? 'none' : 'auto' }}
                                onClick={() => handleImageSelect(idx)}
                            >
                                <img loading="lazy" decoding="async" src={shopifyImage(img, 300)} alt={`${product.name} view ${idx + 1}`} />
                            </div>
                        ))}
                    </div>
                    {product.images.length > 2 && (
                        <button
                            className="pd-col2-scroll-hint"
                            aria-label={col2AtBottom ? 'Scroll to top' : 'Scroll for more images'}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (col2AtBottom) {
                                    col2Ref.current?.scrollTo({ top: 0, behavior: 'smooth' });
                                } else {
                                    col2Ref.current?.scrollBy({ top: 300, behavior: 'smooth' });
                                }
                            }}
                        >
                            <svg width="20" height="12" viewBox="0 0 20 12" fill="none" style={{ transform: col2AtBottom ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>
                                <polyline points="1,1 10,10 19,1" stroke="#fff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </button>
                    )}
                </div>

                {/* Mobile Image Slider — shown only on mobile, hidden on desktop */}
                <div className="pd-mobile-slider">
                    {/* Image area wrapper — overlay is clipped to this, dots sit outside */}
                    <div className="pd-mobile-image-area">
                        <div
                            className="pd-mobile-slides"
                            style={{ transform: `translateX(-${mainImageIndex * 100}%)` }}
                            onTouchStart={handleMobileTouchStart}
                            onTouchEnd={handleMobileTouchEnd}
                        >
                            {product.images.map((img, idx) => (
                                <div className="pd-mobile-slide" key={idx}>
                                    <img
                                        // First slide is the mobile LCP; the rest can wait.
                                        loading={idx === 0 ? 'eager' : 'lazy'}
                                        fetchPriority={idx === 0 ? 'high' : undefined}
                                        decoding="async"
                                        src={shopifyImage(img, 900)}
                                        srcSet={shopifySrcSet(img, [600, 900, 1200])}
                                        sizes="100vw"
                                        alt={`${product.name} view ${idx + 1}`}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Mobile Size Overlay Backdrop - click to close */}
                        {showMobileSizeOverlay && (
                            <div className="pd-mobile-size-backdrop" onClick={() => setShowMobileSizeOverlay(false)} />
                        )}

                        {/* Mobile Size Overlay - contained within image bounds */}
                        <div className={`pd-mobile-product-sizes${showMobileSizeOverlay ? ' visible' : ''}`}>
                            {[...product.sizes].sort((a, b) => {
                                const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL'];
                                return order.indexOf(a) - order.indexOf(b);
                            }).map(size => {
                                const variant = product.variants?.find(v => v.size === size && (!selectedColor || v.color === selectedColor));
                                const outOfStock = variant && !variant.available;
                                return (
                                    <span
                                        key={size}
                                        className={`pd-size-item ${outOfStock ? 'out-of-stock' : ''}`}
                                        onClick={() => { if (!outOfStock) { handleAddToCartFromSize(size); setShowMobileSizeOverlay(false); } }}
                                        style={{ cursor: outOfStock ? 'not-allowed' : 'pointer' }}
                                    >
                                        {size}
                                    </span>
                                );
                            })}
                        </div>
                    </div>

                    {product.images.length > 1 && (
                        <div className="pd-mobile-dots">
                            {product.images.map((_, idx) => (
                                <button
                                    key={idx}
                                    className={`pd-mobile-dot${idx === mainImageIndex ? ' active' : ''}`}
                                    onClick={() => setMainImageIndex(idx)}
                                    aria-label={`View image ${idx + 1}`}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Column 3 — 25%: Product info */}
                <div className="pd-info-section">
                    <div className="pd-header">
                        <div className="pd-header-with-wishlist">
                            <h1>{product.name}</h1>
                            <button
                                className="pd-mobile-wishlist-icon"
                                onClick={handleToggleWishlist}
                                aria-label={isInWishlist(product.id) ? 'Remove from wishlist' : 'Add to wishlist'}
                            >
                                <svg width="22" height="25" viewBox="0 0 20 37" fill={isInWishlist(product.id) ? "currentColor" : "none"} xmlns="http://www.w3.org/2000/svg">
                                    <path d="M0.25 36.25V0.25H19.25V36.25L10.0565 28.5904L0.25 36.25Z" stroke="currentColor" strokeWidth="0.5" />
                                </svg>
                            </button>
                        </div>
                        <p className="pd-price">
                            {product.isOnSale && (
                                <span className="pd-compare-price">{product.compareAtPrice}</span>
                            )}
                            {selectedVariant ? selectedVariant.price : product.price}
                        </p>
                        <p className="pd-tax-text">MRP INCL. OF ALL TAXES</p>
                    </div>

                    {/* Color */}
                    {product.colors?.length > 0 ? (
                        <div className="pd-color-selector">
                            <div className="pd-color-swatches">
                                {product.colors.map(color => (
                                    <button
                                        key={color}
                                        className={`color-swatch ${selectedColor === color ? 'active' : ''}`}
                                        style={{ background: color.toLowerCase() }}
                                        onClick={() => setSelectedColor(color)}
                                    />
                                ))}
                            </div>
                            <span className="color-label-right" style={{ marginTop: '8px' }}>{selectedColor || product.colors[0]}</span>
                        </div>
                    ) : (
                        <div className="pd-color-selector">
                            <div className="pd-color-swatches">
                                <div className="color-swatch" style={{ background: '#e5ddd3' }}></div>
                            </div>
                            <span className="color-label-right" style={{ marginTop: '8px' }}>Ecru</span>
                        </div>
                    )}

                    {/* Sizes - hidden on mobile, shown on desktop */}
                    <div className="pd-size-selector pd-size-selector-desktop">
                        <div className="pd-sizes-row">
                            {[...product.sizes].sort((a, b) => {
                                const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL'];
                                return order.indexOf(a) - order.indexOf(b);
                            }).map(size => {
                                const variant = product.variants?.find(v => v.size === size && (!selectedColor || v.color === selectedColor));
                                const outOfStock = variant && !variant.available;
                                return (
                                    <button
                                        key={size}
                                        className={`pd-size-text ${selectedSize === size ? 'active' : ''} ${outOfStock ? 'out-of-stock' : ''}`}
                                        onClick={() => { if (!outOfStock) { setSelectedSize(prev => prev === size ? '' : size); setSizeError(false); } }}
                                        disabled={outOfStock}
                                    >
                                        {size}
                                    </button>
                                );
                            })}
                        </div>
                        <button className="pd-guide-link">Size Guide</button>
                    </div>
                    
                    {/* Add to Bag + Wishlist */}
                    <div className="pd-actions">
                        <p className={`pd-size-error${sizeError ? ' visible' : ''}`}>PLEASE SELECT A SIZE</p>
                        <div className="pd-actions-row">
                        <button
                            className="pd-add-bag-btn"
                            onClick={handleAddToCart}
                            disabled={isAnimating || (selectedVariant && !selectedVariant.available && !!selectedSize)}
                        >
                            {isAnimating ? 'ADDING...' : (!selectedVariant?.available && selectedSize ? 'OUT OF STOCK' : 'ADD TO BAG')}
                        </button>
                        <button
                            className="pd-wishlist-icon-btn"
                            onClick={handleToggleWishlist}
                            aria-label={isInWishlist(product.id) ? 'Remove from wishlist' : 'Add to wishlist'}
                        >
                            <svg
                                width="20"
                                height="37"
                                viewBox="0 0 20 37"
                                fill={isInWishlist(product.id) ? "currentColor" : "none"}
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <path d="M0.25 36.25V0.25H19.25V36.25L10.0565 28.5904L0.25 36.25Z" stroke="currentColor" strokeWidth="0.5" />
                            </svg>
                        </button>
                        </div>
                    </div>

                    <div className='pd-description-section'>
                        <h3 className='pd-description-heading'>DESCRIPTION</h3>
                        <div className='pd-description'>
                            {product.descriptionHtml ? (
                                <div dangerouslySetInnerHTML={{
                                    __html: DOMPurify.sanitize(product.descriptionHtml, DESCRIPTION_HTML),
                                }} />
                            ) : (
                                <p>{product.description}</p>
                            )}
                        </div>
                    </div>

                    {/* Model Info */}
                    {product.metafields?.modelInfo && (
                        <p className="pd-model-info">{product.metafields.modelInfo}</p>
                    )}

                    

                    {/* Accordions — directly below add-to-bag */}
                    <div className="pd-accordion">
                        <AccordionItem title="PRODUCT MEASUREMENTS" isOpen={activeAccordion === 'meas'} onClick={() => toggleAccordion('meas')}>
                            {product.metafields?.fitType && <p>Fit: {product.metafields.fitType}</p>}
                            {product.metafields?.measurements ? (
                                <p>{product.metafields.measurements}</p>
                            ) : (
                                <p>Contact us for product measurements.</p>
                            )}
                        </AccordionItem>
                        <AccordionItem title="COMPOSITION AND CARE" isOpen={activeAccordion === 'comp'} onClick={() => toggleAccordion('comp')}>
                            {product.metafields?.material && <p><strong>Material:</strong> {product.metafields.material}</p>}
                            {product.metafields?.careInstructions && <p><strong>Care:</strong> {product.metafields.careInstructions}</p>}
                            {!product.metafields?.material && !product.metafields?.careInstructions && (
                                <p>Contact us for product composition and care details.</p>
                            )}
                        </AccordionItem>
                        <AccordionItem title="SHIPPING" isOpen={activeAccordion === 'ship'} onClick={() => toggleAccordion('ship')}>
                            <p>Free standard shipping on all orders. Returns accepted within 14 days.</p>
                        </AccordionItem>
                    </div>
                </div>
            </div>


            {/* You Might Be Interested In — same product type */}
            {categoryRecs.length > 0 && (
                <div className="pd-recommendations">
                    <h3 className="rec-title">YOU MIGHT BE INTERESTED IN</h3>
                    <div className="rec-grid">
                        {categoryRecs.map((prod, index) => (
                            <div className={`rec-product reveal reveal-up reveal-delay-${index + 1}`} key={prod.id}>
                                <Link to={`/product/${prod.handle || prod.id}`} className="rec-image-wrapper">
                                    <img
                                        loading="lazy"
                                        decoding="async"
                                        src={shopifyImage(prod.images?.[0] || prod.img, 500)}
                                        srcSet={shopifySrcSet(prod.images?.[0] || prod.img, [400, 600, 800])}
                                        sizes="(max-width: 768px) 50vw, 25vw"
                                        alt={prod.name}
                                    />
                                </Link>
                                <div className="rec-details-row">
                                    <Link to={`/product/${prod.handle || prod.id}`} className="rec-info-text">
                                        <span className="rec-name">{prod.name}</span>
                                        <span className="rec-price">{prod.price}</span>
                                    </Link>
                                    <button
                                        type="button"
                                        className="rec-bookmark-btn"
                                        onClick={() => toggleWishlist({ id: prod.id, name: prod.name, price: prod.price, img: prod.images?.[0] || prod.img })}
                                        aria-label={isInWishlist(prod.id) ? 'Remove from wishlist' : 'Add to wishlist'}
                                    >
                                        <svg
                                            width="14"
                                            height="26"
                                            viewBox="0 0 20 37"
                                            fill={isInWishlist(prod.id) ? "currentColor" : "none"}
                                            xmlns="http://www.w3.org/2000/svg"
                                        >
                                            <path d="M0.25 36.25V0.25H19.25V36.25L10.0565 28.5904L0.25 36.25Z" stroke="currentColor" strokeWidth="0.5" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Lightbox Modal */}
            {lightboxOpen && (
                <div className="pd-lightbox-overlay" onClick={() => setLightboxOpen(false)}>
                    <div className="pd-lightbox" onClick={e => e.stopPropagation()}>
                        <button className="pd-lightbox-close" onClick={() => setLightboxOpen(false)}>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                                <line x1="1" y1="1" x2="15" y2="15"/>
                                <line x1="15" y1="1" x2="1" y2="15"/>
                            </svg>
                        </button>
                        <div className="pd-lightbox-thumbs">
                            {product.images.map((img, idx) => (
                                <div
                                    key={idx}
                                    className={`pd-lightbox-thumb${idx === lightboxIndex ? ' active' : ''}`}
                                    onClick={() => { setLightboxIndex(idx); setLightboxZoom(0); setLbOrigin({ x: 50, y: 50 }); lbNatRect.current = null; setLbMouse(m => ({ ...m, visible: false })); }}
                                >
                                    <img loading="lazy" decoding="async" src={shopifyImage(img, 200)} alt={`${product.name} view ${idx + 1}`} />
                                </div>
                            ))}
                        </div>
                        <div
                            className="pd-lightbox-main"
                            ref={lbMainRef}
                            onMouseMove={handleLbMouseMove}
                            onMouseLeave={handleLbMouseLeave}
                            onTouchStart={handleLbTouchStart}
                            onTouchMove={handleLbTouchMove}
                            onTouchEnd={handleLbTouchEnd}
                            onClick={() => {
                                // No zoom-on-tap on phone/iPad — this is a desktop-only interaction
                                if (isMobileViewport()) return;
                                const newZoom = (lightboxZoom + 1) % 4;
                                if (newZoom === 0) { setLbOrigin({ x: 50, y: 50 }); lbNatRect.current = null; }
                                setLightboxZoom(newZoom);
                            }}
                        >
                            <img
                                ref={lbImgRef}
                                // The lightbox exists to inspect fabric detail —
                                // it zooms to 5x, so this is the one place that
                                // genuinely needs a large source.
                                src={shopifyImage(product.images[lightboxIndex], 2048)}
                                decoding="async"
                                alt={product.name}
                                style={{
                                    transform: `scale(${LB_ZOOMS[lightboxZoom]})`,
                                    transformOrigin: `${lbOrigin.x.toFixed(1)}% ${lbOrigin.y.toFixed(1)}%`,
                                }}
                            />
                            {/* Custom cursor */}
                            {lbMouse.visible && (
                                <div className="pd-lb-cursor" style={{ left: lbMouse.cx, top: lbMouse.cy }}>
                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round">
                                        <circle cx="10" cy="10" r="7"/>
                                        <line x1="15.5" y1="15.5" x2="21" y2="21"/>
                                        {lightboxZoom < 3 && <line x1="10" y1="7" x2="10" y2="13"/>}
                                        <line x1="7" y1="10" x2="13" y2="10"/>
                                    </svg>
                                </div>
                            )}
                            {/* Zoom level badge */}
                            {lightboxZoom > 0 && (
                                <div className="pd-lb-zoom-badge">
                                    {lightboxZoom === 1 ? '2×' : lightboxZoom === 2 ? '3.5×' : '5×'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const AccordionItem = ({ title, children, isOpen, onClick }) => (
    <div className="accordion-item">
        <button className="accordion-header" onClick={onClick}>
            {title}
        </button>
        <div className={`accordion-content ${isOpen ? 'open' : ''}`}>
            <div className="accordion-inner">
                {children}
            </div>
        </div>
    </div>
);

const ProductDetailWithBoundary = (props) => (
    <ErrorBoundary>
        <ProductDetail {...props} />
    </ErrorBoundary>
);

export default ProductDetailWithBoundary;
