import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNewsletter } from '../hooks/useNewsletter';
import './Footer.css';

// The wishlist and cart subscriptions that used to live here were never
// rendered — dropping them also stops the footer re-rendering on every cart change.
const Footer = ({ minimal = false, showWordmark = false }) => {
    const [email, setEmail] = useState('');
    const { subscribe, status, message } = useNewsletter('footer');

    // 'already' counts as done — re-showing the form to someone who is on the
    // list just invites them to submit again.
    const done = status === 'success' || status === 'already';

    const handleNewsletterSubmit = async (e) => {
        e.preventDefault();
        const ok = await subscribe(email);
        if (ok) setEmail('');
    };

    return (
        <footer className="footer-v2">
            <div className="container">
                {!minimal && <div className="footer-top-v2">
                    <div className="footer-member">
                        <h3>BE A MEMBER, <br /> GET PRE LAUNCH ACCESS</h3>
                        {done ? (
                            <p style={{ letterSpacing: '0.15em', fontSize: '0.75rem', marginTop: '1rem' }} aria-live="polite">
                                {message}
                            </p>
                        ) : (
                            <>
                                <form className="signup-form" onSubmit={handleNewsletterSubmit}>
                                    <input
                                        type="email"
                                        placeholder="EMAIL"
                                        required
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        disabled={status === 'loading'}
                                    />
                                    <button type="submit" disabled={status === 'loading'}>
                                        {status === 'loading' ? 'SIGNING UP…' : 'SIGN UP'}
                                    </button>
                                </form>
                                {status === 'error' && (
                                    <p
                                        role="alert"
                                        style={{ letterSpacing: '0.12em', fontSize: '0.7rem', marginTop: '0.75rem', color: '#ff6b6b' }}
                                    >
                                        {message}
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    <div className="footer-links-v2">
                        <div className="link-group">
                            <h4>QUICK LINKS</h4>
                            <ul>
                                <li><Link to="/">HOME</Link></li>
                                <li><Link to="/about">ABOUT</Link></li>
                                <li><Link to="/contact">CONTACT US</Link></li>
                                <li><a href="https://www.instagram.com" target="_blank" rel="noopener noreferrer">INSTAGRAM</a></li>
                            </ul>
                        </div>
                        <div className="link-group">
                            <h4>HELP/SUPPORT</h4>
                            <ul>
                                <li><Link to="/faqs">FAQS</Link></li>
                                <li><Link to="/track">TRACK ORDER</Link></li>
                                <li><Link to="/shipping">SHIPPING</Link></li>
                                <li><Link to="/returns">RETURNS & EXCHANGES</Link></li>
                            </ul>
                        </div>
                        <div className="link-group">
                            <h4>LEGAL</h4>
                            <ul>
                                <li><Link to="/privacy">PRIVACY POLICY</Link></li>
                                <li><Link to="/cookies">COOKIE POLICY</Link></li>
                                <li><Link to="/terms">TERMS & CONDITIONS</Link></li>
                            </ul>
                        </div>
                    </div>
                </div>}

                {minimal && <hr className="footer-divider" />}

                {!minimal && !showWordmark && <div className="footer-copyright-standard">
                    &copy; 2026 MORBEI. ALL RIGHTS RESERVED.
                </div>}
            </div>

            {/* Full-bleed wordmark — only shown on the homepage (animated FLIP target) */}
            {showWordmark && <div className="footer-wordmark-row">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 50 871.75 150" fill="white" aria-hidden="true" className="footer-wordmark-svg">
                    <path d="M0,196.75h3.56c10.74,0,14.72-3.92,14.72-14.5v-117.88c0-7.75-1.05-10.83-11.63-10.83H0v-1.84h32.76c22.47,39.02,44.95,78.04,67.42,117.06,2.31,4.01,3.56,7.56,3.56,8.78h1.19c0-1.22,1.6-5.75,3.32-8.78,22.08-39.02,44.16-78.04,66.24-117.06h35.37v1.84h-7.12c-12.37,0-13.06,4.6-13.06,14.51v114.2c0,10.59,4.1,14.5,15.19,14.5h5.22v1.84h-61.96v-1.84h8.55c10.57,0,14.48-3.36,14.48-12.46v-106.64c0-3.27,0-6.74.24-8.99h-1.66c-.24.61-1.9,4.09-4.04,8.38-22.87,40.79-45.74,81.58-68.61,122.37-.29.57-.43.86-.71,1.43h-.47c-.29-.57-.43-.86-.71-1.43-22.95-40.04-45.9-80.08-68.85-120.12-2.14-4.09-3.09-7.97-3.09-8.58h-.95c.24,1.84.24,3.32.24,6.95v106.64c0,9.1,3.97,12.46,14.72,12.46h8.55v1.84H0v-1.84Z"/>
                    <path d="M215.8,125.04c.07-45.91,46.11-74.93,88.08-74.97,44.69-.04,87.68,26.31,87.61,74.97-.07,45.82-45.56,75.14-87.61,75.18-44.82.04-88.16-26.29-88.08-75.18ZM370.83,128.92c-.06-37.63-28.1-75.1-67.9-75.18-38.81-.07-66.53,29.17-66.47,67.62.06,37.74,28.29,75.1,68.14,75.18,38.79.07,66.3-29.29,66.24-67.62Z"/>
                    <path d="M399.55,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h61.96c26.56.22,63.73,12.88,63.15,45.35-.47,26.25-26.65,41.84-50.33,44.13-1.9.08-2.85.12-4.75.2v1.23c9.33.55,20.83,6.4,26.35,14.1,4.75,6.46,7.12,9.68,11.87,16.14,5.68,8.02,13.7,20.09,23.24,21.01,1.98.19,4.47-.73,6.79-2.44,2.09-1.55,3.13-2.33,5.22-3.88.52.58.78.87,1.3,1.46-2.09,1.55-3.13,2.33-5.22,3.88-7.57,5.61-14.11,7.97-19.6,7.86-12.32-.25-21.23-11.06-27.88-20.53-6.65-8.83-9.97-13.24-16.62-22.06-5.51-8.09-12.91-16.03-23.5-15.73h-2.85v-3.47h10.92c23.12,0,44.4-18.07,44.4-41.88,0-23.78-21.36-41.68-44.4-41.68h-24.69v.2c2.85,2.45,4.04,5.92,4.04,10.62v119.71c0,9.81,1.42,10.83,12.82,10.83h13.77v1.84h-66v-1.84Z"/>
                    <path d="M542.23,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h57.93c19.68.08,56.31,5.77,56.27,30.85-.03,15.93-19.36,27.51-34.19,28.6v.82c23.55,1.39,52.37,18.25,52.23,44.13-.17,31.53-39.57,42.25-65.52,42.49h-66.71v-1.84ZM604.67,194.91c23.69-.16,48.47-12.56,49.14-38.82.69-26.97-26.76-41.87-50.57-42.08h-12.58v-3.47h9.5c16.21.68,36.03-9.27,36.09-27.58.06-20.29-22.77-27.76-39.41-27.58h-19.23v.2c2.85,2.45,4.04,5.92,4.04,10.62v117.88c0,4.7-1.19,7.97-4.04,10.42v.41h27.07Z"/>
                    <path d="M682.54,196.75h8.31c11.4,0,12.58-1.02,12.58-10.83v-121.55c0-9.81-1.19-10.83-12.58-10.83h-8.31v-1.84h94.73c3.8,0,7.12.41,8.78,1.84h.24c-.28-3.79-.42-5.69-.71-9.48.85-.05,1.28-.07,2.13-.12,1.42,18.45,2.85,36.91,4.27,55.36h-4.27c-.38-5.72-.57-8.58-.95-14.3-.77-21.48-16.8-30.04-36.56-29.62h-33.47v.2c2.85,2.45,5.22,6.13,5.22,10.62v53.52h9.5c14.05.21,26.52-5.13,25.64-21.66v-7.15h2.14v65.58h-2.14v-11.24c.86-16.49-11.54-22.05-25.64-21.86h-9.5v60.67c0,4.49-2.37,8.17-5.22,10.62v.2h47.24c18.59.4,34.2-7.38,35.37-27.58.57-6.54.85-9.81,1.42-16.34h3.8c-1.34,18.45-2.69,36.91-4.04,55.36-.85-.05-1.28-.07-2.13-.11.28-3.8.42-5.69.71-9.49h-.24c-1.66,1.43-4.99,1.84-8.78,1.84h-107.55v-1.84Z"/>
                    <path d="M811.21,196.75h8.31c11.4,0,12.58-.82,12.58-10.62v-121.96c0-9.81-1.19-10.62-12.58-10.62h-8.31v-1.84h60.54v2.25h-8.31c-11.4,0-12.82.82-12.82,10.62v121.55c0,9.81,1.42,10.62,12.82,10.62h8.31v1.84h-60.54v-1.84Z"/>
                </svg>
            </div>}
            {showWordmark && <div className="footer-copyright-bar">
                © 2026 MORBEI. ALL RIGHTS RESERVED.
            </div>}
        </footer>
    );
};

export default Footer;
