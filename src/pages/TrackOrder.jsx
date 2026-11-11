import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ordersAPI } from '../lib/api';
import { FULFILLMENT_STEPS, getStatusIndex, getStatusLabel } from '../utils/orderStatus';
import { shopifyImage } from '../utils/shopifyImage';
import './TrackOrder.css';

const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

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

    const statusIdx = getStatusIndex(matchedOrder);
    const items = matchedOrder?.items || [];
    const addr = matchedOrder?.shippingAddress || {};

    return (
        <div className="track-order-page">
            <div className={`track-search${matchedOrder ? ' is-compact' : ''}`}>
                <div className="track-search-head">
                    <h1 className="serif">TRACK YOUR ORDER</h1>
                    <p>ENTER YOUR ORDER NUMBER TO SEE ITS STATUS.</p>
                </div>

                {!token && !loading && (
                    <p className="track-signin">
                        <Link to="/profile">LOG IN</Link> TO TRACK YOUR ORDERS
                    </p>
                )}

                <form className="track-form" onSubmit={handleTrack}>
                    <div className="track-field">
                        <label htmlFor="track-order-number">ORDER NUMBER</label>
                        <input
                            id="track-order-number"
                            type="text"
                            inputMode="numeric"
                            placeholder="E.G. 1001"
                            value={searchId}
                            onChange={(e) => { setSearchId(e.target.value); setSearched(false); }}
                            required
                        />
                    </div>
                    <button type="submit" className="track-submit" disabled={loading}>
                        {loading ? 'LOADING...' : 'TRACK STATUS'}
                    </button>
                </form>
            </div>

            {searched && !matchedOrder && (
                <p className="track-empty">
                    {token ? 'NO ORDER FOUND WITH THAT NUMBER' : 'PLEASE LOG IN TO TRACK YOUR ORDERS'}
                </p>
            )}

            {matchedOrder && (
                <div className="track-result">
                    <div className="track-result-head">
                        <h2>ORDER #{matchedOrder.orderNumber || matchedOrder.id}</h2>
                        <span className="track-result-status">
                            {getStatusLabel(matchedOrder)} &middot; PLACED {fmtDate(matchedOrder.createdAt)}
                        </span>
                    </div>

                    <div className="track-row">
                        <div>
                            {items.map((item, idx) => (
                                <div key={idx} className="track-item">
                                    <div className="track-item-img">
                                        <img
                                            src={shopifyImage(item.image || '/placeholder.png', 200)}
                                            loading="lazy"
                                            decoding="async"
                                            alt={item.title}
                                        />
                                    </div>
                                    <div className="track-item-meta">
                                        <h3>{item.title}</h3>
                                        {item.selectedOptions && (
                                            <p>{item.selectedOptions.map(o => o.value).join(' | ')}</p>
                                        )}
                                        <p>QTY {item.quantity}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="track-address">
                            {addr.firstName && (
                                <>
                                    <strong>{addr.firstName} {addr.lastName}</strong>
                                    <p>{addr.address}</p>
                                    <p>{addr.city} {addr.state} {addr.zip}</p>
                                    <p>{addr.country}</p>
                                    {addr.phone && <p>{addr.phone}</p>}
                                </>
                            )}
                        </div>

                        <div className="track-timeline-col">
                            <div className="track-timeline">
                                <div className="track-timeline-line" aria-hidden="true"></div>
                                <div className="track-steps">
                                    {FULFILLMENT_STEPS.map((label, index) => (
                                        <div
                                            key={label}
                                            className={`track-step${index <= statusIdx ? ' is-done' : ''}`}
                                        >
                                            <div className="track-step-box"></div>
                                            <span className="track-step-label">{label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Facts only. Once delivered there is nothing left to
                                track, and before dispatch there is nothing to show
                                but the status already in the header. */}
                            {matchedOrder.deliveredAt ? (
                                <p className="track-note">DELIVERED {fmtDate(matchedOrder.deliveredAt)}</p>
                            ) : matchedOrder.trackingNumber ? (
                                <p className="track-note">
                                    {matchedOrder.trackingCompany ? `${matchedOrder.trackingCompany} ` : ''}
                                    {matchedOrder.trackingUrl ? (
                                        <a href={matchedOrder.trackingUrl} target="_blank" rel="noopener noreferrer">
                                            TRACK {matchedOrder.trackingNumber}
                                        </a>
                                    ) : (
                                        <>AWB {matchedOrder.trackingNumber}</>
                                    )}
                                </p>
                            ) : null}

                            <Link to="/order-details" className="track-link">ORDER DETAILS</Link>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TrackOrder;
