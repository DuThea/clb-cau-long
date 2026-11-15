import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  LayoutGrid, Calendar, Users, Wallet, BarChart3,
  Plus, Search, CheckCircle2, AlertCircle,
  Lock, Unlock, Download, Upload, Trash2, Edit3,
  ChevronRight, ChevronLeft, RotateCcw,
  Award, Coffee, ShieldCheck, Moon, Sun,
  Sparkles, PartyPopper, Package, DollarSign, X, Check, ClipboardList, Copy
} from 'lucide-react';
import {
  calculateSessionAllocation, cleanNumericInput,
  formatVND, toNum, todayLocal, uid
} from './lib/allocation.js';
import { computeClubAnalytics } from './lib/analytics.js';
import { starterData, demoData, SEED_EVENT_ID } from './data/initialData.js';
import {
  normalizeData, migrateData, createSaver, requestPersistence, getStorageInfo,
  loadDarkMode, saveDarkMode, SCHEMA_VERSION
} from './lib/storage.js';

const fmtBytes = (b) => (b == null ? '—' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches);

// ==========================================
// DESIGN SYSTEM TOKENS (TickTick iOS Style)
// Primary: #4772FA | Accent: #FF9500 | Success: #34C759 | Danger: #FF3B30
// ==========================================

const STATUS_LABEL = { Draft: 'Nháp', Confirmed: 'Đã xác nhận', Closed: 'Đã khóa sổ' };
const MEMBER_STATUS_LABEL = { Active: 'Đang đánh', Inactive: 'Tạm nghỉ', Archived: 'Lưu trữ' };
const nowStamp = () => new Date().toLocaleString('vi-VN');
const lower = (v) => String(v ?? '').toLowerCase();
const moneyInput = (v) => cleanNumericInput(v, { allowDecimal: false });


const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); // Firefox cần phần tử nằm trong DOM
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ==========================================
// MAIN APPLICATION COMPONENT
// ==========================================
const DEFAULT_BOOT = { data: null, backend: 'local', source: 'none', newer: false };

export default function BadmintonClubManagerApp({ boot = DEFAULT_BOOT }) {
  // Dữ liệu ban đầu: đọc từ IndexedDB lúc khởi động (main.jsx); máy mới -> danh sách thành viên, chưa có tài chính
  const [initial] = useState(() => boot.data || starterData());

  const [darkMode, setDarkMode] = useState(loadDarkMode);
  const [activeTab, setActiveTab] = useState('overview');

  // Core Persistent State
  const [members, setMembers] = useState(initial.members);
  const [sessions, setSessions] = useState(initial.sessions);
  const [events, setEvents] = useState(initial.events);
  const [payments, setPayments] = useState(initial.payments);
  const [inventoryPurchases, setInventoryPurchases] = useState(initial.inventoryPurchases);
  const [ledgerAdjustments, setLedgerAdjustments] = useState(initial.ledgerAdjustments);

  // UI Navigation & Modals
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [editingMemberInSession, setEditingMemberInSession] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [modalType, setModalType] = useState(null);
  const [qaResults, setQaResults] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState('ALL');

  // Danh sách chi đánh cầu (Tổng quan)
  const [chiSessionId, setChiSessionId] = useState(null);
  const [chiFilter, setChiFilter] = useState('ALL'); // 'ALL' | 'UNPAID'
  const [chiMethod, setChiMethod] = useState('Bank Transfer');

  // Hộp thoại xác nhận trong app (thay window.confirm: không bị chặn trong iframe/PWA, giao diện đồng bộ iOS)
  const [confirmState, setConfirmState] = useState(null);
  const askConfirm = (message, onConfirm, { confirmLabel = 'Đồng ý', danger = false } = {}) =>
    setConfirmState({ message, onConfirm, confirmLabel, danger });

  // Form state cho các modal
  const [newMemberForm, setNewMemberForm] = useState({ fullName: '', nickname: '', phone: '', notes: '' });
  const [newPaymentForm, setNewPaymentForm] = useState({ memberId: '', amount: '200000', method: 'Bank Transfer', date: todayLocal(), note: 'Đóng tiền cầu' });
  const [newEventForm, setNewEventForm] = useState({ name: 'Tiệc tất niên CLB', date: todayLocal(), totalCost: '2500000', clubSponsoredAmount: '500000', participantIds: [] });
  const [newInvForm, setNewInvForm] = useState({ itemName: 'Ống cầu Hải Yến S70', quantity: '60', unitPrice: '24000' });

  const toastTimer = useRef(null);
  const showToast = (msg, type = 'success') => {
    // Huỷ timer cũ để toast mới không bị tắt sớm bởi timer của toast trước
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage({ msg, type });
    toastTimer.current = setTimeout(() => setToastMessage(null), 3200);
  };
  useEffect(() => () => toastTimer.current && clearTimeout(toastTimer.current), []);

  // ---------- Tự động lưu offline (IndexedDB, ghi gộp 400ms) ----------
  const [saveStatus, setSaveStatus] = useState({ state: 'saved' });
  const saverRef = useRef(null);
  if (!saverRef.current) saverRef.current = createSaver(boot.backend, setSaveStatus);

  useEffect(() => {
    saverRef.current.schedule({ members, sessions, events, payments, inventoryPurchases, ledgerAdjustments });
  }, [members, sessions, events, payments, inventoryPurchases, ledgerAdjustments]);

  // iOS có thể tắt app bất cứ lúc nào khi chạy nền -> ghi ngay khi app bị ẩn / đóng
  useEffect(() => {
    const flush = () => { saverRef.current.flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  // Thông báo một lần sau khi chuyển dữ liệu cũ từ localStorage sang IndexedDB
  useEffect(() => {
    if (boot.source === 'legacy' && boot.backend === 'idb') {
      showToast('Đã chuyển dữ liệu sang bộ nhớ mới (IndexedDB) – không còn giới hạn 5 MB.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Bản cập nhật app (Service Worker) ----------
  const [updateReady, setUpdateReady] = useState(() => Boolean(typeof window !== 'undefined' && window.__bcmWaitingSW));
  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener('bcm-sw-update', onUpdate);
    // Sự kiện có thể đã phát giữa lần render đầu và lúc gắn listener -> kiểm tra lại
    if (window.__bcmWaitingSW) setUpdateReady(true);
    return () => window.removeEventListener('bcm-sw-update', onUpdate);
  }, []);
  const applyUpdate = async () => {
    await saverRef.current.flush(); // lưu chắc chắn trước khi tải lại
    const worker = window.__bcmWaitingSW;
    if (!worker) { window.location.reload(); return; }
    window.__bcmApplyingUpdate = true;
    worker.postMessage('SKIP_WAITING');
  };

  // ---------- Thông tin bộ nhớ (hiển thị trong mục Backup) ----------
  const [storageInfo, setStorageInfo] = useState(null);
  const refreshStorageInfo = () => { getStorageInfo().then(setStorageInfo); };
  useEffect(() => {
    if (modalType === 'BACKUP') refreshStorageInfo();
  }, [modalType]);

  // Dark mode áp dụng cho cả <html> để vùng overscroll/nền không bị trắng
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    saveDarkMode(darkMode);
  }, [darkMode]);

  const handleUpdateMemberInfo = (memberId, updatedFields) => {
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, ...updatedFields } : m)));
  };

  const goTab = (tabId) => {
    setActiveTab(tabId);
    if (tabId !== 'sessions') setSelectedSessionId(null);
    if (tabId !== 'members') setSelectedMemberId(null);
    setEditingMemberInSession(null);
    window.scrollTo({ top: 0 });
  };

  const openSession = (id) => {
    setSelectedSessionId(id);
    setEditingMemberInSession(null);
    setActiveTab('sessions');
    window.scrollTo({ top: 0 });
  };

  // ==========================================
  // SMART SESSION GENERATOR (THÓI QUEN 2-5 BUỔI GẦN NHẤT & MẶC ĐỊNH 3 GIỜ)
  // ==========================================
  const smartHabit = useMemo(() => {
    const recentSessions = [...sessions]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 5);

    const windowSize = recentSessions.length;
    const freqMap = {};
    const waterHabitMap = {};

    recentSessions.forEach((sess) => {
      const seen = new Set();
      (sess.participants || []).forEach((p) => {
        if (seen.has(p.memberId)) return; // tránh đếm trùng nếu dữ liệu có bản ghi lặp
        seen.add(p.memberId);
        freqMap[p.memberId] = (freqMap[p.memberId] || 0) + 1;
        if (waterHabitMap[p.memberId] === undefined) waterHabitMap[p.memberId] = Boolean(p.drinkWater);
      });
    });

    const minFreq = windowSize >= 2 ? 2 : 1;
    let habitualMembers = members
      .filter((m) => m.status === 'Active' && (freqMap[m.id] || 0) >= minFreq)
      .sort((a, b) => (freqMap[b.id] || 0) - (freqMap[a.id] || 0));

    if (habitualMembers.length === 0) {
      habitualMembers = members
        .filter((m) => m.status === 'Active' && (freqMap[m.id] || 0) >= 1)
        .sort((a, b) => (freqMap[b.id] || 0) - (freqMap[a.id] || 0));
    }
    // Chưa có lịch sử buổi đánh nào (máy mới) -> gợi ý toàn bộ thành viên đang đánh
    if (habitualMembers.length === 0 && windowSize === 0) {
      habitualMembers = members.filter((m) => m.status === 'Active');
    }

    return {
      windowCount: windowSize,
      freqMap,
      buildParticipants: (startTime = '18:00', endTime = '21:00') => habitualMembers.map((m) => ({
        memberId: m.id,
        inputMode: 'DIRECT',
        startTime,
        endTime,
        hours: 3,
        personalShuttles: 0,
        drinkWater: waterHabitMap[m.id] !== undefined ? waterHabitMap[m.id] : true,
        waterQty: 1,
        customAdjustment: 0,
        habitCount: freqMap[m.id] || 0,
        note: `Thói quen: ${freqMap[m.id] || 0}/${windowSize} buổi gần nhất`
      }))
    };
  }, [sessions, members]);

  const handleCreateSmartSession = () => {
    const newId = uid('S');
    const participants = smartHabit.buildParticipants();
    const now = new Date();
    const newSess = {
      id: newId,
      date: todayLocal(now),
      title: `Buổi đánh ngày ${now.toLocaleDateString('vi-VN')}`,
      startTime: '18:00',
      endTime: '21:00',
      courtCount: 3,
      durationHours: 3,
      courtPricePerHour: 100000,
      extraCourts: [],
      customCourtTotal: null,
      courtAllocationMethod: 'BY_HOURS',
      shuttleUnitPrice: 24000,
      sharedShuttles: 20,
      damagedShuttles: 0,
      sharedShuttleMethod: 'BY_HOURS',
      enablePersonalShuttles: false,
      waterTotalCost: 0, // Mặc định 0đ – nhập theo hoá đơn thực tế sau buổi
      waterAllocationMethod: 'EQUAL_DRINKERS',
      otherExpenses: [],
      status: 'Draft',
      notes: `Smart Session: Tự động lọc ${participants.length} thành viên dựa trên thói quen ${smartHabit.windowCount} buổi gần nhất (Mặc định 3 giờ).`,
      editHistory: [
        { timestamp: nowStamp(), action: `Smart tạo buổi đánh từ thói quen ${smartHabit.windowCount} buổi gần nhất` }
      ],
      participants
    };
    setSessions((prev) => [newSess, ...prev]);
    openSession(newId);
    showToast(`Smart tạo buổi: Đã thêm ${participants.length} TV quen thuộc (Mặc định 3 giờ)!`);
  };

  // ==========================================
  // MASTER FINANCIAL & LEDGER AGGREGATION
  // ==========================================
  const clubAnalytics = useMemo(
    () => computeClubAnalytics({ members, sessions, events, payments, inventoryPurchases, ledgerAdjustments }),
    [members, sessions, events, payments, inventoryPurchases, ledgerAdjustments]
  );

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [sessions]
  );

  // ==========================================
  // AUTOMATED 15-SCENARIO QA TEST ENGINE
  // ==========================================
  const runAll15QATests = () => {
    const results = [];
    const safe = (fn, fallback = false) => { try { return fn(); } catch { return fallback; } };

    const mock20Participants = Array.from({ length: 20 }, (_, i) => ({
      memberId: `TM_${i + 1}`,
      hours: i % 3 === 0 ? 3 : i % 3 === 1 ? 2 : 1,
      personalShuttles: i === 4 ? 0 : (i % 5) + 1,
      drinkWater: i !== 5,
      waterQty: 1,
      customAdjustment: 0
    }));

    const testSession = {
      courtCount: 3, durationHours: 3, courtPricePerHour: 50000, customCourtTotal: null,
      courtAllocationMethod: 'BY_HOURS', shuttleUnitPrice: 10000, sharedShuttles: 4, damagedShuttles: 1,
      sharedShuttleMethod: 'BY_HOURS', enablePersonalShuttles: true, waterTotalCost: 95000,
      waterAllocationMethod: 'EQUAL_DRINKERS',
      otherExpenses: [{ id: '1', name: 'Gửi xe', amount: 50000, method: 'EQUAL' }],
      participants: mock20Participants
    };

    const alloc = calculateSessionAllocation(testSession);
    const sumMembers = alloc.memberBreakdowns.reduce((a, b) => a + b.totalFee, 0);

    results.push({
      id: 1, name: 'TC01: 20 người đánh, 3 sân, 3 giờ (Tổng thu == Tổng chi)',
      passed: sumMembers === alloc.grandTotalExpense && alloc.courtCost === 450000,
      detail: `Tổng chi: ${formatVND(alloc.grandTotalExpense)} | Tổng phân bổ 20 người: ${formatVND(sumMembers)}`
    });

    const p3h = alloc.memberBreakdowns.find((b) => b.hours === 3);
    const p1h = alloc.memberBreakdowns.find((b) => b.hours === 1);
    results.push({
      id: 2, name: 'TC02: Phân bổ tiền sân theo giờ đánh (1h, 2h, 3h)',
      passed: safe(() => p3h.courtFee > p1h.courtFee && Math.abs(p3h.courtFee - p1h.courtFee * 3) <= 5),
      detail: `Người 3h đóng tiền sân ${formatVND(p3h?.courtFee)} vs Người 1h đóng ${formatVND(p1h?.courtFee)}`
    });

    results.push({
      id: 3, name: 'TC03: Mỗi người sử dụng số lượng cầu khác nhau',
      passed: alloc.memberBreakdowns[0].personalShuttleFee !== alloc.memberBreakdowns[1].personalShuttleFee,
      detail: 'Cầu cá nhân tính đúng đơn giá 10.000đ/quả theo thực tế sử dụng'
    });

    results.push({
      id: 4, name: 'TC04: Phân bổ cầu dùng chung & cầu hỏng (5 quả = 50.000đ)',
      passed: alloc.sharedAndDamagedShuttles === 5 && alloc.memberBreakdowns.every((b) => b.sharedShuttleFee > 0),
      detail: '5 quả chung/hỏng đã được phân bổ tự động theo tỷ lệ giờ tham gia'
    });

    const zeroShuttleMember = alloc.memberBreakdowns[4];
    results.push({
      id: 5, name: 'TC05: Thành viên sử dụng 0 quả cầu cá nhân',
      passed: zeroShuttleMember.personalShuttleFee === 0 && zeroShuttleMember.sharedShuttleFee > 0,
      detail: `Tiền cầu cá nhân = 0đ, chỉ chịu phần cầu chung ${formatVND(zeroShuttleMember.sharedShuttleFee)}`
    });

    const noWaterMember = alloc.memberBreakdowns[5];
    results.push({
      id: 6, name: 'TC06: Thành viên tham gia nhưng không uống nước',
      passed: noWaterMember.waterFee === 0 && alloc.memberBreakdowns[0].waterFee === 5000,
      detail: 'Người không uống = 0đ, 19 người còn lại mỗi người đóng đúng 5.000đ (Tổng 95.000đ)'
    });

    // TC07-14 kiểm tra trên dữ liệu thực tế của CLB (phụ thuộc dữ liệu mẫu)
    // TC07-TC14 chạy trên bộ dữ liệu DEMO nội bộ -> kết quả ổn định, không phụ thuộc dữ liệu thật của CLB
    const demo = demoData();
    const demoAnalytics = computeClubAnalytics(demo);
    const m07Ledger = demoAnalytics.memberLedgers.M07;
    const m03Ledger = demoAnalytics.memberLedgers.M03;
    const m01Ledger = demoAnalytics.memberLedgers.M01;

    results.push({
      id: 7, name: 'TC07: Thành viên đóng tiền trước (Prepayment)',
      passed: Boolean(m01Ledger && m01Ledger.totalPaid >= 500000),
      detail: m01Ledger ? `Thành viên M01 đã nạp quỹ ${formatVND(m01Ledger.totalPaid)}, tự động khấu trừ vào buổi đánh` : 'Không tìm thấy M01 trong dữ liệu'
    });

    results.push({
      id: 8, name: 'TC08: Thành viên đóng thiếu (Ghi nhận công nợ)',
      passed: Boolean(m03Ledger && m03Ledger.debtAmount > 0),
      detail: m03Ledger ? `M03 phát sinh ${formatVND(m03Ledger.totalIncurred)}, đã đóng ${formatVND(m03Ledger.totalPaid)} -> Còn nợ ${formatVND(m03Ledger.debtAmount)}` : 'Không tìm thấy M03'
    });

    results.push({
      id: 9, name: 'TC09: Thành viên đóng thừa (Lưu số dư sang kỳ sau)',
      passed: Boolean(m07Ledger && m07Ledger.creditAmount > 0),
      detail: m07Ledger ? `M07 còn dư ${formatVND(m07Ledger.creditAmount)} trong sổ cái cá nhân` : 'Không tìm thấy M07'
    });

    const m13Ledger = demoAnalytics.memberLedgers.M13;
    results.push({
      id: 10, name: 'TC10: Thành viên nghỉ đánh nhiều tháng (Inactive)',
      passed: Boolean(m13Ledger && m13Ledger.status === 'Inactive' && m13Ledger.totalIncurred === 0),
      detail: 'Trạng thái Inactive không bị chia chi phí trong các buổi đánh mới'
    });

    const m20Ledger = demoAnalytics.memberLedgers.M20;
    results.push({
      id: 11, name: 'TC11: Lưu trữ (Archive) thành viên có lịch sử giao dịch',
      passed: Boolean(m20Ledger && m20Ledger.status === 'Archived' && m20Ledger.sessionsCount > 0),
      detail: m20Ledger ? `M20 (${m20Ledger.fullName} - ${m20Ledger.status}) vẫn bảo toàn ${m20Ledger.sessionsCount} buổi đánh và ${formatVND(m20Ledger.totalPaid)} thanh toán` : 'Không tìm thấy M20'
    });

    const closedSession = demo.sessions.find((s) => s.status === 'Closed');
    results.push({
      id: 12, name: 'TC12: Bảo vệ buổi đánh đã khóa sổ (Closed Session Lock)',
      passed: Boolean(closedSession),
      detail: closedSession ? `Buổi ${closedSession.id} đang khóa sổ, chặn chỉnh sửa nếu không mở khóa và ghi Audit Log` : 'Chưa có buổi nào khóa sổ'
    });

    // Tìm đúng sự kiện mẫu theo ID (events[0] sẽ sai ngay khi tạo sự kiện mới)
    const ev = demo.events.find((e) => e.id === SEED_EVENT_ID);
    const evCalc = ev ? demoAnalytics.eventCalculations[ev.id] : null;
    results.push({
      id: 13, name: 'TC13: Tổ chức tiệc đặc biệt cho một nhóm thành viên & Quỹ tài trợ',
      passed: Boolean(evCalc && evCalc.netToSplit === 1000000 && Object.keys(evCalc.shares).length === 5),
      detail: 'Tổng tiệc 1.200.000đ - Quỹ tài trợ 200.000đ = 1.000.000đ chia đúng cho 5 người (200.000đ/người)'
    });

    results.push({
      id: 14, name: 'TC14: Một thành viên thanh toán gộp nhiều buổi cùng lúc',
      passed: Boolean(m01Ledger && m01Ledger.sessionsCount >= 2 && m01Ledger.balance >= 0),
      detail: `Sổ cái tự động bù trừ 1 lần thanh toán cho ${m01Ledger?.sessionsCount ?? 0} buổi đánh và sự kiện`
    });

    const backupPayload = JSON.stringify({ members, sessions, events, payments, inventoryPurchases, ledgerAdjustments });
    const parsedBackup = normalizeData(JSON.parse(backupPayload));
    results.push({
      id: 15, name: 'TC15: Sao lưu và Khôi phục (Backup & Restore) toàn bộ dữ liệu',
      passed: Boolean(parsedBackup && parsedBackup.members.length === members.length && parsedBackup.sessions.length === sessions.length && parsedBackup.payments.length === payments.length),
      detail: `Serialize thành công ${new Blob([backupPayload]).size.toLocaleString('vi-VN')} bytes dữ liệu JSON không mất mát`
    });

    setQaResults(results);
    setModalType('QA_SUITE');
  };

  // ==========================================
  // EXPORT CSV & BACKUP HANDLERS
  // ==========================================
  const handleExportCSV = () => {
    const headers = 'ID,HoTen,BietDanh,TrangThai,SoBuoi,TongGio,TongCau,PhaiDong,DaDong,CongNoHienTai';
    const rows = Object.values(clubAnalytics.memberLedgers).map((m) =>
      [m.id, m.fullName, m.nickname, m.status, m.sessionsCount, m.totalHours, m.totalShuttles, m.totalIncurred, m.totalPaid, m.balance]
        .map(csvCell).join(',')
    );
    const csvContent = '﻿' + [headers, ...rows].join('\n');
    downloadBlob(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }), `BadmintonClub_Report_${todayLocal()}.csv`);
    showToast('Đã xuất file báo cáo CSV thành công!');
  };

  const handleDownloadBackup = () => {
    const data = {
      app: 'badminton-club-manager',
      schemaVersion: SCHEMA_VERSION, // dùng để migrate khi khôi phục ở phiên bản app sau này
      exportedAt: new Date().toISOString(),
      members, sessions, events, payments, inventoryPurchases, ledgerAdjustments
    };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `BCM_FullBackup_${todayLocal()}.json`);
    showToast('Đã tải xuống bản sao lưu toàn bộ dữ liệu!');
  };

  const applyData = (data) => {
    setMembers(data.members);
    setSessions(data.sessions);
    setEvents(data.events);
    setPayments(data.payments);
    setInventoryPurchases(data.inventoryPurchases);
    setLedgerAdjustments(data.ledgerAdjustments);
    setSelectedSessionId(null);
    setSelectedMemberId(null);
    setEditingMemberInSession(null);
  };

  const handleRestoreBackup = (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const migrated = migrateData(JSON.parse(event.target.result));
        if (!migrated) {
          showToast('File sao lưu không hợp lệ!', 'error');
          return;
        }
        const parsed = migrated.data;
        const newerNote = migrated.newer ? ' ⚠️ File được tạo bởi phiên bản app MỚI HƠN – một số dữ liệu có thể không hiển thị.' : '';
        askConfirm(
          `Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại bằng ${parsed.members.length} thành viên, ${parsed.sessions.length} buổi đánh, ${parsed.payments.length} thanh toán. Tiếp tục?${newerNote}`,
          () => {
            applyData(parsed);
            setModalType(null);
            showToast('Khôi phục dữ liệu thành công!');
          },
          { confirmLabel: 'Khôi phục', danger: true }
        );
      } catch {
        showToast('Lỗi đọc file Backup!', 'error');
      } finally {
        input.value = ''; // cho phép chọn lại cùng một file
      }
    };
    reader.onerror = () => { showToast('Lỗi đọc file Backup!', 'error'); input.value = ''; };
    reader.readAsText(file);
  };

  const handleResetSample = () => {
    askConfirm('Xoá TOÀN BỘ buổi đánh, khoản thu, sự kiện, kho cầu và đưa danh sách thành viên về 20 người ban đầu? Hãy tải Backup trước!', () => {
      applyData(starterData());
      setModalType(null);
      showToast('Đã xoá dữ liệu – bắt đầu lại từ danh sách thành viên ban đầu.');
    }, { confirmLabel: 'Xoá hết', danger: true });
  };

  // ==========================================
  // MODAL OPENERS (đảm bảo form luôn trỏ tới dữ liệu hợp lệ)
  // ==========================================
  const openPaymentModal = (memberId = null, amount = null) => {
    const validId = members.some((m) => m.id === memberId) ? memberId
      : members.some((m) => m.id === newPaymentForm.memberId) ? newPaymentForm.memberId
      : (members.find((m) => m.status === 'Active') || members[0])?.id || '';
    setNewPaymentForm((f) => ({
      ...f,
      memberId: validId,
      amount: amount != null ? String(amount) : f.amount,
      date: todayLocal()
    }));
    setModalType('NEW_PAYMENT');
  };

  const openEventModal = () => {
    setNewEventForm((f) => ({ ...f, date: todayLocal(), participantIds: members.filter((m) => m.status === 'Active').map((m) => m.id) }));
    setModalType('NEW_EVENT');
  };

  const deletePayment = (pay) => {
    const mem = members.find((m) => m.id === pay.memberId);
    askConfirm(`Xoá khoản thu ${formatVND(pay.amount)} của ${mem?.fullName || pay.memberId} (${pay.date})? Công nợ sẽ được tính lại.`, () => {
      setPayments((prev) => prev.filter((p) => p.id !== pay.id));
      showToast('Đã xoá khoản thu.');
    }, { confirmLabel: 'Xoá', danger: true });
  };

  const deleteEvent = (ev) => {
    askConfirm(`Xoá sự kiện "${ev.name}"? Phần chia tiền của các thành viên sẽ bị huỷ.`, () => {
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      showToast('Đã xoá sự kiện.');
    }, { confirmLabel: 'Xoá', danger: true });
  };

  const deleteInventory = (inv) => {
    askConfirm(`Xoá lô nhập kho "${inv.itemName}" (${inv.quantity} quả)?`, () => {
      setInventoryPurchases((prev) => prev.filter((i) => i.id !== inv.id));
      showToast('Đã xoá lô nhập kho.');
    }, { confirmLabel: 'Xoá', danger: true });
  };

  // ==========================================
  // DANH SÁCH CHI ĐÁNH CẦU (THU TIỀN THEO TỪNG BUỔI)
  // ==========================================
  // Trạng thái từng người trong 1 buổi:
  //  PAID    – đã có khoản thu gắn với buổi này đủ số tiền
  //  PREPAID – tổng đã đóng >= tổng phải đóng (đóng trước/dư) -> tự trừ, không cần thu thêm
  //  PARTIAL – đã thu một phần cho buổi này
  //  UNPAID  – chưa thu
  // Số tiền cần thu = min(phần còn thiếu của buổi, công nợ tổng) để không tạo số dư ảo.
  const buildChiRows = (s) => {
    const calc = clubAnalytics.sessionCalculations[s.id];
    const paidMap = {};
    payments.forEach((p) => {
      if (p.sessionId === s.id) paidMap[p.memberId] = (paidMap[p.memberId] || 0) + toNum(p.amount);
    });
    const memberOf = (id) => members.find((m) => m.id === id);
    const nameCount = {};
    calc.memberBreakdowns.forEach((b) => {
      const n = memberOf(b.memberId)?.fullName;
      if (n) nameCount[n] = (nameCount[n] || 0) + 1;
    });
    return calc.memberBreakdowns.map((b) => {
      const mem = memberOf(b.memberId);
      const ledger = clubAnalytics.memberLedgers[b.memberId];
      const paid = paidMap[b.memberId] || 0;
      const remaining = Math.max(0, b.totalFee - paid);
      const toCollect = Math.min(remaining, ledger ? ledger.debtAmount : remaining);
      let status;
      if (remaining === 0) status = 'PAID';
      else if (s.status !== 'Draft' && toCollect === 0) status = 'PREPAID';
      else status = paid > 0 ? 'PARTIAL' : 'UNPAID';
      // Trùng tên (VD 2 bạn "Bin") -> dùng biệt danh để phân biệt
      const name = mem ? (nameCount[mem.fullName] > 1 && mem.nickname ? mem.nickname : mem.fullName) : b.memberId;
      return { memberId: b.memberId, name, fee: b.totalFee, paid, remaining, toCollect, status };
    });
  };

  const collectSessionFee = (s, rows) => {
    if (s.status === 'Draft') {
      showToast('Buổi đang là Nháp – hãy Xác nhận buổi đánh trước khi thu tiền!', 'error');
      return;
    }
    const due = rows.filter((r) => (r.status === 'UNPAID' || r.status === 'PARTIAL') && r.toCollect > 0);
    if (due.length === 0) return;
    const date = todayLocal();
    const newPays = due.map((r) => ({
      id: uid('P'),
      memberId: r.memberId,
      sessionId: s.id,
      date,
      amount: r.toCollect,
      method: chiMethod,
      type: 'SessionPayment',
      note: `Thu tiền buổi ${s.date}`
    }));
    setPayments((prev) => [...newPays, ...prev]);
    const total = due.reduce((a, r) => a + r.toCollect, 0);
    showToast(due.length === 1 ? `Đã thu ${formatVND(total)} từ ${due[0].name}` : `Đã thu ${formatVND(total)} từ ${due.length} người`);
  };

  const undoSessionCollect = (s, row) => {
    askConfirm(`Huỷ ghi nhận đã thu ${formatVND(row.paid)} của ${row.name} cho buổi ${s.date}?`, () => {
      setPayments((prev) => prev.filter((p) => !(p.sessionId === s.id && p.memberId === row.memberId)));
      showToast(`Đã huỷ khoản thu của ${row.name}`);
    }, { confirmLabel: 'Huỷ khoản thu', danger: true });
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback cho http (không phải secure context) – VD mở qua IP LAN trên iPhone
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  };

  // ==========================================
  // SUB-COMPONENTS FOR EACH TAB
  // ==========================================
  const card = 'rounded-3xl bg-white dark:bg-[#1C1C1E] shadow-sm border border-slate-100 dark:border-slate-800';
  const numInputCls = 'w-full rounded-xl bg-white dark:bg-slate-700 px-2.5 py-2 text-base font-bold border border-slate-200/70 dark:border-slate-600 focus:outline-none focus:border-[#4772FA] disabled:opacity-60';

  const statusBadge = (status) => (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
      status === 'Closed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
        : status === 'Confirmed' ? 'bg-blue-500/15 text-[#4772FA]'
        : 'bg-amber-500/15 text-amber-600'
    }`}>
      {STATUS_LABEL[status] || status}
    </span>
  );

  // 1. TAB OVERVIEW
  const renderOverviewTab = () => {
    const recentSessions = sortedSessions.slice(0, 3);

    // Danh sách chi: mặc định buổi gần nhất đã xác nhận/khóa sổ
    const chiSession = sessions.find((s) => s.id === chiSessionId)
      || sortedSessions.find((s) => s.status !== 'Draft')
      || sortedSessions[0];
    const chiRows = chiSession ? buildChiRows(chiSession) : [];
    const isDue = (r) => r.status === 'UNPAID' || r.status === 'PARTIAL';
    const dueRows = chiRows.filter(isDue);
    const dueTotal = dueRows.reduce((a, r) => a + r.toCollect, 0);
    const doneCount = chiRows.length - dueRows.length;
    const chiTotal = chiRows.reduce((a, r) => a + r.fee, 0);
    const visibleRows = chiFilter === 'UNPAID' ? dueRows : chiRows;
    const gridRows = Math.max(1, Math.ceil(visibleRows.length / 4));
    const isChiDraft = chiSession?.status === 'Draft';
    const fmtShort = (n) => Math.round(toNum(n)).toLocaleString('vi-VN');
    const fmtDate = (d) => (d && d.length === 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);

    const handleCopyChi = async () => {
      if (!chiSession) return;
      const lines = [
        `Chi đánh cầu ${fmtDate(chiSession.date)} – ${chiSession.title}`,
        `Tổng: ${formatVND(chiTotal)} • ${chiRows.length} người`,
        ...chiRows.map((r, i) => `${i + 1}. ${r.name} ${fmtShort(r.fee)}${r.status === 'PAID' ? ' (đã đóng)' : r.status === 'PREPAID' ? ' (trừ tiền đóng trước)' : ''}`),
        `Còn thu: ${formatVND(dueTotal)}`
      ];
      const ok = await copyText(lines.join('\n'));
      showToast(ok ? 'Đã sao chép danh sách chi – dán vào nhóm Zalo/Messenger!' : 'Không sao chép được trên trình duyệt này', ok ? 'success' : 'error');
    };

    return (
      <div className="space-y-5 pb-28">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#4772FA] via-[#3B62E0] to-[#2848B8] p-6 text-white shadow-lg shadow-[#4772FA]/25">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-blue-100">Số dư Quỹ Thực Tế (Tiền mặt + Bank)</span>
              <h2 className={`mt-1 text-3xl font-extrabold tracking-tight ${clubAnalytics.actualFundBalance < 0 ? 'text-amber-200' : ''}`}>
                {formatVND(clubAnalytics.actualFundBalance)}
              </h2>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-md">
              <Wallet className="h-6 w-6 text-white" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-4 text-xs">
            <div>
              <span className="text-blue-100 block">Tổng thực thu (Đã đóng)</span>
              <span className="font-bold text-sm text-emerald-300">{clubAnalytics.totalCashIn > 0 ? "+" : ""}{formatVND(clubAnalytics.totalCashIn)}</span>
            </div>
            <div>
              <span className="text-blue-100 block">Tổng thực chi (Sân/Cầu/Tiệc)</span>
              <span className="font-bold text-sm text-amber-200">{clubAnalytics.totalActualCashOut > 0 ? "-" : ""}{formatVND(clubAnalytics.totalActualCashOut)}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-black/20 px-3.5 py-2 text-xs">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-300 shrink-0" />
              Công nợ chưa thu ({clubAnalytics.debtorsCount} người):
            </span>
            <span className="font-bold text-amber-300">{formatVND(clubAnalytics.totalReceivable)}</span>
          </div>
        </div>

        <div>
          <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Thao tác nhanh</h3>
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { label: 'Smart Tạo buổi', icon: Sparkles, cls: 'bg-[#4772FA]/10 text-[#4772FA]', onClick: handleCreateSmartSession },
              { label: 'Thu tiền / Quỹ', icon: DollarSign, cls: 'bg-emerald-500/10 text-emerald-600', onClick: () => openPaymentModal() },
              { label: 'Thêm TV', icon: Users, cls: 'bg-amber-500/10 text-amber-600', onClick: () => setModalType('NEW_MEMBER') },
              { label: '15 Test QA', icon: ShieldCheck, cls: 'bg-purple-500/10 text-purple-600', onClick: runAll15QATests }
            ].map(({ label, icon: Icon, cls, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="flex flex-col items-center justify-center rounded-2xl bg-white dark:bg-[#1C1C1E] p-3 shadow-sm border border-slate-100 dark:border-slate-800 active:scale-95 transition"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cls}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="mt-1.5 text-[11px] font-semibold text-center leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white dark:bg-[#1C1C1E] p-4 shadow-sm border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Tồn kho cầu</span>
              <Package className="h-4 w-4 text-[#4772FA]" />
            </div>
            <div className={`mt-1.5 text-xl font-bold ${clubAnalytics.remainingShuttlesInStock < 0 ? 'text-rose-500' : ''}`}>
              {clubAnalytics.remainingShuttlesInStock} <span className="text-xs font-normal text-slate-400">quả</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Đã mua: {clubAnalytics.totalShuttlesBought} • Đã dùng: {clubAnalytics.totalShuttlesConsumed}
            </div>
            {clubAnalytics.remainingShuttlesInStock < 0 && (
              <div className="mt-1 text-[10px] font-semibold text-rose-500">Kho âm – cần nhập thêm cầu!</div>
            )}
          </div>

          <div className="rounded-2xl bg-white dark:bg-[#1C1C1E] p-4 shadow-sm border border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Thành viên Active</span>
              <Users className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-1.5 text-xl font-bold">
              {members.filter((m) => m.status === 'Active').length} <span className="text-xs font-normal text-slate-400">/ {members.length} TV</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {members.filter((m) => m.status === 'Archived').length} lưu trữ • {members.filter((m) => m.status === 'Inactive').length} tạm nghỉ
            </div>
          </div>
        </div>

        {/* DANH SÁCH CHI ĐÁNH CẦU – lọc theo từng buổi, 4 cột xếp từ trên xuống, chạm để thu */}
        <div className="rounded-2xl bg-white dark:bg-[#1C1C1E] p-4 shadow-sm border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4 text-[#4772FA]" />
              Danh sách chi đánh cầu
            </h3>
            <button
              disabled={!chiSession || isChiDraft || dueRows.length === 0}
              onClick={() => askConfirm(
                `Thu tất cả ${formatVND(dueTotal)} từ ${dueRows.length} người chưa đóng của buổi ${fmtDate(chiSession.date)} (${chiMethod === 'Cash' ? 'Tiền mặt' : 'Chuyển khoản'})?`,
                () => collectSessionFee(chiSession, dueRows),
                { confirmLabel: 'Thu tất cả' }
              )}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm active:scale-95 disabled:bg-slate-300 dark:disabled:bg-slate-700"
            >
              Thu tất cả{dueRows.length > 0 ? ` (${dueRows.length})` : ''}
            </button>
          </div>

          {!chiSession ? (
            <p className="text-xs text-slate-400 py-3 text-center">Chưa có buổi đánh nào.</p>
          ) : (
            <div className="space-y-2.5">
              <select
                value={chiSession.id}
                onChange={(e) => { setChiSessionId(e.target.value); setChiFilter('ALL'); }}
                className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2 font-semibold border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#4772FA]"
              >
                {sortedSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtDate(s.date)} • {s.title}{s.status === 'Draft' ? ' (Nháp)' : ''}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2">
                  <span className="text-slate-400 block">Tổng chi ({chiRows.length} người)</span>
                  <b className="text-[#4772FA]">{fmtShort(chiTotal)}</b>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2">
                  <span className="text-slate-400 block">Đã đóng</span>
                  <b className="text-emerald-600">{doneCount}/{chiRows.length} người</b>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2">
                  <span className="text-slate-400 block">Còn phải thu</span>
                  <b className={dueTotal > 0 ? 'text-rose-500' : 'text-emerald-600'}>{fmtShort(dueTotal)}</b>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-bold">
                {[['ALL', `Tất cả (${chiRows.length})`], ['UNPAID', `Chưa đóng (${dueRows.length})`]].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setChiFilter(key)}
                    className={`rounded-lg px-2.5 py-1 ${chiFilter === key ? 'bg-[#4772FA] text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => setChiMethod((m) => (m === 'Cash' ? 'Bank Transfer' : 'Cash'))}
                  className="ml-auto rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-slate-600 dark:text-slate-300"
                  title="Phương thức ghi nhận khi thu"
                >
                  {chiMethod === 'Cash' ? 'Tiền mặt' : 'Chuyển khoản'}
                </button>
                <button
                  onClick={handleCopyChi}
                  className="rounded-lg bg-slate-100 dark:bg-slate-800 p-1.5 text-slate-600 dark:text-slate-300"
                  title="Sao chép danh sách chi"
                  aria-label="Sao chép danh sách chi"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>

              {isChiDraft && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                  Buổi đang là <b>Nháp</b> – số tiền là dự kiến. <button className="underline font-bold" onClick={() => openSession(chiSession.id)}>Mở buổi để Xác nhận</button> rồi mới thu tiền.
                </div>
              )}

              {visibleRows.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center">
                  {chiRows.length === 0 ? 'Buổi này chưa có thành viên.' : 'Tuyệt vời! Mọi người đã đóng đủ tiền buổi này.'}
                </p>
              ) : (
                <div
                  className="grid gap-1.5"
                  style={{
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gridTemplateRows: `repeat(${gridRows}, auto)`,
                    gridAutoFlow: 'column'
                  }}
                >
                  {visibleRows.map((r) => {
                    const cls = r.status === 'PAID'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                      : r.status === 'PREPAID'
                        ? 'bg-[#4772FA]/5 border-[#4772FA]/25 text-[#4772FA]'
                        : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700';
                    const sub = r.status === 'PREPAID' ? 'trừ tiền trước'
                      : r.status === 'PAID' ? 'đã đóng'
                      : r.toCollect < r.remaining || r.status === 'PARTIAL' ? `còn ${fmtShort(r.toCollect)}`
                      : 'chạm để thu';
                    return (
                      <button
                        key={r.memberId}
                        onClick={() => {
                          if (r.status === 'PAID' && r.paid > 0) undoSessionCollect(chiSession, r);
                          else if (r.status === 'PREPAID') showToast(`${r.name} đã đóng trước – tự trừ vào số dư, không cần thu thêm.`);
                          else if (isDue(r)) collectSessionFee(chiSession, [r]);
                        }}
                        className={`min-w-0 rounded-xl border px-1.5 py-1.5 text-left active:scale-95 transition ${cls}`}
                        title={`${r.name}: ${formatVND(r.fee)}`}
                      >
                        <div className="flex items-center gap-0.5 text-[11px] font-semibold leading-tight">
                          <span className="truncate">{r.name}</span>
                          {r.status === 'PAID' && <Check className="h-3 w-3 shrink-0" />}
                        </div>
                        <div className={`text-[12px] font-extrabold tabular-nums leading-tight ${isDue(r) ? 'text-[#1C1C1E] dark:text-white' : ''} ${r.status === 'PAID' ? 'line-through decoration-1 opacity-70' : ''}`}>
                          {fmtShort(r.fee)}
                        </div>
                        <div className={`text-[9px] leading-tight truncate ${isDue(r) ? 'text-rose-500' : 'opacity-80'}`}>{sub}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-[10px] text-slate-400">
                Chạm vào tên để ghi nhận đã thu • Chạm lại người đã đóng để huỷ • Xanh dương: đã đóng trước, tự trừ số dư.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#1C1C1E] p-4 shadow-sm border border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-[#4772FA]" />
              Buổi đánh gần đây
            </h3>
            <button onClick={() => goTab('sessions')} className="text-xs font-semibold text-[#4772FA]">
              Tất cả ({sessions.length})
            </button>
          </div>
          <div className="space-y-2.5">
            {recentSessions.length === 0 && <p className="text-xs text-slate-400 text-center py-3">Chưa có buổi đánh nào.</p>}
            {recentSessions.map((s) => {
              const calc = clubAnalytics.sessionCalculations[s.id];
              return (
                <div
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 cursor-pointer active:scale-[0.99] transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{s.date}</span>
                      {statusBadge(s.status)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {s.courtCount} sân • {s.participants.length} người • {calc.totalHours} giờ người • {calc.totalShuttlesUsed} quả cầu
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-sm text-[#4772FA]">{formatVND(calc.grandTotalExpense)}</div>
                    <ChevronRight className="h-4 w-4 text-slate-400 inline" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // 2. TAB SESSIONS
  const renderSessionsTab = () => {
    const activeSession = sessions.find((s) => s.id === selectedSessionId);

    if (activeSession) {
      const calc = clubAnalytics.sessionCalculations[activeSession.id];
      const isClosed = activeSession.status === 'Closed';
      const isDraft = activeSession.status === 'Draft';
      const extraCourts = activeSession.extraCourts || [];
      const otherExpenses = activeSession.otherExpenses || [];

      // Luôn cập nhật dựa trên state mới nhất (prev) thay vì bản chụp activeSession của lần render
      const updateActiveSession = (updater, auditNote = null) => {
        if (isClosed) {
          showToast('Buổi đánh đã khóa sổ! Hãy bấm Mở khóa trước khi chỉnh sửa.', 'error');
          return;
        }
        setSessions((prev) => prev.map((s) => {
          if (s.id !== activeSession.id) return s;
          const updated = typeof updater === 'function' ? updater(s) : { ...s, ...updater };
          if (auditNote) {
            updated.editHistory = [{ timestamp: nowStamp(), action: auditNote }, ...(s.editHistory || [])];
          }
          return updated;
        }));
      };

      const updateParticipant = (memberId, fn) => updateActiveSession((s) => ({
        ...s,
        participants: s.participants.map((p) => (p.memberId === memberId ? fn(p) : p))
      }));

      const updateExtraCourt = (ecId, field, value) => updateActiveSession((s) => ({
        ...s,
        extraCourts: (s.extraCourts || []).map((item) => (item.id === ecId ? { ...item, [field]: value } : item))
      }));

      const setStatus = (nextStatus, logMsg, toast) => {
        setSessions((prev) => prev.map((s) => (s.id !== activeSession.id ? s : {
          ...s,
          status: nextStatus,
          editHistory: [{ timestamp: nowStamp(), action: logMsg }, ...(s.editHistory || [])]
        })));
        showToast(toast);
      };

      const toggleLockSession = () => {
        if (isClosed) {
          askConfirm('Mở khóa buổi đánh đã chốt sổ? Hành động sẽ được ghi vào Audit Log.', () => {
            setStatus('Confirmed', 'Mở khóa buổi đánh để chỉnh sửa dữ liệu tài chính', 'Đã mở khóa buổi đánh (Đã ghi Audit Log)');
          }, { confirmLabel: 'Mở khóa' });
        } else {
          if (activeSession.participants.length === 0) {
            showToast('Buổi đánh chưa có thành viên nào – không thể khóa sổ!', 'error');
            return;
          }
          setStatus('Closed', 'Khóa sổ buổi đánh (Chốt công nợ)', 'Đã khóa sổ buổi đánh & cập nhật công nợ!');
        }
      };

      const deleteSession = () => {
        askConfirm(`Xoá buổi đánh "${activeSession.title}"? Công nợ phát sinh từ buổi này sẽ bị huỷ (các khoản đã thu vẫn giữ làm số dư của thành viên).`, () => {
          setSessions((prev) => prev.filter((s) => s.id !== activeSession.id));
          setSelectedSessionId(null);
          showToast('Đã xoá buổi đánh.');
        }, { confirmLabel: 'Xoá', danger: true });
      };

      const participantIds = new Set(activeSession.participants.map((p) => p.memberId));
      const addableMembers = members
        .filter((m) => m.status !== 'Archived' && !participantIds.has(m.id))
        .sort((a, b) => (smartHabit.freqMap[b.id] || 0) - (smartHabit.freqMap[a.id] || 0));

      return (
        <div className="space-y-4 pb-28">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => { setSelectedSessionId(null); setEditingMemberInSession(null); }}
              className="flex items-center gap-1 text-sm font-semibold text-[#4772FA]"
            >
              <ChevronLeft className="h-5 w-5" /> Danh sách buổi
            </button>
            <div className="flex items-center gap-2">
              {!isClosed && (
                <button onClick={deleteSession} className="rounded-xl bg-rose-500/10 p-2 text-rose-500" title="Xoá buổi đánh">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              {isDraft && (
                <button
                  onClick={() => {
                    if (activeSession.participants.length === 0) {
                      showToast('Hãy thêm thành viên trước khi xác nhận!', 'error');
                      return;
                    }
                    setStatus('Confirmed', 'Xác nhận buổi đánh (Bắt đầu tính công nợ)', 'Đã xác nhận buổi đánh – công nợ đã được ghi nhận!');
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-[#4772FA] px-3 py-1.5 text-xs font-bold text-white shadow-sm"
                >
                  <Check className="h-3.5 w-3.5" /> Xác nhận
                </button>
              )}
              <button
                onClick={toggleLockSession}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-sm transition text-white ${isClosed ? 'bg-amber-500' : 'bg-emerald-600'}`}
              >
                {isClosed ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {isClosed ? 'Mở khóa sổ' : 'Khóa sổ'}
              </button>
            </div>
          </div>

          {isDraft && (
            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-300">
              Buổi đang ở trạng thái <b>Nháp</b>: chưa tính vào công nợ, quỹ và kho cầu. Bấm <b>Xác nhận</b> khi đã chốt danh sách.
            </div>
          )}

          <div className={`${card} p-5`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  isClosed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-blue-500/15 text-[#4772FA]'
                }`}>
                  {isClosed ? <Lock className="h-3 w-3" /> : <Edit3 className="h-3 w-3" />}
                  {isClosed ? 'ĐÃ KHÓA SỔ (CLOSED)' : `ĐANG MỞ CHỈNH SỬA (${STATUS_LABEL[activeSession.status]})`}
                </span>
                <input
                  type="text"
                  disabled={isClosed}
                  value={activeSession.title}
                  onChange={(e) => updateActiveSession({ title: e.target.value })}
                  className="mt-1 block w-full bg-transparent text-base font-extrabold focus:outline-none border-b border-transparent focus:border-[#4772FA]"
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 mt-1">
                  <input
                    type="date"
                    disabled={isClosed}
                    value={activeSession.date}
                    onChange={(e) => updateActiveSession({ date: e.target.value })}
                    className="bg-transparent font-medium focus:outline-none"
                  />
                  <span className="flex items-center gap-1">
                    <input
                      type="time"
                      disabled={isClosed}
                      value={activeSession.startTime || ''}
                      onChange={(e) => updateActiveSession({ startTime: e.target.value })}
                      className="bg-transparent font-medium focus:outline-none w-[6.5rem]"
                    />
                    –
                    <input
                      type="time"
                      disabled={isClosed}
                      value={activeSession.endTime || ''}
                      onChange={(e) => updateActiveSession({ endTime: e.target.value })}
                      className="bg-transparent font-medium focus:outline-none w-[6.5rem]"
                    />
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[11px] text-slate-400 block">Tổng chi phí buổi</span>
                <span className="text-xl font-extrabold text-[#4772FA]">{formatVND(calc.grandTotalExpense)}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              {[
                ['Số người', activeSession.participants.length],
                ['Tổng giờ người', `${calc.totalHours}h`],
                ['Sân / giờ người', formatVND(calc.hourlyRatePerPerson)],
                ['Tổng cầu dùng', `${calc.totalShuttlesUsed} quả`]
              ].map(([label, val]) => (
                <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-2">
                  <span className="text-[10px] text-slate-400 block">{label}</span>
                  <span className="text-sm font-bold break-words">{val}</span>
                </div>
              ))}
            </div>
            {calc.waterSponsoredCost > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">Quỹ tài trợ tiền nước {formatVND(calc.waterSponsoredCost)} (không chia cho thành viên).</p>
            )}
          </div>

          {/* Cấu hình chi phí */}
          <div className={`${card} p-5 space-y-4`}>
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <DollarSign className="h-4 w-4 text-[#4772FA]" />
              Cấu hình Chi Phí & Phương Pháp Phân Bổ
            </h3>

            {/* 1. Tiền Sân */}
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold block">1. Tiền Sân ({formatVND(calc.courtCost)})</span>
                  {calc.extraCourtsCost > 0 && (
                    <span className="text-[11px] text-slate-400">
                      Sân chính: {formatVND(calc.baseCourtCost)} + Phát sinh: {formatVND(calc.extraCourtsCost)}
                    </span>
                  )}
                </div>
                <select
                  disabled={isClosed}
                  value={activeSession.courtAllocationMethod}
                  onChange={(e) => updateActiveSession({ courtAllocationMethod: e.target.value })}
                  className="rounded-lg bg-white dark:bg-slate-700 px-2 py-1 font-semibold border border-slate-200 dark:border-slate-600"
                >
                  <option value="BY_HOURS">Theo giờ đánh</option>
                  <option value="EQUAL">Chia đều người</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Số sân chính', 'courtCount', true],
                  ['Số giờ thuê', 'durationHours', true],
                  ['Giá/sân/giờ', 'courtPricePerHour', false]
                ].map(([label, field, decimal]) => (
                  <div key={field}>
                    <label className="text-[11px] text-slate-400 block mb-0.5">{label}</label>
                    <input
                      type="text"
                      inputMode={decimal ? 'decimal' : 'numeric'}
                      disabled={isClosed}
                      placeholder="0"
                      value={activeSession[field] ?? ''}
                      onChange={(e) => updateActiveSession({ [field]: cleanNumericInput(e.target.value, { allowDecimal: decimal }) })}
                      className={numInputCls}
                    />
                  </div>
                ))}
              </div>

              {extraCourts.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-slate-700">
                  <span className="text-[11px] font-bold text-[#4772FA] block">Sân phát sinh / Thuê thêm giờ ({extraCourts.length}):</span>
                  {extraCourts.map((ec, idx) => {
                    const subTotal = toNum(ec.courtCount) * toNum(ec.durationHours) * toNum(ec.pricePerHour);
                    return (
                      <div key={ec.id} className="rounded-xl bg-white dark:bg-slate-700/60 p-2.5 border border-blue-200/60 dark:border-slate-600 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-600 dark:text-slate-200">Đợt phát sinh #{idx + 1} ({formatVND(subTotal)})</span>
                          {!isClosed && (
                            <button
                              onClick={() => updateActiveSession((s) => ({ ...s, extraCourts: (s.extraCourts || []).filter((item) => item.id !== ec.id) }))}
                              className="text-rose-500 p-1 flex items-center gap-1 text-[11px] font-semibold"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Xoá
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            ['Số sân thêm', 'courtCount', true],
                            ['Giờ đánh thêm', 'durationHours', true],
                            ['Giá/sân/giờ', 'pricePerHour', false]
                          ].map(([label, field, decimal]) => (
                            <div key={field}>
                              <label className="text-[10px] text-slate-400 block mb-0.5">{label}</label>
                              <input
                                type="text"
                                inputMode={decimal ? 'decimal' : 'numeric'}
                                disabled={isClosed}
                                placeholder="0"
                                value={ec[field] ?? ''}
                                onChange={(e) => updateExtraCourt(ec.id, field, cleanNumericInput(e.target.value, { allowDecimal: decimal }))}
                                className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-base font-bold border border-slate-200 dark:border-slate-600 focus:outline-none focus:border-[#4772FA]"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!isClosed && (
                <button
                  onClick={() => updateActiveSession((s) => ({
                    ...s,
                    extraCourts: [
                      ...(s.extraCourts || []),
                      { id: uid('EC'), courtCount: 1, durationHours: 1, pricePerHour: toNum(s.courtPricePerHour) || 100000, note: 'Thuê thêm sân đánh thêm giờ' }
                    ]
                  }))}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#4772FA] bg-[#4772FA]/5 py-2 text-xs font-bold text-[#4772FA] active:scale-[0.99] transition"
                >
                  <Plus className="h-4 w-4" /> Thêm sân phát sinh (Thuê thêm sân / Đánh thêm giờ)
                </button>
              )}
            </div>

            {/* 2. Tiền Cầu */}
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">2. Tiền Cầu Chung ({formatVND(calc.totalShuttleCost)})</span>
                <select
                  disabled={isClosed}
                  value={activeSession.sharedShuttleMethod}
                  onChange={(e) => updateActiveSession({ sharedShuttleMethod: e.target.value })}
                  className="rounded-lg bg-white dark:bg-slate-700 px-2 py-1 font-semibold border border-slate-200 dark:border-slate-600"
                >
                  <option value="BY_HOURS">Chia theo giờ đánh</option>
                  <option value="EQUAL">Chia đều đầu người</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Tổng cầu dùng', 'sharedShuttles'],
                  ['Giá 1 quả cầu', 'shuttleUnitPrice'],
                  ['Cầu hỏng/lỗi', 'damagedShuttles']
                ].map(([label, field]) => (
                  <div key={field}>
                    <label className="text-[11px] text-slate-400 block mb-0.5">{label}</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={isClosed}
                      placeholder="0"
                      value={activeSession[field] ?? ''}
                      onChange={(e) => updateActiveSession({ [field]: moneyInput(e.target.value) })}
                      className={numInputCls}
                    />
                  </div>
                ))}
              </div>
              <div className="pt-1 text-[11px] text-slate-500">
                Tổng cầu tính phí: <b>{calc.totalShuttlesUsed} quả</b> ({activeSession.sharedShuttleMethod === 'EQUAL' ? 'Chia đều đầu người' : 'Tự động chia theo số giờ đánh từng người'})
              </div>
            </div>

            {/* 3. Nước & Phụ phí */}
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">3. Nước & Phụ Phí ({formatVND(calc.waterCost + calc.otherCost)})</span>
                <select
                  disabled={isClosed}
                  value={activeSession.waterAllocationMethod}
                  onChange={(e) => updateActiveSession({ waterAllocationMethod: e.target.value })}
                  className="rounded-lg bg-white dark:bg-slate-700 px-2 py-1 font-semibold border border-slate-200 dark:border-slate-600"
                >
                  <option value="EQUAL_DRINKERS">Chia người uống</option>
                  <option value="EQUAL_ALL">Chia tất cả</option>
                  <option value="BY_QUANTITY">Theo số chai</option>
                  <option value="SPONSORED">Quỹ tài trợ (0đ)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-0.5">Tổng tiền nước</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={isClosed}
                    placeholder="0"
                    value={activeSession.waterTotalCost ?? ''}
                    onChange={(e) => updateActiveSession({ waterTotalCost: moneyInput(e.target.value) })}
                    className={numInputCls}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-0.5 truncate">
                    Phụ phí ({otherExpenses[0]?.name || 'Gửi xe/Đồ ăn'})
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={isClosed}
                    placeholder="0"
                    value={otherExpenses[0]?.amount ?? ''}
                    onChange={(e) => {
                      const amount = moneyInput(e.target.value);
                      // Chỉ sửa khoản phụ phí đầu tiên, giữ nguyên tên/cách chia và các khoản còn lại
                      updateActiveSession((s) => {
                        const list = s.otherExpenses || [];
                        const first = list[0] || { id: uid('OE'), name: 'Chi phí phát sinh', method: 'EQUAL' };
                        return { ...s, otherExpenses: [{ ...first, amount }, ...list.slice(1)] };
                      });
                    }}
                    className={numInputCls}
                  />
                </div>
              </div>
              {otherExpenses.length > 1 && (
                <p className="text-[11px] text-slate-400">
                  + {otherExpenses.length - 1} khoản phụ phí khác: {formatVND(otherExpenses.slice(1).reduce((a, x) => a + toNum(x.amount), 0))}
                </p>
              )}
              {activeSession.waterAllocationMethod === 'BY_QUANTITY' && (
                <p className="text-[11px] text-slate-400">Chạm vào số chai bên cạnh nút “Nước” của từng thành viên để chỉnh số lượng.</p>
              )}
            </div>
          </div>

          {/* Danh sách thành viên tham gia */}
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-[#4772FA]" />
                  Thành Viên Tham Gia ({activeSession.participants.length})
                </h3>
                <p className="text-[10px] text-slate-400">Gợi ý từ 2–5 buổi gần nhất • Mặc định 3 giờ đánh</p>
              </div>
              {!isClosed && (
                <select
                  value=""
                  onChange={(e) => {
                    const mId = e.target.value;
                    if (!mId) return;
                    updateActiveSession((s) => {
                      if (s.participants.some((p) => p.memberId === mId)) return s;
                      return {
                        ...s,
                        participants: [
                          ...s.participants,
                          {
                            memberId: mId, inputMode: 'DIRECT', startTime: s.startTime, endTime: s.endTime,
                            hours: 3, personalShuttles: 0, drinkWater: true, waterQty: 1, customAdjustment: 0, note: ''
                          }
                        ]
                      };
                    });
                  }}
                  className="max-w-[45%] rounded-xl bg-[#4772FA]/10 px-2.5 py-1.5 font-bold text-[#4772FA]"
                >
                  <option value="">+ Thêm người (3h)</option>
                  {addableMembers.map((m) => {
                    const freq = smartHabit.freqMap[m.id] || 0;
                    return (
                      <option key={m.id} value={m.id}>
                        {m.fullName} {freq > 0 ? `(${freq}/${smartHabit.windowCount} buổi gần nhất)` : `(${m.nickname || m.id})`}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {!isClosed && (
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    const list = smartHabit.buildParticipants(activeSession.startTime, activeSession.endTime);
                    const apply = () => {
                      updateActiveSession({ participants: list });
                      showToast(`Đã lọc ${list.length} TV theo thói quen 2-5 buổi gần nhất (3 giờ)!`);
                    };
                    if (activeSession.participants.length > 0) {
                      askConfirm(`Thay danh sách hiện tại (${activeSession.participants.length} người) bằng ${list.length} TV theo thói quen?`, apply, { confirmLabel: 'Thay danh sách' });
                    } else {
                      apply();
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-1 rounded-xl bg-[#4772FA]/10 py-1.5 px-2.5 text-[11px] font-bold text-[#4772FA] active:scale-95 transition"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Lọc theo thói quen 2–5 buổi
                </button>
                <button
                  onClick={() => {
                    updateActiveSession((s) => ({ ...s, participants: s.participants.map((p) => ({ ...p, hours: 3 })) }));
                    showToast('Đã đặt mặc định 3 giờ cho toàn bộ danh sách!');
                  }}
                  className="rounded-xl bg-slate-100 dark:bg-slate-800 py-1.5 px-2.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 active:scale-95 transition"
                >
                  Tất cả = 3 giờ
                </button>
              </div>
            )}

            {calc.memberBreakdowns.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">Chưa có thành viên. Chọn “+ Thêm người” hoặc “Lọc theo thói quen”.</p>
            )}

            <div className="space-y-3">
              {calc.memberBreakdowns.map((b, idx) => {
                const mem = members.find((m) => m.id === b.memberId);
                const isEditingName = editingMemberInSession === b.memberId;
                const habitFreq = smartHabit.freqMap[b.memberId] || 0;

                return (
                  <div key={b.memberId} className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {isEditingName && mem ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              autoFocus
                              value={mem.fullName}
                              onChange={(e) => handleUpdateMemberInfo(b.memberId, { fullName: e.target.value })}
                              placeholder="Họ và tên"
                              className="w-full rounded-lg bg-white dark:bg-slate-700 px-2 py-1 font-bold border border-[#4772FA] focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                if (!mem.fullName.trim()) handleUpdateMemberInfo(b.memberId, { fullName: mem.nickname || mem.id });
                                setEditingMemberInSession(null);
                                showToast('Đã lưu tên thành viên!');
                              }}
                              className="rounded-lg bg-[#4772FA] px-2.5 py-1 text-xs font-bold text-white shrink-0"
                            >
                              Xong
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm truncate">
                              {idx + 1}. {mem ? mem.fullName : `${b.memberId} (đã xoá)`}
                            </span>
                            {habitFreq >= 2 && (
                              <span className="rounded-md bg-[#4772FA]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#4772FA]">
                                {habitFreq}/{smartHabit.windowCount} buổi
                              </span>
                            )}
                            {mem && (
                              <button
                                onClick={() => setEditingMemberInSession(b.memberId)}
                                className="text-slate-400 hover:text-[#4772FA] p-1"
                                title="Chỉnh sửa tên thành viên"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-extrabold text-[#4772FA]">{formatVND(b.totalFee)}</span>
                        {!isClosed && (
                          <button
                            onClick={() => updateActiveSession((s) => ({ ...s, participants: s.participants.filter((p) => p.memberId !== b.memberId) }))}
                            className="text-slate-400 hover:text-rose-500 p-1"
                            title="Bỏ khỏi buổi đánh"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center gap-2">
                      <div className="flex-1 rounded-xl bg-white dark:bg-slate-700 px-3 py-1.5 flex items-center justify-between border border-slate-200/60 dark:border-slate-600">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">Giờ đánh:</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            disabled={isClosed}
                            onClick={() => updateParticipant(b.memberId, (p) => ({ ...p, hours: Math.max(0.5, toNum(p.hours) - 0.5) }))}
                            className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-600 font-bold text-base flex items-center justify-center active:scale-95"
                          >-</button>
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={isClosed}
                            placeholder="3"
                            value={b.hours ?? ''}
                            onChange={(e) => {
                              const val = cleanNumericInput(e.target.value);
                              updateParticipant(b.memberId, (p) => ({ ...p, hours: val }));
                            }}
                            className="w-10 text-center bg-transparent font-extrabold focus:outline-none"
                          />
                          <span className="text-xs font-bold text-slate-400 -ml-1">h</span>
                          <button
                            disabled={isClosed}
                            onClick={() => updateParticipant(b.memberId, (p) => ({ ...p, hours: toNum(p.hours) + 0.5 }))}
                            className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-600 font-bold text-base flex items-center justify-center active:scale-95"
                          >+</button>
                        </div>
                      </div>

                      <button
                        disabled={isClosed}
                        onClick={() => updateParticipant(b.memberId, (p) => ({ ...p, drinkWater: !p.drinkWater, waterQty: !p.drinkWater ? (toNum(p.waterQty) || 1) : p.waterQty }))}
                        className={`shrink-0 rounded-xl py-2 px-3 text-xs font-bold flex items-center gap-1 transition ${
                          b.drinkWater
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-200/80 dark:bg-slate-700 text-slate-400 line-through'
                        }`}
                        title={b.drinkWater ? 'Có uống nước (Chạm để tắt)' : 'Không uống nước (Chạm để bật)'}
                      >
                        <Coffee className="h-3.5 w-3.5" />
                        <span>Nước</span>
                      </button>
                      {activeSession.waterAllocationMethod === 'BY_QUANTITY' && b.drinkWater && (
                        <button
                          disabled={isClosed}
                          onClick={() => updateParticipant(b.memberId, (p) => ({ ...p, waterQty: ((toNum(p.waterQty) || 1) % 5) + 1 }))}
                          className="shrink-0 rounded-xl py-2 px-2.5 text-xs font-bold bg-emerald-500/15 text-emerald-600"
                          title="Số chai (chạm để tăng)"
                        >
                          ×{toNum(b.waterQty) || 1}
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-slate-500 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
                      <span>Sân ({toNum(b.hours)}h): <b>{formatVND(b.courtFee)}</b></span>
                      <span>Cầu (~{b.effectiveShuttlesCount} quả): <b>{formatVND(b.shuttleFee)}</b></span>
                      <span>Nước & Khác: <b>{formatVND(b.waterFee + b.otherFee)}</b></span>
                    </div>
                    {b.roundingDiff !== 0 && (
                      <div className="mt-1 text-[10px] text-slate-400">* Gồm {b.roundingDiff > 0 ? '+' : ''}{b.roundingDiff}đ điều chỉnh làm tròn để tổng thu = tổng chi.</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {activeSession.editHistory && activeSession.editHistory.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-[#1C1C1E] p-4 shadow-sm border border-slate-100 dark:border-slate-800">
              <h4 className="text-xs font-bold uppercase text-slate-400 mb-2">Lịch sử Khóa sổ & Chỉnh sửa (Audit Trail)</h4>
              <div className="space-y-1 text-xs text-slate-500">
                {activeSession.editHistory.map((h, i) => (
                  <div key={i}>• <b>{h.timestamp}:</b> {h.action}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold">Quản Lý Buổi Đánh</h2>
            <p className="text-xs text-slate-400">Tự động gợi ý người đánh từ 2–5 buổi gần nhất (3 giờ)</p>
          </div>
          <button
            onClick={handleCreateSmartSession}
            className="flex items-center gap-1 rounded-xl bg-[#4772FA] px-3.5 py-2 text-xs font-bold text-white shadow-sm active:scale-95 shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" /> Smart Tạo buổi
          </button>
        </div>

        <div className="space-y-3">
          {sortedSessions.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Chưa có buổi đánh nào.</p>}
          {sortedSessions.map((s) => {
            const calc = clubAnalytics.sessionCalculations[s.id];
            return (
              <div key={s.id} onClick={() => openSession(s.id)} className={`${card} p-4 cursor-pointer active:scale-[0.99] transition`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm">{s.date}</span>
                    {statusBadge(s.status)}
                  </div>
                  <span className="font-extrabold text-base text-[#4772FA]">{formatVND(calc.grandTotalExpense)}</span>
                </div>
                <div className="mt-1 font-semibold text-xs">{s.title}</div>
                <div className="mt-2.5 grid grid-cols-4 gap-2 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-2.5 text-center text-[11px]">
                  <div><span className="text-slate-400 block">Số sân</span><b>{s.courtCount} sân</b></div>
                  <div><span className="text-slate-400 block">Thành viên</span><b>{s.participants.length} người</b></div>
                  <div><span className="text-slate-400 block">Tổng giờ</span><b>{calc.totalHours}h</b></div>
                  <div><span className="text-slate-400 block">Cầu dùng</span><b>{calc.totalShuttlesUsed} quả</b></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 3. TAB MEMBERS
  const renderMembersTab = () => {
    const selectedMemberLedger = selectedMemberId ? clubAnalytics.memberLedgers[selectedMemberId] : null;

    if (selectedMemberLedger) {
      const m = selectedMemberLedger;
      // Thành viên có trong BẤT KỲ buổi nào (kể cả Nháp), sự kiện, thanh toán -> không được xoá cứng
      const hasAnyRecord =
        sessions.some((s) => s.participants.some((p) => p.memberId === m.id)) ||
        events.some((e) => (e.participants || []).some((p) => p.memberId === m.id)) ||
        payments.some((p) => p.memberId === m.id) ||
        ledgerAdjustments.some((a) => a.memberId === m.id);

      return (
        <div className="space-y-4 pb-28">
          <button onClick={() => setSelectedMemberId(null)} className="flex items-center gap-1 text-sm font-semibold text-[#4772FA]">
            <ChevronLeft className="h-5 w-5" /> Danh sách thành viên
          </button>

          <div className={`${card} p-5 space-y-3`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                m.status === 'Active' ? 'bg-emerald-500/15 text-emerald-600' :
                m.status === 'Inactive' ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-500/15 text-slate-500'
              }`}>
                {MEMBER_STATUS_LABEL[m.status] || m.status}
              </span>

              <div className="flex gap-1.5">
                <select
                  value={m.status}
                  onChange={(e) => {
                    const nextStatus = e.target.value;
                    handleUpdateMemberInfo(m.id, { status: nextStatus });
                    showToast(`Đã chuyển trạng thái sang ${MEMBER_STATUS_LABEL[nextStatus]} (Bảo toàn lịch sử)`);
                  }}
                  className="rounded-xl bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 font-bold"
                >
                  <option value="Active">Active (Đang đánh)</option>
                  <option value="Inactive">Inactive (Tạm nghỉ)</option>
                  <option value="Archived">Archived (Lưu trữ)</option>
                </select>
                <button
                  onClick={() => {
                    if (hasAnyRecord) {
                      handleUpdateMemberInfo(m.id, { status: 'Archived' });
                      showToast('Thành viên đã có dữ liệu buổi đánh/thanh toán! Đã chuyển sang Lưu trữ để bảo vệ sổ cái.', 'error');
                    } else {
                      askConfirm(`Xoá vĩnh viễn thành viên ${m.fullName}?`, () => {
                        setMembers((prev) => prev.filter((item) => item.id !== m.id));
                        setSelectedMemberId(null);
                        showToast('Đã xóa thành viên chưa phát sinh giao dịch.');
                      }, { confirmLabel: 'Xoá', danger: true });
                    }
                  }}
                  className="rounded-xl bg-rose-500/10 p-2 text-rose-500"
                  title="Xóa hoặc Lưu trữ"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-0.5">Họ và tên thành viên (Chạm để sửa)</label>
                <input
                  type="text"
                  value={m.fullName}
                  onChange={(e) => handleUpdateMemberInfo(m.id, { fullName: e.target.value })}
                  onBlur={(e) => { if (!e.target.value.trim()) handleUpdateMemberInfo(m.id, { fullName: m.nickname || m.id }); }}
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2 font-extrabold border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#4772FA]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-0.5">Biệt danh</label>
                  <input
                    type="text"
                    value={m.nickname}
                    onChange={(e) => handleUpdateMemberInfo(m.id, { nickname: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2 font-semibold border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#4772FA]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-400 block mb-0.5">Số điện thoại</label>
                  <input
                    type="tel"
                    value={m.phone || ''}
                    onChange={(e) => handleUpdateMemberInfo(m.id, { phone: e.target.value })}
                    placeholder="Chưa cập nhật"
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2 font-semibold border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#4772FA]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-0.5">Ghi chú</label>
                <input
                  type="text"
                  value={m.notes || ''}
                  onChange={(e) => handleUpdateMemberInfo(m.id, { notes: e.target.value })}
                  placeholder="Thêm ghi chú cho thành viên..."
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-800/80 px-3 py-2 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#4772FA]"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3 text-center">
              <div>
                <span className="text-[10px] text-slate-400 block">Tổng phải đóng</span>
                <span className="text-sm font-bold">{formatVND(m.totalIncurred)}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Đã thanh toán</span>
                <span className="text-sm font-bold text-emerald-600">{formatVND(m.totalPaid)}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">{m.balance < 0 ? 'Công nợ hiện tại' : 'Số dư đóng trước'}</span>
                <span className={`text-sm font-extrabold ${m.balance < 0 ? 'text-rose-500' : 'text-[#4772FA]'}`}>{formatVND(Math.abs(m.balance))}</span>
              </div>
            </div>

            <button
              onClick={() => openPaymentModal(m.id, m.debtAmount > 0 ? m.debtAmount : null)}
              className="w-full rounded-2xl bg-emerald-600 py-2.5 text-xs font-bold text-white flex items-center justify-center gap-1.5"
            >
              <DollarSign className="h-4 w-4" /> {m.debtAmount > 0 ? `Thu tiền (đang nợ ${formatVND(m.debtAmount)})` : 'Ghi nhận đóng tiền / nạp quỹ'}
            </button>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-2">
                <span className="text-slate-400 block">Số buổi đánh</span>
                <span className="font-bold">{m.sessionsCount} buổi</span>
              </div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-2">
                <span className="text-slate-400 block">Tổng giờ đánh</span>
                <span className="font-bold">{m.totalHours} giờ</span>
              </div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-2">
                <span className="text-slate-400 block">Cầu phân bổ</span>
                <span className="font-bold">{m.totalShuttles} quả</span>
              </div>
            </div>
          </div>

          <div className={`${card} p-4`}>
            <h3 className="text-sm font-bold mb-2.5">Lịch sử tham gia buổi đánh ({m.sessionHistory.length})</h3>
            <div className="space-y-2">
              {m.sessionHistory.length === 0 && <p className="text-xs text-slate-400">Chưa có buổi đánh đã xác nhận.</p>}
              {m.sessionHistory.map((sh) => (
                <div
                  key={sh.sessionId}
                  onClick={() => openSession(sh.sessionId)}
                  className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-xs cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="font-bold truncate">{sh.date} - {sh.title}</div>
                    <div className="text-slate-400">{sh.hours} giờ • {sh.shuttles} quả cầu • {STATUS_LABEL[sh.status]}</div>
                  </div>
                  <div className="font-bold text-[#4772FA] shrink-0">{formatVND(sh.totalFee)}</div>
                </div>
              ))}
            </div>
          </div>

          {m.eventHistory.length > 0 && (
            <div className={`${card} p-4`}>
              <h3 className="text-sm font-bold mb-2.5">Sự kiện / Tiệc ({m.eventHistory.length})</h3>
              <div className="space-y-2">
                {m.eventHistory.map((eh) => (
                  <div key={eh.eventId} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-bold truncate">{eh.name}</div>
                      <div className="text-slate-400">{eh.date}</div>
                    </div>
                    <div className="font-bold text-purple-500 shrink-0">{formatVND(eh.fee)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`${card} p-4`}>
            <h3 className="text-sm font-bold mb-2.5">Lịch sử đóng tiền ({m.paymentHistory.length})</h3>
            <div className="space-y-2">
              {m.paymentHistory.length === 0 && <p className="text-xs text-slate-400">Chưa có khoản thu nào.</p>}
              {m.paymentHistory.map((ph) => (
                <div key={ph.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-bold">{ph.date} ({ph.method === 'Cash' ? 'Tiền mặt' : 'Chuyển khoản'})</div>
                    <div className="text-slate-400 truncate">{ph.note}</div>
                  </div>
                  <div className="font-bold text-emerald-600 shrink-0">+{formatVND(ph.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    const q = lower(memberSearch.trim());
    const filteredMembers = Object.values(clubAnalytics.memberLedgers).filter((m) => {
      const matchSearch = !q || lower(m.fullName).includes(q) || lower(m.nickname).includes(q) || lower(m.phone).includes(q);
      if (!matchSearch) return false;
      if (memberFilter === 'ALL') return true;
      if (memberFilter === 'DEBT') return m.debtAmount > 0;
      return m.status === memberFilter;
    });

    return (
      <div className="space-y-4 pb-28">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold">Thành Viên ({members.length})</h2>
            <p className="text-xs text-slate-400">Hỗ trợ cơ chế Archive bảo toàn lịch sử tài chính</p>
          </div>
          <button onClick={() => setModalType('NEW_MEMBER')} className="rounded-xl bg-[#4772FA] px-3.5 py-2 text-xs font-bold text-white shadow-sm">
            + Thêm TV
          </button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="Tìm tên, biệt danh, SĐT..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full rounded-xl bg-white dark:bg-[#1C1C1E] pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-[#4772FA]"
            />
          </div>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="rounded-xl bg-white dark:bg-[#1C1C1E] px-3 py-2 font-semibold border border-slate-200 dark:border-slate-800"
          >
            <option value="ALL">Tất cả</option>
            <option value="Active">Active</option>
            <option value="DEBT">Đang nợ</option>
            <option value="Inactive">Tạm nghỉ</option>
            <option value="Archived">Đã lưu trữ</option>
          </select>
        </div>

        <div className="space-y-2.5">
          {filteredMembers.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Không tìm thấy thành viên phù hợp.</p>}
          {filteredMembers.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedMemberId(m.id)}
              className="flex items-center justify-between gap-2 rounded-2xl bg-white dark:bg-[#1C1C1E] p-3.5 shadow-sm border border-slate-100 dark:border-slate-800 cursor-pointer active:scale-[0.99] transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-sm ${
                  m.status === 'Active' ? 'bg-[#4772FA]/10 text-[#4772FA]' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                }`}>
                  {(m.fullName.trim().split(/\s+/).pop() || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-sm truncate">{m.fullName}</span>
                    {m.status !== 'Active' && (
                      <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 shrink-0">
                        {MEMBER_STATUS_LABEL[m.status]}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 truncate">
                    {m.nickname} • {m.sessionsCount} buổi • {m.totalHours}h • {m.totalShuttles} cầu
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                {m.balance < 0 ? (
                  <span className="block text-xs font-bold text-rose-500">Nợ {formatVND(m.debtAmount)}</span>
                ) : m.balance > 0 ? (
                  <span className="block text-xs font-bold text-emerald-600">Dư +{formatVND(m.creditAmount)}</span>
                ) : (
                  <span className="block text-xs font-semibold text-slate-400">Đã tất toán</span>
                )}
                <span className="text-[10px] text-slate-400">Chi tiết &rarr;</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 4. TAB FINANCE
  const renderFinanceTab = () => {
    const sortedPayments = [...payments].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return (
      <div className="space-y-5 pb-28">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold">Tài Chính & Sổ Cái</h2>
            <p className="text-xs text-slate-400">Thanh toán, sự kiện đặc biệt & kho cầu</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => openPaymentModal()} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm">+ Thu</button>
            <button onClick={openEventModal} className="rounded-xl bg-[#4772FA] px-3 py-2 text-xs font-bold text-white shadow-sm">+ Sự kiện</button>
          </div>
        </div>

        <div className={`${card} p-5 space-y-3`}>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Phân tách dòng tiền minh bạch (Cashflow vs Accrual)</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3">
              <span className="text-slate-400 block">Chuyển khoản (Bank)</span>
              <span className="text-sm font-bold text-[#4772FA]">{formatVND(clubAnalytics.cashInByBank)}</span>
            </div>
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3">
              <span className="text-slate-400 block">Tiền mặt (Cash)</span>
              <span className="text-sm font-bold text-emerald-600">{formatVND(clubAnalytics.cashInByHand)}</span>
            </div>
            <div className="rounded-2xl bg-rose-500/5 border border-rose-500/20 p-3">
              <span className="text-rose-500 block">Tổng Công Nợ Phải Thu</span>
              <span className="text-sm font-extrabold text-rose-500">{formatVND(clubAnalytics.totalReceivable)}</span>
            </div>
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/20 p-3">
              <span className="text-emerald-600 block">Tiền TV Đóng Dư (Kỳ sau)</span>
              <span className="text-sm font-extrabold text-emerald-600">{formatVND(clubAnalytics.totalPrepaidCredit)}</span>
            </div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Package className="h-4 w-4 text-[#4772FA]" /> Quản Lý Kho Cầu Lông
              </h3>
              <p className="text-[11px] text-slate-400">Tách biệt tiền mua cầu nhập kho và số cầu tiêu thụ từng buổi</p>
            </div>
            <button onClick={() => setModalType('NEW_INVENTORY')} className="rounded-xl bg-[#4772FA]/10 px-3 py-1.5 text-xs font-bold text-[#4772FA] shrink-0">
              + Nhập kho
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5">
              <span className="text-slate-400 block">Tổng mua vào</span>
              <span className="font-bold text-sm">{clubAnalytics.totalShuttlesBought} quả</span>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5">
              <span className="text-slate-400 block">Đã dùng</span>
              <span className="font-bold text-sm text-amber-600">{clubAnalytics.totalShuttlesConsumed} quả</span>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5">
              <span className="text-slate-400 block">Tồn kho</span>
              <span className={`font-bold text-sm ${clubAnalytics.remainingShuttlesInStock < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{clubAnalytics.remainingShuttlesInStock} quả</span>
            </div>
          </div>
          {inventoryPurchases.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 text-xs py-2 border-t border-slate-100 dark:border-slate-800">
              <div className="min-w-0">
                <div className="font-semibold truncate">{inv.itemName}</div>
                <div className="text-slate-400">{inv.date} • {inv.quantity} quả x {formatVND(inv.unitPrice)}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="font-bold">{formatVND(inv.totalCost)}</span>
                <button onClick={() => deleteInventory(inv)} className="p-1 text-slate-400 hover:text-rose-500" title="Xoá"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold flex items-center gap-1.5 mb-3">
            <PartyPopper className="h-4 w-4 text-amber-500" /> Sự Kiện Đặc Biệt & Liên Hoan ({events.length})
          </h3>
          <div className="space-y-3">
            {events.length === 0 && <p className="text-xs text-slate-400">Chưa có sự kiện nào.</p>}
            {events.map((ev) => {
              const evCalc = clubAnalytics.eventCalculations[ev.id];
              const perHead = ev.participants.length ? Math.floor(evCalc.netToSplit / ev.participants.length) : 0;
              return (
                <div key={ev.id} className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm">{ev.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-extrabold text-[#4772FA]">{formatVND(ev.totalCost)}</span>
                      <button onClick={() => deleteEvent(ev)} className="p-1 text-slate-400 hover:text-rose-500" title="Xoá"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                  <div className="text-slate-500">
                    Ngày: {ev.date} • Quỹ tài trợ: <b>{formatVND(evCalc.sponsored)}</b> • Còn lại chia {ev.participants.length} người: <b>{formatVND(evCalc.netToSplit)}</b>
                    {ev.allocationMethod !== 'CUSTOM' && ev.participants.length > 0 && <> (~{formatVND(perHead)}/người)</>}
                  </div>
                  <div className="text-slate-400 truncate">
                    {ev.participants.map((p) => members.find((m) => m.id === p.memberId)?.fullName || p.memberId).join(', ')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold mb-3">Lịch Sử Thanh Toán ({payments.length})</h3>
          <div className="space-y-2.5">
            {sortedPayments.length === 0 && <p className="text-xs text-slate-400">Chưa có khoản thu nào.</p>}
            {sortedPayments.map((p) => {
              const mem = members.find((m) => m.id === p.memberId);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-bold">{mem ? mem.fullName : p.memberId}</div>
                    <div className="text-slate-400 truncate">{p.date} • {p.method === 'Cash' ? 'Tiền mặt' : 'Chuyển khoản'} • {p.note}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="font-extrabold text-emerald-600">+{formatVND(p.amount)}</span>
                    <button onClick={() => deletePayment(p)} className="p-1 text-slate-400 hover:text-rose-500" title="Xoá"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // 5. TAB REPORTS
  const renderReportsTab = () => {
    const ledgers = Object.values(clubAnalytics.memberLedgers);
    const sortedByHours = [...ledgers].filter((m) => m.totalHours > 0).sort((a, b) => b.totalHours - a.totalHours).slice(0, 5);
    const sortedByShuttles = [...ledgers].filter((m) => m.totalShuttles > 0).sort((a, b) => b.totalShuttles - a.totalShuttles).slice(0, 5);

    const categories = [
      { label: 'Tiền thuê sân', amount: clubAnalytics.totalCourtSpent, color: 'bg-[#4772FA]' },
      { label: 'Tiền mua cầu lông', amount: clubAnalytics.totalInventorySpent, color: 'bg-amber-500' },
      { label: 'Tiệc & Sự kiện đặc biệt', amount: clubAnalytics.totalEventActualSpent, color: 'bg-purple-500' },
      { label: 'Nước uống & Phụ phí', amount: clubAnalytics.totalWaterSpent + clubAnalytics.totalOtherSessionSpent, color: 'bg-emerald-500' }
    ];
    const totalCostAllCategories = categories.reduce((a, c) => a + c.amount, 0);

    return (
      <div className="space-y-5 pb-28">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold">Báo Cáo & Lưu Trữ</h2>
            <p className="text-xs text-slate-400">Thống kê chi phí, xếp hạng & Backup Offline</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={handleExportCSV} className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={() => setModalType('BACKUP')} className="flex items-center gap-1 rounded-xl bg-[#4772FA] px-3 py-2 text-xs font-bold text-white">
              <Upload className="h-3.5 w-3.5" /> Backup
            </button>
          </div>
        </div>

        <div className={`${card} p-5 space-y-3`}>
          <h3 className="text-sm font-bold">Cơ Cấu Chi Phí Toàn Nhóm ({formatVND(totalCostAllCategories)})</h3>
          {categories.map((item) => {
            const pct = totalCostAllCategories > 0 ? (item.amount / totalCostAllCategories) * 100 : 0;
            return (
              <div key={item.label} className="space-y-1 text-xs">
                <div className="flex justify-between gap-2 font-semibold">
                  <span>{item.label} ({Math.round(pct)}%)</span>
                  <span>{formatVND(item.amount)}</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className={`h-full ${item.color}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className={`${card} p-4`}>
            <h3 className="text-xs font-bold uppercase text-slate-400 mb-3 flex items-center gap-1.5">
              <Award className="h-4 w-4 text-amber-500" /> Top Thành Viên Đánh Nhiều Giờ Nhất
            </h3>
            <div className="space-y-2.5">
              {sortedByHours.length === 0 && <p className="text-xs text-slate-400">Chưa có dữ liệu.</p>}
              {sortedByHours.map((m, i) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold truncate">{i + 1}. {m.fullName}</span>
                  <span className="font-bold text-[#4772FA] shrink-0">{m.totalHours} giờ ({m.sessionsCount} buổi)</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`${card} p-4`}>
            <h3 className="text-xs font-bold uppercase text-slate-400 mb-3 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-purple-500" /> Top Sử Dụng Cầu Nhiều Nhất
            </h3>
            <div className="space-y-2.5">
              {sortedByShuttles.length === 0 && <p className="text-xs text-slate-400">Chưa có dữ liệu.</p>}
              {sortedByShuttles.map((m, i) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold truncate">{i + 1}. {m.fullName}</span>
                  <span className="font-bold text-amber-600 shrink-0">{m.totalShuttles} quả</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ==========================================
  // MODALS
  // ==========================================
  const modalInput = 'w-full rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5 font-semibold focus:outline-none focus:ring-2 focus:ring-[#4772FA]/40';
  const MODAL_TITLES = {
    NEW_MEMBER: 'Thêm Thành Viên Mới',
    NEW_PAYMENT: 'Ghi Nhận Đóng Tiền / Nạp Quỹ',
    NEW_EVENT: 'Tạo Sự Kiện / Liên Hoan Nhóm',
    NEW_INVENTORY: 'Nhập Kho Cầu Lông Mới',
    BACKUP: 'Sao Lưu & Khôi Phục Dữ Liệu',
    QA_SUITE: 'Báo Cáo 15 Kịch Bản Kiểm Thử QA'
  };

  const eventNet = Math.max(0, toNum(newEventForm.totalCost) - toNum(newEventForm.clubSponsoredAmount));
  const eventCount = newEventForm.participantIds.length;

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#F4F6FA] dark:bg-[#0F1015] text-[#1C1C1E] dark:text-[#F2F2F7] font-sans transition-colors">
        <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/85 dark:bg-[#1C1C1E]/85 border-b border-slate-200/70 dark:border-slate-800 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="mx-auto max-w-md flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4772FA] text-white font-black shadow-sm shadow-[#4772FA]/30">B</div>
              <div>
                <h1 className="text-sm font-extrabold tracking-tight leading-none">Badminton Manager</h1>
                <span className="text-[10px] font-medium text-slate-400">iOS Native Edition • Offline-First</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={runAll15QATests} className="rounded-xl bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                QA Check
              </button>
              <button
                onClick={() => setDarkMode((d) => !d)}
                className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-300"
                aria-label="Đổi giao diện sáng/tối"
              >
                {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </header>

        {/* Cảnh báo cố định (không tự tắt như toast) */}
        {(saveStatus.state === 'error' || updateReady || boot.newer) && (
          <div className="mx-auto max-w-md px-4 pt-3 space-y-2">
            {saveStatus.state === 'error' && (
              <div role="alert" className="rounded-2xl bg-rose-600 px-3.5 py-2.5 text-xs text-white shadow-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="font-semibold">Chưa lưu được dữ liệu vào máy! Các thay đổi gần đây có thể mất khi đóng app. Hãy Thử lại hoặc tải Backup ngay.</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => saverRef.current.retry()} className="flex-1 rounded-xl bg-white/20 py-1.5 font-bold">Thử lại</button>
                  <button onClick={handleDownloadBackup} className="flex-1 rounded-xl bg-white py-1.5 font-bold text-rose-600">Tải Backup</button>
                </div>
              </div>
            )}
            {updateReady && (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#4772FA] px-3.5 py-2.5 text-xs text-white shadow-lg">
                <span className="font-semibold">Đã có phiên bản mới của app.</span>
                <button onClick={applyUpdate} className="shrink-0 rounded-xl bg-white px-3 py-1.5 font-bold text-[#4772FA]">Cập nhật</button>
              </div>
            )}
            {boot.newer && (
              <div className="rounded-2xl bg-amber-500/15 border border-amber-500/40 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                Dữ liệu trên máy được tạo bởi phiên bản app mới hơn bản đang chạy. Hãy cập nhật app trước khi chỉnh sửa để tránh mất dữ liệu.
              </div>
            )}
          </div>
        )}

        {toastMessage && (
          <div className="fixed top-16 inset-x-0 z-[60] mx-auto max-w-sm px-4 pointer-events-none" role="status">
            <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-bold text-white shadow-xl ${
              toastMessage.type === 'error' ? 'bg-rose-600' : 'bg-slate-900 dark:bg-[#4772FA]'
            }`}>
              {toastMessage.type === 'error' ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
              <span>{toastMessage.msg}</span>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-md px-4 pt-4">
          {activeTab === 'overview' && renderOverviewTab()}
          {activeTab === 'sessions' && renderSessionsTab()}
          {activeTab === 'members' && renderMembersTab()}
          {activeTab === 'finance' && renderFinanceTab()}
          {activeTab === 'reports' && renderReportsTab()}
        </main>

        {modalType && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setModalType(null); }}
          >
            <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1C1C1E] p-5 shadow-2xl max-h-[85vh] overflow-y-auto space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="font-extrabold text-base">{MODAL_TITLES[modalType]}</h3>
                <button onClick={() => setModalType(null)} className="rounded-full p-1 text-slate-400" aria-label="Đóng">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {modalType === 'NEW_MEMBER' && (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Họ và tên *</label>
                    <input type="text" placeholder="VD: Nguyễn Hải Đăng" value={newMemberForm.fullName}
                      onChange={(e) => setNewMemberForm({ ...newMemberForm, fullName: e.target.value })} className={modalInput} />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Biệt danh</label>
                    <input type="text" placeholder="VD: Đăng Astrox" value={newMemberForm.nickname}
                      onChange={(e) => setNewMemberForm({ ...newMemberForm, nickname: e.target.value })} className={modalInput} />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Số điện thoại</label>
                    <input type="tel" placeholder="090..." value={newMemberForm.phone}
                      onChange={(e) => setNewMemberForm({ ...newMemberForm, phone: e.target.value })} className={modalInput} />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Ghi chú</label>
                    <input type="text" value={newMemberForm.notes}
                      onChange={(e) => setNewMemberForm({ ...newMemberForm, notes: e.target.value })} className={modalInput} />
                  </div>
                  <button
                    onClick={() => {
                      const fullName = newMemberForm.fullName.trim();
                      if (!fullName) { showToast('Vui lòng nhập họ tên!', 'error'); return; }
                      const nickname = newMemberForm.nickname.trim() || fullName.split(/\s+/).pop();
                      const save = () => {
                        const newM = {
                          id: uid('M'),
                          fullName,
                          nickname,
                          phone: newMemberForm.phone.trim(),
                          joinDate: todayLocal(),
                          status: 'Active',
                          notes: newMemberForm.notes.trim()
                        };
                        setMembers((prev) => [newM, ...prev]);
                        setNewMemberForm({ fullName: '', nickname: '', phone: '', notes: '' });
                        setModalType(null);
                        showToast(`Đã thêm thành viên ${newM.fullName}`);
                      };
                      if (members.some((m) => lower(m.fullName) === lower(fullName) && lower(m.nickname) === lower(nickname))) {
                        askConfirm(`Đã có thành viên "${fullName}" (${nickname}). Vẫn thêm?`, save, { confirmLabel: 'Vẫn thêm' });
                      } else {
                        save();
                      }
                    }}
                    className="w-full rounded-2xl bg-[#4772FA] py-3 font-bold text-white"
                  >
                    Lưu Thành Viên
                  </button>
                </div>
              )}

              {modalType === 'NEW_PAYMENT' && (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Chọn thành viên</label>
                    <select
                      value={newPaymentForm.memberId}
                      onChange={(e) => setNewPaymentForm({ ...newPaymentForm, memberId: e.target.value })}
                      className={modalInput}
                    >
                      {members.map((m) => {
                        const l = clubAnalytics.memberLedgers[m.id];
                        return (
                          <option key={m.id} value={m.id}>
                            {m.fullName}{m.nickname && m.nickname !== m.fullName ? ` (${m.nickname})` : ''} — {l.balance < 0 ? `Nợ ${formatVND(l.debtAmount)}` : `Dư ${formatVND(l.creditAmount)}`}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Số tiền đóng (VNĐ)</label>
                      <input type="text" inputMode="numeric" placeholder="Nhập số tiền..." value={newPaymentForm.amount}
                        onChange={(e) => setNewPaymentForm({ ...newPaymentForm, amount: moneyInput(e.target.value) })} className={modalInput} />
                      <span className="text-[10px] text-slate-400">{formatVND(newPaymentForm.amount)}</span>
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Ngày đóng</label>
                      <input type="date" value={newPaymentForm.date}
                        onChange={(e) => setNewPaymentForm({ ...newPaymentForm, date: e.target.value })} className={modalInput} />
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Phương thức</label>
                    <select value={newPaymentForm.method} onChange={(e) => setNewPaymentForm({ ...newPaymentForm, method: e.target.value })} className={modalInput}>
                      <option value="Bank Transfer">Chuyển khoản ngân hàng</option>
                      <option value="Cash">Tiền mặt</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Ghi chú</label>
                    <input type="text" value={newPaymentForm.note}
                      onChange={(e) => setNewPaymentForm({ ...newPaymentForm, note: e.target.value })} className={modalInput} />
                  </div>
                  <button
                    onClick={() => {
                      const amount = toNum(newPaymentForm.amount);
                      if (amount <= 0) { showToast('Số tiền phải lớn hơn 0!', 'error'); return; }
                      if (!members.some((m) => m.id === newPaymentForm.memberId)) { showToast('Vui lòng chọn thành viên!', 'error'); return; }
                      const p = {
                        id: uid('P'),
                        memberId: newPaymentForm.memberId,
                        date: newPaymentForm.date || todayLocal(),
                        amount,
                        method: newPaymentForm.method,
                        type: 'Payment',
                        note: newPaymentForm.note.trim()
                      };
                      setPayments((prev) => [p, ...prev]);
                      setModalType(null);
                      showToast('Đã ghi nhận thanh toán & cập nhật công nợ!');
                    }}
                    className="w-full rounded-2xl bg-emerald-600 py-3 font-bold text-white"
                  >
                    Xác Nhận Thu Tiền
                  </button>
                </div>
              )}

              {modalType === 'NEW_EVENT' && (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Tên sự kiện / Tiệc</label>
                    <input type="text" value={newEventForm.name}
                      onChange={(e) => setNewEventForm({ ...newEventForm, name: e.target.value })} className={modalInput} />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Ngày tổ chức</label>
                    <input type="date" value={newEventForm.date}
                      onChange={(e) => setNewEventForm({ ...newEventForm, date: e.target.value })} className={modalInput} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Tổng chi phí</label>
                      <input type="text" inputMode="numeric" placeholder="0" value={newEventForm.totalCost}
                        onChange={(e) => setNewEventForm({ ...newEventForm, totalCost: moneyInput(e.target.value) })} className={modalInput} />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Quỹ nhóm tài trợ</label>
                      <input type="text" inputMode="numeric" placeholder="0" value={newEventForm.clubSponsoredAmount}
                        onChange={(e) => setNewEventForm({ ...newEventForm, clubSponsoredAmount: moneyInput(e.target.value) })} className={modalInput} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-400">Người tham gia ({eventCount})</label>
                      <div className="flex gap-2">
                        <button className="text-[#4772FA] font-bold"
                          onClick={() => setNewEventForm({ ...newEventForm, participantIds: members.filter((m) => m.status === 'Active').map((m) => m.id) })}>
                          Tất cả Active
                        </button>
                        <button className="text-slate-400 font-bold" onClick={() => setNewEventForm({ ...newEventForm, participantIds: [] })}>Bỏ chọn</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2">
                      {members.filter((m) => m.status !== 'Archived').map((m) => {
                        const checked = newEventForm.participantIds.includes(m.id);
                        return (
                          <label key={m.id} className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer ${checked ? 'bg-[#4772FA]/10 text-[#4772FA] font-bold' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setNewEventForm((f) => ({
                                ...f,
                                participantIds: checked ? f.participantIds.filter((id) => id !== m.id) : [...f.participantIds, m.id]
                              }))}
                              className="h-4 w-4 accent-[#4772FA]"
                            />
                            <span className="truncate">{m.nickname || m.fullName}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-slate-500">
                      Chia {formatVND(eventNet)} cho {eventCount} người ≈ <b>{formatVND(eventCount ? Math.floor(eventNet / eventCount) : 0)}</b>/người
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (!newEventForm.name.trim()) { showToast('Vui lòng nhập tên sự kiện!', 'error'); return; }
                      if (toNum(newEventForm.totalCost) <= 0) { showToast('Tổng chi phí phải lớn hơn 0!', 'error'); return; }
                      if (eventCount === 0) { showToast('Hãy chọn ít nhất 1 người tham gia!', 'error'); return; }
                      const ev = {
                        id: uid('EV'),
                        name: newEventForm.name.trim(),
                        date: newEventForm.date || todayLocal(),
                        totalCost: toNum(newEventForm.totalCost),
                        clubSponsoredAmount: Math.min(toNum(newEventForm.clubSponsoredAmount), toNum(newEventForm.totalCost)),
                        payerMemberId: null,
                        paidFromClubCash: true,
                        allocationMethod: 'EQUAL',
                        notes: '',
                        participants: newEventForm.participantIds.map((memberId) => ({ memberId, customShare: 0 }))
                      };
                      setEvents((prev) => [ev, ...prev]);
                      setModalType(null);
                      showToast('Đã tạo sự kiện đặc biệt & phân bổ chi phí!');
                    }}
                    className="w-full rounded-2xl bg-[#4772FA] py-3 font-bold text-white"
                  >
                    Tạo Sự Kiện & Chia Tiền
                  </button>
                </div>
              )}

              {modalType === 'NEW_INVENTORY' && (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Tên lô cầu mua vào</label>
                    <input type="text" value={newInvForm.itemName}
                      onChange={(e) => setNewInvForm({ ...newInvForm, itemName: e.target.value })} className={modalInput} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Số lượng (quả)</label>
                      <input type="text" inputMode="numeric" placeholder="0" value={newInvForm.quantity}
                        onChange={(e) => setNewInvForm({ ...newInvForm, quantity: moneyInput(e.target.value) })} className={modalInput} />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Đơn giá / quả</label>
                      <input type="text" inputMode="numeric" placeholder="0" value={newInvForm.unitPrice}
                        onChange={(e) => setNewInvForm({ ...newInvForm, unitPrice: moneyInput(e.target.value) })} className={modalInput} />
                    </div>
                  </div>
                  <p className="text-slate-500">Thành tiền: <b>{formatVND(toNum(newInvForm.quantity) * toNum(newInvForm.unitPrice))}</b></p>
                  <button
                    onClick={() => {
                      const qty = toNum(newInvForm.quantity);
                      const price = toNum(newInvForm.unitPrice);
                      if (qty <= 0) { showToast('Số lượng phải lớn hơn 0!', 'error'); return; }
                      const inv = {
                        id: uid('INV'),
                        date: todayLocal(),
                        itemName: newInvForm.itemName.trim() || 'Lô cầu',
                        quantity: qty,
                        unitPrice: price,
                        totalCost: qty * price,
                        method: 'Bank Transfer',
                        note: ''
                      };
                      setInventoryPurchases((prev) => [inv, ...prev]);
                      setModalType(null);
                      showToast(`Đã nhập kho thêm ${inv.quantity} quả cầu!`);
                    }}
                    className="w-full rounded-2xl bg-[#4772FA] py-3 font-bold text-white"
                  >
                    Xác Nhận Nhập Kho
                  </button>
                </div>
              )}

              {modalType === 'BACKUP' && (
                <div className="space-y-4 text-xs">
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3 space-y-1.5">
                    <div className="font-bold text-slate-600 dark:text-slate-300">Bộ nhớ trên máy</div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Nơi lưu</span>
                      <b>{boot.backend === 'idb' ? 'IndexedDB (không giới hạn 5 MB)' : 'localStorage dự phòng (~5 MB)'}</b>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Đã dùng</span>
                      <b>{fmtBytes(storageInfo?.usage)}{storageInfo?.quota ? ` / ${fmtBytes(storageInfo.quota)}` : ''}</b>
                    </div>
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-slate-400">Chống tự xoá</span>
                      {storageInfo?.persisted ? (
                        <b className="text-emerald-600">Đã bảo vệ</b>
                      ) : (
                        <button
                          onClick={async () => {
                            const ok = await requestPersistence();
                            refreshStorageInfo();
                            showToast(ok ? 'iOS đã cho phép giữ dữ liệu vĩnh viễn.' : 'Chưa được cấp quyền – hãy cài app ra Màn hình chính rồi thử lại.', ok ? 'success' : 'error');
                          }}
                          className="rounded-lg bg-[#4772FA]/10 px-2 py-1 font-bold text-[#4772FA]"
                        >
                          Chưa – Bật bảo vệ
                        </button>
                      )}
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Trạng thái lưu</span>
                      <b className={saveStatus.state === 'error' ? 'text-rose-500' : 'text-emerald-600'}>
                        {saveStatus.state === 'error' ? 'Lỗi – chưa lưu' : saveStatus.state === 'saving' ? 'Đang lưu…' : 'Đã lưu'}
                      </b>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Phiên bản dữ liệu</span>
                      <b>v{SCHEMA_VERSION}</b>
                    </div>
                  </div>
                  {!isStandalone() && (
                    <div className="rounded-2xl bg-[#4772FA]/5 border border-[#4772FA]/20 p-3 text-slate-600 dark:text-slate-300">
                      <b className="text-[#4772FA]">Cài app lên iPhone để dùng offline:</b> mở bằng Safari → nút Chia sẻ → “Thêm vào MH chính”. App sẽ mở được cả khi không có mạng và iOS giữ dữ liệu bền hơn.
                    </div>
                  )}
                  <p className="text-slate-500">
                    Dữ liệu được tự động lưu trên máy này. Hãy tải bản sao lưu JSON định kỳ để cất vào iCloud Drive / Google Drive phòng khi đổi máy hoặc xoá dữ liệu trình duyệt.
                  </p>
                  <button onClick={handleDownloadBackup} className="w-full rounded-2xl bg-[#4772FA] py-3 font-bold text-white flex items-center justify-center gap-2">
                    <Download className="h-4 w-4" /> Tải Xuống Bản Backup (.json)
                  </button>
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                    <label className="block font-bold mb-2">Khôi phục từ file Backup:</label>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleRestoreBackup}
                      className="w-full text-xs file:mr-3 file:rounded-xl file:border-0 file:bg-slate-200 dark:file:bg-slate-700 file:px-3 file:py-2 file:font-bold"
                    />
                  </div>
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                    <button onClick={handleResetSample} className="w-full rounded-2xl bg-rose-500/10 py-2.5 font-bold text-rose-500 flex items-center justify-center gap-2">
                      <RotateCcw className="h-4 w-4" /> Xoá hết, bắt đầu lại
                    </button>
                  </div>
                </div>
              )}

              {modalType === 'QA_SUITE' && qaResults && (
                <div className="space-y-2.5 text-xs">
                  {(() => {
                    const passed = qaResults.filter((r) => r.passed).length;
                    const allPass = passed === qaResults.length;
                    return (
                      <div className={`rounded-2xl p-3 font-bold flex items-center justify-between ${allPass ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-500'}`}>
                        <span>Kết quả chạy kiểm thử tự động:</span>
                        <span>{passed} / {qaResults.length} PASSED</span>
                      </div>
                    );
                  })()}
                  <p className="text-[11px] text-slate-400">TC01–TC14 kiểm tra bộ tính tiền trên dữ liệu demo nội bộ (không đụng tới dữ liệu thật). TC15 kiểm tra sao lưu dữ liệu thật của bạn.</p>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {qaResults.map((r) => (
                      <div key={r.id} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-200/60 dark:border-slate-700">
                        <div className="flex items-center justify-between gap-2 font-bold">
                          <span>{r.name}</span>
                          <span className={r.passed ? 'text-emerald-600' : 'text-rose-500'}>{r.passed ? 'PASS' : 'FAIL'}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{r.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {confirmState && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
            onClick={(e) => { if (e.target === e.currentTarget) setConfirmState(null); }}
          >
            <div role="alertdialog" aria-modal="true" className="w-full max-w-xs rounded-3xl bg-white dark:bg-[#1C1C1E] p-5 shadow-2xl text-center space-y-4">
              <p className="text-sm font-semibold leading-relaxed">{confirmState.message}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfirmState(null)}
                  className="rounded-2xl bg-slate-100 dark:bg-slate-800 py-2.5 text-sm font-bold text-slate-600 dark:text-slate-300"
                >
                  Huỷ
                </button>
                <button
                  autoFocus
                  onClick={() => {
                    const fn = confirmState.onConfirm;
                    setConfirmState(null);
                    fn();
                  }}
                  className={`rounded-2xl py-2.5 text-sm font-bold text-white ${confirmState.danger ? 'bg-rose-500' : 'bg-[#4772FA]'}`}
                >
                  {confirmState.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}

        <nav className="fixed bottom-0 inset-x-0 z-40 backdrop-blur-xl bg-white/90 dark:bg-[#1C1C1E]/90 border-t border-slate-200/80 dark:border-slate-800 pb-safe">
          <div className="mx-auto max-w-md grid grid-cols-5 py-2">
            {[
              { id: 'overview', label: 'Tổng quan', icon: LayoutGrid },
              { id: 'sessions', label: 'Buổi đánh', icon: Calendar },
              { id: 'members', label: 'Thành viên', icon: Users },
              { id: 'finance', label: 'Tài chính', icon: Wallet },
              { id: 'reports', label: 'Báo cáo', icon: BarChart3 }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => goTab(tab.id)}
                  className={`flex flex-col items-center justify-center py-1 transition ${isActive ? 'text-[#4772FA]' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-[1.8px]'}`} />
                  <span className="mt-1 text-[10px] font-bold">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
