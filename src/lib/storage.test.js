import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';
import { loadData, createSaver, migrateData, SCHEMA_VERSION, __resetStorageForTests } from './storage.js';
import { INITIAL_MEMBERS, INITIAL_SESSIONS, INITIAL_PAYMENTS } from '../data/initialData.js';

// localStorage giả lập (Node không có sẵn)
const makeLocalStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m
  };
};

const sample = () => ({
  members: INITIAL_MEMBERS,
  sessions: INITIAL_SESSIONS,
  events: [],
  payments: INITIAL_PAYMENTS,
  inventoryPurchases: [],
  ledgerAdjustments: []
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // DB trống cho mỗi test
  Object.defineProperty(globalThis, 'localStorage', { value: makeLocalStorage(), configurable: true, writable: true });
  __resetStorageForTests();
});

describe('migrateData', () => {
  it('đọc được dữ liệu thô v1 (localStorage cũ / backup cũ)', () => {
    const m = migrateData({ version: '1.0.0', ...sample() });
    expect(m.fromVersion).toBe(1);
    expect(m.data.members).toHaveLength(INITIAL_MEMBERS.length);
    expect(m.newer).toBe(false);
  });

  it('đọc được envelope phiên bản hiện tại', () => {
    const m = migrateData({ schemaVersion: SCHEMA_VERSION, savedAt: 'x', data: sample() });
    expect(m.data.sessions).toHaveLength(INITIAL_SESSIONS.length);
  });

  it('đánh dấu dữ liệu từ phiên bản mới hơn', () => {
    const m = migrateData({ schemaVersion: SCHEMA_VERSION + 1, data: sample() });
    expect(m.newer).toBe(true);
  });

  it('từ chối dữ liệu hỏng', () => {
    expect(migrateData(null)).toBeNull();
    expect(migrateData({ foo: 1 })).toBeNull();
  });
});

describe('IndexedDB storage', () => {
  it('máy mới chưa có dữ liệu', async () => {
    const r = await loadData();
    expect(r).toMatchObject({ data: null, backend: 'idb', source: 'none' });
  });

  it('tự chuyển dữ liệu localStorage cũ sang IndexedDB rồi xoá bản cũ', async () => {
    localStorage.setItem('bcm-data-v1', JSON.stringify(sample()));
    const first = await loadData();
    expect(first.source).toBe('legacy');
    expect(first.data.payments).toHaveLength(INITIAL_PAYMENTS.length);
    expect(localStorage.getItem('bcm-data-v1')).toBeNull();

    __resetStorageForTests();
    const second = await loadData();
    expect(second.source).toBe('idb');
    expect(second.data.members).toHaveLength(INITIAL_MEMBERS.length);
  });

  it('ghi gộp (debounce) và flush lưu đúng bản mới nhất', async () => {
    const states = [];
    const saver = createSaver('idb', (s) => states.push(s.state), 50);
    const d1 = sample();
    const d2 = { ...sample(), members: INITIAL_MEMBERS.slice(0, 3) };
    saver.schedule(d1);
    saver.schedule(d2);
    await saver.flush();
    expect(states).toEqual(['saving', 'saved']); // 2 thay đổi -> 1 lần ghi

    __resetStorageForTests();
    const r = await loadData();
    expect(r.data.members).toHaveLength(3);
  });

  it('dữ liệu 3 năm (~2,3 MB) vẫn lưu và đọc lại được', async () => {
    const big = sample();
    big.payments = Array.from({ length: 6000 }, (_, i) => ({
      id: `P${i}`, memberId: 'M01', sessionId: 'S1', date: '2028-01-01', amount: 150000,
      method: 'Bank Transfer', type: 'SessionPayment', note: `Thu tiền buổi số ${i} – ghi chú dài cho đủ dung lượng`
    }));
    const saver = createSaver('idb', () => {}, 0);
    saver.schedule(big);
    await saver.flush();
    __resetStorageForTests();
    const r = await loadData();
    expect(r.data.payments).toHaveLength(6000);
  });

  it('IndexedDB lỗi -> dùng localStorage dự phòng', async () => {
    globalThis.indexedDB = undefined;
    __resetStorageForTests();
    localStorage.setItem('bcm-data-v1', JSON.stringify(sample()));
    const r = await loadData();
    expect(r.backend).toBe('local');
    expect(r.data.members).toHaveLength(INITIAL_MEMBERS.length);

    const saver = createSaver('local', () => {}, 0);
    saver.schedule(r.data);
    await saver.flush();
    expect(JSON.parse(localStorage.getItem('bcm-data-fallback')).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('báo lỗi khi không ghi được và thử lại ở lần sau', async () => {
    const states = [];
    globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    const saver = createSaver('local', (s) => states.push(s.state), 0);
    saver.schedule(sample());
    await saver.flush();
    expect(states.at(-1)).toBe('error');

    globalThis.localStorage = makeLocalStorage();
    await saver.retry();
    expect(states.at(-1)).toBe('saved');
  });
});
