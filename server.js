// server.js
import 'dotenv/config';
import express, { json } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
app.use(cors());
app.use(json());

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'whatsapp';
const PORT = process.env.PORT || 5000;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI missing in .env');
  process.exit(1);
}

// Socket.IO
const io = new Server(server, {
  cors: { origin: '*' } // lock down in production
});

// Mongo client & collection
const mongoClient = new MongoClient(MONGO_URI);

let col; // processed_messages collection

async function init() {
  try {
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    col = db.collection('processed_messages');

    // Ensure indexes
    await col.createIndex({ msg_id: 1 }, { unique: true, sparse: true });
    await col.createIndex({ wa_id: 1 });
    await col.createIndex({ meta_msg_id: 1 });

    console.log('✅ MongoDB connected and indexes ensured');

    // Start change stream to push real-time events
    const changeStream = col.watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', (change) => {
      // console.log('Change:', change);
      if (change.operationType === 'insert') {
        const doc = change.fullDocument;
        io.emit('new_message', { chatId: doc.wa_id, message: doc });
      } else if (change.operationType === 'update' || change.operationType === 'replace') {
        const doc = change.fullDocument;
        // emit a status update event when status changed
        io.emit('message_status', {
          chatId: doc.wa_id,
          msg_id: doc.msg_id || doc.meta_msg_id || doc._id,
          status: doc.status || null,
          full: doc
        });
      }
    });

    changeStream.on('error', (err) => {
      console.error('ChangeStream error:', err);
    });

  } catch (err) {
    console.error('Mongo init error:', err);
    process.exit(1);
  }
}
init();

// Helpers
function genLocalMsgId() {
  return `local-${Date.now()}-${Math.floor(Math.random()*1000)}`;
}

// REST endpoints

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: mongoClient?.topology?.description?.type || 'unknown' });
});

// Get chats aggregated by wa_id (latest per conversation)
app.get('/api/chats', async (req, res) => {
  try {
    const conv = await col.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$wa_id',
          wa_id: { $first: '$wa_id' },
          name: { $first: '$from' },
          lastMessage: { $first: '$text' },
          lastTimestamp: { $first: '$timestamp' },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$direction', 'inbound'] }, { $ne: ['$status', 'read'] }] },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { lastTimestamp: -1 } }
    ]).toArray();
    res.json(conv);
  } catch (err) {
    console.error('Error /api/chats:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages for wa_id and mark inbound as read
app.get('/api/messages/:wa_id', async (req, res) => {
  const wa_id = req.params.wa_id;
  try {
    const msgs = await col.find({ wa_id }).sort({ timestamp: 1, createdAt: 1 }).toArray();

    // Mark inbound as read (simulate behavior)
    const toUpdate = await col.updateMany(
      { wa_id, direction: 'inbound', status: { $ne: 'read' } },
      { $set: { status: 'read', updatedAt: new Date() } }
    );

    // If we updated, the change stream will emit the status events automatically
    res.json(msgs);
  } catch (err) {
    console.error('Error /api/messages/:wa_id', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send message: store outbound message (no external sending)
app.post('/api/send', async (req, res) => {
  const { wa_id, text } = req.body;
  if (!wa_id || !text) return res.status(400).json({ error: 'wa_id and text required' });
  try {
    const doc = {
      wa_id,
      from: process.env.BUSINESS_NUMBER || 'me',
      to: wa_id,
      msg_id: genLocalMsgId(),
      meta_msg_id: null,
      direction: 'outbound',
      text,
      status: 'sent',
      timestamp: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await col.insertOne(doc);
    res.status(201).json({ ...doc, _id: result.insertedId });
    // change stream will emit 'new_message'
  } catch (err) {
    console.error('Error /api/send', err);
    res.status(500).json({ error: 'Failed to send/save message' });
  }
});

// Update status (by msg_id or meta_msg_id)
app.post('/api/status', async (req, res) => {
  const { id, status } = req.body; // id can be msg_id or meta_msg_id
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  try {
    const query = { $or: [{ msg_id: id }, { meta_msg_id: id }] };
    const result = await col.updateOne(query, { $set: { status, updatedAt: new Date() } });
    if (result.matchedCount) {
      res.json({ success: true });
      // change stream will emit status update
    } else {
      res.status(404).json({ error: 'message not found' });
    }
  } catch (err) {
    console.error('Error /api/status', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Simple GET test route to inject a fake inbound message (for quick manual testing)
app.get('/api/test-message', async (req, res) => {
  const wa_id = req.query.wa_id || (process.env.BUSINESS_NUMBER || '919937320320');
  const text = req.query.text || 'Test inbound message';
  try {
    const doc = {
      wa_id,
      from: wa_id,
      to: process.env.BUSINESS_NUMBER || 'me',
      msg_id: genLocalMsgId(),
      meta_msg_id: null,
      direction: 'inbound',
      text,
      status: 'received',
      timestamp: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await col.insertOne(doc);
    res.json({ success: true, emitted: doc });
  } catch (err) {
    console.error('Error /api/test-message', err);
    res.status(500).json({ error: 'Failed to emit test message' });
  }
});
// Root route for quick test:
app.get('/', (req, res) => {
  res.send('Backend server is running!');
});

// 404 JSON
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
