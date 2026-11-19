const f = document.getElementById('login');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.username.value, password: f.password.value }) });
  if (r.ok) return location.replace(location.pathname.replace(/\/login\/?$/, ''));
  const j = await r.json().catch(() => ({}));
  const err = document.getElementById('err'); err.textContent = j.error || 'Login failed'; err.hidden = false;
});
