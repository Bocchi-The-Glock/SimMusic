import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.SIMMUSIC_TARGET === 'node' ? { output: 'standalone' as const } : {}),
};

export default nextConfig;
