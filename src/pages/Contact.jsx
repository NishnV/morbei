import React, { useState } from 'react';
import { contactAPI } from '../lib/api';
import './SupportPage.css';

/**
 * Contact.
 *
 * The details here are the real ones. What was here before was scaffolding —
 * care@morbei.com, a +91 98765 43210 placeholder, and a Mumbai studio address
 * that does not exist — sitting on a live page where a customer with a problem
 * would have used them.
 */
const Contact = () => {
    const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' });
    const [status, setStatus] = useState('idle'); // idle | loading | success | error
    const [errorMsg, setErrorMsg] = useState('');

    const set = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setErrorMsg('');
        try {
            await contactAPI.submit(form);
            setStatus('success');
            setForm({ name: '', phone: '', email: '', message: '' });
        } catch (err) {
            setErrorMsg(err.message || 'Failed to send. Please email us directly at info@morbei.com');
            setStatus('error');
        }
    };

    return (
        <div className="support-page contact-page">
            <div className="contact-head">
                <h1 className="contact-title">CONTACT US</h1>
                <div className="contact-rule" />
            </div>

            <div className="contact-grid">
                <section className="contact-details">
                    <h2 className="contact-subhead">GET IN TOUCH</h2>
                    <p className="contact-body">
                        For enquiries regarding MORBEI, our collections, products, orders, or
                        services, please contact our support team,
                    </p>
                    <p className="contact-body">
                        Email: <a href="mailto:info@morbei.com">info@morbei.com</a><br />
                        Customer support: <a href="tel:+919952228533">+91 9952228533</a><br />
                        Opening hours: 11:00 AM - 5:00 PM<br />
                        Registered office address: No. 248, B Block, First Floor, F2,
                        Vigneshwara Nagar, Gerugambakkam, Chennai - 600128.
                    </p>
                </section>

                <section className="contact-form-col">
                    <h2 className="contact-subhead">SEND US A MESSAGE</h2>

                    {status === 'success' ? (
                        <p className="contact-note contact-note--ok">
                            Message sent. We will reply within 1-2 business days.
                        </p>
                    ) : (
                        <form className="contact-form" onSubmit={handleSubmit}>
                            {status === 'error' && (
                                <p className="contact-note contact-note--err">{errorMsg}</p>
                            )}

                            <label className="contact-field">
                                <span>FULL NAME</span>
                                <input type="text" required value={form.name} onChange={set('name')} autoComplete="name" />
                            </label>

                            <label className="contact-field">
                                <span>PHONE NUMBER</span>
                                <input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
                            </label>

                            <label className="contact-field">
                                <span>EMAIL</span>
                                <input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
                            </label>

                            <label className="contact-field">
                                <span>MESSAGE</span>
                                <textarea rows="6" required value={form.message} onChange={set('message')} />
                            </label>

                            <button type="submit" className="contact-submit" disabled={status === 'loading'}>
                                {status === 'loading' ? 'SENDING...' : 'SEND MESSAGE'}
                            </button>
                        </form>
                    )}
                </section>
            </div>
        </div>
    );
};

export default Contact;
