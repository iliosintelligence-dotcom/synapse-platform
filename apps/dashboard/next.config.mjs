/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@synapse/types', '@synapse/api', '@synapse/auth', '@synapse/database'],
};

export default nextConfig;
