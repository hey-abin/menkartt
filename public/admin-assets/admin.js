const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

let cfg = {};
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('login'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed');
  return r.json();
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 2200); }

// IST day boundaries
const IST = 330 * 60000;
function istMidnight(daysAgo = 0) { const n = new Date(Date.now() + IST); n.setUTCHours(0, 0, 0, 0); return new Date(n.getTime() - IST - daysAgo * 864e5); }
function rangeParams() {
  const v = $('#range').value; const now = new Date();
  if (v === 'today') return { from: istMidnight(0), to: now };
  if (v === 'yesterday') return { from: istMidnight(1), to: istMidnight(0) };
  if (v === 'all') return { from: new Date('2024-01-01'), to: now };
  return { from: istMidnight(Number(v) - 1), to: now };
}

// ---------- stats ----------
async function loadStats() {
  const { from, to } = rangeParams();
  const s = await api(`/api/admin/stats?from=${from.toISOString()}&to=${to.toISOString()}`);
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '–');
  const kpis = [
    { l: 'Revenue', v: inr(s.revenue), sub: `AOV ${inr(s.aov)}`, hi: true },
    { l: 'Orders', v: s.ordersCount, sub: `${s.prepaidCount} prepaid · ${s.codCount} COD` },
    { l: 'Prepaid share', v: pct(s.prepaidCount, s.ordersCount), sub: 'goal: 50%+' },
    { l: 'Conversion rate', v: s.conversionRate + '%', sub: 'orders ÷ visitors' },
    { l: 'Ad clicks', v: s.funnel.adClicks, sub: `${s.funnel.visitors} total visitors` },
    { l: 'Added to cart', v: s.funnel.addToCart, sub: pct(s.funnel.addToCart, s.funnel.visitors) + ' of visitors' },
    { l: 'Abandoned checkouts', v: s.abandonedCount, sub: 'gave phone, no order', warn: s.abandonedCount > 0 },
    { l: 'Payment not completed', v: s.awaitingPayment + s.failedPayments, sub: `${s.failedPayments} failed/closed`, warn: s.failedPayments > 0 },
    { l: 'Delivered', v: s.deliveredCount, sub: 'in this period' },
    { l: 'RTO (returned)', v: s.rtoCount, sub: pct(s.rtoCount, s.ordersCount) + ' of orders', warn: s.rtoCount > 0 },
  ];
  $('#kpis').innerHTML = kpis.map((k) => `<div class="kpi ${k.hi ? 'hi' : ''} ${k.warn ? 'warn' : ''}"><div class="k-label">${k.l}</div><div class="k-value">${k.v}</div><div class="k-sub">${k.sub}</div></div>`).join('');

  const f = s.funnel;
  const steps = [['Clicked an ad', f.adClicks], ['Visited store', f.visitors], ['Saw the offer', f.viewedOffer], ['Clicked Buy Now', f.addToCart],
    ['Entered phone', f.checkoutStarted], ['Opened payment', f.paymentInitiated], ['Placed order', f.orders]];
  const max = Math.max(1, ...steps.map((x) => x[1]));
  $('#funnel').innerHTML = steps.map(([l, n], i) => {
    // orders are compared with "Entered phone", because COD buyers skip the payment step
    const prevIdx = i === steps.length - 1 ? 4 : i - 1;
    const prev = i > 1 ? steps[prevIdx][1] : null;
    const note = i === steps.length - 1 ? 'of phone' : 'of prev';
    return `<div class="f-row"><span>${l}</span><div class="f-track"><div class="f-bar" style="width:${(100 * n / max).toFixed(1)}%">${n}</div></div>
      <span class="f-pct">${prev ? `<b>${pct(n, prev)}</b> ${note}` : ''}</span></div>`;
  }).join('');

  drawChart(s.daily);

  $('#sources').innerHTML = `<tr><th>Source</th><th class="num">Visitors</th><th class="num">Buy clicks</th><th class="num">Orders</th><th class="num">Revenue</th><th class="num">Conv.</th></tr>` +
    (s.sources.length ? s.sources.map((r) => `<tr><td>${r.source === 'meta-ad' ? '<span class="badge b-ad">Meta ad</span>' : esc(r.source)}</td><td class="num">${r.visitors}</td><td class="num">${r.addToCart}</td><td class="num">${r.orders}</td><td class="num">${inr(r.revenue)}</td><td class="num">${pct(r.orders, r.visitors)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No visits yet</td></tr>');
  $('#campaigns').innerHTML = `<tr><th>Campaign</th><th class="num">Orders</th><th class="num">Revenue</th></tr>` +
    (s.campaigns.length ? s.campaigns.map((c) => `<tr><td>${esc(c.campaign)}</td><td class="num">${c.orders}</td><td class="num">${inr(c.revenue)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="empty">Add <code>utm_campaign</code> to your ad links to see campaigns here</td></tr>');
}

function drawChart(daily) {
  const W = 600, H = 190, P = 26;
  const n = daily.length || 1;
  const maxV = Math.max(1, ...daily.map((d) => d.visitors));
  const maxO = Math.max(1, ...daily.map((d) => d.orders));
  const bw = (W - P * 2) / n;
  const bars = daily.map((d, i) => {
    const h = ((H - P * 2) * d.orders) / maxO;
    return `<rect x="${P + i * bw + bw * 0.2}" y="${H - P - h}" width="${bw * 0.6}" height="${h}" rx="3" fill="#ff6a1f"><title>${d.date}: ${d.orders} orders, ${inr(d.revenue)}</title></rect>`;
  }).join('');
  const pts = daily.map((d, i) => `${P + i * bw + bw / 2},${H - P - ((H - P * 2) * d.visitors) / maxV}`).join(' ');
  const step = Math.ceil(n / 7);
  const labels = daily.map((d, i) => (i % step === 0 ? `<text x="${P + i * bw + bw / 2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#667085">${d.date.slice(5)}</text>` : '')).join('');
  $('#chart').innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}<polyline points="${pts}" fill="none" stroke="#2563eb" stroke-width="2.5"/>${labels}</svg></div>
    <div class="legend"><span><i style="background:#ff6a1f"></i>Orders (max ${maxO})</span><span><i style="background:#2563eb"></i>Visitors (max ${maxV})</span></div>`;
}

// ---------- orders ----------
const STATUS = { pending_payment: 'Awaiting payment', new: 'New', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'RTO (returned)' };
function payBadge(o) {
  if (o.paymentStatus === 'paid') return '<span class="badge b-paid">PAID online</span>';
  if (o.paymentStatus === 'cod') return '<span class="badge b-cod">COD – to collect</span>';
  if (o.paymentStatus === 'cod_collected') return '<span class="badge b-paid">COD collected</span>';
  if (o.paymentStatus === 'failed') return '<span class="badge b-fail">Payment failed</span>';
  return '<span class="badge b-wait">Awaiting payment</span>';
}
function waLink(phone, text) { return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`; }

async function loadOrders() {
  const q = encodeURIComponent($('#q').value.trim()); const st = $('#status-filter').value;
  const list = await api(`/api/admin/orders?status=${st}&q=${q}`);
  $('#orders').innerHTML = list.length ? list.map((o) => {
    const c = o.customer;
    const confirmMsg = o.payMethod === 'cod'
      ? `Hi ${c.name.split(' ')[0]}, thank you for ordering the ${cfg.brand} posture belt (order ${o.orderNo}, ₹${o.amount} Cash on Delivery). Please reply YES to confirm and we will dispatch it today. Delivery address: ${c.address}, ${c.city} ${c.pincode}.`
      : `Hi ${c.name.split(' ')[0]}, thank you for your order ${o.orderNo} of the ${cfg.brand} posture belt. Payment received ✅ We'll share tracking details soon.`;
    const shipMsg = `Hi ${c.name.split(' ')[0]}, your ${cfg.brand} order ${o.orderNo} has been shipped${o.trackingId ? ` – tracking: ${o.trackingId}${o.courier ? ' (' + o.courier + ')' : ''}` : ''}. ${o.payMethod === 'cod' ? `Please keep ₹${o.amount} ready.` : ''}`;
    return `<div class="order" data-no="${esc(o.orderNo)}">
      <div class="o-top"><span><span class="o-no">${esc(o.orderNo)}</span> <span class="o-when">${when(o.createdAt)}</span></span><span class="o-amt">${inr(o.amount)}</span></div>
      <div class="o-mid"><b>${esc(c.name)}</b><a href="tel:+91${esc(c.phone)}">+91 ${esc(c.phone)}</a><span>${esc(c.city)}, ${esc(c.state)} ${esc(c.pincode)}</span>
        <span>${esc(o.bundleTitle)}</span>${payBadge(o)}${o.isAd ? '<span class="badge b-ad">from Meta ad</span>' : `<span class="badge">${esc(o.src || 'direct')}</span>`}${o.campaign ? `<span class="badge">${esc(o.campaign)}</span>` : ''}</div>
      <div class="o-actions">
        <select class="o-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input class="o-courier" placeholder="Courier" value="${esc(o.courier || '')}" style="width:110px">
        <input class="o-track" placeholder="Tracking / AWB no." value="${esc(o.trackingId || '')}">
        <button class="primary o-save">Save</button>
        <a class="ghost wa" target="_blank" rel="noopener" href="${waLink(c.phone, confirmMsg)}">WhatsApp: confirm</a>
        <a class="ghost" target="_blank" rel="noopener" href="${waLink(c.phone, shipMsg)}">WhatsApp: shipped</a>
      </div>
      <details class="o-more"><summary>Address &amp; history</summary>
        <div class="addr">${esc(c.name)}\n${esc(c.address)}${c.landmark ? '\nLandmark: ' + esc(c.landmark) : ''}\n${esc(c.city)}, ${esc(c.state)} – ${esc(c.pincode)}\nPhone: +91 ${esc(c.phone)}</div>
        ${o.razorpayPaymentId ? `<div class="o-when">Razorpay payment: ${esc(o.razorpayPaymentId)}</div>` : ''}
        <ul>${(o.history || []).map((h) => `<li>${when(h.ts)} – ${esc(h.msg)}</li>`).join('')}</ul>
      </details>
    </div>`;
  }).join('') : '<p class="empty">No orders yet. Once you run ads, orders appear here.</p>';
}

$('#orders').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('o-save')) return;
  const box = e.target.closest('.order');
  try {
    await api(`/api/admin/orders/${box.dataset.no}`, { method: 'PATCH', body: JSON.stringify({ status: $('.o-status', box).value, trackingId: $('.o-track', box).value, courier: $('.o-courier', box).value }) });
    toast('Saved ✓'); loadOrders(); loadStats();
  } catch (err) { toast(err.message); }
});

// ---------- abandoned ----------
async function loadAbandoned() {
  const list = await api('/api/admin/abandoned');
  const open = list.filter((c) => c.status !== 'contacted');
  $('#ab-count').textContent = open.length;
  $('#abandoned').innerHTML = list.length ? list.map((c) => {
    const first = (c.name || '').split(' ')[0] || 'there';
    const msg = `Hi ${first}! You were just one step away from your ${cfg.brand} posture belt 🙂 Pay online now for ₹${cfg.bundles?.[0]?.prepaid ?? ''} with free delivery, or choose Cash on Delivery. Complete your order here: ${location.origin}/#buy`;
    return `<div class="order" data-cid="${esc(c._id)}">
      <div class="o-top"><span><b>${esc(c.name || 'No name')}</b> <span class="o-when">${ago(c.updatedAt)}</span></span>${c.status === 'contacted' ? '<span class="badge b-paid">Contacted</span>' : '<span class="badge b-fail">Not contacted</span>'}</div>
      <div class="o-mid"><a href="tel:+91${esc(c.phone)}">+91 ${esc(c.phone)}</a><span>${esc(c.city || '')} ${esc(c.pincode || '')}</span><span>${esc(c.bundleId)} · ${c.payMethod === 'cod' ? 'chose COD' : 'chose prepaid'}</span>
        ${c.src === 'meta-ad' ? '<span class="badge b-ad">from Meta ad</span>' : `<span class="badge">${esc(c.src || 'direct')}</span>`}</div>
      <div class="o-actions"><a class="ghost wa ab-wa" target="_blank" rel="noopener" href="${waLink(c.phone, msg)}">WhatsApp reminder</a>
        <button class="ab-done">Mark contacted</button></div></div>`;
  }).join('') : '<p class="empty">No abandoned checkouts 🎉</p>';
}
$('#abandoned').addEventListener('click', async (e) => {
  const box = e.target.closest('.order'); if (!box) return;
  if (e.target.classList.contains('ab-done') || e.target.classList.contains('ab-wa')) {
    await api(`/api/admin/checkouts/${box.dataset.cid}`, { method: 'PATCH', body: JSON.stringify({ status: 'contacted' }) }).catch(() => {});
    setTimeout(loadAbandoned, 300);
  }
});

// ---------- reviews ----------
async function loadReviews() {
  const list = await api('/api/admin/reviews');
  $('#reviews').innerHTML = list.length ? list.map((r) => `<div class="order" data-rid="${esc(r._id)}">
    <div class="o-top"><span><b>${esc(r.name)}</b>, ${esc(r.city || '')} · ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} <span class="o-when">${when(r.createdAt)} · ${esc(r.orderNo)}</span></span>
      ${r.approved ? '<span class="badge b-paid">Shown on store</span>' : '<span class="badge">Hidden</span>'}</div>
    <div>${esc(r.text)}</div>
    <div class="o-actions"><button class="rv-toggle ${r.approved ? '' : 'primary'}" data-a="${r.approved ? '0' : '1'}">${r.approved ? 'Hide' : 'Approve & show'}</button></div></div>`).join('')
    : '<p class="empty">No customer reviews yet. Send happy customers the link: ' + esc(location.origin) + '/review</p>';
}
$('#reviews').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('rv-toggle')) return;
  const box = e.target.closest('.order');
  await api(`/api/admin/reviews/${box.dataset.rid}`, { method: 'PATCH', body: JSON.stringify({ approved: e.target.dataset.a === '1' }) });
  loadReviews();
});

// ---------- tabs / wiring ----------
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('on', x === t));
  $$('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${t.dataset.tab}`));
}));
let qTimer;
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(loadOrders, 300); });
$('#status-filter').addEventListener('change', loadOrders);
$('#range').addEventListener('change', loadStats);
$('#refresh').addEventListener('click', () => { refreshAll(); toast('Refreshed'); });
$('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.href = '/admin/login'; });

async function refreshAll() { await Promise.all([loadStats(), loadOrders(), loadAbandoned(), loadReviews()]).catch((e) => e.message !== 'login' && toast(e.message)); }
(async () => {
  cfg = await (await fetch('/api/config')).json();
  await refreshAll();
  setInterval(() => { if (!document.hidden) { loadStats(); loadAbandoned(); } }, 60000);
})();
