import type { Metadata } from "next";
import { getSummary, API_BASE } from "@/lib/stats-server";
import { Section, SectionHead, SiteFooter } from "@/components/site/parts";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "A public JSON API for DreamDEX event contracts. No key, permissive CORS, every figure recomputed from settled history.",
};

const ROUTES = [
  { path: "/v1/summary", what: "Everything below in one call. What this site renders from." },
  { path: "/v1/markets/live", what: "Currently tradable event contracts, proxied live from the indexer." },
  {
    path: "/v1/stats/base-rate",
    what: "How often the underlying actually closes at or above its open, overall and per series.",
  },
  {
    path: "/v1/stats/calibration",
    what: "Implied probability against realized frequency, per market and sliced by time-to-expiry.",
  },
  {
    path: "/v1/stats/edge",
    what: "All three estimators side by side. The naive per-fill number is included as a labelled foil, not a recommendation.",
  },
  {
    path: "/v1/edge/live",
    what: "The trade / stand-down verdict the agent obeys, with the interval it was decided on.",
  },
  {
    path: "/v1/traders",
    what: "Settled PnL leaderboard. Filters on distinct markets, not just trade count.",
  },
  { path: "/v1/liquidity", what: "Coverage, hour-of-day activity, and participant concentration." },
];

export default async function ApiDocs() {
  const s = await getSummary();

  const example = [
    `curl -s ${API_BASE}/v1/edge/live | jq`,
    "",
    "{",
    `  "verdict": "${s?.live.verdict ?? "stand-down"}",`,
    `  "edge": ${s ? s.live.edge.toFixed(6) : "-0.020468"},`,
    '  "recent": {',
    `    "mean": ${s ? s.live.recent.mean.toFixed(6) : "-0.020468"},`,
    `    "t": ${s ? s.live.recent.t.toFixed(4) : "-1.3456"},`,
    `    "ci95": [${s ? s.live.recent.ci95.map((x) => x.toFixed(6)).join(", ") : "-0.050282, 0.009345"}],`,
    `    "n": ${s ? s.live.recent.n : 419}`,
    "  },",
    `  "confidence": ${s ? s.live.confidence.toFixed(2) : "0.00"},`,
    `  "windowDays": ${s ? s.live.windowDays : 7}`,
    "}",
  ].join("\n");

  return (
    <>
      <Section>
        <div className="page-head">
          <span className="eyebrow">Developers</span>
          <h1 className="display page-title">
            The event-contract API
            <br />
            that did not exist.
          </h1>
          <p className="prose">
            DreamDEX&rsquo;s own documentation is explicit that{" "}
            <em>&ldquo;the HTTP API covers spot only &mdash; no event-contract endpoints&rdquo;</em>.
            Anything wanting this data today has to run the TypeScript SDK and hold a viem client,
            which rules out a Python notebook, a Grafana panel, or a phone. Assay serves it as plain
            JSON over HTTP: no key, permissive CORS, and every figure recomputed from the
            venue&rsquo;s own settled history.
          </p>
          <div className="row" style={{ marginTop: 4 }}>
            <span className={`tag ${s ? "ok" : "warn"}`}>{s ? "ONLINE" : "OFFLINE"}</span>
            <code className="mono xs dim">{API_BASE}</code>
          </div>
        </div>
      </Section>

      <Section tone="sunk">
        <SectionHead eyebrow="Reference" title="Routes" />
        <div className="stack" style={{ gap: 16 }}>
          <div className="panel">
            {ROUTES.map((r, i) => (
              <div
                key={r.path}
                className="route-row"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--glass-line)" }}
              >
                <code className="mono sm" style={{ color: "var(--accent)" }}>
                  GET {r.path}
                </code>
                <span className="sm dim" style={{ lineHeight: 1.55 }}>
                  {r.what}
                </span>
              </div>
            ))}
          </div>
          <p className="xs dimmer measure">
            Responses are cached for 30 seconds. The statistical routes are memoised server-side
            because the edge report runs a 20,000-resample bootstrap, and the underlying store only
            changes when a backfill runs.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHead eyebrow="Example" title="A single call" />
        <div className="stack" style={{ gap: 16 }}>
          <div className="panel panel-bd">
            <pre className="mono xs code-block">{example}</pre>
          </div>
          <p className="sm dim measure">
            <strong>Read confidence as a size multiplier, not a probability.</strong> It scales with
            how far the near bound of the interval sits from zero, so a wide interval sizes small
            even when its centre looks attractive. At zero, the correct position is none.
          </p>

          <div className="panel panel-bd" style={{ marginTop: 8 }}>
            <pre className="mono code-block">{`git clone https://github.com/tejassinghbhati/event-contracts
npm install

npm run backfill   # pull the venue's full history  (~3 min)
npm run api        # http://localhost:8787
npm run web        # http://localhost:3000`}</pre>
          </div>
          <p className="sm dimmer" style={{ lineHeight: 1.6 }}>
            The site rewrites <code>/api/stats/*</code> to the stats service, so the browser stays on
            one origin. Without it running, every price shows <strong>no fair value</strong> rather
            than a wrong one.
          </p>
        </div>
      </Section>

      <SiteFooter asOf={s?.dataAsOf} />
    </>
  );
}
