import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { createRazorpayOrder, verifyPaymentSignature, fetchPayment } from '../services/razorpay.js';
import { createDraftOrder, completeDraftOrder, getVariant, gidToNumeric } from '../services/shopify-admin.js';
import { sendOrderConfirmation } from '../services/email.js';
import db from '../db/sqlite.js';

const router = Router();

const SHIPPING_COST_RUPEES = { standard: 0, priority: 200 };
const MAX_QUANTITY_PER_LINE = 20;
const MAX_CART_LINES = 30;

// Step 1: Create Razorpay order — prices come from Shopify, never from the client
router.post('/create-order', authenticate, async (req, res) => {
    try {
        const { cartLines, shippingAddress, shippingMethod } = req.body;
        // cartLines: [{ variantId (GID), title, quantity, image, selectedOptions }]
        if (!Array.isArray(cartLines) || cartLines.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        if (cartLines.length > MAX_CART_LINES) {
            return res.status(400).json({ error: 'Too many items in cart' });
        }

        // Validate and re-price every line against Shopify
        const pricedLines = await Promise.all(cartLines.map(async (line) => {
            const numericId = gidToNumeric(line.variantId);
            const quantity = Number(line.quantity);
            if (!numericId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
                throw Object.assign(new Error('Invalid cart line'), { statusCode: 400 });
            }
            const variant = await getVariant(numericId);
            return {
                variantId: line.variantId,
                title: line.title,
                quantity,
                price: parseFloat(variant.price), // authoritative price in rupees
                image: line.image,
                selectedOptions: line.selectedOptions,
            };
        }));

        const method = shippingMethod === 'priority' ? 'priority' : 'standard';
        const shippingCost = SHIPPING_COST_RUPEES[method];
        const itemsTotal = pricedLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
        const totalPaise = Math.round((itemsTotal + shippingCost) * 100);

        // Save pending order in DB with server-verified prices
        const dbResult = db.prepare(
            `INSERT INTO orders (user_id, total_amount, shipping_method, shipping_address, items, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`
        ).run(
            req.user.id,
            totalPaise,
            method,
            JSON.stringify(shippingAddress),
            JSON.stringify(pricedLines)
        );

        const receipt = `order_${dbResult.lastInsertRowid}`;
        const razorpayOrder = await createRazorpayOrder(totalPaise, 'INR', receipt);

        db.prepare('UPDATE orders SET razorpay_order_id = ? WHERE id = ?')
            .run(razorpayOrder.id, dbResult.lastInsertRowid);

        res.json({
            orderId: dbResult.lastInsertRowid,
            razorpayOrderId: razorpayOrder.id,
            amount: totalPaise,
            currency: 'INR',
            keyId: process.env.RAZORPAY_KEY_ID,
        });
    } catch (err) {
        console.error('create-order error:', err);
        res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : 'Could not create order. Please try again.',
        });
    }
});

/**
 * Fulfill a paid order: create + complete the Shopify order, mark paid, email.
 * Idempotent — claims the order atomically so /verify and the webhook can
 * both call this without creating duplicate Shopify orders.
 */
async function fulfillPaidOrder(order, razorpayPaymentId) {
    const claimed = db.prepare(
        `UPDATE orders SET status = 'processing', razorpay_payment_id = ? WHERE id = ? AND status = 'pending'`
    ).run(razorpayPaymentId, order.id);
    if (claimed.changes === 0) {
        return { alreadyProcessed: true, shopifyOrderId: order.shopify_order_id };
    }

    try {
        const cartLines = JSON.parse(order.items);
        const shippingAddress = JSON.parse(order.shipping_address);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);

        const shopifyLineItems = cartLines.map(l => ({
            variant_id: gidToNumeric(l.variantId),
            quantity: l.quantity,
        }));

        const shopifyAddr = {
            first_name: shippingAddress.firstName || user.first_name,
            last_name: shippingAddress.lastName || user.last_name,
            address1: shippingAddress.address,
            city: shippingAddress.city || shippingAddress.state,
            province: shippingAddress.state,
            zip: shippingAddress.zip,
            country: shippingAddress.country || 'India',
            phone: shippingAddress.phone || user.phone,
        };

        const draft = await createDraftOrder({
            lineItems: shopifyLineItems,
            shippingAddress: shopifyAddr,
            email: user.email,
            note: `Razorpay Payment: ${razorpayPaymentId}`,
        });
        const completed = await completeDraftOrder(draft.draft_order.id);
        const shopifyOrderId = completed.draft_order.order_id;

        db.prepare(`UPDATE orders SET shopify_order_id = ?, status = 'paid' WHERE id = ?`)
            .run(String(shopifyOrderId), order.id);

        const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
        sendOrderConfirmation({
            order: updatedOrder,
            user,
            cartLines,
            shippingAddress,
            shopifyOrderId,
        }).catch(emailErr => console.error('Order email error (non-blocking):', emailErr.message));

        return { alreadyProcessed: false, shopifyOrderId };
    } catch (err) {
        // Payment is captured but Shopify order creation failed — flag for manual follow-up,
        // and let the webhook retry by not leaving it stuck in 'processing'.
        db.prepare(`UPDATE orders SET status = 'pending' WHERE id = ? AND status = 'processing'`).run(order.id);
        throw err;
    }
}

// Step 2: Verify payment + create Shopify order
router.post('/verify', authenticate, async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;

        const valid = verifyPaymentSignature({
            orderId: razorpayOrderId,
            paymentId: razorpayPaymentId,
            signature: razorpaySignature,
        });
        if (!valid) return res.status(400).json({ error: 'Invalid payment signature' });

        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.razorpay_order_id !== razorpayOrderId) {
            return res.status(400).json({ error: 'Order mismatch' });
        }

        const payment = await fetchPayment(razorpayPaymentId);
        if (payment.status !== 'captured' && payment.status !== 'authorized') {
            return res.status(400).json({ error: `Payment status: ${payment.status}` });
        }
        // The payment must belong to this Razorpay order and cover the full amount
        if (payment.order_id !== order.razorpay_order_id || payment.amount !== order.total_amount) {
            return res.status(400).json({ error: 'Payment does not match order' });
        }

        const result = await fulfillPaidOrder(order, razorpayPaymentId);
        res.json({ success: true, orderId: order.id, shopifyOrderId: result.shopifyOrderId });
    } catch (err) {
        console.error('verify error:', err);
        res.status(500).json({ error: 'Payment verification failed. If you were charged, contact support with your payment ID.' });
    }
});

// Razorpay webhook — safety net when the customer closes the tab before /verify runs.
// Configure in Razorpay Dashboard → Webhooks → event: payment.captured
router.post('/webhook', async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
            console.error('RAZORPAY_WEBHOOK_SECRET not set — webhook rejected');
            return res.status(500).json({ error: 'Webhook not configured' });
        }

        const signature = req.headers['x-razorpay-signature'];
        if (!signature || !req.rawBody) return res.status(400).json({ error: 'Missing signature' });

        const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return res.status(400).json({ error: 'Invalid signature' });
        }

        const event = req.body;
        if (event.event === 'payment.captured') {
            const payment = event.payload?.payment?.entity;
            const order = payment?.order_id
                ? db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?').get(payment.order_id)
                : null;

            if (order && order.status === 'pending' && payment.amount === order.total_amount) {
                await fulfillPaidOrder(order, payment.id);
                console.log(`Webhook fulfilled order ${order.id} (payment ${payment.id})`);
            }
        }

        // Always 200 for valid signatures so Razorpay doesn't retry forever
        res.json({ received: true });
    } catch (err) {
        console.error('webhook error:', err);
        // 500 → Razorpay will retry, which is what we want for transient failures
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

export default router;
