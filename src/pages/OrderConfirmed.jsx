import React, { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import './Checkout.css';

const rs = (n) => `RS. ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const OrderConfirmed = () => {
    const location = useLocation();
    const { clearCart } = useCart();
    const order = location.state?.order;

    // The cart is cleared here rather than in Checkout: clearing it while still
    // on /checkout trips RequireCart, which redirects to /cart before the
    // confirmation page can load. By the time we're here the order is placed,
    // so it's safe to empty the cart.
    useEffect(() => {
        if (order && clearCart) clearCart();
    }, [order, clearCart]);

    // Reached without an order in state (refresh, direct visit, back button) —
    // there's nothing to confirm, so send them to their order history.
    if (!order) {
        return <Navigate to="/order-details" replace />;
    }

    const items = order.items || [];
    const addr = order.shippingAddress || {};
    const deliveryLabel = order.deliveryMethod === 'priority' ? 'PRIORITY' : 'STANDARD';

    return (
        <div className="order-details-page order-confirmed-page">
            <div className="order-details-container order-confirmed-container">
                {/* Confirmation header */}
                <div className="order-confirmed-hero reveal reveal-up">
                    <span className="order-confirmed-eyebrow">ORDER PLACED</span>
                    <h1 className="order-confirmed-title">THANK YOU</h1>
                    <p className="order-confirmed-note">
                        YOUR ORDER HAS BEEN CONFIRMED. A CONFIRMATION HAS BEEN SENT TO
                        {addr.email ? ` ${addr.email.toUpperCase()}` : ' YOUR EMAIL'}.
                    </p>
                    <span className="order-confirmed-number">
                        ORDER NO. {order.orderNumber || order.orderId}
                    </span>
                </div>

                <div className="order-confirmed-grid">
                    {/* Order summary */}
                    <section className="order-confirmed-summary reveal reveal-up">
                        <h2 className="order-confirmed-heading">ORDER SUMMARY</h2>
                        <div className="order-confirmed-items">
                            {items.map((item, idx) => (
                                <div key={idx} className="order-confirmed-item">
                                    <img
                                        src={item.image || '/placeholder.png'}
                                        alt={item.title}
                                        className="order-item-img"
                                    />
                                    <div className="order-item-texts">
                                        <h3 className="order-item-name">{item.title}</h3>
                                        {item.selectedOptions && item.selectedOptions.length > 0 && (
                                            <span className="order-item-sub">
                                                {item.selectedOptions.map(o => o.value).join(' | ')}
                                            </span>
                                        )}
                                        <span className="order-item-sub">QTY {item.quantity}</span>
                                    </div>
                                    <span className="order-confirmed-item-price">
                                        {rs(item.price * item.quantity)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Totals */}
                        <div className="order-confirmed-totals">
                            <div className="order-confirmed-total-row">
                                <span>SUBTOTAL</span>
                                <span>{rs(order.subtotal)}</span>
                            </div>
                            <div className="order-confirmed-total-row">
                                <span>SHIPPING</span>
                                <span>{order.shippingCost > 0 ? rs(order.shippingCost) : 'FREE'}</span>
                            </div>
                            <div className="order-confirmed-total-row order-confirmed-total-row--grand">
                                <span>TOTAL</span>
                                <span>{rs(order.total)}</span>
                            </div>
                        </div>
                    </section>

                    {/* Shipping + delivery */}
                    <aside className="order-confirmed-aside reveal reveal-up">
                        <div className="order-confirmed-panel">
                            <h2 className="order-confirmed-heading">SHIPPING TO</h2>
                            <div className="address-details">
                                <strong>{addr.firstName} {addr.lastName}</strong>
                                <p>{addr.address}</p>
                                <p>{addr.state} {addr.zip}</p>
                                <p>{addr.country}</p>
                                {addr.phone && <p>{addr.phone}</p>}
                                {addr.email && <p style={{ textTransform: 'lowercase' }}>{addr.email}</p>}
                            </div>
                        </div>

                        <div className="order-confirmed-panel">
                            <h2 className="order-confirmed-heading">DELIVERY</h2>
                            <div className="address-details">
                                <strong>{deliveryLabel}</strong>
                                <p>ESTIMATED 7–14 DAYS</p>
                            </div>
                        </div>
                    </aside>
                </div>

                {/* Actions */}
                <div className="order-confirmed-actions reveal reveal-up">
                    <Link to="/order-details" className="checkout-next-btn">VIEW ORDER</Link>
                    <Link to="/shop/all" className="go-back-link">CONTINUE SHOPPING</Link>
                </div>
            </div>
        </div>
    );
};

export default OrderConfirmed;
