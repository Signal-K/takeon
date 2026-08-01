/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@takeon/engine', '@takeon/ui', '@takeon/editor'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
