import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The stats server runs beside this app. Rewriting keeps the browser on one
  // origin, so no CORS preflight and no hostname baked into the bundle.
  async rewrites() {
    const api = process.env.ASSAY_API ?? "http://localhost:8787";
    return [{ source: "/api/stats/:path*", destination: `${api}/:path*` }];
  },
};

export default config;
