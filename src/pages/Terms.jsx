import React from 'react';
import './PrivacyPolicy.css';

const Terms = () => {
    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className="privacy-page">
            <div className="privacy-last-updated">LAST UPDATED: 31 JAN 2026</div>

            <p className="privacy-intro">
                <strong>MORBEI.</strong> These Terms and Conditions govern your use of our website www.morbei.com and any purchases you make. By accessing or using our site, you agree to be bound by these terms. Please read them carefully.
            </p>

            <div className="privacy-section">
                <h2>1. USE OF THE WEBSITE</h2>
                <p className="privacy-text">You may use our website only for lawful purposes and in accordance with these terms. You agree not to use the site in any way that could damage, disable, or impair the site or interfere with any other party's use of the site.</p>
            </div>

            <div className="privacy-section">
                <h2>2. ACCOUNTS AND REGISTRATION</h2>
                <p className="privacy-text">When you create an account, you must provide accurate and complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.</p>
            </div>

            <div className="privacy-section">
                <h2>3. ORDERS AND PAYMENT</h2>
                <p className="privacy-text">All orders are subject to availability and acceptance. We reserve the right to refuse or cancel any order. Prices are as displayed at the time of order; we reserve the right to correct pricing errors. Payment must be received in full before dispatch.</p>
            </div>

            <div className="privacy-section">
                <h2>4. SHIPPING AND DELIVERY</h2>
                <p className="privacy-text">Delivery times are estimates and not guaranteed. Risk of loss and title for items pass to you upon delivery to the carrier. We are not responsible for delays caused by customs or carriers.</p>
            </div>

            <div className="privacy-section">
                <h2>5. RETURNS AND REFUNDS</h2>
                <p className="privacy-text">Our returns and refund policy is set out on our Returns page. By placing an order, you agree to the return conditions applicable at the time of purchase.</p>
            </div>

            <div className="privacy-section">
                <h2>6. INTELLECTUAL PROPERTY</h2>
                <p className="privacy-text">All content on this website, including text, images, logos, and design, is the property of MORBEI or its licensors and is protected by copyright and other intellectual property laws. You may not reproduce or use our content without written permission.</p>
            </div>

            <div className="privacy-section">
                <h2>7. LIMITATION OF LIABILITY</h2>
                <p className="privacy-text">To the fullest extent permitted by law, MORBEI shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the site or any products purchased through it.</p>
            </div>

            <div className="privacy-section">
                <h2>8. CHANGES</h2>
                <p className="privacy-text">We may update these Terms and Conditions from time to time. Changes will be posted on this page with an updated revision date. Continued use of the site after changes constitutes acceptance of the new terms.</p>
            </div>

            <div className="privacy-section">
                <h2>9. CONTACT</h2>
                <p className="privacy-text">For questions about these Terms and Conditions, contact us at support@morbei.com or at our business address as stated in our Privacy Policy.</p>
            </div>

            <div className="back-to-top" onClick={scrollToTop}>
                Back to top
            </div>
        </div>
    );
};

export default Terms;
