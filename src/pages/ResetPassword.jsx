import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCustomer } from '../hooks/useCustomer';
import SiteImage from '../components/SiteImage';
import PasswordField from '../components/PasswordField';
import './Profile.css';

const SHOP_DOMAIN = import.meta.env.VITE_SHOPIFY_STORE_DOMAIN;

/**
 * Landing page for the "reset your password" link in Shopify's recovery email.
 *
 * Shopify mints a single-use reset URL and mails it out, but the link it
 * generates points at the Online Store, which this headless build does not
 * serve — so the customer lands nowhere. The fix is two halves: this route,
 * and a notification template in Shopify Admin that points the link here.
 *
 * Two link shapes are accepted:
 *
 *   /account/reset?url=<encoded reset_password_url>   ← what the template sends
 *   /account/reset/:customerId/:resetToken            ← Shopify's native path
 *
 * The first is authoritative: `customerResetByUrl` wants the exact URL Shopify
 * generated, and passing it through verbatim survives a custom primary domain.
 * The path form is a fallback that rebuilds the URL from the store domain, and
 * only matches when the store's primary domain is its myshopify.com one.
 */
const ResetPassword = () => {
    const { resetPassword, loading } = useCustomer();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { customerId, resetToken } = useParams();

    const resetUrl = searchParams.get('url')
        || (customerId && resetToken && SHOP_DOMAIN
            ? `https://${SHOP_DOMAIN}/account/reset/${customerId}/${resetToken}`
            : null);

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');

        if (password !== confirm) {
            setMessage('Passwords do not match.');
            return;
        }

        setSubmitting(true);
        try {
            // On success this signs the customer in with the token Shopify
            // returns, so there is no second trip through the login form.
            await resetPassword(resetUrl, password);
            navigate('/profile', { replace: true });
        } catch (err) {
            setMessage(err.message || 'This reset link is no longer valid. Please request a new one.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="profile-auth-page">
            <div className="profile-auth-image">
                <SiteImage slot="account-side" fallback="/login-side.webp" alt="MORBEI Fashion" width={1000} widths={[600, 800, 1000]} sizes="50vw" />
            </div>

            <div className="profile-auth-form-panel">
                {!resetUrl ? (
                    <div className="profile-auth-form-container">
                        <h1 className="profile-auth-title">LINK EXPIRED</h1>
                        <p className="profile-auth-note">
                            This password reset link is invalid or has already been used.
                            Reset links work once and expire after a short while.
                        </p>
                        <Link to="/profile" className="profile-auth-submit-btn profile-auth-submit-link">
                            REQUEST A NEW LINK
                        </Link>
                    </div>
                ) : (
                    <div className="profile-auth-form-container">
                        <h1 className="profile-auth-title">SET A NEW PASSWORD</h1>
                        {message && <p className="profile-auth-error">{message}</p>}

                        <form onSubmit={handleSubmit} className="profile-auth-form">
                            <PasswordField
                                name="password"
                                placeholder="NEW PASSWORD"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="new-password"
                                minLength={5}
                            />
                            <PasswordField
                                name="confirm"
                                placeholder="CONFIRM PASSWORD"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                autoComplete="new-password"
                                minLength={5}
                            />

                            <button
                                type="submit"
                                disabled={submitting || loading}
                                className="profile-auth-submit-btn"
                                style={{ marginTop: '24px' }}
                            >
                                {submitting ? 'SAVING...' : 'SAVE PASSWORD'}
                            </button>
                        </form>

                        <div className="profile-auth-switch">
                            <Link to="/profile" className="profile-auth-switch-link">Back to login</Link>
                        </div>
                    </div>
                )}

                <div className="profile-auth-legal">
                    <p className="profile-auth-legal-text">
                        By signing in or creating an account, you agree to our{' '}
                        <Link to="/privacy" className="profile-auth-legal-link">Privacy Policy</Link>
                        {' '}and{' '}
                        <Link to="/terms" className="profile-auth-legal-link">Terms &amp; Conditions</Link>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ResetPassword;
