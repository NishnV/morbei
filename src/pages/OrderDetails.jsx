import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ordersAPI, shippingAPI } from '../lib/api';
import './Checkout.css';

const FULFILLMENT_STEPS = ['ORDER PLACED', 'PACKED', 'SHIPPED', 'OUT FOR DELIVERY', 'DELIVERED'];

function getStatusIndex(status) {
    if (!status) return 0;
    const s = status.toUpperCase();
    if (s === 'DELIVERED') return 4;
    if (s === 'OUT_FOR_DELIVERY' || s === 'OUT FOR DELIVERY') return 3;
    if (s === 'SHIPPED' || s === 'IN_TRANSIT' || s === 'IN TRANSIT') return 2;
    if (s === 'PACKED' || s === 'READY_TO_SHIP') return 1;
    return 0;
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
    const token = localStorage.getItem('morbei_token');

    useEffect(() => {
        if (!token) { setLoading(false); return; }
        ordersAPI.list()
            .then(setOrders)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [token]);

    if (loading) {
        return (
            <div className="order-details-page">
                <div className="order-details-container">
                    <h1 className="order-details-header reveal reveal-up">ORDER DETAILS</h1>
                    <p style={{ textAlign: 'center', padding: '4rem 0', letterSpacing: '0.1em', fontSize: '0.85rem' }}>LOADING YOUR ORDERS...</p>
                </div>
            </div>
        );
    }

    if (!token) {
        return (
            <div className="order-details-page">
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
            <div className="order-details-page">
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
        <div className="order-details-page">
            <div className="order-details-container">
                <h1 className="order-details-header reveal reveal-up">ORDER DETAILS</h1>

                <div className="order-items-list-v3">
                    {orders.map((order) => {
                        const items = order.items || [];
                        const statusIdx = getStatusIndex(order.status);
                        const addr = order.shippingAddress || {};

                        const handleCancel = async () => {
                            if (!confirm('Cancel this order?')) return;
                            try {
                                await shippingAPI.cancel(order.id);
                                setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'cancelled' } : o));
                            } catch (e) {
                                alert('Cancel failed: ' + e.message);
                            }
                        };

                        return items.map((item, idx) => (
                            <div key={`${order.id}-${idx}`} className="order-item-block reveal reveal-up">
                                {/* Left — Product + Cancel */}
                                <div className="order-item-left">
                                    <div className="order-item-main-info">
                                        <img src={item.image || '/placeholder.png'} alt={item.title} className="order-item-img" />
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
                                    {order.status !== 'cancelled' && (
                                        <button className="cancel-order-btn" onClick={handleCancel}>CANCEL</button>
                                    )}
                                    {order.status === 'cancelled' && (
                                        <span className="order-item-sub" style={{ color: '#ff4444' }}>CANCELLED</span>
                                    )}
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
                                    <span className="est-delivery-badge">
                                        ESTIMATED DELIVERY {getEstDelivery(order.createdAt)}
                                    </span>
                                </div>
                            </div>
                        ));
                    })}
                </div>
            </div>
        </div>
    );
};

export default OrderDetails;
