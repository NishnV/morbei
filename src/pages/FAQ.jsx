import React, { useState } from 'react';
import './SupportPage.css';

const FAQ = () => {
    const [activeIndex, setActiveIndex] = useState(null);

    const faqs = [
        {
            question: "HOW DO I TRACK MY ORDER?",
            answer: "ONCE YOUR ORDER IS SHIPPED, YOU WILL RECEIVE A CONFIRMATION EMAIL WITH A TRACKING NUMBER. YOU CAN USE THIS NUMBER ON OUR TRACK ORDER PAGE OR DIRECTLY ON THE COURIER'S WEBSITE TO LIVE-TRACK YOUR PACKAGE."
        },
        {
            question: "WHAT IS YOUR RETURN POLICY?",
            answer: "WE OFFER A 14-DAY RETURN POLICY FOR ALL UNUSED ITEMS IN THEIR ORIGINAL PACKAGING. PLEASE VISIT OUR RETURNS & EXCHANGES PAGE FOR DETAILED INSTRUCTIONS ON HOW TO INITIATE A RETURN."
        },
        {
            question: "DO YOU SHIP INTERNATIONALLY?",
            answer: "YES, MORBEI SHIPS TO OVER 50 COUNTRIES WORLDWIDE. INTERNATIONAL SHIPPING TIMES AND COSTS VARY BY LOCATION. PLEASE CHECK OUR SHIPPING PAGE FOR MORE DETAILS."
        },
        {
            question: "HOW CAN I CHANGE OR CANCEL MY ORDER?",
            answer: "ORDERS CAN BE CHANGED OR CANCELLED WITHIN 2 HOURS OF PLACEMENT. PLEASE CONTACT OUR CUSTOMER CARE TEAM IMMEDIATELY AT CARE@MORBEI.COM WITH YOUR ORDER NUMBER."
        },
        {
            question: "WHAT PAYMENT METHODS DO YOU ACCEPT?",
            answer: "WE ACCEPT ALL MAJOR CREDIT AND DEBIT CARDS, INCLUDING VISA, MASTERCARD, AND AMERICAN EXPRESS. WE ALSO OFFER UPI AND NET BANKING OPTIONS IN SELECT REGIONS."
        }
    ];

    return (
        <div className="support-page">
            <div className="support-container">
                <div className="support-header reveal reveal-down">
                    <h1>FREQUENTLY ASKED QUESTIONS</h1>
                    <p>FIND QUICK ANSWERS TO COMMON QUERIES</p>
                </div>
                <div className="support-content">
                    {faqs.map((faq, index) => (
                        <div key={index} className={`faq-item reveal reveal-up reveal-delay-${(index % 4) + 1}`}>
                            <button
                                className="faq-question"
                                onClick={() => setActiveIndex(activeIndex === index ? null : index)}
                            >
                                {faq.question}
                                <span>{activeIndex === index ? '—' : '+'}</span>
                            </button>
                            {activeIndex === index && (
                                <div className="faq-answer">
                                    {faq.answer}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FAQ;
