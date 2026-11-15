// ==========================================
// CORE FINANCIAL ALLOCATION ENGINE (PURE LOGIC)
// ==========================================
// Đảm bảo tổng tiền phân bổ cho các thành viên == Chính xác 100% tổng chi phí buổi đánh.
// Phần chênh lệch do làm tròn (vài đồng) được điều chỉnh minh bạch.

/** Ép mọi giá trị về số hữu hạn (chuỗi rỗng, "abc", undefined, NaN -> 0). */
export const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Làm gọn số thập phân hiển thị (tránh 29.999999 giờ). */
export const fmtNum = (v, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(toNum(v) * f) / f;
};

export const formatVND = (amount) => {
  const num = Math.round(toNum(amount));
  return num.toLocaleString('vi-VN') + ' ₫';
};

/** Ngày hiện tại theo giờ máy (tránh lệch ngày do toISOString dùng UTC – VN là UTC+7). */
export const todayLocal = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Sinh ID không trùng (Date.now().slice(-4) rất dễ trùng khi bấm nhanh). */
let uidCounter = 0;
export const uid = (prefix = '') => {
  uidCounter = (uidCounter + 1) % 1296;
  return `${prefix}${Date.now().toString(36).toUpperCase()}${uidCounter.toString(36).toUpperCase().padStart(2, '0')}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
};

/**
 * Chuẩn hoá ô nhập số:
 * - Bỏ ký tự không phải số (chặn NaN làm hỏng toàn bộ phép tính).
 * - Dấu phẩy "2,5" (bàn phím iOS tiếng Việt) -> "2.5" cho ô thập phân.
 * - Ô tiền (allowDecimal=false): "100.000" -> "100000" (người dùng hay gõ dấu chấm phân cách nghìn).
 * - Xoá số 0 đứng đầu ("05" -> "5") nhưng giữ "0." để gõ số thập phân.
 */
export const cleanNumericInput = (rawValue, { allowDecimal = true } = {}) => {
  if (rawValue === '' || rawValue === null || rawValue === undefined) return '';
  let str = String(rawValue);
  if (allowDecimal) {
    str = str.replace(/,/g, '.').replace(/[^\d.]/g, '');
    const firstDot = str.indexOf('.');
    if (firstDot !== -1) {
      str = str.slice(0, firstDot + 1) + str.slice(firstDot + 1).replace(/\./g, '');
    }
    if (str.startsWith('.')) str = '0' + str;
  } else {
    str = str.replace(/[^\d]/g, '');
  }
  if (str.length > 1 && str.startsWith('0') && !str.startsWith('0.')) {
    str = str.replace(/^0+(?=\d)/, '');
  }
  return str;
};

/**
 * Làm tròn theo phương pháp "phần dư lớn nhất" (Largest Remainder):
 * mỗi phần được làm tròn sao cho TỔNG các phần == Math.round(tổng thô) chính xác,
 * thay vì làm tròn riêng lẻ rồi dồn toàn bộ chênh lệch cho một người.
 */
export function apportion(rawValues) {
  const target = Math.round(rawValues.reduce((a, v) => a + v, 0));
  const floors = rawValues.map((v) => Math.floor(v + 1e-9));
  let remainder = target - floors.reduce((a, v) => a + v, 0);
  const order = rawValues
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floors];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) result[order[k].i] += 1;
  return result;
}

export function calculateSessionAllocation(session) {
  const participants = session.participants || [];
  const count = participants.length;

  // Tiền sân chính + các sân phát sinh thuê thêm giờ
  const baseCourtCost = toNum(session.courtCount) * toNum(session.durationHours) * toNum(session.courtPricePerHour);
  const extraCourtsCost = (session.extraCourts || []).reduce(
    (acc, ec) => acc + toNum(ec.courtCount) * toNum(ec.durationHours) * toNum(ec.pricePerHour),
    0
  );

  const hasCustomCourt = session.customCourtTotal !== null && session.customCourtTotal !== undefined && session.customCourtTotal !== '';
  const courtCost = hasCustomCourt ? toNum(session.customCourtTotal) : baseCourtCost + extraCourtsCost;

  const totalHours = participants.reduce((acc, p) => acc + toNum(p.hours), 0);
  const usePersonalShuttles = Boolean(session.enablePersonalShuttles);
  const totalPersonalShuttles = usePersonalShuttles
    ? participants.reduce((acc, p) => acc + toNum(p.personalShuttles), 0)
    : 0;
  const sharedAndDamagedShuttles = toNum(session.sharedShuttles) + toNum(session.damagedShuttles);
  const totalShuttlesUsed = totalPersonalShuttles + sharedAndDamagedShuttles;

  const unitPrice = toNum(session.shuttleUnitPrice);
  const personalShuttleCostTotal = totalPersonalShuttles * unitPrice;
  const sharedShuttleCostTotal = sharedAndDamagedShuttles * unitPrice;
  const totalShuttleCost = personalShuttleCostTotal + sharedShuttleCostTotal;

  // Nước do quỹ tài trợ: thành viên không phải trả, nhưng quỹ vẫn phải chi tiền thật
  const isWaterSponsored = session.waterAllocationMethod === 'SPONSORED';
  const waterSponsoredCost = isWaterSponsored ? toNum(session.waterTotalCost) : 0;
  const waterCost = isWaterSponsored ? 0 : toNum(session.waterTotalCost);
  const otherCost = (session.otherExpenses || []).reduce((acc, item) => acc + toNum(item.amount), 0);

  const grandTotalExpense = courtCost + totalShuttleCost + waterCost + otherCost;

  const base = {
    baseCourtCost,
    extraCourtsCost,
    courtCost,
    totalPersonalShuttles,
    sharedAndDamagedShuttles,
    totalShuttlesUsed,
    totalShuttleCost,
    waterCost,
    waterSponsoredCost,
    otherCost
  };

  if (count === 0) {
    return {
      ...base,
      totalHours: 0,
      hourlyRatePerPerson: 0,
      grandTotalExpense,
      unallocatedExpense: grandTotalExpense,
      roundingAdjustment: 0,
      memberBreakdowns: []
    };
  }

  const drinkers = participants.filter((p) => p.drinkWater);
  const waterQtyOf = (p) => toNum(p.waterQty) || 1;
  const totalWaterUnits = participants.reduce((acc, p) => acc + (p.drinkWater ? waterQtyOf(p) : 0), 0);

  // 1. Số tiền thô (chưa làm tròn) cho từng người
  const raws = participants.map((p) => {
    const hrs = toNum(p.hours);
    const shuttles = usePersonalShuttles ? toNum(p.personalShuttles) : 0;

    // A. Tiền sân
    let rawCourt;
    if (session.courtAllocationMethod === 'EQUAL') {
      rawCourt = courtCost / count;
    } else {
      rawCourt = totalHours > 0 ? (courtCost * hrs) / totalHours : courtCost / count;
    }

    // B. Tiền cầu (mặc định cầu chung chia theo giờ đánh)
    const rawPersonalShuttle = shuttles * unitPrice;
    let rawSharedShuttle = 0;
    let allocatedSharedShuttlesCount = 0;
    if (sharedAndDamagedShuttles > 0) {
      if (session.sharedShuttleMethod === 'EQUAL' || totalHours <= 0) {
        rawSharedShuttle = sharedShuttleCostTotal / count;
        allocatedSharedShuttlesCount = sharedAndDamagedShuttles / count;
      } else {
        rawSharedShuttle = (sharedShuttleCostTotal * hrs) / totalHours;
        allocatedSharedShuttlesCount = (sharedAndDamagedShuttles * hrs) / totalHours;
      }
    }
    const rawShuttle = rawPersonalShuttle + rawSharedShuttle;
    const effectiveShuttlesCount = fmtNum(shuttles + allocatedSharedShuttlesCount, 1);

    // C. Tiền nước
    let rawWater = 0;
    if (waterCost > 0) {
      if (session.waterAllocationMethod === 'EQUAL_ALL') {
        rawWater = waterCost / count;
      } else if (session.waterAllocationMethod === 'BY_QUANTITY') {
        // Không ai uống -> chia đều (trước đây trả 0 cho mọi người khiến cả khoản nước bị dồn vào 1 người)
        rawWater = totalWaterUnits > 0 ? (p.drinkWater ? (waterCost * waterQtyOf(p)) / totalWaterUnits : 0) : waterCost / count;
      } else {
        // EQUAL_DRINKERS (mặc định)
        rawWater = drinkers.length > 0 ? (p.drinkWater ? waterCost / drinkers.length : 0) : waterCost / count;
      }
    }

    // D. Chi phí khác
    let rawOther = 0;
    (session.otherExpenses || []).forEach((exp) => {
      const amt = toNum(exp.amount);
      if (exp.method === 'BY_HOURS' && totalHours > 0) {
        rawOther += (amt * hrs) / totalHours;
      } else {
        rawOther += amt / count;
      }
    });

    return { p, effectiveShuttlesCount, rawCourt, rawPersonalShuttle, rawShuttle, rawWater, rawOther };
  });

  // Làm tròn từng hạng mục bằng Largest Remainder -> mỗi hạng mục cộng lại đúng bằng tổng của nó
  const courtFees = apportion(raws.map((r) => r.rawCourt));
  const shuttleFees = apportion(raws.map((r) => r.rawShuttle));
  const waterFees = apportion(raws.map((r) => r.rawWater));
  const otherFees = apportion(raws.map((r) => r.rawOther));

  const breakdowns = raws.map((r, i) => {
    const customAdj = toNum(r.p.customAdjustment);
    const personalShuttleFee = Math.min(shuttleFees[i], Math.round(r.rawPersonalShuttle));
    return {
      ...r.p,
      effectiveShuttlesCount: r.effectiveShuttlesCount,
      courtFee: courtFees[i],
      personalShuttleFee,
      sharedShuttleFee: shuttleFees[i] - personalShuttleFee,
      shuttleFee: shuttleFees[i],
      waterFee: waterFees[i],
      otherFee: otherFees[i],
      customAdjustment: customAdj,
      roundingDiff: 0,
      totalFee: courtFees[i] + shuttleFees[i] + waterFees[i] + otherFees[i] + customAdj
    };
  });

  // 2. Đối soát cuối (chỉ còn chênh lệch khi tổng chi có phần lẻ dưới 1đ, VD 1.5 sân x giá lẻ)
  const sumAllocated = breakdowns.reduce((acc, b) => acc + b.totalFee, 0);
  const totalCustomAdj = breakdowns.reduce((acc, b) => acc + b.customAdjustment, 0);
  const expectedTotal = grandTotalExpense + totalCustomAdj;
  const diff = Math.round(expectedTotal - sumAllocated);

  if (diff !== 0) {
    // Dồn phần chênh lệch vào người đánh nhiều giờ nhất (so sánh SỐ, không so sánh chuỗi "10" < "9")
    let maxIdx = 0;
    for (let i = 1; i < breakdowns.length; i++) {
      if (toNum(breakdowns[i].hours) > toNum(breakdowns[maxIdx].hours)) maxIdx = i;
    }
    breakdowns[maxIdx].roundingDiff = diff;
    breakdowns[maxIdx].totalFee += diff;
    breakdowns[maxIdx].courtFee += diff;
  }

  return {
    ...base,
    totalHours: fmtNum(totalHours),
    hourlyRatePerPerson: totalHours > 0 ? Math.round(courtCost / totalHours) : 0,
    grandTotalExpense: expectedTotal,
    unallocatedExpense: 0,
    roundingAdjustment: diff,
    memberBreakdowns: breakdowns
  };
}

/** Phân bổ chi phí sự kiện / tiệc sau khi trừ phần quỹ tài trợ. */
export function calculateEventShares(ev) {
  const totalCost = toNum(ev.totalCost);
  const sponsored = Math.min(totalCost, Math.max(0, toNum(ev.clubSponsoredAmount)));
  const netToSplit = totalCost - sponsored;
  const participants = ev.participants || [];
  const count = participants.length;
  const shares = {};
  if (count > 0) {
    if (ev.allocationMethod === 'CUSTOM') {
      participants.forEach((p) => { shares[p.memberId] = Math.round(toNum(p.customShare)); });
    } else {
      const baseShare = Math.floor(netToSplit / count);
      const rem = netToSplit - baseShare * count;
      participants.forEach((p, idx) => {
        shares[p.memberId] = baseShare + (idx === 0 ? rem : 0);
      });
    }
  }
  return { netToSplit, sponsored, shares };
}
