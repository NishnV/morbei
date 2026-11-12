const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
// Contact messages go to their own channel so a customer enquiry is not
// buried among error alerts. Falls back to the error webhook rather than
// dropping the message if the dedicated one has not been created yet.
const CONTACT_WEBHOOK_URL = process.env.CONTACT_SLACK_WEBHOOK_URL || SLACK_WEBHOOK_URL;

// Slack's mrkdwn treats these three as control characters. A customer whose
// message contains "<" is not trying anything, but leaving them raw lets a
// message rewrite itself as a link — and mangles ordinary text besides.
function slackEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * POST to a Slack webhook with a deadline. Returns true on delivery, false
 * on anything else — never throws, and never hangs a request: without the
 * abort, a stalled Slack could hold a socket open indefinitely.
 */
async function post(url, payload, timeoutMs = 8000) {
    if (!url) return false;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: abort.signal,
        });
        return res.ok;
    } catch (err) {
        console.error('Slack post failed:', err.message);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * A contact-form submission, delivered to the team channel.
 *
 * This is the delivery path, not a copy of one — outbound SMTP is blocked
 * from the host, so the email notification cannot be relied on. The row in
 * contact_submissions remains the durable record; this is how someone
 * actually finds out a customer wrote in.
 */
export async function notifySlackContact({ name, email, subject, message, phone }) {
    const lines = [
        `*From:* ${slackEscape(name)}`,
        `*Email:* ${slackEscape(email)}`,
        phone ? `*Phone:* ${slackEscape(phone)}` : null,
        subject ? `*Subject:* ${slackEscape(subject)}` : null,
    ].filter(Boolean);

    return post(CONTACT_WEBHOOK_URL, {
        // Fallback text for notifications and screen readers, which do not
        // render blocks.
        text: `New contact message from ${slackEscape(name)}`,
        blocks: [
            { type: 'header', text: { type: 'plain_text', text: '\u2709\ufe0f  New contact message' } },
            { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
            { type: 'section', text: { type: 'mrkdwn', text: `>>>${slackEscape(message)}` } },
        ],
    });
}

// Fire-and-forget alert for unexpected server errors. Silently no-ops until
// SLACK_WEBHOOK_URL is configured, and never throws — a broken alert path
// must never take down the request it's reporting on.
/**
 * Render anything throwable as readable text. `String(err)` on a plain object
 * yields "[object Object]", which is what several money-path alerts were
 * sending before the Razorpay SDK's bare-object rejections were wrapped.
 */
function describe(error) {
    if (error?.message) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export async function notifySlackError(context, error) {
    if (!SLACK_WEBHOOK_URL) return;
    try {
        await fetch(SLACK_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: `:warning: *${context}*\n\`\`\`${describe(error)}\`\`\``,
            }),
        });
    } catch (slackErr) {
        console.error('Slack notification failed:', slackErr.message);
    }
}

const ORDER_WEBHOOK_URL = process.env.ORDERS_SLACK_WEBHOOK_URL || CONTACT_WEBHOOK_URL;

/**
 * A paid order, to the team channel.
 *
 * Like the contact notification, this is a delivery path rather than a copy of
 * one. The first real order arrived while the mail provider had no verified
 * domain, so the customer's confirmation, the store's copy and Shopify's own
 * email all came to nothing and the order was discovered through Instagram.
 * Slack has never been the thing that broke, so the one message that says
 * money came in no longer travels only by email.
 *
 * Everything needed to start packing is in here, so a straightforward order
 * needs no other screen.
 */
export async function notifySlackOrder({ orderNumber, totalPaise, customerName, email, phone, items, address }) {
    const lines = [
        `*Total:* \u20b9${(Number(totalPaise || 0) / 100).toLocaleString('en-IN')}`,
        `*Customer:* ${slackEscape(customerName)}`,
        `*Email:* ${slackEscape(email)}`,
        phone ? `*Phone:* ${slackEscape(phone)}` : null,
        address ? `*Ship to:* ${slackEscape(address)}` : null,
    ].filter(Boolean);

    const itemLines = (items || []).map((i) => `\u2022 ${slackEscape(i)}`).join('\n');

    return post(ORDER_WEBHOOK_URL, {
        text: `New order #${slackEscape(orderNumber)}`,
        blocks: [
            { type: 'header', text: { type: 'plain_text', text: `\ud83d\udce6  New order #${orderNumber}` } },
            { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
            ...(itemLines ? [{ type: 'section', text: { type: 'mrkdwn', text: itemLines } }] : []),
        ],
    });
}

const RETURN_WEBHOOK_URL = process.env.RETURNS_SLACK_WEBHOOK_URL || CONTACT_WEBHOOK_URL;

const REASON_LABELS = {
    size_fit: 'Size / fit',
    damaged: 'Damaged on arrival',
    wrong_product: 'Wrong product',
    quality: 'Quality issue',
    not_as_expected: 'Not as expected',
    other: 'Other',
};

const RESOLUTION_LABELS = {
    refund: 'Refund',
    exchange_size: 'Exchange — another size',
    exchange_product: 'Exchange — another product',
};

/**
 * A return request, to the team channel. Every field a decision needs is in
 * the message, so a straightforward one can be judged without opening the
 * admin page at all.
 */
export async function notifySlackReturn(r) {
    const lines = [
        `*Order:* #${slackEscape(r.orderNumber)}`,
        `*Item:* ${slackEscape(r.product)}`,
        `*Reason:* ${r.reasons.map((x) => slackEscape(REASON_LABELS[x] || x)).join(', ')}`,
        `*Wants:* ${slackEscape(RESOLUTION_LABELS[r.resolution] || r.resolution)}`,
        `*From:* ${slackEscape(r.email)}`,
        r.mediaCount ? `*Media:* ${r.mediaCount} file(s) attached` : '*Media:* none',
    ];
    // Worth saying loudly: the policy is seven days, and approving outside it
    // should be a decision rather than an oversight.
    if (r.outsideWindow) {
        lines.push(`:warning: *Outside the ${r.daysSinceDelivery ?? '?'}-day window* — delivered ${r.daysSinceDelivery} days ago`);
    }

    return post(RETURN_WEBHOOK_URL, {
        text: `Return request for order #${slackEscape(r.orderNumber)}`,
        blocks: [
            { type: 'header', text: { type: 'plain_text', text: '\u21a9\ufe0f  Return request' } },
            { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
        ],
    });
}
