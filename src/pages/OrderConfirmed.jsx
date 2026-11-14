import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { useCustomer } from '../hooks/useCustomer';
import { track } from '../lib/analytics';
import './Checkout.css';
import '../styles/verify.css';
import { forgetPendingOrder } from '../lib/pendingOrder';
import { authAPI } from '../lib/api';
import { getDeliveryOption, deliveryWindow } from '../data/delivery';

const rs = (n) => `RS. ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const OrderConfirmed = () => {
    const location = useLocation();
    const { clearCart } = useCart();
    const { customer, signUp } = useCustomer();
    const order = location.state?.order;

    /**
     * Turning the guest who just paid into an account holder.
     *
     * The moment after an order is placed is the only one where an account is
     * obviously worth having — it is where they will come back to look for
     * tracking — and it is also the one moment where we already know
     * everything a signup form would ask for. Their name, email and phone are
     * on the order in front of them, so asking for them again is asking a
     * customer to type what we are already showing them.
     *
     * So this takes a password and nothing else.
     *
     * Usually it needs no verification code either. A guest who entered a
     * code at checkout holds the proof of it in this tab, and signup sends
     * that along. A returning guest was not asked for a code this time — the
     * server remembers their address can receive mail — so they hold no
     * proof, and are asked for one here: an account is the whole address,
     * and has to be opened by whoever can read its inbox.
     */
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    const [accountError, setAccountError] = useState('');
    const [created, setCreated] = useState(false);
    const [codeFor, setCodeFor] = useState(null);   // the address awaiting a code
    const [code, setCode] = useState('');

    // The cart is cleared here rather than in Checkout: clearing it while still
    // on /checkout trips RequireCart, which redirects to /cart before the
    // confirmation page can load. By the time we're here the order is placed,
    // so it's safe to empty the cart.
    // Purchase: the event the ad algorithm actually needs. eventID is the order
    // number so a refresh, a back-button return or Meta's own retry all collapse
    // to one purchase instead of inflating the conversion count.
    useEffect(() => {
        if (!order?.orderNumber) return;
        const key = `morbei_purchase_tracked_${order.orderNumber}`;
        try {
            if (localStorage.getItem(key)) return;
            localStorage.setItem(key, '1');
        } catch { /* private mode — a duplicate is better than a missing sale */ }
        track('Purchase', {
            // order.total is the rupee amount the customer actually paid —
            // the one number Meta needs to report ROAS.
            value: Number(order.total) || undefined,
            currency: 'INR',
            content_type: 'product',
            // Cart lines carry a Shopify variant id, not a handle.
            content_ids: (order.items || []).map((i) => i.variantId).filter(Boolean),
            num_items: (order.items || []).reduce((n, i) => n + (i.quantity || 1), 0),
        }, { eventID: `order-${order.orderNumber}` });
    }, [order]);

    useEffect(() => {
        if (!order) return;
        if (clearCart) clearCart();
        // A confirmation has now been shown, so the recovery marker has done
        // its job — otherwise the next load would try to show this again.
        forgetPendingOrder();
    }, [order, clearCart]);

    // Reached without an order in state (refresh, direct visit, back button) —
    // there's nothing to confirm, so send them to their order history.
    if (!order) {
        return <Navigate to="/order-details" replace />;
    }

    const addr = order.shippingAddress || {};

    const createAccount = async (e) => {
        e.preventDefault();
        setAccountError('');
        if (password.length < 8) {
            setAccountError('Please choose a password of at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            setAccountError('Those two passwords are not the same.');
            return;
        }
        setBusy(true);
        try {
            await register();
        } catch (err) {
            if (err?.status === 428) {
                // No proof held for this address in this tab. Send a code
                // and ask for it here, rather than sending them away to the
                // sign-up page to type everything again.
                await sendSignupCode();
            } else {
                setAccountError(registerError(err));
            }
        } finally {
            setBusy(false);
        }
    };

    // Everything but the password comes off the order they are looking at.
    // signUp creates the Shopify customer through our server — which is what
    // keeps Shopify's own welcome email from going out — and then signs them
    // in, which is what sends ours.
    const register = async () => {
        await signUp({
            email: addr.email,
            password,
            firstName: addr.firstName,
            lastName: addr.lastName,
            phone: addr.phone || undefined,
        });
        setCreated(true);
    };

    const registerError = (err) => {
        if (err?.status === 409 || err?.message === 'accountExists') {
            return 'An account already exists with this email — sign in instead.';
        }
        if (err?.status === 428) return 'Please confirm your email to finish creating your account.';
        return err?.message || 'Could not create your account.';
    };

    const sendSignupCode = async () => {
        setAccountError('');
        try {
            await authAPI.sendCode(addr.email, 'signup');
            setCodeFor(addr.email);
        } catch (err) {
            setAccountError(err?.message || 'Could not send the code. Please try again.');
        }
    };

    const confirmCode = async (e) => {
        e.preventDefault();
        setAccountError('');
        if (!/^[0-9]{6}$/.test(code.trim())) {
            setAccountError('Enter the six digits from the email.');
            return;
        }
        setBusy(true);
        try {
            await authAPI.verifyEmail(codeFor, code.trim(), 'signup');
            setCodeFor(null);
            setCode('');
            await register();
        } catch (err) {
            setAccountError(err?.status === 428 || err?.status === 409
                ? registerError(err)
                : (err?.message || 'That code is not right.'));
        } finally {
            setBusy(false);
        }
    };

    const items = order.items || [];
    const deliveryLabel = order.deliveryMethod === 'priority' ? 'PRIORITY' : 'STANDARD';

    return (
        <div className="order-details-page order-confirmed-page">
            <div className="order-details-container order-confirmed-container">
                {/* Confirmation header */}
                <div className="order-confirmed-hero reveal reveal-up">
                    <span className="order-confirmed-eyebrow">ORDER PLACED</span>
                    <h1 className="order-confirmed-title">THANK YOU</h1>
                    <p className="order-confirmed-note">
                        YOUR ORDER HAS BEEN CONFIRMED. A CONFIRMATION HAS BEEN SENT TO
                        {addr.email ? ` ${addr.email.toUpperCase()}` : ' YOUR EMAIL'}.
                    </p>
                    <span className="order-confirmed-number">
                        ORDER NO. {order.orderNumber || order.orderId}
                    </span>
                </div>

                <div className="order-confirmed-grid">
                    {/* Order summary */}
                    <section className="order-confirmed-summary reveal reveal-up">
                        <h2 className="order-confirmed-heading">ORDER SUMMARY</h2>
                        <div className="order-confirmed-items">
                            {items.map((item, idx) => (
                                <div key={idx} className="order-confirmed-item">
                                    <img
                                        src={item.image || '/placeholder.png'}
                                        alt={item.title}
                                        className="order-item-img"
                                    />
                                    <div className="order-item-texts">
                                        <h3 className="order-item-name">{item.title}</h3>
                                        {item.selectedOptions && item.selectedOptions.length > 0 && (
                                            <span className="order-item-sub">
                                                {item.selectedOptions.map(o => o.value).join(' | ')}
                                            </span>
                                        )}
                                        <span className="order-item-sub">QTY {item.quantity}</span>
                                    </div>
                                    <span className="order-confirmed-item-price">
                                        {rs(item.price * item.quantity)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Totals */}
                        <div className="order-confirmed-totals">
                            <div className="order-confirmed-total-row">
                                <span>SUBTOTAL</span>
                                <span>{rs(order.subtotal)}</span>
                            </div>
                            <div className="order-confirmed-total-row">
                                <span>SHIPPING</span>
                                <span>{order.shippingCost > 0 ? rs(order.shippingCost) : 'FREE'}</span>
                            </div>
                            <div className="order-confirmed-total-row order-confirmed-total-row--grand">
                                <span>TOTAL</span>
                                <span>{rs(order.total)}</span>
                            </div>
                        </div>
                    </section>

                    {/* Shipping + delivery */}
                    <aside className="order-confirmed-aside reveal reveal-up">
                        <div className="order-confirmed-panel">
                            <h2 className="order-confirmed-heading">SHIPPING TO</h2>
                            <div className="address-details">
                                <strong>{addr.firstName} {addr.lastName}</strong>
                                <p>{addr.address}</p>
                                <p>{addr.state} {addr.zip}</p>
                                <p>{addr.country}</p>
                                {addr.phone && <p>{addr.phone}</p>}
                                {addr.email && <p style={{ textTransform: 'lowercase' }}>{addr.email}</p>}
                            </div>
                        </div>

                        <div className="order-confirmed-panel">
                            <h2 className="order-confirmed-heading">DELIVERY</h2>
                            <div className="address-details">
                                <strong>{deliveryLabel}</strong>
                                {/* By the option they paid for. This said 7–14 days
                                    whatever was chosen, including to a customer who
                                    had just paid for 3–5. */}
                                <p>ESTIMATED {deliveryWindow(getDeliveryOption(order.deliveryMethod)).toUpperCase()}</p>
                            </div>
                        </div>
                    </aside>
                </div>

                {/* Offered to a guest only. `|| created` keeps the panel on
                    screen after signing in, which sets `customer` — without it
                    the confirmation they just earned vanishes mid-sentence. */}
                {(!customer || created) && (
                    <section className="oc-account reveal reveal-up">
                        {created ? (
                            <>
                                <h2 className="order-confirmed-heading">ACCOUNT CREATED</h2>
                                <p className="oc-account-note">
                                    You are signed in. This order is in your order history, and
                                    we have sent a welcome email to{' '}
                                    <span className="oc-account-email">{addr.email}</span>.
                                </p>
                            </>
                        ) : codeFor ? (
                            <>
                                <h2 className="order-confirmed-heading">CONFIRM YOUR EMAIL</h2>
                                <p className="oc-account-note">
                                    We sent a six-digit code to{' '}
                                    <span className="oc-account-email">{codeFor}</span>. Enter it
                                    to finish creating your account.
                                </p>
                                <form className="oc-account-form" onSubmit={confirmCode}>
                                    <label className="visually-hidden" htmlFor="oc-code">Six-digit code</label>
                                    <input
                                        id="oc-code"
                                        className="checkout-input-v3 co-verify-input"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                                        placeholder="6-DIGIT CODE"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        autoFocus
                                    />
                                    <button type="submit" className="co-verify-btn" disabled={busy}>
                                        {busy ? 'CHECKING…' : 'CONFIRM'}
                                    </button>
                                    <button type="button" className="co-verify-link" disabled={busy} onClick={sendSignupCode}>
                                        SEND IT AGAIN
                                    </button>
                                </form>
                                {accountError && <p className="co-verify-err">{accountError}</p>}
                            </>
                        ) : (
                            <>
                                <h2 className="order-confirmed-heading">SAVE YOUR DETAILS</h2>
                                <p className="oc-account-note">
                                    Choose a password and this order, your address and your
                                    wishlist are kept for next time. We already have the rest
                                    from this order{addr.email ? <> — <span className="oc-account-email">{addr.email}</span></> : null}.
                                </p>
                                <form className="oc-account-form" onSubmit={createAccount}>
                                    <label className="visually-hidden" htmlFor="oc-pw">Password</label>
                                    <input
                                        id="oc-pw"
                                        className="checkout-input-v3"
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder="PASSWORD"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                    <label className="visually-hidden" htmlFor="oc-pw2">Confirm password</label>
                                    <input
                                        id="oc-pw2"
                                        className="checkout-input-v3"
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder="CONFIRM PASSWORD"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                    />
                                    <button type="submit" className="co-verify-btn" disabled={busy}>
                                        {busy ? 'CREATING…' : 'CREATE ACCOUNT'}
                                    </button>
                                </form>
                                {accountError && <p className="co-verify-err">{accountError}</p>}
                            </>
                        )}
                    </section>
                )}

                {/* Actions */}
                <div className="order-confirmed-actions reveal reveal-up">
                    <Link to="/order-details" className="checkout-next-btn">VIEW ORDER</Link>
                    <Link to="/shop/all" className="go-back-link">CONTINUE SHOPPING</Link>
                </div>
            </div>
        </div>
    );
};

export default OrderConfirmed;
