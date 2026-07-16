import React, { useMemo, useState } from 'react';
import { useShop } from '../context/ShopContext';
import { useCart } from '../hooks/useCart';
import { useProducts } from '../hooks/useProducts';
import { formatPrice } from '../utils/formatPrice';
import { parseShopifyId } from '../utils/parseShopifyId';
import { Link } from 'react-router-dom';
import './Cart.css';

const Cart = () => {
    const { toggleWishlist, isInWishlist } = useShop();
    const { cart, removeFromCart, updateQuantity, loading: cartLoading } = useCart();
    const { products: allProducts } = useProducts(20);

    const lines = cart?.lines || [];
    const cost = cart?.cost;

    const gridRef = React.useRef(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(true);

    React.useEffect(() => {
        const el = gridRef.current;
        if (!el) return;
        const update = () => {
            setCanScrollLeft(el.scrollLeft > 4);
            setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
        };
        update();
        el.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => {
            el.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, [lines.length]);

    const goLeft = () => gridRef.current?.scrollBy({ left: -300, behavior: 'smooth' });
    const goRight = () => gridRef.current?.scrollBy({ left: 300, behavior: 'smooth' });

    if (!cart || lines.length === 0) {
        return (
            <div className="cart-page-dark">
                <div className="cart-empty-state">
                    <h1 className="cart-title">YOUR SHOPPING BAG IS EMPTY</h1>
                    <Link to="/shop/all" className="shop-all-link">CONTINUE SHOPPING</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="cart-page-dark">
            <div className="cart-main">
                <h1 className="cart-heading">SHOPPING BAG - {lines.reduce((s, l) => s + l.quantity, 0)} ITEMS</h1>

                <div className="cart-carousel-wrapper">
                    {lines.length > 1 && (
                        <button
                            className={`cart-arrow-btn cart-arrow-btn--left${!canScrollLeft ? ' cart-arrow-btn--dim' : ''}`}
                            onClick={goLeft}
                            aria-label="Scroll left"
                        >
                            <svg width="22" height="26" viewBox="0 0 21 24" fill="currentColor">
                                <polygon points="21,0 21,24 0,12"/>
                            </svg>
                        </button>
                    )}
                    <div className="cart-products-grid" ref={gridRef}>
                    {lines.map((line) => {
                        const merch = line.merchandise;
                        const productHandle = merch.product?.handle;
                        const title = merch.product?.title || merch.title;
                        const imgUrl = merch.image?.url;
                        const selectedOptions = merch.selectedOptions || [];
                        const color = selectedOptions.find(o => o.name === 'Color')?.value || '';
                        const size = selectedOptions.find(o => o.name === 'Size')?.value || '';
                        const linePrice = formatPrice(line.cost?.totalAmount);
                        const rawProductId = merch.product?.id;
                        const productId = parseShopifyId(rawProductId);

                        return (
                            <div className="cart-product-card" key={line.id}>
                                <div className="cart-card-image">
                                    <Link to={`/product/${productHandle || merch.product?.id}`}>
                                        <img src={imgUrl} alt={title} />
                                    </Link>
                                    <button
                                        className="cart-card-remove"
                                        onClick={() => removeFromCart(line.id)}
                                        aria-label="Remove item"
                                    >
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round">
                                            <line x1="2" y1="2" x2="18" y2="18" />
                                            <line x1="18" y1="2" x2="2" y2="18" />
                                        </svg>
                                    </button>
                                </div>
                                <div className="cart-card-info">
                                    <div className="cart-card-name-row">
                                        <div className="cart-card-name-price">
                                            <span className="cart-card-name">{title}</span>
                                            <span className="cart-card-price">{linePrice}</span>
                                        </div>
                                        <button
                                            className={`cart-card-bookmark ${isInWishlist(productId) ? 'active' : ''}`}
                                            onClick={() => toggleWishlist({ id: productId, handle: productHandle, name: title, price: linePrice, img: imgUrl, variantId: merch.id })}
                                            aria-label={isInWishlist(productId) ? 'Remove from wishlist' : 'Add to wishlist'}
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
                                                    stroke="rgba(255, 255, 255, 0.6)"
                                                    strokeWidth="0.9"
                                                    fill={isInWishlist(productId) ? "currentColor" : "none"}
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                    <div className="cart-card-bottom-row">
                                        <span className="cart-card-meta">{color}{color && size ? ' | ' : ''}{size}</span>
                                        <div className="cart-card-qty">
                                            <button onClick={() => updateQuantity(line.id, line.quantity + 1)} disabled={cartLoading}>+</button>
                                            <span>{line.quantity}</span>
                                            <button onClick={() => updateQuantity(line.id, line.quantity - 1)} disabled={cartLoading}>-</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    </div>
                    {lines.length > 1 && (
                        <button
                            className={`cart-arrow-btn cart-arrow-btn--right${!canScrollRight ? ' cart-arrow-btn--dim' : ''}`}
                            onClick={goRight}
                            aria-label="Scroll right"
                        >
                            <svg width="22" height="26" viewBox="0 0 21 24" fill="currentColor">
                                <polygon points="0,0 0,24 21,12"/>
                            </svg>
                        </button>
                    )}
                </div>

                {/* Summary — full width */}
                <div className="cart-summary-full">
                    <h2 className="cart-summary-heading">SUMMARY</h2>
                    <div className="cart-summary-lines">
                        <div className="cart-summary-row">
                            <span>SUBTOTAL</span>
                            <span>{cost?.subtotalAmount ? formatPrice(cost.subtotalAmount) : '—'}</span>
                        </div>
                        <div className="cart-summary-row">
                            <span>SHIPPING  (Standard)</span>
                            <span>FREE</span>
                        </div>
                        <div className="cart-summary-row cart-summary-row--tax">
                            <span>TAX</span>
                            <span>{cost?.totalTaxAmount ? formatPrice(cost.totalTaxAmount) : 'Calculated at checkout'}</span>
                        </div>
                    </div>
                    <div className="cart-summary-total">
                        <span>TOTAL</span>
                        <span>{cost?.totalAmount ? formatPrice(cost.totalAmount) : '—'}</span>
                    </div>
                    <div className="cart-checkout-row">
                        <Link to="/checkout" className="cart-checkout-btn">CHECKOUT</Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Cart;
