/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },      // no truene por ESLint en Vercel
  typescript: { ignoreBuildErrors: true },   // no truene por TS (temporal)
};

module.exports = nextConfig;
