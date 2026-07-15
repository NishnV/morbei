const BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: process.env.SHIPROCKET_EMAIL,
            password: process.env.SHIPROCKET_PASSWORD,
        }),
    });
    if (!res.ok) throw new Error(`Shiprocket auth failed: ${res.status}`);
    const data = await res.json();
    cachedToken = data.token;
    tokenExpiry = Date.now() + 9 * 24 * 60 * 60 * 1000; // 9 days
    return cachedToken;
}

async function shiprocketFetch(endpoint, options = {}) {
    const token = await getToken();
    const res = await fetch(`${BASE_URL}/${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        },
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shiprocket API error ${res.status}: ${text}`);
    }
    return res.json();
}

export async function createShipment({
    orderId,
    orderDate,
    billingName,
    billingAddress,
    billingCity,
    billingState,
    billingPincode,
    billingCountry,
    billingPhone,
    billingEmail,
    shippingIsBilling = true,
    items, // [{ name, sku, units, selling_price, hsn? }]
    paymentMethod = 'Prepaid',
    subTotal,
    weight, // kg
    length = 20, // cm defaults
    breadth = 15,
    height = 10,
}) {
    return shiprocketFetch('orders/create/adhoc', {
        method: 'POST',
        body: JSON.stringify({
            order_id: orderId,
            order_date: orderDate,
            billing_customer_name: billingName.split(' ')[0],
            billing_last_name: billingName.split(' ').slice(1).join(' ') || '',
            billing_address: billingAddress,
            billing_city: billingCity,
            billing_state: billingState,
            billing_pincode: billingPincode,
            billing_country: billingCountry || 'India',
            billing_phone: billingPhone,
            billing_email: billingEmail,
            shipping_is_billing: shippingIsBilling,
            order_items: items,
            payment_method: paymentMethod,
            sub_total: subTotal,
            weight,
            length,
            breadth,
            height,
        }),
    });
}

export async function trackByAWB(awbCode) {
    return shiprocketFetch(`courier/track/awb/${awbCode}`);
}

export async function trackByOrderId(orderId) {
    return shiprocketFetch(`courier/track?order_id=${orderId}`);
}

export async function cancelShipment(orderIds) {
    return shiprocketFetch('orders/cancel', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.isArray(orderIds) ? orderIds : [orderIds] }),
    });
}

export async function checkServiceability(pickupPincode, deliveryPincode, weight = 0.5) {
    return shiprocketFetch(
        `courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=0`
    );
}

export async function createReturn({ orderId, reason }) {
    return shiprocketFetch('orders/create/return', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId, reason }),
    });
}
