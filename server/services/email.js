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

/**
 * Send order confirmation to customer + notification to store.
 */
export async function sendOrderConfirmation({ order, user, cartLines, shippingAddress, shopifyOrderId }) {
    const itemsHtml = cartLines.map(l =>
        `<tr>
            <td style="padding:6px 0;font-size:13px;">${l.title}</td>
            <td style="padding:6px 0;font-size:13px;text-align:center;">${l.quantity}</td>
            <td style="padding:6px 0;font-size:13px;text-align:right;">₹${(l.price * l.quantity).toFixed(2)}</td>
        </tr>`
    ).join('');

    const totalAmount = (order.total_amount / 100).toFixed(2);
    const addr = shippingAddress;
    const addressLine = `${addr.address || addr.address1}, ${addr.city}, ${addr.state || addr.province} ${addr.zip}, ${addr.country || 'India'}`;

    const customerHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <div style="background:#0a0a0a;padding:32px;text-align:center;">
            <h1 style="color:#fff;letter-spacing:0.3em;font-size:22px;margin:0;">MORBEI</h1>
        </div>
        <div style="padding:32px;">
            <h2 style="font-size:16px;letter-spacing:0.2em;font-weight:500;">ORDER CONFIRMED</h2>
            <p style="font-size:14px;color:#555;">Thank you, ${user.first_name}. Your order has been placed successfully.</p>
            <p style="font-size:13px;"><strong>Order ID:</strong> #${order.id}${shopifyOrderId ? ` &nbsp;|&nbsp; <strong>Shopify:</strong> #${shopifyOrderId}` : ''}</p>
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
                <p style="font-size:13px;margin:0;">${addr.firstName || user.first_name} ${addr.lastName || user.last_name}</p>
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
        <h2 style="font-size:16px;letter-spacing:0.2em;">NEW ORDER #${order.id}</h2>
        <p><strong>Customer:</strong> ${user.first_name} ${user.last_name} (${user.email})</p>
        <p><strong>Amount:</strong> ₹${totalAmount}</p>
        <p><strong>Shipping to:</strong> ${addressLine}</p>
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
                subject: `Your MORBEI order #${order.id} is confirmed`,
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
                subject: `New Order #${order.id} — ₹${totalAmount} — ${user.first_name} ${user.last_name}`,
                html: storeHtml,
            })
        );
    }

    await Promise.allSettled(mailPromises);
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
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            ${subject ? `<p><strong>Subject:</strong> ${subject}</p>` : ''}
            <p><strong>Message:</strong></p>
            <p style="background:#f9f9f9;padding:16px;border-radius:4px;white-space:pre-line;">${message}</p>
        </div>`,
    });
}
