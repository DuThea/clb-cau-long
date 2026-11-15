// ==========================================
// LƯU TRỮ OFFLINE TRÊN IPHONE
// ==========================================
// - Chính: IndexedDB (không bị trần ~5 MB như localStorage, đủ dùng nhiều năm).
// - Dự phòng: localStorage nếu IndexedDB không dùng được.
// - Dữ liệu bọc trong "envelope" có schemaVersion + chuỗi migration để nâng cấp an toàn qua các phiên bản.
// - Ghi gộp (debounce) thay vì ghi lại toàn bộ sau mỗi phím gõ; flush khi app bị ẩn / đóng.

export const SCHEMA_VERSION = 2;

const DB_NAME = 'bcm';
const DB_VERSION = 1;
const STORE = 'kv';
const DATA_KEY = 'club-data';
const LEGACY_KEY = 'bcm-data-v1'; // localStorage của bản <= v1
const LOCAL_FALLBACK_KEY = 'bcm-data-fallback';
const THEME_KEY = 'bcm-dark-mode';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));

/** Chuẩn hoá dữ liệu (từ file backup / bộ nhớ) để tránh crash do thiếu trường. */
export function normalizeData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.members) || !Array.isArray(raw.sessions)) return null;

  const members = raw.members
    .filter((m) => m && m.id)
    .map((m) => ({
      ...m,
      id: str(m.id),
      fullName: str(m.fullName, str(m.id)),
      nickname: str(m.nickname),
      phone: str(m.phone),
      notes: str(m.notes),
      status: ['Active', 'Inactive', 'Archived'].includes(m.status) ? m.status : 'Active'
    }));

  const sessions = raw.sessions
    .filter((s) => s && s.id)
    .map((s) => ({
      ...s,
      id: str(s.id),
      date: str(s.date),
      title: str(s.title),
      status: ['Draft', 'Confirmed', 'Closed'].includes(s.status) ? s.status : 'Draft',
      participants: arr(s.participants).filter((p) => p && p.memberId),
      extraCourts: arr(s.extraCourts),
      otherExpenses: arr(s.otherExpenses),
      editHistory: arr(s.editHistory)
    }));

  const events = arr(raw.events)
    .filter((e) => e && e.id)
    .map((e) => ({ ...e, name: str(e.name), date: str(e.date), participants: arr(e.participants) }));

  return {
    members,
    sessions,
    events,
    payments: arr(raw.payments).filter((p) => p && p.id && p.memberId),
    inventoryPurchases: arr(raw.inventoryPurchases).filter((i) => i && i.id),
    ledgerAdjustments: arr(raw.ledgerAdjustments)
  };
}

/**
 * Migration theo từng bước: MIGRATIONS[n] nâng dữ liệu từ phiên bản n lên n+1.
 * Khi đổi cấu trúc dữ liệu: tăng SCHEMA_VERSION và thêm một hàm ở đây – KHÔNG sửa hàm cũ.
 */
const MIGRATIONS = {
  // v1 -> v2: chuyển từ localStorage sang IndexedDB, cấu trúc dữ liệu giữ nguyên.
  1: (d) => d
};

/**
 * Nhận mọi định dạng đã từng có và trả về dữ liệu phiên bản hiện tại:
 *  - envelope lưu trữ: { schemaVersion, savedAt, data: {...} }
 *  - file backup: { schemaVersion?, version?: '1.0.0', members, sessions, ... }
 *  - dữ liệu thô v1: { members, sessions, ... }
 */
export function migrateData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const isEnvelope = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.members);
  let data = isEnvelope ? raw.data : raw;
  const fromVersion = Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 1;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) data = step(data);
  }
  const normalized = normalizeData(data);
  if (!normalized) return null;
  return { data: normalized, fromVersion, newer: fromVersion > SCHEMA_VERSION };
}

const envelope = (data) => ({ schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), data });

// ---------- IndexedDB helpers ----------
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB không khả dụng')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // bản app mới hơn cần nâng cấp DB
      db.onclose = () => { dbPromise = null; }; // iOS có thể đóng kết nối khi app chạy nền lâu
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB đang bị khoá bởi tab khác'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function idbRequest(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Lỗi ghi IndexedDB'));
    tx.onabort = () => reject(tx.error || new Error('Giao dịch IndexedDB bị huỷ (có thể do đầy bộ nhớ)'));
  });
}

const idbGet = (key) => idbRequest('readonly', (s) => s.get(key));
const idbPut = (key, value) => idbRequest('readwrite', (s) => s.put(value, key));

// ---------- localStorage helpers ----------
const lsGet = (key) => {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const lsSet = (key, value) => globalThis.localStorage.setItem(key, JSON.stringify(value));
const lsRemove = (key) => { try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ } };

/**
 * Đọc dữ liệu lúc khởi động.
 * @returns {{data: object|null, backend: 'idb'|'local', source: 'idb'|'legacy'|'fallback'|'none', newer: boolean}}
 */
export async function loadData() {
  try {
    const rec = await idbGet(DATA_KEY);
    if (rec) {
      const m = migrateData(rec);
      if (m) return { data: m.data, backend: 'idb', source: 'idb', newer: m.newer };
    }
    // Lần đầu chạy bản IndexedDB: chuyển dữ liệu cũ từ localStorage sang
    const legacy = lsGet(LEGACY_KEY) || lsGet(LOCAL_FALLBACK_KEY);
    const m = legacy && migrateData(legacy);
    if (m) {
      await idbPut(DATA_KEY, envelope(m.data));
      const check = await idbGet(DATA_KEY);
      if (check) { lsRemove(LEGACY_KEY); lsRemove(LOCAL_FALLBACK_KEY); } // chỉ xoá bản cũ khi đã ghi chắc chắn
      return { data: m.data, backend: 'idb', source: 'legacy', newer: m.newer };
    }
    return { data: null, backend: 'idb', source: 'none', newer: false };
  } catch {
    const legacy = lsGet(LOCAL_FALLBACK_KEY) || lsGet(LEGACY_KEY);
    const m = legacy && migrateData(legacy);
    return { data: m ? m.data : null, backend: 'local', source: m ? 'fallback' : 'none', newer: Boolean(m?.newer) };
  }
}

/**
 * Bộ ghi dữ liệu có debounce.
 * onStatus({ state: 'saving'|'saved'|'error', error?, savedAt? })
 */
export function createSaver(backend, onStatus = () => {}, delay = 400) {
  let timer = null;
  let pending = null;
  let chain = Promise.resolve();

  const write = async (data) => {
    if (backend === 'idb') {
      await idbPut(DATA_KEY, envelope(data));
    } else {
      lsSet(LOCAL_FALLBACK_KEY, envelope(data));
    }
  };

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pending) return chain;
    const data = pending;
    pending = null;
    onStatus({ state: 'saving' });
    chain = chain
      .then(() => write(data))
      .then(() => onStatus({ state: 'saved', savedAt: new Date() }))
      .catch((error) => {
        // Giữ lại để lần thay đổi sau thử ghi tiếp
        if (!pending) pending = data;
        onStatus({ state: 'error', error });
      });
    return chain;
  };

  return {
    schedule(data) {
      pending = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    retry: flush
  };
}

/** Xin iOS/trình duyệt giữ dữ liệu vĩnh viễn (không tự xoá khi máy thiếu bộ nhớ). */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

export async function getStorageInfo() {
  const info = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage ?? null;
      info.quota = e.quota ?? null;
    }
  } catch { /* ignore */ }
  return info;
}

export function loadDarkMode() {
  try { return globalThis.localStorage?.getItem(THEME_KEY) === '1'; } catch { return false; }
}

export function saveDarkMode(v) {
  try { globalThis.localStorage?.setItem(THEME_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

/** Chỉ dùng cho test. */
export function __resetStorageForTests() {
  dbPromise = null;
}
