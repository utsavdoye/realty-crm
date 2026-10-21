/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // Pages you go back to always show fresh data (no 30-second old copy after a change).
  experimental: { staleTimes: { dynamic: 0 }, serverComponentsExternalPackages: ['read-excel-file', 'unzipper'] }, // read-excel-file/node is used on the server for inventory sheets
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};
export default nextConfig;
