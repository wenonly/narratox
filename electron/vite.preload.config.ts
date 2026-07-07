import { defineConfig } from 'vite';

// Preload bundle:必须配合 contextIsolation 跑在隔离上下文里。
// 输出文件名由 plugin-vite 从 forge.config.ts 的 entry 派生(src/preload.ts → .vite/build/preload.js)。
export default defineConfig({});
