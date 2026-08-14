import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { useCustomer } from '../hooks/useCustomer';
import { formatPrice } from '../utils/formatPrice';
import { paymentAPI, authAPI, setToken } from '../lib/api';
import { SHIPPABLE_COUNTRIES, getStatesForCountry } from '../data/countries';
import { DELIVERY_OPTIONS, getDeliveryOption, deliveryWindow } from '../data/delivery';
import './Checkout.css';

const STEPS = ['INFORMATION', 'DELIVERY', 'PAYMENT'];

// Every field the information step requires — later steps are gated on these
const REQUIRED_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'address', 'city', 'state', 'zip'];
const isFormComplete = (f) =>
    !!f && REQUIRED_FIELDS.every(k => typeof f[k] === 'string' && f[k].trim());

function loadRazorpayScript() {
    return new Promise((resolve) => {
        if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
            return resolve(true);
        }
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
    });
}

const Checkout = () => {
    const { cart, loading: cartLoading } = useCart();
    const { customer } = useCustomer();
    const navigate = useNavigate();

    const lines = cart?.lines || [];
    const cost = cart?.cost;
    const totalFormatted = cost?.totalAmount ? formatPrice(cost.totalAmount) : '—';
    const cartCount = lines.reduce((sum, l) => sum + l.quantity, 0);

    // /checkout/payment (used by the payment-failed page's TRY AGAIN) jumps
    // straight to the payment step — only when the saved form from the earlier
    // attempt is actually complete (the key alone proves nothing: an empty form
    // is saved the moment checkout mounts), otherwise start at information.
    const { step: stepParam } = useParams();
    const [currentStep, setCurrentStep] = useState(() => {
        if (stepParam !== 'payment') return 0;
        try {
            const saved = JSON.parse(sessionStorage.getItem('morbei_checkout_form') || 'null');
            return isFormComplete(saved) ? 2 : 0;
        } catch {
            return 0;
        }
    });
    const [deliveryMethod, setDeliveryMethod] = useState(() =>
        sessionStorage.getItem('morbei_checkout_delivery') || 'standard'
    );
    const [paying, setPaying] = useState(false);
    const [validationError, setValidationError] = useState('');
    const [paymentError, setPaymentError] = useState('');


    const defaultAddr = customer?.addresses?.[0] || customer?.defaultAddress;

    const [form, setForm] = useState(() => {
        // A failed payment shouldn't cost the user their filled-in address —
        // restore the form from this tab's session if present.
        try {
            const saved = JSON.parse(sessionStorage.getItem('morbei_checkout_form') || 'null');
            if (saved && typeof saved === 'object' && saved.address) return saved;
        } catch { /* corrupted — fall through to defaults */ }
        return {
            firstName: customer?.firstName || '',
            lastName: customer?.lastName || '',
            phone: customer?.phone || '',
            email: customer?.email || '',
            country: defaultAddr?.country || 'India',
            state: defaultAddr?.province || '',
            address: defaultAddr?.address1 || '',
            city: defaultAddr?.city || '',
            zip: defaultAddr?.zip || '',
        };
    });

    useEffect(() => {
        try {
            sessionStorage.setItem('morbei_checkout_form', JSON.stringify(form));
            sessionStorage.setItem('morbei_checkout_delivery', deliveryMethod);
        } catch { /* storage full/blocked — non-critical */ }
    }, [form, deliveryMethod]);

    const handleForm = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const validateStep0 = () => {
        if (!form.firstName.trim()) {
            setValidationError('PLEASE ENTER FIRST NAME');
            return false;
        }
        if (!form.lastName.trim()) {
            setValidationError('PLEASE ENTER LAST NAME');
            return false;
        }
        if (!form.phone.trim()) {
            setValidationError('PLEASE ENTER MOBILE NUMBER');
            return false;
        }
        if (!form.email.trim()) {
            setValidationError('PLEASE ENTER EMAIL');
            return false;
        }
        if (!form.address.trim()) {
            setValidationError('PLEASE ENTER ADDRESS');
            return false;
        }
        if (!form.city.trim()) {
            setValidationError('PLEASE ENTER CITY');
            return false;
        }
        if (!form.state.trim()) {
            setValidationError('PLEASE SELECT STATE / PROVINCE');
            return false;
        }
        if (!form.zip.trim()) {
            setValidationError('PLEASE ENTER PIN CODE');
            return false;
        }
        // Mirror the server's checks so the customer is corrected here rather
        // than after they've committed to paying.
        if (!/^\d{6}$/.test(form.zip.trim())) {
            setValidationError('PIN CODE MUST BE 6 DIGITS');
            return false;
        }
        if (!/^(\+?91[-\s]?)?[6-9]\d{9}$/.test(form.phone.replace(/[\s-]/g, ''))) {
            setValidationError('PLEASE ENTER A VALID 10-DIGIT MOBILE NUMBER');
            return false;
        }
        setValidationError('');
        return true;
    };

    const handleContinueStep0 = () => {
        if (validateStep0()) {
            setCurrentStep(1);
        }
    };

    const handlePayment = async () => {
        // Last line of defense — the payment step can be deep-linked, so never
        // take money against a form that was never actually filled in.
        if (!isFormComplete(form)) {
            setCurrentStep(0);
            validateStep0();
            return;
        }
        setPaying(true);
        setPaymentError('');
        try {
            // Payment requires a backend session. If the exchange failed earlier
            // (e.g. flaky network), retry it here before giving up.
            if (!localStorage.getItem('morbei_token')) {
                const shopifyToken = localStorage.getItem('morbei_customer_token');
                if (shopifyToken) {
                    try {
                        const session = await authAPI.shopifyLogin(shopifyToken);
                        setToken(session.token);
                    } catch { /* handled below */ }
                }
            }
            if (!localStorage.getItem('morbei_token')) {
                alert('Please log in to complete your purchase. Your cart is saved.');
                setPaying(false);
                navigate('/profile');
                return;
            }

            const loaded = await loadRazorpayScript();
            if (!loaded) throw new Error('Failed to load Razorpay');

            // Build cart lines for backend
            const cartLines = lines.map(line => ({
                variantId: line.merchandise?.id,
                title: line.merchandise?.product?.title || line.merchandise?.title,
                quantity: line.quantity,
                price: parseFloat(line.cost?.totalAmount?.amount || line.cost?.totalAmount || 0) / line.quantity,
                image: line.merchandise?.image?.url,
                selectedOptions: line.merchandise?.selectedOptions,
            }));

            // 1. Create order on backend
            const orderData = await paymentAPI.createOrder({
                cartLines,
                shippingAddress: form,
                shippingMethod: deliveryMethod,
            });

            // 2. Open Razorpay popup
            const options = {
                key: orderData.keyId,
                amount: orderData.amount,
                currency: orderData.currency,
                name: 'MORBEI',
                description: `Order #${orderData.orderId}`,
                order_id: orderData.razorpayOrderId,
                prefill: {
                    name: `${form.firstName} ${form.lastName}`,
                    email: form.email,
                    contact: form.phone,
                },
                theme: { color: '#000000' },
                handler: async (response) => {
                    try {
                        // 3. Verify payment on backend → creates Shopify order + Shiprocket shipment
                        const result = await paymentAPI.verify({
                            razorpayOrderId: response.razorpay_order_id,
                            razorpayPaymentId: response.razorpay_payment_id,
                            razorpaySignature: response.razorpay_signature,
                            orderId: orderData.orderId,
                        });
                        // Snapshot the placed order for the confirmation page —
                        // the cart is cleared right after, so capture it now.
                        const shippingCost = deliveryMethod === 'priority' ? 200 : 0;
                        const confirmation = {
                            orderId: orderData.orderId,
                            orderNumber: result?.orderNumber,
                            shopifyOrderId: result?.shopifyOrderId,
                            items: cartLines,
                            shippingAddress: form,
                            deliveryMethod,
                            subtotal: Math.round(orderData.amount / 100) - shippingCost,
                            shippingCost,
                            total: Math.round(orderData.amount / 100),
                        };
                        // 4. Navigate to the confirmation page. The cart is
                        // intentionally NOT cleared here — clearing it while
                        // still on /checkout empties the cart and RequireCart
                        // redirects to /cart before navigation lands. The
                        // confirmation page clears the cart itself once mounted.
                        navigate('/order-confirmed', { state: { order: confirmation } });
                    } catch (err) {
                        // Payment may have been captured even though verification
                        // failed — the webhook will settle it (paid or refunded).
                        console.error('Payment verification failed:', err);
                        navigate('/order-failed', {
                            state: {
                                failure: {
                                    kind: 'verification',
                                    orderId: orderData.orderId,
                                },
                            },
                        });
                    } finally {
                        setPaying(false);
                    }
                },
                modal: {
                    ondismiss: () => setPaying(false),
                },
                // Don't let Razorpay loop its own retry UI — failures land on
                // our /order-failed page, which offers TRY AGAIN.
                retry: { enabled: false },
            };

            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', (resp) => {
                rzp.close();
                setPaying(false);
                navigate('/order-failed', {
                    state: {
                        failure: {
                            kind: 'payment',
                            reason: resp?.error?.description || '',
                            orderId: orderData.orderId,
                            amount: orderData.amount,
                        },
                    },
                });
            });
            rzp.open();
        } catch (err) {
            // 409 = the server re-checked stock and something sold out between
            // adding to bag and paying. Name the items so the fix is obvious.
            const outOfStock = err.data?.outOfStock;
            if (err.status === 409 && outOfStock?.length) {
                setPaymentError(
                    outOfStock
                        .map(i => {
                            const name = (i.title || 'An item').toUpperCase();
                            if (i.remaining > 0) return `${name} — ONLY ${i.remaining} LEFT`;
                            return `${name} — SOLD OUT`;
                        })
                        .join(' · ') + ' · PLEASE UPDATE YOUR BAG'
                );
            } else {
                setPaymentError(err.message || 'SOMETHING WENT WRONG. PLEASE TRY AGAIN.');
            }
            setPaying(false);
        }
    };

    if (lines.length === 0 && !cartLoading) {
        return (
            <div className="checkout-page-v3">
                <div className="checkout-container-v3">
                    <div className="checkout-top-header reveal reveal-up">
                        <h1>CHECKOUT</h1>
                    </div>
                    <div style={{ textAlign: 'center', padding: '6rem 0' }}>
                        <p style={{ letterSpacing: '0.1em', fontSize: '0.85rem', marginBottom: '2rem' }}>YOUR BAG IS EMPTY</p>
                        <Link to="/shop/all" style={{ textDecoration: 'underline', letterSpacing: '0.15em', fontSize: '0.8rem' }}>CONTINUE SHOPPING</Link>
                    </div>
                </div>
            </div>
        );
    }

    const delivery = getDeliveryOption(deliveryMethod);
    const estStart = new Date(); estStart.setDate(estStart.getDate() + delivery.minDays);
    const estEnd = new Date(); estEnd.setDate(estEnd.getDate() + delivery.maxDays);
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

    const headerRight = () => {
        if (currentStep === 1) {
            return (
                <div className="checkout-total-info">
                    <span className="total-value-v3">
                        {fmt(estStart)} - {fmt(estEnd)} [{delivery.label}] {cartCount} {cartCount === 1 ? 'ITEM' : 'ITEMS'}
                    </span>
                </div>
            );
        }
        return (
            <div className="checkout-total-info">
                <span className="total-value-v3">TOTAL {totalFormatted}</span>
            </div>
        );
    };

    return (
        <div className="checkout-page-v3">
            <div className="checkout-container-v3">
                <div className="checkout-top-header reveal reveal-up">
                    <h1>{currentStep === 1 ? 'ESTIMATED DELIVERY' : currentStep === 2 ? 'PAYMENT' : 'CHECKOUT'}</h1>
                    {headerRight()}
                </div>

                <div className="checkout-content-wrapper-v3">
                    {currentStep === 0 ? (
                        <div className="step0-layout reveal reveal-up">

                            {/* Left sidebar — all 3 progress dots */}
                            <div className="step0-sidebar">
                                <div className="step0-dot-item">
                                    <div className="step-box active"></div>
                                    <span className="step-label active">INFORMATION</span>
                                </div>
                                <div className="step0-dot-item">
                                    <div className="step-box"></div>
                                    <span className="step-label">DELIVERY</span>
                                </div>
                                <div className="step0-dot-item">
                                    <div className="step-box"></div>
                                    <span className="step-label">PAYMENT</span>
                                </div>
                            </div>

                            {/* Right — full merged form + actions */}
                            <div className="step0-content">
                                <div className="checkout-form-v3">
                                    <div className="form-section-label">
                                        <span>PERSONAL INFORMATION</span>
                                        {!customer && (
                                            <span className="login-hint">
                                                Already have an account? <Link to="/profile"><span>Login</span></Link>
                                            </span>
                                        )}
                                    </div>
                                    <div className="form-row-v3">
                                        <input className="checkout-input-v3" name="firstName" placeholder="FIRST NAME" value={form.firstName} onChange={handleForm} />
                                        <input className="checkout-input-v3" name="lastName" placeholder="LAST NAME" value={form.lastName} onChange={handleForm} />
                                    </div>
                                    <input className="checkout-input-v3" name="phone" placeholder="MOBILE NUMBER" value={form.phone} onChange={handleForm} />
                                    <input className="checkout-input-v3" name="email" placeholder="EMAIL" type="email" value={form.email} onChange={handleForm} />

                                    <div className="form-section-label form-section-label--spaced">
                                        <span>SHIPPING INFORMATION</span>
                                    </div>
                                    <div className="form-row-v3">
                                        <select
                                            className="checkout-input-v3"
                                            name="country"
                                            value={form.country}
                                            onChange={(e) => setForm({ ...form, country: e.target.value, state: '' })}
                                        >
                                            <option value="" disabled>COUNTRY / REGION</option>
                                            {SHIPPABLE_COUNTRIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                        </select>
                                        <select
                                            className="checkout-input-v3"
                                            name="state"
                                            value={form.state}
                                            onChange={handleForm}
                                        >
                                            <option value="" disabled>STATE / PROVINCE</option>
                                            {getStatesForCountry(form.country).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                                        </select>
                                    </div>
                                    <input className="checkout-input-v3" name="address" placeholder="ADDRESS" value={form.address} onChange={handleForm} />
                                    <div className="form-row-v3">
                                        <input className="checkout-input-v3" name="city" placeholder="CITY" value={form.city} onChange={handleForm} />
                                        <input className="checkout-input-v3" name="zip" placeholder="PIN CODE" inputMode="numeric" maxLength={6} value={form.zip} onChange={handleForm} />
                                    </div>
                                </div>

                            </div>

                        </div>
                    ) : (
                        /* Steps 1 & 2: standard sidebar + content layout */
                        <div className="checkout-layout-v3">
                            {/* Progress Sidebar */}
                            <div className="checkout-progress-v3">
                        <div className="progress-steps-v3" style={{ '--progress': currentStep / (STEPS.length - 1) }}>
                                    {STEPS.map((label, idx) => (
                                        <div
                                            key={label}
                                            className={`progress-step-item${idx < currentStep ? ' step-done' : ''}`}
                                            style={{ cursor: idx < currentStep ? 'pointer' : 'default' }}
                                            onClick={() => idx < currentStep && setCurrentStep(idx)}
                                        >
                                            <div className={`step-box ${idx <= currentStep ? 'active' : ''}`}></div>
                                            <span className={`step-label ${idx <= currentStep ? 'active' : ''}`}>{label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Main Content */}
                            <div className="checkout-main-content-v3">
                                <div className="checkout-step-content reveal reveal-up">

                                    {/* STEP 2 — DELIVERY */}
                                    {currentStep === 1 && (
                                        <>
                                            <div className="delivery-info-display">
                                                <div className="delivery-info-header">
                                                    <span>DELIVER TO</span>
                                                    <button className="edit-btn" onClick={() => setCurrentStep(0)}>EDIT</button>
                                                </div>
                                                <div className="address-details">
                                                    <strong>{form.firstName} {form.lastName}</strong>
                                                    <p>{form.address}</p>
                                                    <p>{[form.city, form.state].filter(Boolean).join(', ')} {form.zip}, {form.country}</p>
                                                    {form.phone && <p>{form.phone}</p>}
                                                    {form.email && <p style={{ textTransform: 'lowercase' }}>{form.email}</p>}
                                                </div>
                                            </div>

                                            <div className="checkout-section-v3">
                                                <div className="section-title-v3">
                                                    <h2>SELECT DELIVERY</h2>
                                                </div>
                                                <div className="delivery-options-v3">
                                                    <div className="delivery-option-item" onClick={() => setDeliveryMethod('standard')}>
                                                        <div className="delivery-option-left">
                                                            <div className={`option-radio ${deliveryMethod === 'standard' ? 'selected' : ''}`}></div>
                                                            <div className="option-text">
                                                                <span className="option-name">{DELIVERY_OPTIONS.standard.label}</span>
                                                                <span className="option-desc">{deliveryWindow(DELIVERY_OPTIONS.standard)}</span>
                                                            </div>
                                                        </div>
                                                        <span className="option-price">{DELIVERY_OPTIONS.standard.priceLabel}</span>
                                                    </div>
                                                    <div className="delivery-option-item" onClick={() => setDeliveryMethod('priority')}>
                                                        <div className="delivery-option-left">
                                                            <div className={`option-radio ${deliveryMethod === 'priority' ? 'selected' : ''}`}></div>
                                                            <div className="option-text">
                                                                <span className="option-name">{DELIVERY_OPTIONS.priority.label}</span>
                                                                <span className="option-desc">{deliveryWindow(DELIVERY_OPTIONS.priority)}</span>
                                                            </div>
                                                        </div>
                                                        <span className="option-price">{DELIVERY_OPTIONS.priority.priceLabel}</span>
                                                    </div>
                                                </div>
                                                {/* Must match SHIPPING_COST_RUPEES in server/routes/payment.js —
                                                    that constant is what the customer is actually charged. */}
                                                <p className="delivery-footnote">*free standard delivery on all orders</p>
                                            </div>


                                        </>
                                    )}

                                    {/* STEP 3 — PAYMENT */}
                                    {currentStep === 2 && (
                                        <>
                                            <div className="checkout-section-v3">
                                                <div className="section-title-v3">
                                                    <h2>PAY WITH</h2>
                                                </div>
                                                <div className="razorpay-payment-block">
                                                    <button
                                                        className="razorpay-pay-btn"
                                                        onClick={handlePayment}
                                                        disabled={paying}
                                                    >
                                                        {paying ? (
                                                            <span>PROCESSING...</span>
                                                        ) : (
                                                            <>
                                                                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                    <path d="M7.2 2L3 26h5.2l1.5-8.6h3.7L17 26h5.4L18.2 17c2.3-1 3.8-3.2 3.8-6 0-5-3.5-9-9-9H7.2zm3.3 4h2.5c2.2 0 3.5 1.5 3.5 3.5S15.2 13 13 13h-3l.5-7z" fill="#072654"/>
                                                                </svg>
                                                                <span className="razorpay-btn-text">
                                                                    <span className="razorpay-label">Razorpay</span>
                                                                    <span className="razorpay-sub">CARDS, UPI, NET BANKING & MORE</span>
                                                                </span>
                                                                <span className="razorpay-amount">{totalFormatted}</span>
                                                            </>
                                                        )}
                                                    </button>
                                                    {paymentError && (
                                                        <div role="alert" style={{ marginTop: '1rem', textAlign: 'center' }}>
                                                            <p style={{ color: '#ff4444', fontSize: '0.7rem', letterSpacing: '0.1em', margin: 0, textTransform: 'uppercase', lineHeight: 1.6 }}>
                                                                {paymentError}
                                                            </p>
                                                            <Link to="/cart" style={{ display: 'inline-block', marginTop: '0.75rem', textDecoration: 'underline', fontSize: '0.7rem', letterSpacing: '0.15em' }}>
                                                                GO TO SHOPPING BAG
                                                            </Link>
                                                        </div>
                                                    )}
                                                    <p className="razorpay-note">YOU WILL BE REDIRECTED TO RAZORPAY'S SECURE PAYMENT GATEWAY</p>
                                                    <button
                                                        type="button"
                                                        className="go-back-link razorpay-back-btn"
                                                        onClick={() => setCurrentStep(1)}
                                                    >
                                                        GO BACK
                                                    </button>
                                                </div>
                                            </div>


                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Checkout sticky footer — hidden on payment step */}
            {currentStep !== 2 && (
            <div className="checkout-page-footer">
                <div className="checkout-footer-inner">
                    {currentStep === 0 && validationError && (
                        <p style={{ color: '#ff4444', fontSize: '0.7rem', letterSpacing: '0.1em', margin: '0', textTransform: 'uppercase', textAlign: 'center' }}>
                            {validationError}
                        </p>
                    )}
                    {currentStep === 0 && <Link to="/cart" className="go-back-link">Go to shopping bag</Link>}
                    {currentStep === 1 && <button className="go-back-link" onClick={() => setCurrentStep(0)}>Go back</button>}
                    {currentStep === 0 && <button className="checkout-next-btn" onClick={handleContinueStep0}>CONTINUE</button>}
                    {currentStep === 1 && <button className="checkout-next-btn" onClick={() => (validateStep0() ? setCurrentStep(2) : setCurrentStep(0))}>CONTINUE</button>}
                </div>
            </div>
            )}
        </div>
    );
};

export default Checkout;
