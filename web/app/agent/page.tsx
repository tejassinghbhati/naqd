import type { Metadata } from "next";
import { getSummary } from "@/lib/stats-server";
import { EdgeGauge } from "@/components/charts";
import { OfflineNotice } from "@/components/offline-notice";
import { Glow } from "@/components/glow";
import { Band, Head, Cta, Footer } from "@/components/site/parts";

export const metadata: Metadata = {
  title: "The agent",
  description:
    "A market-making agent whose default state is flat. Four conditions must hold before it quotes anything, and it stands down when the measurement says nothing.",
};

const cents = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;
const num = (n: number) => n.toLocaleString("en-US");

/**
 * The agent page.
 *
 * This pillar was once a single paragraph in a card, which undersold the only
 * component that ACTS on the measurement. The point worth making at length is
 * that its default is to do nothing: trading bots are usually sold on what they
 * do when they fire, and the interesting engineering here is the four
 * conditions that keep it flat.
 */
export default async function AgentPage() {
  const s = await getSummary();

  const gate = [
    {
      n: "01",
      h: "Enough resolved markets in the window",
      p: "Below about sixty settled markets in the lookback, the interval is so wide that any point estimate is noise wearing a number. The agent refuses to estimate rather than estimating badly.",
      pass: s ? s.live.sampleMarkets >= 60 : null,
      detail: s ? `${num(s.live.sampleMarkets)} markets in the last ${s.live.windowDays}d` : null,
    },
    {
      n: "02",
      h: "The interval excludes zero",
      p: "Not the point estimate, the interval. A mean of three cents with a band running from minus five to plus two is not a three-cent edge; it is an absence of evidence with a centre.",
      pass: s ? !(s.live.recent.ci95[0] <= 0 && s.live.recent.ci95[1] >= 0) : null,
      detail: s ? `[${cents(s.live.recent.ci95[0])}, ${cents(s.live.recent.ci95[1])}]` : null,
    },
    {
      n: "03",
      h: "It clears the minimum edge",
      p: "A statistically real half-cent is still smaller than the spread it would have to cross. The floor exists so the agent does not pay the venue for the privilege of being technically correct.",
      pass: s ? Math.abs(s.live.edge) >= 0.02 : null,
      detail: s ? `${cents(s.live.edge)} against a 2.00¢ floor` : null,
    },
    {
      n: "04",
      h: "Its sign agrees with the long run",
      p: "Condition two alone fires by chance about one window in twenty. Requiring the lifetime estimate to point the same way is what separates a regime from a run of luck, and it is what would have kept the agent flat through the week the weekly mean briefly flipped positive.",
      pass: s ? Math.sign(s.live.edge) === Math.sign(s.live.lifetime.mean) : null,
      detail: s ? `recent ${cents(s.live.edge)} vs lifetime ${cents(s.live.lifetime.mean)}` : null,
    },
  ];

  const behaviour = [
    {
      h: "Post-only, both sides",
      p: "Not because makers are measurably paid here: pooled over fills that split looks decisive and has already changed sign between snapshots, and bootstrapped over whole weeks it straddles zero. Resting is risk control. An order that would cross is rejected rather than filled, so a book that moved while we were deciding costs nothing.",
    },
    {
      h: "Sized to the near bound",
      p: "Position size scales with the conservative end of the interval, so a wide band sizes small automatically, without a separate risk rule to remember.",
    },
    {
      h: "Seeds empty books",
      p: "About five markets in six on this venue settle without a single trade. Being the first quote in a window is the normal case, not an edge case, so the policy treats an empty book as a prior of 0.5 rather than as an error.",
    },
    {
      h: "Refuses the late window",
      p: "In the last stretch before expiry the price is dominated by information we do not have, and a resting quote is most likely to be taken by someone who does. The threshold scales with the series cadence rather than being a fixed number of seconds.",
    },
    {
      h: "Expires its own orders",
      p: "Every order carries an expiry just past the requote interval, capped at the market's own. A crashed agent's orders age off the book by themselves instead of resting with escrow locked.",
    },
    {
      h: "Claims as it goes",
      p: "A settled market pays out only when someone asks it to. An agent that trades for a week without redeeming has its balance spread across dozens of finalised markets while its wallet reads near zero, so the claim sweep runs inside the loop.",
    },
  ];

  return (
    <>
      <Band rule={false} size="lg">
        <div className="col-7 v5">
          <span className="eyebrow">The agent</span>
          <h1 className="display display-sm">Its default state is to do nothing.</h1>
          <p className="prose">
            Most trading bots are sold on what they do when they fire. The interesting engineering
            here is the opposite: four conditions that must all hold before this one places a single
            order, and a measurement it re-reads on every pass to check whether they still do.
          </p>
        </div>
      </Band>

      <Band fill>
        <Head eyebrow="Right now" title="What the gate says" span="col-6" />

        {s ? (
          <>
            <div className="col-4 v5" style={{ marginTop: "var(--s6)" }}>
              <div className="card card-bd v4">
                <div className="h3f">
                  <span className={`dot ${s.live.verdict === "trade" ? "live" : "warn"}`} />
                  <span
                    className="reading-word"
                    style={{ color: s.live.verdict === "trade" ? "var(--ok)" : "var(--warn)" }}
                  >
                    {s.live.verdict === "trade" ? "Quoting" : "Standing down"}
                  </span>
                </div>
                <EdgeGauge estimate={s.live.recent} point={s.live.edge} />
                <p className="body-sm">{s.live.reason}</p>
                <div
                  className="between"
                  style={{ paddingTop: "var(--s4)", borderTop: "1px solid var(--rule)" }}
                >
                  <span className="eyebrow">Size multiplier</span>
                  <span className="mono" style={{ fontSize: "var(--t5)" }}>
                    {s.live.confidence.toFixed(2)}
                  </span>
                </div>
                <p className="small ink-3">
                  Sizing scales with how far the <em>near bound</em> of the interval sits from zero,
                  not with the point estimate. A wide, uncertain band sizes small even when its centre
                  looks attractive. At zero, the correct position is none.
                </p>
              </div>
            </div>

            <ol className="col-7 start-6 gate" style={{ marginTop: "var(--s6)" }}>
              {gate.map((g) => (
                <li
                  key={g.n}
                  className={`gate-row ${g.pass === false ? "gate-fail" : g.pass ? "gate-pass" : ""}`}
                >
                  <span className="gate-n">{g.n}</span>
                  <div className="v2">
                    <div className="between" style={{ alignItems: "baseline" }}>
                      <h3 className="h4">{g.h}</h3>
                      {g.pass !== null && (
                        <span className={`tag ${g.pass ? "ok" : "warn"}`}>
                          {g.pass ? "PASS" : "BLOCKS"}
                        </span>
                      )}
                    </div>
                    {g.detail && <div className="mono small ink-4">{g.detail}</div>}
                    <p className="body-sm">{g.p}</p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="col-12">
            <OfflineNotice />
          </div>
        )}
      </Band>

      <Band>
        <Head
          eyebrow="When it does quote"
          title="How it behaves"
          lede="Every one of these is a decision the measurement made for us, not a preference."
          span="col-6"
        />
        <div className="col-12" style={{ marginTop: "var(--s6)" }}>
          <div className="grid" style={{ padding: 0, maxWidth: "none" }}>
            {behaviour.map((c) => (
              <div key={c.h} className="col-4 instrument">
                <h3 className="h4">{c.h}</h3>
                <p className="body-sm">{c.p}</p>
              </div>
            ))}
          </div>
        </div>
      </Band>

      <Band fill>
        <Head
          eyebrow="Run it"
          title="Dry run by default."
          lede="It logs exactly what it would place and sends nothing until you turn that off deliberately."
        />
        <div className="col-6 start-7 v5">
          <div className="card card-bd">
            <pre>{`npm run backfill        # pull the venue's history
npm run doctor          # preflight, read-only

ONCE=1 npm run agent    # one pass, sends nothing

# a window where the edge does clear zero
ONCE=1 EDGE_WINDOW_DAYS=30 npm run agent`}</pre>
          </div>
          <p className="body-sm ink-3">
            The agent has been exercised end to end against live testnet books, including the
            on-chain status gate. It has not yet signed a transaction with real capital, and the
            figures here measure the venue rather than backtest its PnL.
          </p>
          <Cta href="/terminal" small>
            Trade it by hand instead
          </Cta>
        </div>
      </Band>

      <Footer asOf={s?.dataAsOf} />
    </>
  );
}
