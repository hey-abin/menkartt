// Pay link: /pay/MK1004 – lets a customer finish paying for an order whose online payment didn't complete.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const orderNo = (new URLSearchParams(location.search).get('o') || '').trim().toUpperCase();
const card = $('#card');
let cfg = {}; let info = null;

async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
  return j;
}

function loadPixel(id) {
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', id); window.fbq('track', 'PageView');
}

function done(already) {
  card.innerHTML = `<img src="/media/belt-flat.jpg" alt="Posture corrector belt" width="150" height="150">
    <h1 class="pay-ok">${already ? 'This order is already paid ✓' : 'Payment received ✓'}</h1>
    <p class="pay-line">Order <b>${esc(orderNo)}</b> is confirmed. We’ll message you when it ships.</p>
    <a class="btn btn-buy" href="/store">Back to the store</a>`;
  if (!already && info && window.fbq) {
    window.fbq('track', 'Purchase', { value: info.amount, currency: 'INR', content_type: 'product', num_items: info.qty || 1 }, { eventID: orderNo });
  }
}

function render(err) {
  card.innerHTML = `<img src="/media/belt-flat.jpg" alt="Posture corrector belt" width="150" height="150">
    <h1>Hi ${esc(info.firstName || 'there')}, complete your order</h1>
    <p class="pay-line">Menkartt Posture Corrector Belt · ${esc(info.bundleTitle || '')}</p>
    <p class="pay-line">Order <b>${esc(info.orderNo)}</b>${info.city ? ' · delivery to ' + esc(info.city) : ''}</p>
    <div class="pay-amt">₹${Number(info.amount).toLocaleString('en-IN')}</div>
    <p class="pay-line">Free delivery · UPI, cards, net banking</p>
    <button class="btn btn-buy btn-xl" id="pay" type="button">Pay ₹${Number(info.amount).toLocaleString('en-IN')} securely</button>
    ${err ? `<p class="pay-err">${esc(err)}</p>` : ''}
    <div class="pay-trust"><span>Secured by Razorpay</span><span>7-day replacement</span></div>
    <p class="tiny muted" style="margin-top:10px">Paying by UPI? Approve the request in your UPI app within a few minutes.</p>`;
  $('#pay').addEventListener('click', start);
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the payment window. Check your internet and try again.')); document.head.appendChild(s); });
}

async function start() {
  const btn = $('#pay'); btn.disabled = true; btn.textContent = 'Opening payment…';
  try {
    const r = await api(`/api/pay/${encodeURIComponent(orderNo)}/start`, {});
    if (r.paid) return done(true);
    if (r.razorpay.mock) {
      $('#mock').hidden = false;
      $('#mock-ok').onclick = async () => { $('#mock').hidden = true; try { await api('/api/payments/mock-success', { orderNo }); done(false); } catch (e) { render(e.message); } };
      return;
    }
    await loadRazorpay();
    const rzp = new window.Razorpay({
      key: r.razorpay.keyId, order_id: r.razorpay.orderId, amount: r.razorpay.amountPaise, currency: 'INR',
      name: cfg.brand || 'Menkartt', description: `Order ${orderNo} – Posture Corrector Belt`, image: '/media/belt-back.jpg',
      notes: { orderNo }, theme: { color: '#ff2e63' },
      handler: async (resp) => {
        try { await api('/api/payments/verify', { orderNo, ...resp }); done(false); }
        catch { render('We could not confirm the payment yet. If money was deducted, it will be confirmed automatically – or email us with your order number.'); }
      },
      modal: { ondismiss: () => render('Payment not completed. You can try again – no money was taken.') },
    });
    rzp.open();
    btn.disabled = false; btn.textContent = `Pay ₹${Number(info.amount).toLocaleString('en-IN')} securely`;
  } catch (e) { render(e.message); }
}

(async () => {
  try {
    if (!/^MK\d+$/.test(orderNo)) throw new Error('This link is incomplete. Please use the link we sent you, or contact us.');
    cfg = await api('/api/config').catch(() => ({}));
    if (cfg.metaPixelId) loadPixel(cfg.metaPixelId);
    info = await api(`/api/pay/${encodeURIComponent(orderNo)}`);
    if (info.paid) return done(true);
    render();
  } catch (e) {
    card.innerHTML = `<h1>Can’t open this payment link</h1><p class="pay-line">${esc(e.message)}</p><a class="btn btn-buy" href="/store">Go to the store</a>`;
  }
})();
