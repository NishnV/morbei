import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../lib/api';
import { getStatusLabel } from '../utils/orderStatus';

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
        // This starts the customer's return window and emails nobody — but it
        // is a claim about the real world, so it should not be a stray click.
        if (!window.confirm(`Mark order #${order.orderNumber} as delivered?`)) return;
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

    return (
        <>
            {error && <p className="dash-error">{error}</p>}
            {orders && orders.length === 0 && <p className="dash-note">NO ORDERS YET.</p>}

            {orders?.map((o) => (
                <article key={o.id} className="ret-card">
                    <header className="ret-head">
                        <span className="ret-order">#{o.orderNumber || o.id}</span>
                        <span className="ret-product">{o.items.join(', ') || '—'}</span>
                        <span className="ret-status">{getStatusLabel(o)}</span>
                    </header>

                    <dl className="ret-meta">
                        <div><dt>TOTAL</dt><dd>{rs(o.totalPaise)}</dd></div>
                        <div><dt>CUSTOMER</dt><dd>{o.customer || '—'}</dd></div>
                        <div><dt>PLACED</dt><dd>{date(o.createdAt)}</dd></div>
                        <div><dt>SHOPIFY</dt><dd>{o.fulfillmentStatus || 'unfulfilled'}</dd></div>
                        <div><dt>SHIPMENT</dt><dd>{o.shipmentStatus || '—'}</dd></div>
                        {o.trackingNumber && <div><dt>AWB</dt><dd>{o.trackingNumber}</dd></div>}
                        <div><dt>DELIVERED</dt><dd>{date(o.deliveredAt)}</dd></div>
                    </dl>

                    {o.status !== 'cancelled' && !o.deliveredAt && (
                        <div className="ret-actions">
                            <button
                                className="ret-btn"
                                disabled={busyId === o.id || !o.hasShopifyOrder}
                                onClick={() => markDelivered(o)}
                                title={
                                    !o.hasShopifyOrder
                                        ? 'No Shopify order on this one'
                                        : o.fulfillmentStatus !== 'fulfilled'
                                            ? 'Not fulfilled in Shopify yet — this will be refused'
                                            : ''
                                }
                            >
                                MARK DELIVERED
                            </button>
                            {o.fulfillmentStatus !== 'fulfilled' && o.hasShopifyOrder && (
                                <span className="dash-note">FULFIL IN SHOPIFY FIRST</span>
                            )}
                        </div>
                    )}
                </article>
            ))}
        </>
    );
};

export default AdminOrders;
