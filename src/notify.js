// New-order alert emails to the store owner ("Sir, you got 2 orders today!").
// Off until these env vars are set (never commit them – the repo is public):
//   ORDER_ALERT_TO  – where alerts go (owner's inbox)
//   SMTP_USER       – Gmail address that sends them (e.g. the store's support Gmail)
//   SMTP_PASS       – a Gmail App Password for SMTP_USER (not the normal Gmail password)
//   or ALERT_WEBHOOK_URL – Apps Script web app URL (see below); keep it secret, it can email the owner
import nodemailer from 'nodemailer';
import { config } from './config.js';

const env = (k) => (process.env[k] || '').trim();
let transport;

// Two ways to deliver: ALERT_WEBHOOK_URL (a Google Apps Script web app in the owner's Gmail that emails the
// owner – no password needed) or SMTP (ORDER_ALERT_TO + SMTP_USER + SMTP_PASS). The webhook wins if set.
const smtpReady = () => Boolean(env('ORDER_ALERT_TO') && env('SMTP_USER') && env('SMTP_PASS'));
export const alertsEnabled = () => Boolean(env('ALERT_WEBHOOK_URL') || smtpReady());

async function viaWebhook({ subject, text, html }) {
  const r = await fetch(env('ALERT_WEBHOOK_URL'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'follow',
    body: JSON.stringify({ subject, text, html }),
  });
  const body = await r.text();
  let j = {}; try { j = JSON.parse(body); } catch {}
  if (!r.ok || j.ok !== true) throw new Error(`webhook ${r.status}: ${(j.error || body).slice(0, 160)}`);
}

function mailer() {
  transport ??= env('SMTP_HOST')
    ? nodemailer.createTransport({ host: env('SMTP_HOST'), port: Number(env('SMTP_PORT') || 587), secure: env('SMTP_PORT') === '465', auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') } })
    : nodemailer.createTransport({ service: 'gmail', auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') } });
  return transport;
}

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// start of "today" in India (UTC+5:30), as a Date
export function istDayStart(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600e3);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600e3);
}

function build(order, { todayCount, totalCount, test }) {
  const cod = order.payMethod === 'cod';
  const c = order.customer || {};
  const n = todayCount;
  const subject = `${test ? '[TEST] ' : ''}Sir, you got ${n} order${n === 1 ? '' : 's'} today! ${order.orderNo} · ${rupee(order.amount)} ${cod ? 'COD' : 'PAID online'}`;
  const dash = `${config.publicUrl.replace(/\/$/, '')}${config.adminPath}`;
  const next = cod
    ? 'Cash on Delivery: call or WhatsApp the customer to confirm first, then place the Meesho order.'
    : 'Paid online: place the Meesho order now.';
  const rows = [
    ['Order', order.orderNo],
    ['Pack', `${order.bundleTitle || ''} (qty ${order.qty || 1})`],
    ['Amount', `${rupee(order.amount)} – ${cod ? 'Cash on Delivery (collect at door)' : 'Paid online ✓'}`],
    ['Name', c.name],
    ['Phone', c.phone ? `+91 ${c.phone}` : ''],
    ['Email', c.email],
    ['Address', [c.address, c.landmark, c.city, c.state, c.pincode].filter(Boolean).join(', ')],
    ['From', order.isAd ? `Ad (${order.src || 'meta'}${order.campaign ? ' · ' + order.campaign : ''})` : (order.src || 'direct')],
    ['Time', new Date(order.paidAt || order.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
  ].filter(([, v]) => v);
  const text = [
    `Sir, you got ${n} order${n === 1 ? '' : 's'} today! (${totalCount} in total)`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Next step: ${next}`,
    `Dashboard: ${dash}`,
    test ? '\nThis is a TEST alert from your dashboard – no real order was placed.' : '',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0e121e">
<div style="max-width:520px;margin:0 auto;padding:20px">
  <div style="background:linear-gradient(90deg,#ff5a1f,#ff2e63);color:#fff;border-radius:16px;padding:22px 20px">
    ${test ? '<div style="font-size:12px;font-weight:bold;letter-spacing:.1em;opacity:.9">TEST ALERT</div>' : ''}
    <div style="font-size:24px;font-weight:bold;margin-top:4px">Sir, you got ${n} order${n === 1 ? '' : 's'} today!</div>
    <div style="font-size:14px;opacity:.95;margin-top:6px">${totalCount} order${totalCount === 1 ? '' : 's'} in total · ${h(order.orderNo)} · ${rupee(order.amount)} ${cod ? 'COD' : 'paid online'}</div>
  </div>
  <table style="width:100%;background:#fff;border-radius:16px;margin-top:12px;padding:8px 14px;border-collapse:separate;font-size:14px">
    ${rows.map(([k, v]) => `<tr><td style="padding:7px 8px 7px 0;color:#64748b;white-space:nowrap;vertical-align:top">${h(k)}</td><td style="padding:7px 0;font-weight:bold">${h(v)}</td></tr>`).join('')}
  </table>
  <div style="background:#fff7e6;border:1px solid #ffd591;border-radius:12px;padding:12px 14px;margin-top:12px;font-size:14px"><b>Next step:</b> ${h(next)}</div>
  <a href="${h(dash)}" style="display:block;text-align:center;background:#0e121e;color:#fff;text-decoration:none;font-weight:bold;border-radius:12px;padding:14px;margin-top:12px">Open dashboard</a>
  ${test ? '<p style="font-size:12px;color:#64748b;text-align:center">This is a test from your dashboard. No real order was placed.</p>' : ''}
</div></body></html>`;
  return { subject, text, html };
}

// Never throws and never holds up the customer for more than ~6 s.
export async function sendOrderAlert(order, counts, { test = false } = {}) {
  if (!alertsEnabled()) return { sent: false, reason: 'not configured' };
  const { subject, text, html } = build(order, { ...counts, test });
  const send = env('ALERT_WEBHOOK_URL')
    ? viaWebhook({ subject, text, html })
    : mailer().sendMail({ from: `"Menkartt Orders" <${env('SMTP_USER')}>`, to: env('ORDER_ALERT_TO'), subject, text, html });
  try {
    await Promise.race([send, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
    return { sent: true };
  } catch (e) {
    console.error('order alert email failed:', e.message);
    return { sent: false, reason: e.message };
  }
}
