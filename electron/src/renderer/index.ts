// Renderer entry. The Narratox bridge is exposed by preload.ts (`window.narratox`).
const info = document.getElementById('platform-info');

const nx = window.narratox;
if (info) {
  if (nx) {
    info.textContent =
      `平台：${nx.platform} · Electron ${nx.versions.electron} · ` +
      `Chromium ${nx.versions.chrome} · Node ${nx.versions.node}`;
  } else {
    info.textContent = '（preload 桥未注入 — 检查 contextIsolation / preload 路径）';
  }
}

export {};
