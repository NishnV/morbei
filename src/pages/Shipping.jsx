import React from 'react';
import './Shipping.css';
import { DELIVERY_OPTIONS, deliveryWindow, deliveryPrice } from '../data/delivery';

// Times and prices come from data/delivery.js, which is what checkout shows
// and what the server charges. This page used to state its own, and they had
// drifted: a ₹9,900 free-shipping threshold nobody was charged against, and
// by-region times that did not match the options offered at checkout.
const { standard, priority } = DELIVERY_OPTIONS;

const Shipping = () => {
    return (
        <div className="sp-page">
            <div className="sp-header">
                <h1 className="sp-title">Shipping Policy</h1>
                <div className="sp-rule" />
            </div>

            <section className="sp-section">
                <h2 className="sp-section-title">When will my order be processed?</h2>
                <p className="sp-body">
                    All orders are processed after successful payment confirmation, and are
                    prepared and dispatched as soon as possible. The delivery estimates below
                    are counted from the day you place your order, and include this
                    preparation time.
                </p>
                <p className="sp-body">
                    Orders placed on weekends, public holidays, or outside regular business hours
                    will be processed on the next available business day.
                </p>
                <p className="sp-body">
                    Please note that during product launches, promotional events, seasonal sales,
                    or periods of exceptionally high order volume, order processing may take
                    longer than usual. If there is a significant delay in dispatching your order,
                    we will make reasonable efforts to notify you using the contact information
                    provided during checkout.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">How long does shipping take?</h2>
                <p className="sp-body">
                    Delivery time depends on the delivery option you choose at checkout.
                </p>
                <p className="sp-body">Within India</p>
                <p className="sp-body">– Standard: Approximately {deliveryWindow(standard)}</p>
                <p className="sp-body">– Priority: Approximately {deliveryWindow(priority)}</p>
                <p className="sp-body">
                    Both are counted from the day your order is placed to the day it reaches you.
                </p>
                <p className="sp-body">
                    These delivery timelines are estimates only and are not guaranteed. Actual
                    delivery may vary depending on courier operations, weather conditions,
                    transportation disruptions, public holidays, natural disasters, or other
                    circumstances beyond MORBEI's reasonable control.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">Do you offer international shipping?</h2>
                <p className="sp-body">
                    No. MORBEI does not offer international shipping at this time.
                </p>
                <p className="sp-body">
                    We currently ship only within our supported domestic service areas.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">How much does shipping cost?</h2>
                <p className="sp-body">
                    We offer complimentary standard shipping on all domestic orders, with no
                    minimum purchase value.
                </p>
                <p className="sp-body">
                    Priority shipping is available at checkout for {deliveryPrice(priority)}. Any
                    shipping charge is displayed during checkout before payment is completed.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">Will I receive tracking information?</h2>
                <p className="sp-body">
                    Yes. Once your order has been dispatched, you will receive a shipping
                    confirmation via email, including your order number, courier partner details,
                    shipment tracking number, and tracking link. Please note that tracking
                    information may take up to 24 hours after dispatch to become active.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">What happens if delivery cannot be completed?</h2>
                <p className="sp-body">
                    Our courier partners generally make multiple delivery attempts before
                    returning a shipment. An order may be returned to MORBEI if the shipping
                    address provided is incorrect or incomplete, the recipient is unavailable
                    after repeated delivery attempts, the delivery is refused, or the courier is
                    unable to access the delivery location. If a shipment is returned due to
                    these circumstances, MORBEI reserves the right to apply additional shipping
                    charges before arranging any reshipment.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">Can I change my shipping address after placing an order?</h2>
                <p className="sp-body">
                    If your order has not yet been processed or dispatched, please contact our
                    customer support team as soon as possible.
                </p>
                <p className="sp-body">
                    While we will make reasonable efforts to accommodate address change requests,
                    we cannot guarantee modifications once order processing has begun.
                </p>
                <p className="sp-body">
                    Orders that have already been shipped cannot have their delivery address
                    changed through MORBEI.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">What if I entered the wrong shipping address?</h2>
                <p className="sp-body">
                    Customers are responsible for providing complete and accurate shipping
                    information at checkout.
                </p>
                <p className="sp-body">
                    MORBEI is not responsible for delays, failed deliveries, additional shipping
                    costs, or returned shipments resulting from incorrect, incomplete, or outdated
                    address information provided by the customer.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">What should I do if my package arrives damaged?</h2>
                <p className="sp-body">
                    We take great care in packaging every order. If your package arrives damaged,
                    please record a complete unboxing video before opening the package, take clear
                    photographs of the outer packaging and affected items, and contact MORBEI
                    within 48 hours of delivery with your order number and supporting evidence.
                    Claims submitted without sufficient documentation or after the specified
                    timeframe may not be eligible for review. Each case will be evaluated
                    individually, and where appropriate, MORBEI will provide a suitable resolution
                    in accordance with our Returns and Exchange policy.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">Are delivery dates guaranteed?</h2>
                <p className="sp-body">
                    No. Estimated delivery dates are provided for reference only and should not be
                    considered guaranteed delivery commitments. Delivery timelines may be affected
                    by circumstances beyond MORBEI's reasonable control, including severe weather,
                    natural disasters, transportation disruptions, customs inspections, government
                    restrictions, courier operational delays, or high seasonal shipping volumes.
                    MORBEI is not responsible for delays caused by such circumstances.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">Can MORBEI refuse or cancel shipment?</h2>
                <p className="sp-body">
                    MORBEI reserves the right to refuse, delay, suspend, or cancel the shipment
                    of any order if necessary due to suspected fraudulent activity, payment
                    verification issues, inaccurate or incomplete customer information, product
                    availability, compliance with applicable laws or regulations, or circumstances
                    beyond our reasonable control. If we are unable to fulfill your order, you
                    will be notified promptly, and any eligible refund will be processed in
                    accordance with our Refund Policy.
                </p>
            </section>

            <section className="sp-section">
                <h2 className="sp-section-title">Contact Us</h2>
                <p className="sp-body">
                    If you have any questions, concerns, or requests regarding this Shipping
                    Policy, please contact us:
                </p>
                <p className="sp-body sp-contact">
                    Morbei<br />
                    Email: info@morbei.com<br />
                    Phone: +91 9952228533<br />
                    Instagram: @shopmorbei<br />
                    Opening Hours: Mon to Sat: 11:00am – 5:00pm
                </p>
            </section>
        </div>
    );
};

export default Shipping;
