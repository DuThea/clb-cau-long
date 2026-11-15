import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const listFiles = (dir, base = dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
      })
    : [];

/**
 * Sinh dist/sw.js với danh sách precache = mọi file của bản build + thư mục public.
 * Phiên bản cache đổi theo nội dung -> iPhone tự nhận bản cập nhật, bản cũ vẫn chạy offline.
 */
function serviceWorkerPlugin() {
  let publicDir = 'public';
  return {
    name: 'bcm-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { publicDir = config.publicDir; },
    generateBundle(_, bundle) {
      const bundled = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = [...new Set([...bundled, ...listFiles(publicDir), 'index.html'])].sort();
      const hash = crypto.createHash('sha256');
      files.forEach((f) => hash.update(f));
      const html = bundle['index.html'];
      if (html) hash.update(String(html.source));
      const version = hash.digest('hex').slice(0, 12);
      const template = fs.readFileSync(path.resolve('sw/sw-template.js'), 'utf8');
      const source = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files.map((f) => `./${f}`), null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}

export default defineConfig({
  // Đường dẫn tương đối: chạy được ở tên miền gốc hoặc thư mục con (VD GitHub Pages)
  base: './',
  plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  test: { environment: 'node' }
});
