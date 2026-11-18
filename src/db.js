// Storage: MongoDB when MONGODB_URI is set, otherwise a local JSON file (only for trying the store out).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const COLLECTIONS = ['visitors', 'events', 'checkouts', 'orders', 'reviews', 'counters'];

let impl;

// ---------- simple filter matcher used by the local fallback ----------
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), doc);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, x]) => {
        const vv = v instanceof Date ? v.getTime() : v;
        const xx = x instanceof Date ? x.getTime() : x;
        if (op === '$gte') return vv >= xx;
        if (op === '$lte') return vv <= xx;
        if (op === '$lt') return vv < xx;
        if (op === '$gt') return vv > xx;
        if (op === '$in') return x.includes(v);
        if (op === '$ne') return v !== x;
        if (op === '$exists') return (v !== undefined) === x;
        return false;
      });
    }
    return v === cond;
  });
}

function revive(_k, v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) ? new Date(v) : v;
}

class LocalStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'), revive) : {};
    for (const c of COLLECTIONS) this.data[c] ??= [];
    this.timer = null;
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    }, 150);
  }
  async insertOne(c, doc) { this.data[c].push(structuredClone(doc)); this.save(); return doc; }
  async findOne(c, f) { const d = this.data[c].find((x) => matches(x, f)); return d ? structuredClone(d) : null; }
  async find(c, f = {}, { sort, limit, skip = 0 } = {}) {
    let r = this.data[c].filter((x) => matches(x, f));
    if (sort) {
      const [[k, dir]] = Object.entries(sort);
      r.sort((a, b) => ((a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir));
    }
    r = r.slice(skip, limit ? skip + limit : undefined);
    return structuredClone(r);
  }
  async updateOne(c, f, set, { upsert = false } = {}) {
    let d = this.data[c].find((x) => matches(x, f));
    if (!d && upsert) { d = { ...f }; this.data[c].push(d); }
    if (d) { Object.assign(d, structuredClone(set)); this.save(); }
    return d ? structuredClone(d) : null;
  }
  async countDocuments(c, f = {}) { return this.data[c].filter((x) => matches(x, f)).length; }
  async nextSeq(name) {
    let d = this.data.counters.find((x) => x._id === name);
    if (!d) { d = { _id: name, seq: 1000 }; this.data.counters.push(d); }
    d.seq += 1; this.save(); return d.seq;
  }
}

class MongoStore {
  async connect() {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(config.mongoUri, { maxPoolSize: 10 });
    await this.client.connect();
    this.db = this.client.db(config.mongoDb);
    await Promise.all([
      this.db.collection('visitors').createIndex({ vid: 1 }, { unique: true }),
      this.db.collection('visitors').createIndex({ firstSeen: -1 }),
      this.db.collection('events').createIndex({ ts: -1 }),
      this.db.collection('events').createIndex({ type: 1, ts: -1 }),
      this.db.collection('checkouts').createIndex({ updatedAt: -1 }),
      this.db.collection('orders').createIndex({ createdAt: -1 }),
      this.db.collection('orders').createIndex({ razorpayOrderId: 1 }),
      this.db.collection('reviews').createIndex({ createdAt: -1 }),
    ]);
  }
  col(c) { return this.db.collection(c); }
  async insertOne(c, doc) { await this.col(c).insertOne(doc); return doc; }
  async findOne(c, f) { return this.col(c).findOne(f); }
  async find(c, f = {}, { sort, limit, skip = 0 } = {}) {
    let q = this.col(c).find(f);
    if (sort) q = q.sort(sort);
    if (skip) q = q.skip(skip);
    if (limit) q = q.limit(limit);
    return q.toArray();
  }
  async updateOne(c, f, set, { upsert = false } = {}) {
    return this.col(c).findOneAndUpdate(f, { $set: set }, { upsert, returnDocument: 'after' });
  }
  async countDocuments(c, f = {}) { return this.col(c).countDocuments(f); }
  async nextSeq(name) {
    const r = await this.col('counters').findOneAndUpdate(
      { _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    return 1000 + r.seq;
  }
}

export async function initDb() {
  if (config.mongoUri) {
    const m = new MongoStore();
    await m.connect();
    impl = m;
    console.log(`✓ Connected to MongoDB (database: ${config.mongoDb})`);
  } else {
    if (config.isProd) throw new Error('MONGODB_URI is required in production');
    impl = new LocalStore(path.resolve(import.meta.dirname, '..', 'data', 'local-db.json'));
    console.log('⚠ No MONGODB_URI set – using local file data/local-db.json (testing only)');
  }
}

export const db = new Proxy({}, { get: (_t, k) => (...a) => impl[k](...a) });
