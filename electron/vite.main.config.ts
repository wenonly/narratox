import { defineConfig } from 'vite';

// Main process bundle. plugin-vite 自动从 forge.config.ts 的 build[].entry
// 派生输出文件名(src/main.ts → .vite/build/main.js),所以这里保持空配置即可。
// 它还会在 dev 时注入 MAIN_VITE_DEV_SERVER_URL 全局,让 main 知道 renderer 的 dev server。
export default defineConfig({});
