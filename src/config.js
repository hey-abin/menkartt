// All store settings live here. Secrets come from environment variables (.env).
import fs from 'node:fs';
import path from 'node:path';

// Tiny .env loader (no extra dependency)
const envPath = path.resolve(import.meta.dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k, d = '') => process.env[k] ?? d;
const isProd = env('NODE_ENV') === 'production';

export const config = {
  isProd,
  port: Number(env('PORT', 3000)),
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000'),

  // Database: MongoDB when MONGODB_URI is set; otherwise a local JSON file (for testing only).
  mongoUri: env('MONGODB_URI'),
  mongoDb: env('MONGODB_DB', 'seedha_store'),

  // Admin dashboard login
  adminPassword: env('ADMIN_PASSWORD', isProd ? '' : 'admin123'),
  sessionSecret: env('SESSION_SECRET', isProd ? '' : 'dev-only-secret-change-me'),

  // Razorpay (get keys from dashboard.razorpay.com → Account & Settings → API Keys)
  razorpayKeyId: env('RAZORPAY_KEY_ID'),
  razorpayKeySecret: env('RAZORPAY_KEY_SECRET'),
  razorpayWebhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
  // Local testing only: pretend online payments succeed when no Razorpay keys are set.
  paymentMock: !isProd && env('PAYMENT_MOCK', 'true') === 'true',

  // Meta (Facebook/Instagram) Pixel – optional
  metaPixelId: env('META_PIXEL_ID'),

  // Business details – shown in the footer & policy pages (Razorpay checks these pages during KYC)
  business: {
    brand: env('STORE_NAME', 'Menkartt'),
    tagline: env('STORE_TAGLINE', 'Posture Corrector Belt for Men & Women'),
    legalName: env('BUSINESS_NAME', ''),          // optional
    email: env('SUPPORT_EMAIL', 'support.menkartt2@gmail.com'),
    phone: env('SUPPORT_PHONE', ''),              // optional – hidden when empty
    whatsapp: env('WHATSAPP_NUMBER', ''),          // optional – digits with country code, hidden when empty
    address: env('BUSINESS_ADDRESS', ''),         // optional – hidden when empty
  },

  // Offers. Prices are in rupees and are ALWAYS taken from here on the server (never from the browser).
  codEnabled: env('COD_ENABLED', 'true') === 'true',
  // `cod` = regular price (paid with Cash on Delivery). `prepaid` = price after the ₹50 online-payment offer.
  bundles: [
    { id: 'single', title: '1 Belt', subtitle: 'For you', qty: 1, prepaid: 399, cod: 449 },
    { id: 'duo', title: '2 Belts', subtitle: 'You + family', qty: 2, prepaid: 699, cod: 749, tag: 'Best value' },
  ],
  productName: 'Posture Corrector Belt',
  productSubtitle: 'Spine Straightener & Shoulder Alignment Belt · Men & Women',
  dispatchDays: '24 hours',
  deliveryDays: '3–7 days',
  replacementDays: 7,
};

export function bundleById(id) {
  return config.bundles.find((b) => b.id === id);
}

export function publicConfig() {
  const c = config;
  return {
    brand: c.business.brand,
    tagline: c.business.tagline,
    business: c.business,
    bundles: c.bundles,
    productName: c.productName,
    productSubtitle: c.productSubtitle,
    codEnabled: c.codEnabled,
    razorpayKeyId: c.razorpayKeyId || null,
    paymentMock: c.paymentMock && !c.razorpayKeyId,
    metaPixelId: c.metaPixelId || null,
    dispatchDays: c.dispatchDays,
    deliveryDays: c.deliveryDays,
    replacementDays: c.replacementDays,
  };
}
