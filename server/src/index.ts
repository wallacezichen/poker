import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from './types/poker';
import { registerGameHandlers } from './socket/gameHandler';
import roomsRouter from './routes/rooms';

const PORT = parseInt(process.env.PORT || '4000');
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

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

httpServer.listen(PORT, () => {
  console.log(`\n🃏 Short Deck Poker Server`);
  console.log(`   Running on port ${PORT}`);
  console.log(`   Allowed origin: ${CLIENT_URL}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});
