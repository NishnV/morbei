import React, { useState } from 'react';
import { contactAPI } from '../lib/api';
import './SupportPage.css';

const Contact = () => {
    const [form, setForm] = useState({ name: '', email: '', message: '' });
    const [status, setStatus] = useState('idle'); // idle | loading | success | error
    const [errorMsg, setErrorMsg] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('loading');
        setErrorMsg('');
        try {
            await contactAPI.submit({ name: form.name, email: form.email, message: form.message });
            setStatus('success');
            setForm({ name: '', email: '', message: '' });
        } catch (err) {
            setErrorMsg(err.message || 'Failed to send. Please email us directly at care@morbei.com');
            setStatus('error');
        }
    };

    return (
        <div className="support-page">
            <div className="support-container">
                <div className="support-header">
                    <h1>CONTACT US</h1>
                    <p>WE ARE HERE TO ASSIST YOU</p>
                </div>

                <div className="support-content animate-fade">
                    <div className="grid-2">
                        <div className="support-section">
                            <h2>CUSTOMER CARE</h2>
                            <p>FOR ANY INQUIRIES REGARDING YOUR ORDER, SHIPMENT, OR OUR PRODUCTS, PLEASE REACH OUT TO US:</p>
                            <ul>
                                <li>EMAIL: CARE@MORBEI.COM</li>
                                <li>WHATSAPP: +91 98765 43210</li>
                                <li>HOURS: MON-SAT | 10:00 AM - 7:00 PM IST</li>
                            </ul>
                        </div>

                        <div className="support-section">
                            <h2>HEAD OFFICE</h2>
                            <p>MORBEI DESIGN STUDIO</p>
                            <ul>
                                <li>PIECE 42, TEXTILE DISTRICT</li>
                                <li>MUMBAI, MAHARASHTRA, 400013</li>
                                <li>INDIA</li>
                            </ul>
                        </div>
                    </div>

                    <div className="support-section" style={{ marginTop: '2rem' }}>
                        <h2>SEND US A MESSAGE</h2>
                        {status === 'success' && <p style={{ color: '#88c888', letterSpacing: '0.1em', fontSize: '0.8rem', marginBottom: '1rem' }}>MESSAGE SENT! WE WILL REPLY WITHIN 1–2 BUSINESS DAYS.</p>}
                        {status === 'error' && <p style={{ color: '#e88', letterSpacing: '0.1em', fontSize: '0.8rem', marginBottom: '1rem' }}>{errorMsg}</p>}
                        {status !== 'success' && (
                        <form className="track-form" onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>FULL NAME</label>
                                <input type="text" placeholder="YOUR NAME" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>EMAIL ADDRESS</label>
                                <input type="email" placeholder="YOUR@EMAIL.COM" required value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>MESSAGE</label>
                                <textarea rows="5" placeholder="HOW CAN WE HELP YOU?" required value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))}></textarea>
                            </div>
                            <button type="submit" className="submit-btn" disabled={status === 'loading'}>
                                {status === 'loading' ? 'SENDING...' : 'SEND MESSAGE'}
                            </button>
                        </form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Contact;
