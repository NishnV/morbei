import React, { useMemo, useState } from 'react';
import './SupportPage.css';

/**
 * FAQ.
 *
 * Answers are the brand's own approved wording, used verbatim. They are not
 * derived from src/data/delivery.js, and two of them currently disagree with
 * it — deliberately, because this copy is the policy and the code is what has
 * drifted:
 *
 *   - Shipping time. This says 2-5 / 4-8 / 5-10 business days by region, which
 *     matches the Shipping policy page. delivery.js still offers STANDARD as
 *     7-14 business days, and that is what checkout shows.
 *   - Shipping cost. This says standard shipping is free at Rs. 9,900 and
 *     charged below it. delivery.js sets standard to priceRupees: 0 with no
 *     threshold, and SHIPPING_COST_RUPEES in server/routes/payment.js is what
 *     the customer is actually charged — so today nobody is charged.
 *
 * Fixing that means changing the money path, so it is not done here. Until it
 * is, this page states the intended policy and checkout does something else.
 */

const FAQS = [
    {
        question: 'HOW LONG DOES SHIPPING TAKE?',
        answer: 'Shipping typically takes 2\u20135 business days for metro cities, 4\u20138 business '
            + 'days for other cities and towns, and 5\u201310 business days for remote or rural '
            + 'areas. Delivery times are estimates and may vary due to courier operations, '
            + 'weather, public holidays, or unforeseen circumstances.',
    },
    {
        question: 'HOW MUCH DOES SHIPPING COST?',
        answer: 'We offer complimentary standard shipping on all domestic orders with a purchase '
            + 'value of \u20b99,900 or above. Orders below the free shipping threshold will incur a '
            + 'shipping charge, which will be calculated and displayed during checkout before '
            + 'payment is completed.',
    },
    {
        question: 'CAN I RETURN OR EXCHANGE MY ORDER?',
        answer: 'Returns and exchanges can be requested within 7 days of receiving your order. '
            + 'Items must be unused, unwashed, unworn, and in their original condition with all '
            + 'tags and packaging intact. Products damaged due to misuse, washing, or normal wear '
            + 'and tear are not eligible. Clearance, promotional, and Final Sale items are '
            + 'non-returnable and non-exchangeable, unless they arrive damaged or incorrect.',
    },
    {
        question: 'HOW DO I REQUEST A RETURN OR EXCHANGE?',
        answer: 'To request a return or exchange, contact us within 7 days of receiving your order '
            + 'at info@morbei.com with your order number and the reason for the request. Once your '
            + 'request is reviewed and approved, we\u2019ll share the next steps for returning your '
            + 'item.',
    },
    {
        question: 'WHAT SHOULD I DO IF MY ORDER ARRIVES DAMAGED OR I RECEIVE THE WRONG ITEM?',
        answer: 'If you receive a damaged, defective, or incorrect item, please contact us within '
            + '48 hours of delivery with clear photos or an unboxing video. We will resolve the '
            + 'issue by offering a replacement or refund after verification.',
    },
    {
        question: 'CAN I CHANGE OR CANCEL MY ORDER AFTER PLACING IT?',
        answer: 'Orders can be cancelled only before they are shipped. Once an order has been '
            + 'dispatched, it cannot be cancelled.',
    },
];

const Chevron = ({ open }) => (
    <svg
        className={`faq-chevron${open ? ' open' : ''}`}
        width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden="true"
    >
        <polyline points="1,1 10,10 19,1" stroke="currentColor" strokeWidth="1"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const FAQ = () => {
    const [activeIndex, setActiveIndex] = useState(null);
    const [query, setQuery] = useState('');

    // Titles only. Searching the answers as well pulled up rows whose question
    // had nothing to do with the term, which reads as the filter being broken.
    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return FAQS;
        return FAQS.filter(f => f.question.toLowerCase().includes(q));
    }, [query]);

    return (
        <div className="support-page faq-page">
            <div className="support-container">
                <div className="faq-head reveal reveal-down">
                    <h1 className="faq-title">FAQ</h1>
                    <input
                        type="search"
                        className="faq-search"
                        placeholder="SEARCH"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setActiveIndex(null); }}
                        aria-label="Search frequently asked questions"
                    />
                </div>

                <div className="support-content">
                    {results.map((faq) => {
                        // Keyed on the question, not the filtered index — otherwise
                        // narrowing the list would leave a different row expanded.
                        const open = activeIndex === faq.question;
                        return (
                            <div key={faq.question} className="faq-item">
                                <button
                                    className="faq-question"
                                    onClick={() => setActiveIndex(open ? null : faq.question)}
                                    aria-expanded={open}
                                >
                                    <span>{faq.question}</span>
                                    <Chevron open={open} />
                                </button>
                                {open && <div className="faq-answer">{faq.answer}</div>}
                            </div>
                        );
                    })}

                    {!results.length && (
                        <p className="faq-empty">
                            {/* Real characters: inside a JSX text node a \u escape is
                                literal text, not an escape sequence. */}
                            NOTHING MATCHES “{query.trim()}”. EMAIL INFO@MORBEI.COM AND
                            WE WILL ANSWER DIRECTLY.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FAQ;
