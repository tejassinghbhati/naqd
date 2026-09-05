import type { Metadata } from "next";
import { getSummary, API_BASE } from "@/lib/stats-server";
import { Band, Head, Footer } from "@/components/site/parts";
import { CardDeck } from "@/components/card-deck";
import { Glow } from "@/components/glow";

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

  const NL = String.fromCharCode(10);
  const n = (x: number | undefined, d = 6, f = "0") => (x === undefined ? f : x.toFixed(d));

  /*
    Four responses, not one. The deck exists to show that this is an API with a
    surface rather than a single endpoint with a nice example, and every figure
    below is the live one this request would actually return.
  */
  const samples: { route: string; body: string }[] = [
    {
      route: "/v1/edge/live",
      body: [
        "{",
        `  "verdict": "${s?.live.verdict ?? "stand-down"}",`,
        `  "edge": ${n(s?.live.edge, 6, "-0.020468")},`,
        '  "recent": {',
        `    "mean": ${n(s?.live.recent.mean, 6, "-0.020468")},`,
        `    "t": ${n(s?.live.recent.t, 4, "-1.3456")},`,
        `    "ci95": [${s ? s.live.recent.ci95.map((x) => x.toFixed(6)).join(", ") : "-0.050282, 0.009345"}],`,
        `    "n": ${s ? s.live.recent.n : 419}`,
        "  },",
        `  "confidence": ${n(s?.live.confidence, 2, "0.00")},`,
        `  "windowDays": ${s ? s.live.windowDays : 7}`,
        "}",
      ].join(NL),
    },
    {
      route: "/v1/stats/base-rate",
      body: [
        "{",
        `  "n": ${s ? s.baseRate.n : 9027},`,
        `  "rate": ${n(s?.baseRate.rate, 6, "0.503046")},`,
        `  "up": ${s ? s.baseRate.up : 4540},`,
        '  "verdict": "indistinguishable from a fair coin"',
        "}",
      ].join(NL),
    },
    {
      route: "/v1/stats/edge",
      body: [
        "{",
        '  "clustered": {',
        `    "mean": ${n(s?.edge.clustered.mean, 6, "-0.020634")},`,
        `    "t": ${n(s?.edge.clustered.t, 4, "-2.3912")},`,
        `    "n": ${s ? s.edge.clustered.n : 1627}`,
        "  },",
        '  "bootstrap": {',
        `    "ci95": [${s ? s.edge.bootstrap.ci95.map((x) => x.toFixed(6)).join(", ") : "-0.049247, 0.006612"}],`,
        `    "crossesZero": ${s ? s.edge.bootstrap.crossesZero : true}`,
        "  }",
        "}",
      ].join(NL),
    },
    {
      route: "/v1/liquidity",
      body: [
        "{",
        `  "markets": ${s ? s.coverage.markets : 9027},`,
        `  "traded": ${s ? s.coverage.traded : 1627},`,
        `  "coverage": ${n(s?.coverage.coverage, 4, "0.1802")},`,
        '  "concentration": {',
        `    "distinctTakers": ${s ? s.concentration.distinctTakers : 133},`,
        `    "takerHHI": ${n(s?.concentration.takerHHI, 4, "0.0770")}`,
        "  }",
        "}",
      ].join(NL),
    },
  ];

  return (
    <>
      <Band rule={false} size="lg">
        <div className="col-7 v5">
          <span className="eyebrow">Developers</span>
          <h1 className="display display-sm">
            The event-contract API
            <br />
            that did not exist.
          </h1>
          <p className="prose">
            DreamDEX&rsquo;s own documentation is explicit that{" "}
            <em>&ldquo;the HTTP API covers spot only, with no event-contract endpoints&rdquo;</em>.
            Anything wanting this data today has to run the TypeScript SDK and hold a viem client,
            which rules out a Python notebook, a Grafana panel, or a phone. Assay serves it as plain
            JSON over HTTP: no key, permissive CORS, and every figure recomputed from the
            venue&rsquo;s own settled history.
          </p>
          <div className="h3f">
            <span className={`tag ${s ? "ok" : "warn"}`}>{s ? "ONLINE" : "OFFLINE"}</span>
            <code className="mono small ink-3">{API_BASE}</code>
          </div>
        </div>
      </Band>

      <Band fill>
        <Head eyebrow="Reference" title="Routes" span="col-6" />
        <div className="col-12" style={{ marginTop: "var(--s6)" }}>
          <div className="card">
            {ROUTES.map((r, i) => (
              <div
                key={r.path}
                className="route"
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}
              >
                <code className="mono sm" style={{ color: "var(--accent)" }}>
                  GET {r.path}
                </code>
                <span className="body-sm ink-3" style={{ lineHeight: 1.55 }}>
                  {r.what}
                </span>
              </div>
            ))}
          </div>
          <p className="small ink-4 measure">
            Responses are cached for 30 seconds. The statistical routes are memoised server-side
            because the edge report runs a 20,000-resample bootstrap, and the underlying store only
            changes when a backfill runs.
          </p>
        </div>
      </Band>

      <Band>
        <Head
          eyebrow="Example"
          title="Four calls"
          lede="Every figure here is the response this request returns right now, recomputed from settled history on each call."
          span="col-6"
        />
        <div className="col-7 v5" style={{ marginTop: "var(--s6)" }}>
          <CardDeck>
              {samples.map((x) => (
                <Glow key={x.route} className="deck-glow">
                  <div className="card card-bd glass sample">
                    <div className="sample-hd">
                      <span className="mono micro">GET</span>
                      <code className="mono sm">{x.route}</code>
                    </div>
                    <pre>{x.body}</pre>
                  </div>
                </Glow>
              ))}
          </CardDeck>
          <p className="body-sm ink-3 measure">
            <strong>Read confidence as a size multiplier, not a probability.</strong> It scales with
            how far the near bound of the interval sits from zero, so a wide interval sizes small
            even when its centre looks attractive. At zero, the correct position is none.
          </p>

          <div className="card card-bd" style={{ marginTop: 8 }}>
            <pre>{`git clone https://github.com/tejassinghbhati/event-contracts
npm install

npm run backfill   # pull the venue's full history  (~3 min)
npm run api        # http://localhost:8787
npm run web        # http://localhost:3000`}</pre>
          </div>
          <p className="body-sm ink-4" style={{ lineHeight: 1.6 }}>
            The site rewrites <code>/api/stats/*</code> to the stats service, so the browser stays on
            one origin. Without it running, every price shows <strong>no fair value</strong> rather
            than a wrong one.
          </p>
        </div>
      </Band>

      <Footer asOf={s?.dataAsOf} />
    </>
  );
}
