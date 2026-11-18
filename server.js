import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { adminIndex, adminLogin } from './admin/pages.js';
import { config, publicConfig, bundleById } from './src/config.js';
import { db, initDb } from './src/db.js';
import { razorpayEnabled, createRazorpayOrder, verifyPaymentSignature, verifyWebhookSignature } from './src/razorpay.js';
import { login, logout, requireAdmin, isAdmin } from './src/auth.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const ROOT = import.meta.dirname;
// Dashboard HTML lives in a JS module so it is always bundled (Vercel does not ship loose .html files with the function)
const PAGES = { adminIndex, adminLogin };

// Connect to the database once, on the first request (works for a normal server and for Vercel functions)
let dbReady;
app.use(async (_req, res, next) => {
  try { await (dbReady ??= initDb()); next(); }
  catch (e) { dbReady = null; console.error('DB init failed', e); res.status(503).json({ error: 'Store is starting, please try again in a moment.' }); }
});

// ---------- security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com https://connect.facebook.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https://www.facebook.com https://*.razorpay.com",
    "media-src 'self'",
    "connect-src 'self' https://api.postalpincode.in https://*.razorpay.com https://www.facebook.com https://connect.facebook.net",
    "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  ].join('; '));
  next();
});

// ---------- tiny per-IP rate limiter ----------
const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`; const now = Date.now();
    const b = buckets.get(key) || { n: 0, reset: now + windowMs };
    if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
    b.n += 1; buckets.set(key, b);
    if (b.n > max) return res.status(429).json({ error: 'Too many requests, please slow down.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60_000).unref();

// Razorpay webhook needs the raw body, so it is registered before express.json()
app.post('/api/razorpay/webhook', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
  try {
    if (!verifyWebhookSignature(req.body, req.headers['x-razorpay-signature'])) return res.status(400).send('bad signature');
    const evt = JSON.parse(req.body.toString('utf8'));
    const pay = evt?.payload?.payment?.entity;
    if (pay?.order_id) {
      const order = await db.findOne('orders', { razorpayOrderId: pay.order_id });
      if (order && evt.event === 'payment.captured' && order.paymentStatus !== 'paid') {
        await markPaid(order, pay.id, 'webhook');
      } else if (order && evt.event === 'payment.failed' && order.paymentStatus !== 'paid') {
        await db.updateOne('orders', { _id: order._id }, {
          paymentStatus: 'failed', lastPaymentError: pay.error_description || 'failed', updatedAt: new Date(),
          history: [...(order.history || []), { ts: new Date(), msg: `Payment failed (webhook): ${pay.error_description || ''}` }],
        });
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error('webhook', e); res.status(500).send('error'); }
});

app.use(express.json({ limit: '20kb' }));

// ---------- helpers ----------
const clean = (v, max = 200) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const isPhone = (p) => /^[6-9]\d{9}$/.test(p);
const isPin = (p) => /^\d{6}$/.test(p);
const id = (n = 10) => crypto.randomBytes(n).toString('hex');
const smallData = (d) => Object.fromEntries(Object.entries(d && typeof d === 'object' ? d : {}).slice(0, 8)
  .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [clean(k, 30), typeof v === 'string' ? clean(v, 120) : v]));
const normPhone =(p) => String(p || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

function attributionFrom(a = {}) {
  const source = clean(a.source, 60).toLowerCase();
  const fbclid = clean(a.fbclid, 300);
  const isAd = Boolean(fbclid) || ['facebook', 'fb', 'instagram', 'ig', 'meta'].includes(source) || clean(a.medium, 40).toLowerCase().includes('paid');
  let src = source || (a.referrer ? (() => { try { return new URL(a.referrer).hostname.replace(/^www\./, ''); } catch { return 'referral'; } })() : 'direct');
  if (isAd && !source) src = 'meta-ad';
  if (['facebook', 'fb', 'instagram', 'ig', 'meta'].includes(src)) src = isAd ? 'meta-ad' : src;
  return {
    src, isAd,
    campaign: clean(a.campaign, 120), medium: clean(a.medium, 60), content: clean(a.content, 120),
    referrer: clean(a.referrer, 300), landing: clean(a.landing, 300), fbclid: fbclid ? 'yes' : '',
  };
}

async function markPaid(order, paymentId, via) {
  const now = new Date();
  await db.updateOne('orders', { _id: order._id }, {
    paymentStatus: 'paid', status: 'new', razorpayPaymentId: paymentId, paidAt: now, updatedAt: now,
    history: [...(order.history || []), { ts: now, msg: `Paid online ₹${order.amount} (${via})` }],
  });
  if (order.cid) await db.updateOne('checkouts', { _id: order.cid }, { status: 'converted', orderNo: order.orderNo, updatedAt: now });
  await db.insertOne('events', { _id: id(), vid: order.vid, type: 'purchase', ts: now, src: order.src, data: { orderNo: order.orderNo, amount: order.amount, payMethod: 'prepaid' } });
}

// ---------- public API ----------
app.get('/api/config', (_req, res) => res.json(publicConfig()));

const EVENT_TYPES = new Set(['page_view', 'view_content', 'video_play', 'add_to_cart', 'checkout_start',
  'payment_initiated', 'payment_failed', 'payment_cancelled', 'cod_switch', 'whatsapp_click']);

app.post('/api/track', rateLimit('track', 120, 60_000), async (req, res) => {
  try {
    const b = req.body || {};
    const vid = clean(b.vid, 40); const type = clean(b.type, 40);
    if (!vid || !EVENT_TYPES.has(type)) return res.status(400).json({ error: 'bad event' });
    const attr = attributionFrom(b.attribution);
    const now = new Date();
    await db.insertOne('events', { _id: id(), vid, sid: clean(b.sid, 40), type, ts: now, src: attr.src, isAd: attr.isAd, campaign: attr.campaign, data: smallData(b.data) });
    if (type === 'page_view') {
      const existing = await db.findOne('visitors', { vid });
      if (!existing) {
        await db.insertOne('visitors', { _id: vid, vid, firstSeen: now, lastSeen: now, ...attr, device: clean(b.device, 30), visits: 1 });
      } else {
        await db.updateOne('visitors', { vid }, { lastSeen: now, visits: (existing.visits || 1) + 1, ...(attr.isAd ? { lastAdClick: now } : {}) });
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error('track', e); res.json({ ok: false }); }
});

// Saves checkout progress once a valid phone number is typed (used for abandoned-checkout follow-up)
app.post('/api/checkout/progress', rateLimit('progress', 40, 60_000), async (req, res) => {
  const b = req.body || {};
  const cid = clean(b.cid, 40); const phone = normPhone(b.phone);
  if (!cid || !isPhone(phone)) return res.json({ ok: false });
  const attr = attributionFrom(b.attribution);
  const existing = await db.findOne('checkouts', { _id: cid });
  if (existing?.status === 'converted') return res.json({ ok: true });
  const now = new Date();
  await db.updateOne('checkouts', { _id: cid }, {
    _id: cid, vid: clean(b.vid, 40), phone, name: clean(b.name, 80), pincode: clean(b.pincode, 6), city: clean(b.city, 60),
    bundleId: bundleById(b.bundleId) ? b.bundleId : 'single', payMethod: b.payMethod === 'cod' ? 'cod' : 'prepaid',
    src: attr.src, campaign: attr.campaign, status: existing?.status || 'open', updatedAt: now, createdAt: existing?.createdAt || now,
  }, { upsert: true });
  res.json({ ok: true });
});

app.post('/api/orders', rateLimit('orders', 8, 10 * 60_000), async (req, res) => {
  try {
    const b = req.body || {};
    const bundle = bundleById(b.bundleId);
    const payMethod = b.payMethod === 'cod' ? 'cod' : 'prepaid';
    if (!bundle) return res.status(400).json({ error: 'Please choose a pack.' });
    if (payMethod === 'cod' && !config.codEnabled) return res.status(400).json({ error: 'Cash on Delivery is not available right now.' });
    const c = b.customer || {};
    const customer = {
      name: clean(c.name, 80), phone: normPhone(c.phone), email: clean(c.email, 120),
      address: clean(c.address, 300), landmark: clean(c.landmark, 120),
      city: clean(c.city, 60), state: clean(c.state, 60), pincode: clean(c.pincode, 6),
    };
    const errs = [];
    if (customer.name.length < 2) errs.push('name');
    if (!isPhone(customer.phone)) errs.push('phone');
    if (customer.address.length < 8) errs.push('address');
    if (!customer.city) errs.push('city');
    if (!customer.state) errs.push('state');
    if (!isPin(customer.pincode)) errs.push('pincode');
    if (errs.length) return res.status(400).json({ error: 'Please check: ' + errs.join(', '), fields: errs });

    const attr = attributionFrom(b.attribution);
    const now = new Date();
    const orderNo = `SD${await db.nextSeq('order')}`;
    const amount = payMethod === 'cod' ? bundle.cod : bundle.prepaid;
    const order = {
      _id: orderNo, orderNo, createdAt: now, updatedAt: now,
      vid: clean(b.vid, 40), cid: clean(b.cid, 40),
      bundleId: bundle.id, bundleTitle: bundle.title, qty: bundle.qty, amount, payMethod,
      paymentStatus: payMethod === 'cod' ? 'cod' : 'awaiting',
      status: payMethod === 'cod' ? 'new' : 'pending_payment',
      customer, src: attr.src, isAd: attr.isAd, campaign: attr.campaign,
      history: [{ ts: now, msg: `Order placed – ${payMethod === 'cod' ? 'Cash on Delivery' : 'Online payment'} ₹${amount}` }],
    };

    if (payMethod === 'prepaid') {
      if (razorpayEnabled()) {
        const rz = await createRazorpayOrder({ amountRupees: amount, receipt: orderNo, notes: { orderNo, phone: customer.phone } });
        order.razorpayOrderId = rz.id;
      } else if (!config.paymentMock) {
        return res.status(503).json({ error: 'Online payment is not set up yet. Please choose Cash on Delivery.' });
      } else {
        order.razorpayOrderId = `mock_${id(6)}`;
      }
    }
    await db.insertOne('orders', order);

    if (payMethod === 'cod') {
      if (order.cid) await db.updateOne('checkouts', { _id: order.cid }, { status: 'converted', orderNo, updatedAt: now });
      await db.insertOne('events', { _id: id(), vid: order.vid, type: 'purchase', ts: now, src: order.src, data: { orderNo, amount, payMethod } });
      return res.json({ orderNo, amount, payMethod });
    }
    res.json({
      orderNo, amount, payMethod,
      razorpay: { orderId: order.razorpayOrderId, keyId: config.razorpayKeyId || null, amountPaise: amount * 100, mock: !razorpayEnabled() },
    });
  } catch (e) {
    console.error('order', e);
    res.status(500).json({ error: 'Could not place the order. Please try again.' });
  }
});

app.post('/api/payments/verify', rateLimit('verify', 20, 10 * 60_000), async (req, res) => {
  const b = req.body || {};
  const order = await db.findOne('orders', { _id: clean(b.orderNo, 20) });
  if (!order || order.razorpayOrderId !== b.razorpay_order_id) return res.status(400).json({ error: 'Order not found' });
  if (order.paymentStatus === 'paid') return res.json({ ok: true, orderNo: order.orderNo });
  if (!verifyPaymentSignature(b)) return res.status(400).json({ error: 'Payment could not be verified' });
  await markPaid(order, clean(b.razorpay_payment_id, 60), 'checkout');
  res.json({ ok: true, orderNo: order.orderNo });
});

// Local testing only (no Razorpay keys): simulate a successful online payment
app.post('/api/payments/mock-success', async (req, res) => {
  if (!config.paymentMock || razorpayEnabled()) return res.status(404).end();
  const order = await db.findOne('orders', { _id: clean(req.body?.orderNo, 20) });
  if (!order || order.paymentStatus === 'paid') return res.status(400).json({ error: 'bad order' });
  await markPaid(order, `mockpay_${id(5)}`, 'test mode');
  res.json({ ok: true, orderNo: order.orderNo });
});

app.post('/api/payments/failed', rateLimit('failed', 20, 10 * 60_000), async (req, res) => {
  const order = await db.findOne('orders', { _id: clean(req.body?.orderNo, 20) });
  if (!order || order.paymentStatus === 'paid') return res.json({ ok: true });
  const reason = clean(req.body?.reason, 200) || 'Payment not completed';
  await db.updateOne('orders', { _id: order._id }, {
    paymentStatus: 'failed', lastPaymentError: reason, updatedAt: new Date(),
    history: [...(order.history || []), { ts: new Date(), msg: `Payment not completed: ${reason}` }],
  });
  res.json({ ok: true });
});

// Customer closed/failed online payment → switch the same order to Cash on Delivery (saves the sale)
app.post('/api/orders/:orderNo/switch-cod', rateLimit('switch', 10, 10 * 60_000), async (req, res) => {
  if (!config.codEnabled) return res.status(400).json({ error: 'COD not available' });
  const order = await db.findOne('orders', { _id: clean(req.params.orderNo, 20) });
  if (!order || order.vid !== clean(req.body?.vid, 40) || order.paymentStatus === 'paid' || order.payMethod === 'cod') {
    return res.status(400).json({ error: 'Cannot switch this order' });
  }
  const bundle = bundleById(order.bundleId);
  const now = new Date();
  await db.updateOne('orders', { _id: order._id }, {
    payMethod: 'cod', amount: bundle.cod, paymentStatus: 'cod', status: 'new', updatedAt: now,
    history: [...(order.history || []), { ts: now, msg: `Switched to Cash on Delivery ₹${bundle.cod}` }],
  });
  if (order.cid) await db.updateOne('checkouts', { _id: order.cid }, { status: 'converted', orderNo: order.orderNo, updatedAt: now });
  await db.insertOne('events', { _id: id(), vid: order.vid, type: 'purchase', ts: now, src: order.src, data: { orderNo: order.orderNo, amount: bundle.cod, payMethod: 'cod' } });
  res.json({ ok: true, orderNo: order.orderNo, amount: bundle.cod, payMethod: 'cod' });
});

// Reviews: only real customers (order number + phone) can post; you approve them in the dashboard
app.get('/api/reviews', async (_req, res) => {
  const r = await db.find('reviews', { approved: true }, { sort: { createdAt: -1 }, limit: 50 });
  res.json(r.map(({ name, city, rating, text, createdAt }) => ({ name, city, rating, text, createdAt })));
});

app.post('/api/reviews', rateLimit('reviews', 5, 60 * 60_000), async (req, res) => {
  const b = req.body || {};
  const order = await db.findOne('orders', { _id: clean(b.orderNo, 20).toUpperCase() });
  if (!order || order.customer.phone !== normPhone(b.phone)) return res.status(400).json({ error: 'Order number and phone do not match.' });
  const rating = Math.min(5, Math.max(1, Number(b.rating) || 0));
  const text = clean(b.text, 600);
  if (!rating || text.length < 5) return res.status(400).json({ error: 'Please add a rating and a few words.' });
  await db.insertOne('reviews', { _id: id(), orderNo: order.orderNo, name: clean(b.name, 40) || order.customer.name.split(' ')[0], city: order.customer.city, rating, text, approved: false, createdAt: new Date() });
  res.json({ ok: true });
});

// ---------- admin ----------
app.post('/api/admin/login', rateLimit('login', 20, 15 * 60_000), login);
app.post('/api/admin/logout', logout);
app.get('/admin/login', (req, res) => (isAdmin(req) ? res.redirect('/admin') : res.type('html').set('Cache-Control', 'no-store').send(PAGES.adminLogin)));
app.get(['/admin', '/admin/'], requireAdmin, (_req, res) => res.type('html').set('Cache-Control', 'no-store').send(PAGES.adminIndex));
app.use('/api/admin', requireAdmin);

const IST = 330 * 60_000;
const dayKey = (d) => new Date(new Date(d).getTime() + IST).toISOString().slice(0, 10);
const VALID_ORDER = (o) => o.status !== 'pending_payment' && !['cancelled'].includes(o.status);

function range(q) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * 864e5);
  return { from, to };
}

app.get('/api/admin/stats', async (req, res) => {
  const { from, to } = range(req.query);
  const tf = { $gte: from, $lte: to };
  const [events, orders, checkouts] = await Promise.all([
    db.find('events', { ts: tf }),
    db.find('orders', { createdAt: tf }),
    db.find('checkouts', { updatedAt: tf }),
  ]);
  const uniq = (type, pred = () => true) => new Set(events.filter((e) => e.type === type && pred(e)).map((e) => e.vid)).size;
  const valid = orders.filter(VALID_ORDER);
  const delivered = valid.filter((o) => o.status === 'delivered');
  const rto = orders.filter((o) => o.status === 'rto');
  const revenue = valid.filter((o) => o.status !== 'rto').reduce((s, o) => s + o.amount, 0);
  const prepaid = valid.filter((o) => o.payMethod === 'prepaid');
  const abandonedCut = Date.now() - 20 * 60_000;
  const abandoned = checkouts.filter((c) => c.status !== 'converted' && new Date(c.updatedAt).getTime() < abandonedCut);

  const funnel = {
    adClicks: uniq('page_view', (e) => e.isAd),
    visitors: uniq('page_view'),
    viewedOffer: uniq('view_content'),
    addToCart: uniq('add_to_cart'),
    checkoutStarted: uniq('checkout_start'),
    paymentInitiated: uniq('payment_initiated'),
    orders: valid.length,
  };

  // per-day series
  const days = {};
  for (let t = new Date(dayKey(from)).getTime(); t <= new Date(dayKey(to)).getTime(); t += 864e5) {
    days[new Date(t).toISOString().slice(0, 10)] = { visitors: new Set(), orders: 0, revenue: 0 };
  }
  events.filter((e) => e.type === 'page_view').forEach((e) => days[dayKey(e.ts)]?.visitors.add(e.vid));
  valid.forEach((o) => { const d = days[dayKey(o.createdAt)]; if (d) { d.orders += 1; d.revenue += o.amount; } });
  const daily = Object.entries(days).map(([date, d]) => ({ date, visitors: d.visitors.size, orders: d.orders, revenue: d.revenue }));

  // per-source table
  const sources = {};
  const S = (k) => (sources[k] ??= { source: k, visitors: new Set(), addToCart: new Set(), orders: 0, revenue: 0 });
  events.forEach((e) => {
    if (e.type === 'page_view') S(e.src || 'direct').visitors.add(e.vid);
    if (e.type === 'add_to_cart') S(e.src || 'direct').addToCart.add(e.vid);
  });
  valid.forEach((o) => { const s = S(o.src || 'direct'); s.orders += 1; s.revenue += o.amount; });
  const campaigns = {};
  valid.forEach((o) => { if (o.campaign) { const c = (campaigns[o.campaign] ??= { campaign: o.campaign, orders: 0, revenue: 0 }); c.orders += 1; c.revenue += o.amount; } });

  res.json({
    from, to, funnel, revenue,
    ordersCount: valid.length, prepaidCount: prepaid.length, codCount: valid.length - prepaid.length,
    aov: valid.length ? Math.round(revenue / valid.length) : 0,
    deliveredCount: delivered.length, rtoCount: rto.length,
    awaitingPayment: orders.filter((o) => o.status === 'pending_payment').length,
    failedPayments: orders.filter((o) => o.paymentStatus === 'failed').length,
    abandonedCount: abandoned.length,
    conversionRate: funnel.visitors ? +(100 * valid.length / funnel.visitors).toFixed(2) : 0,
    daily,
    sources: Object.values(sources).map((s) => ({ source: s.source, visitors: s.visitors.size, addToCart: s.addToCart.size, orders: s.orders, revenue: s.revenue }))
      .sort((a, b) => b.visitors - a.visitors),
    campaigns: Object.values(campaigns).sort((a, b) => b.revenue - a.revenue),
  });
});

app.get('/api/admin/orders', async (req, res) => {
  const f = {};
  if (req.query.status && req.query.status !== 'all') f.status = clean(req.query.status, 30);
  let list = await db.find('orders', f, { sort: { createdAt: -1 }, limit: 500 });
  const q = clean(req.query.q, 60).toLowerCase();
  if (q) list = list.filter((o) => [o.orderNo, o.customer.name, o.customer.phone, o.customer.city, o.customer.pincode].join(' ').toLowerCase().includes(q));
  res.json(list);
});

const ORDER_STATUSES = ['pending_payment', 'new', 'confirmed', 'shipped', 'delivered', 'cancelled', 'rto'];
app.patch('/api/admin/orders/:orderNo', async (req, res) => {
  const order = await db.findOne('orders', { _id: clean(req.params.orderNo, 20) });
  if (!order) return res.status(404).json({ error: 'not found' });
  const b = req.body || {}; const set = { updatedAt: new Date() }; const notes = [];
  if (b.status && ORDER_STATUSES.includes(b.status) && b.status !== order.status) { set.status = b.status; notes.push(`Status → ${b.status}`); }
  if (b.trackingId !== undefined) { set.trackingId = clean(b.trackingId, 80); notes.push(`Tracking: ${set.trackingId}`); }
  if (b.courier !== undefined) set.courier = clean(b.courier, 60);
  if (b.note) notes.push(`Note: ${clean(b.note, 300)}`);
  if (b.codCollected === true && order.payMethod === 'cod') { set.paymentStatus = 'cod_collected'; notes.push('COD cash collected'); }
  if (set.status === 'delivered' && order.payMethod === 'cod') set.paymentStatus = 'cod_collected';
  set.history = [...(order.history || []), ...notes.map((msg) => ({ ts: new Date(), msg }))];
  res.json(await db.updateOne('orders', { _id: order._id }, set));
});

app.get('/api/admin/abandoned', async (_req, res) => {
  const cut = new Date(Date.now() - 20 * 60_000);
  const list = await db.find('checkouts', { status: { $ne: 'converted' }, updatedAt: { $lte: cut } }, { sort: { updatedAt: -1 }, limit: 200 });
  res.json(list);
});
app.patch('/api/admin/checkouts/:cid', async (req, res) => {
  res.json(await db.updateOne('checkouts', { _id: clean(req.params.cid, 40) }, { status: req.body?.status === 'contacted' ? 'contacted' : 'open', contactedAt: new Date() }));
});

app.get('/api/admin/reviews', async (_req, res) => res.json(await db.find('reviews', {}, { sort: { createdAt: -1 }, limit: 200 })));
app.patch('/api/admin/reviews/:rid', async (req, res) => {
  res.json(await db.updateOne('reviews', { _id: clean(req.params.rid, 40) }, { approved: Boolean(req.body?.approved) }));
});

app.get('/api/admin/orders.csv', async (_req, res) => {
  const list = await db.find('orders', {}, { sort: { createdAt: -1 } });
  const cols = ['orderNo', 'createdAt', 'status', 'payMethod', 'paymentStatus', 'amount', 'bundleTitle', 'qty', 'name', 'phone', 'address', 'landmark', 'city', 'state', 'pincode', 'src', 'campaign', 'courier', 'trackingId'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = list.map((o) => cols.map((c) => esc(c === 'createdAt' ? new Date(o.createdAt).toISOString() : (o[c] ?? o.customer?.[c]))).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="orders-${dayKey(new Date())}.csv"`);
  res.send([cols.join(','), ...rows].join('\n'));
});

// ---------- storefront ----------
app.use(express.static(path.join(ROOT, 'public'), { maxAge: config.isProd ? '7d' : 0, setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
// Local server: page routes (on Vercel these are served directly from public/ – see vercel.json)
const STORE_FILE = path.join(ROOT, 'public/store.html');
app.get(['/', '/store'], (req, res) => {
  try {
    return res.type('html').set('Cache-Control', 'public, max-age=0, s-maxage=300').send(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch { /* file not bundled with the function – fall through to redirect */ }
  // On Vercel the page lives on the CDN at /store – keep the ad tracking parameters
  const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(302, '/store' + q);
});
app.get(['/policies', '/review'], (req, res) => res.sendFile(path.join(ROOT, `public${req.path}.html`)));
app.use((req, res) => (req.path.startsWith('/api/') ? res.status(404).json({ error: 'Not found' }) : res.redirect(302, '/')));

if (config.isProd && (!config.adminPassword || !config.sessionSecret)) {
  console.error('⚠ ADMIN_PASSWORD and SESSION_SECRET are not set – the dashboard stays locked until you add them.');
}

// On Vercel the platform runs the exported app; locally we start a normal server.
export default app;
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`Store running → http://localhost:${config.port}`);
    console.log(`Dashboard     → http://localhost:${config.port}/admin`);
    if (!razorpayEnabled()) console.log(config.paymentMock ? '⚠ Razorpay keys not set – online payments run in TEST MODE (simulated).' : '⚠ Razorpay keys not set – online payment disabled.');
  });
}
