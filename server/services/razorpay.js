import Razorpay from 'razorpay';
import crypto from 'crypto';

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Turn a Razorpay SDK rejection into a real Error.
 *
 * The SDK does not reject with an Error. It throws a bare object shaped
 * `{ statusCode, error: { code, description, reason, step, field } }`, which
 * breaks two assumptions this codebase makes everywhere:
 *
 *  1. `err.message` is `undefined`, so every `console.error(..., err.message)`
 *     on the money path logged the word "undefined", and notifySlackError's
 *     `String(err)` fallback produced "[object Object]". A failed refund or a
 *     failed order creation told you it happened and nothing about why.
 *
 *  2. `statusCode` collides with this app's own convention. Routes attach
 *     `statusCode` to errors they raise deliberately, meaning "safe to show the
 *     customer" — see create-order, which uses it to choose the HTTP status AND
 *     to decide whether to alert. Razorpay's HTTP status masqueraded as that
 *     marker, so a Razorpay outage during checkout returned 400 with an empty
 *     error body and, worse, skipped the Slack alert entirely — at exactly the
 *     moment you most need to know.
 *
 * The HTTP status is preserved as `httpStatus`, and the machine-readable parts
 * as `code` / `reason`, so callers can branch on them ('insufficient balance'
 * and 'payment not found' need very different responses) without either
 * problem returning.
 */
function toError(err, action) {
    if (err instanceof Error) return err;

    const detail = err?.error;
    if (detail) {
        const message = [
            detail.description,
            detail.reason && detail.reason !== 'NA' ? `reason: ${detail.reason}` : null,
            detail.code ? `code: ${detail.code}` : null,
        ].filter(Boolean).join(' — ');

        const wrapped = new Error(`Razorpay ${action} failed: ${message || 'no description given'}`);
        wrapped.code = detail.code;
        wrapped.reason = detail.reason;
        wrapped.step = detail.step;
        wrapped.field = detail.field;
        // NOT `statusCode` — see above.
        wrapped.httpStatus = err.statusCode;
        return wrapped;
    }

    return new Error(`Razorpay ${action} failed: ${typeof err === 'string' ? err : JSON.stringify(err)}`);
}

async function call(action, fn) {
    try {
        return await fn();
    } catch (err) {
        throw toError(err, action);
    }
}

export async function createRazorpayOrder(amountInPaise, currency = 'INR', receipt) {
    return call('order creation', () => razorpay.orders.create({
        amount: amountInPaise,
        currency,
        receipt,
    }));
}

export function verifyPaymentSignature({ orderId, paymentId, signature }) {
    const body = orderId + '|' + paymentId;
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');
    return expectedSignature === signature;
}

export async function fetchPayment(paymentId) {
    return call('payment fetch', () => razorpay.payments.fetch(paymentId));
}

// Refund a captured payment. amountInPaise omitted = full refund.
export async function refundPayment(paymentId, amountInPaise) {
    const options = { speed: 'normal' };
    if (amountInPaise != null) options.amount = amountInPaise;
    return call('refund', () => razorpay.payments.refund(paymentId, options));
}

// All payments made against a Razorpay order — used to find a captured
// payment when the local order never recorded a payment id (e.g. it was
// still 'pending' because the verify call never completed).
export async function fetchOrderPayments(razorpayOrderId) {
    const res = await call('order payments fetch', () => razorpay.orders.fetchPayments(razorpayOrderId));
    return res.items || [];
}
