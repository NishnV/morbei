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
import SizeGuide from '../components/SizeGuide';
import ProductVideo from '../components/ProductVideo';
import Modal from '../components/ui/Modal';
import { shopifyImage, shopifySrcSet } from '../utils/shopifyImage';
import { sortSizes } from '../utils/sizes';
import { colorToSwatch } from '../utils/colors';
import { contactAPI } from '../lib/api';
import { isMobileViewport } from '../lib/viewport';
import './ProductDetail.css';

// The still that stands in for a media item: the image itself, or a video's
// poster frame. Thumbnails and the crossfade layer are always images, whatever
// the item behind them turns out to be.
const stillOf = (m) => (m?.kind === 'video' ? m.poster : m?.url);

const PLAY_BADGE = (
    <span className="pd-media-badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1" />
            <path d="M9.8 8.3v7.4L16 12z" fill="currentColor" />
        </svg>
    </span>
);

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

// Show remaining stock at or below this. The catalogue runs 1-3 units per size,
// so a higher threshold would put "only N left" on essentially everything and
// the signal would stop meaning anything.
const LOW_STOCK_THRESHOLD = 3;

const ProductDetail = () => {
    const { id } = useParams();
    const [searchParams] = useSearchParams();
    const { toggleWishlist, isInWishlist, setIsCartOpen } = useShop();
    const { addToCart: shopifyAddToCart } = useCart();
    const { customer } = useCustomer();

    const { data: product, loading } = useProduct(id);
    // The gallery runs on `media`, not `images`: media is what carries video,
    // and it preserves the order the merchant set in the admin so a clip placed
    // second stays second. `images` is still the right list for the OG tag, the
    // wishlist thumbnail and structured data, which all want a still.
    const media = useMemo(() => {
        if (product?.media?.length) return product.media;
        return (product?.images || []).map((url) => ({ kind: 'image', url }));
    }, [product]);
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
    const [showSizeGuide, setShowSizeGuide] = useState(false);
    const [notifyOpen, setNotifyOpen] = useState(false);
    // { ok, message } — the title has to follow the outcome; a "THANK YOU"
    // heading over a failure message is exactly the false-reassurance the
    // newsletter form used to give.
    const [notifyResult, setNotifyResult] = useState(null);
    const [hoveredSize, setHoveredSize] = useState(null);
    const [showMobileSizeOverlay, setShowMobileSizeOverlay] = useState(false);
    const [selectedColor, setSelectedColor] = useState('');
    const [isAnimating, setIsAnimating] = useState(false);
    const [activeAccordion, setActiveAccordion] = useState(null);
    const [mainImageIndex, setMainImageIndex] = useState(0);
    const [prevImageIndex, setPrevImageIndex] = useState(null);
    const [bgColor, setBgColor] = useState('#fff');

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
        setPrevImageIndex(mainImageIndex);
        setMainImageIndex(idx);
        setTimeout(() => setPrevImageIndex(null), 1350);
    };

    // Lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [lightboxZoom, setLightboxZoom] = useState(0); // 0=fit, 1/2/3 = zoom levels
    const [lbMouse, setLbMouse] = useState({ visible: false, cx: 0, cy: 0 });
    const [lbOrigin, setLbOrigin] = useState({ x: 50, y: 50 });
    const [col2AtBottom, setCol2AtBottom] = useState(false);
    const [col2Overflows, setCol2Overflows] = useState(false);
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
                ? Math.min(prev + 1, media.length - 1)
                : Math.max(prev - 1, 0));
        }
    }, [lightboxZoom, media]);

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

    // The scroll hint only means something when there is more below the fold.
    // Column two is exactly two thumbnails tall, and a three-item gallery hides
    // the active one from it — leaving two, which fit exactly — so counting
    // media put an arrow there that scrolled nothing, already flipped to its
    // "back to top" state because the column was its own full height.
    // Measure the column instead; the count cannot answer this question.
    useEffect(() => {
        const el = col2Ref.current;
        if (!el) return;
        const measure = () => {
            const overflows = el.scrollHeight - el.clientHeight > 4;
            setCol2Overflows(overflows);
            if (!overflows) setCol2AtBottom(false);
        };
        measure();
        // Thumbnail height is driven by the column's width through aspect-ratio,
        // so a viewport change moves both sides of the comparison at once.
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [media, mainImageIndex]);

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
        // Sold-out sizes are selectable now (that's how the restock alert is
        // reached), so guard the add itself rather than relying on the button
        // being swapped out.
        if (selectedVariant && !selectedVariant.available) {
            setNotifyResult(null);
            setNotifyOpen(true);
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
            setMainImageIndex(prev => Math.min(prev + 1, media.length - 1));
        } else {
            setMainImageIndex(prev => Math.max(prev - 1, 0));
        }
    };

    // Video takes over the lightbox's click and cursor behaviour, so several
    // branches below need to know what is on screen.
    const lbIsVideo = media[lightboxIndex]?.kind === 'video';

    const productUrl = `/product/${product.handle || product.id}`;
    const inStock = product.variants?.some(v => v.available) ?? product.availableForSale;

    // quantityAvailable is null when the store isn't tracking inventory for a
    // variant — that's "unknown", not "none", so show nothing rather than a
    // scarcity claim we can't stand behind.
    const qty = selectedVariant?.quantityAvailable;
    const lowStockCount =
        selectedVariant?.available && typeof qty === 'number' && qty > 0 && qty <= LOW_STOCK_THRESHOLD
            ? qty
            : null;
    const showLowStock = !!selectedSize && lowStockCount != null;

    // A size is picked and that exact variant is sold out — the moment to offer
    // a restock alert rather than a dead disabled button.
    const selectedSoldOut = !!selectedSize && !!selectedVariant && !selectedVariant.available;

    // Shopify's taxonomy colour, shown when the product has no Colour variant
    // option. Prefer the hex the merchant actually set; fall back to matching
    // the label against the palette (covers pattern entries with no hex).
    const taxonomyColor = product.taxonomyColors?.[0] || null;
    const taxonomySwatch = taxonomyColor
        ? (taxonomyColor.hex || colorToSwatch(taxonomyColor.label))
        : null;

    const submitNotify = async (email) => {
        try {
            await contactAPI.notifyStock(
                email,
                `${product.name}${selectedSize ? ` — size ${selectedSize}` : ''}`
            );
            setNotifyOpen(false);
            setNotifyResult({ ok: true, message: "WE'LL EMAIL YOU AS SOON AS IT'S BACK IN STOCK." });
        } catch (err) {
            setNotifyOpen(false);
            setNotifyResult({
                ok: false,
                message: err.status === 429
                    ? 'TOO MANY REQUESTS — PLEASE TRY AGAIN IN A LITTLE WHILE.'
                    : "WE COULDN'T SAVE THAT — PLEASE TRY AGAIN.",
            });
        }
    };

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
            <div className={`pd-container${media.length <= 1 ? ' pd-single-image' : ''}`}>
                {/* Column 1 — 50%: Main image — click to open lightbox */}
                <div
                    className="pd-main-image-col"
                    onClick={() => { setLightboxIndex(mainImageIndex); setLightboxZoom(0); setLightboxOpen(true); }}
                    style={{ background: bgColor, cursor: 'pointer' }}
                >
                    {prevImageIndex !== null && (
                        <img
                            src={shopifyImage(stillOf(media[prevImageIndex]), 1200)}
                            alt=""
                            decoding="async"
                            className="pd-main-img pd-main-img-exit"
                            style={{ position: 'absolute', inset: 0 }}
                        />
                    )}
                    {media[mainImageIndex]?.kind === 'video' ? (
                        // No crossOrigin/onLoad pair here: the backdrop colour is
                        // sampled from an image's pixels through a canvas, and a
                        // video has none to read. The colour left by the last
                        // still carries over, which reads better than a reset.
                        <ProductVideo
                            key={mainImageIndex}
                            item={media[mainImageIndex]}
                            active
                            alt={product.name}
                            className="pd-main-img"
                        />
                    ) : (
                        <img
                            key={mainImageIndex}
                            src={shopifyImage(media[mainImageIndex]?.url, 1200)}
                            srcSet={shopifySrcSet(media[mainImageIndex]?.url, [800, 1200, 1600, 2000])}
                            sizes={media.length <= 1 ? "(max-width: 1024px) 100vw, 75vw" : "(max-width: 1024px) 100vw, 50vw"}
                            alt={product.name}
                            // This is the LCP element on every product page — never
                            // lazy, and tell the browser to prioritise it.
                            fetchPriority="high"
                            decoding="async"
                            className="pd-main-img"
                            crossOrigin="anonymous"
                            onLoad={(e) => sampleImageBg(e.currentTarget)}
                        />
                    )}
                </div>

                {/* Column 2 — 25%: Scrollable thumbnail strip — all images, active one highlighted */}
                <div className={`pd-col2-wrapper${media.length === 2 ? ' pd-two-images' : ''}`}>
                    <div className="pd-secondary-images-col" ref={col2Ref} onScroll={() => {
                        const el = col2Ref.current;
                        if (!el) return;
                        setCol2AtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 10);
                    }}>
                        {media.map((m, idx) => (
                            <div
                                className={`pd-secondary-img${idx === mainImageIndex ? ' active' : ''}${idx === prevImageIndex ? ' pd-secondary-img-enter' : ''}`}
                                key={idx}
                                style={{
                                    cursor: idx === mainImageIndex ? 'default' : 'pointer',
                                    // 2-image products: show all in col2 (col2 is the slider).
                                    // 3+ image products: hide the active image (it's shown large in col1).
                                    display: (media.length <= 2 || idx !== mainImageIndex) ? 'block' : 'none',
                                    pointerEvents: idx === mainImageIndex ? 'none' : 'auto',
                                }}
                                onClick={() => handleImageSelect(idx)}
                            >
                                <img
                                    loading="lazy"
                                    decoding="async"
                                    src={shopifyImage(stillOf(m), 800)}
                                    srcSet={shopifySrcSet(stillOf(m), [400, 600, 800, 1200])}
                                    sizes="25vw"
                                    alt={`${product.name} view ${idx + 1}`}
                                />
                                {m.kind === 'video' && PLAY_BADGE}
                            </div>
                        ))}
                    </div>
                    {col2Overflows && (
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
                            {media.map((m, idx) => (
                                <div className="pd-mobile-slide" key={idx}>
                                    {m.kind === 'video' ? (
                                        // Every slide stays mounted so the strip can
                                        // translate between them — only the one on
                                        // screen is allowed to play.
                                        <ProductVideo
                                            item={m}
                                            active={idx === mainImageIndex}
                                            alt={`${product.name} view ${idx + 1}`}
                                        />
                                    ) : (
                                        <img
                                            // First slide is the mobile LCP; the rest can wait.
                                            loading={idx === 0 ? 'eager' : 'lazy'}
                                            fetchPriority={idx === 0 ? 'high' : undefined}
                                            decoding="async"
                                            src={shopifyImage(m.url, 900)}
                                            srcSet={shopifySrcSet(m.url, [600, 900, 1200, 1600])}
                                            sizes="100vw"
                                            alt={`${product.name} view ${idx + 1}`}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Mobile Size Overlay Backdrop - click to close */}
                        {showMobileSizeOverlay && (
                            <div className="pd-mobile-size-backdrop" onClick={() => setShowMobileSizeOverlay(false)} />
                        )}

                        {/* Mobile Size Overlay - contained within image bounds */}
                        <div className={`pd-mobile-product-sizes${showMobileSizeOverlay ? ' visible' : ''}`}>
                            {sortSizes(product.sizes).map(size => {
                                const variant = product.variants?.find(v => v.size === size && (!selectedColor || v.color === selectedColor));
                                const outOfStock = variant && !variant.available;
                                return (
                                    <span
                                        key={size}
                                        className={`pd-size-item ${outOfStock ? 'out-of-stock' : ''}`}
                                        // In stock: tapping a size adds it straight to the bag.
                                        // Sold out: select it and offer the restock alert instead of
                                        // doing nothing, which is what used to happen.
                                        onClick={() => {
                                            setShowMobileSizeOverlay(false);
                                            if (outOfStock) {
                                                setSelectedSize(size);
                                                setNotifyResult(null);
                                                setNotifyOpen(true);
                                            } else {
                                                handleAddToCartFromSize(size);
                                            }
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {size}
                                    </span>
                                );
                            })}
                        </div>
                    </div>

                    {media.length > 1 && (
                        <div className="pd-mobile-dots">
                            {media.map((_, idx) => (
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

                    {/* Colour.
                        - Products with a Colour variant option get selectable swatches.
                        - Products without one (all of them today — each is a single
                          colourway sized S-XL) show the colour from Shopify's product
                          taxonomy metafield, read-only.
                        - Neither set: render nothing. This used to hard-code an "Ecru"
                          swatch on every product regardless of its actual colour. */}
                    {product.colors?.length > 0 ? (
                        <div className="pd-color-selector">
                            <div className="pd-color-swatches">
                                {product.colors.map(color => {
                                    const swatch = colorToSwatch(color);
                                    return (
                                        <button
                                            key={color}
                                            type="button"
                                            title={color}
                                            aria-label={color}
                                            aria-pressed={selectedColor === color}
                                            className={`color-swatch ${selectedColor === color ? 'active' : ''}${swatch ? '' : ' color-swatch--unknown'}`}
                                            style={swatch ? { background: swatch } : undefined}
                                            onClick={() => setSelectedColor(color)}
                                        />
                                    );
                                })}
                            </div>
                            <span className="color-label-right" style={{ marginTop: '8px' }}>{selectedColor || product.colors[0]}</span>
                        </div>
                    ) : (
                        /* Always rendered, even with no colour to show. ADD TO BAG is
                           positioned to land on the seam between the two side images
                           via a fixed offset, so the stack above it has to be a
                           constant height — otherwise products with a colour push the
                           button 76px below the seam and products without it sit 76px
                           above. CSS hides this when empty but keeps its space. */
                        <div className={`pd-color-selector${taxonomyColor ? ' has-colour' : ''}`} aria-hidden={!taxonomyColor}>
                            <div className="pd-color-swatches">
                                <div
                                    className={`color-swatch${taxonomySwatch ? '' : ' color-swatch--unknown'}`}
                                    style={taxonomySwatch ? { background: taxonomySwatch } : undefined}
                                    title={taxonomyColor?.label}
                                    role="img"
                                    aria-label={taxonomyColor ? `Colour: ${taxonomyColor.label}` : ''}
                                />
                            </div>
                            <span className="color-label-right" style={{ marginTop: '8px' }}>{taxonomyColor?.label || ''}</span>
                        </div>
                    )}

                    {/* Sizes - hidden on mobile, shown on desktop */}
                    <div className="pd-size-selector pd-size-selector-desktop">
                        <div className="pd-sizes-row">
                            {sortSizes(product.sizes).map(size => {
                                const variant = product.variants?.find(v => v.size === size && (!selectedColor || v.color === selectedColor));
                                const outOfStock = variant && !variant.available;
                                return (
                                    <button
                                        key={size}
                                        type="button"
                                        className={`pd-size-text ${selectedSize === size ? 'active' : ''} ${outOfStock ? 'out-of-stock' : ''}`}
                                        // Sold-out sizes stay selectable on purpose: selecting one is
                                        // how you reach the restock alert. Add-to-bag is what gets
                                        // blocked, not the selection. (Marking them `disabled` made
                                        // the notify flow unreachable.)
                                        onClick={() => { setSelectedSize(prev => prev === size ? '' : size); setSizeError(false); }}
                                        aria-pressed={selectedSize === size}
                                        title={outOfStock ? `${size} — out of stock, tap to get notified` : size}
                                    >
                                        {size}
                                    </button>
                                );
                            })}
                        </div>
                        <button type="button" className="pd-guide-link" onClick={() => setShowSizeGuide(true)}>Size Guide</button>
                    </div>

                    {/* Add to Bag + Wishlist */}
                    <div className="pd-actions">
                        {/* One reserved line directly above the button, shared by both
                            notes. They can never appear together — the size prompt only
                            fires when nothing is selected, the stock count only when
                            something is — so giving each its own row just stacked two
                            permanently-reserved gaps above the CTA. Always rendered so
                            the button never shifts as the message changes. */}
                        <p
                            className={
                                sizeError ? 'pd-actions-note pd-size-error visible'
                                    : showLowStock ? 'pd-actions-note pd-low-stock visible'
                                        : 'pd-actions-note'
                            }
                            role="status"
                            aria-hidden={!sizeError && !showLowStock}
                        >
                            {sizeError
                                ? 'PLEASE SELECT A SIZE'
                                : lowStockCount === 1
                                    ? 'LAST ONE LEFT'
                                    : `ONLY ${lowStockCount} LEFT`}
                        </p>
                        <div className="pd-actions-row">
                        {/* When the chosen size is sold out, the primary action
                            becomes the restock alert instead of a dead disabled
                            button. The /contact/notify-stock endpoint already
                            existed and nothing in the UI had ever called it. */}
                        {selectedSoldOut ? (
                            <button
                                type="button"
                                className="pd-add-bag-btn pd-notify-btn"
                                onClick={() => { setNotifyResult(null); setNotifyOpen(true); }}
                            >
                                NOTIFY ME WHEN AVAILABLE
                            </button>
                        ) : (
                            <button
                                className="pd-add-bag-btn"
                                onClick={handleAddToCart}
                                disabled={isAnimating}
                            >
                                {isAnimating ? 'ADDING...' : 'ADD TO BAG'}
                            </button>
                        )}
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
                                        sizes="(max-width: 1024px) 50vw, 25vw"
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

            <SizeGuide
                open={showSizeGuide}
                onClose={() => setShowSizeGuide(false)}
                sizeGuideHtml={product.metafields?.sizeGuide}
                productName={product.name}
            />

            {/* Restock alert. Guests can use this too — the endpoint is
                unauthenticated and covered by the contact rate limit. */}
            <Modal
                open={notifyOpen}
                title="NOTIFY ME"
                message={`We'll email you once ${product.name}${selectedSize ? ` in size ${selectedSize}` : ''} is back in stock.`}
                input
                inputType="email"
                inputPlaceholder="YOUR EMAIL"
                validate={(v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim())
                    ? null
                    : 'PLEASE ENTER A VALID EMAIL')}
                confirmLabel="NOTIFY ME"
                cancelLabel="CANCEL"
                onConfirm={submitNotify}
                onClose={() => setNotifyOpen(false)}
            />

            {notifyResult && (
                <Modal
                    open
                    title={notifyResult.ok ? "YOU'RE ON THE LIST" : 'SOMETHING WENT WRONG'}
                    message={notifyResult.message}
                    confirmLabel="CLOSE"
                    onConfirm={() => setNotifyResult(null)}
                    onClose={() => setNotifyResult(null)}
                />
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
                            {media.map((m, idx) => (
                                <div
                                    key={idx}
                                    className={`pd-lightbox-thumb${idx === lightboxIndex ? ' active' : ''}`}
                                    onClick={() => { setLightboxIndex(idx); setLightboxZoom(0); setLbOrigin({ x: 50, y: 50 }); lbNatRect.current = null; setLbMouse(mm => ({ ...mm, visible: false })); }}
                                >
                                    <img loading="lazy" decoding="async" src={shopifyImage(stillOf(m), 200)} alt={`${product.name} view ${idx + 1}`} />
                                    {m.kind === 'video' && PLAY_BADGE}
                                </div>
                            ))}
                        </div>
                        <div
                            className={`pd-lightbox-main${lbIsVideo ? ' pd-lightbox-main-video' : ''}`}
                            ref={lbMainRef}
                            onMouseMove={lbIsVideo ? undefined : handleLbMouseMove}
                            onMouseLeave={handleLbMouseLeave}
                            onTouchStart={handleLbTouchStart}
                            onTouchMove={handleLbTouchMove}
                            onTouchEnd={handleLbTouchEnd}
                            onClick={() => {
                                // Zoom is for inspecting fabric in a still. On a video
                                // the same click has to reach the transport controls,
                                // and scaling a playing frame helps nobody.
                                if (lbIsVideo) return;
                                // No zoom-on-tap on phone/iPad — this is a desktop-only interaction
                                if (isMobileViewport()) return;
                                const newZoom = (lightboxZoom + 1) % 4;
                                if (newZoom === 0) { setLbOrigin({ x: 50, y: 50 }); lbNatRect.current = null; }
                                setLightboxZoom(newZoom);
                            }}
                        >
                            {lbIsVideo ? (
                                <ProductVideo
                                    key={lightboxIndex}
                                    item={media[lightboxIndex]}
                                    active
                                    controls
                                    alt={product.name}
                                />
                            ) : (
                                <img
                                    ref={lbImgRef}
                                    // The lightbox exists to inspect fabric detail —
                                    // it zooms to 5x, so this is the one place that
                                    // genuinely needs a large source.
                                    src={shopifyImage(media[lightboxIndex]?.url, 2048)}
                                    decoding="async"
                                    alt={product.name}
                                    style={{
                                        transform: `scale(${LB_ZOOMS[lightboxZoom]})`,
                                        transformOrigin: `${lbOrigin.x.toFixed(1)}% ${lbOrigin.y.toFixed(1)}%`,
                                    }}
                                />
                            )}
                            {/* Custom cursor */}
                            {!lbIsVideo && lbMouse.visible && (
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
                            {!lbIsVideo && lightboxZoom > 0 && (
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
