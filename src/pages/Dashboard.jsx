import React, { useEffect, useState, useCallback } from 'react';
import './Dashboard.css';

/**
 * Funnel dashboard.
 *
 * Deliberately unlinked from the site — reachable only by typing /dashboard —
 * and gated on a token the server checks. It shows business numbers, so the
 * absence of a link is convenience, not the security; the server refuses
 * without the token and refuses outright if no token is configured.
 *
 * Why this exists next to Meta's Events Manager: these numbers arrive at our
 * own domain, so they are not thinned out by tracking prevention and ad
 * blockers the way the Meta copy is, and Purchase is read from the orders
 * table rather than from a beacon. Where the two disagree, this one is closer.
 */

const API = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'morbei_dashboard_token';

const pct = (n) => `${n.toFixed ? n.toFixed(2) : n}%`;
const titleise = (handle) => String(handle || '').replace(/-/g, ' ').toUpperCase();
const rs = (n) => `RS. ${Number(n || 0).toLocaleString('en-IN')}`;

const Dashboard = () => {
    const [token, setToken] = useState(() => {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
    });
    const [input, setInput] = useState('');
    const [days, setDays] = useState(7);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const load = useCallback(async (t, d) => {
        if (!t) return;
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`${API}/dashboard/funnel?days=${d}`, { headers: { 'x-dashboard-token': t } });
            if (res.status === 401) throw new Error('That token was not accepted.');
            if (res.status === 503) throw new Error('ADMIN_DASHBOARD_TOKEN is not set on the server.');
            if (!res.ok) throw new Error('Could not load the funnel.');
            setData(await res.json());
        } catch (err) {
            setError(err.message);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(token, days); }, [token, days, load]);

    if (!token) {
        return (
            <div className="dash-page">
                <form
                    className="dash-gate"
                    onSubmit={(e) => {
                        e.preventDefault();
                        try { localStorage.setItem(TOKEN_KEY, input.trim()); } catch { /* ignore */ }
                        setToken(input.trim());
                    }}
                >
                    <h1 className="dash-title">FUNNEL</h1>
                    <input
                        className="dash-input"
                        type="password"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="DASHBOARD TOKEN"
                        autoFocus
                    />
                    <button className="dash-btn" type="submit">VIEW</button>
                    {error && <p className="dash-error">{error}</p>}
                </form>
            </div>
        );
    }

    // Sessions first, then each step as a share of the one above it. A single
    // conversion rate hides which step is losing people, which is the only
    // thing this dashboard is for.
    const steps = data ? [
        { label: 'Sessions', value: data.sessions, note: 'browsing sessions' },
        { label: 'Visitors', value: data.visitors, note: 'distinct devices' },
        { label: 'Viewed a product', value: data.viewContentSessions, rate: data.stepConversion.sessionToProduct, note: 'of sessions' },
        { label: 'Added to bag', value: data.addToCartSessions, rate: data.stepConversion.productToCart, note: 'of those who viewed' },
        { label: 'Started checkout', value: data.initiateCheckoutSessions, rate: data.stepConversion.cartToCheckout, note: 'of those who added' },
        { label: 'Purchased', value: data.purchases, rate: data.stepConversion.checkoutToPurchase, note: 'of those who started' },
    ] : [];

    return (
        <div className="dash-page">
            <div className="dash-head">
                <h1 className="dash-title">FUNNEL</h1>
                <div className="dash-range">
                    {[7, 30, 90].map((d) => (
                        <button
                            key={d}
                            className={`dash-range-btn${days === d ? ' is-active' : ''}`}
                            onClick={() => setDays(d)}
                        >{d}D</button>
                    ))}
                </div>
            </div>

            {loading && <p className="dash-note">LOADING…</p>}
            {error && <p className="dash-error">{error}</p>}

            {data && (
                <>
                    <div className="dash-headline">
                        <div className="dash-stat">
                            <span className="dash-stat-value">{pct(data.purchaseConversionRate)}</span>
                            <span className="dash-stat-label">PURCHASE CONVERSION<br />(of sessions)</span>
                        </div>
                        <div className="dash-stat">
                            <span className="dash-stat-value">{data.purchases}</span>
                            <span className="dash-stat-label">ORDERS</span>
                        </div>
                        <div className="dash-stat">
                            <span className="dash-stat-value">{rs(data.revenueRupees)}</span>
                            <span className="dash-stat-label">REVENUE</span>
                        </div>
                    </div>

                    <table className="dash-table">
                        <tbody>
                            {steps.map((s) => (
                                <tr key={s.label}>
                                    <td className="dash-step">{s.label}</td>
                                    <td className="dash-count">{s.value.toLocaleString('en-IN')}</td>
                                    <td className="dash-rate">
                                        {s.rate !== undefined && (
                                            <>
                                                <span className="dash-rate-value">{pct(s.rate)}</span>
                                                <span className="dash-rate-note"> {s.note}</span>
                                            </>
                                        )}
                                        {s.rate === undefined && <span className="dash-rate-note">{s.note}</span>}
                                    </td>
                                    <td className="dash-bar-cell">
                                        <span
                                            className="dash-bar"
                                            style={{ width: `${data.sessions ? Math.min(100, (s.value / data.sessions) * 100) : 0}%` }}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <p className="dash-note">
                        Purchases and revenue come from the orders table, so they are exact.
                        The steps above them are browser events and will read low wherever a
                        tracker was blocked.
                    </p>

                    {data.products?.length > 0 && (
                        <>
                            <h2 className="dash-subtitle">BY PRODUCT</h2>
                            <table className="dash-table">
                                <thead>
                                    <tr><th>PRODUCT</th><th>VIEWS</th><th>BAG</th><th>RATE</th><th></th></tr>
                                </thead>
                                <tbody>
                                    {data.products.map((p) => (
                                        <tr key={p.handle}>
                                            <td className="dash-step">{titleise(p.handle)}</td>
                                            <td className="dash-count">{p.views}</td>
                                            <td className="dash-count">{p.adds}</td>
                                            <td className="dash-rate">
                                                <span className={p.adds > 0 ? 'dash-rate-value' : 'dash-rate-note'}>{pct(p.addRate)}</span>
                                            </td>
                                            <td className="dash-bar-cell">
                                                <span
                                                    className="dash-bar"
                                                    style={{ width: `${data.products[0].views ? (p.views / data.products[0].views) * 100 : 0}%` }}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="dash-note">
                                Views are product-page opens; bag is adds from anywhere — the
                                product page, the shop grid or the wishlist. A product with
                                views and no adds is telling you something different from one
                                nobody opens at all.
                            </p>
                        </>
                    )}

                    {data.daily?.length > 0 && (
                        <h2 className="dash-subtitle">BY DAY</h2>
                    )}
                    {data.daily?.length > 0 && (
                        <table className="dash-table dash-table--daily">
                            <thead>
                                <tr><th>DAY</th><th>SESSIONS</th><th>PRODUCT</th><th>BAG</th><th>CHECKOUT</th></tr>
                            </thead>
                            <tbody>
                                {data.daily.map((d) => (
                                    <tr key={d.day}>
                                        <td className="dash-step">{new Date(d.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                                        <td className="dash-count">{d.sessions}</td>
                                        <td className="dash-count">{d.view_content}</td>
                                        <td className="dash-count">{d.add_to_cart}</td>
                                        <td className="dash-count">{d.initiate_checkout}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    <button
                        className="dash-signout"
                        onClick={() => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } setToken(''); }}
                    >FORGET TOKEN</button>
                </>
            )}
        </div>
    );
};

export default Dashboard;
