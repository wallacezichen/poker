import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from './types/poker';
import { registerGameHandlers } from './socket/gameHandler';
import roomsRouter from './routes/rooms';

const PORT = parseInt(process.env.PORT || '4000');
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const hasSupabaseUrl = !!process.env.SUPABASE_URL;
const hasSupabaseServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const app = express();
const httpServer = createServer(app);

// CORS
app.use(cors({ origin: [CLIENT_URL, 'http://localhost:3000'], credentials: true }));
app.use(express.json());

// Health check
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// REST API
app.use('/api/rooms', roomsRouter);

// Socket.IO
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: [CLIENT_URL, 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);
  registerGameHandlers(io, socket);
});

httpServer.listen(PORT, HOST, () => {
  console.log(`\n🃏 Short Deck Poker Server`);
  console.log(`   Listening on ${HOST}:${PORT}`);
  console.log(`   PORT env: ${process.env.PORT ?? '(missing)'}`);
  console.log(`   Allowed origin: ${CLIENT_URL}`);
  console.log(`   SUPABASE_URL set: ${hasSupabaseUrl}`);
  console.log(`   SUPABASE_SERVICE_ROLE_KEY set: ${hasSupabaseServiceKey}`);
  console.log(`   Health: /health\n`);
});
