import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { loadData, requestPersistence } from './lib/storage.js';
import './index.css';

// ---------- Service Worker: chạy offline + nhận bản cập nhật ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const notify = (worker) => {
        window.__bcmWaitingSW = worker;
        window.dispatchEvent(new Event('bcm-sw-update'));
      };
      // Có controller cũ = đây là bản cập nhật (không phải lần cài đầu tiên)
      const track = (worker) => {
        if (!worker) return;
        if (worker.state === 'installed' && navigator.serviceWorker.controller) { notify(worker); return; }
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) notify(worker);
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
      // Trình duyệt thường đã bắt đầu tải bản mới ngay khi mở app, trước cả khi đoạn code này chạy
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // Mỗi lần mở lại app từ nền: kiểm tra bản mới (khi có mạng)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});

    // Chỉ tải lại khi người dùng chủ động bấm "Cập nhật" (tránh reload ở lần cài đầu tiên)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (window.__bcmApplyingUpdate) window.location.reload();
    });
  });
}

async function boot() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  let loaded;
  try {
    loaded = await loadData();
  } catch {
    loaded = { data: null, backend: 'local', source: 'none', newer: false };
  }
  requestPersistence(); // không chặn khởi động
  root.render(
    <React.StrictMode>
      <App boot={loaded} />
    </React.StrictMode>
  );
}

registerServiceWorker();
boot();
