import Link from "next/link";
import { getSummary } from "@/lib/stats-server";
import { EdgeGauge, ForestPlot, type ForestRow } from "@/components/charts";
import { CalibrationField } from "@/components/hero";
import { HeroLive } from "@/components/hero-live";
import { OfflineNotice } from "@/components/offline-notice";
import { Section, SectionHead, StatBand, SiteFooter, TextCta } from "@/components/site/parts";

const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const num = (n: number) => n.toLocaleString("en-US");

/**
 * The landing page.
 *
 * Structured as an argument rather than a feature list, because the argument is
 * the product: the venue's prices are unaudited, we audited them, and the
 * result is more interesting than "we found an edge". The four instruments come
 * AFTER the finding, since without it they are just four things.
 */
export default async function Landing() {
  const s = await getSummary();

  const forest: ForestRow[] | null = s
    ? [
        {
          label: "Per fill",
          unit: `${num(s.edge.naive.n)} fills`,
          mean: s.edge.naive.mean,
          ci: s.edge.naive.ci95,
          detail: `t = ${s.edge.naive.t.toFixed(2)}`,
        },
        {
          label: "Clustered by market",
          unit: `${num(s.edge.clustered.n)} markets`,
          mean: s.edge.clustered.mean,
          ci: s.edge.clustered.ci95,
          detail: `t = ${s.edge.clustered.t.toFixed(2)}`,
        },
        {
          label: "Week-block bootstrap",
          unit: `${s.edge.bootstrap.blocks} weeks`,
          mean: s.edge.bootstrap.mean,
          ci: s.edge.bootstrap.ci95,
          detail: "resamples whole weeks",
        },
      ]
    : null;

  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="hero">
        {s && <CalibrationField bins={s.calibration.byMarket} />}

        <div className="wrap hero-inner">
          <div className="glass hero-card">
            <div className="hero-col">
              <span className="eyebrow">Assay office · DreamDEX event contracts</span>
              <h1 className="display hero-title">Trust,
                <br />
                but assay.</h1>
              <p className="prose hero-lede">
                An assay office tests metal for what it is genuinely made of. We do that to prices.
                DreamDEX settles a BTC and an ETH contract every fifteen minutes, which makes this
                the one venue where you can measure whether a quote is <em>truly calibrated</em> -
                continuously, across thousands of resolved outcomes.
              </p>
              <div className="hero-cta">
                <TextCta href="/research">Read the assay</TextCta>
              </div>
            </div>

            <div className="hero-col hero-col-right">
              <HeroLive stats={s} />

              {s ? (
                <div className="hero-verdict">
                  <div className="row" style={{ gap: 9, justifyContent: "space-between" }}>
                    <span className="lbl">Standing reading</span>
                    <span className="row" style={{ gap: 7 }}>
                      <span className={`dot ${s.live.verdict === "trade" ? "live" : "warn"}`} />
                      <span
                        className="mono"
                        style={{ fontSize: 12, color: s.live.verdict === "trade" ? "var(--ok)" : "var(--warn)" }}
                      >
                        {s.live.verdict === "trade" ? "EDGE PRESENT" : "NO EDGE"}
                      </span>
                    </span>
                  </div>
                  <EdgeGauge estimate={s.live.recent} point={s.live.edge} />
                  <dl className="hero-facts">
                    <div>
                      <dt className="lbl">Assayed</dt>
                      <dd className="mono">{num(s.baseRate.n)}</dd>
                    </div>
                    <div>
                      <dt className="lbl">Window</dt>
                      <dd className="mono">{s.live.windowDays}d</dd>
                    </div>
                    <div>
                      <dt className="lbl">Brier skill</dt>
                      <dd className="mono">{s.calibration.brierSkill.toFixed(3)}</dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <OfflineNotice />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Problem */}
      <Section tone="sunk">
        <div className="split">
          <SectionHead
            eyebrow="The problem"
            title={<>Nobody checks whether a prediction market is telling the truth.</>}
          />
          <div className="stack" style={{ gap: 18 }}>
            <p className="prose">
              A venue quotes 70% and you either take it or you do not. There is no assay office for
              prices: no independent party asking whether markets priced at 70% actually resolve that
              way, and no way to know whether the number you are paying is well-calibrated or merely
              confident.
            </p>
            <p className="prose">
              Everywhere else that question is impractical, because outcomes take months to arrive.
              Here they arrive every fifteen minutes. Which makes this the one venue where the
              question can actually be answered.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ Finding */}
      <Section id="finding">
        <SectionHead
          eyebrow="What we found"
          title={
            <>
              The edge is real. It is also
              <br />
              not constant.
            </>
          }
          lede="Measure the same average pricing error three ways and you get three different answers, ranging from obviously real to indistinguishable from noise. Only the last one is honest."
        />

        {s && forest ? (
          <div className="finding-grid">
            <div className="panel panel-bd">
              <ForestPlot rows={forest} />
            </div>

            <div className="stack" style={{ gap: 20 }}>
              <div className="beat">
                <span className="beat-n mono">01</span>
                <div>
                  <h3 className="beat-h">It looks obvious</h3>
                  <p className="sm dim">
                    Pooled across every fill, UP is overpriced by {cents(Math.abs(s.edge.naive.mean))}{" "}
                    at t = {s.edge.naive.t.toFixed(2)}. Publishable, on the face of it.
                  </p>
                </div>
              </div>
              <div className="beat">
                <span className="beat-n mono">02</span>
                <div>
                  <h3 className="beat-h">The sample is a fiction</h3>
                  <p className="sm dim">
                    Every fill inside one fifteen-minute window shares a single outcome. Those{" "}
                    {num(s.edge.naive.n)} observations are really {num(s.edge.clustered.n)} coin
                    flips, which drops t to {s.edge.clustered.t.toFixed(2)}.
                  </p>
                </div>
              </div>
              <div className="beat">
                <span className="beat-n mono">03</span>
                <div>
                  <h3 className="beat-h">And it moves</h3>
                  <p className="sm dim">
                    Whole weeks run rich, then cheap. Resample entire weeks and the interval lands at
                    [{cents(s.edge.bootstrap.ci95[0])}, {cents(s.edge.bootstrap.ci95[1])}]
                    {s.edge.bootstrap.crossesZero ? ", straddling zero." : "."}
                  </p>
                </div>
              </div>

              <div className="callout" style={{ marginTop: 4 }}>
                A bot that hard-codes &ldquo;always fade UP&rdquo; is fitting last month&rsquo;s
                weather. What the data supports is measuring continuously and standing down when the
                measurement says nothing.
              </div>

              <TextCta href="/research" size="md">
                See the full method
              </TextCta>
            </div>
          </div>
        ) : (
          <OfflineNotice />
        )}
      </Section>

      {/* ------------------------------------------------------------- Proof */}
      {s && (
        <Section tone="sunk">
          <SectionHead
            eyebrow="Measured, not assumed"
            title="What the venue's own history says"
          />
          <StatBand
            items={[
              { k: "Markets settled", v: num(s.baseRate.n), s: "BTC and ETH" },
              { k: "Closed up", v: pct(s.baseRate.rate), s: "a fair coin" },
              { k: "Ever traded", v: pct(s.coverage.coverage, 1), s: `${num(s.coverage.markets - s.coverage.traded)} never quoted` },
              { k: "Brier skill", v: s.calibration.brierSkill.toFixed(3), s: "vs a coin flip" },
              { k: "Maker ROI", v: `+${pct(s.makerVsTaker.maker.roi)}`, s: "passive side", tone: "ok" },
              { k: "Taker ROI", v: pct(s.makerVsTaker.taker.roi), s: "aggressive side", tone: "bad" },
            ]}
          />
          <p className="sm dimmer" style={{ marginTop: 18, maxWidth: "68ch", lineHeight: 1.6 }}>
            Two of these shape everything we built. The underlying is a coin flip, so any edge has to
            come from the price being wrong rather than the asset moving. And makers get paid while
            takers do not, on a venue that charges no fees at all, so every order we place is
            post-only.
          </p>
        </Section>
      )}

      {/* ------------------------------------------------------- Instruments */}
      <Section id="instruments">
        <SectionHead
          eyebrow="Four instruments"
          title="What that measurement buys you"
          lede="Each of these exists because of a finding above. None of them is a feature we thought sounded good."
        />
        <div className="grid-2x2">
          {[
            {
              n: "01",
              h: "Measurement engine",
              p: "Pulls the venue's entire binary-market history into a local store, then computes calibration curves, cluster-robust and block-bootstrapped edge estimates, settled per-wallet PnL and liquidity coverage. The database is a plain file you can open and check the arithmetic against.",
              href: "/research",
              cta: "Read the report",
            },
            {
              n: "02",
              h: "Public event-contract API",
              p: "DreamDEX's own HTTP API covers spot only, so anything wanting this data has to run the TypeScript SDK and hold a viem client. Assay serves it as plain JSON: no key, permissive CORS, every figure recomputed from settled history.",
              href: "/developers",
              cta: "Browse the routes",
            },
            {
              n: "03",
              h: "Trading terminal",
              p: "Live books, countdowns, depth and tape, with the measured fair value beside every price and a RICH / CHEAP / IN LINE read on each market. Post-only by default, because settled PnL pays the passive side and charges the aggressive one.",
              href: "/terminal",
              cta: "Open the desk",
            },
            {
              n: "04",
              h: "Market-making agent",
              p: "Quotes both sides around an edge-corrected fair value, sized to the near bound of the interval rather than its centre. Its default state is flat: four conditions must hold before it places anything at all.",
              href: "/agent",
              cta: "See the gate",
            },
          ].map((c) => (
            <Link key={c.h} href={c.href} className="panel panel-bd instrument instrument-card">
              <span className="instrument-n mono">{c.n}</span>
              <h3 className="display" style={{ fontSize: 22 }}>
                {c.h}
              </h3>
              <p className="sm dim" style={{ lineHeight: 1.65 }}>
                {c.p}
              </p>
              <span className="sm instrument-link">
                {c.cta} <span aria-hidden="true">&rarr;</span>
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* -------------------------------------------------------- Developers */}
      <Section tone="sunk">
        <div className="split">
          <SectionHead
            eyebrow="For developers"
            title={<>The event-contract API that did not exist.</>}
            lede="Plain JSON over HTTP. No key, permissive CORS, usable from a notebook, a Grafana panel or a phone."
          />
          <div className="stack" style={{ gap: 16 }}>
            <div className="panel panel-bd">
              <pre className="mono code-block">{`GET /v1/edge/live

{
  "verdict": "${s?.live.verdict ?? "stand-down"}",
  "edge": ${s ? s.live.edge.toFixed(6) : "-0.020468"},
  "recent": {
    "ci95": [${s ? s.live.recent.ci95.map((x) => x.toFixed(4)).join(", ") : "-0.0503, 0.0093"}],
    "n": ${s ? s.live.recent.n : 419}
  },
  "confidence": ${s ? s.live.confidence.toFixed(2) : "0.00"}
}`}</pre>
            </div>
            <TextCta href="/developers" size="md">
              Full reference
            </TextCta>
          </div>
        </div>
      </Section>

      <SiteFooter asOf={s?.dataAsOf} />
    </>
  );
}
