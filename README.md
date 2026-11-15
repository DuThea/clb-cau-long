# CLB Cầu Lông – Badminton Manager

Ứng dụng quản lý CLB cầu lông chạy offline trên iPhone: buổi đánh, chia tiền sân/cầu/nước theo giờ, công nợ, thu tiền theo buổi, sự kiện, kho cầu, báo cáo.

- Không cần tài khoản, không có máy chủ – dữ liệu lưu trong IndexedDB trên chính thiết bị.
- Cài lên iPhone: mở link bằng Safari → Chia sẻ → **Thêm vào MH chính**. Sau đó mở được cả khi không có mạng.
- Sao lưu: mục **Báo cáo → Backup** để tải file JSON (nên cất vào iCloud Drive định kỳ).

## Phát triển

```bash
npm install
npm run dev      # chạy thử khi phát triển
npm test         # kiểm thử bộ tính tiền & lưu trữ
npm run serve    # build + chạy bản production (có service worker)
```

Mỗi lần push lên nhánh `main`, GitHub Actions tự kiểm thử, build và đăng lên GitHub Pages.

| Thư mục | Nội dung |
|---|---|
| `src/lib/allocation.js` | Bộ tính chia tiền (pure function, có test) |
| `src/lib/analytics.js` | Sổ cái tổng hợp CLB |
| `src/lib/storage.js` | Lưu trữ IndexedDB, migration theo phiên bản dữ liệu |
| `sw/sw-template.js` | Service worker (offline) – sinh tự động khi build |
| `scripts/make-icons.mjs` | Sinh icon app |
