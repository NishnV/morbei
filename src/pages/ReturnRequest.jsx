import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useCustomer } from '../hooks/useCustomer';
import { returnsAPI, ensureBackendSession } from '../lib/api';
import { uploadFile, MAX_FILES } from '../lib/cloudinary';
import Seo from '../components/Seo';
import './ReturnRequest.css';

/**
 * Return and exchange requests.
 *
 * Two ways in, because customers arrive both ways. Signed in, the shopper
 * picks from their own orders and never types an order number. Signed out —
 * which is every guest, since guest checkout never asks for a password — the
 * order number and the email that placed it stand in for a session.
 */

const REASONS = [
    ['size_fit', 'SIZE/FIT ISSUE'],
    ['damaged', 'RECEIVED A DAMAGED PRODUCT'],
    ['wrong_product', 'RECEIVED THE WRONG PRODUCT'],
    ['quality', 'PRODUCT QUALITY ISSUE'],
    ['not_as_expected', 'PRODUCT LOOKS DIFFERENT FROM EXPECTED'],
    ['other', 'OTHER'],
];

const RESOLUTIONS = [
    ['refund', 'REFUND'],
    ['exchange_size', 'EXCHANGE FOR ANOTHER SIZE'],
    ['exchange_product', 'EXCHANGE FOR ANOTHER PRODUCT'],
];

// The reasons a photograph can settle without the parcel coming back. Kept in
// step with the same list on the server, which is what actually enforces it.
const NEEDS_MEDIA = ['damaged', 'wrong_product', 'quality'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The size run the shop sells. Offered as a plain list rather than the
// product's live variants: the order stores variant ids and no handle, so the
// other sizes of that garment cannot be looked up from the browser. The
// server resolves this to a real variant — and checks stock — when the
// replacement is raised.
const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL'];

const itemLabel = (item) => {
    const opts = (item.options || []).map((o) => o.value).filter(Boolean).join(' / ');
    return opts ? `${item.title} — ${opts}` : item.title;
};

const ReturnRequest = () => {
    const { customer } = useCustomer();

    const [form, setForm] = useState({
        orderNumber: '', fullName: '', email: '', phone: '',
        variantId: '', details: '', comments: '',
    });
    const [reasons, setReasons] = useState([]);
    const [resolution, setResolution] = useState('');
    const [exchangeSize, setExchangeSize] = useState('');
    const [declared, setDeclared] = useState(false);

    const [myOrders, setMyOrders] = useState(null);   // null until we know
    const [order, setOrder] = useState(null);         // the matched order
    const [lookupError, setLookupError] = useState('');
    const [lookingUp, setLookingUp] = useState(false);

    const [media, setMedia] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');

    const [status, setStatus] = useState('idle');     // idle | sending | sent
    const [error, setError] = useState('');

    const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

    // --- Signed in: load their orders instead of asking for a number ---
    useEffect(() => {
        let alive = true;
        (async () => {
            if (!customer) { setMyOrders(null); return; }
            try {
                if (!(await ensureBackendSession())) return;
                const data = await returnsAPI.myOrders();
                if (!alive) return;
                setMyOrders(data.orders || []);
                setForm((p) => ({
                    ...p,
                    email: p.email || data.email || '',
                    fullName: p.fullName || [customer.firstName, customer.lastName].filter(Boolean).join(' '),
                    phone: p.phone || customer.phone || '',
                }));
            } catch {
                // Falls back to the order-number path, which always works.
                if (alive) setMyOrders(null);
            }
        })();
        return () => { alive = false; };
    }, [customer]);

    // --- Signed out: find the order once both fields look complete ---
    const lastLookup = useRef('');
    const lookup = useCallback(async (orderNumber, email) => {
        const key = `${orderNumber}|${email.toLowerCase()}`;
        if (lastLookup.current === key) return;
        lastLookup.current = key;
        setLookingUp(true);
        setLookupError('');
        try {
            const data = await returnsAPI.lookup({ orderNumber, email });
            setOrder(data);
        } catch (err) {
            setOrder(null);
            setLookupError(err.message || 'We could not find an order with those details.');
        } finally {
            setLookingUp(false);
        }
    }, []);

    // Read the two fields out of state rather than destructuring `form` inside
    // the effect: depending on the whole object would re-run this on every
    // keystroke in every other field.
    const { orderNumber: typedOrder, email: typedEmail } = form;
    useEffect(() => {
        if (myOrders) return;                      // signed-in path owns the order
        if (!typedOrder.trim() || !EMAIL_RE.test(typedEmail)) { setOrder(null); return; }
        // Debounced, and keyed, so typing an order number does not spend the
        // lookup budget a digit at a time.
        const t = setTimeout(() => lookup(typedOrder.trim(), typedEmail.trim()), 700);
        return () => clearTimeout(t);
    }, [typedOrder, typedEmail, myOrders, lookup]);

    const chooseOrder = (orderNumber) => {
        const found = (myOrders || []).find((o) => String(o.orderNumber) === String(orderNumber));
        setOrder(found || null);
        setForm((p) => ({ ...p, orderNumber, variantId: '' }));
    };

    const toggleReason = (key) => setReasons((p) => (p.includes(key) ? p.filter((r) => r !== key) : [...p, key]));

    const mediaRequired = reasons.some((r) => NEEDS_MEDIA.includes(r));

    const onFiles = async (e) => {
        const files = [...e.target.files].slice(0, MAX_FILES - media.length);
        e.target.value = '';
        if (!files.length) return;
        setUploading(true);
        setUploadError('');
        try {
            const urls = [];
            // The same pair the lookup used. The server re-checks it before
            // signing, so this is a claim rather than a credential.
            const proof = { orderNumber: typedOrder.trim(), email: typedEmail.trim() };
            for (const f of files) urls.push(await uploadFile(f, proof));
            setMedia((p) => [...p, ...urls]);
        } catch (err) {
            setUploadError(err.message || 'Upload failed.');
        } finally {
            setUploading(false);
        }
    };

    const items = order?.items || [];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!order) return setError('Please find your order first.');
        if (!form.variantId) return setError('Please choose the product you are returning.');
        if (!reasons.length) return setError('Please choose a reason for the return.');
        if (!resolution) return setError('Please choose a refund or an exchange.');
        if (resolution === 'exchange_size' && !exchangeSize) {
            return setError('Please choose the size you would like instead.');
        }
        if (mediaRequired && media.length === 0) {
            return setError('Please upload a photo or video showing the issue.');
        }
        if (!declared) return setError('Please confirm the declaration.');

        setStatus('sending');
        try {
            await returnsAPI.submit({
                orderNumber: form.orderNumber,
                email: form.email,
                fullName: form.fullName,
                phone: form.phone,
                variantId: form.variantId,
                reasons,
                details: form.details,
                resolution,
                exchangeSize,
                comments: form.comments,
                media,
                declaration: true,
            });
            setStatus('sent');
        } catch (err) {
            setStatus('idle');
            setError(err.message || 'Something went wrong. Please try again.');
        }
    };

    if (status === 'sent') {
        return (
            <div className="rr-page">
                <Seo title="RETURN REQUEST | MORBEI" description="Request a return or exchange." noindex />
                <div className="rr-head">
                    <h1 className="rr-title">RETURN REQUEST</h1>
                    <div className="rr-rule" />
                </div>
                <div className="rr-body">
                    <h2 className="rr-section-title">REQUEST RECEIVED</h2>
                    <p className="rr-intro">
                        Thank you. Our team will review your request and be in touch within 24 hours.
                    </p>
                    <Link className="rr-submit rr-submit--link" to="/shop/all">CONTINUE SHOPPING</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="rr-page">
            <Seo title="RETURN REQUEST | MORBEI" description="Request a return or exchange." noindex />

            <div className="rr-head">
                <h1 className="rr-title">RETURN REQUEST</h1>
                <div className="rr-rule" />
            </div>

            <form className="rr-body" onSubmit={handleSubmit}>
                <h2 className="rr-section-title">START A RETURN</h2>
                <p className="rr-intro">
                    We're sorry your order didn't work out. Please fill in the details below and our
                    team will review and process your request within 24 hours.
                </p>

                <h3 className="rr-group">ORDER DETAILS</h3>

                {myOrders ? (
                    <label className="rr-field">
                        <span>ORDER*</span>
                        <select value={form.orderNumber} onChange={(e) => chooseOrder(e.target.value)} required>
                            <option value="">SELECT YOUR ORDER</option>
                            {myOrders.map((o) => (
                                <option key={o.orderNumber} value={o.orderNumber}>
                                    #{o.orderNumber} — {new Date(o.placedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : (
                    <>
                        <label className="rr-field">
                            <span>ORDER NUMBER*</span>
                            <input value={form.orderNumber} onChange={set('orderNumber')} required />
                        </label>
                        <label className="rr-field">
                            <span>EMAIL*</span>
                            <input type="email" value={form.email} onChange={set('email')} required />
                        </label>
                        {lookingUp && <p className="rr-note">FINDING YOUR ORDER…</p>}
                        {lookupError && <p className="rr-error">{lookupError}</p>}
                        {order && <p className="rr-note rr-note--ok">ORDER #{order.orderNumber} FOUND</p>}
                    </>
                )}

                <label className="rr-field">
                    <span>FULL NAME*</span>
                    <input value={form.fullName} onChange={set('fullName')} required />
                </label>
                {myOrders && (
                    <label className="rr-field">
                        <span>EMAIL*</span>
                        <input type="email" value={form.email} onChange={set('email')} required />
                    </label>
                )}
                <label className="rr-field">
                    <span>PHONE NUMBER*</span>
                    <input value={form.phone} onChange={set('phone')} required />
                </label>

                <h3 className="rr-group">PRODUCT DETAILS</h3>

                <label className="rr-field">
                    <span>PRODUCT NAME*</span>
                    <select
                        value={form.variantId}
                        onChange={set('variantId')}
                        disabled={!items.length}
                        required
                    >
                        <option value="">{items.length ? 'SELECT THE PRODUCT' : 'FIND YOUR ORDER FIRST'}</option>
                        {items.map((i) => (
                            <option key={i.variantId} value={i.variantId} disabled={i.alreadyRequested}>
                                {itemLabel(i)}{i.alreadyRequested ? ' — ALREADY REQUESTED' : ''}
                            </option>
                        ))}
                    </select>
                </label>

                {order && !order.eligible && (
                    <p className="rr-note rr-note--warn">
                        This order was delivered {order.daysSinceDelivery} days ago, outside our 7-day
                        window. You can still submit — our team will review it.
                    </p>
                )}

                <fieldset className="rr-choices">
                    <legend>REASON FOR RETURN*</legend>
                    {REASONS.map(([key, label]) => (
                        <label key={key} className="rr-choice">
                            <input type="checkbox" checked={reasons.includes(key)} onChange={() => toggleReason(key)} />
                            <span>{label}</span>
                        </label>
                    ))}
                </fieldset>

                <label className="rr-field rr-field--area">
                    <span>TELL US MORE</span>
                    <textarea rows={4} value={form.details} onChange={set('details')} />
                </label>

                <div className="rr-field rr-field--area">
                    <span className="rr-label">UPLOAD PHOTOS / VIDEOS{mediaRequired ? '*' : ''}</span>
                    <p className="rr-help">
                        If your return is related to a damaged, defective, stained or incorrect
                        product, please upload clear photos or a short video showing the issue.
                    </p>
                    {order?.uploadsEnabled ? (
                        <>
                            <label className="rr-upload">
                                <input type="file" accept="image/*,video/*" multiple onChange={onFiles} disabled={uploading || media.length >= MAX_FILES} />
                                <span>{uploading ? 'UPLOADING…' : media.length ? 'ADD ANOTHER' : 'CHOOSE FILES'}</span>
                            </label>
                            {media.length > 0 && (
                                <ul className="rr-media">
                                    {media.map((url, i) => (
                                        <li key={url}>
                                            <span>FILE {i + 1}</span>
                                            <button type="button" onClick={() => setMedia((p) => p.filter((u) => u !== url))}>REMOVE</button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    ) : (
                        <p className="rr-note rr-note--warn">
                            Uploads are not configured yet. Submit the request and our team will ask
                            for photographs by email.
                        </p>
                    )}
                    {uploadError && <p className="rr-error">{uploadError}</p>}
                </div>

                <fieldset className="rr-choices">
                    <legend>WHAT WOULD YOU LIKE?*</legend>
                    {RESOLUTIONS.map(([key, label]) => (
                        <label key={key} className="rr-choice">
                            <input type="radio" name="resolution" checked={resolution === key} onChange={() => setResolution(key)} />
                            <span>{label}</span>
                        </label>
                    ))}
                </fieldset>

                {resolution === 'exchange_size' && (
                    <label className="rr-field">
                        <span>WHICH SIZE WOULD YOU LIKE?*</span>
                        <select value={exchangeSize} onChange={(e) => setExchangeSize(e.target.value)} required>
                            <option value="">SELECT A SIZE</option>
                            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                )}

                {resolution === 'exchange_product' && (
                    <p className="rr-note">
                        TELL US WHICH PRODUCT YOU WOULD LIKE IN THE COMMENTS BELOW.
                    </p>
                )}

                <label className="rr-field rr-field--area">
                    <span>ADDITIONAL COMMENTS</span>
                    <textarea rows={4} value={form.comments} onChange={set('comments')} />
                </label>

                <label className="rr-choice rr-declaration">
                    <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
                    <span>
                        I hereby declare that the product being returned is unused, unworn, and in its
                        original condition, with all original tags, labels, and packaging intact. I
                        confirm that the information provided is true and accurate.
                    </span>
                </label>

                {error && <p className="rr-error">{error}</p>}

                <button className="rr-submit" type="submit" disabled={status === 'sending' || uploading}>
                    {status === 'sending' ? 'SENDING…' : 'SUBMIT RETURN REQUEST'}
                </button>
            </form>
        </div>
    );
};

export default ReturnRequest;
