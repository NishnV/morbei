// Delivery options — the single source of truth for what the storefront tells
// customers about shipping speed and cost.
//
// Six places used to state this independently (checkout options, the checkout
// footnote, the checkout header's date estimate, the product page accordion,
// the shipping policy page, and the meta description) and no two agreed: three
// different free-shipping thresholds that no code implemented, and a hardcoded
// 7-14 day estimate shown even when the customer paid for 3-5 day priority.
//
// Anything customer-facing about delivery reads from here — including the
// Shipping policy page and the FAQ, which for a while stated a different
// policy (free only above ₹9,900, and dispatch-plus-transit times by region)
// from the one checkout applied. The owners settled it on 14 Nov 2026:
// standard is free on every order, and the windows below are the promise,
// counted from the day of the order to the day it arrives.
// `priceRupees` must match SHIPPING_COST_RUPEES in server/routes/payment.js —
// that constant is what the customer is actually charged.

export const DELIVERY_OPTIONS = {
    standard: {
        key: 'standard',
        label: 'STANDARD',
        minDays: 7,
        maxDays: 14,
        priceRupees: 0,
        priceLabel: 'FREE',
    },
    priority: {
        key: 'priority',
        label: 'PRIORITY',
        minDays: 3,
        maxDays: 5,
        priceRupees: 200,
        priceLabel: 'RS. 200',
    },
};

/** Ordered for display: cheapest/slowest first. */
export const DELIVERY_LIST = [DELIVERY_OPTIONS.standard, DELIVERY_OPTIONS.priority];

/** Resolve a method key to its option, falling back to standard. */
export function getDeliveryOption(method) {
    return DELIVERY_OPTIONS[method] || DELIVERY_OPTIONS.standard;
}

/** Human-readable window, e.g. "7–14 business days". Order to doorstep. */
export function deliveryWindow(option) {
    return `${option.minDays}–${option.maxDays} business days`;
}

/** A delivery price as the policy pages write it: "₹200". */
export function deliveryPrice(option) {
    return `₹${option.priceRupees.toLocaleString('en-IN')}`;
}

// How long after delivery a return or exchange may be requested.
//
// The product page and the returns page's share preview both said 14 while
// the policy, the FAQ, the delivery email and the server all said 7. The
// server is what enforces it — RETURN_WINDOW_DAYS in server/routes/returns.js
// — so this must match that, and anything customer-facing reads from here.
export const RETURN_WINDOW_DAYS = 7;
