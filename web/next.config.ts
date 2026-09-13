import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Stops `next dev` regenerating AGENTS.md and CLAUDE.md in this folder on every start.
  agentRules: false,
  // Standalone output only for the container image, where it cuts the runtime down to what
  // the server needs. Left off otherwise, because `next start` does not serve standalone builds.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
}

export default nextConfig
