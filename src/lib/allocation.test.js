import { describe, it, expect } from 'vitest';
import { calculateSessionAllocation, calculateEventShares, cleanNumericInput, todayLocal } from './allocation.js';
import { INITIAL_SESSIONS, INITIAL_EVENTS } from '../data/initialData.js';

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

const baseSession = (overrides = {}) => ({
  courtCount: 3, durationHours: 3, courtPricePerHour: 100000, extraCourts: [], customCourtTotal: null,
  courtAllocationMethod: 'BY_HOURS', shuttleUnitPrice: 24000, sharedShuttles: 20, damagedShuttles: 0,
  sharedShuttleMethod: 'BY_HOURS', enablePersonalShuttles: false, waterTotalCost: 100000,
  waterAllocationMethod: 'EQUAL_DRINKERS', otherExpenses: [],
  participants: Array.from({ length: 7 }, (_, i) => ({ memberId: `M${i}`, hours: 3, drinkWater: true, waterQty: 1 })),
  ...overrides
});

describe('calculateSessionAllocation', () => {
  it('tổng phân bổ luôn bằng tổng chi (dữ liệu mẫu)', () => {
    INITIAL_SESSIONS.forEach((s) => {
      const c = calculateSessionAllocation(s);
      expect(sum(c.memberBreakdowns, (b) => b.totalFee)).toBe(c.grandTotalExpense);
    });
  });

  it('tính đúng sân phát sinh', () => {
    const c = calculateSessionAllocation(INITIAL_SESSIONS[0]);
    expect(c.baseCourtCost).toBe(900000);
    expect(c.extraCourtsCost).toBe(100000);
    expect(c.grandTotalExpense).toBe(1000000 + 480000 + 100000 + 50000);
  });

  it('không ra NaN khi ô nhập bị rác / rỗng', () => {
    const c = calculateSessionAllocation(baseSession({ courtCount: 'abc', sharedShuttles: '', participants: [{ memberId: 'A', hours: 'x' }, { memberId: 'B', hours: '2' }] }));
    expect(Number.isFinite(c.grandTotalExpense)).toBe(true);
    c.memberBreakdowns.forEach((b) => expect(Number.isFinite(b.totalFee)).toBe(true));
  });

  it('dồn chênh lệch làm tròn vào người đánh nhiều giờ nhất (so sánh số, không so chuỗi)', () => {
    const c = calculateSessionAllocation(baseSession({
      participants: [
        { memberId: 'A', hours: '9', drinkWater: true },
        { memberId: 'B', hours: '10', drinkWater: true },
        { memberId: 'C', hours: '2', drinkWater: true }
      ]
    }));
    expect(sum(c.memberBreakdowns, (b) => b.totalFee)).toBe(c.grandTotalExpense);
    if (c.roundingAdjustment !== 0) {
      expect(c.memberBreakdowns[1].roundingDiff).toBe(c.roundingAdjustment);
    }
  });

  it('BY_QUANTITY khi không ai uống nước vẫn chia đều, không dồn cho 1 người', () => {
    const c = calculateSessionAllocation(baseSession({
      waterAllocationMethod: 'BY_QUANTITY', sharedShuttles: 0, courtCount: 0,
      participants: [{ memberId: 'A', hours: 3, drinkWater: false }, { memberId: 'B', hours: 3, drinkWater: false }]
    }));
    expect(c.memberBreakdowns.map((b) => b.waterFee)).toEqual([50000, 50000]);
    expect(c.roundingAdjustment).toBe(0);
  });

  it('nước do quỹ tài trợ: thành viên trả 0 nhưng vẫn ghi nhận chi phí quỹ', () => {
    const c = calculateSessionAllocation(baseSession({ waterAllocationMethod: 'SPONSORED' }));
    expect(c.waterCost).toBe(0);
    expect(c.waterSponsoredCost).toBe(100000);
    c.memberBreakdowns.forEach((b) => expect(b.waterFee).toBe(0));
  });

  it('chia đều tiền nước cho người uống', () => {
    const c = calculateSessionAllocation(INITIAL_SESSIONS[0]);
    const m05 = c.memberBreakdowns.find((b) => b.memberId === 'M05');
    expect(m05.waterFee).toBe(0);
  });

  it('mỗi hạng mục cộng lại đúng tổng, tiền sân tỉ lệ đúng theo giờ (kịch bản QA TC02)', () => {
    const participants = Array.from({ length: 20 }, (_, i) => ({
      memberId: `T${i}`, hours: i % 3 === 0 ? 3 : i % 3 === 1 ? 2 : 1,
      personalShuttles: i === 4 ? 0 : (i % 5) + 1, drinkWater: i !== 5, waterQty: 1
    }));
    const c = calculateSessionAllocation(baseSession({
      courtPricePerHour: 50000, shuttleUnitPrice: 10000, sharedShuttles: 4, damagedShuttles: 1,
      enablePersonalShuttles: true, waterTotalCost: 95000,
      otherExpenses: [{ amount: 50000, method: 'EQUAL' }], participants
    }));
    const b = c.memberBreakdowns;
    expect(sum(b, (x) => x.courtFee)).toBe(c.courtCost);
    expect(sum(b, (x) => x.shuttleFee)).toBe(c.totalShuttleCost);
    expect(sum(b, (x) => x.waterFee)).toBe(c.waterCost);
    expect(sum(b, (x) => x.otherFee)).toBe(c.otherCost);
    expect(c.roundingAdjustment).toBe(0);
    const p3 = b.find((x) => x.hours === 3);
    const p1 = b.find((x) => x.hours === 1);
    expect(Math.abs(p3.courtFee - p1.courtFee * 3)).toBeLessThanOrEqual(5);
  });

  it('buổi chưa có người tham gia không crash', () => {
    const c = calculateSessionAllocation(baseSession({ participants: [] }));
    expect(c.memberBreakdowns).toEqual([]);
    expect(c.unallocatedExpense).toBe(c.grandTotalExpense);
  });
});

describe('calculateEventShares', () => {
  it('trừ quỹ tài trợ rồi chia đều', () => {
    const r = calculateEventShares(INITIAL_EVENTS[0]);
    expect(r.netToSplit).toBe(1000000);
    expect(Object.values(r.shares)).toEqual([200000, 200000, 200000, 200000, 200000]);
  });

  it('quỹ tài trợ vượt tổng chi không làm âm', () => {
    const r = calculateEventShares({ totalCost: 100, clubSponsoredAmount: 500, participants: [{ memberId: 'A' }] });
    expect(r.netToSplit).toBe(0);
    expect(r.sponsored).toBe(100);
  });

  it('phần dư chia không hết cộng vào người đầu', () => {
    const r = calculateEventShares({ totalCost: 100, clubSponsoredAmount: 0, participants: [{ memberId: 'A' }, { memberId: 'B' }, { memberId: 'C' }] });
    expect(r.shares).toEqual({ A: 34, B: 33, C: 33 });
  });
});

describe('cleanNumericInput', () => {
  it('xử lý số 0 đầu, dấu phẩy, ký tự rác', () => {
    expect(cleanNumericInput('05')).toBe('5');
    expect(cleanNumericInput('00')).toBe('0');
    expect(cleanNumericInput('0.5')).toBe('0.5');
    expect(cleanNumericInput('2,5')).toBe('2.5');
    expect(cleanNumericInput('1.2.3')).toBe('1.23');
    expect(cleanNumericInput('.5')).toBe('0.5');
    expect(cleanNumericInput('3h')).toBe('3');
    expect(cleanNumericInput('')).toBe('');
  });

  it('ô tiền bỏ dấu phân cách nghìn', () => {
    expect(cleanNumericInput('100.000', { allowDecimal: false })).toBe('100000');
    expect(cleanNumericInput('1,500,000', { allowDecimal: false })).toBe('1500000');
  });
});

describe('todayLocal', () => {
  it('dùng giờ máy, không dùng UTC', () => {
    expect(todayLocal(new Date(2026, 10, 16, 1, 30))).toBe('2026-11-16');
  });
});

describe('computeClubAnalytics', async () => {
  const { computeClubAnalytics } = await import('./analytics.js');
  const { demoData, starterData } = await import('../data/initialData.js');

  it('dữ liệu demo: công nợ và số dư khớp kịch bản QA', () => {
    const a = computeClubAnalytics(demoData());
    expect(a.memberLedgers.M03.debtAmount).toBeGreaterThan(0);
    expect(a.memberLedgers.M07.creditAmount).toBeGreaterThan(0);
    expect(a.memberLedgers.M13.totalIncurred).toBe(0);
    expect(a.memberLedgers.M20.sessionsCount).toBe(1);
  });

  it('máy mới: chỉ có thành viên, không có tài chính', () => {
    const d = starterData();
    expect(d.members).toHaveLength(20);
    expect(d.sessions).toHaveLength(0);
    const a = computeClubAnalytics(d);
    expect(a.actualFundBalance).toBe(0);
    expect(a.totalReceivable).toBe(0);
  });
});

describe('Tổng thực chi có tính tiền cầu', async () => {
  const { computeClubAnalytics } = await import('./analytics.js');
  const sess = (id, date, shuttles) => ({
    id, date, status: 'Confirmed', courtCount: 1, durationHours: 1, courtPricePerHour: 100000,
    shuttleUnitPrice: 24000, sharedShuttles: shuttles, damagedShuttles: 0, waterTotalCost: 50000,
    waterAllocationMethod: 'EQUAL_ALL', participants: [{ memberId: 'A', hours: 1, drinkWater: true }]
  });
  const members = [{ id: 'A', fullName: 'A', status: 'Active' }];

  it('không nhập kho: tiền cầu từng buổi được tính vào thực chi', () => {
    const a = computeClubAnalytics({ members, sessions: [sess('s1', '2026-11-01', 10)] });
    expect(a.totalShuttleSpent).toBe(240000);
    expect(a.totalActualCashOut).toBe(100000 + 240000 + 50000); // sân + cầu + nước
  });

  it('cầu lấy từ kho đã mua: không tính trùng', () => {
    const a = computeClubAnalytics({
      members,
      sessions: [sess('s1', '2026-11-01', 10)],
      inventoryPurchases: [{ id: 'i1', quantity: 120, unitPrice: 24000, totalCost: 2880000 }]
    });
    expect(a.totalShuttleSpent).toBe(2880000);
    expect(a.totalShuttleBoughtAtSessions).toBe(0);
  });

  it('dùng vượt kho: phần thiếu tính theo giá của buổi', () => {
    const a = computeClubAnalytics({
      members,
      sessions: [sess('s1', '2026-11-01', 8), sess('s2', '2026-11-02', 8)],
      inventoryPurchases: [{ id: 'i1', quantity: 12, unitPrice: 20000, totalCost: 240000 }]
    });
    expect(a.totalShuttleBoughtAtSessions).toBe(4 * 24000);
    expect(a.totalShuttleSpent).toBe(240000 + 96000);
  });

  it('buổi Nháp không tính chi', () => {
    const a = computeClubAnalytics({ members, sessions: [{ ...sess('s1', '2026-11-01', 10), status: 'Draft' }] });
    expect(a.totalActualCashOut).toBe(0);
  });
});
