import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI } from '../lib/api';

/**
 * The returns queue.
 *
 * Refund is a separate press from approve, and only becomes available once a
 * return is approved. Approving tells the customer to send the item back;
 * the money should move when it arrives, which is what the policy promises.
 * One button doing both would make a single click a decision and a payment.
 */

const REASON_LABELS = {
    size_fit: 'Size / fit',
    damaged: 'Damaged',
    wrong_product: 'Wrong product',
    quality: 'Quality',
    not_as_expected: 'Not as expected',
    other: 'Other',
};

const RESOLUTION_LABELS = {
    refund: 'Refund',
    exchange_size: 'Exchange — size',
    exchange_product: 'Exchange — product',
};

const TABS = [
    ['requested', 'NEW'],
    ['approved', 'APPROVED'],
    ['refunded', 'REFUNDED'],
    ['exchanged', 'EXCHANGED'],
    ['rejected', 'REJECTED'],
    ['', 'ALL'],
];

const rs = (paise) => (paise == null ? '—' : `RS. ${Math.round(paise / 100).toLocaleString('en-IN')}`);

const AdminReturns = ({ token }) => {
    const [status, setStatus] = useState('requested');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [notes, setNotes] = useState({});
    // Only needed for an exchange of a different product, where the customer
    // described what they want in words and a person has to resolve it.
    const [variantIds, setVariantIds] = useState({});

    const load = useCallback(async () => {
        setError('');
        try {
            setData(await adminAPI.returns(token, status));
        } catch (err) {
            setError(err.message);
        }
    }, [token, status]);

    useEffect(() => { load(); }, [load]);

    const act = async (id, action) => {
        // Money leaving the account should not be one unguarded click.
        if (action === 'refund' && !window.confirm('Issue this refund to the customer now?')) return;
        if (action === 'exchange' && !window.confirm('Raise a free replacement order in Shopify now?')) return;
        setBusyId(id);
        setError('');
        try {
            await adminAPI.act(token, id, action, notes[id] || '', variantIds[id] || undefined);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    const counts = data?.counts || {};

    return (
        <>
            <div className="dash-range dash-range--tabs">
                {TABS.map(([key, label]) => (
                    <button
                        key={label}
                        className={`dash-range-btn${status === key ? ' is-active' : ''}`}
                        onClick={() => setStatus(key)}
                    >
                        {label}{counts[key] ? ` ${counts[key]}` : ''}
                    </button>
                ))}
            </div>

            {error && <p className="dash-error">{error}</p>}
            {data && data.returns.length === 0 && <p className="dash-note">NOTHING HERE.</p>}

            {data?.returns.map((r) => (
                <article key={r.id} className="ret-card">
                    <header className="ret-head">
                        <span className="ret-order">#{r.orderNumber}</span>
                        <span className="ret-product">{r.product}</span>
                        <span className={`ret-status ret-status--${r.status}`}>{r.status.toUpperCase()}</span>
                    </header>

                    <dl className="ret-meta">
                        <div><dt>WANTS</dt><dd>{RESOLUTION_LABELS[r.resolution] || r.resolution}</dd></div>
                        <div><dt>REASON</dt><dd>{r.reasons.map((x) => REASON_LABELS[x] || x).join(', ')}</dd></div>
                        {r.exchangeSize && <div><dt>WANTS SIZE</dt><dd>{r.exchangeSize}</dd></div>}
                        {r.replacementOrderNumber && <div><dt>REPLACEMENT</dt><dd>#{r.replacementOrderNumber}</dd></div>}
                        <div><dt>REFUNDABLE</dt><dd>{rs(r.refundablePaise)}</dd></div>
                        <div><dt>FROM</dt><dd>{r.fullName} · {r.email} · {r.phone}</dd></div>
                        <div><dt>RAISED</dt><dd>{new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</dd></div>
                    </dl>

                    {r.details && <p className="ret-text">“{r.details}”</p>}
                    {r.comments && <p className="ret-text ret-text--dim">{r.comments}</p>}

                    {r.media.length > 0 && (
                        <div className="ret-media">
                            {r.media.map((url, i) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer">FILE {i + 1}</a>
                            ))}
                        </div>
                    )}

                    {r.adminNote && <p className="ret-text ret-text--dim">NOTE: {r.adminNote}</p>}

                    {(r.status === 'requested' || r.status === 'approved') && (
                        <div className="ret-actions">
                            <input
                                className="ret-note"
                                placeholder="NOTE (OPTIONAL)"
                                value={notes[r.id] || ''}
                                onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                            />
                            {r.status === 'requested' && (
                                <>
                                    <button className="ret-btn" disabled={busyId === r.id} onClick={() => act(r.id, 'approve')}>APPROVE</button>
                                    <button className="ret-btn ret-btn--ghost" disabled={busyId === r.id} onClick={() => act(r.id, 'reject')}>REJECT</button>
                                </>
                            )}
                            {r.status === 'approved' && r.resolution?.startsWith('exchange') && (
                                <>
                                    {r.resolution === 'exchange_product' && (
                                        <input
                                            className="ret-note"
                                            placeholder="SHOPIFY VARIANT ID"
                                            value={variantIds[r.id] || ''}
                                            onChange={(e) => setVariantIds((p) => ({ ...p, [r.id]: e.target.value }))}
                                        />
                                    )}
                                    <button className="ret-btn" disabled={busyId === r.id} onClick={() => act(r.id, 'exchange')}>
                                        SEND {r.exchangeSize ? `SIZE ${r.exchangeSize}` : 'REPLACEMENT'}
                                    </button>
                                </>
                            )}
                            {r.status === 'approved' && (
                                <button
                                    className={`ret-btn${r.resolution?.startsWith('exchange') ? ' ret-btn--ghost' : ''}`}
                                    disabled={busyId === r.id || !r.refundable || !r.refundablePaise}
                                    onClick={() => act(r.id, 'refund')}
                                    title={!r.refundable ? 'No captured payment on this order' : ''}
                                >
                                    REFUND {rs(r.refundablePaise)}
                                </button>
                            )}
                        </div>
                    )}
                </article>
            ))}
        </>
    );
};

export default AdminReturns;
