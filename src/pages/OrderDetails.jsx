import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ordersAPI, shippingAPI } from '../lib/api';
import Modal from '../components/ui/Modal';
import './Checkout.css';
import { shopifyImage } from '../utils/shopifyImage';

const FULFILLMENT_STEPS = ['ORDER PLACED', 'PACKED', 'SHIPPED', 'OUT FOR DELIVERY', 'DELIVERED'];

// Map Shopify fulfillment/shipment data onto the tracker. Shopify has no
// distinct "packed" state, so a fulfilled order lights PACKED + SHIPPED together.
function getStatusIndex(order) {
    const shipment = (order.shipmentStatus || '').toLowerCase();
    if (shipment === 'delivered') return 4;
    if (shipment === 'out_for_delivery' || shipment === 'attempted_delivery') return 3;
    if (shipment === 'in_transit' || shipment === 'confirmed' || shipment === 'picked_up') return 2;
    // Fulfilled in Shopify (tracking added) but no granular shipment status yet.
    if (order.fulfillmentStatus === 'fulfilled') return 2;
    if (order.fulfillmentStatus === 'partial') return 1;
    return 0; // paid, not yet fulfilled
}

function getEstDelivery(createdAt) {
    const base = createdAt ? new Date(createdAt) : new Date();
    const start = new Date(base); start.setDate(start.getDate() + 7);
    const end = new Date(base); end.setDate(end.getDate() + 14);
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
    return `${fmt(start)}-${fmt(end)}`;
}

const OrderDetails = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // { type: 'cancel', orderId } | { type: 'notice', title, message } | null
    const [modal, setModal] = useState(null);
    const token = localStorage.getItem('morbei_token');

    useEffect(() => {
        if (!token) { setLoading(false); return; }
        ordersAPI.list()
            .then(setOrders)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [token]);

    const confirmCancel = async () => {
        const orderId = modal?.orderId;
        setModal(null);
        if (!orderId) return;
        try {
            const res = await shippingAPI.cancel(orderId);
            setOrders(prev => prev.map(o => o.id === orderId
                ? { ...o, status: 'cancelled', refundId: res.refunded ? 'pending' : null }
                : o));
            if (res.refunded) {
                setModal({
                    type: 'notice',
                    title: 'ORDER CANCELLED',
                    message: `A REFUND OF RS. ${Math.round(res.refundAmount).toLocaleString('en-IN')} HAS BEEN INITIATED TO YOUR ORIGINAL PAYMENT METHOD.`,
                });
            }
        } catch (e) {
            setModal({ type: 'notice', title: 'CANCELLATION FAILED', message: e.message });
        }
    };

    if (loading) {
        return (
            <div className="order-details-page order-history-page">
                <div className="order-details-container">
                    <h1 className="order-details-header reveal reveal-up">ORDER DETAILS</h1>
                    <p style={{ textAlign: 'center', padding: '4rem 0', letterSpacing: '0.1em', fontSize: '0.85rem' }}>LOADING YOUR ORDERS...</p>
                </div>
            </div>
        );
    }

    if (!token) {
        return (
            <div className="order-details-page order-history-page">
                <div className="order-details-container">
                    <h1 className="order-details-header reveal reveal-up">ORDER DETAILS</h1>
                    <div style={{ textAlign: 'center', padding: '4rem 0' }}>
                        <p style={{ letterSpacing: '0.1em', fontSize: '0.85rem', marginBottom: '2rem' }}>PLEASE LOG IN TO VIEW YOUR ORDERS</p>
                        <Link to="/profile" style={{ textDecoration: 'underline', letterSpacing: '0.15em', fontSize: '0.8rem' }}>LOGIN</Link>
                    </div>
                </div>
            </div>
        );
    }

    if (orders.length === 0) {
        return (
            <div className="order-details-page order-history-page">
                <div className="order-details-container">
                    <h1 className="order-details-header reveal reveal-up">ORDER DETAILS</h1>
                    <div style={{ textAlign: 'center', padding: '4rem 0' }}>
                        <p style={{ letterSpacing: '0.1em', fontSize: '0.85rem', marginBottom: '2rem' }}>YOU HAVEN'T PLACED ANY ORDERS YET</p>
                        <Link to="/shop/all" style={{ textDecoration: 'underline', letterSpacing: '0.15em', fontSize: '0.8rem' }}>START SHOPPING</Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="order-details-page order-history-page">
            <div className="order-details-container">
                <h1 className="order-details-header reveal reveal-up">ORDER DETAILS</h1>

                <div className="order-items-list-v3">
                    {orders.map((order) => {
                        const items = order.items || [];
                        const statusIdx = getStatusIndex(order);
                        const addr = order.shippingAddress || {};

                        const handleCancel = () => setModal({ type: 'cancel', orderId: order.id });

                        return (
                            <div key={order.id} className="order-item-block reveal reveal-up">
                                {/* Left — all products in the order + a single action */}
                                <div className="order-item-left">
                                    <div className="order-products-stack">
                                        {items.map((item, idx) => (
                                            <div key={idx} className="order-item-main-info">
                                                <img src={shopifyImage(item.image || '/placeholder.png', 200)} loading="lazy" decoding="async" alt={item.title} className="order-item-img" />
                                                <div className="order-item-texts">
                                                    <h3 className="order-item-name">{item.title}</h3>
                                                    {item.selectedOptions && (
                                                        <span className="order-item-sub">
                                                            {item.selectedOptions.map(o => o.value).join(' | ')}
                                                        </span>
                                                    )}
                                                    <span className="order-item-sub">QTY {item.quantity}</span>
                                                    <span className="order-item-sub">RS. {Math.round(item.price * item.quantity).toLocaleString('en-IN')}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {order.status === 'cancelled' ? (
                                        <span className="order-item-sub" style={{ color: '#ff4444' }}>
                                            CANCELLED{order.refundId ? ' · REFUNDED' : ''}
                                        </span>
                                    ) : statusIdx === 4 ? (
                                        <Link to="/returns" className="cancel-order-btn return-exchange-btn">RETURN / EXCHANGE</Link>
                                    ) : statusIdx === 0 ? (
                                        <button className="cancel-order-btn" onClick={handleCancel}>CANCEL</button>
                                    ) : null}
                                </div>

                                {/* Middle — Address */}
                                {addr.firstName && (
                                    <div className="order-item-shipping-info">
                                        <div className="address-details">
                                            <strong>{addr.firstName} {addr.lastName}</strong>
                                            <p>{addr.address}</p>
                                            <p>{addr.state} {addr.zip}, {addr.country}</p>
                                            {addr.phone && <p>{addr.phone}</p>}
                                            {addr.email && <p style={{ textTransform: 'lowercase' }}>{addr.email}</p>}
                                        </div>
                                    </div>
                                )}

                                {/* Right — Tracker */}
                                <div className="order-progress-block">
                                    <div className="order-tracker-v3">
                                        {FULFILLMENT_STEPS.map((label, sIdx) => (
                                            <div key={label} className="tracker-node">
                                                <div className={`tracker-dot ${sIdx <= statusIdx ? 'active' : ''}`}></div>
                                                <span className={`tracker-label ${sIdx <= statusIdx ? 'active' : ''}`}>{label}</span>
                                                {sIdx < FULFILLMENT_STEPS.length - 1 && <div className="tracker-line"></div>}
                                            </div>
                                        ))}
                                    </div>
                                    {order.trackingNumber ? (
                                        <div className="order-tracking-info">
                                            {order.trackingCompany && (
                                                <span className="est-delivery-badge">{order.trackingCompany}</span>
                                            )}
                                            {order.trackingUrl ? (
                                                <a
                                                    href={order.trackingUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="order-tracking-link"
                                                >
                                                    TRACK {order.trackingNumber}
                                                </a>
                                            ) : (
                                                <span className="est-delivery-badge">AWB {order.trackingNumber}</span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="est-delivery-badge">
                                            ESTIMATED DELIVERY {getEstDelivery(order.createdAt)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <Modal
                open={modal?.type === 'cancel'}
                title="CANCEL THIS ORDER?"
                message="ANY PAYMENT WILL BE REFUNDED TO YOUR ORIGINAL PAYMENT METHOD WITHIN 5–7 BUSINESS DAYS."
                confirmLabel="YES, CANCEL ORDER"
                cancelLabel="KEEP ORDER"
                onConfirm={confirmCancel}
                onClose={() => setModal(null)}
            />
            <Modal
                open={modal?.type === 'notice'}
                title={modal?.title}
                message={modal?.message}
                confirmLabel="OK"
                onConfirm={() => setModal(null)}
                onClose={() => setModal(null)}
            />
        </div>
    );
};

export default OrderDetails;
