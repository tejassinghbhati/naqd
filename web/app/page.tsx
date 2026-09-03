import Link from "next/link";
import { getSummary } from "@/lib/stats-server";
import { EdgeGauge } from "@/components/charts";
import { CalibrationField } from "@/components/hero";
import { OfflineNotice } from "@/components/offline-notice";

const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const num = (n: number) => n.toLocaleString("en-US");

export default async function Overview() {
  const s = await getSummary();

  return (
    <>
      {/*
        Hero. The reference puts a dark glass panel over a lit field and splits
        it with a single hairline: thesis on the left, the thing you can act on
        on the right. Same structure here, with our own measurement as the light.
      */}
      <section className="hero">
        {s && <CalibrationField bins={s.calibration.byMarket} />}

        <div className="wrap hero-inner">
          <div className="glass hero-card">
            <div className="hero-col">
              <span className="eyebrow">What we do</span>
              <h1 className="display hero-title">
                We test what a price
                <br />
                is actually made of.
              </h1>
              <p className="prose hero-lede">
                DreamDEX settles a BTC and an ETH event contract every fifteen minutes. That cadence
                makes something possible no other prediction market allows: you can measure whether
                the venue&rsquo;s prices are <em>truly calibrated</em>, continuously, across thousands
                of resolved outcomes.
              </p>
              <div className="hero-cta">
                <Link href="/research" className="cta-text">
                  Read the assay
                  <span className="arw">&rarr;</span>
                </Link>
              </div>
            </div>

            <div className="hero-col hero-col-right">
              <span className="eyebrow">Current reading</span>

              {s ? (
                <>
                  <div className="verdict">
                    <span className={`dot ${s.live.verdict === "trade" ? "live" : "warn"}`} />
                    <span
                      className="verdict-word"
                      style={{ color: s.live.verdict === "trade" ? "var(--ok)" : "var(--warn)" }}
                    >
                      {s.live.verdict === "trade" ? "Edge present" : "No edge"}
                    </span>
                  </div>

                  <EdgeGauge estimate={s.live.recent} point={s.live.edge} />

                  <p className="sm dim" style={{ lineHeight: 1.6 }}>
                    {s.live.reason}
                  </p>

                  <dl className="hero-facts">
                    <div>
                      <dt className="lbl">Markets assayed</dt>
                      <dd className="mono">{num(s.baseRate.n)}</dd>
                    </div>
                    <div>
                      <dt className="lbl">Window</dt>
                      <dd className="mono">last {s.live.windowDays}d</dd>
                    </div>
                    <div>
                      <dt className="lbl">Brier skill</dt>
                      <dd className="mono">{s.calibration.brierSkill.toFixed(3)}</dd>
                    </div>
                  </dl>

                  <Link href="/terminal" className="btn" style={{ justifyContent: "center" }}>
                    Open the terminal
                  </Link>
                </>
              ) : (
                <OfflineNotice />
              )}
            </div>
          </div>
        </div>
      </section>

      {s && (
        <section className="section">
          <div className="wrap stack" style={{ gap: 30 }}>
            <div className="stack-sm">
              <span className="eyebrow">Measured, not assumed</span>
              <h2 className="display" style={{ fontSize: "clamp(26px, 3.2vw, 38px)" }}>
                What the venue&rsquo;s own history says
              </h2>
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
              clustering by market gives t = {s.edge.clustered.t.toFixed(2)}, and a bootstrap over
              whole weeks puts the interval at [{cents(s.edge.bootstrap.ci95[0])},{" "}
              {cents(s.edge.bootstrap.ci95[1])}], which{" "}
              {s.edge.bootstrap.crossesZero ? "straddles zero" : "clears zero"}.
            </div>

            <Link href="/research" className="cta-text" style={{ fontSize: "clamp(20px, 2.4vw, 26px)" }}>
              See how that number falls apart
              <span className="arw">&rarr;</span>
            </Link>
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap stack" style={{ gap: 30 }}>
          <div className="stack-sm">
            <span className="eyebrow">Four instruments</span>
            <h2 className="display" style={{ fontSize: "clamp(26px, 3.2vw, 38px)" }}>
              What is here
            </h2>
          </div>
          <div className="grid-2x2">
            {[
              {
                n: "01",
                h: "Measurement engine",
                p: "Pulls the venue's entire binary-market history into a local store, then computes calibration curves, cluster-robust and block-bootstrapped edge estimates, settled per-wallet PnL and liquidity coverage. The database is a plain file you can open and check the arithmetic against.",
              },
              {
                n: "02",
                h: "Public event-contract API",
                p: "DreamDEX's own HTTP API covers spot only, so anything wanting this data has to run the TypeScript SDK. Assay serves it as plain JSON, no key, permissive CORS.",
                href: "/api-docs",
                cta: "Browse the routes",
              },
              {
                n: "03",
                h: "Trading terminal",
                p: "Live books, countdowns, depth and tape, with the measured fair value beside every price. Post-only by default, because settled PnL pays the passive side and charges the aggressive one.",
                href: "/terminal",
                cta: "Open it",
              },
              {
                n: "04",
                h: "Market-making agent",
                p: "Quotes both sides around an edge-corrected fair value, sized to the near bound of the interval rather than its centre. Its default state is flat: it takes positive evidence to make it quote at all.",
              },
            ].map((c) => (
              <div key={c.h} className="panel panel-bd instrument">
                <span className="instrument-n mono">{c.n}</span>
                <h3 className="display" style={{ fontSize: 21 }}>
                  {c.h}
                </h3>
                <p className="sm dim" style={{ lineHeight: 1.65 }}>
                  {c.p}
                </p>
                {c.href && (
                  <Link href={c.href} className="sm instrument-link">
                    {c.cta} <span aria-hidden="true">&rarr;</span>
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
          <span className="dimmer mono xs">
            {s
              ? `Assayed ${new Date(s.dataAsOf * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`
              : "Stats API offline"}
          </span>
        </div>
      </footer>
    </>
  );
}
