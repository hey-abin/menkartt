// Menkartt storefront: offer, checkout, payments, tracking, animations.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 24);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
let cfg; let bundle; let payMethod = 'prepaid'; let prepaidAvailable = true;
let cid = store.sget('cid') || rid(); store.sset('cid', cid);
let currentOrder = null;
const rupee = (n) => Number(n).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const priceFor = (b = bundle, m = payMethod) => (m === 'cod' ? b.cod : b.prepaid);
const bestPrice = (b) => (prepaidAvailable ? b.prepaid : b.cod);

function render() {
  const save = bundle.cod - bundle.prepaid;
  $$('[data-price-prepaid]').forEach((e) => (e.textContent = rupee(bestPrice(bundle))));
  $$('[data-price-cod]').forEach((e) => (e.textContent = rupee(bundle.cod)));
  $$('[data-save]').forEach((e) => (e.textContent = save));
  $$('[data-cta-price]').forEach((e) => (e.textContent = rupee(bestPrice(bundle))));
  $$('[data-sheet-prepaid]').forEach((e) => (e.textContent = rupee(bundle.prepaid)));
  $$('[data-sheet-cod]').forEach((e) => (e.textContent = rupee(bundle.cod)));
  $$('[data-sheet-save]').forEach((e) => (e.textContent = save));
  $$('.pack').forEach((p) => { const on = p.dataset.id === bundle.id; p.classList.toggle('on', on); p.setAttribute('aria-checked', on); });
  $$('.pay-opt').forEach((p) => p.classList.toggle('on', p.dataset.pay === payMethod));
  const total = priceFor();
  $('#sum-label').textContent = `${bundle.title} – ${cfg.productName}`;
  $('#sum-sub').textContent = rupee(bundle.cod);
  $('#sum-disc-row').hidden = payMethod !== 'prepaid';
  $('#sum-disc').textContent = save;
  $('#sum-total').textContent = rupee(total);
  $('#place-btn').textContent = payMethod === 'cod' ? `Place COD order · ₹${rupee(total)}` : `Pay ₹${rupee(total)} securely`;
  // hide strike-through prices when there is no online offer
  $$('.price-now s, .sb-price s').forEach((s) => (s.hidden = !prepaidAvailable));
}

function packHTML(b) {
  const p = bestPrice(b);
  const each = b.qty > 1 ? `<span class="p-each">₹${Math.round(p / b.qty)} each</span>` : '<span class="p-each">Free delivery</span>';
  return `<button type="button" class="pack" data-id="${b.id}" role="radio">
    ${b.tag ? `<span class="p-tag">${b.tag}</span>` : ''}
    <b>${b.title}</b><span class="p-sub">${b.subtitle}</span>
    <span class="p-price">₹${rupee(p)}${prepaidAvailable ? `<s>₹${rupee(b.cod)}</s>` : ''}</span>${each}</button>`;
}

function offerCardHTML(b, i) {
  const img = i === 0 ? '/media/belt-front.jpg' : '/media/belt-straps.jpg';
  return `<div class="o-card reveal ${b.tag ? 'best' : ''}">${b.tag ? `<span class="o-tag">${b.tag}</span>` : ''}
    <img src="${img}" alt="" loading="lazy" width="900" height="900">
    <div><h3>${b.title}</h3>
      <div class="o-price">₹${rupee(bestPrice(b))}${prepaidAvailable ? `<s>₹${rupee(b.cod)}</s>` : ''}</div>
      <p class="o-sub">${prepaidAvailable ? `With online payment · or ₹${rupee(b.cod)} Cash on Delivery` : 'Cash on Delivery · Free delivery'}</p>
      <button class="btn btn-buy shine" data-buy data-bundle="${b.id}">Get ${b.title}</button></div></div>`;
}

function fillBusiness() {
  const B = cfg.business;
  $$('[data-brand]').forEach((e) => (e.textContent = cfg.brand));
  $$('[data-brand-eyebrow]').forEach((e) => (e.textContent = cfg.brand));
  $$('[data-product-name]').forEach((e) => (e.textContent = cfg.productName));
  $$('[data-product-subtitle]').forEach((e) => (e.textContent = cfg.productSubtitle));
  $$('[data-repl]').forEach((e) => (e.textContent = cfg.replacementDays));
  if (B.whatsapp) {
    const wa = `https://wa.me/${B.whatsapp}?text=${encodeURIComponent(`Hi ${cfg.brand}, I have a question about the posture belt`)}`;
    $$('[data-wa-wrap]').forEach((e) => (e.hidden = false));
    $$('[data-whatsapp]').forEach((a) => { a.href = wa; a.target = '_blank'; a.rel = 'noopener'; a.addEventListener('click', () => track('whatsapp_click')); });
  }
  $$('[data-email]').forEach((a) => (a.href = `mailto:${B.email}`));
  $$('[data-email-text]').forEach((a) => (a.textContent = B.email));
  $$('[data-legal]').forEach((e) => (e.textContent = [`© ${new Date().getFullYear()} ${B.legalName || cfg.brand}`, B.address].filter(Boolean).join(' · ')));
  if (!cfg.codEnabled) { $('#cod-opt').hidden = true; $$('.cta-note').forEach((e) => (e.hidden = true)); }
  // Online payment not set up → only COD, priced at the regular price
  if (!cfg.razorpayKeyId && !cfg.paymentMock && cfg.codEnabled) {
    prepaidAvailable = false;
    $('.pay-opt[data-pay="prepaid"]').hidden = true;
    $('input[name="payMethod"][value="cod"]').checked = true; payMethod = 'cod';
    $$('.offer-chip').forEach((e) => (e.hidden = true));
    $('.price-label').textContent = 'Inclusive of all taxes · Cash on Delivery';
  }
}

// ---------- gallery ----------
function initGallery() {
  const slides = $('#slides'); const thumbs = $('#thumbs'); const items = $$('.g-slide', slides);
  thumbs.innerHTML = items.map((s, i) => `<button aria-label="Image ${i + 1}" data-i="${i}"><img src="${$('img', s).src}" alt="" loading="lazy"></button>`).join('');
  let idx = 0; let timer;
  const go = (i) => { idx = (i + items.length) % items.length; slides.scrollTo({ left: idx * slides.clientWidth, behavior: 'smooth' }); };
  const sync = () => {
    idx = Math.round(slides.scrollLeft / slides.clientWidth);
    items.forEach((s, j) => s.classList.toggle('active', j === idx));
    $$('button', thumbs).forEach((b, j) => b.classList.toggle('on', j === idx));
    // Scroll ONLY the thumbnail strip sideways. (scrollIntoView would also scroll the whole page back up to the gallery.)
    const t = $$('button', thumbs)[idx];
    if (t) thumbs.scrollTo({ left: t.offsetLeft - thumbs.clientWidth / 2 + t.offsetWidth / 2, behavior: 'smooth' });
  };
  // Autoplay only while the gallery is on screen
  let galleryVisible = true;
  new IntersectionObserver(([e]) => { galleryVisible = e.isIntersecting; }, { threshold: 0.3 }).observe(slides);
  const auto = () => { clearInterval(timer); if (!reduceMotion) timer = setInterval(() => { if (galleryVisible && !document.hidden) go(idx + 1); }, 4200); };
  slides.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  thumbs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { go(+b.dataset.i); auto(); } });
  $('.g-prev').addEventListener('click', () => { go(idx - 1); auto(); });
  $('.g-next').addEventListener('click', () => { go(idx + 1); auto(); });
  ['pointerdown', 'touchstart'].forEach((ev) => slides.addEventListener(ev, () => clearInterval(timer), { passive: true }));
  slides.addEventListener('touchend', auto, { passive: true });
  sync(); auto();
}

// ---------- video carousel ----------
function initVideos() {
  const car = $('#vcar'); const cards = $$('.v-card', car); const dots = $('#vdots');
  dots.innerHTML = cards.map((_, i) => `<button aria-label="Slide ${i + 1}" data-i="${i}"></button>`).join('');
  const syncDots = () => {
    const i = Math.round(car.scrollLeft / (cards[0].offsetWidth + 14));
    $$('button', dots).forEach((d, j) => d.classList.toggle('on', j === i));
  };
  car.addEventListener('scroll', () => requestAnimationFrame(syncDots), { passive: true });
  dots.addEventListener('click', (e) => { const i = e.target.dataset.i; if (i) car.scrollTo({ left: cards[i].offsetLeft - car.clientWidth / 2 + cards[i].offsetWidth / 2, behavior: 'smooth' }); });
  syncDots();
  cards.forEach((card) => {
    const v = $('video', card); if (!v) return;
    card.addEventListener('click', () => {
      if (v.paused) { $$('video', car).forEach((o) => { if (o !== v) { o.pause(); o.closest('.v-card').classList.remove('playing'); } }); v.play(); card.classList.add('playing'); track('video_play', { where: 'carousel' }); }
      else { v.pause(); card.classList.remove('playing'); }
    });
  });
  // autoplay muted videos while visible
  if (!reduceMotion) {
    const io = new IntersectionObserver((ents) => ents.forEach((e) => {
      const v = $('video', e.target); if (!v) return;
      if (e.isIntersecting && e.intersectionRatio > 0.6) { v.play().then(() => e.target.classList.add('playing')).catch(() => {}); }
      else { v.pause(); e.target.classList.remove('playing'); }
    }), { threshold: [0, 0.6, 1] });
    cards.forEach((c) => io.observe(c));
  }
}

// ---------- reviews ----------
const DIST = [['Excellent', 1556], ['Very good', 470], ['Good', 356], ['Average', 141], ['Poor', 264]];
// Copied unedited from the first page of the Meesho listing (22 Nov 2026). Do not trim, correct or drop critical reviews.
const REVIEWS = [
  { n: 'Meesho User', d: 'Mar 2026', t: 'Very good quality and strong material i appreciate it you can definitely buy it it\'s very good 👍🏻😊', h: 38 },
  { n: 'Asmi Pawar', d: 'Jul 2026', t: 'Very bad quality and very product please don\'t don\'t buy', h: 2 },
  { n: 'Meesho User', d: 'Aug 2026', t: 'I liked the product it\'s affordable and easy to use. I liked the quality as well better from other products to be honest.i hope you guys feel good after reading my review.', h: 31 },
  { n: 'Arif Husain Kasu', d: 'Aug 2026', t: 'Jaisa photo mein tha same vaisa hi aaya Hai.thank you meesho. Aap log bhi yah belt Le sakte ho I am so happy thank you thank you thank you', h: 9 },
  { n: 'Shivani Sandeep Kumar', d: 'Aug 2026', t: 'Material or quality BHT he achi h thank you messho', h: 1 },
  { n: 'Meesho User', d: 'Jun 2026', t: 'Ye bohat acha hai aur aap ise purchase kar sakte hain', h: 10 },
  { n: 'Falaknaaz Shaikh', d: 'Sep 2026', t: 'Nice thanks meesho guys u can buy it' },
  { n: 'Neeta Salim Shikah', d: 'Jul 2026', t: 'bahut hi Sundar Hai Achcha hai comfortable hai', h: 3 },
  { n: 'Kapil', d: 'Oct 2025', t: 'This product is best and value for money', h: 3 },
  { n: 'Divyansh Verma', d: 'Aug 2026', t: 'This is too good in quality, beyond my expectations. Worth it 👌 thnkyou meesho' },
  { n: 'Divya Dixit', d: 'Aug 2026', t: 'It\'s a very good and useful product.. Must buy. The material used is sturdy and nice. Value for money.', h: 1 },
  { n: 'Moin', d: 'Jul 2026', t: 'V good in condition and very good in comfortable' },
  { n: 'Ritu Jamod', d: 'Jun 2026', t: 'Very good and very comfortable product i really like it', h: 1 },
  { n: 'Rahil Shaikh Kakrata', d: 'Oct 2025', t: 'This product is very expensive and excellent quality.' },
  { n: 'Vivek kumar', d: 'Oct 2026', t: 'Good quality posture corrector belt at an affordable price. It is comfortable to wear, lightweight, and easy to adjust. Provides good back support and helps maintain proper posture while sitting, walking, or working. The material feels durable and offers good value for money. Overall, a useful product. Highly recommended!' },
];
const COLORS = ['#ff5a1f', '#ff2e63', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#14b8a6'];
const initials = (n) => (n === 'Meesho User' ? 'VB' : n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase());
const color = (n) => COLORS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const reviewHTML = (r, badge = 'Meesho review') => `<article class="review">
  <div class="r-top"><span class="avatar" style="background:${color(r.n)}">${esc(initials(r.n))}</span>
    <div><div class="r-name">${esc(r.n === 'Meesho User' ? 'Verified buyer' : r.n)}</div><div class="verified">${badge}</div></div></div>
  <span class="stars" style="--r:${r.r || 5}">★★★★★</span><p>${esc(r.t)}</p>
  <div class="r-meta">${esc(r.d)}${r.h ? ` · ${r.h} found this helpful` : ''}</div></article>`;

async function initReviews() {
  const total = DIST.reduce((s, [, c]) => s + c, 0);
  $('#bars').innerHTML = DIST.map(([l, c]) => `<div class="bar"><span>${l}</span><div class="bar-track"><div class="bar-fill" data-w="${(100 * c / total).toFixed(1)}"></div></div><span>${c}</span></div>`).join('');
  new IntersectionObserver(([e], o) => { if (e.isIntersecting) { $$('.bar-fill').forEach((b) => (b.style.width = b.dataset.w + '%')); o.disconnect(); } }, { threshold: .4 }).observe($('#bars'));
  const html = REVIEWS.map((r) => reviewHTML(r)).join('');
  $('#rtrack').innerHTML = html + html.replace(/<article class="review">/g, '<article class="review" aria-hidden="true">');
  const mq = $('#rmarquee');
  mq.addEventListener('touchstart', () => mq.classList.add('paused'), { passive: true });
  mq.addEventListener('touchend', () => setTimeout(() => mq.classList.remove('paused'), 2500), { passive: true });
  try {
    const ours = await (await fetch('/api/reviews')).json();
    if (ours.length) {
      $('#our-reviews').innerHTML = `<h3 class="our-title">From ${esc(cfg.brand)} customers</h3><div class="our-list">${ours.slice(0, 6).map((r) => reviewHTML({ n: `${r.name}${r.city ? ', ' + r.city : ''}`, d: new Date(r.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), t: r.text, r: r.rating }, 'Menkartt order')).join('')}</div>`;
    }
  } catch {}
}

// ---------- scroll effects ----------
function initScrollFX() {
  const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el, i) => { el.style.transitionDelay = `${Math.min(i % 6, 5) * 70}ms`; io.observe(el); });
  // count-up numbers
  $$('[data-count]').forEach((el) => {
    const end = +el.dataset.count;
    new IntersectionObserver(([e], o) => {
      if (!e.isIntersecting) return; o.disconnect();
      if (reduceMotion) return;
      const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / 1400); el.textContent = rupee(Math.round(end * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }).observe(el);
  });
  // header shadow + sticky buy bar (shown whenever the main Buy button is off-screen)
  const header = $('#header'); const sticky = $('#sticky'); const heroCta = $('#hero-cta');
  let heroCtaVisible = false;
  new IntersectionObserver(([e]) => { heroCtaVisible = e.isIntersecting; updateSticky(); }, { threshold: 0.3 }).observe(heroCta);
  function updateSticky() { sticky.classList.toggle('show', !heroCtaVisible && $('#sheet').hidden); }
  window.updateSticky = updateSticky;
  addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 10), { passive: true });
  new IntersectionObserver(([e]) => { if (e.isIntersecting) { track('view_content', {}, true); if (!sentOnce.has('pixel_vc')) { sentOnce.add('pixel_vc'); pixel('track', 'ViewContent', { value: bestPrice(bundle), currency: 'INR', content_type: 'product', content_ids: [bundle.id] }); } } }, { threshold: 0.5 }).observe($('#offer'));
  setTimeout(updateSticky, 300);
  // back-to-top button
  const toTop = $('#to-top');
  addEventListener('scroll', () => toTop.classList.toggle('show', scrollY > 700), { passive: true });
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
}

// ---------- checkout sheet ----------
const sheet = $('#sheet'); const backdrop = $('#sheet-backdrop'); const form = $('#checkout');
function showPanel(which) {
  form.hidden = which !== 'form'; $('#pay-retry').hidden = which !== 'retry'; $('#thanks').hidden = which !== 'thanks';
  $('#sheet-title').textContent = which === 'thanks' ? 'Thank you!' : which === 'retry' ? 'Almost done' : 'Complete your order';
}
function openSheet(src) {
  track('add_to_cart', { bundle: bundle.id, from: src });
  pixel('track', 'AddToCart', { value: bestPrice(bundle), currency: 'INR', content_name: cfg.productName, content_type: 'product', content_ids: [bundle.id] });
  if (!currentOrder || currentOrder.done) showPanel('form');
  sheet.hidden = false; backdrop.hidden = false; document.body.classList.add('lock'); window.updateSticky?.();
  setTimeout(() => { if (!form.hidden && !form.name.value && matchMedia('(min-width: 700px)').matches) form.name.focus({ preventScroll: true }); }, 300);
}
function closeSheet() { sheet.hidden = true; backdrop.hidden = true; document.body.classList.remove('lock'); window.updateSticky?.(); }
$('#sheet-close').addEventListener('click', closeSheet);
backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

function selectBundle(id) { bundle = cfg.bundles.find((b) => b.id === id) || cfg.bundles[0]; render(); }
document.addEventListener('click', (e) => {
  const p = e.target.closest('.pack'); if (p) { selectBundle(p.dataset.id); saveProgress(); }
  const b = e.target.closest('[data-buy]');
  if (b) {
    if (b.dataset.bundle) selectBundle(b.dataset.bundle);
    openSheet(b.closest('.sticky-bar') ? 'sticky' : b.closest('.header') ? 'header' : b.closest('.offer') ? 'offer' : 'hero');
  }
});
$$('input[name="payMethod"]').forEach((r) => r.addEventListener('change', () => { payMethod = r.value; render(); saveProgress(); }));

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
  if (payMethod === 'cod' && prepaidAvailable && !codNudged && bundle.cod > bundle.prepaid) return showCodNudge();
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

// ---------- COD → online nudge (once per checkout) ----------
let codNudged = false;
function showCodNudge() {
  codNudged = true;
  const save = rupee(bundle.cod - bundle.prepaid);
  ['#cn-save', '#cn-save2'].forEach((id) => ($(id).textContent = save));
  ['#cn-pre', '#cn-pre2'].forEach((id) => ($(id).textContent = rupee(bundle.prepaid)));
  ['#cn-cod', '#cn-cod2'].forEach((id) => ($(id).textContent = rupee(bundle.cod)));
  $('#cod-nudge').hidden = false;
  track('cod_nudge_shown', { bundleId: bundle.id });
  $('#cn-online').focus();
}
function closeCodNudge(toOnline) {
  $('#cod-nudge').hidden = true;
  if (toOnline) {
    track('cod_nudge_to_online', { bundleId: bundle.id });
    payMethod = 'prepaid';
    const r = $('input[name="payMethod"][value="prepaid"]'); if (r) r.checked = true;
    render(); saveProgress();
  }
  form.requestSubmit();
}
$('#cn-online').addEventListener('click', () => closeCodNudge(true));
$('#cn-keep').addEventListener('click', () => closeCodNudge(false));

// ---------- payment ----------
let rzpLoading;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  rzpLoading ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => { rzpLoading = null; rej(new Error('Could not load the payment window. Check your internet and try again.')); }; document.head.appendChild(s); });
  return rzpLoading;
}

async function openPayment() {
  const o = currentOrder;
  track('payment_initiated', { orderNo: o.orderNo, amount: o.amount });
  if (o.razorpay.mock) { $('#mockpay').hidden = false; return; }
  try { await loadRazorpay(); } catch (e) { return paymentNotDone(e.message); }
  const rzp = new window.Razorpay({
    key: o.razorpay.keyId, order_id: o.razorpay.orderId, amount: o.razorpay.amountPaise, currency: 'INR',
    name: cfg.brand, description: `${o.bundle.title} – ${cfg.productName}`, image: '/media/belt-back.jpg',
    prefill: { name: o.customer.name, contact: '+91' + o.customer.phone },
    notes: { orderNo: o.orderNo }, theme: { color: '#ff2e63' },
    handler: async (resp) => {
      try { await api('/api/payments/verify', { orderNo: o.orderNo, ...resp }); orderDone(); }
      catch { paymentNotDone(`We could not confirm the payment. If money was deducted it will be auto-confirmed shortly – email ${cfg.business.email} with your order number.`); }
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
  $('#t-box').innerHTML = `<div><span>${esc(o.bundle.title)} – ${esc(cfg.productName)}</span><b>₹${rupee(o.amount)}</b></div>
    <div><span>Payment</span><b>${cod ? 'Cash on Delivery' : 'Paid online ✓'}</b></div>
    <div><span>Deliver to</span><b>${esc(o.customer.name)}, ${esc(o.customer.city)} ${esc(o.customer.pincode)}</b></div>`;
  $('#t-next').innerHTML = (cod
    ? [`We may contact you to confirm – please keep <b>+91 ${esc(o.customer.phone)}</b> reachable.`, `Keep <b>₹${rupee(o.amount)}</b> ready when the parcel arrives.`]
    : ['Payment received.'])
    .concat(['Delivery time depends on your PIN code. Email us your order number for an update.', 'Tip: start with 20–30 minutes a day.']).map((t) => `<li>${t}</li>`).join('');
  $('#t-help').href = `mailto:${cfg.business.email}?subject=${encodeURIComponent(`Order ${o.orderNo}`)}`;
  showPanel('thanks');
  sheet.hidden = false; backdrop.hidden = false; document.body.classList.add('lock');
  sheet.scrollTop = 0;
}

// ---------- boot ----------
(async function boot() {
  track('page_view', { path: location.pathname });
  try { cfg = await (await fetch('/api/config')).json(); } catch { cfg = null; }
  if (!cfg) return;
  if (cfg.metaPixelId) loadPixel(cfg.metaPixelId);
  bundle = cfg.bundles[0];
  fillBusiness();
  $('#packs').innerHTML = cfg.bundles.map(packHTML).join('');
  $('#sheet-packs').innerHTML = cfg.bundles.map(packHTML).join('');
  $('#offer-cards').innerHTML = cfg.bundles.map(offerCardHTML).join('');
  render(); initGallery(); initVideos(); initReviews(); initScrollFX();
  if (location.hash === '#buy') openSheet('link');
})();
