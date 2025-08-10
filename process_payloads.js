// scripts/process_payloads.js
import 'dotenv/config';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'whatsapp';
const COLLECTION = 'processed_messages';
const PAYLOAD_DIR = join(process.cwd(), 'sample_payloads');

if (!MONGO_URI) {
  console.error('MONGO_URI missing in .env');
  process.exit(1);
}

async function run() {
  const client = new MongoClient(MONGO_URI); // removed deprecated options
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  // Ensure indexes (safe - idempotent)
  await col.createIndex({ msg_id: 1 }, { unique: true, sparse: true });
  await col.createIndex({ wa_id: 1 });
  await col.createIndex({ meta_msg_id: 1 });

  if (!existsSync(PAYLOAD_DIR)) {
    console.error('sample_payloads folder not found at', PAYLOAD_DIR);
    process.exit(1);
  }

  const files = readdirSync(PAYLOAD_DIR).filter(f => f.endsWith('.json') || f.endsWith('.txt'));
  if (!files.length) {
    console.log('No payload files found in', PAYLOAD_DIR);
    await client.close();
    return;
  }

  for (const file of files) {
    console.log('Processing file:', file);
    const raw = readFileSync(join(PAYLOAD_DIR, file), 'utf8').trim();

    let payloads;
    try {
      payloads = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse JSON in', file, e);
      continue;
    }

    if (!Array.isArray(payloads)) {
      console.error('Expected JSON array in', file);
      continue;
    }

    for (const payload of payloads) {
      const entries = payload.metaData?.entry || (payload.entry ? payload.entry : null);

      if (Array.isArray(entries)) {
        for (const entry of entries) {
          for (const change of entry.changes || []) {
            const value = change.value || {};

            // Process messages array
            if (Array.isArray(value.messages)) {
              for (const m of value.messages) {
                const doc = {
                  wa_id: m.from,
                  from: value.contacts?.[0]?.profile?.name || m.from,
                  to: value.metadata?.phone_number_id || '',
                  msg_id: m.id,
                  meta_msg_id: m.context?.id || null,
                  direction: m.from === (value.metadata?.phone_number_id || '') ? 'outbound' : 'inbound',
                  text: m.text?.body || (m.body || '') ,
                  status: 'received',
                  timestamp: new Date(parseInt(m.timestamp) * 1000),
                  createdAt: new Date()
                };
                await col.updateOne(
                  { msg_id: doc.msg_id },
                  { $setOnInsert: doc, $set: { updatedAt: new Date() } },
                  { upsert: true }
                );
                console.log('Upserted message:', doc.msg_id);
              }
            }

            // Process statuses array
            if (Array.isArray(value.statuses)) {
              for (const s of value.statuses) {
                const id = s.id || s.meta_msg_id;
                const status = s.status;
                const query = { $or: [{ msg_id: id }, { meta_msg_id: id }] };
                const update = { $set: { status, updatedAt: new Date() } };
                const r = await col.updateOne(query, update);
                console.log('Status update:', id, '->', status, 'modified:', r.modifiedCount);
              }
            }
          }
        }
      } else {
        // fallback: payload may contain messages/statuses at top-level
        if (Array.isArray(payload.messages)) {
          for (const m of payload.messages) {
            const doc = {
              wa_id: m.from,
              from: m.from,
              to: m.to || '',
              msg_id: m.id,
              meta_msg_id: m.context?.id || null,
              direction: m.from === (process.env.BUSINESS_NUMBER || '') ? 'outbound' : 'inbound',
              text: m.text?.body || '',
              status: 'received',
              timestamp: new Date(parseInt(m.timestamp) * 1000),
              createdAt: new Date()
            };
            await col.updateOne(
              { msg_id: doc.msg_id },
              { $setOnInsert: doc, $set: { updatedAt: new Date() } },
              { upsert: true }
            );
            console.log('Upserted message (fallback):', doc.msg_id);
          }
        }
        if (Array.isArray(payload.statuses)) {
          for (const s of payload.statuses) {
            const id = s.id || s.meta_msg_id;
            const status = s.status;
            const query = { $or: [{ msg_id: id }, { meta_msg_id: id }] };
            const update = { $set: { status, updatedAt: new Date() } };
            const r = await col.updateOne(query, update);
            console.log('Status update (fallback):', id, '->', status, 'modified:', r.modifiedCount);
          }
        }
      }
    }
  }

  await client.close();
  console.log('Payload processing done');
}

run().catch(err => {
  console.error('Processor error:', err);
  process.exit(1);
});
