const $ = (s, el = document) => el.querySelector(s);
const LOGIN = '/' + location.pathname.split('/')[1] + '/login';
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

let cfg = {};
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (r.status === 401) { location.href = LOGIN; throw new Error('login'); }
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
    { l: 'Revenue (real money)', v: inr(s.revenue), sub: `${inr(s.revenueCod)} COD ordered on Meesho · ${inr(s.revenuePrepaid)} paid online`, hi: true },
    { l: 'COD not yet on Meesho', v: s.pendingCodCount, sub: `${inr(s.pendingCodAmount)} – not counted in revenue yet`, warn: s.pendingCodCount > 0 },
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

// ---------- orders: workflow sections + detail popup ----------
const STATUS = { pending_payment: 'Payment not completed', new: 'New', confirmed: 'Confirmed', meesho_ordered: 'Ordered on Meesho', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'Returned (RTO)' };
const SECTIONS = [
  { k: 'to_confirm', l: '1 · To confirm', hint: 'New COD orders. WhatsApp or call the customer. When they reply YES, open the order and press “Confirmed”. No reply in 24 h → Cancel.' },
  { k: 'meesho', l: '2 · Meesho', hint: '“Place on Meesho” = confirmed or paid: open it, copy the details into Meesho, paste the Meesho order ID and press “Ordered on Meesho”. “Ordered on Meesho ✓” = waiting for Meesho to ship; when it ships, add tracking and press “Shipped”.' },
  { k: 'shipped', l: '3 · Shipped', hint: 'On the way. Press “Delivered” when it arrives (COD cash is then marked collected).' },
  { k: 'delivered', l: '4 · Delivered', hint: 'Done. Ask happy customers for a review: ' },
  { k: 'unpaid', l: 'Payment not completed', hint: 'Started paying online but didn’t finish – not orders yet. Open one and send the customer their pay link.' },
  { k: 'abandoned', l: 'Abandoned checkouts', hint: 'Gave their phone number but didn’t place an order. A friendly WhatsApp brings many back.' },
  { k: 'closed', l: 'Cancelled / RTO', hint: 'Cancelled orders and parcels returned to the seller.' },
  { k: 'reviews', l: 'Reviews', hint: 'Reviews posted by customers. Approve to show them on the store.' },
  { k: 'all', l: 'All orders', hint: 'Every order, newest first.' },
];
let section = 'to_confirm'; let counts = {}; let listCache = []; let abCache = [];

function payBadge(o) {
  if (o.paymentStatus === 'paid') return '<span class="badge b-paid">PAID online</span>';
  if (o.paymentStatus === 'cod') return '<span class="badge b-cod">COD – to collect</span>';
  if (o.paymentStatus === 'cod_collected') return '<span class="badge b-paid">COD collected</span>';
  if (o.paymentStatus === 'failed') return '<span class="badge b-fail">Not paid – not an order yet</span>';
  return '<span class="badge b-wait">Not paid – not an order yet</span>';
}
function waLink(phone, text) { return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`; }
const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
const fullAddress = (c) => [c.address, c.area, c.landmark ? `Landmark: ${c.landmark}` : '', `${c.city}, ${c.state} – ${c.pincode}`].filter(Boolean).join(', ');

function messages(o) {
  const c = o.customer; const f = first(c.name); const cod = o.payMethod === 'cod'; const amt = Number(o.amount).toLocaleString('en-IN');
  const track = o.trackingId ? `\nट्रैकिंग / Tracking: ${o.trackingId}${o.courier ? ` (${o.courier})` : ''}` : '';
  return {
    confirm: cod
      ? `नमस्ते ${f} जी 🙏\nMenkartt से आपका ऑर्डर ${o.orderNo} मिला है:\nपोस्चर करेक्टर बेल्ट (${o.bundleTitle}) – ₹${amt} कैश ऑन डिलीवरी\nपता: ${fullAddress(c)}\n\nऑर्डर कन्फर्म करने के लिए *YES* लिखकर भेजें।\n\nHi ${f}, we received your Menkartt order ${o.orderNo} (₹${amt} Cash on Delivery). Please reply YES to confirm.`
      : `नमस्ते ${f} जी 🙏 आपका ₹${amt} का भुगतान मिल गया है। ऑर्डर ${o.orderNo} जल्द भेजा जाएगा।\n\nHi ${f}, payment received for order ${o.orderNo}. We'll message you when it ships.`,
    shipped: `नमस्ते ${f} जी, आपका Menkartt ऑर्डर ${o.orderNo} भेज दिया गया है 🚚${track}${cod ? `\nडिलीवरी पर ₹${amt} तैयार रखें।` : ''}\n\nHi ${f}, your order ${o.orderNo} has been shipped.${cod ? ` Please keep ₹${amt} ready.` : ''}`,
    placed: `नमस्ते ${f} जी 🙏 आपका Menkartt ऑर्डर ${o.orderNo} कन्फर्म हो गया है और पैक हो रहा है। भेजते ही ट्रैकिंग नंबर भेजेंगे।${cod ? `\nडिलीवरी पर ₹${amt} तैयार रखें।` : ''}\n\nHi ${f}, your Menkartt order ${o.orderNo} is confirmed and being packed. We'll send tracking as soon as it ships.${cod ? ` Please keep ₹${amt} ready.` : ''}`,
    review: `नमस्ते ${f} जी 🙏 Menkartt बेल्ट लेने के लिए धन्यवाद! उम्मीद है आपको पसंद आया। 1 मिनट में अपना रिव्यू लिखें:\n${location.origin}/review (ऑर्डर नं. ${o.orderNo})\n\nHi ${f}, thank you for buying from Menkartt! If you like the belt, please leave a quick review: ${location.origin}/review (order ${o.orderNo})`,
    closed: `नमस्ते ${f} जी, Menkartt से आपके ऑर्डर ${o.orderNo} के बारे में।\n\nHi ${f}, this is Menkartt about your order ${o.orderNo}.`,
    pay: `नमस्ते ${f} जी 🙏 Menkartt से। आपका ऑनलाइन भुगतान पूरा नहीं हुआ, कोई पैसा नहीं कटा।\nयहाँ से ₹${amt} भरकर ऑर्डर पूरा करें (पता पहले से सेव है):\n${location.origin}/pay/${o.orderNo}\nया ${location.origin}/store पर कैश ऑन डिलीवरी चुनें।\n\nHi ${f}, your payment didn't go through (no money taken). Finish your order here: ${location.origin}/pay/${o.orderNo} – or order again with Cash on Delivery at ${location.origin}/store`,
  };
}

function quickMsg(o) {
  const m = messages(o);
  if (['awaiting', 'failed'].includes(o.paymentStatus) || o.status === 'pending_payment') return [m.pay, 'Send pay link'];
  if (['cancelled', 'rto'].includes(o.status)) return [m.closed, 'Message'];
  if (o.status === 'delivered') return [m.review, 'Ask review'];
  if (o.status === 'shipped') return [m.shipped, 'Shipped msg'];
  if (o.status === 'meesho_ordered') return [m.placed, 'Order placed msg'];
  if (o.status === 'confirmed' || o.paymentStatus === 'paid') return [m.confirm, o.paymentStatus === 'paid' ? 'Payment msg' : 'Confirm again'];
  return [m.confirm, 'Confirm order'];
}
function abMsg(c) {
  const f = first(c.name);
  return `नमस्ते ${f} जी 🙏 आपने Menkartt पोस्चर करेक्टर बेल्ट का ऑर्डर शुरू किया था पर पूरा नहीं हुआ। कैश ऑन डिलीवरी (₹${cfg.bundles?.[0]?.cod ?? ''}) से ऑर्डर करें, घर पर पैसे दें:\n${location.origin}/store\n\nHi ${f}, you were one step away from your Menkartt posture belt. Order with Cash on Delivery here: ${location.origin}/store`;
}
const WA_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .3-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4.1.1.1.7-.1 1.3z"/></svg>';

function renderSections() {
  const ab = abCache.filter((c) => c.status !== 'contacted').length;
  $('#secs').innerHTML = SECTIONS.map((s) => {
    const n = s.k === 'abandoned' ? ab : s.k === 'reviews' ? '' : (counts[s.k] || 0);
    const urgent = ['to_confirm', 'abandoned', 'unpaid'].includes(s.k) && n > 0 || (s.k === 'meesho' && (counts.meesho_todo || 0) > 0);
    return `<button class="sec ${s.k === section ? 'on' : ''}" data-sec="${s.k}">${s.l}${n !== '' ? ` <span class="cnt ${urgent ? 'urgent' : ''}">${n}</span>` : ''}</button>`;
  }).join('');
  const s = SECTIONS.find((x) => x.k === section);
  $('#sec-hint').innerHTML = esc(s.hint) + (s.k === 'delivered' ? `<b>${esc(location.origin)}/review</b>` : '');
}

function orderRow(o) {
  const c = o.customer;
  const [msg, label] = quickMsg(o);
  return `<div class="row" role="button" tabindex="0" data-no="${esc(o.orderNo)}">
    <span class="r-main"><b>${esc(c.name)}</b><span class="r-phone">+91 ${esc(c.phone)}</span></span>
    <span class="r-meta">${esc(o.orderNo)} · ${when(o.createdAt)} · ${esc(c.city)}${o.meeshoOrderId ? ' · Meesho ' + esc(o.meeshoOrderId) : ''}</span>
    <span class="r-right"><b>${inr(o.amount)}</b>${payBadge(o)}${section === 'meesho' ? (o.status === 'meesho_ordered' ? '<span class="badge b-paid">Ordered on Meesho ✓</span>' : '<span class="badge b-todo">Place on Meesho</span>') : ''}</span>
    <a class="wa-mini" target="_blank" rel="noopener" href="${waLink(c.phone, msg)}" title="${esc(label)}">${WA_ICON}<span>${esc(label)}</span></a></div>`;
}
function abRow(c) {
  return `<div class="row" role="button" tabindex="0" data-cid="${esc(c._id)}">
    <span class="r-main"><b>${esc(c.name || 'No name')}</b><span class="r-phone">+91 ${esc(c.phone)}</span></span>
    <span class="r-meta">${ago(c.updatedAt)} · ${esc(c.city || '')} ${esc(c.pincode || '')} · chose ${c.payMethod === 'cod' ? 'COD' : 'online'}</span>
    <span class="r-right">${c.status === 'contacted' ? '<span class="badge b-paid">Contacted</span>' : '<span class="badge b-fail">Not contacted</span>'}</span>
    <a class="wa-mini" target="_blank" rel="noopener" data-contacted="${esc(c._id)}" href="${waLink(c.phone, abMsg(c))}">${WA_ICON}<span>Send reminder</span></a></div>`;
}

async function loadOrders() {
  renderSections();
  const q = $('#q').value.trim().toLowerCase();
  if (section === 'reviews') { $('#olist').innerHTML = await reviewsHTML(); return; }
  if (section === 'abandoned') {
    const list = abCache.filter((c) => !q || [c.name, c.phone, c.city, c.pincode].join(' ').toLowerCase().includes(q));
    $('#olist').innerHTML = list.length ? list.map(abRow).join('') : '<p class="empty">No abandoned checkouts 🎉</p>';
    return;
  }
  listCache = await api(`/api/admin/orders?section=${section}&q=${encodeURIComponent(q)}`);
  $('#olist').innerHTML = listCache.length ? listCache.map(orderRow).join('') : '<p class="empty">Nothing here right now.</p>';
}
async function loadCounts() { counts = await api('/api/admin/order-counts'); renderSections(); }
async function loadAbandoned() { abCache = await api('/api/admin/abandoned'); renderSections(); if (section === 'abandoned') loadOrders(); }

// ---------- detail popup ----------
const copyBtn = (v) => `<button class="cp" data-copy="${esc(v)}" ${v ? '' : 'disabled'}>Copy</button>`;
function field(label, v) { return `<div class="fld"><span class="f-l">${label}</span><span class="f-v">${esc(v || '—')}</span>${copyBtn(v || '')}</div>`; }

function openOrder(o) {
  const c = o.customer; const m = messages(o); const unpaid = ['awaiting', 'failed'].includes(o.paymentStatus);
  const steps = ['new', 'confirmed', 'meesho_ordered', 'shipped', 'delivered'];
  $('#mcard').innerHTML = `
    <div class="m-head"><div><div class="m-no">${esc(o.orderNo)} <span class="o-when">${when(o.createdAt)}</span></div>
      <div class="m-badges">${payBadge(o)} <span class="badge">${esc(STATUS[o.status] || o.status)}</span> ${o.isAd ? '<span class="badge b-ad">from Meta ad</span>' : `<span class="badge">${esc(o.src || 'direct')}</span>`}</div></div>
      <div class="m-amt">${inr(o.amount)}</div><button class="m-x" data-close aria-label="Close">×</button></div>

    ${unpaid ? `<div class="m-note">Not an order yet – the online payment wasn’t completed. Send the pay link below.</div>` : `
    <div class="m-sec"><div class="m-t">Status</div><div class="steps">
      ${steps.map((k) => `<button class="step ${o.status === k ? 'on' : ''}" data-status="${k}">${STATUS[k]}</button>`).join('')}
      <button class="step bad ${o.status === 'cancelled' ? 'on' : ''}" data-status="cancelled">Cancel</button>
      <button class="step bad ${o.status === 'rto' ? 'on' : ''}" data-status="rto">RTO</button></div></div>`}

    <div class="m-sec"><div class="m-t">Message the customer</div><div class="acts">
      ${unpaid
        ? `<a class="ghost wa" target="_blank" rel="noopener" href="${waLink(c.phone, m.pay)}">WhatsApp: pay link</a>${copyBtn(`${location.origin}/pay/${o.orderNo}`).replace('>Copy<', '>Copy pay link<')}`
        : `<a class="ghost wa" target="_blank" rel="noopener" href="${waLink(c.phone, quickMsg(o)[0])}">WhatsApp: ${esc(quickMsg(o)[1].toLowerCase())}</a>
           <a class="ghost" target="_blank" rel="noopener" href="${waLink(c.phone, m.confirm)}">Confirm msg</a>
           <a class="ghost" target="_blank" rel="noopener" href="${waLink(c.phone, m.placed)}">Placed msg</a>
           <a class="ghost" target="_blank" rel="noopener" href="${waLink(c.phone, m.shipped)}">Shipped msg</a>
           <a class="ghost" target="_blank" rel="noopener" href="${waLink(c.phone, m.review)}">Review request</a>`}
      <a class="ghost" href="tel:+91${esc(c.phone)}">Call</a></div></div>

    <div class="m-sec"><div class="m-t">Customer details for Meesho <button class="cp big" data-copy="${esc(`${c.name}\n${c.phone}\n${fullAddress(c)}`)}">Copy all</button></div>
      ${field('Name', c.name)}${field('Mobile', c.phone)}${field('PIN code', c.pincode)}
      ${field('House no. / Building', c.address)}${field('Road / Area / Colony', c.area)}${field('Landmark', c.landmark)}
      ${field('City', c.city)}${field('State', c.state)}
      <details class="edit"><summary>Edit details</summary><form id="edit-cust" class="edit-grid">
        ${[['name', 'Name'], ['phone', 'Mobile'], ['pincode', 'PIN code'], ['address', 'House no. / Building'], ['area', 'Road / Area / Colony'], ['landmark', 'Landmark'], ['city', 'City'], ['state', 'State']]
          .map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(c[k] || '')}"></label>`).join('')}
        <button class="primary" type="submit">Save details</button></form></details></div>

    <div class="m-sec"><div class="m-t">Product</div><div class="kv"><span>${esc(o.bundleTitle)} (qty ${o.qty || 1})</span><span>${o.payMethod === 'cod' ? `Collect ${inr(o.amount)} cash` : 'Paid online'}${o.campaign ? ' · ' + esc(o.campaign) : ''}</span></div></div>

    ${unpaid ? '' : `<div class="m-sec"><div class="m-t">Meesho & delivery</div><form id="ship" class="ship">
      <label>Meesho order ID<input name="meeshoOrderId" value="${esc(o.meeshoOrderId || '')}" placeholder="from Meesho"></label>
      <label>Courier<input name="courier" value="${esc(o.courier || '')}" placeholder="e.g. Delhivery"></label>
      <label>Tracking / AWB<input name="trackingId" value="${esc(o.trackingId || '')}"></label>
      <button class="primary" type="submit">Save</button></form></div>`}

    <div class="m-sec"><div class="m-t">Notes & history</div>
      <form id="note" class="note"><input name="note" placeholder="Add a note (e.g. customer said call after 6 pm)"><button type="submit">Add</button></form>
      <ul class="hist">${(o.history || []).slice().reverse().map((h) => `<li><span>${when(h.ts)}</span> ${esc(h.msg)}</li>`).join('')}</ul></div>`;
  $('#omodal').hidden = false; $('#omodal').dataset.no = o.orderNo; document.body.classList.add('lock');
}

function openAbandoned(c) {
  const f = first(c.name);
  const msg = abMsg(c);
  $('#mcard').innerHTML = `
    <div class="m-head"><div><div class="m-no">${esc(c.name || 'No name')} <span class="o-when">${ago(c.updatedAt)}</span></div>
      <div class="m-badges">${c.status === 'contacted' ? '<span class="badge b-paid">Contacted</span>' : '<span class="badge b-fail">Not contacted</span>'} ${c.src === 'meta-ad' ? '<span class="badge b-ad">from Meta ad</span>' : ''}</div></div>
      <button class="m-x" data-close aria-label="Close">×</button></div>
    <div class="m-sec"><div class="m-t">Message</div><div class="acts">
      <a class="ghost wa" target="_blank" rel="noopener" data-contacted="${esc(c._id)}" href="${waLink(c.phone, msg)}">WhatsApp reminder (हिंदी + English)</a>
      <a class="ghost" href="tel:+91${esc(c.phone)}">Call</a>
      <button data-contacted="${esc(c._id)}">Mark contacted</button></div></div>
    <div class="m-sec"><div class="m-t">What they entered</div>
      ${field('Name', c.name)}${field('Mobile', c.phone)}${field('PIN code', c.pincode)}${field('City', c.city)}
      <div class="kv"><span>Pack: ${esc(c.bundleId || '')}</span><span>Chose ${c.payMethod === 'cod' ? 'Cash on Delivery' : 'online payment'}</span></div></div>`;
  $('#omodal').hidden = false; delete $('#omodal').dataset.no; document.body.classList.add('lock');
}
function closeModal() { $('#omodal').hidden = true; document.body.classList.remove('lock'); }

async function patchOrder(no, body, msg = 'Saved ✓') {
  const o = await api(`/api/admin/orders/${no}`, { method: 'PATCH', body: JSON.stringify(body) });
  toast(msg); openOrder(o); loadCounts(); loadOrders(); loadStats();
}

$('#secs').addEventListener('click', (e) => { const b = e.target.closest('[data-sec]'); if (!b) return; section = b.dataset.sec; loadOrders(); });
$('#olist').addEventListener('click', (e) => {
  const wa = e.target.closest('.wa-mini');
  if (wa) {
    if (wa.dataset.contacted) api(`/api/admin/checkouts/${wa.dataset.contacted}`, { method: 'PATCH', body: JSON.stringify({ status: 'contacted' }) }).then(() => setTimeout(loadAbandoned, 300)).catch(() => {});
    return;
  }
  const r = e.target.closest('.row'); if (r) {
    if (r.dataset.no) openOrder(listCache.find((o) => o.orderNo === r.dataset.no));
    else if (r.dataset.cid) openAbandoned(abCache.find((c) => c._id === r.dataset.cid));
    return;
  }
  const rv = e.target.closest('.rv-toggle'); if (rv) toggleReview(rv);
});
$('#omodal').addEventListener('click', async (e) => {
  if (e.target.id === 'omodal' || e.target.closest('[data-close]')) return closeModal();
  const cp = e.target.closest('[data-copy]');
  if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied ✓'; setTimeout(() => (cp.textContent = cp.classList.contains('big') ? 'Copy all' : 'Copy'), 1200); } catch { prompt('Copy:', cp.dataset.copy); } return; }
  const st = e.target.closest('[data-status]');
  if (st) {
    const k = st.dataset.status; const no = $('#omodal').dataset.no;
    if (['cancelled', 'rto'].includes(k) && !confirm(k === 'rto' ? 'Mark this parcel as returned (RTO)?' : 'Cancel this order?')) return;
    try { await patchOrder(no, { status: k }, `Marked: ${STATUS[k]}`); } catch (err) { toast(err.message); }
    return;
  }
  const ct = e.target.closest('[data-contacted]');
  if (ct) { await api(`/api/admin/checkouts/${ct.dataset.contacted}`, { method: 'PATCH', body: JSON.stringify({ status: 'contacted' }) }).catch(() => {}); setTimeout(() => { loadAbandoned(); }, 300); if (ct.tagName === 'BUTTON') { toast('Marked contacted ✓'); closeModal(); } }
});
$('#omodal').addEventListener('submit', async (e) => {
  e.preventDefault(); const no = $('#omodal').dataset.no; const fd = Object.fromEntries(new FormData(e.target));
  try {
    if (e.target.id === 'ship') await patchOrder(no, fd);
    else if (e.target.id === 'note' && fd.note.trim()) await patchOrder(no, { note: fd.note.trim() }, 'Note added ✓');
    else if (e.target.id === 'edit-cust') await patchOrder(no, { customer: fd }, 'Details saved ✓');
  } catch (err) { toast(err.message); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#omodal').hidden) closeModal(); });
$('#olist').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('row')) e.target.click(); });

// ---------- reviews ----------
async function reviewsHTML() {
  const list = await api('/api/admin/reviews');
  return list.length ? list.map((r) => `<div class="order" data-rid="${esc(r._id)}">
    <div class="o-top"><span><b>${esc(r.name)}</b>, ${esc(r.city || '')} · ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} <span class="o-when">${when(r.createdAt)} · ${esc(r.orderNo)}</span></span>
      ${r.approved ? '<span class="badge b-paid">Shown on store</span>' : '<span class="badge">Hidden</span>'}</div>
    <div>${esc(r.text)}</div>
    <div class="o-actions"><button class="rv-toggle ${r.approved ? '' : 'primary'}" data-a="${r.approved ? '0' : '1'}">${r.approved ? 'Hide' : 'Approve & show'}</button></div></div>`).join('')
    : '<p class="empty">No customer reviews yet. Send happy customers the link: ' + esc(location.origin) + '/review</p>';
}
async function toggleReview(btn) {
  const box = btn.closest('.order');
  await api(`/api/admin/reviews/${box.dataset.rid}`, { method: 'PATCH', body: JSON.stringify({ approved: btn.dataset.a === '1' }) });
  loadOrders();
}

// ---------- wiring ----------
let qTimer;
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(loadOrders, 300); });
$('#range').addEventListener('change', loadStats);
$('#refresh').addEventListener('click', () => { refreshAll(); toast('Refreshed'); });
$('#test-alert').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true; const t = b.textContent; b.textContent = 'Sending…';
  try { await api('/api/admin/test-alert', { method: 'POST' }); toast('Test email sent ✓ – check your inbox'); }
  catch (err) { toast(err.message); }
  finally { b.disabled = false; b.textContent = t; }
});
$('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.href = LOGIN; });

// ---------- screens: Orders | Overview (remembered; #overview in the URL opens Overview) ----------
function showView(v) {
  $$('.vbtn').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#view-orders').hidden = v !== 'orders'; $('#view-overview').hidden = v !== 'overview';
  document.body.classList.toggle('v-orders', v === 'orders');
  try { localStorage.setItem('dash-view', v); } catch {}
  history.replaceState(null, '', v === 'overview' ? '#overview' : location.pathname);
  if (v === 'overview') loadStats().catch(() => {});
}
$$('.vbtn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
let startView = 'orders';
try { startView = location.hash === '#overview' ? 'overview' : (localStorage.getItem('dash-view') || 'orders'); } catch {}
showView(startView === 'overview' ? 'overview' : 'orders');

async function refreshAll() { await Promise.all([loadStats(), loadCounts(), loadAbandoned()]).then(loadOrders).catch((e) => e.message !== 'login' && toast(e.message)); }
(async () => {
  cfg = await (await fetch('/api/config')).json();
  await refreshAll();
  setInterval(() => { if (!document.hidden) { loadStats(); loadCounts(); loadAbandoned(); } }, 60000);
})();
