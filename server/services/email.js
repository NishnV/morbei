import { deliver } from './mailer.js';

// Which transport carries these, and why it is an HTTPS API rather than
// SMTP, is explained in mailer.js. Templates below never need to know.

// SMTP_USER is kept as a fallback so the switch to Resend needs no env
// rename, but MAIL_FROM is the honest name for it now.
const FROM_ADDRESS = process.env.MAIL_FROM || process.env.SMTP_USER;
const STORE_EMAIL = process.env.STORE_NOTIFICATION_EMAIL || FROM_ADDRESS;
const STORE_FROM = `"MORBEI" <${FROM_ADDRESS}>`;

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
/**
 * Send a batch and report whether any of it failed.
 *
 * allSettled rather than all, deliberately: a customer confirmation must still
 * be attempted when the store copy fails, and the other way round. But the
 * result of allSettled is a resolved promise either way, so this used to
 * return success while every message in it had been refused — which is how a
 * dead mail provider produced an order nobody was told about. Try everything,
 * then raise what broke.
 */
async function deliverAll(promises, label) {
    const results = await Promise.allSettled(promises);
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length === 0) return;
    throw new Error(
        `${failures.length} of ${results.length} ${label} message(s) failed: `
        + failures.map((f) => f.reason?.message || String(f.reason)).join('; ')
    );
}

// The storefront, for links out of an email. CLIENT_URL may hold several
// origins (CORS takes a list); the first is the canonical one.
const PRODUCTION_SITE = 'https://www.morbei.com';

// Where a link or an image in an email points. CLIENT_URL exists for CORS and
// holds whatever origins the browser may call from — in development that is
// http://localhost:5173, which would put an unreachable logo and dead links
// into a real email. Take the first https origin, so a local run still writes
// production URLs, and let PUBLIC_SITE_URL override the lot.
const SITE_URL = process.env.PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
    || (process.env.CLIENT_URL || '')
        .split(',')
        .map((u) => u.trim().replace(/\/$/, ''))
        .find((u) => u.startsWith('https://'))
    || PRODUCTION_SITE;

// Shopify's CDN resizes on request. Asking for double the display width keeps
// the thumbnail sharp on the phone screens most of these are opened on.
function thumb(url, width = 160) {
    if (!url) return '';
    return `${url}${url.includes('?') ? '&' : '?'}width=${width}`;
}

const rupees = (n) => `RS. ${Number(n || 0).toLocaleString('en-IN')}`;

// Standard is free and slow, priority is paid and quick. The confirmation
// page quotes 7–14 days whatever was chosen, which is wrong for priority.
const DELIVERY_ESTIMATE = { standard: '7–14 DAYS', priority: '3–5 DAYS' };

/**
 * The wrapper every customer-facing message shares.
 *
 * One place for the black ground, the wordmark, the typographic rhythm and
 * the footer, so a confirmation, a cancellation and a return update read as
 * the same brand rather than three different senders. Store and ops alerts
 * deliberately do not use it — those are worksheets, and dressing them up
 * only makes the useful line harder to find.
 *
 * Tables and inline styles throughout: Outlook renders with Word's engine
 * and understands little else. The logo is a PNG because every mail client
 * strips inline SVG, and it carries styled alt text so a blocked image still
 * reads as MORBEI rather than a broken-image icon.
 */
function shell({ title, eyebrow, heading, intro = '', body = '', cta, footerNote = '', isTest = false }) {
    const headingSize = String(heading).length <= 12 ? 34 : 24;
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(String(title || heading))}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background:#0a0a0a;margin:0;padding:0;">
  <tr><td align="center" style="padding:0;">
    <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <!-- Fluid, capped at 600. A fixed 600 runs off the side of a phone and
         takes the price column with it, and these are read on phones.
         Outlook ignores max-width, hence the conditional table above. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

      <tr><td align="center" style="padding:40px 24px 44px 24px;">
        <img src="${SITE_URL}/email-logo.png" width="200" alt="MORBEI"
             style="display:block;width:200px;max-width:60%;height:auto;border:0;margin:0 auto;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:18px;letter-spacing:0.42em;">
      </td></tr>
${isTest ? `
      <tr><td align="center" style="padding:0 24px 24px 24px;">
        <div style="border:1px solid #d08a28;color:#d08a28;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.2em;padding:8px 0;">TEST ORDER — CHARGED RS. 1</div>
      </td></tr>` : ''}
${eyebrow ? `
      <tr><td align="center" style="padding:0 24px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.3em;color:#8a8a8a;">
        ${esc(eyebrow)}
      </td></tr>` : ''}
      <tr><td align="center" style="padding:14px 24px 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:${headingSize}px;letter-spacing:0.14em;color:#ffffff;">
        ${esc(heading)}
      </td></tr>
${intro ? `
      <tr><td align="center" style="padding:20px 24px 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:22px;letter-spacing:0.08em;color:#8a8a8a;">
        ${intro}
      </td></tr>` : ''}

${body}

${cta ? `
      <tr><td align="center" style="padding:44px 24px 0 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td bgcolor="#ffffff" style="padding:16px 44px;">
            <a href="${esc(cta.href)}" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.26em;color:#0a0a0a;text-decoration:none;">${esc(cta.label)}</a>
          </td></tr>
        </table>
      </td></tr>` : ''}

      <tr><td align="center" style="padding:44px 24px 12px 24px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:20px;color:#6a6a6a;">
        For any queries, reply to this email or contact
        <a href="mailto:${esc(STORE_EMAIL)}" style="color:#8a8a8a;">${esc(STORE_EMAIL)}</a>.
      </td></tr>
      <tr><td align="center" style="padding:0 24px 44px 24px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.16em;color:#4a4a4a;">
        © ${new Date().getFullYear()} MORBEI${footerNote ? `<br><br>${footerNote}` : ''}
      </td></tr>

    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body></html>`;
}

/** A labelled block inside the shell's body — "ORDER SUMMARY", "DELIVERY". */
function section(label, html, topPadding = 40) {
    return `      <tr><td style="padding:${topPadding}px 24px 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.26em;color:#ffffff;">
        ${esc(label)}
      </td></tr>
      <tr><td style="padding:18px 24px 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:22px;letter-spacing:0.1em;color:#8a8a8a;">
        ${html}
      </td></tr>`;
}

/** The hairline the page uses between sections. */
const RULE = `      <tr><td style="padding:40px 24px 0 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-top:1px solid #2a2a2a;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td></tr>`;

export async function sendOrderConfirmation({ order, user, cartLines, shippingAddress, shopifyOrderId }) {
    // Variant options (size/colour) matter twice over: the customer checks
    // them, and whoever packs the parcel reads the same line.
    const lineOptions = (l) => (l.selectedOptions || [])
        .map((o) => o.value)
        .filter((v) => v && v.toLowerCase() !== 'default title')
        .join(' / ');

    // Plain rows for the store's copy, which is a worksheet, not a showpiece.
    const itemsHtml = cartLines.map(l => {
        const options = lineOptions(l);
        return `<tr>
            <td style="padding:6px 0;font-size:13px;">${esc(l.title)}${options ? `<br><span style="color:#888;font-size:12px;">${esc(options)}</span>` : ''}</td>
            <td style="padding:6px 0;font-size:13px;text-align:center;">${l.quantity}</td>
            <td style="padding:6px 0;font-size:13px;text-align:right;">₹${(l.price * l.quantity).toFixed(2)}</td>
        </tr>`;
    }).join('');

    // The customer's copy, laid out like the confirmation page they just left:
    // thumbnail, name, options, quantity, line total.
    const customerItemsHtml = cartLines.map((l) => {
        const options = lineOptions(l);
        const img = thumb(l.image);
        return `<tr>
            <td width="72" valign="top" style="padding:0 16px 24px 0;">
                ${img ? `<img src="${esc(img)}" width="72" alt="" style="display:block;width:72px;height:auto;border:0;">` : ''}
            </td>
            <td valign="top" style="padding:0 0 24px 0;font-family:Helvetica,Arial,sans-serif;">
                <div style="font-size:13px;letter-spacing:0.12em;color:#ffffff;text-transform:uppercase;">${esc(l.title)}</div>
                ${options ? `<div style="font-size:11px;letter-spacing:0.12em;color:#8a8a8a;text-transform:uppercase;padding-top:6px;">${esc(options)}</div>` : ''}
                <div style="font-size:11px;letter-spacing:0.12em;color:#8a8a8a;padding-top:6px;">QTY ${Number(l.quantity)}</div>
            </td>
            <td valign="top" align="right" style="padding:0 0 24px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:0.08em;color:#ffffff;white-space:nowrap;">
                ${rupees(l.price * l.quantity)}
            </td>
        </tr>`;
    }).join('');

    const totalAmount = (Number(order.total_amount) / 100).toFixed(2);
    const orderNo = order.shopify_order_number || order.id;
    const addr = shippingAddress;
    // The checkout form has no city field — build the line from whatever
    // parts exist so a missing field never prints "undefined"
    const addressParts = [
        addr.address || addr.address1,
        addr.city,
        [addr.state || addr.province, addr.zip].filter(Boolean).join(' '),
        addr.country || 'India',
    ].filter(part => part && String(part).trim());
    const addressLine = esc(addressParts.join(', '));
    // Upper-case the parts, then escape. The other way round would rewrite an
    // escaped "&amp;" in a street name as "&AMP;".
    const addressLineUpper = esc(addressParts.join(', ').toUpperCase());

    const method = (order.shipping_method || 'standard').toLowerCase();
    const deliveryLabel = method === 'priority' ? 'PRIORITY' : 'STANDARD';
    const estimate = DELIVERY_ESTIMATE[method] || DELIVERY_ESTIMATE.standard;
    const itemsTotal = cartLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const paid = Number(order.total_amount) / 100;
    const shippingPaid = Math.max(0, paid - itemsTotal);

    const customerHtml = shell({
        title: `Order ${orderNo}`,
        eyebrow: 'ORDER PLACED',
        heading: 'THANK YOU',
        intro: `THANK YOU, ${esc(String(user.first_name || '').toUpperCase())}. YOUR ORDER HAS BEEN CONFIRMED.<br>
                <span style="color:#ffffff;letter-spacing:0.22em;">ORDER NO. ${esc(String(orderNo))}</span>`,
        isTest: Boolean(order.is_test),
        cta: { label: 'VIEW ORDER', href: `${SITE_URL}/order-details` },
        body: `${RULE}
      <tr><td style="padding:32px 24px 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.26em;color:#ffffff;">
        ORDER SUMMARY
      </td></tr>
      <tr><td style="padding:24px 24px 0 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${customerItemsHtml}
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:Helvetica,Arial,sans-serif;">
          <tr><td colspan="2" style="border-top:1px solid #2a2a2a;font-size:0;line-height:0;padding-bottom:16px;">&nbsp;</td></tr>
          <tr>
            <td style="font-size:11px;letter-spacing:0.18em;color:#8a8a8a;padding-bottom:10px;">SUBTOTAL</td>
            <td align="right" style="font-size:12px;letter-spacing:0.08em;color:#ffffff;padding-bottom:10px;">${rupees(Math.max(0, paid - shippingPaid))}</td>
          </tr>
          <tr>
            <td style="font-size:11px;letter-spacing:0.18em;color:#8a8a8a;padding-bottom:16px;">SHIPPING</td>
            <td align="right" style="font-size:12px;letter-spacing:0.08em;color:#ffffff;padding-bottom:16px;">${shippingPaid > 0 ? rupees(shippingPaid) : 'FREE'}</td>
          </tr>
          <tr><td colspan="2" style="border-top:1px solid #2a2a2a;font-size:0;line-height:0;padding-bottom:16px;">&nbsp;</td></tr>
          <tr>
            <td style="font-size:12px;letter-spacing:0.22em;color:#ffffff;">TOTAL</td>
            <td align="right" style="font-size:15px;letter-spacing:0.08em;color:#ffffff;">${rupees(paid)}</td>
          </tr>
        </table>
      </td></tr>
${section('SHIPPING TO', `<span style="color:#ffffff;">${esc(String(`${addr.firstName || user.first_name} ${addr.lastName || user.last_name}`).toUpperCase())}</span><br>
        ${addressLineUpper}
        ${addr.phone || user.phone ? `<br>${esc(addr.phone || user.phone)}` : ''}
        ${user.email ? `<br><span style="text-transform:lowercase;">${esc(user.email)}</span>` : ''}`)}
${section('DELIVERY', `<span style="color:#ffffff;">${deliveryLabel}</span><br>ESTIMATED ${estimate}`, 32)}`,
    });

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
            deliver({
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
            deliver({
                from: STORE_FROM,
                to: STORE_EMAIL,
                subject: `New Order #${orderNo} — ₹${totalAmount} — ${user.first_name} ${user.last_name}`,
                html: storeHtml,
            })
        );
    }

    await deliverAll(mailPromises, 'order confirmation');
}

/**
 * Notify customer + store that an order was cancelled and a refund issued.
 * refundAmountPaise = amount actually refunded (0 if nothing was captured).
 */
export async function sendOrderCancellation({ order, user, refundAmountPaise, refundId }) {
    const refunded = Number(refundAmountPaise) > 0;
    const refundAmount = (Number(refundAmountPaise || 0) / 100).toFixed(2);
    const orderNo = order.shopify_order_number || order.id;

    const customerHtml = shell({
        title: `Order ${orderNo} cancelled`,
        eyebrow: 'ORDER UPDATE',
        heading: 'ORDER CANCELLED',
        intro: `HI ${esc(String(user.first_name || '').toUpperCase())}, YOUR ORDER HAS BEEN CANCELLED.<br>
                <span style="color:#ffffff;letter-spacing:0.22em;">ORDER NO. ${esc(String(orderNo))}</span>`,
        body: refunded
            ? section('REFUND', `A refund of <span style="color:#ffffff;">${rupees(Number(refundAmountPaise) / 100)}</span> has been
                 initiated to your original payment method. It typically appears
                 within 5–7 business days, depending on your bank.`)
            : section('REFUND', 'No payment had been captured for this order, so there is nothing to refund.'),
    });

    const storeHtml = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="font-size:16px;letter-spacing:0.2em;">ORDER CANCELLED #${orderNo}</h2>
        <p><strong>Customer:</strong> ${esc(user.first_name)} ${esc(user.last_name)} (${esc(user.email)})</p>
        <p><strong>Refund:</strong> ${refunded ? `₹${refundAmount} (Razorpay refund ${esc(refundId || '')})` : 'none (no payment captured)'}</p>
        ${order.shopify_order_id ? `<p><strong>Shopify Order ID:</strong> ${esc(order.shopify_order_id)}</p>` : ''}
    </div>`;

    const mailPromises = [];
    if (user.email) {
        mailPromises.push(deliver({
            from: STORE_FROM,
            to: user.email,
            subject: `Your MORBEI order #${orderNo} has been cancelled`,
            html: customerHtml,
        }));
    }
    if (STORE_EMAIL) {
        mailPromises.push(deliver({
            from: STORE_FROM,
            to: STORE_EMAIL,
            subject: `Order #${orderNo} cancelled${refunded ? ` — ₹${refundAmount} refunded` : ''}`,
            html: storeHtml,
        }));
    }
    await deliverAll(mailPromises, 'order cancellation');
}

/**
 * Alert the store when a refund could not be issued during cancellation —
 * the customer expects their money back, so this needs manual follow-up.
 */
export async function sendRefundFailureAlert({ orderId, paymentId, amountPaise, errorMessage }) {
    if (!STORE_EMAIL) return;
    const amount = (Number(amountPaise || 0) / 100).toFixed(2);
    await deliver({
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
export async function sendContactNotification({ name, email, subject, message, phone }) {
    if (!STORE_EMAIL) return;
    await deliver({
        from: STORE_FROM,
        to: STORE_EMAIL,
        replyTo: email,
        subject: `[MORBEI Contact] ${subject || `Message from ${name}`}`,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;">
            <h2 style="font-size:16px;letter-spacing:0.15em;">NEW CONTACT MESSAGE</h2>
            <p><strong>Name:</strong> ${esc(name)}</p>
            <p><strong>Email:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
            ${phone ? `<p><strong>Phone:</strong> ${esc(phone)}</p>` : ''}
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
    await deliver({
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
 * Welcome a new newsletter subscriber.
 *
 * The footer promises "PRE LAUNCH ACCESS" and until now delivered silence —
 * a subscriber who hears nothing assumes the form was broken. Carries an
 * unsubscribe link because consent has to be withdrawable to be valid.
 */
export async function sendNewsletterWelcome(email, unsubscribeUrl) {
    await deliver({
        from: STORE_FROM,
        to: email,
        subject: 'Welcome to MORBEI',
        ...(unsubscribeUrl ? { list: { unsubscribe: { url: unsubscribeUrl } } } : {}),
        html: shell({
            title: 'Welcome to MORBEI',
            eyebrow: 'WELCOME',
            heading: "YOU'RE ON THE LIST",
            intro: `Thank you for subscribing. You will be first to hear about new
                    arrivals, editorials and pre-launch access.`,
            cta: { label: 'EXPLORE THE COLLECTION', href: `${SITE_URL}/shop/all` },
            footerNote: unsubscribeUrl
                ? `<a href="${esc(unsubscribeUrl)}" style="color:#4a4a4a;">Unsubscribe</a>`
                : '',
        }),
    });
}

/**
 * Alert the store when a payment was captured but Shopify order creation
 * failed — money is in hand with no order behind it, act immediately.
 */
export async function sendFulfillmentFailureAlert({ orderId, razorpayPaymentId, userEmail, amountPaise, errorMessage }) {
    if (!STORE_EMAIL) return;
    await deliver({
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

/**
 * Return and exchange updates.
 *
 * One shell, five states, because a customer who has sent a garment back
 * wants the same three things at every step: what we know, what happens
 * next, and when. Sending silence at any of them is how a return becomes a
 * complaint.
 *
 * Fire-and-forget at every call site, like the rest of this file. An email
 * that fails must never roll back a refund that succeeded.
 */
const RETURN_COPY = {
    received: {
        subject: (n) => `We have your return request — order #${n}`,
        heading: 'RETURN REQUEST RECEIVED',
        body: () => 'Our team will review it and be in touch within 24 hours. There is nothing for you to do until then — please hold on to the item and its packaging.',
    },
    approved: {
        subject: (n) => `Your return has been approved — order #${n}`,
        heading: 'RETURN APPROVED',
        body: () => 'We will be in touch shortly with pickup details. Please keep the item unused and unworn, with its tags and original packaging intact.',
    },
    rejected: {
        subject: (n) => `About your return request — order #${n}`,
        heading: 'RETURN NOT APPROVED',
        body: (d) => d.note
            ? `We are not able to approve this one. ${esc(d.note)}`
            : 'We are not able to approve this one. Reply to this email and we will explain, or look at anything you would like us to reconsider.',
    },
    refunded: {
        subject: (n) => `Your refund is on its way — order #${n}`,
        heading: 'REFUND ISSUED',
        body: (d) => `A refund of <strong>₹${d.amount}</strong> has been sent to your original payment method. It typically appears within 5–7 business days, depending on your bank.`,
    },
    exchanged: {
        subject: (n) => `Your replacement is on its way — order #${n}`,
        heading: 'REPLACEMENT ON ITS WAY',
        body: (d) => `We have raised a replacement${d.replacementOrderNumber ? ` as order <strong>#${esc(d.replacementOrderNumber)}</strong>` : ''}${d.size ? ` in size <strong>${esc(d.size)}</strong>` : ''}. There is nothing more to pay. We will send tracking as soon as it ships.`,
    },
};

export async function sendReturnUpdate(kind, data) {
    const copy = RETURN_COPY[kind];
    if (!copy || !data?.to) return;

    const orderNo = data.orderNumber;
    const html = shell({
        title: copy.heading,
        eyebrow: 'RETURN UPDATE',
        heading: copy.heading,
        intro: `HI ${esc(String(data.name || 'THERE').toUpperCase())}<br>
                <span style="color:#ffffff;">${esc(data.product)}</span><br>
                <span style="letter-spacing:0.22em;">ORDER NO. ${esc(String(orderNo))}</span>`,
        body: section('WHAT HAPPENS NEXT', copy.body(data)),
    });

    await deliver({
        from: STORE_FROM,
        to: data.to,
        replyTo: STORE_EMAIL || undefined,
        subject: copy.subject(orderNo),
        html,
    });
}
