// ==========================================
// SỔ CÁI TỔNG HỢP CỦA CLB (PURE FUNCTION)
// ==========================================
// Tách khỏi giao diện để: dùng lại (QA chạy trên dữ liệu demo), test độc lập, mở rộng tính năng mới.
import { calculateSessionAllocation, calculateEventShares, fmtNum, toNum } from './allocation.js';

export function computeClubAnalytics({ members = [], sessions = [], events = [], payments = [], inventoryPurchases = [], ledgerAdjustments = [] }) {
  const sessionCalculations = {};
  sessions.forEach((s) => { sessionCalculations[s.id] = calculateSessionAllocation(s); });

  const eventCalculations = {};
  events.forEach((ev) => { eventCalculations[ev.id] = calculateEventShares(ev); });

  const memberLedgers = {};
  members.forEach((m) => {
    memberLedgers[m.id] = {
      ...m,
      sessionsCount: 0,
      totalHours: 0,
      totalShuttles: 0,
      sessionFees: 0,
      eventFees: 0,
      adjustments: 0,
      totalIncurred: 0,
      totalPaid: 0,
      balance: 0,
      debtAmount: 0,
      creditAmount: 0,
      sessionHistory: [],
      paymentHistory: [],
      eventHistory: []
    };
  });

  // Buổi Confirmed hoặc Closed mới phát sinh công nợ (Draft thì chưa)
  sessions.forEach((s) => {
    if (s.status === 'Draft') return;
    sessionCalculations[s.id].memberBreakdowns.forEach((b) => {
      const ledger = memberLedgers[b.memberId];
      if (!ledger) return;
      ledger.sessionsCount += 1;
      ledger.totalHours = fmtNum(ledger.totalHours + toNum(b.hours));
      ledger.totalShuttles = fmtNum(ledger.totalShuttles + toNum(b.effectiveShuttlesCount), 1);
      ledger.sessionFees += b.totalFee;
      ledger.sessionHistory.push({
        sessionId: s.id, date: s.date, title: s.title, status: s.status,
        hours: toNum(b.hours), shuttles: b.effectiveShuttlesCount,
        courtFee: b.courtFee, shuttleFee: b.shuttleFee, waterFee: b.waterFee, otherFee: b.otherFee,
        totalFee: b.totalFee
      });
    });
  });

  events.forEach((ev) => {
    Object.entries(eventCalculations[ev.id].shares).forEach(([mId, fee]) => {
      const ledger = memberLedgers[mId];
      if (!ledger) return;
      ledger.eventFees += fee;
      ledger.eventHistory.push({ eventId: ev.id, name: ev.name, date: ev.date, fee });
    });
  });

  ledgerAdjustments.forEach((adj) => {
    const ledger = memberLedgers[adj.memberId];
    if (ledger) ledger.adjustments += toNum(adj.amount);
  });

  payments.forEach((pay) => {
    const ledger = memberLedgers[pay.memberId];
    if (!ledger) return;
    ledger.totalPaid += toNum(pay.amount);
    ledger.paymentHistory.push(pay);
  });

  let totalReceivable = 0;
  let totalPrepaidCredit = 0;
  let debtorsCount = 0;

  Object.values(memberLedgers).forEach((l) => {
    l.sessionHistory.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    l.paymentHistory.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    l.totalIncurred = l.sessionFees + l.eventFees + l.adjustments;
    l.balance = l.totalPaid - l.totalIncurred;
    if (l.balance < 0) {
      l.debtAmount = -l.balance;
      totalReceivable += l.debtAmount;
      debtorsCount += 1;
    } else {
      l.creditAmount = l.balance;
      totalPrepaidCredit += l.creditAmount;
    }
  });

  // Dòng tiền thực tế của quỹ
  const totalCashIn = payments.reduce((acc, p) => acc + toNum(p.amount), 0);
  const cashInByBank = payments.filter((p) => p.method === 'Bank Transfer').reduce((acc, p) => acc + toNum(p.amount), 0);
  const cashInByHand = totalCashIn - cashInByBank;

  let totalCourtSpent = 0;
  let totalWaterSpent = 0;
  let totalOtherSessionSpent = 0;
  let totalShuttlesConsumed = 0;

  sessions.forEach((s) => {
    if (s.status === 'Draft') return;
    const c = sessionCalculations[s.id];
    totalCourtSpent += c.courtCost;
    // Nước "Quỹ tài trợ" thành viên không trả nhưng quỹ vẫn chi tiền thật
    totalWaterSpent += c.waterCost + c.waterSponsoredCost;
    totalOtherSessionSpent += c.otherCost;
    totalShuttlesConsumed += c.totalShuttlesUsed;
  });
  totalShuttlesConsumed = fmtNum(totalShuttlesConsumed, 1);

  const totalInventorySpent = inventoryPurchases.reduce((acc, i) => acc + toNum(i.totalCost), 0);
  const totalShuttlesBought = inventoryPurchases.reduce((acc, i) => acc + toNum(i.quantity), 0);
  const remainingShuttlesInStock = fmtNum(totalShuttlesBought - totalShuttlesConsumed, 1);

  const totalEventActualSpent = events.reduce((acc, e) => acc + (e.paidFromClubCash ? toNum(e.totalCost) : 0), 0);

  const totalActualCashOut = totalCourtSpent + totalWaterSpent + totalOtherSessionSpent + totalInventorySpent + totalEventActualSpent;
  const actualFundBalance = totalCashIn - totalActualCashOut;

  return {
    sessionCalculations, eventCalculations, memberLedgers,
    totalCashIn, cashInByBank, cashInByHand, totalActualCashOut, actualFundBalance,
    totalReceivable, totalPrepaidCredit, debtorsCount,
    totalCourtSpent, totalWaterSpent, totalOtherSessionSpent, totalInventorySpent, totalEventActualSpent,
    totalShuttlesBought, totalShuttlesConsumed, remainingShuttlesInStock
  };
}
