// Razorpay via its REST API (no SDK needed).
import crypto from 'node:crypto';
import { config } from './config.js';

export const razorpayEnabled = () => Boolean(config.razorpayKeyId && config.razorpayKeySecret);

export async function createRazorpayOrder({ amountRupees, receipt, notes }) {
  const auth = Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: 'INR', receipt, notes, payment_capture: 1 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay order failed: ${body?.error?.description || res.status}`);
  return body; // { id, amount, currency, ... }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return false;
  const expected = crypto.createHmac('sha256', config.razorpayKeySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  return safeEqual(expected, razorpay_signature);
}

// Webhook signature: HMAC_SHA256(raw body, webhook secret)
export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpayWebhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.razorpayWebhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}
