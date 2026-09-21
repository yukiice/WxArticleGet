import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // 产出 .next/standalone：只含 Next 追踪到的依赖，配合多阶段 Dockerfile 把镜像
  // 从「全量 node_modules」缩到「standalone + dist」，几个人用的自部署项目够用。
  output: 'standalone',
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/files/:path*', destination: `${apiUrl}/files/:path*` },
    ];
  },
};

export default nextConfig;

