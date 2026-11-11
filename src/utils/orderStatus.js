/**
 * One definition of how far an order has got, shared by every page that
 * shows it.
 *
 * Three pages used to each decide for themselves, and they disagreed: the
 * order tracker read the shipment status, the profile printed Shopify's raw
 * `UNFULFILLED` at the customer, and the track-order page announced a merely
 * fulfilled order as DELIVERED.
 *
 * Shopify splits the answer across two fields and both are needed:
 * `fulfillmentStatus` says the parcel left (null | 'partial' | 'fulfilled'),
 * while delivery lives on `shipmentStatus`, which exists only once a
 * fulfillment event has been posted for it.
 */

export const FULFILLMENT_STEPS = ['ORDER PLACED', 'PACKED', 'SHIPPED', 'OUT FOR DELIVERY', 'DELIVERED'];

// What to call the order when it is sitting at each of those steps. "ORDER
// PLACED" is a milestone; "PROCESSING" is the state of being at it.
const STATUS_LABELS = ['PROCESSING', 'PACKED', 'SHIPPED', 'OUT FOR DELIVERY', 'DELIVERED'];

/** How many of FULFILLMENT_STEPS are complete, 0–4. */
export function getStatusIndex(order) {
    if (!order) return 0;

    // Our own record of the delivery outranks Shopify's: it is what the
    // returns window is measured from, and it survives a tracking outage.
    if (order.deliveredAt) return 4;

    const shipment = (order.shipmentStatus || '').toLowerCase();
    if (shipment === 'delivered') return 4;
    if (shipment === 'out_for_delivery' || shipment === 'attempted_delivery') return 3;
    if (shipment === 'in_transit' || shipment === 'confirmed' || shipment === 'picked_up') return 2;

    // Fulfilled in Shopify but no shipment event yet. The parcel has left,
    // which is SHIPPED and no further — Shopify has no delivered status of
    // its own, so going beyond this would be guessing on the customer's behalf.
    if (order.fulfillmentStatus === 'fulfilled') return 2;
    if (order.fulfillmentStatus === 'partial') return 1;
    return 0;
}

/** A word for the customer. Never Shopify's vocabulary. */
export function getStatusLabel(order) {
    if (order?.status === 'cancelled') return 'CANCELLED';
    return STATUS_LABELS[getStatusIndex(order)];
}

/**
 * Whether a return or exchange can be started from this order.
 *
 * Deliberately not gated on delivery. Delivery is only known when someone has
 * marked it, so gating on it would hide the entry point to the returns flow
 * on every order that was fulfilled by hand and never marked — which is most
 * of them. Shipped is the honest earliest point: the customer has something
 * in their hands, or soon will.
 */
export function canReturn(order) {
    return order?.status !== 'cancelled' && getStatusIndex(order) >= 2;
}
