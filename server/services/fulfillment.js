import { createDraftOrder, completeDraftOrder, getOrder, gidToNumeric } from './shopify-admin.js';
import { sendOrderConfirmation, sendFulfillmentFailureAlert } from './email.js';
import { notifySlackError } from './slack.js';
import { get, run } from '../db/pg.js';

// The single source of truth for what a customer is charged for delivery.
// Four places in the UI used to quote four different free-shipping thresholds
// that no code implemented — if you change this, change the copy too:
//   src/pages/Checkout.jsx      (delivery-footnote + option descriptions)
//   src/pages/ProductDetail.jsx (SHIPPING accordion)
//   src/pages/Shipping.jsx      (DOMESTIC SHIPPING section)
//   index.html                  (meta description)
export const SHIPPING_COST_RUPEES = { standard: 0, priority: 200 };


/**
 * Fulfill a paid order: create + complete the Shopify order, mark paid, email.
 * Idempotent — claims the order atomically so /verify and the webhook can
 * both call this without creating duplicate Shopify orders.
 */
export async function fulfillPaidOrder(order, razorpayPaymentId) {
    const claimed = await run(
        `UPDATE orders SET status = 'processing', razorpay_payment_id = $1 WHERE id = $2 AND status = 'pending'`,
        [razorpayPaymentId, order.id]
    );
    if (claimed.rowCount === 0) {
        // The other caller may have finished after our stale read — refetch
        const fresh = await get('SELECT shopify_order_id, shopify_order_number FROM orders WHERE id = $1', [order.id]);
        return {
            alreadyProcessed: true,
            shopifyOrderId: fresh?.shopify_order_id || order.shopify_order_id,
            orderNumber: fresh?.shopify_order_number || null,
        };
    }

    try {
        const cartLines = JSON.parse(order.items);
        const shippingAddress = JSON.parse(order.shipping_address);
        const user = await get('SELECT * FROM users WHERE id = $1', [order.user_id]);

        const shopifyLineItems = cartLines.map(l => ({
            variant_id: gidToNumeric(l.variantId),
            quantity: l.quantity,
        }));

        // city is now collected and validated at checkout — it must never fall
        // back to the state again, which put the state name on every label.
        const shopifyAddr = {
            first_name: shippingAddress.firstName || user.first_name,
            last_name: shippingAddress.lastName || user.last_name,
            address1: shippingAddress.address,
            city: shippingAddress.city,
            province: shippingAddress.state,
            zip: shippingAddress.zip,
            country: shippingAddress.country || 'India',
            phone: shippingAddress.phone || user.phone,
        };

        // Record what the customer actually paid for delivery on the Shopify
        // order, so its total matches the Razorpay capture. Free standard
        // shipping still sends a ₹0 line — an explicit "Standard, free" reads
        // better on the order than no shipping line at all.
        const shippingMethodKey = order.shipping_method === 'priority' ? 'priority' : 'standard';
        const shippingRupees = SHIPPING_COST_RUPEES[shippingMethodKey];

        const draft = await createDraftOrder({
            lineItems: shopifyLineItems,
            shippingAddress: shopifyAddr,
            email: user.email,
            note: `Razorpay Payment: ${razorpayPaymentId}`,
            shippingLine: {
                title: shippingMethodKey === 'priority' ? 'Priority' : 'Standard',
                price: shippingRupees.toFixed(2),
            },
        });
        const completed = await completeDraftOrder(draft.draft_order.id);
        const shopifyOrderId = completed.draft_order.order_id;

        // Shopify's sequential order number is the customer-facing one; if the
        // lookup fails, emails/pages fall back to the local id rather than block
        let shopifyOrderNumber = null;
        try {
            const orderData = await getOrder(shopifyOrderId);
            shopifyOrderNumber = orderData?.order?.order_number ?? null;

            // The Shopify order is marked fully paid regardless of its total, so
            // any divergence from what Razorpay actually captured is invisible
            // until the books are reconciled by hand. The usual cause is tax
            // configured on the store being added on top of our MRP-inclusive
            // prices. Alert rather than fail — the customer has already paid.
            const shopifyTotalPaise = Math.round(parseFloat(orderData?.order?.total_price || '0') * 100);
            const capturedPaise = Number(order.total_amount);
            if (shopifyTotalPaise && shopifyTotalPaise !== capturedPaise) {
                const msg = `Order ${order.id} (Shopify #${shopifyOrderNumber}): captured ₹${capturedPaise / 100} `
                    + `but Shopify order total is ₹${shopifyTotalPaise / 100}. Check tax settings and shipping lines.`;
                console.error(msg);
                notifySlackError('Order total mismatch', new Error(msg)).catch(() => {});
            }
        } catch (numErr) {
            console.error('Could not fetch Shopify order number:', numErr.message);
        }

        await run(`UPDATE orders SET shopify_order_id = $1, shopify_order_number = $2, status = 'paid' WHERE id = $3`,
            [String(shopifyOrderId), shopifyOrderNumber, order.id]);

        const updatedOrder = await get('SELECT * FROM orders WHERE id = $1', [order.id]);
        sendOrderConfirmation({
            order: updatedOrder,
            user,
            cartLines,
            shippingAddress,
            shopifyOrderId,
        }).catch(emailErr => console.error('Order email error (non-blocking):', emailErr.message));

        return { alreadyProcessed: false, shopifyOrderId, orderNumber: shopifyOrderNumber };
    } catch (err) {
        // Payment is captured but Shopify order creation failed — flag for manual follow-up,
        // and let the webhook retry by not leaving it stuck in 'processing'.
        await run(`UPDATE orders SET status = 'pending' WHERE id = $1 AND status = 'processing'`, [order.id]);
        const owner = await get('SELECT email FROM users WHERE id = $1', [order.user_id]).catch(() => null);
        sendFulfillmentFailureAlert({
            orderId: order.id,
            razorpayPaymentId,
            userEmail: owner?.email || 'unknown',
            amountPaise: order.total_amount,
            errorMessage: err.message,
        }).catch(alertErr => console.error('Fulfillment alert email failed:', alertErr.message));
        throw err;
    }
}
