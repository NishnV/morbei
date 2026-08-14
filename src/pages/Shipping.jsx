import React from 'react';
import { DELIVERY_LIST, deliveryWindow } from '../data/delivery';
import './SupportPage.css';

const Shipping = () => {
    return (
        <div className="support-page">
            <div className="support-container">
                <div className="support-header">
                    <h1>SHIPPING POLICY</h1>
                    <p>HOW WE DELIVER EXCELLENCE TO YOUR DOORSTEP</p>
                </div>

                <div className="support-content animate-fade">
                    <div className="support-section">
                        <h2>DOMESTIC SHIPPING (INDIA)</h2>
                        <p>WE OFFER FREE STANDARD SHIPPING ON ALL DOMESTIC ORDERS.</p>
                        {/* Rendered from src/data/delivery.js so this page can never
                            quote a different window than the checkout charges for. */}
                        <ul>
                            {DELIVERY_LIST.map(option => (
                                <li key={option.key}>
                                    {option.label}: {deliveryWindow(option).toUpperCase()} — {option.priceLabel}.
                                </li>
                            ))}
                            <li>METRO CITIES TYPICALLY ARRIVE AT THE EARLIER END OF THESE WINDOWS.</li>
                        </ul>
                    </div>

                    <div className="support-section">
                        <h2>INTERNATIONAL SHIPPING</h2>
                        <p>MORBEI CURRENTLY SHIPS WITHIN INDIA ONLY.</p>
                        <p>WE ARE WORKING ON INTERNATIONAL DELIVERY. JOIN OUR MAILING LIST BELOW TO HEAR WHEN IT LAUNCHES.</p>
                    </div>

                    <div className="support-section">
                        <h2>ORDER PROCESSING</h2>
                        <p>ALL ORDERS ARE PROCESSED WITHIN 24-48 HOURS (EXCLUDING SUNDAYS AND PUBLIC HOLIDAYS).</p>
                        <p>DURING SALE PERIODS, PROCESSING TIMES MAY EXTEND BY 2-3 BUSINESS DAYS DUE TO INCREASED VOLUME.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Shipping;
