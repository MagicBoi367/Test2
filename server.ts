import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_FILE = path.join(DATA_DIR, 'realtime-store.json');

const VALID_SLICES = new Set([
  'questions',
  'exams',
  'submissions',
  'privateClasses',
  'classJoinRequests',
  'classMaterials',
  'classAssignments',
  'classSchedules',
  'systemConfig',
  'accounts',
  'customSubjects',
  'teacherAlerts',
  'systemLogs',
]);

interface StoreFileShape {
  initialized: boolean;
  version: number;
  data: Record<string, unknown>;
}

const storeState: StoreFileShape = {
  initialized: false,
  version: 0,
  data: {},
};

function loadStoreFromDisk(): void {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<StoreFileShape>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.initialized &&
      parsed.data &&
      typeof parsed.data === 'object'
    ) {
      storeState.initialized = true;
      storeState.version = typeof parsed.version === 'number' ? parsed.version : 1;
      for (const [k, v] of Object.entries(parsed.data)) {
        if (VALID_SLICES.has(k)) {
          storeState.data[k] = v;
        }
      }
    }
  } catch (err) {
    console.error('[realtime] Failed to load store from disk:', err);
  }
}

let flushTimer: NodeJS.Timeout | null = null;

function flushStoreSync(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(storeState), 'utf8');
    fs.renameSync(tmpFile, STORE_FILE);
  } catch (err) {
    console.error('[realtime] Failed to flush store to disk:', err);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushStoreSync();
  }, 120);
}

interface IncomingMutation {
  type?: string;
  slice?: string;
  value?: unknown;
  patches?: Record<string, unknown>;
  item?: { id?: string } & Record<string, unknown>;
  prepend?: boolean;
  id?: string;
  alert?: { id?: string } & Record<string, unknown>;
  entry?: { id?: string } & Record<string, unknown>;
  data?: Record<string, unknown>;
  clientId?: string;
}

function applyMutation(msg: IncomingMutation): {
  ok: boolean;
  broadcastPayload?: Record<string, unknown>;
} {
  const now = Date.now();
  const sourceClientId = typeof msg.clientId === 'string' ? msg.clientId : '';

  switch (msg.type) {
    case 'seed:init': {
      if (storeState.initialized || !msg.data || typeof msg.data !== 'object') {
        return { ok: true };
      }
      for (const [k, v] of Object.entries(msg.data)) {
        if (VALID_SLICES.has(k) && v !== undefined) {
          storeState.data[k] = v;
        }
      }
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'snapshot',
          reason: 'seed',
          initialized: true,
          version: storeState.version,
          serverTime: now,
          data: storeState.data,
          sourceClientId,
        },
      };
    }

    case 'reset:all': {
      if (!msg.data || typeof msg.data !== 'object') {
        return { ok: false };
      }
      const nextData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(msg.data)) {
        if (VALID_SLICES.has(k) && v !== undefined) {
          nextData[k] = v;
        }
      }
      storeState.data = nextData;
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'snapshot',
          reason: 'reset',
          initialized: true,
          version: storeState.version,
          serverTime: now,
          data: storeState.data,
          sourceClientId,
        },
      };
    }

    case 'slice:set': {
      if (!msg.slice || !VALID_SLICES.has(msg.slice)) {
        return { ok: false };
      }
      storeState.data[msg.slice] = msg.value;
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'slice:updated',
          slice: msg.slice,
          value: msg.value,
          version: storeState.version,
          serverTime: now,
          sourceClientId,
        },
      };
    }

    case 'batch:set': {
      if (!msg.patches || typeof msg.patches !== 'object') {
        return { ok: false };
      }
      const cleanPatches: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(msg.patches)) {
        if (VALID_SLICES.has(k) && v !== undefined) {
          storeState.data[k] = v;
          cleanPatches[k] = v;
        }
      }
      if (Object.keys(cleanPatches).length === 0) {
        return { ok: true };
      }
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'batch:updated',
          patches: cleanPatches,
          version: storeState.version,
          serverTime: now,
          sourceClientId,
        },
      };
    }

    case 'item:upsert': {
      if (
        !msg.slice ||
        !VALID_SLICES.has(msg.slice) ||
        !msg.item ||
        typeof msg.item !== 'object' ||
        typeof msg.item.id !== 'string'
      ) {
        return { ok: false };
      }
      const current = Array.isArray(storeState.data[msg.slice])
        ? ([...(storeState.data[msg.slice] as Array<{ id?: string }>)] as Array<{
            id?: string;
          }>)
        : [];
      const idx = current.findIndex((entry) => entry && entry.id === msg.item?.id);
      if (idx >= 0) {
        current[idx] = msg.item;
      } else if (msg.prepend !== false) {
        current.unshift(msg.item);
      } else {
        current.push(msg.item);
      }
      storeState.data[msg.slice] = current;
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'item:upserted',
          slice: msg.slice,
          item: msg.item,
          prepend: msg.prepend !== false,
          version: storeState.version,
          serverTime: now,
          sourceClientId,
        },
      };
    }

    case 'item:remove': {
      if (!msg.slice || !VALID_SLICES.has(msg.slice) || typeof msg.id !== 'string') {
        return { ok: false };
      }
      const current = Array.isArray(storeState.data[msg.slice])
        ? (storeState.data[msg.slice] as Array<{ id?: string }>)
        : [];
      const next = current.filter((entry) => entry?.id !== msg.id);
      storeState.data[msg.slice] = next;
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'item:removed',
          slice: msg.slice,
          id: msg.id,
          version: storeState.version,
          serverTime: now,
          sourceClientId,
        },
      };
    }

    case 'alert:push': {
      if (!msg.alert || typeof msg.alert !== 'object' || typeof msg.alert.id !== 'string') {
        return { ok: false };
      }
      const current = Array.isArray(storeState.data.teacherAlerts)
        ? (storeState.data.teacherAlerts as Array<{ id?: string }>)
        : [];
      const alreadyExists = current.some((a) => a?.id === msg.alert?.id);
      const next = alreadyExists
        ? current
        : [msg.alert, ...current].slice(0, 60);
      storeState.data.teacherAlerts = next;
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'alert:new',
          alert: msg.alert,
          alerts: next,
          version: storeState.version,
          serverTime: now,
          sourceClientId,
        },
      };
    }

    case 'log:append': {
      if (!msg.entry || typeof msg.entry !== 'object' || typeof msg.entry.id !== 'string') {
        return { ok: false };
      }
      const current = Array.isArray(storeState.data.systemLogs)
        ? (storeState.data.systemLogs as Array<{ id?: string }>)
        : [];
      const alreadyExists = current.some((l) => l?.id === msg.entry?.id);
      const next = alreadyExists
        ? current
        : [msg.entry, ...current].slice(0, 500);
      storeState.data.systemLogs = next;
      storeState.initialized = true;
      storeState.version += 1;
      scheduleFlush();
      return {
        ok: true,
        broadcastPayload: {
          type: 'log:new',
          entry: msg.entry,
          logs: next,
          version: storeState.version,
          serverTime: now,
          sourceClientId,
        },
      };
    }

    default:
      return { ok: false };
  }
}

async function startServer(): Promise<void> {
  loadStoreFromDisk();

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcastJson(payload: Record<string, unknown>, excludeWs?: WebSocket): void {
    const serialized = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client === excludeWs) continue;
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        type: 'snapshot',
        reason: 'connect',
        initialized: storeState.initialized,
        version: storeState.version,
        serverTime: Date.now(),
        data: storeState.data,
      }),
    );

    ws.on('message', (raw) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = JSON.parse(text) as IncomingMutation;
        if (msg.type === 'ping') {
          ws.send(
            JSON.stringify({
              type: 'pong',
              serverTime: Date.now(),
              version: storeState.version,
            }),
          );
          return;
        }
        if (msg.type === 'snapshot:request') {
          ws.send(
            JSON.stringify({
              type: 'snapshot',
              reason: 'sync',
              initialized: storeState.initialized,
              version: storeState.version,
              serverTime: Date.now(),
              data: storeState.data,
            }),
          );
          return;
        }
        const res = applyMutation(msg);
        if (res.broadcastPayload) {
          const isSnapshotAll = res.broadcastPayload.type === 'snapshot';
          broadcastJson(res.broadcastPayload, isSnapshotAll ? undefined : ws);
        }
      } catch (err) {
        console.error('[realtime] WS message error:', err);
      }
    });
  });

  // Periodic server clock sync heartbeat (every 20 seconds)
  const heartbeatInterval = setInterval(() => {
    broadcastJson({
      type: 'heartbeat',
      serverTime: Date.now(),
      version: storeState.version,
    });
  }, 20_000);
  heartbeatInterval.unref();

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      serverTime: Date.now(),
      version: storeState.version,
      initialized: storeState.initialized,
    });
  });

  app.get('/api/realtime/state', (_req, res) => {
    res.json({
      initialized: storeState.initialized,
      version: storeState.version,
      serverTime: Date.now(),
      data: storeState.data,
    });
  });

  app.post('/api/realtime/mutate', (req, res) => {
    const body = req.body as IncomingMutation | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'Invalid mutation payload' });
      return;
    }
    const result = applyMutation(body);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: 'Unsupported mutation' });
      return;
    }
    if (result.broadcastPayload) {
      broadcastJson(result.broadcastPayload);
    }
    res.json({
      ok: true,
      version: storeState.version,
      serverTime: Date.now(),
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[realtime] NTPEXION server listening on http://0.0.0.0:${PORT}`);
  });

  const handleShutdown = () => {
    clearInterval(heartbeatInterval);
    flushStoreSync();
    process.exit(0);
  };
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

void startServer();
