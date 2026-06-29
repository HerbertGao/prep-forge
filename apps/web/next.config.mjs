/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages are consumed as TypeScript source in Phase 0 (no separate build step).
  transpilePackages: [
    "@prep-forge/schemas",
    "@prep-forge/db",
    "@prep-forge/lesson-runtime",
  ],
};

export default nextConfig;
