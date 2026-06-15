import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  // agent-ui is self-contained (own lockfile + node_modules); pin the tracing
  // root so Next stops looking for a workspace root in the repo root.
  outputFileTracingRoot: __dirname
}

export default nextConfig
