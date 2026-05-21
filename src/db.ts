import type { BaselineStats } from './baseline';
import type { RecordingSummary } from './meditation';

const DB_NAME = 'seebrain';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_FULL = 'full';

export type SessionMeta = {
  id: string;
  name: string;
  createdAt: string;
  durationSec: number;
  meanScore: number;
  fractionMeditative: number;
  sampleHz: number;
  channels: string[];
  totalRawSamples: number;
};

export type RawSamples = {
  channels: Float32Array[];
  sampleHz: number;
};

export type FullSession = {
  meta: SessionMeta;
  baseline: BaselineStats;
  summary: RecordingSummary;
  raw: RawSamples;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        const s = db.createObjectStore(STORE_META, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_FULL)) {
        db.createObjectStore(STORE_FULL, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_META, 'readonly');
    const idx = t.objectStore(STORE_META).index('createdAt');
    const req = idx.openCursor(null, 'prev');
    const out: SessionMeta[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push(cursor.value as SessionMeta);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(full: FullSession): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_META, STORE_FULL], 'readwrite');
    t.objectStore(STORE_META).put(full.meta);
    t.objectStore(STORE_FULL).put({ id: full.meta.id, ...full });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function loadSession(id: string): Promise<FullSession | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_FULL, 'readonly');
    const req = t.objectStore(STORE_FULL).get(id);
    req.onsuccess = () => resolve(req.result ? (req.result as FullSession) : null);
    req.onerror = () => reject(req.error);
  });
}

export async function renameSession(id: string, newName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_META, STORE_FULL], 'readwrite');
    const metaStore = t.objectStore(STORE_META);
    const fullStore = t.objectStore(STORE_FULL);

    const metaReq = metaStore.get(id);
    metaReq.onsuccess = () => {
      const meta = metaReq.result as SessionMeta | undefined;
      if (!meta) { t.abort(); reject(new Error('Session not found')); return; }
      meta.name = newName;
      metaStore.put(meta);
    };
    metaReq.onerror = () => reject(metaReq.error);

    const fullReq = fullStore.get(id);
    fullReq.onsuccess = () => {
      const full = fullReq.result as (FullSession & { id: string }) | undefined;
      if (full) {
        full.meta = { ...full.meta, name: newName };
        fullStore.put(full);
      }
    };
    fullReq.onerror = () => reject(fullReq.error);

    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('rename aborted'));
  });
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction([STORE_META, STORE_FULL], 'readwrite');
    t.objectStore(STORE_META).delete(id);
    t.objectStore(STORE_FULL).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function newSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function migrateFromLocalStorage(): Promise<number> {
  const KEY_INDEX = 'seebrain.sessions.v1';
  const KEY_PREFIX = 'seebrain.session.v1.';
  let raw: string | null;
  try { raw = localStorage.getItem(KEY_INDEX); } catch { return 0; }
  if (!raw) return 0;
  let metas: { id: string; name: string; createdAt: string; durationSec: number; meanScore: number; fractionMeditative: number }[];
  try { metas = JSON.parse(raw); } catch { return 0; }
  let migrated = 0;
  for (const m of metas) {
    try {
      const sessionRaw = localStorage.getItem(KEY_PREFIX + m.id);
      if (!sessionRaw) continue;
      const stored = JSON.parse(sessionRaw) as { baseline: BaselineStats; summary: RecordingSummary };
      const full: FullSession = {
        meta: {
          id: m.id,
          name: m.name,
          createdAt: m.createdAt,
          durationSec: m.durationSec,
          meanScore: m.meanScore,
          fractionMeditative: m.fractionMeditative,
          sampleHz: 256,
          channels: ['TP9', 'AF7', 'AF8', 'TP10'],
          totalRawSamples: 0,
        },
        baseline: stored.baseline,
        summary: stored.summary,
        raw: {
          channels: [new Float32Array(0), new Float32Array(0), new Float32Array(0), new Float32Array(0)],
          sampleHz: 256,
        },
      };
      await saveSession(full);
      localStorage.removeItem(KEY_PREFIX + m.id);
      migrated++;
    } catch (e) {
      console.warn('migrate failed for', m.id, e);
    }
  }
  localStorage.removeItem(KEY_INDEX);
  return migrated;
}
