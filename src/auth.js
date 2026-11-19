// Admin login: password → signed, HTTP-only cookie (12 h). No extra dependencies.
import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'admin_session';
const TTL_MS = 12 * 60 * 60 * 1000;

const sign = (v) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('hex');

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }).filter(([k]) => k));
}

export function isAdmin(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || !config.sessionSecret) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return good.length === sig.length && crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig));
}

const attempts = new Map(); // ip -> { n, until }

export function login(req, res) {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const user = String(req.body?.username || '').trim().toLowerCase();
  const pw = String(req.body?.password || '');
  const ok = config.adminUsername && config.adminPassword && config.sessionSecret &&
    same(user, config.adminUsername.toLowerCase()) & same(pw, config.adminPassword);
  if (!ok) {
    a.n += 1; if (a.n >= 5) { a.until = Date.now() + 15 * 60 * 1000; a.n = 0; }
    attempts.set(ip, a);
    return res.status(401).json({ error: 'Wrong ID or password' });
  }
  attempts.delete(ip);
  const exp = String(Date.now() + TTL_MS);
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}${config.isProd ? '; Secure' : ''}`);
  res.json({ ok: true });
}

export function logout(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
}

export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  return res.redirect(`${config.adminPath}/login`);
}
