import React, { useMemo, useRef, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShop } from '../context/ShopContext';
import { useCart } from '../hooks/useCart';
import { useProducts } from '../hooks/useProducts';
import './Wishlist.css';
import './ProductDetail.css';

const Wishlist = () => {
    const { wishlist, toggleWishlist, isInWishlist } = useShop();
    const { addToCart: shopifyAddToCart } = useCart();
    const { products: allProducts, loading: productsLoading } = useProducts(100);
    const [movingToBagId, setMovingToBagId] = useState(null);
    const [bagError, setBagError] = useState(null);
    // sizePicker: { itemId, sizes: [{label, variantId, available}] } | null
    const [sizePicker, setSizePicker] = useState(null);

    // Drag-to-scroll
    const sliderRef = useRef(null);
    const dragState = useRef({ isDown: false, startX: 0, scrollLeft: 0 });

    const onMouseDown = useCallback((e) => {
        dragState.current = { isDown: true, startX: e.pageX - sliderRef.current.offsetLeft, scrollLeft: sliderRef.current.scrollLeft };
        sliderRef.current.classList.add('is-dragging');
    }, []);
    const onMouseLeave = useCallback(() => {
        dragState.current.isDown = false;
        sliderRef.current?.classList.remove('is-dragging');
    }, []);
    const onMouseUp = useCallback(() => {
        dragState.current.isDown = false;
        sliderRef.current?.classList.remove('is-dragging');
    }, []);
    const onMouseMove = useCallback((e) => {
        if (!dragState.current.isDown) return;
        e.preventDefault();
        const x = e.pageX - sliderRef.current.offsetLeft;
        const walk = (x - dragState.current.startX) * 1.2;
        sliderRef.current.scrollLeft = dragState.current.scrollLeft - walk;
    }, []);

    // Resolve the full product variants for a wishlist item
    const resolveVariants = useCallback((item) => {
        // Priority 1: variants stored on the item (from ProductDetail or Shop page)
        if (item.variants?.length) return item.variants;
        // Priority 2: allProducts lookup — handles items wishlisted from Cart/Navbar
        if (allProducts?.length) {
            const shortId = String(item.id || '').split('/').pop();
            const match = allProducts.find(
                p => p.id === item.id || p.id === shortId || p.shopifyId === item.id
            );
            if (match?.variants?.length) return match.variants;
        }
        // Priority 3: single-variant fallback — use stored variantId as-is
        if (item.variantId) return [{ id: item.variantId, size: '', available: true }];
        return [];
    }, [allProducts]);

    // First click: open size picker (or add immediately if only 1 size)
    const handleMoveToBag = (item) => {
        setBagError(null);

        // If the item has a specific variantId stored (wishlisted after selecting a
        // size on ProductDetail or from the cart), add directly — no size picker needed.
        if (item.variantId) {
            addItemToCart(item, item.variantId);
            return;
        }

        const variants = resolveVariants(item);

        // Build unique sizes from variants
        const sizes = [];
        const seen = new Set();
        for (const v of variants) {
            const label = v.size || v.title || 'ONE SIZE';
            if (!seen.has(label)) {
                seen.add(label);
                sizes.push({ label, variantId: v.id, available: v.available !== false });
            }
        }

        // If only one size (or no size info), add directly
        if (sizes.length <= 1) {
            const variantId = sizes[0]?.variantId;
            if (variantId) {
                addItemToCart(item, variantId);
            } else if (productsLoading) {
                // Products haven't loaded yet — can't resolve variant, do nothing yet
                // Button stays as "MOVE TO BAG"; user can retry in a moment
            } else {
                setBagError(item.id);
            }
            return;
        }

        setSizePicker({ itemId: item.id, sizes });
    };

    const addItemToCart = async (item, variantId) => {
        try {
            setMovingToBagId(item.id);
            setSizePicker(null);
            await shopifyAddToCart(variantId, 1);
            toggleWishlist(item);
        } catch (err) {
            console.error('Failed to move to bag:', err);
            setBagError(item.id);
        } finally {
            setMovingToBagId(null);
        }
    };

    const handleSizeSelect = (item, variantId) => {
        addItemToCart(item, variantId);
    };

    // Get recommendations from Shopify products
    const recommendations = useMemo(() => {
        if (!allProducts?.length) return [];
        const wishlistIds = wishlist.map(item => item.id);
        const available = allProducts.filter(p => !wishlistIds.includes(p.id));
        const shuffled = [...available].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 4);
    }, [wishlist, allProducts]);

    return (
        <div className="wishlist-page">
            <h1 className="wishlist-title">WISHLISTED ITEMS</h1>

            {wishlist.length === 0 ? (
                <div className="wishlist-empty">
                    <p>NOTHING SAVED YET.</p>
                    <Link to="/shop/all" className="continue-shopping">EXPLORE COLLECTIONS</Link>
                </div>
            ) : (
                <div
                    className="wishlist-slider"
                    ref={sliderRef}
                    onMouseDown={onMouseDown}
                    onMouseLeave={onMouseLeave}
                    onMouseUp={onMouseUp}
                    onMouseMove={onMouseMove}
                >
                    {wishlist.map((item) => (
                        <div key={item.id} className="wishlist-item">
                            <div className="wishlist-img-wrapper">
                                <Link to={`/product/${item.handle || item.id}`}>
                                    <img loading="lazy" src={item.img} alt={item.name} />
                                </Link>
                                <button
                                    className="wishlist-remove-icon"
                                    onClick={() => toggleWishlist(item)}
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
                                            strokeWidth="1"
                                            fill="currentColor"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </button>

                                {/* Size picker overlay — slides up on MOVE TO BAG click */}
                                {sizePicker?.itemId === item.id && (
                                    <div className="wishlist-size-picker">
                                        <div className="wishlist-size-picker-header">
                                            <span>SELECT SIZE</span>
                                            <button
                                                className="wishlist-size-picker-close"
                                                onClick={() => setSizePicker(null)}
                                            >✕</button>
                                        </div>
                                        <div className="wishlist-size-picker-grid">
                                            {sizePicker.sizes.map(({ label, variantId, available }) => (
                                                <button
                                                    key={variantId}
                                                    className={`wishlist-size-option${!available ? ' unavailable' : ''}`}
                                                    onClick={() => available && handleSizeSelect(item, variantId)}
                                                    disabled={!available}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="wishlist-item-footer">
                                <div className="wishlist-item-info">
                                    <h3 className="wishlist-item-name">{item.name}</h3>
                                    <p className="wishlist-item-price">{item.price}</p>
                                </div>
                                <button
                                    className="move-to-bag-btn"
                                    onClick={() => handleMoveToBag(item)}
                                    disabled={movingToBagId === item.id || (productsLoading && !item.variantId && !item.variants?.length)}
                                >
                                    {movingToBagId === item.id
                                        ? 'ADDING...'
                                        : bagError === item.id
                                            ? 'TRY AGAIN'
                                            : 'MOVE TO BAG'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Wishlist;
