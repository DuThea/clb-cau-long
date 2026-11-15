// ==========================================
// DỮ LIỆU MẪU CỦA CLB (20 THÀNH VIÊN)
// ==========================================
export const INITIAL_MEMBERS = [
  { id: 'M01', fullName: 'Vỹ', nickname: 'Vỹ', phone: '', joinDate: '2025-01-10', status: 'Active', notes: 'Chủ nhiệm CLB' },
  { id: 'M02', fullName: 'Sol', nickname: 'Sol', phone: '', joinDate: '2025-01-10', status: 'Active', notes: 'Thủ quỹ' },
  { id: 'M03', fullName: 'Thea', nickname: 'Thea', phone: '', joinDate: '2025-01-12', status: 'Active', notes: '' },
  { id: 'M04', fullName: 'Thảo', nickname: 'Thảo', phone: '', joinDate: '2025-02-01', status: 'Active', notes: '' },
  { id: 'M05', fullName: 'Lan', nickname: 'Lan', phone: '', joinDate: '2025-02-15', status: 'Active', notes: '' },
  { id: 'M06', fullName: 'Phong', nickname: 'Phong', phone: '', joinDate: '2025-03-01', status: 'Active', notes: '' },
  { id: 'M07', fullName: 'Ninh', nickname: 'Ninh', phone: '', joinDate: '2025-03-10', status: 'Active', notes: 'Đóng quỹ trước' },
  { id: 'M08', fullName: 'Bảo Huỳnh', nickname: 'Bảo Huỳnh', phone: '', joinDate: '2025-03-20', status: 'Active', notes: '' },
  { id: 'M09', fullName: 'Huy', nickname: 'Huy', phone: '', joinDate: '2025-04-05', status: 'Active', notes: '' },
  { id: 'M10', fullName: 'Thuý', nickname: 'Thuý', phone: '', joinDate: '2025-04-18', status: 'Active', notes: '' },
  { id: 'M11', fullName: 'Thế', nickname: 'Thế', phone: '', joinDate: '2025-05-01', status: 'Active', notes: '' },
  { id: 'M12', fullName: 'Khang', nickname: 'Khang', phone: '', joinDate: '2025-05-12', status: 'Active', notes: '' },
  { id: 'M13', fullName: 'Sony', nickname: 'Sony', phone: '', joinDate: '2025-06-01', status: 'Inactive', notes: 'Tạm nghỉ' },
  { id: 'M14', fullName: 'Khoa', nickname: 'Khoa', phone: '', joinDate: '2025-06-15', status: 'Active', notes: '' },
  { id: 'M15', fullName: 'Bin', nickname: 'Bin 1', phone: '', joinDate: '2025-07-01', status: 'Active', notes: '' },
  { id: 'M16', fullName: 'Thư', nickname: 'Thư', phone: '', joinDate: '2025-07-20', status: 'Active', notes: '' },
  { id: 'M17', fullName: 'Tú Anh', nickname: 'Tú Anh', phone: '', joinDate: '2025-08-05', status: 'Active', notes: '' },
  { id: 'M18', fullName: 'Phương', nickname: 'Phương', phone: '', joinDate: '2025-08-19', status: 'Active', notes: '' },
  { id: 'M19', fullName: 'Bin', nickname: 'Bin 2', phone: '', joinDate: '2025-09-01', status: 'Active', notes: '' },
  { id: 'M20', fullName: 'An', nickname: 'An', phone: '', joinDate: '2025-09-15', status: 'Archived', notes: 'Bảo lưu lịch sử' }
];

const p = (memberId, extra = {}) => ({
  memberId, inputMode: 'DIRECT', startTime: '18:00', endTime: '21:00', hours: 3.0,
  personalShuttles: 0, drinkWater: true, waterQty: 1, customAdjustment: 0, note: '', ...extra
});

export const INITIAL_SESSIONS = [
  {
    id: 'S20261115',
    date: '2026-11-15',
    title: 'Buổi đánh Chủ Nhật Tuần 2 - Tháng 11',
    startTime: '18:00',
    endTime: '21:00',
    courtCount: 3,
    durationHours: 3,
    courtPricePerHour: 100000,
    extraCourts: [
      { id: 'EC1', courtCount: 1, durationHours: 1, pricePerHour: 100000, note: 'Thuê thêm 1 sân đánh thêm 1 giờ' }
    ],
    customCourtTotal: null,
    courtAllocationMethod: 'BY_HOURS',
    shuttleUnitPrice: 24000,
    sharedShuttles: 20,
    damagedShuttles: 0,
    sharedShuttleMethod: 'BY_HOURS',
    enablePersonalShuttles: false,
    waterTotalCost: 100000,
    waterAllocationMethod: 'EQUAL_DRINKERS',
    otherExpenses: [
      { id: 'OE1', name: 'Gửi xe & Trà đá thêm', amount: 50000, method: 'EQUAL' }
    ],
    status: 'Confirmed',
    notes: '3 sân chính 3 giờ + 1 sân phát sinh thêm 1 giờ.',
    editHistory: [
      { timestamp: '2026-11-15 21:15', action: 'Tạo buổi đánh tiêu chuẩn' }
    ],
    participants: [
      p('M01', { inputMode: 'RANGE' }),
      p('M02', { inputMode: 'RANGE' }),
      p('M03', { inputMode: 'RANGE', waterQty: 2 }),
      p('M04'),
      p('M05', { drinkWater: false, waterQty: 0, note: 'Không uống nước' }),
      p('M06'), p('M07'), p('M08'), p('M09'), p('M10')
    ]
  },
  {
    id: 'S20261110',
    date: '2026-11-10',
    title: 'Buổi đánh Thứ Ba - Tháng 11',
    startTime: '19:00',
    endTime: '21:00',
    courtCount: 2,
    durationHours: 2,
    courtPricePerHour: 100000,
    extraCourts: [],
    customCourtTotal: null,
    courtAllocationMethod: 'BY_HOURS',
    shuttleUnitPrice: 24000,
    sharedShuttles: 12,
    damagedShuttles: 0,
    sharedShuttleMethod: 'BY_HOURS',
    enablePersonalShuttles: false,
    waterTotalCost: 60000,
    waterAllocationMethod: 'EQUAL_ALL',
    otherExpenses: [],
    status: 'Closed',
    notes: 'Buổi tập chiến thuật đánh đôi.',
    editHistory: [
      { timestamp: '2026-11-10 21:30', action: 'Khóa sổ buổi đánh (Closed)' }
    ],
    participants: ['M01', 'M02', 'M03', 'M07', 'M11', 'M20'].map((id) =>
      p(id, { startTime: '19:00', endTime: '21:00', hours: 2.0 })
    )
  },
  {
    id: 'S20261105',
    date: '2026-11-05',
    title: 'Buổi đánh Thứ Năm - Tuần 1 Tháng 11',
    startTime: '18:00',
    endTime: '21:00',
    courtCount: 2,
    durationHours: 3,
    courtPricePerHour: 100000,
    extraCourts: [],
    customCourtTotal: null,
    courtAllocationMethod: 'BY_HOURS',
    shuttleUnitPrice: 24000,
    sharedShuttles: 15,
    damagedShuttles: 0,
    sharedShuttleMethod: 'BY_HOURS',
    enablePersonalShuttles: false,
    waterTotalCost: 70000,
    waterAllocationMethod: 'EQUAL_DRINKERS',
    otherExpenses: [],
    status: 'Closed',
    notes: 'Dữ liệu lịch sử để nhận diện thói quen đi đánh 2-5 buổi gần nhất.',
    editHistory: [
      { timestamp: '2026-11-05 21:20', action: 'Khóa sổ buổi đánh (Closed)' }
    ],
    participants: [
      p('M01'), p('M02'), p('M03'), p('M04'),
      p('M05', { drinkWater: false }),
      p('M06'), p('M07'), p('M08')
    ]
  }
];

export const INITIAL_EVENTS = [
  {
    id: 'EV202611',
    name: 'Liên hoan Sinh nhật Thành viên Tháng 11',
    date: '2026-11-12',
    totalCost: 1200000,
    clubSponsoredAmount: 200000, // Quỹ tài trợ 200k, còn 1.000.000 chia 5 người
    payerMemberId: 'M01',
    paidFromClubCash: true,
    allocationMethod: 'EQUAL',
    notes: 'Lẩu dê Trương Định sau giờ đánh cầu',
    participants: ['M01', 'M02', 'M03', 'M04', 'M07'].map((memberId) => ({ memberId, customShare: 200000 }))
  }
];

export const INITIAL_PAYMENTS = [
  { id: 'P001', memberId: 'M01', date: '2026-11-01', amount: 800000, method: 'Bank Transfer', type: 'Prepayment', note: 'Đóng quỹ tháng 11' },
  { id: 'P002', memberId: 'M02', date: '2026-11-05', amount: 400000, method: 'Bank Transfer', type: 'SessionPayment', note: 'Thanh toán tiền sân + cầu' },
  { id: 'P003', memberId: 'M07', date: '2026-11-01', amount: 1500000, method: 'Bank Transfer', type: 'Prepayment', note: 'Đóng trước quỹ cả quý (Có số dư)' },
  { id: 'P004', memberId: 'M03', date: '2026-11-15', amount: 150000, method: 'Cash', type: 'PartialPayment', note: 'Đóng trước một phần bằng tiền mặt' },
  { id: 'P005', memberId: 'M20', date: '2026-11-11', amount: 150000, method: 'Bank Transfer', type: 'Settlement', note: 'Tất toán trước khi lưu trữ' }
];

export const INITIAL_INVENTORY_PURCHASES = [
  { id: 'INV01', date: '2026-11-01', itemName: 'Thùng cầu lông tiêu chuẩn (10 ống = 120 trái)', quantity: 120, unitPrice: 24000, totalCost: 2880000, method: 'Bank Transfer', note: 'Mua dự trữ kho tháng 11 (24.000đ/trái)' }
];

export const SEED_EVENT_ID = 'EV202611';

// Ghi chú gắn với tài chính demo -> bỏ khi khởi tạo dữ liệu thật
const DEMO_ONLY_NOTES = new Set(['M07', 'M20']);

/** Dữ liệu khi mở app lần đầu: chỉ có danh sách thành viên, chưa có tài chính. */
export const starterData = () => ({
  members: INITIAL_MEMBERS.map((m) => ({ ...m, notes: DEMO_ONLY_NOTES.has(m.id) ? '' : m.notes })),
  sessions: [],
  events: [],
  payments: [],
  inventoryPurchases: [],
  ledgerAdjustments: []
});

/** Bộ dữ liệu demo đầy đủ – dùng cho bộ kiểm thử QA (không ghi vào dữ liệu thật). */
export const demoData = () => ({
  members: INITIAL_MEMBERS,
  sessions: INITIAL_SESSIONS,
  events: INITIAL_EVENTS,
  payments: INITIAL_PAYMENTS,
  inventoryPurchases: INITIAL_INVENTORY_PURCHASES,
  ledgerAdjustments: []
});
