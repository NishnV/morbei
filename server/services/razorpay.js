import Razorpay from 'razorpay';
import crypto from 'crypto';

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export async function createRazorpayOrder(amountInPaise, currency = 'INR', receipt) {
    return razorpay.orders.create({
        amount: amountInPaise,
        currency,
        receipt,
    });
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
    return razorpay.payments.fetch(paymentId);
}
