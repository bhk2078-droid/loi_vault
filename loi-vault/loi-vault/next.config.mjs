/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // exceljs, docx and @react-pdf/renderer all reach for Node builtins that
      // don't exist in a browser. Stub them rather than shipping polyfills —
      // the browser builds of these libraries never call into them.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        stream: false,
        zlib: false,
        crypto: false,
        path: false,
        os: false,
        http: false,
        https: false,
      };
    }
    return config;
  },
};
export default nextConfig;
