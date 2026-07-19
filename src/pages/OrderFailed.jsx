import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import './Checkout.css';

const rsFromPaise = (paise) => `RS. ${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;

/**
 * Payment failure page. Two flavours, picked by location.state.failure.kind:
 * - 'payment'      — Razorpay reported the payment failed; nothing was captured,
 *                    the cart is untouched, the user can retry.
 * - 'verification' — the payment may have gone through but our backend couldn't
 *                    confirm it; the webhook will settle it (paid or refunded).
 */
const OrderFailed = () => {
    const location = useLocation();
    const failure = location.state?.failure;

    // Direct visit / refresh — nothing to report, go back to the bag
    if (!failure) {
        return <Navigate to="/cart" replace />;
    }

    const isVerification = failure.kind === 'verification';

    return (
        <div className="order-details-page order-confirmed-page">
            <div className="order-details-container order-confirmed-container">
                {/* Hero */}
                <div className="order-confirmed-hero reveal reveal-up">
                    <span className="order-confirmed-eyebrow">
                        {isVerification ? 'PAYMENT PENDING' : 'PAYMENT FAILED'}
                    </span>
                    <h1 className="order-confirmed-title">
                        {isVerification ? 'CONFIRMING YOUR PAYMENT' : 'PAYMENT UNSUCCESSFUL'}
                    </h1>
                    <p className="order-confirmed-note">
                        {isVerification
                            ? 'WE COULD NOT CONFIRM YOUR PAYMENT YET. IF ANY AMOUNT WAS DEDUCTED, YOUR ORDER WILL BE CONFIRMED AUTOMATICALLY WITHIN A FEW MINUTES — OTHERWISE THE AMOUNT WILL BE REFUNDED. CHECK YOUR ORDERS BEFORE PAYING AGAIN.'
                            : 'YOUR PAYMENT DID NOT GO THROUGH AND NO AMOUNT WAS CAPTURED. YOUR BAG AND DETAILS ARE SAVED — YOU CAN TRY AGAIN RIGHT AWAY.'}
                    </p>
                    {failure.orderId && (
                        <span className="order-confirmed-number">ORDER REF. {failure.orderId}</span>
                    )}
                </div>

                {/* Details */}
                <div className="order-confirmed-grid">
                    <section className="order-confirmed-summary reveal reveal-up">
                        <h2 className="order-confirmed-heading">WHAT HAPPENED</h2>
                        <div className="address-details">
                            {isVerification ? (
                                <>
                                    <p>THE PAYMENT WAS SUBMITTED, BUT WE COULD NOT VERIFY IT WITH THE PAYMENT GATEWAY.</p>
                                    <p>THIS USUALLY RESOLVES ITSELF — OUR SYSTEM RECHECKS AUTOMATICALLY AND SETTLES THE PAYMENT AS PAID OR REFUNDED.</p>
                                </>
                            ) : (
                                <>
                                    <p>{failure.reason || 'THE PAYMENT WAS DECLINED OR INTERRUPTED BEFORE IT COULD COMPLETE.'}</p>
                                    {failure.amount ? <p>ATTEMPTED AMOUNT: {rsFromPaise(failure.amount)}</p> : null}
                                    <p>NO MONEY LEFT YOUR ACCOUNT FOR THIS ATTEMPT.</p>
                                </>
                            )}
                        </div>
                    </section>

                    <aside className="order-confirmed-aside reveal reveal-up">
                        <div className="order-confirmed-panel">
                            <h2 className="order-confirmed-heading">WHAT YOU CAN DO</h2>
                            <div className="address-details">
                                {isVerification ? (
                                    <>
                                        <p>CHECK YOUR ORDERS IN A FEW MINUTES</p>
                                        <p>CHECK YOUR BANK APP FOR THE DEBIT</p>
                                        <p>AVOID PAYING AGAIN UNTIL THE STATUS IS CLEAR</p>
                                    </>
                                ) : (
                                    <>
                                        <p>TRY A DIFFERENT METHOD — UPI, CARD OR NET BANKING</p>
                                        <p>CHECK YOUR CARD LIMIT OR BANK APP</p>
                                        <p>YOUR BAG AND ADDRESS ARE SAVED FOR THE RETRY</p>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="order-confirmed-panel">
                            <h2 className="order-confirmed-heading">NEED HELP?</h2>
                            <div className="address-details">
                                <p>
                                    <Link to="/contact" className="order-tracking-link">CONTACT US</Link>
                                </p>
                                <p>QUOTE THE ORDER REF ABOVE AND WE'LL SORT IT OUT.</p>
                            </div>
                        </div>
                    </aside>
                </div>

                {/* Actions */}
                <div className="order-confirmed-actions reveal reveal-up">
                    {isVerification ? (
                        <Link to="/order-details" className="checkout-next-btn">VIEW MY ORDERS</Link>
                    ) : (
                        <Link to="/checkout/payment" className="checkout-next-btn">TRY PAYMENT AGAIN</Link>
                    )}
                    <Link to="/shop/all" className="go-back-link">CONTINUE SHOPPING</Link>
                </div>
            </div>
        </div>
    );
};

export default OrderFailed;
