import React from 'react';
import './PrivacyPolicy.css';

const PrivacyPolicy = () => {
    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <div className="privacy-page">
            <div className="privacy-last-updated">LAST UPDATED: 31 JAN 2026</div>

            <p className="privacy-intro">
                <strong>MORBEI.</strong> We respect your privacy and is committed to protecting your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website, make a purchase, or interact with us in any way. By using our website www.morbei.com, you agree to the practices described in this privacy-policy.
            </p>

            <div className="privacy-section">
                <h2>1. INFORMATION WE COLLECT</h2>

                <div className="privacy-sub-section">
                    <h3 className="privacy-sub-header">PERSONAL INFORMATION</h3>
                    <p className="privacy-text">When you make a purchase, create an account, sign up for our newsletter, or contact us, we may collect:</p>
                    <ul className="privacy-list">
                        <li>Name</li>
                        <li>Email address</li>
                        <li>Phone number</li>
                        <li>Shipping and billing address</li>
                        <li>Account login information</li>
                    </ul>
                </div>

                <div className="privacy-sub-section">
                    <h3 className="privacy-sub-header">PAYMENT INFORMATION</h3>
                    <p className="privacy-text">Payments are processed securely through third-party payment providers. We do not store or have access to your full credit or debit card details.</p>
                </div>

                <div className="privacy-sub-section">
                    <h3 className="privacy-sub-header">AUTOMATICALLY COLLECTED INFORMATION</h3>
                    <p className="privacy-text">When you browse our website, we may automatically collect:</p>
                    <ul className="privacy-list">
                        <li>IP address</li>
                        <li>Browser type and device information</li>
                        <li>Pages viewed and time spent on the site</li>
                        <li>Cookies and similar tracking technologies</li>
                    </ul>
                </div>

                <div className="privacy-sub-section">
                    <h3 className="privacy-sub-header">MARKETING & COMMUNICATION DATA</h3>
                    <ul className="privacy-list">
                        <li>Email or SMS subscriptions</li>
                        <li>Responses to promotions, surveys, or campaigns</li>
                        <li>Social media interactions with our brand</li>
                    </ul>
                </div>
            </div>

            <div className="privacy-section">
                <h2>2. HOW WE USE YOUR INFORMATION</h2>
                <p className="privacy-text">We use your information to:</p>
                <ul className="privacy-list">
                    <li>Process and fulfill orders</li>
                    <li>Deliver products and manage returns</li>
                    <li>Communicate order updates and customer support</li>
                    <li>Manage your account</li>
                    <li>Send marketing communications (you can opt out anytime)</li>
                    <li>Improve our website, products, and services</li>
                    <li>Prevent fraud and unauthorized transactions</li>
                </ul>
            </div>

            <div className="privacy-section">
                <h2>3. COOKIES AND TRACKING TECHNOLOGIES</h2>
                <p className="privacy-text">We use cookies and similar technologies to enhance your shopping experience, analyze site traffic, and support marketing efforts. You can control or disable cookies through your browser settings, though some features of the site may not function properly.</p>
            </div>

            <div className="privacy-section">
                <h2>4. SHARING YOUR INFORMATION</h2>
                <p className="privacy-text">We may share your information with trusted third parties, including:</p>
                <ul className="privacy-list">
                    <li>Payment processors</li>
                    <li>Shipping and logistics partners</li>
                    <li>Marketing and email service providers</li>
                    <li>Analytics and website performance tools</li>
                </ul>
                <p className="privacy-text">We do not sell your personal information. We may disclose information if required by law or to protect our legal rights.</p>
            </div>

            <div className="privacy-section">
                <h2>5. DATA SECURITY</h2>
                <p className="privacy-text">We implement appropriate technical and organizational measures to protect your personal information. While we take reasonable steps to safeguard data, no method of transmission over the internet is completely secure.</p>
            </div>

            <div className="privacy-section">
                <h2>6. DATA RETENTION</h2>
                <p className="privacy-text">We retain your personal information only as long as necessary to fulfill the purposes outlined in this policy, comply with legal obligations, and resolve disputes.</p>
            </div>

            <div className="privacy-section">
                <h2>7. YOUR RIGHTS</h2>
                <p className="privacy-text">Depending on your location, you may have the right to:</p>
                <ul className="privacy-list">
                    <li>Access your personal information</li>
                    <li>Correct inaccurate or incomplete data</li>
                    <li>Request deletion of your personal information</li>
                    <li>Opt out of marketing communications</li>
                    <li>Request data portability</li>
                </ul>
                <p className="privacy-text">To exercise your rights, please contact us using the information below.</p>
            </div>

            <div className="privacy-section">
                <h2>8. CHILDREN'S PRIVACY</h2>
                <p className="privacy-text">Our website is not intended for children under the age of 13, and we do not knowingly collect personal information from children.</p>
            </div>

            <div className="privacy-section">
                <h2>9. INTERNATIONAL USERS</h2>
                <p className="privacy-text">If you access our website from outside our operating country, your information may be transferred to and processed in countries with different data protection laws.</p>
            </div>

            <div className="privacy-section">
                <h2>10. CHANGES TO THIS PRIVACY POLICY</h2>
                <p className="privacy-text">We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated revision date.</p>
            </div>

            <div className="privacy-section">
                <h2>11. CONTACT US</h2>
                <p className="privacy-text">If you have any questions or concerns about this Privacy Policy or your personal information, please contact us at:</p>
                <p className="privacy-text">
                    Email: support@morbei.com<br />
                    Business Name: MORBEI<br />
                    Address: No.234a,behind vgn krone,<br />
                    Vigneshwara Nagar,Tharapakkam,Gerugambakkam,<br />
                    Chennai- 600128
                </p>
            </div>

            <div className="back-to-top" onClick={scrollToTop}>
                Back to top
            </div>
        </div>
    );
};

export default PrivacyPolicy;
