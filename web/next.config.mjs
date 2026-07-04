/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@takeon/engine'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
