import React from 'react';
import './Returns.css';

const Returns = () => {
    return (
        <div className="re-page">
            <div className="re-header">
                <h1 className="re-title">Returns &amp; Exchanges</h1>
                <div className="re-rule" />
            </div>

            <p className="re-intro">
                At MORBEI, we want you to love every purchase you made. If you're not completely
                satisfied, we're here to help with an easy return or exchange process.
            </p>

            <section className="re-section">
                <h2 className="re-section-title">Return &amp; Exchange Eligibility</h2>
                <p className="re-body">– Returns and exchanges can be requested within 7 days of receiving your order.</p>
                <p className="re-body">– Items must be unused, unwashed, unworn, and in their original condition with all tags and original packaging intact.</p>
                <p className="re-body">– Products that are damaged due to misuse, washing, or normal wear and tear are not eligible for return or exchange.</p>
                <p className="re-body">– Items purchased during clearance sales, promotional offers, or marked as Final Sale are not eligible for return or exchange unless they arrive damaged or incorrect.</p>
            </section>

            <section className="re-section">
                <h2 className="re-section-title">How to Request a Return or Exchange</h2>
                <p className="re-body">To request a return or exchange:</p>
                <p className="re-body">1. Contact us within 7 days of delivery via:<br />Email: info@morbei.com</p>
                <p className="re-body">2. Share your order number and the reason for the return or exchange.</p>
                <p className="re-body">3. If approved, we'll provide the next steps for returning your item.</p>
            </section>

            <section className="re-section">
                <h2 className="re-section-title">Exchanges</h2>
                <p className="re-body">Exchanges are subject to product availability. If your requested size or item is unavailable, you may choose:</p>
                <p className="re-body">– Store credit, or</p>
                <p className="re-body">– A refund (if applicable).</p>
            </section>

            <section className="re-section">
                <h2 className="re-section-title">Refunds</h2>
                <p className="re-body">– Once we receive and inspect the returned item, we will notify you of the approval status.</p>
                <p className="re-body">– Approved refunds will be processed to your original payment method within 5–7 business days.</p>
            </section>

            <section className="re-section">
                <h2 className="re-section-title">Damaged or Incorrect Items</h2>
                <p className="re-body">
                    If you receive a damaged, defective, or incorrect item, please contact us
                    within 48 hours of delivery with clear photos or an unboxing video. We will
                    resolve the issue by offering a replacement or refund after verification.
                </p>
            </section>

            <section className="re-section">
                <h2 className="re-section-title">Cancellation Policy</h2>
                <p className="re-body">
                    Orders can be cancelled only before they are shipped. Once an order has been
                    dispatched, it cannot be cancelled.
                </p>
            </section>

            <section className="re-section">
                <h2 className="re-section-title">Contact Us</h2>
                <p className="re-body">For any questions regarding returns or exchanges, please contact us:</p>
                <p className="re-body re-contact">
                    Email: info@morbei.com<br />
                    Phone: +91 9952228533<br />
                    Instagram: @morbei
                </p>
                <p className="re-body">
                    We're committed to making your shopping experience with MORBEI simple,
                    transparent, and enjoyable.
                </p>
            </section>
        </div>
    );
};

export default Returns;
