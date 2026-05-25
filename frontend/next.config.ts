import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // 禁用静态页面缓存，确保每次更新都能立即生效
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-cache, no-store, must-revalidate',
        },
      ],
    },
  ],
  // 允许外部图片
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
