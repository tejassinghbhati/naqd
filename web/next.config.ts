import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The repo has a lockfile at the root (the measurement pipeline) and one here
  // (the app). Next picks a workspace root by searching for lockfiles and warns
  // on every single start when it finds more than one. Both halves are real, so
  // the answer is to say which one this app belongs to, not to delete either.
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  // The stats server runs beside this app. Rewriting keeps the browser on one
  // origin, so no CORS preflight and no hostname baked into the bundle.
  async rewrites() {
    const api = process.env.ASSAY_API ?? "http://localhost:8787";
    return [{ source: "/api/stats/:path*", destination: `${api}/:path*` }];
  },
};

export default config;
