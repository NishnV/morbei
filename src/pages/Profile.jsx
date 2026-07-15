import React, { useState } from 'react';
import { useCustomer } from '../hooks/useCustomer';
import { useCart } from '../hooks/useCart';
import { formatPrice } from '../utils/formatPrice';
import { Link } from 'react-router-dom';
import './Profile.css';

const GOOGLE_ICON = 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg';

const Profile = () => {
    const {
        customer, loading, error,
        login, signUp, logout, recoverPassword,
        updateProfile, addAddress, updateAddress, deleteAddress, setDefaultAddress
    } = useCustomer();
    const { cart } = useCart();

    const [view, setView] = useState('signup'); // login | signup | recover | google-coming-soon
    const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', notify: false });
    const [message, setMessage] = useState('');
    const [addrForm, setAddrForm] = useState({ firstName: '', lastName: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'India', phone: '' });
    const [addrMessage, setAddrMessage] = useState('');
    const [editingAddr, setEditingAddr] = useState(null); // null = hidden, 'new' = add, id = edit
    const [addrLoading, setAddrLoading] = useState(false);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setMessage('');
        try {
            await login(form.email, form.password);
        } catch (err) {
            setMessage(err.message || 'Login failed');
        }
    };

    const handleSignUp = async (e) => {
        e.preventDefault();
        setMessage('');
        const nameParts = form.name.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        if (!firstName || !lastName) {
            setMessage('Please enter your full name (first and last).');
            return;
        }
        try {
            await signUp({
                email: form.email,
                password: form.password,
                firstName,
                lastName,
                phone: form.phone ? `+91${form.phone}` : undefined,
                acceptsMarketing: form.notify
            });
        } catch (err) {
            setMessage(err.message || 'Sign up failed');
        }
    };

    const handleRecover = async (e) => {
        e.preventDefault();
        setMessage('');
        try {
            await recoverPassword(form.email);
            setMessage('Recovery email sent. Check your inbox.');
        } catch (err) {
            setMessage(err.message || 'Recovery failed');
        }
    };

    const handleLogout = async () => {
        await logout();
        setView('signup');
        setForm({ name: '', email: '', password: '', phone: '', notify: false });
    };

    const openAddAddr = () => {
        setAddrForm({ firstName: '', lastName: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'India', phone: '' });
        setAddrMessage('');
        setEditingAddr('new');
    };

    const openEditAddr = (addr) => {
        setAddrForm({
            firstName: addr.firstName || '',
            lastName: addr.lastName || '',
            address1: addr.address1 || '',
            address2: addr.address2 || '',
            city: addr.city || '',
            province: addr.province || '',
            zip: addr.zip || '',
            country: addr.country || 'India',
            phone: addr.phone || '',
        });
        setAddrMessage('');
        setEditingAddr(addr.id);
    };

    const handleAddrSubmit = async (e) => {
        e.preventDefault();
        setAddrLoading(true);
        setAddrMessage('');
        try {
            if (editingAddr === 'new') {
                await addAddress(addrForm);
            } else {
                await updateAddress(editingAddr, addrForm);
            }
            setEditingAddr(null);
        } catch (err) {
            setAddrMessage(err.message || 'Failed to save address.');
        } finally {
            setAddrLoading(false);
        }
    };

    // If customer is logged in, show profile
    if (customer) {
        const orders = customer.orders || [];
        const addresses = customer.addresses || [];

        return (
            <div className="profile-account-page">
                <div className="profile-account-container">
                    <div className="profile-account-header">
                        <h1 className="profile-account-title">MY ACCOUNT</h1>
                        <button onClick={handleLogout} className="profile-account-logout">LOGOUT</button>
                    </div>

                    <div className="profile-account-section">
                        <h2 className="profile-account-section-title">PERSONAL INFORMATION</h2>
                        <p className="profile-account-text">{customer.firstName} {customer.lastName}</p>
                        <p className="profile-account-text">{customer.email}</p>
                        {customer.phone && <p className="profile-account-text">{customer.phone}</p>}
                    </div>

                    {orders.length > 0 && (
                        <div className="profile-account-section">
                            <h2 className="profile-account-section-title">ORDER HISTORY</h2>
                            {orders.map(order => (
                                <div key={order.id} className="profile-order-card">
                                    <div className="profile-order-header">
                                        <span>Order {order.orderNumber}</span>
                                        <span>{new Date(order.processedAt).toLocaleDateString()}</span>
                                    </div>
                                    <div className="profile-order-details">
                                        <span>Status: {order.fulfillmentStatus}</span>
                                        <span>Total: {formatPrice(order.currentTotalPrice)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="profile-account-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h2 className="profile-account-section-title">ADDRESSES</h2>
                            {editingAddr === null && (
                                <button onClick={openAddAddr} className="profile-address-btn">+ ADD ADDRESS</button>
                            )}
                        </div>

                        {/* Add / Edit form */}
                        {editingAddr !== null && (
                            <form onSubmit={handleAddrSubmit} style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                {[
                                    { name: 'firstName', placeholder: 'FIRST NAME' },
                                    { name: 'lastName', placeholder: 'LAST NAME' },
                                    { name: 'address1', placeholder: 'ADDRESS LINE 1', full: true },
                                    { name: 'address2', placeholder: 'ADDRESS LINE 2 (OPTIONAL)', full: true },
                                    { name: 'city', placeholder: 'CITY' },
                                    { name: 'province', placeholder: 'STATE / PROVINCE' },
                                    { name: 'zip', placeholder: 'PIN / ZIP CODE' },
                                    { name: 'country', placeholder: 'COUNTRY' },
                                    { name: 'phone', placeholder: 'PHONE' },
                                ].map(field => (
                                    <input
                                        key={field.name}
                                        name={field.name}
                                        placeholder={field.placeholder}
                                        value={addrForm[field.name]}
                                        onChange={e => setAddrForm(p => ({ ...p, [field.name]: e.target.value }))}
                                        style={{
                                            gridColumn: field.full ? '1 / -1' : 'auto',
                                            background: 'transparent',
                                            border: '1px solid #333',
                                            color: '#fff',
                                            padding: '10px 12px',
                                            fontSize: '0.7rem',
                                            letterSpacing: '0.1em',
                                        }}
                                    />
                                ))}
                                {addrMessage && (
                                    <p style={{ gridColumn: '1 / -1', fontSize: '0.7rem', color: '#e88', letterSpacing: '0.1em' }}>{addrMessage}</p>
                                )}
                                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem' }}>
                                    <button type="submit" disabled={addrLoading} className="profile-address-btn">
                                        {addrLoading ? 'SAVING...' : 'SAVE ADDRESS'}
                                    </button>
                                    <button type="button" onClick={() => setEditingAddr(null)} className="profile-address-btn">
                                        CANCEL
                                    </button>
                                </div>
                            </form>
                        )}

                        {addresses.map(addr => (
                            <div key={addr.id} className="profile-address-card">
                                <p className="profile-account-text">{addr.firstName} {addr.lastName}</p>
                                <p className="profile-account-text">{addr.address1}{addr.address2 ? `, ${addr.address2}` : ''}</p>
                                <p className="profile-account-text">{addr.city}, {addr.province} {addr.zip}</p>
                                <p className="profile-account-text">{addr.country}</p>
                                <div className="profile-address-actions">
                                    <button onClick={() => setDefaultAddress(addr.id)} className="profile-address-btn">SET DEFAULT</button>
                                    <button onClick={() => openEditAddr(addr)} className="profile-address-btn">EDIT</button>
                                    <button onClick={() => deleteAddress(addr.id)} className="profile-address-btn">DELETE</button>
                                </div>
                            </div>
                        ))}

                        {addresses.length === 0 && editingAddr === null && (
                            <p className="profile-account-text" style={{ opacity: 0.5 }}>No addresses saved yet.</p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // NOT LOGGED IN — auth pages
    return (
        <div className="profile-auth-page">
            {/* Left image panel */}
            <div className="profile-auth-image">
                <img src="/login-side.jpg" alt="MORBEI Fashion" />
            </div>

            {/* Right form panel */}
            <div className="profile-auth-form-panel">
                {view === 'signup' && (
                    <div className="profile-auth-form-container">
                        <h1 className="profile-auth-title">CREATE YOUR ACCOUNT</h1>
                        {message && <p className="profile-auth-error">{message}</p>}
                        <form onSubmit={handleSignUp} className="profile-auth-form">
                            <div className="profile-auth-input-group">
                                <input
                                    name="name"
                                    type="text"
                                    placeholder="YOUR NAME"
                                    value={form.name}
                                    onChange={handleChange}
                                    className="profile-auth-input"
                                    required
                                />
                            </div>
                            <div className="profile-auth-input-group">
                                <input
                                    name="email"
                                    type="email"
                                    placeholder="EMAIL"
                                    value={form.email}
                                    onChange={handleChange}
                                    className="profile-auth-input"
                                    required
                                />
                            </div>
                            <div className="profile-auth-input-group">
                                <input
                                    name="password"
                                    type="password"
                                    placeholder="PASSWORD"
                                    value={form.password}
                                    onChange={handleChange}
                                    className="profile-auth-input"
                                    required
                                    minLength={5}
                                />
                            </div>
                            <div className="profile-auth-phone-row">
                                <span className="profile-auth-country-code">
                                    +91
                                    <svg viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.2"/>
                                    </svg>
                                </span>
                                <input
                                    name="phone"
                                    type="tel"
                                    placeholder="MOBILE"
                                    value={form.phone}
                                    onChange={handleChange}
                                    className="profile-auth-phone-input"
                                />
                            </div>

                            <label className="profile-auth-checkbox-row">
                                <input
                                    type="checkbox"
                                    name="notify"
                                    checked={form.notify}
                                    onChange={handleChange}
                                    className="profile-auth-checkbox"
                                />
                                <span className="profile-auth-checkbox-label">
                                    I would like to be notified on new releases
                                </span>
                            </label>

                            <button type="submit" disabled={loading} className="profile-auth-submit-btn">
                                {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
                            </button>
                            <button type="button" className="profile-auth-google-btn" onClick={() => setView('google-coming-soon')}>
                                <img src={GOOGLE_ICON} alt="Google" />
                                SIGN IN WITH GOOGLE
                            </button>
                        </form>

                        <div className="profile-auth-switch">
                            <span className="profile-auth-switch-text">Already have an account? </span>
                            <button
                                onClick={() => { setView('login'); setMessage(''); }}
                                className="profile-auth-switch-link"
                            >
                                Login
                            </button>
                        </div>
                    </div>
                )}

                {view === 'login' && (
                    <div className="profile-auth-form-container">
                        <h1 className="profile-auth-title">LOGIN</h1>
                        {message && <p className="profile-auth-error">{message}</p>}
                        <form onSubmit={handleLogin} className="profile-auth-form">
                            <div className="profile-auth-input-group">
                                <input
                                    name="email"
                                    type="email"
                                    placeholder="EMAIL"
                                    value={form.email}
                                    onChange={handleChange}
                                    className="profile-auth-input"
                                    required
                                />
                            </div>
                            <div className="profile-auth-input-group">
                                <input
                                    name="password"
                                    type="password"
                                    placeholder="PASSWORD"
                                    value={form.password}
                                    onChange={handleChange}
                                    className="profile-auth-input"
                                    required
                                />
                            </div>

                            <button
                                type="button"
                                onClick={() => { setView('recover'); setMessage(''); }}
                                className="profile-auth-forgot"
                            >
                                Forgot password?
                            </button>

                            <button type="submit" disabled={loading} className="profile-auth-submit-btn" style={{ marginTop: '16px' }}>
                                {loading ? 'LOGGING IN...' : 'LOGIN'}
                            </button>
                            <button type="button" className="profile-auth-google-btn" onClick={() => setView('google-coming-soon')}>
                                <img src={GOOGLE_ICON} alt="Google" />
                                SIGN IN WITH GOOGLE
                            </button>
                        </form>

                        <div className="profile-auth-switch">
                            <span className="profile-auth-switch-text">Don't have an account? </span>
                            <button
                                onClick={() => { setView('signup'); setMessage(''); }}
                                className="profile-auth-switch-link"
                            >
                                Create one
                            </button>
                        </div>
                    </div>
                )}

                {view === 'google-coming-soon' && (
                    <div className="profile-auth-form-container">
                        <h1 className="profile-auth-title">COMING SOON</h1>
                        <div className="profile-coming-soon">
                            <div className="profile-coming-soon-icon">
                                <img src={GOOGLE_ICON} alt="Google" className="profile-coming-soon-google" />
                            </div>
                            <p className="profile-coming-soon-text">
                                Google Sign-In is coming soon.<br />
                                Stay tuned for a seamless login experience.
                            </p>
                            <button
                                onClick={() => { setView('signup'); setMessage(''); }}
                                className="profile-auth-submit-btn"
                            >
                                BACK TO SIGN UP
                            </button>
                        </div>
                    </div>
                )}

                {view === 'recover' && (
                    <div className="profile-auth-form-container">
                        <h1 className="profile-auth-title">RECOVER PASSWORD</h1>
                        {message && <p className="profile-auth-message">{message}</p>}
                        <form onSubmit={handleRecover} className="profile-auth-form">
                            <div className="profile-auth-input-group">
                                <input
                                    name="email"
                                    type="email"
                                    placeholder="EMAIL"
                                    value={form.email}
                                    onChange={handleChange}
                                    className="profile-auth-input"
                                    required
                                />
                            </div>

                            <button type="submit" disabled={loading} className="profile-auth-submit-btn" style={{ marginTop: '24px' }}>
                                {loading ? 'SENDING...' : 'SEND RECOVERY EMAIL'}
                            </button>
                        </form>

                        <div className="profile-auth-switch">
                            <button
                                onClick={() => { setView('login'); setMessage(''); }}
                                className="profile-auth-switch-link"
                            >
                                Back to login
                            </button>
                        </div>
                    </div>
                )}

                {/* Legal footer */}
                <div className="profile-auth-legal">
                    <p className="profile-auth-legal-text">
                        By signing in or creating an account, you agree to our{' '}
                        <Link to="/privacy-policy" className="profile-auth-legal-link">Privacy Policy</Link>
                        {' '}and{' '}
                        <Link to="/terms" className="profile-auth-legal-link">Terms & Conditions</Link>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Profile;
