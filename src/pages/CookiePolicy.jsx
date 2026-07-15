import React from 'react';
import './PrivacyPolicy.css';

const CookiePolicy = () => {
    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className="privacy-page">
            <div className="privacy-last-updated">LAST UPDATED: 31 JAN 2026</div>

            <p className="privacy-intro">
                <strong>MORBEI.</strong> This Cookie Policy explains how we use cookies and similar technologies on www.morbei.com. By using our website, you consent to the use of cookies as described in this policy.
            </p>

            <div className="privacy-section">
                <h2>1. WHAT ARE COOKIES</h2>
                <p className="privacy-text">Cookies are small text files stored on your device when you visit a website. They help the site remember your preferences, keep you signed in, and understand how you use the site.</p>
            </div>

            <div className="privacy-section">
                <h2>2. HOW WE USE COOKIES</h2>
                <p className="privacy-text">We use cookies to:</p>
                <ul className="privacy-list">
                    <li>Keep you logged in and manage your session</li>
                    <li>Remember your cart and wishlist</li>
                    <li>Understand how visitors use our site so we can improve it</li>
                    <li>Deliver relevant content and remember your preferences</li>
                </ul>
            </div>

            <div className="privacy-section">
                <h2>3. TYPES OF COOKIES WE USE</h2>
                <div className="privacy-sub-section">
                    <h3 className="privacy-sub-header">ESSENTIAL COOKIES</h3>
                    <p className="privacy-text">Required for the website to function (e.g. authentication, security, load balancing). These cannot be disabled.</p>
                </div>
                <div className="privacy-sub-section">
                    <h3 className="privacy-sub-header">FUNCTIONALITY COOKIES</h3>
                    <p className="privacy-text">Remember your choices (e.g. language, region) to provide a more personalised experience.</p>
                </div>
                <div className="privacy-sub-section">
                    <h3 className="privacy-sub-header">ANALYTICS COOKIES</h3>
                    <p className="privacy-text">Help us understand how visitors interact with our site so we can improve performance and content.</p>
                </div>
            </div>

            <div className="privacy-section">
                <h2>4. MANAGING COOKIES</h2>
                <p className="privacy-text">You can control or delete cookies through your browser settings. Note that blocking or deleting cookies may affect your ability to use certain features of our website, such as staying logged in or keeping items in your cart.</p>
            </div>

            <div className="privacy-section">
                <h2>5. UPDATES</h2>
                <p className="privacy-text">We may update this Cookie Policy from time to time. Any changes will be posted on this page with an updated revision date.</p>
            </div>

            <div className="privacy-section">
                <h2>6. CONTACT</h2>
                <p className="privacy-text">If you have questions about our use of cookies, please contact us at support@morbei.com or see our Privacy Policy for full contact details.</p>
            </div>

            <div className="back-to-top" onClick={scrollToTop}>
                Back to top
            </div>
        </div>
    );
};

export default CookiePolicy;
