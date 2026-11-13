import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../lib/api';
import { getStatusLabel } from '../utils/orderStatus';
import { shopifyImage } from '../utils/shopifyImage';

/**
 * The order list, and the one place a delivery can be recorded.
 *
 * Shopify has no delivered status on an order and no button for one: delivery
 * comes from posted fulfillment events, which carrier-integrated shipping
 * labels create and manual fulfillment never does. This store fulfils by
 * hand, so without this screen nothing would ever mark an order delivered —
 * the customer's tracker would stop at SHIPPED forever and the seven-day
 * returns window would have no date to count from.
 */

const rs = (paise) => (paise == null ? '—' : `RS. ${Math.round(paise / 100).toLocaleString('en-IN')}`);

const date = (iso) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—';

const AdminOrders = ({ token }) => {
    const [orders, setOrders] = useState(null);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);
    // Carrier and tracking for fulfilling without leaving this screen.
    const [carriers, setCarriers] = useState({});
    const [awbs, setAwbs] = useState({});

    const load = useCallback(async () => {
        setError('');
        try {
            const data = await adminAPI.orders(token);
            setOrders(data.orders);
        } catch (err) {
            setError(err.message);
        }
    }, [token]);

    useEffect(() => { load(); }, [load]);

    const markDelivered = async (order) => {
        // This starts the customer's seven-day return window and emails them
        // to say so, so it is a claim about the real world, not a stray click.
        const what = order.items.map((i) => `${i.title}${i.options ? ` (${i.options})` : ''} x${i.quantity}`).join('\n');
        if (!window.confirm(
            `Mark order #${order.orderNumber} as delivered?\n\n${what}\n\nTo: ${order.customer || '—'}\n${order.address || ''}\n\n`
            + 'This emails the customer and starts their 7-day return window.'
        )) return;
        setBusyId(order.id);
        setError('');
        try {
            await adminAPI.markDelivered(token, order.id);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    const fulfil = async (order) => {
        const carrier = (carriers[order.id] || '').trim();
        const awb = (awbs[order.id] || '').trim();
        if (!window.confirm(
            `Fulfil order #${order.orderNumber}?\n\n`
            + `${carrier || '(no carrier)'} ${awb || '(no tracking number)'}\n\n`
            + 'This marks it shipped in Shopify and emails the customer the tracking. '
            + 'Shopify will not send its own notification.'
        )) return;
        setBusyId(order.id);
        setError('');
        try {
            await adminAPI.fulfil(token, order.id, carrier, awb);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    const toggleTest = async (order) => {
        const next = !order.isTest;
        if (next && !window.confirm(
            `Mark order #${order.orderNumber || order.id} as a test?\n\n`
            + 'It will stop counting towards revenue and conversion. Reversible.'
        )) return;
        setBusyId(order.id);
        setError('');
        try {
            await adminAPI.markTest(token, order.id, next);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <>
            {error && <p className="dash-error">{error}</p>}
            {orders && orders.length === 0 && <p className="dash-note">NO ORDERS YET.</p>}

            {orders?.map((o) => (
                <article key={o.id} className="ret-card">
                    <header className="ret-head">
                        <span className="ret-order">
                            #{o.orderNumber || o.id}{o.isTest && ' · TEST'}
                        </span>
                        <span className="ret-product">
                            {o.items.map((i) => i.title).filter(Boolean).join(', ') || '—'}
                        </span>
                        <span className="ret-status">{getStatusLabel(o)}</span>
                    </header>

                    {/* The parcel, not a summary of it. Marking an order
                        delivered is a claim about specific garments reaching a
                        specific door, and it should be made while looking at
                        them. */}
                    <div className="ord-items">
                        {o.items.map((i, idx) => (
                            <div key={idx} className="ord-item">
                                {i.image
                                    ? <img className="ord-item-img" src={shopifyImage(i.image, 120)} alt="" loading="lazy" decoding="async" />
                                    : <span className="ord-item-img ord-item-img--none" />}
                                <span className="ord-item-text">
                                    <strong>{i.title}</strong>
                                    {i.options && <em>{i.options}</em>}
                                    <em>QTY {i.quantity}</em>
                                </span>
                            </div>
                        ))}
                    </div>

                    <dl className="ret-meta">
                        <div><dt>TOTAL</dt><dd>{rs(o.totalPaise)}</dd></div>
                        <div><dt>CUSTOMER</dt><dd>{o.customer || '—'}</dd></div>
                        {o.email && <div><dt>EMAIL</dt><dd>{o.email}</dd></div>}
                        {o.phone && <div><dt>PHONE</dt><dd>{o.phone}</dd></div>}
                        {o.address && <div><dt>SHIP TO</dt><dd>{o.address}</dd></div>}
                        <div><dt>PLACED</dt><dd>{date(o.createdAt)}</dd></div>
                        <div><dt>SHOPIFY</dt><dd>{o.shopifyOrderMissing ? 'DELETED THERE' : (o.fulfillmentStatus || 'unfulfilled')}</dd></div>
                        <div><dt>SHIPMENT</dt><dd>{o.shipmentStatus || '—'}</dd></div>
                        {o.trackingNumber && <div><dt>AWB</dt><dd>{o.trackingNumber}</dd></div>}
                        <div><dt>SHIPPED EMAIL</dt><dd>{date(o.shippedEmailAt)}</dd></div>
                        <div><dt>DELIVERED</dt><dd>{date(o.deliveredAt)}</dd></div>
                    </dl>

                    <div className="ret-actions">
                        {/* Fulfilling used to mean leaving for Shopify and then
                            waiting up to an hour for the sweep to tell the
                            customer. The number typed here is the one they get. */}
                        {o.status !== 'cancelled' && !o.deliveredAt && o.hasShopifyOrder
                            && !o.shopifyOrderMissing && o.fulfillmentStatus !== 'fulfilled' && (
                            <>
                                <input
                                    className="ret-note"
                                    placeholder="CARRIER"
                                    value={carriers[o.id] || ''}
                                    onChange={(e) => setCarriers((p) => ({ ...p, [o.id]: e.target.value }))}
                                />
                                <input
                                    className="ret-note"
                                    placeholder="TRACKING NUMBER"
                                    value={awbs[o.id] || ''}
                                    onChange={(e) => setAwbs((p) => ({ ...p, [o.id]: e.target.value }))}
                                />
                                <button className="ret-btn" disabled={busyId === o.id} onClick={() => fulfil(o)}>
                                    FULFIL &amp; NOTIFY
                                </button>
                            </>
                        )}
                        {o.status !== 'cancelled' && !o.deliveredAt && (
                            <button
                                className="ret-btn"
                                disabled={busyId === o.id || !o.hasShopifyOrder || o.shopifyOrderMissing}
                                onClick={() => markDelivered(o)}
                                title={
                                    o.shopifyOrderMissing
                                        ? 'The Shopify order was deleted — there is nothing to mark'
                                        : !o.hasShopifyOrder
                                            ? 'No Shopify order on this one'
                                            : o.fulfillmentStatus !== 'fulfilled'
                                                ? 'Not fulfilled in Shopify yet — this will be refused'
                                                : ''
                                }
                            >
                                MARK DELIVERED
                            </button>
                        )}
                        <button
                            className="ret-btn ret-btn--ghost"
                            disabled={busyId === o.id}
                            onClick={() => toggleTest(o)}
                            title="Excluded from revenue and conversion"
                        >
                            {o.isTest ? 'NOT A TEST' : 'MARK AS TEST'}
                        </button>
                        {o.shopifyOrderMissing && (
                            <span className="dash-note">SHOPIFY ORDER DELETED</span>
                        )}
                        {!o.shopifyOrderMissing && o.fulfillmentStatus !== 'fulfilled'
                            && o.hasShopifyOrder && !o.deliveredAt && o.status !== 'cancelled' && (
                            <span className="dash-note">FULFIL BEFORE MARKING DELIVERED</span>
                        )}
                    </div>
                </article>
            ))}
        </>
    );
};

export default AdminOrders;
