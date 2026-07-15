import React from 'react';
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
                        <p>WE OFFER FREE STANDARD SHIPPING ON ALL DOMESTIC ORDERS ABOVE RS. 5000.</p>
                        <ul>
                            <li>METRO CITIES: 3-5 BUSINESS DAYS.</li>
                            <li>OTHER REGIONS: 5-7 BUSINESS DAYS.</li>
                            <li>EXPRESS SHIPPING AVAILABLE AT CHECKOUT FOR NOMINAL FEE.</li>
                        </ul>
                    </div>

                    <div className="support-section">
                        <h2>INTERNATIONAL SHIPPING</h2>
                        <p>MORBEI SHIPS GLOBALLY VIA DHL AND FEDEX.</p>
                        <ul>
                            <li>SHIPPING COSTS CALCULATED AT CHECKOUT BASED ON WEIGHT AND DESTINATION.</li>
                            <li>DELIVERY TIME: 7-12 BUSINESS DAYS.</li>
                            <li>CUSTOMS AND IMPORT DUTIES ARE PAYABLE BY THE CUSTOMER UPON RECEIPT.</li>
                        </ul>
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
