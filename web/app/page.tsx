import Link from "next/link";
import { getSummary } from "@/lib/stats-server";
import { EdgeGauge, ForestPlot, type ForestRow } from "@/components/charts";
import { HeroLive } from "@/components/hero-live";
import { Ribbon } from "@/components/ribbon";
import { OfflineNotice } from "@/components/offline-notice";
import { Band, Head, Figures, Cta, Footer } from "@/components/site/parts";

const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const num = (n: number) => n.toLocaleString("en-US");

/**
 * The landing page.
 *
 * An argument, not a feature list. The venue's prices are unaudited; we audited
 * them; the result is more interesting than "we found an edge". The instruments
 * come last, because without the finding they are just four things.
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
      {/* ------------------------------------------------------------- Hero */}
      <section className="hero">
        <div className="grid">
          <div className="col-12 hero-stack">
            <span className="eyebrow">Assay office · DreamDEX event contracts</span>
            <h1 className="display">Trust, but assay.</h1>
            <p className="prose hero-lede">
              An assay office tests metal for what it is genuinely made of. We do that to prices,
              across every event contract this venue settles.
            </p>
            <div className="h3f">
              <Link href="/research" className="btn btn-pill btn-pill-lg">
                Read the assay
              </Link>
              <Link href="/terminal" className="btn btn-ghost btn-lg">
                Open the terminal
              </Link>
            </div>
          </div>
        </div>

        {/* The measurement, swept into a surface. Its bend is the venue's
            calibration error, exaggerated for scale but true in shape. */}
        <Ribbon bins={s?.calibration.byMarket ?? []} />
      </section>

      {/* -------------------------------------------------------- Live strip */}
      <Band rule={false} size="sm">
        <div className="col-6 v5">
          <HeroLive stats={s} />
        </div>
        <div className="col-5 start-8 v5">
          {s ? (
            <div className="reading">
              <div className="between">
                <span className="eyebrow">Standing reading</span>
                <span className="h2f">
                  <span className={`dot ${s.live.verdict === "trade" ? "live" : "warn"}`} />
                  <span
                    className="mono micro"
                    style={{ color: s.live.verdict === "trade" ? "var(--ok)" : "var(--warn)" }}
                  >
                    {s.live.verdict === "trade" ? "EDGE PRESENT" : "NO EDGE"}
                  </span>
                </span>
              </div>
              <EdgeGauge estimate={s.live.recent} point={s.live.edge} />
              <dl className="reading-facts">
                <div>
                  <dt className="eyebrow">Assayed</dt>
                  <dd>{num(s.baseRate.n)}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Window</dt>
                  <dd>{s.live.windowDays}d</dd>
                </div>
                <div>
                  <dt className="eyebrow">Brier</dt>
                  <dd>{s.calibration.brierSkill.toFixed(3)}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <OfflineNotice />
          )}
        </div>
      </Band>

      {/* ---------------------------------------------------------- Problem */}
      <Band fill>
        <Head
          eyebrow="The problem"
          title="Nobody checks whether a prediction market is telling the truth."
        />
        <div className="col-5 start-7 v4">
          <p className="prose">
            A venue quotes 70% and you either take it or you do not. There is no assay office for
            prices: no independent party asking whether markets priced at 70% actually resolve that
            way, and no way to know whether the number you are paying is well-calibrated or merely
            confident.
          </p>
          <p className="prose">
            Everywhere else that question is impractical, because outcomes take months to arrive.
            Here they arrive every fifteen minutes. Which makes this the one venue where the question
            can actually be answered.
          </p>
        </div>
      </Band>

      {/* ---------------------------------------------------------- Finding */}
      <Band id="finding">
        <Head
          eyebrow="What we found"
          title={<>The edge is real. It is also not constant.</>}
          lede="Measure the same average pricing error three ways and you get three different answers, ranging from obviously real to indistinguishable from noise. Only the last one is honest."
          span="col-6"
        />

        {s && forest ? (
          <>
            <div className="col-7 v5" style={{ marginTop: "var(--s7)" }}>
              <figure>
                <ForestPlot rows={forest} />
                <figcaption>
                  The point estimate barely moves. The <em>interval</em> is what changes, and the
                  interval is what decides whether there is anything to trade.
                </figcaption>
              </figure>
            </div>

            <div className="col-4 start-9 v5" style={{ marginTop: "var(--s7)" }}>
              <ol className="seq">
                {[
                  {
                    n: "01",
                    h: "It looks obvious",
                    p: `Pooled across every fill, UP is overpriced by ${(Math.abs(s.edge.naive.mean) * 100).toFixed(2)}¢ at t = ${s.edge.naive.t.toFixed(2)}. Publishable, on the face of it.`,
                  },
                  {
                    n: "02",
                    h: "The sample is a fiction",
                    p: `Every fill inside one fifteen-minute window shares a single outcome. Those ${num(s.edge.naive.n)} observations are really ${num(s.edge.clustered.n)} coin flips, which drops t to ${s.edge.clustered.t.toFixed(2)}.`,
                  },
                  {
                    n: "03",
                    h: "And it moves",
                    p: `Whole weeks run rich, then cheap. Resample entire weeks and the interval lands at [${cents(s.edge.bootstrap.ci95[0])}, ${cents(s.edge.bootstrap.ci95[1])}]${s.edge.bootstrap.crossesZero ? ", straddling zero." : "."}`,
                  },
                ].map((b) => (
                  <li key={b.n} className="seq-item">
                    <span className="seq-n">{b.n}</span>
                    <div className="v2">
                      <h3 className="h4">{b.h}</h3>
                      <p className="body-sm">{b.p}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="pull">
                A bot that hard-codes &ldquo;always fade UP&rdquo; is fitting last month&rsquo;s
                weather. What the data supports is measuring continuously and standing down when the
                measurement says nothing.
              </p>

              <Cta href="/research" small>
                See the full method
              </Cta>
            </div>
          </>
        ) : (
          <div className="col-12">
            <OfflineNotice />
          </div>
        )}
      </Band>

      {/* ------------------------------------------------------------ Proof */}
      {s && (
        <Band fill>
          <Head eyebrow="Measured, not assumed" title="What the venue's own history says" span="col-6" />
          <div className="col-12" style={{ marginTop: "var(--s6)" }}>
            <Figures
              items={[
                { k: "Markets settled", v: num(s.baseRate.n), s: "BTC and ETH" },
                { k: "Closed up", v: pct(s.baseRate.rate), s: "a fair coin" },
                {
                  k: "Ever traded",
                  v: pct(s.coverage.coverage, 1),
                  s: `${num(s.coverage.markets - s.coverage.traded)} never quoted`,
                },
                { k: "Brier skill", v: s.calibration.brierSkill.toFixed(3), s: "vs a coin flip" },
                { k: "Maker ROI", v: `+${pct(s.makerVsTaker.maker.roi)}`, s: "passive side", tone: "ok" },
                { k: "Taker ROI", v: pct(s.makerVsTaker.taker.roi), s: "aggressive side", tone: "bad" },
              ]}
            />
          </div>
          <p className="col-6 body-sm" style={{ marginTop: "var(--s5)" }}>
            Two of these shaped everything we built. The underlying is a coin flip, so any edge has to
            come from the price being wrong rather than the asset moving. And the passive side is the
            one that wins, thinly, on a venue that charges no fees at all, so every order we
            place is post-only.
          </p>
        </Band>
      )}

      {/* ------------------------------------------------------ Instruments */}
      <Band id="instruments">
        <Head
          eyebrow="Four instruments"
          title="What that measurement buys you"
          lede="Each exists because of a finding above. None of them is a feature we thought sounded good."
          span="col-6"
        />
        <div className="col-12" style={{ marginTop: "var(--s6)" }}>
          <div className="grid" style={{ padding: 0, maxWidth: "none", columnGap: "var(--s7)" }}>
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
                p: "Live books, countdowns, depth and tape, with the measured fair value beside every price and a rich / cheap / in-line read on each market. Post-only by default, because settled PnL favours the passive side.",
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
              <Link key={c.h} href={c.href} className="col-6 instrument">
                <span className="instrument-n">{c.n}</span>
                <h3 className="h3">{c.h}</h3>
                <p className="body-sm">{c.p}</p>
                <span className="instrument-cta">
                  {c.cta} <span aria-hidden="true">&rarr;</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </Band>

      {/* ------------------------------------------------------- Developers */}
      <Band fill>
        <Head
          eyebrow="For developers"
          title="The event-contract API that did not exist."
          lede="Plain JSON over HTTP. No key, permissive CORS, usable from a notebook, a Grafana panel or a phone."
        />
        <div className="col-6 start-7 v5">
          <div className="card card-bd">
            <pre>{`GET /v1/edge/live

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
          <Cta href="/developers" small>
            Full reference
          </Cta>
        </div>
      </Band>

      <Footer asOf={s?.dataAsOf} />
    </>
  );
}
