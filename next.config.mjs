/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // playwright-core / anthropic / neon run only in Node server routes, never bundled to client.
  serverExternalPackages: ["playwright-core", "@browserbasehq/sdk"],
  experimental: {
    // keep server actions modest; not used heavily
  },
};

export default nextConfig;
