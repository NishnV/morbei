import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { createRazorpayOrder, verifyPaymentSignature, fetchPayment } from '../services/razorpay.js';
import { createDraftOrder, completeDraftOrder, gidToNumeric } from '../services/shopify-admin.js';
import { sendOrderConfirmation } from '../services/email.js';
import db from '../db/sqlite.js';

const router = Router();

// Step 1: Create Razorpay order
router.post('/create-order', authenticate, (req, res) => {
    (async () => {
        try {
            const { cartLines, shippingAddress, shippingMethod } = req.body;
            // cartLines: [{ variantId (GID), title, quantity, price (number in rupees) }]
            if (!cartLines?.length) return res.status(400).json({ error: 'Cart is empty' });

            const shippingCost = shippingMethod === 'priority' ? 200 : 0;
            const itemsTotal = cartLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
            const totalRupees = itemsTotal + shippingCost;
            const totalPaise = Math.round(totalRupees * 100);

            // Save pending order in DB
            const dbResult = db.prepare(
                `INSERT INTO orders (user_id, total_amount, shipping_method, shipping_address, items, status)
                 VALUES (?, ?, ?, ?, ?, 'pending')`
            ).run(
                req.user.id,
                totalPaise,
                shippingMethod || 'standard',
                JSON.stringify(shippingAddress),
                JSON.stringify(cartLines)
            );

            const receipt = `order_${dbResult.lastInsertRowid}`;
            const razorpayOrder = await createRazorpayOrder(totalPaise, 'INR', receipt);

            // Update DB with Razorpay order ID
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
            res.status(500).json({ error: err.message });
        }
    })();
});

// Step 2: Verify payment + create Shopify order + create Shiprocket shipment
router.post('/verify', authenticate, (req, res) => {
    (async () => {
        try {
            const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;

            // 1. Verify signature
            const valid = verifyPaymentSignature({
                orderId: razorpayOrderId,
                paymentId: razorpayPaymentId,
                signature: razorpaySignature,
            });
            if (!valid) return res.status(400).json({ error: 'Invalid payment signature' });

            // 2. Fetch payment details from Razorpay
            const payment = await fetchPayment(razorpayPaymentId);
            if (payment.status !== 'captured' && payment.status !== 'authorized') {
                return res.status(400).json({ error: `Payment status: ${payment.status}` });
            }

            // 3. Get order from DB
            const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id);
            if (!order) return res.status(404).json({ error: 'Order not found' });

            const cartLines = JSON.parse(order.items);
            const shippingAddress = JSON.parse(order.shipping_address);
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

            // 4. Create draft order in Shopify and complete it
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

            const draftOrderId = draft.draft_order.id;
            const completed = await completeDraftOrder(draftOrderId);
            const shopifyOrderId = completed.draft_order.order_id;

            // 5. Update DB
            db.prepare(
                `UPDATE orders SET
                    razorpay_payment_id = ?,
                    shopify_order_id = ?,
                    status = 'paid'
                WHERE id = ?`
            ).run(
                razorpayPaymentId,
                String(shopifyOrderId),
                orderId
            );

            // 6. Send order confirmation email (non-blocking)
            const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
            sendOrderConfirmation({
                order: updatedOrder,
                user,
                cartLines,
                shippingAddress,
                shopifyOrderId,
            }).catch(emailErr => console.error('Order email error (non-blocking):', emailErr.message));

            res.json({
                success: true,
                orderId,
                shopifyOrderId,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    })();
});

export default router;
