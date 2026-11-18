# Seedha – one-product store (Posture Corrector Belt for Men)

A fast, mobile-first store for one product, with **Razorpay** online payments, **Cash on Delivery**, a **₹50 prepaid discount**, and a private **dashboard** for orders, ad clicks, the sales funnel, abandoned checkouts and reviews.

- Store: `/`
- Dashboard: `/admin` (password from `.env`)
- Policies (needed for Razorpay approval): `/policies`
- Customer review form: `/review`

---

## 1. Run it on your computer

```bash
cd store
npm install
cp .env.example .env      # then fill in the values (see below)
npm start
```

Open http://localhost:3000 (store) and http://localhost:3000/admin (dashboard).

Without Razorpay keys, online payment runs in **TEST MODE**: a "Simulate payment" window appears instead of Razorpay. Customers never see it once real keys are set. Without `MONGODB_URI`, data goes to a local test file.

## 2. Settings (`.env`)

| Setting | What it is |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `ADMIN_PASSWORD` | Your dashboard password |
| `SESSION_SECRET` | Long random text (`openssl rand -hex 32`) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay → Account & Settings → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you type when creating the webhook |
| `META_PIXEL_ID` | Meta Events Manager → your Pixel ID (for ad tracking) |
| `SUPPORT_EMAIL` | Customer support email (shown in the footer, thank-you screen and policies) |
| `BUSINESS_NAME`, `SUPPORT_PHONE`, `WHATSAPP_NUMBER`, `BUSINESS_ADDRESS` | Optional. Hidden on the site when empty (online-only dropshipping store). If Razorpay KYC asks for an address or phone on the website, add them here |
| `COD_ENABLED` | `true` / `false` |

Prices and packs are in `src/config.js` (`bundles`): 1 belt ₹399 online / ₹449 COD, 2 belts ₹699 / ₹749.

**Never upload or share `.env`.** It's already in `.gitignore`.

## 3. Go live (about 30 minutes)

1. **MongoDB Atlas** → *Network Access* → add `0.0.0.0/0` (lets your hosting server connect). Keep a strong DB password.
2. **Host it** on [Render](https://render.com) or [Railway](https://railway.app):
   - New *Web Service* from this GitHub repo
   - Build command: `npm install` · Start command: `npm start`
   - Add every `.env` value as an environment variable, with `NODE_ENV=production`
   - Render's free plan sleeps when idle, so the first visit takes ~30 seconds. For ads, use a paid plan (~$7/month) so the store is always instant.
3. **Domain**: buy one (₹100–800/year) and connect it in Render → *Custom domains*. Set `PUBLIC_URL` to it.
4. **Razorpay**: sign up → complete KYC with your website URL. They check the Contact, Shipping, Refund, Privacy and Terms pages, which are already at `/policies`. After activation:
   - Copy the **Live** API keys into the env vars
   - *Webhooks* → add `https://your-domain/api/razorpay/webhook`, events `payment.captured` and `payment.failed`, and set a secret (= `RAZORPAY_WEBHOOK_SECRET`)
5. **Clear test orders** once before launch: `npm run clear-test-data -- --yes`
6. Place one real ₹ order yourself with UPI to confirm payments work end to end.

## 4. Running Meta ads

Use this as the ad's website URL, so the dashboard knows which ad brought each visitor:

```
https://your-domain/?utm_source=facebook&utm_medium=paid&utm_campaign=posture_men_v1
```

Change `utm_campaign` for each ad set (e.g. `posture_office_v1`, `posture_gym_v1`). Meta also adds `fbclid` itself, which the store counts as an ad click. With `META_PIXEL_ID` set, the store sends **PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo and Purchase** to Meta, so you can optimise campaigns for purchases.

## 5. Daily routine

1. Open `/admin` → **Orders**.
2. **COD orders**: tap *WhatsApp: confirm* and wait for "YES" before buying from the supplier. This alone cuts fake/refused COD orders a lot.
3. Buy the belt on Meesho with the customer's name and address (https://www.meesho.com/s/p/9l6qc8).
4. Paste the courier + tracking number, set status **Shipped**, tap *WhatsApp: shipped*.
5. When delivered, set **Delivered**. For refused parcels, set **RTO**.
6. **Abandoned checkouts** tab: send the WhatsApp reminder to people who typed their number but didn't buy.
7. After delivery, send happy customers `your-domain/review?o=ORDERNO` and approve their review in **Reviews**.

### ⚠ Important: COD when dropshipping from Meesho
For **prepaid** orders it's simple: the customer pays you ₹399 and you buy from Meesho for ~₹216.
For **COD** orders, if you order on Meesho as COD, the customer pays **Meesho** at the door, not you. Before keeping COD on, check one of these:
- Meesho's reseller **"add margin"** option (if available in your Meesho app, Meesho collects the full amount and pays your margin to your bank), **or**
- keep a few belts in stock and ship COD orders yourself through a courier aggregator like Shiprocket (they collect the cash and remit it to you).

If neither works for you, set `COD_ENABLED=false` and the store becomes prepaid-only.

## 6. Why the page is built this way

- **Problem → solution → proof → offer**: the visitor first sees their own pain (desk slouch), then the fix, then proof (before/after, video, 2,749 ratings), then a simple offer.
- **One action**: only one thing to do on the page (Buy Now), with a sticky buy bar always within thumb reach.
- **Prepaid nudge**: online payment is pre-selected and shown as "Save ₹50 + priority dispatch". COD stays available, so nobody leaves for lack of it.
- **Risk reversal**: free delivery, COD, 7-day replacement and Razorpay security are shown next to every buy button.
- **Low friction checkout**: one bottom sheet, 6 fields, PIN code fills city and state, details remembered if the page reloads.
- **Sale rescue**: if a payment fails or is closed, the customer can retry or switch to COD in one tap.
- **Honesty that sells**: real rating breakdown (including the bad ratings), clear "start with 20–30 min a day" advice, and no fake timers or fake "X people viewing". India's dark-pattern guidelines (2023) ban fake urgency, and honest pages get fewer returns.

## 7. Notes on content

- Product photos come from the Meesho supplier listing. The two videos are from Pinterest creators and match this belt; ideally replace them with your own short video of the actual product.
- Reviews on the page are real Meesho reviews of this same belt, clearly labelled. Customer reviews from your own store appear automatically once you approve them.
- This is a posture support accessory, not a medical device. Keep ads free of medical claims ("cures", "fixes scoliosis"); Meta rejects those.

## Project structure

```
server.js              Express server: store, API, payments, dashboard API
src/config.js          Prices, packs, business details, settings
src/db.js              MongoDB (or local test file)
src/razorpay.js        Razorpay orders + signature checks
src/auth.js            Dashboard login
public/                Store pages, styles, scripts, media
admin/                 Dashboard pages (login protected)
scripts/               clear-test-data
```
