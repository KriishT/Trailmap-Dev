/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@trailmap/scanner"],
  serverExternalPackages: ["simple-git", "glob", "js-yaml", "fast-xml-parser"],
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
};

export default nextConfig;
