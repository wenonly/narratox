import { defineConfig } from 'vite';

// Renderer bundle。渲染层入口由 plugin-vite 接管 —— 它会找到 src/renderer/index.html
// 并在 dev 时起一个 vite server,在 prod 时打包成 .vite/renderer/main_window/index.html。
export default defineConfig({});
