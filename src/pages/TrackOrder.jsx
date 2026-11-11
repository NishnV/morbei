import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Package, Truck, CheckCircle } from 'lucide-react';
import { ordersAPI } from '../lib/api';
import { FULFILLMENT_STEPS, getStatusIndex, getStatusLabel } from '../utils/orderStatus';
import './TrackOrder.css';

/**
 * Orders come from our own backend, not from the Shopify customer record.
 *
 * Only the backend reads fulfillments[].shipment_status; the Storefront order
 * carries fulfillmentStatus alone and has no delivery state on it at all.
 * This page used to work from that field and so told the customer their order
 * had been DELIVERED the moment it was marked fulfilled.
 */
const TrackOrder = () => {
    const [searchId, setSearchId] = useState('');
    const [searched, setSearched] = useState(false);
    const [orders, setOrders] = useState([]);
    const token = localStorage.getItem('morbei_token');
    // Seeded from the token rather than switched off inside the effect: with
    // no session there is nothing to load and no render to wait for.
    const [loading, setLoading] = useState(Boolean(token));

    useEffect(() => {
        if (!token) return;
        ordersAPI.list()
            .then(setOrders)
            .catch(() => setOrders([]))
            .finally(() => setLoading(false));
    }, [token]);

    const matchedOrder = useMemo(() => {
        if (!searched || !searchId.trim()) return null;
        const q = searchId.trim().replace(/^#/, '').toUpperCase();
        return orders.find(o => String(o.orderNumber) === q || String(o.id) === q) || null;
    }, [searched, searchId, orders]);

    const handleTrack = (e) => {
        e.preventDefault();
        setSearched(true);
    };

    return (
        <div className="track-order-page">
            <div className="track-container">
                <h1 className="serif">TRACK YOUR ORDER</h1>
                <p className="track-desc">ENTER YOUR ORDER NUMBER TO SEE THE CURRENT STATUS AND ESTIMATED DELIVERY DATE.</p>

                {!token && !loading && (
                    <p style={{ textAlign: 'center', fontSize: '0.75rem', letterSpacing: '0.1em', opacity: 0.6, marginBottom: '1.5rem' }}>
                        <Link to="/profile" style={{ textDecoration: 'underline' }}>LOG IN</Link> TO TRACK YOUR ORDERS
                    </p>
                )}

                <form className="track-form" onSubmit={handleTrack}>
                    <div className="search-input-wrapper">
                        <Search size={20} />
                        <input
                            type="text"
                            placeholder="ORDER NUMBER (e.g. 1001)"
                            value={searchId}
                            onChange={(e) => { setSearchId(e.target.value); setSearched(false); }}
                            required
                        />
                    </div>
                    <button type="submit" className="track-btn" disabled={loading}>
                        {loading ? 'LOADING...' : 'TRACK STATUS'}
                    </button>
                </form>

                {searched && !matchedOrder && (
                    <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                        <p style={{ letterSpacing: '0.1em', fontSize: '0.85rem' }}>
                            {token ? 'NO ORDER FOUND WITH THAT NUMBER' : 'PLEASE LOG IN TO TRACK YOUR ORDERS'}
                        </p>
                    </div>
                )}

                {matchedOrder && (() => {
                    const statusIdx = getStatusIndex(matchedOrder);

                    return (
                        <div className="tracking-results reveal active">
                            <div className="status-header">
                                <div>
                                    <span className="order-label">ORDER #{matchedOrder.orderNumber || matchedOrder.id}</span>
                                    <h2 className="current-status">{getStatusLabel(matchedOrder)}</h2>
                                </div>
                                <div className="est-delivery">
                                    <span className="order-label">TOTAL</span>
                                    <h3>RS. {Math.round(matchedOrder.totalAmount).toLocaleString('en-IN')}</h3>
                                </div>
                            </div>

                            <div className="tracking-timeline">
                                {FULFILLMENT_STEPS.map((label, index) => {
                                    const completed = index <= statusIdx;
                                    return (
                                        <div key={label} className={`timeline-step ${completed ? 'completed' : ''}`}>
                                            <div className="step-marker">
                                                {completed ? <CheckCircle size={24} /> : (index === 3 ? <Truck size={24} /> : <Package size={24} />)}
                                            </div>
                                            <div className="step-info">
                                                <span className="step-label">{label}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {matchedOrder.trackingNumber && (
                                <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                                    {matchedOrder.trackingUrl ? (
                                        <a href={matchedOrder.trackingUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', letterSpacing: '0.1em', fontSize: '0.8rem' }}>
                                            TRACK SHIPMENT: {matchedOrder.trackingNumber}
                                        </a>
                                    ) : (
                                        <span style={{ letterSpacing: '0.1em', fontSize: '0.8rem', opacity: 0.7 }}>
                                            {matchedOrder.trackingCompany ? `${matchedOrder.trackingCompany} · ` : ''}AWB {matchedOrder.trackingNumber}
                                        </span>
                                    )}
                                </div>
                            )}

                            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                                <Link to="/order-details" style={{ textDecoration: 'underline', letterSpacing: '0.1em', fontSize: '0.75rem', opacity: 0.7 }}>
                                    VIEW FULL ORDER DETAILS
                                </Link>
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default TrackOrder;
