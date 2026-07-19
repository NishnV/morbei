import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const STORE_EMAIL = process.env.STORE_NOTIFICATION_EMAIL || process.env.SMTP_USER;
const STORE_FROM = `"MORBEI" <${process.env.SMTP_USER}>`;

// User-supplied strings go into HTML emails — escape them so a crafted
// product title or contact message can't inject markup.
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Send order confirmation to customer + notification to store.
 */
export async function sendOrderConfirmation({ order, user, cartLines, shippingAddress, shopifyOrderId }) {
    // Include variant options (size/color) — essential for packing the right item
    const itemsHtml = cartLines.map(l => {
        const options = (l.selectedOptions || [])
            .map(o => o.value)
            .filter(v => v && v.toLowerCase() !== 'default title')
            .join(' / ');
        return `<tr>
            <td style="padding:6px 0;font-size:13px;">${esc(l.title)}${options ? `<br><span style="color:#888;font-size:12px;">${esc(options)}</span>` : ''}</td>
            <td style="padding:6px 0;font-size:13px;text-align:center;">${l.quantity}</td>
            <td style="padding:6px 0;font-size:13px;text-align:right;">₹${(l.price * l.quantity).toFixed(2)}</td>
        </tr>`;
    }).join('');

    const totalAmount = (Number(order.total_amount) / 100).toFixed(2);
    const orderNo = order.shopify_order_number || order.id;
    const addr = shippingAddress;
    // The checkout form has no city field — build the line from whatever
    // parts exist so a missing field never prints "undefined"
    const addressLine = esc([
        addr.address || addr.address1,
        addr.city,
        [addr.state || addr.province, addr.zip].filter(Boolean).join(' '),
        addr.country || 'India',
    ].filter(part => part && String(part).trim()).join(', '));

    const customerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <div style="background:#0a0a0a;padding:32px;text-align:center;">
            <h1 style="color:#fff;letter-spacing:0.3em;font-size:22px;margin:0;">MORBEI</h1>
        </div>
        <div style="padding:32px;">
            <h2 style="font-size:16px;letter-spacing:0.2em;font-weight:500;">ORDER CONFIRMED</h2>
            <p style="font-size:14px;color:#555;">Thank you, ${esc(user.first_name)}. Your order has been placed successfully.</p>
            <p style="font-size:13px;"><strong>Order No:</strong> #${orderNo}</p>
            <table style="width:100%;border-collapse:collapse;margin-top:16px;">
                <thead>
                    <tr style="border-bottom:1px solid #eee;">
                        <th style="text-align:left;padding:8px 0;font-size:11px;letter-spacing:0.15em;color:#999;">ITEM</th>
                        <th style="text-align:center;padding:8px 0;font-size:11px;letter-spacing:0.15em;color:#999;">QTY</th>
                        <th style="text-align:right;padding:8px 0;font-size:11px;letter-spacing:0.15em;color:#999;">PRICE</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
                <tfoot>
                    <tr style="border-top:1px solid #eee;">
                        <td colspan="2" style="padding:10px 0;font-weight:bold;font-size:13px;">TOTAL</td>
                        <td style="padding:10px 0;font-weight:bold;font-size:13px;text-align:right;">₹${totalAmount}</td>
                    </tr>
                </tfoot>
            </table>
            <div style="margin-top:24px;padding:16px;background:#f9f9f9;border-radius:4px;">
                <p style="font-size:11px;letter-spacing:0.15em;color:#999;margin:0 0 8px 0;">SHIPPING TO</p>
                <p style="font-size:13px;margin:0;">${esc(addr.firstName || user.first_name)} ${esc(addr.lastName || user.last_name)}</p>
                <p style="font-size:13px;margin:4px 0 0 0;color:#555;">${addressLine}</p>
            </div>
            <p style="margin-top:32px;font-size:12px;color:#888;">We will notify you once your order ships. For any queries, reply to this email or contact care@morbei.com</p>
        </div>
        <div style="background:#f4f4f4;padding:16px;text-align:center;">
            <p style="font-size:11px;color:#aaa;margin:0;">© ${new Date().getFullYear()} MORBEI. All rights reserved.</p>
        </div>
    </div>`;

    const storeHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="font-size:16px;letter-spacing:0.2em;">NEW ORDER #${orderNo}</h2>
        <p><strong>Customer:</strong> ${esc(user.first_name)} ${esc(user.last_name)} (${esc(user.email)})</p>
        <p><strong>Phone:</strong> ${esc(addr.phone || user.phone || 'not provided')}</p>
        <p><strong>Amount:</strong> ₹${totalAmount} &nbsp;|&nbsp; <strong>Shipping:</strong> ${esc(order.shipping_method || 'standard')}</p>
        <p><strong>Shipping to:</strong> ${esc(addr.firstName || user.first_name)} ${esc(addr.lastName || user.last_name)}, ${addressLine}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
            <thead><tr><th style="text-align:left;">Item</th><th>Qty</th><th style="text-align:right;">Price</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
        </table>
        ${shopifyOrderId ? `<p><strong>Shopify Order ID:</strong> ${shopifyOrderId}</p>` : ''}
    </div>`;

    const mailPromises = [];

    // Customer confirmation
    if (user.email) {
        mailPromises.push(
            transporter.sendMail({
                from: STORE_FROM,
                to: user.email,
                subject: `Your MORBEI order #${orderNo} is confirmed`,
                html: customerHtml,
            })
        );
    }

    // Store notification
    if (STORE_EMAIL) {
        mailPromises.push(
            transporter.sendMail({
                from: STORE_FROM,
                to: STORE_EMAIL,
                subject: `New Order #${orderNo} — ₹${totalAmount} — ${user.first_name} ${user.last_name}`,
                html: storeHtml,
            })
        );
    }

    await Promise.allSettled(mailPromises);
}

/**
 * Notify customer + store that an order was cancelled and a refund issued.
 * refundAmountPaise = amount actually refunded (0 if nothing was captured).
 */
export async function sendOrderCancellation({ order, user, refundAmountPaise, refundId }) {
    const refunded = Number(refundAmountPaise) > 0;
    const refundAmount = (Number(refundAmountPaise || 0) / 100).toFixed(2);
    const orderNo = order.shopify_order_number || order.id;

    const customerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <div style="background:#0a0a0a;padding:32px;text-align:center;">
            <h1 style="color:#fff;letter-spacing:0.3em;font-size:22px;margin:0;">MORBEI</h1>
        </div>
        <div style="padding:32px;">
            <h2 style="font-size:16px;letter-spacing:0.2em;font-weight:500;">ORDER CANCELLED</h2>
            <p style="font-size:14px;color:#555;">Hi ${esc(user.first_name)}, your order #${orderNo} has been cancelled.</p>
            ${refunded
            ? `<p style="font-size:14px;color:#555;">A refund of <strong>₹${refundAmount}</strong> has been initiated to your original payment method. It typically appears within 5–7 business days.</p>`
            : `<p style="font-size:14px;color:#555;">No payment had been captured for this order, so there is nothing to refund.</p>`}
            <p style="margin-top:24px;font-size:12px;color:#888;">For any queries, reply to this email or contact care@morbei.com</p>
        </div>
        <div style="background:#f4f4f4;padding:16px;text-align:center;">
            <p style="font-size:11px;color:#aaa;margin:0;">© ${new Date().getFullYear()} MORBEI. All rights reserved.</p>
        </div>
    </div>`;

    const storeHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="font-size:16px;letter-spacing:0.2em;">ORDER CANCELLED #${orderNo}</h2>
        <p><strong>Customer:</strong> ${esc(user.first_name)} ${esc(user.last_name)} (${esc(user.email)})</p>
        <p><strong>Refund:</strong> ${refunded ? `₹${refundAmount} (Razorpay refund ${esc(refundId || '')})` : 'none (no payment captured)'}</p>
        ${order.shopify_order_id ? `<p><strong>Shopify Order ID:</strong> ${esc(order.shopify_order_id)}</p>` : ''}
    </div>`;

    const mailPromises = [];
    if (user.email) {
        mailPromises.push(transporter.sendMail({
            from: STORE_FROM,
            to: user.email,
            subject: `Your MORBEI order #${orderNo} has been cancelled`,
            html: customerHtml,
        }));
    }
    if (STORE_EMAIL) {
        mailPromises.push(transporter.sendMail({
            from: STORE_FROM,
            to: STORE_EMAIL,
            subject: `Order #${orderNo} cancelled${refunded ? ` — ₹${refundAmount} refunded` : ''}`,
            html: storeHtml,
        }));
    }
    await Promise.allSettled(mailPromises);
}

/**
 * Alert the store when a refund could not be issued during cancellation —
 * the customer expects their money back, so this needs manual follow-up.
 */
export async function sendRefundFailureAlert({ orderId, paymentId, amountPaise, errorMessage }) {
    if (!STORE_EMAIL) return;
    const amount = (Number(amountPaise || 0) / 100).toFixed(2);
    await transporter.sendMail({
        from: STORE_FROM,
        to: STORE_EMAIL,
        subject: `⚠️ ACTION NEEDED: refund failed for order #${orderId}`,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;">
            <h2 style="font-size:16px;letter-spacing:0.15em;color:#b00;">REFUND FAILED</h2>
            <p>A customer cancelled order #${orderId} but the automatic refund did not go through. Refund them manually from the Razorpay dashboard.</p>
            <p><strong>Payment ID:</strong> ${esc(paymentId || 'unknown')}</p>
            <p><strong>Amount to refund:</strong> ₹${amount}</p>
            <p><strong>Error:</strong> ${esc(errorMessage || '')}</p>
        </div>`,
    });
}

/**
 * Send contact form submission notification to store.
 */
export async function sendContactNotification({ name, email, subject, message }) {
    if (!STORE_EMAIL) return;
    await transporter.sendMail({
        from: STORE_FROM,
        to: STORE_EMAIL,
        replyTo: email,
        subject: `[MORBEI Contact] ${subject || `Message from ${name}`}`,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;">
            <h2 style="font-size:16px;letter-spacing:0.15em;">NEW CONTACT MESSAGE</h2>
            <p><strong>Name:</strong> ${esc(name)}</p>
            <p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
            ${subject ? `<p><strong>Subject:</strong> ${esc(subject)}</p>` : ''}
            <p><strong>Message:</strong></p>
            <p style="background:#f9f9f9;padding:16px;border-radius:4px;white-space:pre-line;">${esc(message)}</p>
        </div>`,
    });
}

/**
 * Restock request — a customer asked to be notified when an out-of-stock
 * product comes back. The store follows up manually.
 */
export async function sendRestockRequest({ email, product }) {
    if (!STORE_EMAIL) return;
    await transporter.sendMail({
        from: STORE_FROM,
        to: STORE_EMAIL,
        replyTo: email,
        subject: `[MORBEI] Restock request: ${product}`,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;">
            <h2 style="font-size:16px;letter-spacing:0.15em;">RESTOCK REQUEST</h2>
            <p><strong>Product:</strong> ${esc(product)}</p>
            <p><strong>Customer:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
            <p>Notify them when this product is back in stock.</p>
        </div>`,
    });
}

/**
 * Alert the store when a payment was captured but Shopify order creation
 * failed — money is in hand with no order behind it, act immediately.
 */
export async function sendFulfillmentFailureAlert({ orderId, razorpayPaymentId, userEmail, amountPaise, errorMessage }) {
    if (!STORE_EMAIL) return;
    await transporter.sendMail({
        from: STORE_FROM,
        to: STORE_EMAIL,
        subject: `⚠️ ACTION NEEDED: payment captured, order #${orderId} not created`,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;">
            <h2 style="color:#b00020;">Payment captured but Shopify order creation FAILED</h2>
            <p>The customer has been charged, but no Shopify order exists yet. The webhook will retry automatically; if this order does not turn to 'paid' soon, create the order manually or refund.</p>
            <p><strong>Local order ID:</strong> #${orderId}</p>
            <p><strong>Razorpay payment:</strong> ${esc(razorpayPaymentId)}</p>
            <p><strong>Customer:</strong> ${esc(userEmail)}</p>
            <p><strong>Amount:</strong> ₹${(Number(amountPaise) / 100).toFixed(2)}</p>
            <p><strong>Error:</strong> ${esc(errorMessage)}</p>
        </div>`,
    });
}
