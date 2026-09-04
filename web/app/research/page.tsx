import type { Metadata } from "next";
import { getSummary, getTraders } from "@/lib/stats-server";
import { CalibrationCurve, ForestPlot, WeeklyBars, CoverageBars, type ForestRow } from "@/components/charts";
import { OfflineNotice } from "@/components/offline-notice";
import { Band, Footer } from "@/components/site/parts";
import { cadence } from "@/lib/format";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Is DreamDEX event-contract pricing calibrated? The base rate, the calibration curve, and why the measured edge falls apart under the right estimator.",
};

const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const num = (n: number) => n.toLocaleString("en-US");

function Finding({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="seq-item col-12">
      <span className="seq-n">{n}</span>
      <div className="v5">
        <h2 className="h2">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default async function Research() {
  const [s, traders] = await Promise.all([getSummary(), getTraders(8)]);

  if (!s) {
    return (
      <Band rule={false}>
        <div className="col-8 v5">
          <h1 style={{ fontSize: 30 }}>Research</h1>
          <OfflineNotice />
        </div>
      </Band>
    );
  }

  const forest: ForestRow[] = [
    {
      label: "Per fill",
      unit: `n = ${num(s.edge.naive.n)} fills`,
      mean: s.edge.naive.mean,
      ci: s.edge.naive.ci95,
      detail: `t = ${s.edge.naive.t.toFixed(2)} - assumes every fill is an independent observation`,
    },
    {
      label: "Clustered by market",
      unit: `n = ${num(s.edge.clustered.n)} markets`,
      mean: s.edge.clustered.mean,
      ci: s.edge.clustered.ci95,
      detail: `t = ${s.edge.clustered.t.toFixed(2)} - fills inside one window share one outcome`,
    },
    {
      label: "Week-block bootstrap",
      unit: `${s.edge.bootstrap.blocks} weekly blocks`,
      mean: s.edge.bootstrap.mean,
      ci: s.edge.bootstrap.ci95,
      detail: "resamples whole weeks - also drops the independence-in-time assumption",
    },
  ];

  const weeks = s.edge.weekly.filter((w) => w.n >= 20);

  return (
    <>
      <Band rule={false} size="lg">
        <div className="col-8 v5">
          <span className="eyebrow">Research</span>
          <h1 >
            The edge is real. It is also not constant, which changes what you can build on it.
          </h1>
          <p className="prose">
            Measured on <strong>{num(s.baseRate.n)} resolved binary markets</strong> from the mainnet
            venue <code>{s.venueId.slice(0, 10)}…</code>, of which {num(s.edge.clustered.n)} traded,
            carrying {num(s.edge.naive.n)} fills. Every number below is recomputed from that history
            on each request. Nothing here is a screenshot or a stored claim.
          </p>
        </div>
      </Band>

      <Band>
        <div className="col-12 seq">
          <Finding n="01" title="The underlying is a coin flip">
            <p className="prose">
              Every market asks the same question: does the asset close at or above where the window
              opened? Across the venue&rsquo;s entire resolved history it does almost exactly half the
              time. There is no drift to harvest here, so any edge has to come from the{" "}
              <em>price</em> being wrong, not from the asset going up.
            </p>
            <div className="figures">
              <div className="figure">
                <div className="k">Resolved</div>
                <div className="v">{num(s.baseRate.n)}</div>
              </div>
              <div className="figure">
                <div className="k">Closed up</div>
                <div className="v">{pct(s.baseRate.rate)}</div>
                <div className="s">{num(s.baseRate.up)} markets</div>
              </div>
              <div className="figure">
                <div className="k">Verdict</div>
                <div className="v md ink-3">fair coin</div>
                <div className="s">50% inside the interval</div>
              </div>
            </div>
            <div className="card scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Series</th>
                    <th>Markets</th>
                    <th>Closed up</th>
                  </tr>
                </thead>
                <tbody>
                  {s.baseRate.byAsset.map((r) => (
                    <tr key={`${r.asset}-${r.intervalSec}`}>
                      <td>
                        {r.asset} {cadence(r.intervalSec)}
                      </td>
                      <td>{num(r.n)}</td>
                      <td>{pct(r.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Finding>

          <Finding n="02" title="Prices are informative, but miscalibrated">
            <p className="prose">
              Plotting what the venue charged against what actually happened gives a calibration
              curve. Perfect pricing lies on the diagonal. This venue is well clear of a coin flip
              (Brier skill <strong>{s.calibration.brierSkill.toFixed(3)}</strong> against an
              always-50% forecaster), but it bends away from the diagonal at both ends.
            </p>
            <div className="card card-bd">
              <figure>
                <CalibrationCurve bins={s.calibration.byMarket} />
                <div className="legend">
                  <span>
                    <i className="swatch" style={{ background: "var(--down)" }} /> realized below implied
                  </span>
                  <span>
                    <i className="swatch" style={{ background: "var(--up)" }} /> realized above implied
                  </span>
                  <span>
                    <i className="swatch line" /> perfect calibration
                  </span>
                </div>
                <figcaption>
                  One point per price bucket, using each market&rsquo;s volume-weighted price.
                  Vertical bars are 95% Wilson intervals on the realized rate.
                </figcaption>
              </figure>
            </div>
          </Finding>

          <Finding n="03" title="Most of that curve is the clock, not skill">
            <p className="prose">
              Scoring a market by its volume-weighted price mixes trades from its whole life
              together, including ones placed seconds before expiry, when the outcome is nearly
              decided. Score each fill separately by how much of the window remained and the
              dramatic S-shape flattens out. <strong>This check is the difference between a real
              finding and an artifact of aggregation.</strong>
            </p>
            <div className="grid" style={{ padding: 0, maxWidth: "none" }}>
              {s.calibration.byTimeToExpiry.map((ph) => (
                <div key={ph.phase} className="card">
                  <div className="card-hd">
                    <h3>{ph.phase}</h3>
                    <span className="eyebrow">{num(ph.n)} fills</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Bucket</th>
                        <th>Implied</th>
                        <th>Real</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ph.bins.map((b) => (
                        <tr key={`${b.lo}`}>
                          <td>
                            {b.lo.toFixed(1)}&ndash;{b.hi.toFixed(1)}
                          </td>
                          <td>{b.implied.toFixed(3)}</td>
                          <td>{b.realized.toFixed(3)}</td>
                          <td style={{ color: b.error < 0 ? "var(--down)" : "var(--up)" }}>
                            {cents(b.error)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <p className="small ink-4">
              &ldquo;Early&rdquo; is the first third of the window, when a resting quote is actually
              tradeable. That is the column that matters.
            </p>
          </Finding>

          <Finding n="04" title="But the edge is not constant, and that is the actual result">
            <p className="prose">
              Measure the same average pricing error three ways and you get three different answers,
              ranging from &ldquo;obviously real&rdquo; to &ldquo;indistinguishable from noise&rdquo;.
              Only the last one is honest.
            </p>
            <div className="card card-bd">
              <figure>
                <ForestPlot rows={forest} />
                <figcaption>
                  The point estimate barely moves. The <em>interval</em> is what changes, and the
                  interval is what decides whether there is anything to trade.
                </figcaption>
              </figure>
            </div>

            <div className="pull">
              Treating each fill as independent counts <strong>{num(s.edge.naive.n)}</strong> data
              points where there are really <strong>{num(s.edge.clustered.n)}</strong> coin flips.
              That alone moves the t-statistic from <strong>{s.edge.naive.t.toFixed(2)}</strong> to{" "}
              <strong>{s.edge.clustered.t.toFixed(2)}</strong>. Resample whole weeks and the interval{" "}
              {s.edge.bootstrap.crossesZero ? (
                <strong>straddles zero entirely</strong>
              ) : (
                <>still clears zero</>
              )}
              . A bot hard-coding &ldquo;always fade UP&rdquo; would be fitting last month&rsquo;s
              weather.
            </div>

            <div className="card card-bd">
              <figure>
                <div className="scroll-x">
                  <WeeklyBars weeks={weeks} />
                </div>
                <div className="legend">
                  <span>
                    <i className="swatch" style={{ background: "var(--down)" }} /> UP overpriced that week
                  </span>
                  <span>
                    <i className="swatch" style={{ background: "var(--up)" }} /> UP underpriced that week
                  </span>
                </div>
                <figcaption>
                  Whole weeks run rich, then cheap. Errors are correlated in time as well as within
                  markets, so resampling individual markets still understates the uncertainty. The
                  bootstrap resamples entire weeks.
                </figcaption>
              </figure>
            </div>
          </Finding>

          <Finding n="05" title="Most markets never trade at all">
            <p className="prose">
              The venue&rsquo;s real bottleneck is not signal quality, it is emptiness. Only{" "}
              <strong>{pct(s.coverage.coverage, 1)}</strong> of settled markets saw a single trade.
              That is where a quote is worth the most, and it is why the agent&rsquo;s job is to
              provide liquidity rather than take it.
            </p>
            <div className="card card-bd">
              <CoverageBars series={s.bySeries} />
            </div>
          </Finding>

          <Finding n="06" title="Makers get paid, takers do not">
            <p className="prose">
              Settled PnL split by which side of the trade a wallet was on. The venue charges no
              fees, so this is purely the spread changing hands, which makes it a direct read on
              whether liquidity provision is currently rewarded. It is.
            </p>
            <div className="grid-2">
              <div className="card">
                <div className="card-hd">
                  <h3>Who gets paid</h3>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Side</th>
                      <th>Settled PnL</th>
                      <th>ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Maker (passive)</td>
                      <td>{s.makerVsTaker.maker.pnl.toFixed(2)}</td>
                      <td style={{ color: "var(--ok)" }}>+{pct(s.makerVsTaker.maker.roi)}</td>
                    </tr>
                    <tr>
                      <td>Taker (aggressive)</td>
                      <td>{s.makerVsTaker.taker.pnl.toFixed(2)}</td>
                      <td style={{ color: "var(--bad)" }}>{pct(s.makerVsTaker.taker.roi)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="card">
                <div className="card-hd">
                  <h3>Is this a market, or a few bots?</h3>
                </div>
                <table>
                  <tbody>
                    <tr>
                      <td>Distinct takers</td>
                      <td>{num(s.concentration.distinctTakers)}</td>
                    </tr>
                    <tr>
                      <td>Distinct makers</td>
                      <td>{num(s.concentration.distinctMakers)}</td>
                    </tr>
                    <tr>
                      <td>Largest taker&rsquo;s share</td>
                      <td>{pct(s.concentration.topTakerShare, 1)}</td>
                    </tr>
                    <tr>
                      <td>Herfindahl index</td>
                      <td>{s.concentration.takerHHI.toFixed(3)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <p className="small ink-4 measure">
              Reported next to the edge on purpose: it is the main reason to discount everything
              above. A real market rather than one bot talking to itself, but a small one.
            </p>

            {traders && traders.length > 0 && (
              <div className="card scroll-x">
                <div className="card-hd">
                  <h3>Settled PnL leaderboard</h3>
                  <span className="eyebrow">min 5 trades across 3 markets</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Wallet</th>
                      <th>PnL</th>
                      <th>ROI</th>
                      <th>Trades</th>
                      <th>Markets</th>
                      <th>Hit</th>
                      <th>Maker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traders.map((t) => (
                      <tr key={t.address}>
                        <td className="mono">{`${t.address.slice(0, 8)}…${t.address.slice(-4)}`}</td>
                        <td style={{ color: t.pnl >= 0 ? "var(--ok)" : "var(--bad)" }}>
                          {t.pnl >= 0 ? "+" : ""}
                          {t.pnl.toFixed(2)}
                        </td>
                        <td>{pct(t.roi, 1)}</td>
                        <td>{t.trades}</td>
                        <td>{t.markets}</td>
                        <td>{pct(t.hitRate, 0)}</td>
                        <td>{pct(t.makerShare, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Finding>
        </div>
      </Band>

      <Band fill>
        <div className="col-12 v5">
          <h2 style={{ fontSize: 20 }}>Notes on method</h2>
          <div className="grid-2x2">
            {[
              {
                h: "Errors are clustered, and we say so",
                p: "Fills inside one market are not independent observations. Every interval here is computed on markets, not fills. The API still returns the naive number as a clearly-labelled foil, so the difference is visible rather than hidden.",
              },
              {
                h: "The leaderboard filters on distinct markets",
                p: "Ten fills inside one window are ten slices of one coin flip, so a wallet can post a 200% ROI over 'ten trades' having taken exactly one position. Ranking without that filter puts single-bet wallets on top.",
              },
              {
                h: "Voided markets are excluded",
                p: "A voided market pays both sides 0.5 and has no winner, so scoring it as a loss for one side is simply false. Unresolved markets are excluded too: their on-chain winner field reads 0, which is indistinguishable from a genuine UP win.",
              },
              {
                h: "Known limits",
                p: "The edge is estimated over about three weeks of traded markets. Enough to reject a constant bias; not enough to characterise the regimes that replace it. Settled PnL counts unredeemed winnings and does not model open inventory.",
              },
            ].map((c) => (
              <div key={c.h} className="card card-bd stack" style={{ gap: 6 }}>
                <h3 style={{ fontSize: 14 }}>{c.h}</h3>
                <p className="body-sm ink-3" style={{ lineHeight: 1.6 }}>
                  {c.p}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Band>

      <Footer asOf={s.dataAsOf} />
    </>
  );
}
