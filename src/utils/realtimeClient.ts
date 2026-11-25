import { useEffect, useState } from 'react';
import type { ScheduleDayKey } from '../types/exam';

export type RealtimeSliceKey =
  | 'questions'
  | 'exams'
  | 'submissions'
  | 'privateClasses'
  | 'classJoinRequests'
  | 'classMaterials'
  | 'classAssignments'
  | 'classSchedules'
  | 'systemConfig'
  | 'accounts'
  | 'customSubjects'
  | 'teacherAlerts'
  | 'systemLogs';

export type RealtimeServerMessage =
  | {
      type: 'snapshot';
      reason?: string;
      initialized: boolean;
      version: number;
      serverTime: number;
      data: Partial<Record<RealtimeSliceKey, unknown>>;
      sourceClientId?: string;
    }
  | {
      type: 'slice:updated';
      slice: RealtimeSliceKey;
      value: unknown;
      version: number;
      serverTime: number;
      sourceClientId?: string;
    }
  | {
      type: 'batch:updated';
      patches: Partial<Record<RealtimeSliceKey, unknown>>;
      version: number;
      serverTime: number;
      sourceClientId?: string;
    }
  | {
      type: 'item:upserted';
      slice: RealtimeSliceKey;
      item: { id: string } & Record<string, unknown>;
      prepend?: boolean;
      version: number;
      serverTime: number;
      sourceClientId?: string;
    }
  | {
      type: 'item:removed';
      slice: RealtimeSliceKey;
      id: string;
      version: number;
      serverTime: number;
      sourceClientId?: string;
    }
  | {
      type: 'alert:new';
      alert: unknown;
      alerts: unknown[];
      version: number;
      serverTime: number;
      sourceClientId?: string;
    }
  | {
      type: 'log:new';
      entry: unknown;
      logs: unknown[];
      version: number;
      serverTime: number;
      sourceClientId?: string;
    }
  | {
      type: 'heartbeat' | 'pong';
      serverTime: number;
      version: number;
    };

export type RealtimeMessageListener = (msg: RealtimeServerMessage) => void;

export const REALTIME_CLIENT_ID =
  typeof window !== 'undefined'
    ? `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    : 'rt_ssr';

let socket: WebSocket | null = null;
let started = false;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let serverOffsetMs = 0;
let lastAppliedVersion = -1;
let latestSnapshot: Extract<RealtimeServerMessage, { type: 'snapshot' }> | null = null;
let seedProvider: (() => Promise<Partial<Record<RealtimeSliceKey, unknown>>>) | null = null;
let seedInFlight = false;

const messageListeners = new Set<RealtimeMessageListener>();
const clockListeners = new Set<() => void>();

function updateServerClock(serverTime?: number): void {
  if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) return;
  const nextOffset = serverTime - Date.now();
  const changedSignificantly = Math.abs(nextOffset - serverOffsetMs) > 1500;
  serverOffsetMs = nextOffset;
  if (changedSignificantly) {
    for (const cb of clockListeners) {
      try {
        cb();
      } catch {
        // Ignore clock listener errors
      }
    }
  }
}

export function getRealtimeNow(): number {
  return Date.now() + serverOffsetMs;
}

export function useRealtimeNow(intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => getRealtimeNow());

  useEffect(() => {
    setNow(getRealtimeNow());
    const tick = () => setNow(getRealtimeNow());
    clockListeners.add(tick);
    const id = window.setInterval(tick, Math.max(500, intervalMs));
    return () => {
      clockListeners.delete(tick);
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}

export function formatRelativeTimeVi(timestampIso: string, nowMs: number): string {
  const parsed = Date.parse(timestampIso);
  if (!Number.isFinite(parsed)) return '';
  const diffSec = Math.floor((nowMs - parsed) / 1000);
  if (diffSec < 10) return 'Vừa xong';
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'Hôm qua';
  if (diffDay < 7) return `${diffDay} ngày trước`;
  return new Date(parsed).toLocaleDateString('vi-VN');
}

const JS_DAY_TO_SCHEDULE_KEY: Record<number, ScheduleDayKey> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

export function getTodayScheduleDayKey(nowMs: number): ScheduleDayKey {
  const dayIndex = new Date(nowMs).getDay();
  return JS_DAY_TO_SCHEDULE_KEY[dayIndex] ?? 'mon';
}

export function isTimeSlotActiveNow(timeSlot: string, nowMs: number): boolean {
  const matches = timeSlot.match(/(\d{1,2})[:h](\d{2})/g);
  if (!matches || matches.length < 2) return false;
  const parseMins = (token: string): number | null => {
    const parts = token.match(/(\d{1,2})[:h](\d{2})/);
    if (!parts) return null;
    const h = Number(parts[1]);
    const m = Number(parts[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  };
  const start = parseMins(matches[0]);
  const end = parseMins(matches[1]);
  if (start === null || end === null || end <= start) return false;
  const d = new Date(nowMs);
  const currentMins = d.getHours() * 60 + d.getMinutes();
  return currentMins >= start && currentMins < end;
}

function dispatchMessage(msg: RealtimeServerMessage): void {
  updateServerClock(msg.serverTime);

  if (msg.type === 'heartbeat' || msg.type === 'pong') {
    return;
  }

  if (msg.type === 'snapshot') {
    if (!msg.initialized) {
      void trySeedServerIfNeeded();
      return;
    }
    if (msg.version < lastAppliedVersion && msg.reason !== 'reset') {
      return;
    }
    lastAppliedVersion = msg.version;
    latestSnapshot = msg;
  } else {
    if (typeof msg.version === 'number') {
      if (msg.version <= lastAppliedVersion) {
        return;
      }
      lastAppliedVersion = msg.version;
    }
    if ('sourceClientId' in msg && msg.sourceClientId === REALTIME_CLIENT_ID) {
      return;
    }
  }

  for (const listener of messageListeners) {
    try {
      listener(msg);
    } catch {
      // Ignore individual listener errors
    }
  }
}

async function trySeedServerIfNeeded(): Promise<void> {
  if (seedInFlight || !seedProvider) return;
  seedInFlight = true;
  try {
    const data = await seedProvider();
    sendRealtimeMutation({ type: 'seed:init', data });
  } catch {
    // Ignore seed bootstrap errors
  } finally {
    seedInFlight = false;
  }
}

export function registerSeedSnapshotProvider(
  provider: () => Promise<Partial<Record<RealtimeSliceKey, unknown>>>,
): void {
  seedProvider = provider;
  if (latestSnapshot && !latestSnapshot.initialized) {
    void trySeedServerIfNeeded();
  }
}

export function subscribeRealtimeMessages(
  listener: RealtimeMessageListener,
): () => void {
  messageListeners.add(listener);
  if (latestSnapshot && latestSnapshot.initialized) {
    try {
      listener(latestSnapshot);
    } catch {
      // Ignore replay errors
    }
  }
  return () => {
    messageListeners.delete(listener);
  };
}

export function sendRealtimeMutation(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const body = {
    ...payload,
    clientId: REALTIME_CLIENT_ID,
  };

  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(body));
      return;
    } catch {
      // Fall through to HTTP POST fallback
    }
  }

  void fetch('/api/realtime/mutate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Ignore transient network errors while offline
  });
}

function scheduleReconnect(): void {
  if (typeof window === 'undefined' || reconnectTimer !== null) return;
  const delay = Math.min(4000, 450 * Math.pow(1.6, reconnectAttempt));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function connectWebSocket(): void {
  if (typeof window === 'undefined') return;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    socket = ws;

    ws.onopen = () => {
      reconnectAttempt = 0;
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as RealtimeServerMessage;
        dispatchMessage(parsed);
      } catch {
        // Ignore malformed server message
      }
    };

    ws.onclose = () => {
      if (socket === ws) {
        socket = null;
      }
      scheduleReconnect();
    };

    ws.onerror = () => {
      // Let onclose handle reconnect
    };
  } catch {
    scheduleReconnect();
  }
}

async function fetchInitialSnapshotHttp(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch('/api/realtime/state', { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as {
      initialized?: boolean;
      version?: number;
      serverTime?: number;
      data?: Partial<Record<RealtimeSliceKey, unknown>>;
    };
    if (!json || typeof json !== 'object') return;
    if (!json.initialized) {
      await trySeedServerIfNeeded();
      return;
    }
    dispatchMessage({
      type: 'snapshot',
      reason: 'http_bootstrap',
      initialized: true,
      version: typeof json.version === 'number' ? json.version : 0,
      serverTime: typeof json.serverTime === 'number' ? json.serverTime : Date.now(),
      data: json.data ?? {},
    });
  } catch {
    // Ignore HTTP bootstrap failure; WebSocket will sync
  }
}

export function initRealtimeConnection(): void {
  if (typeof window === 'undefined' || started) return;
  started = true;

  void fetchInitialSnapshotHttp();
  connectWebSocket();

  window.addEventListener('online', () => {
    connectWebSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'snapshot:request' }));
    } else {
      void fetchInitialSnapshotHttp();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping' }));
    } else {
      connectWebSocket();
    }
  });
}

if (typeof window !== 'undefined') {
  initRealtimeConnection();
}
