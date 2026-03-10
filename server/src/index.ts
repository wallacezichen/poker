import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import fs from 'fs';
import { ClientToServerEvents, ServerToClientEvents } from './types/poker';
import { registerGameHandlers } from './socket/gameHandler';
import roomsRouter from './routes/rooms';

const PORT = parseInt(process.env.PORT || '4000');
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const hasSupabaseUrl = !!process.env.SUPABASE_URL;
const hasSupabaseServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOOT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const PROC_DEBUG = process.env.PROC_DEBUG === '1' || process.env.PROC_DEBUG === 'true';

function safeReadFile(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

function getCgroupMemoryLimitBytes(): number | null {
  // cgroup v2
  const v2 = safeReadFile('/sys/fs/cgroup/memory.max');
  if (v2 && v2 !== 'max') {
    const n = Number(v2);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // cgroup v1
  const v1 = safeReadFile('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if (v1) {
    const n = Number(v1);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function logProcLine(line: string) {
  // stderr tends to be less buffered on many platforms; still not guaranteed under SIGKILL.
  try { process.stderr.write(line + '\n'); } catch { /* ignore */ }
}

const app = express();
const httpServer = createServer(app);

// CORS
app.use(cors({ origin: [CLIENT_URL, 'http://localhost:3000'], credentials: true }));
app.use(express.json());

// Health check
app.get('/', (_, res) => res.status(200).send('ok'));
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// REST API
app.use('/api/rooms', roomsRouter);

// Express error boundary (avoid crashing on thrown middleware errors).
app.use((err: any, _req: any, _res: any, _next: any) => {
  logProcLine(`[HTTP] unhandled_error boot=${BOOT_ID} pid=${process.pid} ts=${new Date().toISOString()} err=${err?.message || String(err)}`);
  if (err?.stack) logProcLine(String(err.stack));
});

// Socket.IO
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: [CLIENT_URL, 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

const HEARTBEAT_MS = Math.max(1_000, Math.floor(Number(process.env.PROC_HEARTBEAT_MS || 60_000)));
const heartbeatTimer = setInterval(() => {
  const mu = process.memoryUsage();
  const uptimeSec = Math.floor(process.uptime());
  console.log(
    `[PROC] heartbeat ts=${new Date().toISOString()} boot=${BOOT_ID} pid=${process.pid} uptimeSec=${uptimeSec} rssMB=${fmtMb(mu.rss)} heapUsedMB=${fmtMb(mu.heapUsed)} heapTotalMB=${fmtMb(mu.heapTotal)} externalMB=${fmtMb(mu.external)}`
  );
}, HEARTBEAT_MS);
heartbeatTimer.unref();

// Event loop lag monitor (useful when the process stalls under CPU pressure).
let lastTick = Date.now();
const lagTimer = setInterval(() => {
  const now = Date.now();
  const lagMs = Math.max(0, now - lastTick - 1000);
  lastTick = now;
  if (lagMs >= 1500) {
    logProcLine(`[PROC] event_loop_lag boot=${BOOT_ID} pid=${process.pid} ts=${new Date().toISOString()} lagMs=${lagMs}`);
  }
}, 1000);
lagTimer.unref();

let shuttingDown = false;
function shutdown(reason: string, err?: unknown) {
  if (shuttingDown) return;
  shuttingDown = true;
  const ts = new Date().toISOString();
  logProcLine(`[PROC] shutdown boot=${BOOT_ID} pid=${process.pid} reason=${reason} at=${ts} uptimeSec=${Math.floor(process.uptime())}`);
  if (err) {
    try {
      const e: any = err;
      logProcLine(`[PROC] shutdown_err boot=${BOOT_ID} pid=${process.pid} name=${e?.name || ''} msg=${e?.message || String(err)}`);
      if (e?.stack) logProcLine(String(e.stack));
    } catch {
      logProcLine(`[PROC] shutdown_err boot=${BOOT_ID} pid=${process.pid} ${String(err)}`);
    }
  }

  clearInterval(heartbeatTimer);
  clearInterval(lagTimer);

  try {
    io.close();
  } catch (e) {
    logProcLine(`[PROC] io.close failed boot=${BOOT_ID} pid=${process.pid} err=${String(e)}`);
  }

  const killTimer = setTimeout(() => {
    logProcLine(`[PROC] forced_exit boot=${BOOT_ID} pid=${process.pid} reason=${reason} at=${new Date().toISOString()}`);
    process.exit(1);
  }, 3_000);
  killTimer.unref();

  if (PROC_DEBUG) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handles = (process as any)._getActiveHandles?.() as any[] | undefined;
      const requests = (process as any)._getActiveRequests?.() as any[] | undefined;
      const hCount = handles?.length ?? -1;
      const rCount = requests?.length ?? -1;
      logProcLine(`[PROC] active boot=${BOOT_ID} pid=${process.pid} handles=${hCount} requests=${rCount}`);
      if (handles && handles.length > 0) {
        const names = handles.map((h) => h?.constructor?.name || typeof h).slice(0, 20);
        logProcLine(`[PROC] active_handles boot=${BOOT_ID} pid=${process.pid} sample=${names.join(',')}`);
      }
    } catch (e) {
      logProcLine(`[PROC] active_dump_failed boot=${BOOT_ID} pid=${process.pid} err=${String(e)}`);
    }
  }

  httpServer.close(() => {
    logProcLine(`[PROC] http_closed boot=${BOOT_ID} pid=${process.pid} reason=${reason} at=${new Date().toISOString()}`);
    process.exit(0);
  });
}

// Process-level diagnostics + predictable shutdown.
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => shutdown('uncaughtException', err));
process.on('uncaughtExceptionMonitor', (err) => {
  logProcLine(`[PROC] uncaughtExceptionMonitor boot=${BOOT_ID} pid=${process.pid} ts=${new Date().toISOString()} msg=${err?.message || String(err)}`);
  if ((err as any)?.stack) logProcLine(String((err as any).stack));
});
process.on('unhandledRejection', (reason) => shutdown('unhandledRejection', reason));
process.on('rejectionHandled', (promise) => {
  if (!PROC_DEBUG) return;
  logProcLine(`[PROC] rejectionHandled boot=${BOOT_ID} pid=${process.pid} ts=${new Date().toISOString()} promise=${String(promise)}`);
});
process.on('warning', (warning) => {
  logProcLine(`[PROC] warning boot=${BOOT_ID} pid=${process.pid} ts=${new Date().toISOString()} name=${warning.name} msg=${warning.message}`);
  if (warning.stack) logProcLine(String(warning.stack));
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
process.on('multipleResolves' as any, (type: any, promise: any, reason: any) => {
  logProcLine(`[PROC] multipleResolves boot=${BOOT_ID} pid=${process.pid} ts=${new Date().toISOString()} type=${String(type)} reason=${String(reason)} promise=${String(promise)}`);
});
process.on('exit', (code) => {
  logProcLine(`[PROC] exit boot=${BOOT_ID} pid=${process.pid} code=${code} at=${new Date().toISOString()} uptimeSec=${Math.floor(process.uptime())}`);
});

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} reason=${reason}`);
  });
  socket.on('error', (err) => {
    console.warn(`[Socket] Error: ${socket.id}`, err);
  });
  registerGameHandlers(io, socket);
});

httpServer.listen(PORT, HOST, () => {
  const memLimit = getCgroupMemoryLimitBytes();
  console.log(`\n🃏 Short Deck Poker Server`);
  console.log(`   Listening on ${HOST}:${PORT}`);
  console.log(`   PORT env: ${process.env.PORT ?? '(missing)'}`);
  console.log(`   Allowed origin: ${CLIENT_URL}`);
  console.log(`   SUPABASE_URL set: ${hasSupabaseUrl}`);
  console.log(`   SUPABASE_SERVICE_ROLE_KEY set: ${hasSupabaseServiceKey}`);
  console.log(`   Boot: ${BOOT_ID}`);
  console.log(`   PID: ${process.pid}`);
  console.log(`   Node: ${process.version}`);
  console.log(`   Platform: ${process.platform} ${process.arch}`);
  console.log(`   Hostname: ${os.hostname()}`);
  if (memLimit) console.log(`   CgroupMemoryLimitMB: ${fmtMb(memLimit)}`);
  console.log(`   Health: /health\n`);
});
