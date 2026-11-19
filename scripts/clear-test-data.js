// Deletes ALL orders, visitors, events, checkouts, reviews and the order counter.
// Use once before launch to remove test orders:   npm run clear-test-data -- --yes
import { config } from '../src/config.js';
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

if (!process.argv.includes('--yes')) {
  console.log('This deletes ALL store data (orders, visitors, reviews…). Run again with --yes to confirm:');
  console.log('  npm run clear-test-data -- --yes');
  process.exit(0);
}
if (config.mongoUri) {
  const c = new MongoClient(config.mongoUri); await c.connect();
  const db = c.db(config.mongoDb);
  for (const name of ['visitors', 'events', 'checkouts', 'orders', 'reviews', 'counters']) {
    const r = await db.collection(name).deleteMany({});
    console.log(`${name}: deleted ${r.deletedCount}`);
  }
  await c.close();
} else {
  const f = path.resolve(import.meta.dirname, '..', 'data', 'local-db.json');
  if (fs.existsSync(f)) fs.rmSync(f);
  console.log('Local test data removed.');
}
console.log('Done – the next order will be MK1001.');
