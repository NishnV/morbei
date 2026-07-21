import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useShop } from '../context/ShopContext';
import { useProduct } from '../hooks/useProduct';
import { useProducts } from '../hooks/useProducts';
import { useCart } from '../hooks/useCart';
import { useGlobalLoading } from '../context/LoadingContext';
import { useCustomer } from '../hooks/useCustomer';
import ErrorBoundary from '../components/ErrorBoundary';
import { isMobileViewport } from '../lib/viewport';
import './ProductDetail.css';

const LB_ZOOMS = [1, 2, 3.5, 5]; // lightbox zoom levels: 0=fit, then 2x/3.5x/5x

const ProductDetail = () => {
    const { id } = useParams();
    const [searchParams] = useSearchParams();
    const { toggleWishlist, isInWishlist, setIsCartOpen } = useShop();
    const { addToCart: shopifyAddToCart } = useCart();
    const { customer } = useCustomer();

    const { data: product, loading } = useProduct(id);
    const { data: allProducts } = useProducts(40);
    const { startLoading, stopLoading } = useGlobalLoading();

    useEffect(() => {
        if (loading) startLoading();
        else stopLoading();
    }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (product?.name) document.title = `${product.name.toUpperCase()} | MORBEI`;
    }, [product?.name]);

    const [selectedSize, setSelectedSize] = useState(searchParams.get('size') || '');
    const [sizeError, setSizeError] = useState(false);
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
    const lbNatRect = useRef(null);
    const lbMainRef = useRef(null);
    const lbImgRef = useRef(null);
    const col2Ref = useRef(null);
    const mobileTouchStartX = useRef(null);

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

    // Same-category recommendations: filter products with same productType, fallback to all products
    const categoryRecs = useMemo(() => {
        if (!product || !allProducts?.length) return [];

        // Try to get products with same productType
        const type = product.productType?.toLowerCase();
        let recs = [];

        if (type) {
            recs = allProducts
                .filter(p => p.id !== product.id && p.productType?.toLowerCase() === type)
                .slice(0, 4);
        }

        // If we don't have enough (or any), add other products
        if (recs.length < 4) {
            const otherProducts = allProducts
                .filter(p => p.id !== product.id && !recs.find(r => r.id === p.id))
                .sort(() => Math.random() - 0.5)
                .slice(0, 4 - recs.length);
            recs = [...recs, ...otherProducts];
        }

        return recs.slice(0, 4);
    }, [product, allProducts]);

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
    };
    const handleMobileTouchEnd = (e) => {
        if (mobileTouchStartX.current === null) return;
        const delta = e.changedTouches[0].clientX - mobileTouchStartX.current;
        mobileTouchStartX.current = null;
        if (Math.abs(delta) < 40) {
            // Not a swipe — treat as a tap on the image, same as clicking it on desktop
            setLightboxIndex(mainImageIndex);
            setLightboxZoom(0);
            setLbOrigin({ x: 50, y: 50 });
            lbNatRect.current = null;
            setLightboxOpen(true);
            return;
        }
        e.preventDefault();
        if (delta < 0) {
            setMainImageIndex(prev => Math.min(prev + 1, product.images.length - 1));
        } else {
            setMainImageIndex(prev => Math.max(prev - 1, 0));
        }
    };

    return (
        <div className="product-detail-page">
            <div className="pd-container">
                {/* Column 1 — 50%: Main image — click to open lightbox */}
                <div
                    className="pd-main-image-col"
                    onClick={() => { setLightboxIndex(mainImageIndex); setLightboxZoom(0); setLightboxOpen(true); }}
                    style={{ background: bgColor, cursor: 'pointer' }}
                >
                    {prevImageIndex !== null && (
                        <img
                            src={product.images[prevImageIndex]}
                            alt=""
                            className="pd-main-img pd-main-img-exit"
                            style={{ position: 'absolute', inset: 0 }}
                        />
                    )}
                    <img key={mainImageIndex} src={product.images[mainImageIndex]} alt={product.name} className="pd-main-img" crossOrigin="anonymous" onLoad={(e) => sampleImageBg(e.currentTarget)} />
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
                                <img loading="lazy" src={img} alt={`${product.name} view ${idx + 1}`} />
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
                                    <img loading="lazy" src={img} alt={`${product.name} view ${idx + 1}`} />
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
                                <div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
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
                            <p>Free shipping on orders over RS. 10000. Returns accepted within 14 days.</p>
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
                                    <img loading="lazy" src={prod.images?.[0] || prod.img} alt={prod.name} />
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
                                    <img loading="lazy" src={img} alt={`${product.name} view ${idx + 1}`} />
                                </div>
                            ))}
                        </div>
                        <div
                            className="pd-lightbox-main"
                            ref={lbMainRef}
                            onMouseMove={handleLbMouseMove}
                            onMouseLeave={handleLbMouseLeave}
                            onClick={() => {
                                // No zoom-on-tap on phone/iPad — this is a desktop-only interaction
                                if (isMobileViewport()) return;
                                const newZoom = (lightboxZoom + 1) % 4;
                                if (newZoom === 0) { setLbOrigin({ x: 50, y: 50 }); lbNatRect.current = null; }
                                setLightboxZoom(newZoom);
                            }}
                        >
                            <img loading="lazy"
                                ref={lbImgRef}
                                src={product.images[lightboxIndex]}
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
