import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { track } from '../lib/analytics';
import { useCustomer } from '../hooks/useCustomer';
import { formatPrice } from '../utils/formatPrice';
import {
    paymentAPI, ordersAPI, ensureBackendSession, authAPI, setToken,
    clearToken, backendSession, hasShopifySession,
} from '../lib/api';
import { rememberPendingOrder } from '../lib/pendingOrder';
import { SHIPPABLE_COUNTRIES, getStatesForCountry } from '../data/countries';
import { DELIVERY_OPTIONS, getDeliveryOption, deliveryWindow } from '../data/delivery';
import './Checkout.css';
import '../styles/verify.css';

const STEPS = ['INFORMATION', 'DELIVERY', 'PAYMENT'];

// Every field the information step requires — later steps are gated on these
const REQUIRED_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'address', 'city', 'state', 'zip'];
const isFormComplete = (f) =>
    !!f && REQUIRED_FIELDS.every(k => typeof f[k] === 'string' && f[k].trim());

// Keep in sync with CHECKOUT_SESSION_KEYS in context/AuthContext.jsx, which
// clears this on sign-out.
const CHECKOUT_KEY = 'morbei_checkout_form';

const EMPTY_FORM = {
    firstName: '', lastName: '', phone: '', email: '',
    country: 'India', state: '', address: '', city: '', zip: '',
};

/** Prefill from the customer's Shopify profile and saved address. */
function formFromCustomer(customer) {
    const addr = customer?.addresses?.[0] || customer?.defaultAddress;
    return {
        firstName: customer?.firstName || '',
        lastName: customer?.lastName || '',
        phone: customer?.phone || '',
        email: customer?.email || '',
        country: addr?.country || 'India',
        state: addr?.province || '',
        address: addr?.address1 || '',
        city: addr?.city || '',
        zip: addr?.zip || '',
    };
}

// Who a saved form belongs to when nobody is signed in. Guests are most of
// the people who check out, and they had no owner at all — so nothing they
// typed was ever saved, and a failed payment sent them back to an empty form
// under a page that told them their details were kept.
const GUEST_OWNER = 'guest';

/**
 * An in-progress checkout, but only if it belongs to whoever is here now.
 *
 * A failed payment shouldn't cost someone their typed address, which is why
 * this is kept at all — but it must never be handed to a different account.
 * Anything without a matching owner is ignored (and includes the unscoped
 * blobs written before this was fixed).
 *
 * One hand-over is allowed: a form typed as a guest goes to the account whose
 * email is the one typed into it. That is the shopper who was told at the pay
 * button that their address has an account, signed in, and came back — the
 * same person, who should not have to type it all again.
 */
function readSavedCheckout(owner, customerEmail) {
    if (!owner) return null;
    try {
        const saved = JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || 'null');
        if (!saved?.form?.address) return null;
        if (saved.owner === owner) return saved;
        const typedEmail = String(saved.form.email || '').trim().toLowerCase();
        if (saved.owner === GUEST_OWNER && customerEmail
            && typedEmail === String(customerEmail).trim().toLowerCase()) {
            return saved;
        }
        return null;
    } catch {
        return null; // corrupted — treat as absent
    }
}

// How long to wait for the webhook to finish fulfilling an order whose /verify
// call failed. The webhook normally lands within a couple of seconds; this is
// generous enough to cover a slow Shopify call without stranding the customer
// on a spinner.
const SETTLE_TIMEOUT_MS = 25000;
const SETTLE_POLL_MS = 2000;

/**
 * Poll an order until the backend reports it paid.
 *
 * Resolves with the order once it settles, or null if it hasn't within the
 * window (or the customer navigated away — `isAlive` lets the caller stop).
 * Network errors are ignored rather than fatal: the whole point is that the
 * customer's connection is already proving unreliable.
 */
async function waitForOrderToSettle(orderId, isAlive) {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
        if (!isAlive()) return null;
        try {
            const order = await ordersAPI.get(orderId);
            if (order?.status === 'paid') return order;
            if (order?.status === 'cancelled') return null;
        } catch { /* transient — keep waiting */ }
    }
    return null;
}

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
    // ?test=1 asks the backend to charge ₹1 instead of the cart total, so the
    // live payment path can be exercised without editing a real product's
    // price down in Shopify where every shopper can see it. Read through the
    // router rather than window.location: this module is lazy-loaded, and at
    // module scope the URL would be whichever one happened to load the chunk.
    //
    // The URL is a request, not a permission. The server checks the signed-in
    // account against its own allowlist and ignores this otherwise.
    const [searchParams] = useSearchParams();
    const wantsTestOrder = searchParams.get('test') === '1';
    const { cart, loading: cartLoading } = useCart();
    const { customer, loading: authLoading } = useCustomer();
    const navigate = useNavigate();

    // Checkout no longer requires an account. A shopper who arrives signed out
    // fills the same form and pays; the session needed to take the payment is
    // created from the email they type, at the moment they pay.
    //
    // This used to redirect to the login page, which is where the funnel was
    // losing people: eight days of data showed product views and not one
    // completed checkout.


    const lines = cart?.lines || [];
    const cost = cart?.cost;
    // The bag's own total, items only. Kept separate from the grand total
    // because the two differ by the shipping the server adds, and this one is
    // the subtotal line rather than the amount anybody pays.
    const itemsTotalRupees = Number(
        typeof cost?.totalAmount === 'object' ? cost?.totalAmount?.amount : cost?.totalAmount
    ) || 0;
    const subtotalFormatted = cost?.totalAmount ? formatPrice(cost.totalAmount) : '—';
    const cartCount = lines.reduce((sum, l) => sum + l.quantity, 0);

    const { step: stepParam } = useParams();
    const [currentStep, setCurrentStep] = useState(0);

    // InitiateCheckout: fired once per visit to checkout, not per step, so the
    // number means "shoppers who started checking out" rather than "steps
    // advanced". This is the point the funnel has been losing people, since
    // reaching it has so far meant hitting a login wall.
    const checkoutTracked = useRef(false);
    useEffect(() => {
        if (checkoutTracked.current || !cart?.lines?.length) return;
        checkoutTracked.current = true;
        track('InitiateCheckout', {
            value: Number(cart.cost?.totalAmount?.amount) || undefined,
            currency: cart.cost?.totalAmount?.currencyCode || 'INR',
            num_items: cart.lines.length,
        });
    }, [cart]);
    const [deliveryMethod, setDeliveryMethod] = useState('standard');
    const [paying, setPaying] = useState(false);
    const [validationError, setValidationError] = useState('');
    const [paymentError, setPaymentError] = useState('');
    // True while we're waiting on the webhook after a failed verification.
    const [confirming, setConfirming] = useState(false);

    // Polling must stop if the customer leaves the page mid-wait.
    const aliveRef = useRef(true);
    useEffect(() => () => { aliveRef.current = false; }, []);
    const [form, setForm] = useState(EMPTY_FORM);

    // Which customer the state above belongs to. Seeding is driven by this
    // rather than by a useState initialiser, which fixed two bugs at once:
    //
    //  1. The saved form was restored to whoever opened checkout next. Sign
    //     out, sign in as someone else, and the previous customer's name,
    //     phone and home address were sitting in the form — their data shown
    //     to a different person on the same device.
    //
    //  2. A useState initialiser runs on the FIRST render, which on a direct
    //     load of /checkout is before the Shopify customer has finished
    //     loading. It seeded from `customer` while `customer` was still null
    //     and never ran again, so the saved-address prefill silently did
    //     nothing — a race that made it look intermittent.
    //
    // Re-seeding keys on the customer id, so it happens on mount and on an
    // account switch, but never mid-typing for the same person.
    //
    // A guest is an owner too. Nothing is decided until the account check has
    // finished, though: on a direct load a signed-in customer looks exactly
    // like a guest for a moment, and seeding then would save an empty guest
    // form over the one they had in progress.
    const customerId = customer?.id || null;
    const owner = authLoading ? null : (customerId || GUEST_OWNER);
    const [seededFor, setSeededFor] = useState(null);

    if (owner && seededFor !== owner) {
        const saved = readSavedCheckout(owner, customer?.email);
        const nextForm = saved ? saved.form : formFromCustomer(customer);
        setSeededFor(owner);
        setForm(nextForm);
        setDeliveryMethod(saved?.delivery === 'priority' ? 'priority' : 'standard');
        // /checkout/payment (the payment-failed page's TRY AGAIN) may jump
        // straight to payment — but only against a genuinely complete form,
        // since an empty one is saved the moment checkout mounts.
        setCurrentStep(stepParam === 'payment' && isFormComplete(nextForm) ? 2 : 0);
    }

    useEffect(() => {
        // Only persist once seeded, and always stamped with the owner — an
        // unowned blob is what leaked between accounts.
        if (!owner || seededFor !== owner) return;
        try {
            sessionStorage.setItem(
                CHECKOUT_KEY,
                JSON.stringify({ owner, form, delivery: deliveryMethod })
            );
        } catch { /* storage full/blocked — non-critical */ }
    }, [owner, seededFor, form, deliveryMethod]);

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

    /**
     * Email verification, for a guest whose address has not proved itself.
     *
     * Raised at the moment of paying rather than while the form is being
     * filled in: sending a code to every address anyone types would post mail
     * for abandoned carts, and the step only matters if money is about to
     * move. A verified address is remembered server-side, so a returning
     * customer and anyone signed in never see this at all.
     */
    const [verifyFor, setVerifyFor] = useState(null);   // the address awaiting a code
    const [verifyCode, setVerifyCode] = useState('');
    const [verifyBusy, setVerifyBusy] = useState(false);
    const [verifyError, setVerifyError] = useState('');
    const [verifyNotice, setVerifyNotice] = useState('');
    const [emailSuggestion, setEmailSuggestion] = useState(null);

    /** Ask for a code, turning a typo into an offer to fix it. */
    const requestCode = async (email) => {
        setVerifyBusy(true);
        setVerifyError('');
        setEmailSuggestion(null);
        try {
            const r = await authAPI.sendCode(email);
            if (r.verified) return true;   // already proved; nothing was sent
            setVerifyFor(email);
            setVerifyNotice(`We sent a six-digit code to ${email}.`);
            return false;
        } catch (err) {
            if (err.data?.suggestion) {
                // Not an error to argue with — an offer. The customer either
                // takes the correction or insists on what they typed.
                setEmailSuggestion(err.data.suggestion);
                setVerifyFor(email);
                setVerifyError(err.message);
                return false;
            }
            setVerifyFor(email);
            setVerifyError(err.message || 'Could not send the code.');
            return false;
        } finally {
            setVerifyBusy(false);
        }
    };

    /** Take the correction we offered, and ask again for the right address. */
    const acceptSuggestion = async () => {
        const fixed = emailSuggestion;
        setForm((p) => ({ ...p, email: fixed }));
        setEmailSuggestion(null);
        setVerifyError('');
        await requestCode(fixed);
    };

    const submitCode = async () => {
        const code = verifyCode.trim();
        if (!/^[0-9]{6}$/.test(code)) {
            setVerifyError('Enter the six digits from the email.');
            return;
        }
        setVerifyBusy(true);
        setVerifyError('');
        try {
            await authAPI.verifyEmail(verifyFor, code);
            setVerifyFor(null);
            setVerifyCode('');
            setVerifyNotice('');
            // Straight on to paying. Making them press PAY a second time
            // after they already did is a step for nothing.
            await handlePayment();
        } catch (err) {
            setVerifyError(err.message || 'That code is not right.');
        } finally {
            setVerifyBusy(false);
        }
    };

    // Set when the address typed belongs to an account, so the message can
    // offer the way in instead of only the way back to the bag.
    const [needsSignIn, setNeedsSignIn] = useState(false);

    /**
     * Get a backend session that may place this order.
     *
     * Returns false when it could not, having already put the reason on
     * screen — a code to enter, a prompt to sign in, or an error.
     *
     * For a signed-in shopper ensureBackendSession re-exchanges the Shopify
     * token, which also covers a session that lapsed while the form was open.
     * For a guest there is nothing to exchange, so one is created from the
     * email they typed.
     */
    const startSession = async () => {
        // A guest session left behind by an earlier checkout was reused as
        // found, whatever had been typed since. Expired, it failed the first
        // press of PAY with "Invalid or expired token". Issued for a different
        // address, it put the order — and every email about it — on the old
        // one. And once someone has an account session to use, a guest's is
        // never the right one.
        const current = backendSession();
        const typedEmail = form.email.trim().toLowerCase();
        if (current?.guest && (hasShopifySession() || current.expired || current.email !== typedEmail)) {
            clearToken();
        }

        if (await ensureBackendSession()) return true;

        try {
            const { token } = await authAPI.guest({
                email: form.email,
                firstName: form.firstName,
                lastName: form.lastName,
                phone: form.phone,
            });
            setToken(token);
            return true;
        } catch (err) {
            if (err.status === 428) {
                // Not an error: a step is missing. The address has never
                // proved it can receive mail, and an order nobody can be told
                // about is how #1016 happened.
                await requestCode(form.email);
                return false;
            }
            if (err.status === 409) {
                // The address belongs to a real account. Saying so is better
                // than letting them pay into a stranger's order history, and
                // better than a generic failure.
                setNeedsSignIn(true);
                setPaymentError('An account already exists with this email. Please sign in to continue — your details here are kept.');
                return false;
            }
            setPaymentError(err.message || 'Could not start checkout. Please try again.');
            return false;
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
        setNeedsSignIn(false);
        try {
            if (!(await startSession())) {
                setPaying(false);
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
            const orderBody = {
                cartLines,
                shippingAddress: form,
                shippingMethod: deliveryMethod,
                // Asking is not the same as being allowed. The server honours
                // this only for an allowlisted account and reports back what it
                // decided; nothing here can make an order cheap on its own.
                testOrder: wantsTestOrder,
            };
            let orderData;
            try {
                orderData = await paymentAPI.createOrder(orderBody);
            } catch (err) {
                // The server refused the session itself — revoked, or expired
                // in a way the token's own clock did not show. An account
                // session has already been renewed and retried by apiFetch;
                // a guest has nothing to renew from, so the stale token (now
                // cleared) is replaced by a new guest session and the order
                // tried once more, rather than showing a guest an error about
                // tokens.
                if (err.status !== 401 || hasShopifySession()) throw err;
                if (!(await startSession())) {
                    setPaying(false);
                    return;
                }
                orderData = await paymentAPI.createOrder(orderBody);
            }

            if (wantsTestOrder && !orderData.isTest) {
                throw new Error('This account cannot place test orders.');
            }

            // Never open the gateway for an amount the customer was not shown.
            // The server recomputes the total from Shopify's own prices, so if
            // it disagrees with the figure on the button then a price or the
            // shipping cost moved while this tab was open — and the honest
            // answer is to say so, not to charge the difference quietly. Test
            // orders are exempt: their ₹1 is a deliberate mismatch.
            if (!orderData.isTest) {
                const chargedRupees = Math.round(orderData.amount / 100);
                if (chargedRupees !== grandTotalRupees) {
                    throw new Error(
                        `The total changed while you were checking out — it is now RS. ${chargedRupees.toLocaleString('en-IN')}. `
                        + 'Please review your bag and try again.'
                    );
                }
            }

            // Record the attempt BEFORE the gateway opens. If the customer
            // closes the tab after paying, this note is the only trace the
            // browser keeps — it is what lets the next visit clear the bag and
            // show them the confirmation they never saw.
            rememberPendingOrder(orderData.orderId);

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
                    // The money is captured by the time Razorpay calls this.
                    // Everything from here is about telling the customer so.
                    const shippingCost = getDeliveryOption(deliveryMethod).priceRupees || 0;
                    const confirmation = {
                        orderId: orderData.orderId,
                        items: cartLines,
                        shippingAddress: form,
                        deliveryMethod,
                        subtotal: Math.round(orderData.amount / 100) - shippingCost,
                        shippingCost,
                        total: Math.round(orderData.amount / 100),
                    };
                    // The confirmation page clears the cart itself once mounted.
                    // Clearing here would empty the cart while still on
                    // /checkout, and RequireCart would redirect to /cart before
                    // the navigation lands.
                    const confirm = (orderNumber, shopifyOrderId) =>
                        navigate('/order-confirmed', {
                            state: { order: { ...confirmation, orderNumber, shopifyOrderId } },
                        });

                    try {
                        // 3. Verify payment on backend → creates the Shopify order
                        const result = await paymentAPI.verify({
                            razorpayOrderId: response.razorpay_order_id,
                            razorpayPaymentId: response.razorpay_payment_id,
                            razorpaySignature: response.razorpay_signature,
                            orderId: orderData.orderId,
                        });
                        confirm(result?.orderNumber, result?.shopifyOrderId);
                    } catch (err) {
                        // Verification failed, but the payment was already
                        // captured — this is a lost response, not lost money.
                        // The webhook is fulfilling the order right now and
                        // normally finishes within seconds, so wait for it
                        // rather than sending a paying customer to a page that
                        // reads like something went wrong.
                        console.error('Payment verification failed, waiting for the webhook:', err);
                        setConfirming(true);
                        const settled = await waitForOrderToSettle(orderData.orderId, () => aliveRef.current);
                        setConfirming(false);
                        if (!aliveRef.current) return;

                        if (settled) {
                            confirm(settled.orderNumber, settled.shopifyOrderId);
                        } else {
                            // Still unsettled. The reconciler is the backstop;
                            // /order-failed's 'verification' copy explains that
                            // without claiming the payment failed.
                            navigate('/order-failed', {
                                state: { failure: { kind: 'verification', orderId: orderData.orderId } },
                            });
                        }
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
    // What the customer will actually be charged. The pay button used to show
    // the bag total, so anyone choosing PRIORITY was quoted a figure ₹200
    // below what Razorpay then asked for. getDeliveryOption and the server's
    // SHIPPING_COST_RUPEES are documented as having to agree, and the assert
    // in handlePayment is what catches it if they ever stop.
    const shippingRupees = delivery.priceRupees || 0;
    const grandTotalRupees = itemsTotalRupees + shippingRupees;
    const totalFormatted = cost?.totalAmount ? formatPrice(String(grandTotalRupees)) : '—';
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
                                                {/* `from` is what brings them back here once signed in;
                                                    without it they were left on the account page. */}
                                                Already have an account? <Link to="/profile" state={{ from: '/checkout' }}><span>Login</span></Link>
                                            </span>
                                        )}
                                    </div>
                                    {/* Every field here was placeholder-only, with no label and no
                                        autoComplete — so a phone could not autofill an Indian shipping
                                        address, a password manager had nothing to match on, and the
                                        placeholder disappeared the moment anyone typed, leaving a
                                        shopper correcting one field with no idea which it was. The
                                        labels are visually hidden to keep the design unchanged. */}
                                    <div className="form-row-v3">
                                        <label className="visually-hidden" htmlFor="co-firstName">First name</label>
                                        <input id="co-firstName" className="checkout-input-v3" name="firstName" autoComplete="given-name" placeholder="FIRST NAME" value={form.firstName} onChange={handleForm} />
                                        <label className="visually-hidden" htmlFor="co-lastName">Last name</label>
                                        <input id="co-lastName" className="checkout-input-v3" name="lastName" autoComplete="family-name" placeholder="LAST NAME" value={form.lastName} onChange={handleForm} />
                                    </div>
                                    <label className="visually-hidden" htmlFor="co-phone">Mobile number</label>
                                    <input id="co-phone" className="checkout-input-v3" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="MOBILE NUMBER" value={form.phone} onChange={handleForm} />
                                    <label className="visually-hidden" htmlFor="co-email">Email</label>
                                    <input id="co-email" className="checkout-input-v3" name="email" placeholder="EMAIL" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={handleForm} />

                                    <div className="form-section-label form-section-label--spaced">
                                        <span>SHIPPING INFORMATION</span>
                                    </div>
                                    <div className="form-row-v3">
                                        <label className="visually-hidden" htmlFor="co-country">Country or region</label>
                                        <select
                                            id="co-country"
                                            className="checkout-input-v3"
                                            name="country"
                                            autoComplete="country-name"
                                            value={form.country}
                                            onChange={(e) => setForm({ ...form, country: e.target.value, state: '' })}
                                        >
                                            <option value="" disabled>COUNTRY / REGION</option>
                                            {SHIPPABLE_COUNTRIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                        </select>
                                        <label className="visually-hidden" htmlFor="co-state">State or province</label>
                                        <select
                                            id="co-state"
                                            className="checkout-input-v3"
                                            name="state"
                                            autoComplete="address-level1"
                                            value={form.state}
                                            onChange={handleForm}
                                        >
                                            <option value="" disabled>STATE / PROVINCE</option>
                                            {getStatesForCountry(form.country).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                                        </select>
                                    </div>
                                    <label className="visually-hidden" htmlFor="co-address">Address</label>
                                    <input id="co-address" className="checkout-input-v3" name="address" autoComplete="street-address" placeholder="ADDRESS" value={form.address} onChange={handleForm} />
                                    <div className="form-row-v3">
                                        <label className="visually-hidden" htmlFor="co-city">City</label>
                                        <input id="co-city" className="checkout-input-v3" name="city" autoComplete="address-level2" placeholder="CITY" value={form.city} onChange={handleForm} />
                                        <label className="visually-hidden" htmlFor="co-zip">PIN code</label>
                                        <input id="co-zip" className="checkout-input-v3" name="zip" autoComplete="postal-code" placeholder="PIN CODE" inputMode="numeric" maxLength={6} value={form.zip} onChange={handleForm} />
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
                                                    {/* The payment step showed no figures at all, so a
                                                        shopper on PRIORITY met the ₹200 for the first
                                                        time inside Razorpay. Spell it out before the
                                                        gateway, not during it. */}
                                                    <dl className="pay-summary">
                                                        <div>
                                                            <dt>SUBTOTAL</dt>
                                                            <dd>{subtotalFormatted}</dd>
                                                        </div>
                                                        <div>
                                                            <dt>SHIPPING</dt>
                                                            <dd>{shippingRupees > 0 ? formatPrice(String(shippingRupees)) : 'FREE'}</dd>
                                                        </div>
                                                        <div className="pay-summary-total">
                                                            <dt>TOTAL</dt>
                                                            <dd>{totalFormatted}</dd>
                                                        </div>
                                                    </dl>
                                                    {/* Hidden, not merely disabled, while a code is
                                                        outstanding: a payment button on screen is the
                                                        thing a customer will press, and pressing it
                                                        again only re-sends a code they already have. */}
                                                    {!verifyFor && (
                                                    <button
                                                        className="razorpay-pay-btn"
                                                        onClick={handlePayment}
                                                        disabled={paying}
                                                    >
                                                        {paying ? (
                                                            <span>{confirming ? 'CONFIRMING YOUR ORDER...' : 'PROCESSING...'}</span>
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
                                                    )}
                                                    {confirming && (
                                                        <div role="status" style={{ marginTop: '1rem', textAlign: 'center' }}>
                                                            <p style={{ fontSize: '0.7rem', letterSpacing: '0.1em', margin: 0, textTransform: 'uppercase', lineHeight: 1.6 }}>
                                                                PAYMENT RECEIVED. CONFIRMING YOUR ORDER — PLEASE DON&apos;T CLOSE THIS PAGE OR PAY AGAIN.
                                                            </p>
                                                        </div>
                                                    )}
                                                    {/* The address has never proved it can receive
                                                        mail. Shown in place of the Razorpay modal, not
                                                        beside it, so there is one thing to do. */}
                                                    {verifyFor && (
                                                        <div className="co-verify" role="group" aria-label="Verify your email">
                                                            <p className="co-verify-title">CONFIRM YOUR EMAIL</p>
                                                            {verifyNotice && <p className="co-verify-note">{verifyNotice}</p>}
                                                            {emailSuggestion ? (
                                                                <>
                                                                    <p className="co-verify-err">{verifyError}</p>
                                                                    <div className="co-verify-row">
                                                                        <button type="button" className="co-verify-btn" disabled={verifyBusy} onClick={acceptSuggestion}>
                                                                            USE {emailSuggestion.toUpperCase()}
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="co-verify-link"
                                                                            onClick={() => { setVerifyFor(null); setEmailSuggestion(null); setVerifyError(''); setCurrentStep(0); }}
                                                                        >
                                                                            EDIT IT MYSELF
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className="co-verify-row">
                                                                        <label className="visually-hidden" htmlFor="co-code">Six-digit code</label>
                                                                        <input
                                                                            id="co-code"
                                                                            className="checkout-input-v3 co-verify-input"
                                                                            value={verifyCode}
                                                                            onChange={(e) => setVerifyCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                                                                            onKeyDown={(e) => { if (e.key === 'Enter') submitCode(); }}
                                                                            placeholder="6-DIGIT CODE"
                                                                            inputMode="numeric"
                                                                            autoComplete="one-time-code"
                                                                            autoFocus
                                                                        />
                                                                        <button type="button" className="co-verify-btn" disabled={verifyBusy} onClick={submitCode}>
                                                                            {verifyBusy ? 'CHECKING…' : 'CONFIRM'}
                                                                        </button>
                                                                    </div>
                                                                    {verifyError && <p className="co-verify-err">{verifyError}</p>}
                                                                    <div className="co-verify-row">
                                                                        <button type="button" className="co-verify-link" disabled={verifyBusy} onClick={() => requestCode(verifyFor)}>
                                                                            SEND IT AGAIN
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="co-verify-link"
                                                                            onClick={() => { setVerifyFor(null); setVerifyError(''); setVerifyNotice(''); setCurrentStep(0); }}
                                                                        >
                                                                            CHANGE EMAIL
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                    {paymentError && (
                                                        <div role="alert" style={{ marginTop: '1rem', textAlign: 'center' }}>
                                                            <p style={{ color: '#ff4444', fontSize: '0.7rem', letterSpacing: '0.1em', margin: 0, textTransform: 'uppercase', lineHeight: 1.6 }}>
                                                                {paymentError}
                                                            </p>
                                                            {needsSignIn ? (
                                                                // Back to this step once signed in. The form typed
                                                                // here is saved and handed to that account.
                                                                <Link to="/profile" state={{ from: '/checkout/payment' }} style={{ display: 'inline-block', marginTop: '0.75rem', textDecoration: 'underline', fontSize: '0.7rem', letterSpacing: '0.15em' }}>
                                                                    SIGN IN
                                                                </Link>
                                                            ) : (
                                                                <Link to="/cart" style={{ display: 'inline-block', marginTop: '0.75rem', textDecoration: 'underline', fontSize: '0.7rem', letterSpacing: '0.15em' }}>
                                                                    GO TO SHOPPING BAG
                                                                </Link>
                                                            )}
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
