import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { getConsent, setConsent } from '../lib/consent';
import './ConsentBanner.css';

/**
 * Asks before Meta's pixel and Microsoft Clarity are allowed to load.
 *
 * Deliberately not a cookie wall: nothing on the storefront is withheld
 * either way, and declining is one click rather than a menu. What it gates is
 * real though — Clarity records sessions, including interaction with form
 * fields, which is a heavier thing to do to someone than count a page view.
 *
 * Rendered only when no decision exists. A declined visitor is not asked
 * again; the notice version in consent.js is what brings it back if what we
 * are asking about ever changes.
 */
const ConsentBanner = () => {
    // Lazy initialiser rather than an effect: getConsent already swallows a
    // blocked localStorage, so there is nothing an effect would be guarding,
    // and setting state in one costs an extra render on every page load.
    const [decided, setDecided] = useState(() => getConsent() !== null);

    if (decided) return null;

    const choose = (granted) => {
        setConsent(granted);
        setDecided(true);
    };

    return (
        <div className="consent-banner" role="dialog" aria-live="polite" aria-label="Analytics consent">
            <div className="consent-banner-inner">
                <p className="consent-banner-text">
                    We would like to use Meta and Microsoft Clarity to understand how this
                    site is used, which includes recording how pages are navigated. We will
                    not load either unless you agree. Counting visits on our own servers
                    continues either way, and holds nothing that identifies you — see our{' '}
                    <Link to="/privacy" className="consent-banner-link">Privacy Policy</Link>.
                </p>
                <div className="consent-banner-actions">
                    <button type="button" className="consent-btn consent-btn--ghost" onClick={() => choose(false)}>
                        DECLINE
                    </button>
                    <button type="button" className="consent-btn" onClick={() => choose(true)}>
                        ACCEPT
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConsentBanner;
