// Storefront logic: offer, checkout, payments, tracking.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 24);

// ---------- visitor + attribution ----------
let vid = store.get('vid'); if (!vid) { vid = rid(); store.set('vid', vid); }
let sid = store.sget('sid'); if (!sid) { sid = rid(); store.sset('sid', sid); }
const qs = new URLSearchParams(location.search);
let attribution;
if (qs.get('utm_source') || qs.get('fbclid') || !store.sget('attr')) {
  attribution = {
    source: qs.get('utm_source') || '', medium: qs.get('utm_medium') || '', campaign: qs.get('utm_campaign') || '',
    content: qs.get('utm_content') || '', fbclid: qs.get('fbclid') || '',
    referrer: document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : '',
    landing: location.pathname + location.search,
  };
  store.sset('attr', JSON.stringify(attribution));
} else {
  try { attribution = JSON.parse(store.sget('attr')); } catch { attribution = {}; }
}
const device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';

const sentOnce = new Set();
function track(type, data = {}, once = false) {
  if (once) { if (sentOnce.has(type)) return; sentOnce.add(type); }
  const body = JSON.stringify({ vid, sid, type, data, attribution, device });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
    else fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch {}
}
const api = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Please try again.'), { fields: j.fields });
  return j;
};

// ---------- Meta Pixel (optional) ----------
function pixel(...args) { if (window.fbq) window.fbq(...args); }
function loadPixel(id) {
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', id); window.fbq('track', 'PageView');
}

// ---------- state ----------
let cfg; let bundle; let payMethod = 'prepaid';
let cid = store.sget('cid') || rid(); store.sset('cid', cid);
let currentOrder = null;
const rupee = (n) => Number(n).toLocaleString('en-IN');

function priceFor(b = bundle, m = payMethod) { return m === 'cod' ? b.cod : b.prepaid; }

function render() {
  const save = bundle.cod - bundle.prepaid;
  $$('[data-price-prepaid]').forEach((e) => (e.textContent = rupee(bundle.prepaid)));
  $$('[data-price-cod]').forEach((e) => (e.textContent = rupee(bundle.cod)));
  $$('[data-save]').forEach((e) => (e.textContent = save));
  $$('[data-cta-price]').forEach((e) => (e.textContent = rupee(bundle.prepaid)));
  $$('[data-sheet-prepaid]').forEach((e) => (e.textContent = rupee(bundle.prepaid)));
  $$('[data-sheet-cod]').forEach((e) => (e.textContent = rupee(bundle.cod)));
  $$('[data-sheet-save]').forEach((e) => (e.textContent = save));
  $$('.pack').forEach((p) => p.classList.toggle('on', p.dataset.id === bundle.id));
  $$('.pay-opt').forEach((p) => p.classList.toggle('on', p.dataset.pay === payMethod));
  const total = priceFor();
  $('#sum-label').textContent = `${bundle.title}${bundle.qty > 1 ? ` (${bundle.qty} × posture belt)` : ' – posture belt'}`;
  $('#sum-sub').textContent = rupee(total);
  $('#sum-total').textContent = rupee(total);
  $('#place-btn').textContent = payMethod === 'cod' ? `Place COD order · ₹${rupee(total)}` : `Pay ₹${rupee(total)} securely`;
}

function packHTML(b) {
  const each = b.qty > 1 ? `<span class="p-each">₹${Math.round(b.prepaid / b.qty)} each</span>` : '<span class="p-each">&nbsp;</span>';
  return `<button type="button" class="pack" data-id="${b.id}" role="radio">
    ${b.tag ? `<span class="p-tag">${b.tag}</span>` : ''}
    <b>${b.title}</b><span class="p-sub">${b.subtitle}</span>
    <span class="p-price">₹${rupee(b.prepaid)}</span>${each}</button>`;
}

function fillBusiness() {
  const B = cfg.business;
  $$('[data-brand]').forEach((e) => (e.textContent = cfg.brand));
  $$('[data-repl]').forEach((e) => (e.textContent = cfg.replacementDays));
  $$('[data-dispatch]').forEach((e) => (e.textContent = cfg.dispatchDays));
  $$('[data-delivery]').forEach((e) => (e.textContent = cfg.deliveryDays));
  if (B.whatsapp) {
    const wa = `https://wa.me/${B.whatsapp}?text=${encodeURIComponent(`Hi ${cfg.brand}, I have a question about the posture belt`)}`;
    $$('[data-wa-wrap]').forEach((e) => (e.hidden = false));
    $$('[data-whatsapp]').forEach((a) => { a.href = wa; a.target = '_blank'; a.rel = 'noopener'; a.addEventListener('click', () => track('whatsapp_click')); });
  }
  $$('[data-email]').forEach((a) => (a.href = `mailto:${B.email}`));
  $$('[data-email-text]').forEach((a) => (a.textContent = B.email));
  $$('[data-legal]').forEach((e) => (e.textContent = [`© ${new Date().getFullYear()} ${B.legalName || cfg.brand}`, B.address].filter(Boolean).join(' · ')));
  if (!cfg.codEnabled) { $('#cod-opt').hidden = true; $$('.cod-note').forEach((e) => (e.hidden = true)); }
  // Online payment not set up yet (no Razorpay keys on the live site) → only offer COD so nobody hits an error
  if (!cfg.razorpayKeyId && !cfg.paymentMock && cfg.codEnabled) {
    const pre = $('.pay-opt[data-pay="prepaid"]'); pre.hidden = true;
    $('input[name="payMethod"][value="cod"]').checked = true; payMethod = 'cod';
  }
}

// ---------- gallery ----------
function initGallery() {
  const slides = $('#slides'); const dots = $('#dots');
  const n = slides.children.length;
  dots.innerHTML = Array.from({ length: n }, (_, i) => `<button aria-label="Image ${i + 1}" data-i="${i}"></button>`).join('');
  const setDot = () => {
    const i = Math.round(slides.scrollLeft / slides.clientWidth);
    $$('button', dots).forEach((d, j) => d.classList.toggle('on', j === i));
    $$('video[data-autoplay]', slides).forEach((v) => {
      const on = v.closest('.slide') === slides.children[i];
      if (on) { v.play().catch(() => {}); track('video_play', { where: 'gallery' }, true); } else v.pause();
    });
  };
  slides.addEventListener('scroll', () => requestAnimationFrame(setDot), { passive: true });
  dots.addEventListener('click', (e) => { const i = e.target.dataset.i; if (i) slides.scrollTo({ left: i * slides.clientWidth, behavior: 'smooth' }); });
  setDot();
}

function initVideos() {
  $$('.video-card').forEach((card) => {
    const v = $('video', card);
    const toggle = () => {
      if (v.paused) { $$('.video-card video').forEach((o) => o !== v && o.pause()); v.play(); card.classList.add('playing'); track('video_play', { where: 'videos' }); }
      else { v.pause(); card.classList.remove('playing'); }
    };
    card.addEventListener('click', toggle);
  });
}

// ---------- reviews ----------
const MEESHO_DIST = [['Excellent', 1539], ['Very good', 464], ['Good', 346], ['Average', 138], ['Poor', 262]];
const MEESHO_REVIEWS = [
  { n: 'Meesho User', d: '20 Mar 2026', t: 'Very good quality and strong material i appreciate it you can definitely buy it it\'s very good 👍🏻😊', h: 38 },
  { n: 'Meesho User', d: '15 Oct 2025', t: 'It\'s useful for office work, it makes back straight and painless.', h: 23 },
  { n: 'Vivek kumar', d: '21 Oct 2026', t: 'Good quality posture corrector belt at an affordable price. It is comfortable to wear, lightweight, and easy to adjust. Provides good back support and helps maintain proper posture while sitting, walking, or working.' },
  { n: 'Meesho User', d: '1 Aug 2026', t: 'I liked the product it\'s affordable and easy to use. I liked the quality as well better from other products to be honest.', h: 30 },
  { n: 'Arif Husain Kasu', d: '31 Aug 2026', t: 'Jaisa photo mein tha same vaisa hi aaya hai. Thank you Meesho. Aap log bhi yah belt le sakte ho.', h: 9 },
  { n: 'Divyansh Verma', d: '31 Aug 2026', t: 'This is too good in quality, beyond my expectations. Worth it 👌' },
  { n: 'Meesho User', d: '10 Aug 2026', t: 'Yah product kamar ke liye bahut hi faydemand hai, isko koi bhi manga sakta, bahut achcha result hai iska.', h: 11 },
  { n: 'Divya Dixit', d: '20 Aug 2026', t: 'It\'s a very good and useful product.. Must buy. The material used is sturdy and nice. Value for money.' },
  { n: 'Meesho User', d: '21 Aug 2026', t: 'This belt is good in quality. It is useful to reduce backpain.. I\'m happy to have found it.' },
  { n: 'Kapil', d: '8 Oct 2025', t: 'This product is best and value for money.' },
  { n: 'Moin', d: '18 Jul 2026', t: 'V good in condition and very good in comfortable.' },
  { n: 'Shivani Sandeep Kumar', d: '3 Aug 2026', t: 'Material or quality bahut achhi hai, thank you Meesho.' },
];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reviewHTML = (r, badge) => `<article class="review"><div class="review-top"><span class="review-name">${esc(r.n)}</span><span class="stars">${'★'.repeat(r.r || 5)}${'☆'.repeat(5 - (r.r || 5))}</span></div>
  <div class="r-meta"><span class="verified">✓ ${badge}</span> · ${esc(r.d)}${r.h ? ` · ${r.h} found helpful` : ''}</div><p>${esc(r.t)}</p></article>`;

async function initReviews() {
  const total = MEESHO_DIST.reduce((s, [, c]) => s + c, 0);
  $('#bars').innerHTML = MEESHO_DIST.map(([l, c]) => `<div class="bar"><span>${l}</span><div class="bar-track"><div class="bar-fill" style="width:${(100 * c / total).toFixed(1)}%"></div></div><span>${c}</span></div>`).join('');
  let shown = 4;
  const list = $('#review-list');
  const draw = () => { list.innerHTML = MEESHO_REVIEWS.slice(0, shown).map((r) => reviewHTML(r, 'Verified Meesho buyer')).join(''); $('#more-reviews').hidden = shown >= MEESHO_REVIEWS.length; };
  $('#more-reviews').addEventListener('click', () => { shown += 4; draw(); });
  draw();
  try {
    const ours = await (await fetch('/api/reviews')).json();
    if (ours.length) {
      $('#our-reviews').innerHTML = `<h3 class="our-title">From our customers</h3><div class="review-list">${ours.slice(0, 6).map((r) => reviewHTML({ n: `${r.name}${r.city ? ', ' + r.city : ''}`, d: new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), t: r.text, r: r.rating }, 'Verified purchase')).join('')}</div>`;
    }
  } catch {}
}

// ---------- checkout sheet ----------
const sheet = $('#sheet'); const backdrop = $('#sheet-backdrop'); const form = $('#checkout');
function showPanel(which) {
  form.hidden = which !== 'form'; $('#pay-retry').hidden = which !== 'retry'; $('#thanks').hidden = which !== 'thanks';
  $('#sheet-title').textContent = which === 'thanks' ? 'Thank you! 🎉' : which === 'retry' ? 'Almost done' : 'Complete your order';
}
function openSheet(src) {
  track('add_to_cart', { bundle: bundle.id, from: src });
  pixel('track', 'AddToCart', { value: bundle.prepaid, currency: 'INR', content_name: 'Posture Corrector Belt', content_type: 'product', content_ids: [bundle.id] });
  if (!currentOrder || currentOrder.done) showPanel('form');
  sheet.hidden = false; backdrop.hidden = false; document.body.classList.add('lock');
  setTimeout(() => { if (!form.hidden && !form.name.value) form.name.focus({ preventScroll: true }); }, 250);
}
function closeSheet() { sheet.hidden = true; backdrop.hidden = true; document.body.classList.remove('lock'); }
$('#sheet-close').addEventListener('click', closeSheet);
backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

function selectBundle(id) { bundle = cfg.bundles.find((b) => b.id === id) || cfg.bundles[0]; render(); }
document.addEventListener('click', (e) => {
  const p = e.target.closest('.pack'); if (p) { selectBundle(p.dataset.id); saveProgress(); }
  const b = e.target.closest('[data-buy]'); if (b) openSheet(b.closest('.sticky-bar') ? 'sticky' : b.closest('.recap') ? 'recap' : 'hero');
});
$$('input[name="payMethod"]').forEach((r) => r.addEventListener('change', () => { payMethod = r.value; render(); saveProgress(); }));

// Remember what the customer typed (so a refresh doesn't lose it)
const FIELDS = ['name', 'phone', 'pincode', 'city', 'state', 'address', 'landmark'];
try { const saved = JSON.parse(store.get('form') || '{}'); FIELDS.forEach((f) => { if (saved[f]) form[f].value = saved[f]; }); } catch {}

let progressTimer;
function saveProgress() {
  store.set('form', JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, form[f].value]))));
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    const phone = form.phone.value.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(phone)) return;
    track('checkout_start', {}, true);
    if (!sentOnce.has('pixel_ic')) { sentOnce.add('pixel_ic'); pixel('track', 'InitiateCheckout', { value: priceFor(), currency: 'INR', num_items: bundle.qty }); }
    api('/api/checkout/progress', { cid, vid, phone, name: form.name.value, pincode: form.pincode.value, city: form.city.value, bundleId: bundle.id, payMethod, attribution }).catch(() => {});
  }, 600);
}
form.addEventListener('input', (e) => { e.target.classList.remove('bad'); saveProgress(); });
form.phone.addEventListener('input', () => { form.phone.value = form.phone.value.replace(/\D/g, '').slice(0, 10); });

// PIN code → city & state (India Post API)
let lastPin = '';
const pinLookup = async () => {
  form.pincode.value = form.pincode.value.replace(/\D/g, '').slice(0, 6);
  if (form.pincode.value.length !== 6 || form.pincode.value === lastPin) return;
  lastPin = form.pincode.value;
  try {
    const r = await (await fetch(`https://api.postalpincode.in/pincode/${form.pincode.value}`)).json();
    const po = r?.[0]?.PostOffice?.[0];
    if (po) {
      if (!form.city.value) form.city.value = po.District;
      if (!form.state.value) form.state.value = po.State;
      saveProgress();
    } else { form.pincode.classList.add('bad'); }
  } catch { lastPin = ''; }
};
['input', 'change', 'blur', 'keyup'].forEach((ev) => form.pincode.addEventListener(ev, pinLookup));
if (form.pincode.value.length === 6) pinLookup();

function validate() {
  const v = Object.fromEntries(FIELDS.map((f) => [f, form[f].value.trim()]));
  const bad = [];
  if (v.name.length < 2) bad.push('name');
  if (!/^[6-9]\d{9}$/.test(v.phone)) bad.push('phone');
  if (!/^\d{6}$/.test(v.pincode)) bad.push('pincode');
  if (!v.city) bad.push('city');
  if (!v.state) bad.push('state');
  if (v.address.length < 8) bad.push('address');
  return { v, bad };
}
function showError(msg, fields = []) {
  const box = $('#form-error'); box.textContent = msg; box.hidden = !msg;
  fields.forEach((f) => form[f]?.classList.add('bad'));
  if (fields[0] && form[fields[0]]) form[fields[0]].focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const { v, bad } = validate();
  if (bad.length) {
    const names = { name: 'your name', phone: 'a valid 10-digit mobile number', pincode: 'a 6-digit PIN code', city: 'city', state: 'state', address: 'your full address' };
    return showError(`Please enter ${bad.map((b) => names[b]).join(', ')}.`, bad);
  }
  const btn = $('#place-btn'); btn.disabled = true; const label = btn.textContent; btn.textContent = 'Please wait…';
  try {
    const res = await api('/api/orders', { cid, vid, bundleId: bundle.id, payMethod, customer: v, attribution });
    currentOrder = { ...res, customer: v, bundle };
    if (res.payMethod === 'cod') return orderDone();
    pixel('track', 'AddPaymentInfo', { value: res.amount, currency: 'INR' });
    openPayment();
  } catch (err) {
    showError(err.message, err.fields || []);
  } finally { btn.disabled = false; btn.textContent = label; }
});

// ---------- payment ----------
let rzpLoading;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  rzpLoading ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => { rzpLoading = null; rej(new Error('Could not load payment window. Check your internet and try again.')); }; document.head.appendChild(s); });
  return rzpLoading;
}

async function openPayment() {
  const o = currentOrder;
  track('payment_initiated', { orderNo: o.orderNo, amount: o.amount });
  if (o.razorpay.mock) { $('#mockpay').hidden = false; return; }
  try { await loadRazorpay(); } catch (e) { return paymentNotDone(e.message); }
  const rzp = new window.Razorpay({
    key: o.razorpay.keyId, order_id: o.razorpay.orderId, amount: o.razorpay.amountPaise, currency: 'INR',
    name: cfg.brand, description: `${o.bundle.title} – Posture Corrector Belt`, image: '/media/back-closeup.jpg',
    prefill: { name: o.customer.name, contact: '+91' + o.customer.phone },
    notes: { orderNo: o.orderNo }, theme: { color: '#0f1b2d' },
    handler: async (resp) => {
      try { await api('/api/payments/verify', { orderNo: o.orderNo, ...resp }); orderDone(); }
      catch (e) { paymentNotDone('We could not confirm the payment. If money was deducted, it will be auto-confirmed shortly – email us with your order number at ' + cfg.business.email); }
    },
    modal: { ondismiss: () => { if (!currentOrder.done) { api('/api/payments/failed', { orderNo: o.orderNo, reason: 'Payment window closed' }).catch(() => {}); track('payment_cancelled', { orderNo: o.orderNo }); paymentNotDone(); } } },
  });
  rzp.on('payment.failed', (r) => { track('payment_failed', { orderNo: o.orderNo, reason: r?.error?.description || '' }); });
  rzp.open();
}

function paymentNotDone(msg) {
  const o = currentOrder;
  $('#retry-amt').textContent = rupee(o.amount);
  $('#switch-amt').textContent = rupee(o.bundle.cod);
  $('#switch-cod').hidden = !cfg.codEnabled;
  if (msg) $('#pay-retry p').textContent = msg;
  showPanel('retry');
  sheet.hidden = false; backdrop.hidden = false; document.body.classList.add('lock');
}
$('#retry-pay').addEventListener('click', openPayment);
$('#switch-cod').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api(`/api/orders/${currentOrder.orderNo}/switch-cod`, { vid });
    Object.assign(currentOrder, r); track('cod_switch', { orderNo: r.orderNo }); orderDone();
  } catch (err) { alert(err.message); } finally { e.target.disabled = false; }
});

// Test-mode payment window
$('#mock-ok').addEventListener('click', async () => {
  $('#mockpay').hidden = true;
  try { await api('/api/payments/mock-success', { orderNo: currentOrder.orderNo }); orderDone(); } catch (e) { paymentNotDone(e.message); }
});
$('#mock-fail').addEventListener('click', () => {
  $('#mockpay').hidden = true;
  api('/api/payments/failed', { orderNo: currentOrder.orderNo, reason: 'Test: payment closed' }).catch(() => {});
  track('payment_cancelled', { orderNo: currentOrder.orderNo }); paymentNotDone();
});

function orderDone() {
  const o = currentOrder; o.done = true;
  pixel('track', 'Purchase', { value: o.amount, currency: 'INR', content_ids: [o.bundle.id], content_type: 'product', num_items: o.bundle.qty }, { eventID: o.orderNo });
  store.set('form', '{}'); cid = rid(); store.sset('cid', cid);
  $('#t-order').textContent = '#' + o.orderNo;
  const cod = o.payMethod === 'cod';
  $('#t-box').innerHTML = `<div><span>${esc(o.bundle.title)}</span><b>₹${rupee(o.amount)}</b></div>
    <div><span>Payment</span><b>${cod ? 'Cash on Delivery' : 'Paid online ✓'}</b></div>
    <div><span>Deliver to</span><b>${esc(o.customer.name)}, ${esc(o.customer.city)} ${esc(o.customer.pincode)}</b></div>`;
  $('#t-next').innerHTML = (cod
    ? [`We’ll confirm your order by call/WhatsApp – please keep <b>+91 ${esc(o.customer.phone)}</b> reachable.`, `Keep <b>₹${rupee(o.amount)}</b> ready when the parcel arrives.`]
    : ['Payment received – your order gets <b>priority dispatch</b>.', `Tracking details will be sent to <b>+91 ${esc(o.customer.phone)}</b>.`])
    .concat([`Delivery in about ${cfg.deliveryDays}.`, 'Tip: start with 20–30 min a day.']).map((t) => `<li>${t}</li>`).join('');
  $('#t-help').href = `mailto:${cfg.business.email}?subject=${encodeURIComponent(`Order ${o.orderNo}`)}`;
  showPanel('thanks');
  sheet.hidden = false; backdrop.hidden = false; document.body.classList.add('lock');
  sheet.scrollTop = 0;
}

// ---------- sticky bar + view tracking ----------
function initScrollUX() {
  const sticky = $('#sticky'); const heroCta = $('.price-card .btn-buy');
  new IntersectionObserver(([e]) => sticky.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 }).observe(heroCta);
  new IntersectionObserver(([e]) => { if (e.isIntersecting) { track('view_content', {}, true); if (!sentOnce.has('pixel_vc')) { sentOnce.add('pixel_vc'); pixel('track', 'ViewContent', { value: bundle.prepaid, currency: 'INR', content_type: 'product', content_ids: [bundle.id] }); } } }, { threshold: 0.6 }).observe($('#offer'));
  setTimeout(() => heroCta.classList.add('pulse'), 6000);
}

// ---------- boot ----------
(async function boot() {
  track('page_view', { path: location.pathname });
  try { cfg = await (await fetch('/api/config')).json(); } catch { cfg = null; }
  if (!cfg) return;
  if (cfg.metaPixelId) loadPixel(cfg.metaPixelId);
  bundle = cfg.bundles[0];
  $('#packs').innerHTML = cfg.bundles.map(packHTML).join('');
  $('#sheet-packs').innerHTML = cfg.bundles.map(packHTML).join('');
  fillBusiness(); render(); initGallery(); initVideos(); initReviews(); initScrollUX();
  if (location.hash === '#buy') openSheet('link');
})();
