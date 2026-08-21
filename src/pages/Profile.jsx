import React, { useState } from 'react';
import { useCustomer } from '../hooks/useCustomer';
import { useCart } from '../hooks/useCart';
import { formatPrice } from '../utils/formatPrice';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import './Profile.css';
import SiteImage from '../components/SiteImage';

const GOOGLE_ICON = 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg';

const Profile = () => {
    const {
        customer, loading, error,
        login, signUp, logout, recoverPassword,
        updateProfile, addAddress, updateAddress, deleteAddress, setDefaultAddress
    } = useCustomer();
    const { cart } = useCart();
    const navigate = useNavigate();
    const location = useLocation();

    // Set when we redirected someone here mid-task (checkout needs a session).
    // Send them back the moment they're signed in rather than stranding them
    // on the account page to find their own way.
    const returnTo = location.state?.from || null;
    const returnToRef = React.useRef(returnTo);
    React.useEffect(() => {
        if (customer && returnToRef.current) {
            const dest = returnToRef.current;
            returnToRef.current = null;
            navigate(dest, { replace: true });
        }
    }, [customer, navigate]);

    const [view, setView] = useState(() => (location.state?.from ? 'login' : 'signup')); // login | signup | recover | google-coming-soon
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

                    <div className="profile-account-grid">
                        {/* Left column — personal info + orders */}
                        <div className="profile-account-main">
                            <section className="profile-account-section">
                                <div className="profile-section-head">
                                    <h2 className="profile-account-section-title">PERSONAL INFORMATION</h2>
                                </div>
                                <dl className="profile-info-list">
                                    <div className="profile-info-row">
                                        <dt>NAME</dt>
                                        <dd>{customer.firstName} {customer.lastName}</dd>
                                    </div>
                                    <div className="profile-info-row">
                                        <dt>EMAIL</dt>
                                        <dd className="profile-info-lower">{customer.email}</dd>
                                    </div>
                                    {customer.phone && (
                                        <div className="profile-info-row">
                                            <dt>PHONE</dt>
                                            <dd>{customer.phone}</dd>
                                        </div>
                                    )}
                                </dl>
                            </section>

                            <section className="profile-account-section">
                                <div className="profile-section-head">
                                    <h2 className="profile-account-section-title">ORDERS</h2>
                                    {orders.length > 0 && (
                                        <Link to="/order-details" className="profile-section-link">VIEW ALL</Link>
                                    )}
                                </div>

                                {orders.length > 0 ? (
                                    <div className="profile-orders">
                                        {orders.slice(0, 3).map(order => (
                                            <Link key={order.id} to="/order-details" className="profile-order-row">
                                                <div className="profile-order-row-top">
                                                    <span className="profile-order-num">ORDER #{order.orderNumber}</span>
                                                    <span className="profile-order-total">{formatPrice(order.currentTotalPrice)}</span>
                                                </div>
                                                <div className="profile-order-row-bottom">
                                                    <span>{new Date(order.processedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</span>
                                                    <span className="profile-order-status">{(order.fulfillmentStatus || 'PROCESSING').replace(/_/g, ' ')}</span>
                                                </div>
                                            </Link>
                                        ))}
                                        <Link to="/order-details" className="profile-track-btn">TRACK YOUR ORDERS</Link>
                                    </div>
                                ) : (
                                    <div className="profile-empty">
                                        <p className="profile-empty-text">YOU HAVEN'T PLACED ANY ORDERS YET</p>
                                        <Link to="/shop/all" className="profile-section-link">START SHOPPING</Link>
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* Right column — addresses */}
                        <div className="profile-account-side">
                            <section className="profile-account-section">
                                <div className="profile-section-head">
                                    <h2 className="profile-account-section-title">ADDRESSES</h2>
                                    {editingAddr === null && (
                                        <button onClick={openAddAddr} className="profile-section-link">+ ADD</button>
                                    )}
                                </div>

                                {/* Add / Edit form */}
                                {editingAddr !== null && (
                                    <form onSubmit={handleAddrSubmit} className="profile-addr-form">
                                        {[
                                            { name: 'firstName', placeholder: 'FIRST NAME' },
                                            { name: 'lastName', placeholder: 'LAST NAME' },
                                            { name: 'address1', placeholder: 'ADDRESS LINE 1', full: true },
                                            { name: 'address2', placeholder: 'ADDRESS LINE 2 (OPTIONAL)', full: true },
                                            { name: 'city', placeholder: 'CITY' },
                                            { name: 'province', placeholder: 'STATE / PROVINCE' },
                                            { name: 'zip', placeholder: 'PIN / ZIP CODE' },
                                            { name: 'country', placeholder: 'COUNTRY' },
                                            { name: 'phone', placeholder: 'PHONE', full: true },
                                        ].map(field => (
                                            <input
                                                key={field.name}
                                                name={field.name}
                                                placeholder={field.placeholder}
                                                value={addrForm[field.name]}
                                                onChange={e => setAddrForm(p => ({ ...p, [field.name]: e.target.value }))}
                                                className={`profile-addr-input${field.full ? ' profile-addr-input--full' : ''}`}
                                            />
                                        ))}
                                        {addrMessage && <p className="profile-addr-error">{addrMessage}</p>}
                                        <div className="profile-addr-form-actions">
                                            <button type="submit" disabled={addrLoading} className="profile-addr-save">
                                                {addrLoading ? 'SAVING...' : 'SAVE ADDRESS'}
                                            </button>
                                            <button type="button" onClick={() => setEditingAddr(null)} className="profile-section-link">
                                                CANCEL
                                            </button>
                                        </div>
                                    </form>
                                )}

                                {addresses.map(addr => (
                                    <div key={addr.id} className="profile-address-card">
                                        {addr.id === customer.defaultAddress?.id && (
                                            <span className="profile-address-default">DEFAULT</span>
                                        )}
                                        <p className="profile-address-name">{addr.firstName} {addr.lastName}</p>
                                        <p className="profile-account-text">{addr.address1}{addr.address2 ? `, ${addr.address2}` : ''}</p>
                                        <p className="profile-account-text">{addr.city}, {addr.province} {addr.zip}</p>
                                        <p className="profile-account-text">{addr.country}</p>
                                        {addr.phone && <p className="profile-account-text">{addr.phone}</p>}
                                        <div className="profile-address-actions">
                                            {addr.id !== customer.defaultAddress?.id && (
                                                <button onClick={() => setDefaultAddress(addr.id)} className="profile-section-link">SET DEFAULT</button>
                                            )}
                                            <button onClick={() => openEditAddr(addr)} className="profile-section-link">EDIT</button>
                                            <button onClick={() => deleteAddress(addr.id)} className="profile-section-link">DELETE</button>
                                        </div>
                                    </div>
                                ))}

                                {addresses.length === 0 && editingAddr === null && (
                                    <p className="profile-empty-text">NO ADDRESSES SAVED YET</p>
                                )}
                            </section>
                        </div>
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
                <SiteImage slot="account-side" fallback="/login-side.webp" alt="MORBEI Fashion" width={1000} widths={[600, 800, 1000]} sizes="50vw" />
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
                        <Link to="/privacy" className="profile-auth-legal-link">Privacy Policy</Link>
                        {' '}and{' '}
                        <Link to="/terms" className="profile-auth-legal-link">Terms & Conditions</Link>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Profile;
