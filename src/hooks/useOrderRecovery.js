/**
 * Reconcile a payment the browser never saw through to a confirmation.
 *
 * Runs once per app load. If a checkout was started and no confirmation was
 * ever shown, this asks the backend how that order actually ended up — the
 * webhook has almost certainly settled it by now — and closes the loop:
 *
 *  - Paid: clear the bag, because it still holds the items they bought, and
 *    a full bag reads as "the payment failed" to someone who is about to be
 *    charged twice. If they only just paid, show them the confirmation they
 *    missed rather than leaving them to find it in their order history.
 *  - Cancelled, or too old: forget it. Nothing to tell them.
 *  - Still unsettled: leave the marker alone and try again next load. The
 *    reconciler on the server is the real backstop.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../lib/api';
import { readPendingOrder, forgetPendingOrder } from '../lib/pendingOrder';
import { useCart } from './useCart';
import { useCustomer } from './useCustomer';

/** Rebuild what the confirmation page expects from a stored order. */
export function confirmationFromOrder(order) {
    const shippingCost = order.shippingMethod === 'priority' ? 200 : 0;
    return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        shopifyOrderId: order.shopifyOrderId,
        items: order.items || [],
        shippingAddress: order.shippingAddress || {},
        deliveryMethod: order.shippingMethod,
        shippingCost,
        total: order.totalAmount,
        subtotal: order.totalAmount - shippingCost,
        recovered: true,
    };
}

export function useOrderRecovery() {
    const navigate = useNavigate();
    const { clearCart } = useCart();
    const { customer, loading } = useCustomer();
    const ranFor = useRef(null);

    useEffect(() => {
        // Reading the order needs a session, so wait for one. Nothing is lost
        // by waiting: the marker persists until it is acted on.
        if (loading || !customer?.id) return;
        if (ranFor.current === customer.id) return;
        ranFor.current = customer.id;

        const pending = readPendingOrder();
        if (!pending) return;

        let cancelled = false;
        ordersAPI.get(pending.orderId)
            .then((order) => {
                if (cancelled || !order) return;

                if (order.status === 'paid') {
                    forgetPendingOrder();
                    clearCart();
                    if (pending.fresh) {
                        navigate('/order-confirmed', {
                            state: { order: confirmationFromOrder(order) },
                            replace: true,
                        });
                    }
                    return;
                }

                if (order.status === 'cancelled') forgetPendingOrder();
                // Anything else is still in flight — leave it for next time.
            })
            .catch(() => { /* offline, or the order isn't theirs — try again later */ });

        return () => { cancelled = true; };
    }, [customer, loading, clearCart, navigate]);
}
