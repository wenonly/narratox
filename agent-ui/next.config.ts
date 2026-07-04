import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  // Docker 自托管:产出 .next/standalone/server.js + 最小 node_modules,镜像可缩到 ~150MB。
  // Vercel 自动忽略此选项(用自己的构建器),本地 `pnpm start` 仍正常 —— 三处无副作用。
  output: 'standalone',
  // agent-ui is self-contained (own lockfile + node_modules); pin the tracing
  // root so Next stops looking for a workspace root in the repo root.
  outputFileTracingRoot: __dirname
}

export default nextConfig
