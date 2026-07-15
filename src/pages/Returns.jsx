import React from 'react';
import './SupportPage.css';

const Returns = () => {
    return (
        <div className="support-page">
            <div className="support-container">
                <div className="support-header">
                    <h1>RETURNS & EXCHANGES</h1>
                    <p>YOUR SATISFACTION IS OUR PRIORITY</p>
                </div>

                <div className="support-content animate-fade">
                    <div className="support-section">
                        <h2>EASY RETURNS</h2>
                        <p>IF YOU ARE NOT ENTIRELY SATISFIED WITH YOUR PURCHASE, WE ARE HERE TO HELP.</p>
                        <ul>
                            <li>YOU HAVE 14 CALENDAR DAYS TO RETURN AN ITEM FROM THE DATE YOU RECEIVED IT.</li>
                            <li>TO BE ELIGIBLE FOR A RETURN, YOUR ITEM MUST BE UNUSED AND IN THE SAME CONDITION THAT YOU RECEIVED IT.</li>
                            <li>ITEM MUST BE IN THE ORIGINAL PACKAGING WITH ALL TAGS ATTACHED.</li>
                        </ul>
                    </div>

                    <div className="support-section">
                        <h2>EXCHANGE POLICY</h2>
                        <p>WE OFFER SIZE EXCHANGES FREE OF CHARGE, SUBJECT TO AVAILABILITY.</p>
                        <ul>
                            <li>ONCE THE EXCHANGE REQUEST IS APPROVED, WE WILL ARRANGE A REVERSE PICKUP.</li>
                            <li>AFTER WE RECEIVE AND INSPECT THE ORIGINAL ITEM, THE NEW SIZE WILL BE DISPATCHED.</li>
                        </ul>
                    </div>

                    <div className="support-section">
                        <h2>REFUNDS</h2>
                        <p>ONCE WE RECEIVE YOUR ITEM, WE WILL INSPECT IT AND NOTIFY YOU THAT WE HAVE RECEIVED YOUR RETURNED ITEM.</p>
                        <p>IF YOUR RETURN IS APPROVED, WE WILL INITIATE A REFUND TO YOUR ORIGINAL METHOD OF PAYMENT. CREDITS WILL APPEAR WITHIN 5-10 BUSINESS DAYS.</p>
                    </div>

                    <div className="support-section">
                        <h2>NON-RETURNABLE ITEMS</h2>
                        <ul>
                            <li>ITEMS PURCHASED ON FINAL SALE.</li>
                            <li>CUSTOMIZED OR ALTERED GARMENTS.</li>
                            <li>INTIMATES AND ACCESSORIES FOR HYGIENE REASONS.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Returns;
