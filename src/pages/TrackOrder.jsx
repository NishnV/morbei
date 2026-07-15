import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Package, Truck, CheckCircle } from 'lucide-react';
import { useCustomer } from '../hooks/useCustomer';
import { formatPrice } from '../utils/formatPrice';
import './TrackOrder.css';

function getFulfillmentSteps(status) {
    const steps = [
        { label: 'ORDER PLACED', completed: true },
        { label: 'PROCESSING', completed: false },
        { label: 'SHIPPED', completed: false },
        { label: 'IN TRANSIT', completed: false },
        { label: 'DELIVERED', completed: false }
    ];

    if (!status) return steps;
    const s = status.toUpperCase();
    if (s === 'FULFILLED' || s === 'DELIVERED') return steps.map(st => ({ ...st, completed: true }));
    if (s === 'IN_TRANSIT' || s === 'IN TRANSIT') return steps.map((st, i) => ({ ...st, completed: i <= 3 }));
    if (s === 'PARTIALLY_FULFILLED') return steps.map((st, i) => ({ ...st, completed: i <= 2 }));
    return steps; // UNFULFILLED — only order placed
}

const TrackOrder = () => {
    const [searchId, setSearchId] = useState('');
    const [searched, setSearched] = useState(false);
    const { customer, loading } = useCustomer();
    const orders = customer?.orders || [];

    const matchedOrder = useMemo(() => {
        if (!searched || !searchId.trim()) return null;
        const q = searchId.trim().toUpperCase();
        return orders.find(o =>
            String(o.orderNumber) === q ||
            o.name?.toUpperCase() === q ||
            o.name?.toUpperCase() === `#${q}`
        ) || null;
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

                {!customer && !loading && (
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
                            {customer ? 'NO ORDER FOUND WITH THAT NUMBER' : 'PLEASE LOG IN TO TRACK YOUR ORDERS'}
                        </p>
                    </div>
                )}

                {matchedOrder && (() => {
                    const steps = getFulfillmentSteps(matchedOrder.fulfillmentStatus);
                    const tracking = matchedOrder.successfulFulfillments?.[0]?.trackingInfo?.[0];
                    const statusLabel = matchedOrder.fulfillmentStatus?.replace(/_/g, ' ') || 'UNFULFILLED';

                    return (
                        <div className="tracking-results reveal active">
                            <div className="status-header">
                                <div>
                                    <span className="order-label">ORDER #{matchedOrder.orderNumber || matchedOrder.name}</span>
                                    <h2 className="current-status">{statusLabel}</h2>
                                </div>
                                <div className="est-delivery">
                                    <span className="order-label">TOTAL</span>
                                    <h3>{formatPrice(matchedOrder.currentTotalPrice)}</h3>
                                </div>
                            </div>

                            <div className="tracking-timeline">
                                {steps.map((step, index) => (
                                    <div key={index} className={`timeline-step ${step.completed ? 'completed' : ''}`}>
                                        <div className="step-marker">
                                            {step.completed ? <CheckCircle size={24} /> : (index === 3 ? <Truck size={24} /> : <Package size={24} />)}
                                        </div>
                                        <div className="step-info">
                                            <span className="step-label">{step.label}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {tracking?.url && (
                                <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                                    <a href={tracking.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', letterSpacing: '0.1em', fontSize: '0.8rem' }}>
                                        TRACK SHIPMENT: {tracking.number || 'VIEW'}
                                    </a>
                                </div>
                            )}

                            {matchedOrder.statusUrl && (
                                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                                    <a href={matchedOrder.statusUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', letterSpacing: '0.1em', fontSize: '0.75rem', opacity: 0.7 }}>
                                        VIEW FULL ORDER STATUS ON SHOPIFY
                                    </a>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default TrackOrder;
