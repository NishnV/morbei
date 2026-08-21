import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { createRazorpayOrder, verifyPaymentSignature, fetchPayment } from '../services/razorpay.js';
import { getVariant, gidToNumeric } from '../services/shopify-admin.js';
import { fulfillPaidOrder, SHIPPING_COST_RUPEES } from '../services/fulfillment.js';
import { notifySlackError } from '../services/slack.js';
import { get, run } from '../db/pg.js';

const router = Router();

const MAX_QUANTITY_PER_LINE = 20;
const MAX_CART_LINES = 30;

// How long after a fulfilment claim we assume the claimer is dead rather than
// slow. Fulfilment is three sequential Shopify calls — seconds, not minutes —
// so this is generous by an order of magnitude.
const STALE_CLAIM_SECONDS = 5 * 60;

/**
 * A variant's tracked stock level, or null when Shopify isn't reporting one.
 *
 * Number(null) and Number('') are both 0, not NaN, so the empty values have to
 * be rejected before coercion — otherwise "unknown" silently becomes "zero".
 */
function trackedQuantity(variant) {
    const raw = variant.inventory_quantity;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

/**
 * Whether Shopify has enough stock of a variant to cover the requested quantity.
 *
 * Deliberately fails *open*: it only reports insufficient stock when Shopify
 * gave us a real number and a real deny policy. Blocking a legitimate order
 * because an API version stopped returning a field is worse than the oversell
 * this guards against — the client-side availability flag still fronts it.
 */
function hasSufficientStock(variant, quantity) {
    // 'continue' means the store explicitly permits overselling this variant
    // (made-to-order, preorder). That's a merchandising decision, not a bug.
    if (variant.inventory_policy === 'continue') return true;

    // null = the store isn't tracking stock for this variant. Only trust an
    // *explicit* null; an absent field means the API didn't tell us, so fall
    // through to the quantity check rather than silently skipping it.
    if (variant.inventory_management === null) return true;

    // No usable number means we have nothing to block on.
    const available = trackedQuantity(variant);
    if (available === null) return true;

    return available >= quantity;
}

// Countries we ship to. Fulfilment is manual and shipping is priced as a flat
// INR domestic rate, so a foreign address would be charged ₹0 delivery for a
// parcel we have no rate card to send. The checkout dropdown offers India only;
// this is the enforcement — clients can post anything.
// Mirrors SHIPPABLE_COUNTRIES in src/data/countries.js.
const SHIPPABLE_COUNTRIES = ['india'];

const INDIA_PIN = /^\d{6}$/;
const INDIA_MOBILE = /^(\+?91[-\s]?)?[6-9]\d{9}$/;

/**
 * Validate a shipping address hard enough that the resulting label is actually
 * deliverable. Returns an error string, or null when the address is usable.
 *
 * These used to be enforced client-side only (and `city` not at all — the
 * server substituted the state, so every label carried the state as the city).
 */
function validateShippingAddress(addr) {
    const required = ['firstName', 'lastName', 'phone', 'address', 'city', 'state', 'zip'];
    for (const field of required) {
        if (typeof addr[field] !== 'string' || !addr[field].trim() || addr[field].length > 300) {
            return `Invalid shipping address: ${field}`;
        }
    }

    const country = (addr.country || 'India').trim();
    if (!SHIPPABLE_COUNTRIES.includes(country.toLowerCase())) {
        return 'We currently ship within India only';
    }

    if (!INDIA_PIN.test(addr.zip.trim())) {
        return 'Invalid shipping address: PIN code must be 6 digits';
    }
    if (!INDIA_MOBILE.test(addr.phone.replace(/[\s-]/g, ''))) {
        return 'Invalid shipping address: enter a valid 10-digit mobile number';
    }

    return null;
}

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

        // The address ends up on the Shopify order and shipping label — make
        // sure the essentials are present and sane before taking money.
        const addr = shippingAddress || {};
        const addrError = validateShippingAddress(addr);
        if (addrError) {
            return res.status(400).json({ error: addrError });
        }

        // Validate, re-price AND stock-check every line against Shopify.
        // Availability is as authoritative as price: the client's `available`
        // flag is a snapshot from page load and says nothing about now.
        const checked = await Promise.all(cartLines.map(async (line) => {
            const numericId = gidToNumeric(line.variantId);
            const quantity = Number(line.quantity);
            if (!numericId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
                throw Object.assign(new Error('Invalid cart line'), { statusCode: 400 });
            }
            const variant = await getVariant(numericId);
            return {
                inStock: hasSufficientStock(variant, quantity),
                remaining: trackedQuantity(variant),
                priced: {
                    variantId: line.variantId,
                    title: line.title,
                    quantity,
                    price: parseFloat(variant.price), // authoritative price in rupees
                    image: line.image,
                    selectedOptions: line.selectedOptions,
                },
            };
        }));

        // Report every unavailable line at once — drip-feeding them one refresh
        // at a time is how you lose a customer who has already filled in an address.
        const unavailable = checked.filter(c => !c.inStock);
        if (unavailable.length > 0) {
            throw Object.assign(
                new Error(
                    unavailable.length === 1
                        ? `${unavailable[0].priced.title || 'An item'} is no longer available in the quantity requested`
                        : 'Some items in your bag are no longer available in the quantity requested'
                ),
                {
                    statusCode: 409,
                    outOfStock: unavailable.map(c => ({
                        variantId: c.priced.variantId,
                        title: c.priced.title,
                        requested: c.priced.quantity,
                        remaining: c.remaining,
                    })),
                }
            );
        }

        const pricedLines = checked.map(c => c.priced);

        const method = shippingMethod === 'priority' ? 'priority' : 'standard';
        const shippingCost = SHIPPING_COST_RUPEES[method];

        // Total in integer paise throughout: round each unit price to paise
        // (exact for two-decimal INR), multiply by an integer quantity, then sum
        // integers. Accumulating rupee floats and rounding once at the end also
        // works today, but it stops being safe the moment per-line discounts or
        // percentage tax land on this path.
        // NOTE: pricedLines[].price stays in RUPEES — it is persisted in
        // orders.items and rendered by the emails and order pages. Changing that
        // shape would make every existing order row display 100x too high.
        const itemsPaise = pricedLines.reduce(
            (sum, l) => sum + Math.round(l.price * 100) * l.quantity,
            0
        );
        const totalPaise = itemsPaise + shippingCost * 100;

        // Save pending order in DB with server-verified prices
        const inserted = await get(
            `INSERT INTO orders (user_id, total_amount, shipping_method, shipping_address, items, status)
             VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
            [req.user.id, totalPaise, method, JSON.stringify(shippingAddress), JSON.stringify(pricedLines)]
        );

        const receipt = `order_${inserted.id}`;
        const razorpayOrder = await createRazorpayOrder(totalPaise, 'INR', receipt);

        await run('UPDATE orders SET razorpay_order_id = $1 WHERE id = $2', [razorpayOrder.id, inserted.id]);

        res.json({
            orderId: inserted.id,
            razorpayOrderId: razorpayOrder.id,
            amount: totalPaise,
            currency: 'INR',
            keyId: process.env.RAZORPAY_KEY_ID,
        });
    } catch (err) {
        console.error('create-order error:', err);
        if (!err.statusCode) notifySlackError('create-order failed', err).catch(() => {});
        res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : 'Could not create order. Please try again.',
            // Lets the checkout name the specific lines to fix instead of
            // sending the customer back to the bag to guess.
            ...(err.outOfStock ? { outOfStock: err.outOfStock } : {}),
        });
    }
});

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

        const order = await get('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, req.user.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.razorpay_order_id !== razorpayOrderId) {
            return res.status(400).json({ error: 'Order mismatch' });
        }

        const payment = await fetchPayment(razorpayPaymentId);
        // Only 'captured' is money in the account. An 'authorized' payment is a
        // hold that can still expire or fail to capture — fulfilling against it
        // ships goods for a payment that may never settle.
        if (payment.status !== 'captured') {
            return res.status(400).json({ error: `Payment status: ${payment.status}` });
        }
        // The payment must belong to this Razorpay order and cover the full amount
        if (payment.order_id !== order.razorpay_order_id || payment.amount !== Number(order.total_amount)) {
            return res.status(400).json({ error: 'Payment does not match order' });
        }

        const result = await fulfillPaidOrder(order, razorpayPaymentId);
        res.json({ success: true, orderId: order.id, orderNumber: result.orderNumber, shopifyOrderId: result.shopifyOrderId });
    } catch (err) {
        console.error('verify error:', err);
        notifySlackError('payment verify failed', err).catch(() => {});
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
                ? await get('SELECT * FROM orders WHERE razorpay_order_id = $1', [payment.order_id])
                : null;

            if (order && payment.amount === Number(order.total_amount)) {
                // 'processing' means someone claimed this order for fulfilment.
                // Usually that someone is /verify, running RIGHT NOW: Razorpay
                // fires this webhook at the same moment it returns to the
                // browser, so the two arrive within a second of each other.
                //
                // Occasionally the claimer died mid-flight (deploy, OOM,
                // restart) and nothing will ever retry, so a stale claim does
                // need releasing. The distinction is how long ago the claim was
                // made — which is what claimed_at records.
                //
                // This previously measured from created_at, i.e. when the
                // customer started checking out. Anyone who spent more than
                // five minutes in the Razorpay flow (netbanking, UPI with OTP —
                // routine) had their live /verify claim torn out from under it
                // mid-fulfilment, and both callers went on to create a Shopify
                // order: two orders, two stock decrements, two confirmation
                // emails, one payment.
                //
                // Done as one conditional UPDATE rather than read-then-write so
                // there is no window between deciding and acting, and so the
                // comparison uses the database's clock rather than this process's.
                const released = await run(
                    `UPDATE orders SET status = 'pending'
                     WHERE id = $1
                       AND status = 'processing'
                       AND claimed_at IS NOT NULL
                       AND claimed_at < now() - make_interval(secs => $2::int)`,
                    [order.id, STALE_CLAIM_SECONDS]
                );
                if (released.rowCount > 0) {
                    console.warn(`Webhook released stale 'processing' claim on order ${order.id}`);
                    notifySlackError(
                        `Order ${order.id}: released a stale fulfilment claim — a previous attempt died mid-flight`,
                        new Error('stale claim released')
                    ).catch(() => {});
                    order.status = 'pending';
                }

                if (order.status === 'pending') {
                    await fulfillPaidOrder(order, payment.id);
                    console.log(`Webhook fulfilled order ${order.id} (payment ${payment.id})`);
                }
            }
        }

        // Always 200 for valid signatures so Razorpay doesn't retry forever
        res.json({ received: true });
    } catch (err) {
        console.error('webhook error:', err);
        notifySlackError('Razorpay webhook failed', err).catch(() => {});
        // 500 → Razorpay will retry, which is what we want for transient failures
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

export default router;
