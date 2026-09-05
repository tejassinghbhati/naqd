import path from "node:path";
import type { NextConfig } from "next";

/*
  A build and a dev server never share a directory.

  They both default to `.next`, and the moment you run one after the other -
  or kill a dev server mid-compile - the cache is left half-written. What you
  get then is `ENOENT ... .next/server/app/page.js`: an error naming a file
  that was never finished, which says nothing about the cache being the actual
  problem. It cost three separate debugging sessions before it was worth
  fixing at the root.

  NODE_ENV is the signal, not argv. Next evaluates this config in a worker
  process whose argv does NOT carry the subcommand, so an argv test reads false
  under `next dev` and points the dev server at the build directory - which is
  the same failure wearing a different directory name. NODE_ENV is set by the
  CLI and inherited: `development` for dev, `production` for build and for the
  start that serves what build produced.
*/
const isDev = process.env.NODE_ENV !== "production";

const config: NextConfig = {
  reactStrictMode: true,
  distDir: isDev ? ".next" : ".next-build",
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
