import React, { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { contactAPI } from '../lib/api';
import './SupportPage.css';

/**
 * Landing page for the unsubscribe link in marketing emails.
 *
 * Reached from a mail client with no session, so the HMAC token in the URL is
 * the only proof of ownership. Consent has to be withdrawable for it to be
 * valid consent at all — this is the mechanism that makes it so.
 */
const Unsubscribe = () => {
    const [params] = useSearchParams();
    const email = params.get('email') || '';
    const token = params.get('token') || '';
    // Derived from the URL, not set inside the effect — a synchronous setState
    // in an effect triggers a cascading re-render.
    const [status, setStatus] = useState(() => (email && token ? 'working' : 'error')); // working | done | error
    const ran = useRef(false);

    useEffect(() => {
        if (!email || !token) return;
        // StrictMode double-invokes effects in development; the request is
        // idempotent but firing it twice is still noise.
        if (ran.current) return;
        ran.current = true;

        contactAPI
            .unsubscribe(email, token)
            .then(() => setStatus('done'))
            .catch(() => setStatus('error'));
    }, [email, token]);

    return (
        <div className="support-page">
            <div className="support-container">
                <div className="support-header">
                    <h1>EMAIL PREFERENCES</h1>
                </div>
                <div className="support-content animate-fade">
                    <div className="support-section">
                        {status === 'working' && <p>UPDATING YOUR PREFERENCES…</p>}

                        {status === 'done' && (
                            <>
                                <p>YOU HAVE BEEN UNSUBSCRIBED.</p>
                                <p>
                                    {email} WILL NO LONGER RECEIVE MARKETING EMAILS FROM MORBEI.
                                    ORDER CONFIRMATIONS AND SHIPPING UPDATES ARE UNAFFECTED.
                                </p>
                            </>
                        )}

                        {status === 'error' && (
                            <>
                                <p>WE COULD NOT PROCESS THIS UNSUBSCRIBE LINK.</p>
                                <p>
                                    IT MAY HAVE EXPIRED OR BEEN COPIED INCOMPLETELY. PLEASE{' '}
                                    <Link to="/contact" style={{ textDecoration: 'underline' }}>CONTACT US</Link>{' '}
                                    AND WE WILL REMOVE YOU MANUALLY.
                                </p>
                            </>
                        )}

                        <p style={{ marginTop: '2rem' }}>
                            <Link to="/" style={{ textDecoration: 'underline' }}>RETURN TO MORBEI</Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Unsubscribe;
