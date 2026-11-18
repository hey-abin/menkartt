const cfg = await (await fetch('/api/config')).json();
document.querySelectorAll('[data-brand]').forEach((e) => (e.textContent = cfg.brand));
const form = document.getElementById('rv');
const rate = document.getElementById('rate');
let rating = 5;
rate.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} stars">★</button>`).join('');
const draw = () => rate.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) <= rating));
rate.addEventListener('click', (e) => { if (e.target.dataset.n) { rating = Number(e.target.dataset.n); draw(); } });
draw();
const q = new URLSearchParams(location.search);
if (q.get('o')) form.orderNo.value = q.get('o');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err'); err.hidden = true;
  const body = { orderNo: form.orderNo.value.trim(), phone: form.phone.value.trim(), name: form.name.value.trim(), text: form.text.value.trim(), rating };
  const r = await fetch('/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { err.textContent = j.error || 'Could not submit. Try again.'; err.hidden = false; return; }
  form.hidden = true; document.getElementById('ok').hidden = false;
});
