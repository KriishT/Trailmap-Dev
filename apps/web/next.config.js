/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@trailmap/scanner", "@trailmap/graph", "@trailmap/pipeline", "@trailmap/frameworks", "@trailmap/sheets", "@trailmap/localdb", "@trailmap/ui"],
  serverExternalPackages: ["@electric-sql/pglite", "simple-git", "@cdktf/hcl2json", "elkjs", "pdf-lib"],
  
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
};

export default nextConfig;
