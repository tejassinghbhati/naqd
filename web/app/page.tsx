import Link from "next/link";
import { getSummary } from "@/lib/stats-server";
import { EdgeGauge } from "@/components/charts";
import { OfflineNotice } from "@/components/offline-notice";

const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const num = (n: number) => n.toLocaleString("en-US");

export default async function Overview() {
  const s = await getSummary();

  return (
    <>
      <section className="section" style={{ paddingBottom: 34 }}>
        <div className="wrap hero">
          <div className="stack" style={{ gap: 14 }}>
            <span className="eyebrow">DreamDEX event contracts · Somnia</span>
            <h1 style={{ fontSize: "clamp(28px, 5vw, 44px)", lineHeight: 1.1 }}>
              When this venue says 70%, does it happen 70% of the time?
            </h1>
            <p className="prose" style={{ fontSize: 16 }}>
              DreamDEX settles a BTC and an ETH event contract every 15 minutes. That cadence makes
              something possible no other prediction market allows: you can measure whether the
              venue&rsquo;s prices are <em>actually calibrated</em>, continuously, across thousands of
              resolved outcomes. Calibra measures it, publishes it as an API, and trades against the
              answer &mdash; standing down when there is nothing to trade.
            </p>
            <div className="row" style={{ marginTop: 4 }}>
              <Link href="/research" className="btn btn-primary btn-lg">
                Read the finding
              </Link>
              <Link href="/terminal" className="btn btn-lg">
                Open the terminal
              </Link>
            </div>
          </div>

          {s ? (
            <div className="panel">
              <div className="panel-hd">
                <h3>Live verdict</h3>
                <span className="lbl">last {s.live.windowDays} days · {num(s.live.sampleMarkets)} markets</span>
              </div>
              <div className="panel-bd stack" style={{ gap: 12 }}>
                <div className="stack" style={{ gap: 12 }}>
                  <div className="row" style={{ gap: 9 }}>
                    <span className={`dot ${s.live.verdict === "trade" ? "live" : "warn"}`} />
                    <span
                      className="mono"
                      style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: s.live.verdict === "trade" ? "var(--ok)" : "var(--warn)",
                      }}
                    >
                      {s.live.verdict === "trade" ? "TRADE" : "STAND DOWN"}
                    </span>
                  </div>
                  <EdgeGauge estimate={s.live.recent} point={s.live.edge} />
                </div>
                <p className="sm dim measure">{s.live.reason}</p>
              </div>
            </div>
          ) : (
            <OfflineNotice />
          )}
        </div>
      </section>

      {s && (
        <section className="section">
          <div className="wrap stack" style={{ gap: 20 }}>
            <div className="stack-sm">
              <span className="eyebrow">Measured, not assumed</span>
              <h2 style={{ fontSize: 22 }}>What the venue&rsquo;s own history says</h2>
            </div>

            <div className="tiles">
              <div className="tile">
                <div className="k">Markets settled</div>
                <div className="v">{num(s.baseRate.n)}</div>
                <div className="s">BTC and ETH</div>
              </div>
              <div className="tile">
                <div className="k">Closed up</div>
                <div className="v">{pct(s.baseRate.rate)}</div>
                <div className="s">a fair coin</div>
              </div>
              <div className="tile">
                <div className="k">Ever traded</div>
                <div className="v">{pct(s.coverage.coverage, 1)}</div>
                <div className="s">{num(s.coverage.markets - s.coverage.traded)} never quoted</div>
              </div>
              <div className="tile">
                <div className="k">Brier skill</div>
                <div className="v">{s.calibration.brierSkill.toFixed(3)}</div>
                <div className="s">vs a coin flip</div>
              </div>
              <div className="tile">
                <div className="k">Maker ROI</div>
                <div className="v md" style={{ color: "var(--ok)" }}>
                  +{pct(s.makerVsTaker.maker.roi)}
                </div>
                <div className="s">passive side</div>
              </div>
              <div className="tile">
                <div className="k">Taker ROI</div>
                <div className="v md" style={{ color: "var(--bad)" }}>
                  {pct(s.makerVsTaker.taker.roi)}
                </div>
                <div className="s">aggressive side</div>
              </div>
            </div>

            <div className="callout">
              <strong>The result that shapes everything else:</strong> the pricing error is real but{" "}
              <em>not constant</em>. Pooled per fill it reads {cents(s.edge.naive.mean)} at t ={" "}
              {s.edge.naive.t.toFixed(2)}. But fills inside one market share a single outcome, so
              clustering by market gives t = {s.edge.clustered.t.toFixed(2)} &mdash; and a bootstrap over
              whole weeks puts the interval at [{cents(s.edge.bootstrap.ci95[0])},{" "}
              {cents(s.edge.bootstrap.ci95[1])}], which{" "}
              {s.edge.bootstrap.crossesZero ? "straddles zero" : "clears zero"}.{" "}
              <Link href="/research">See how that number falls apart &rarr;</Link>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap stack" style={{ gap: 20 }}>
          <div className="stack-sm">
            <span className="eyebrow">Four pieces</span>
            <h2 style={{ fontSize: 22 }}>What is here</h2>
          </div>
          <div className="grid-2x2">
            {[
              {
                h: "Measurement engine",
                p: "Pulls the venue's entire binary-market history into a local store, then computes calibration curves, cluster-robust and block-bootstrapped edge estimates, settled per-wallet PnL and liquidity coverage. The database is a plain file you can open and check the arithmetic against.",
              },
              {
                h: "Public event-contract API",
                p: "DreamDEX's own HTTP API covers spot only, so anything wanting this data has to run the TypeScript SDK. Calibra serves it as plain JSON, no key, permissive CORS.",
                href: "/api-docs",
                cta: "Browse the routes",
              },
              {
                h: "Trading terminal",
                p: "Live books, countdowns, depth and tape, with the measured fair value beside every price. Post-only by default, because settled PnL pays the passive side and charges the aggressive one.",
                href: "/terminal",
                cta: "Open it",
              },
              {
                h: "Market-making agent",
                p: "Quotes both sides around an edge-corrected fair value, sized to the near bound of the interval rather than its centre. Its default state is flat: it takes positive evidence to make it quote at all.",
              },
            ].map((c) => (
              <div key={c.h} className="panel panel-bd stack" style={{ gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>{c.h}</h3>
                <p className="sm dim" style={{ lineHeight: 1.6 }}>
                  {c.p}
                </p>
                {c.href && (
                  <Link href={c.href} className="sm" style={{ color: "var(--accent)", marginTop: 2 }}>
                    {c.cta} &rarr;
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap between">
          <span>
            Built for the{" "}
            <a href="https://dorahacks.io/hackathon/event-contracts/detail" target="_blank" rel="noreferrer">
              Somnia × DreamDEX Event Contracts Hackathon
            </a>
            .
          </span>
          <span className="dimmer">
            {s ? `Data as of ${new Date(s.dataAsOf * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "Stats API offline"}
          </span>
        </div>
      </footer>
    </>
  );
}
