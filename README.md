# Calibra

**Edge intelligence and a market-making agent for DreamDEX event contracts on Somnia.**

Built for the [Somnia × DreamDEX Event Contracts Hackathon](https://dorahacks.io/hackathon/event-contracts/detail).

Live dashboard: **https://claude.ai/code/artifact/c547b4c8-d646-4307-99c5-26c93f4f5447**

---

## The question

DreamDEX event contracts settle a BTC and an ETH market every 15 minutes. That cadence makes
something possible that no other prediction market can do: you can measure whether the venue's
prices are *actually calibrated*, continuously, from thousands of resolved outcomes. A Polymarket
question resolves in months, so its calibration curve is a lifetime project. Here it is a live
instrument.

So we asked the obvious question - **when this venue says 70%, does it happen 70% of the time?** -
and then refused to stop at the first answer.

## What we found

Measured on **6,906 binary markets** from the mainnet venue (`0x458b30c2…`), of which 6,902 resolved
and 1,200 traded, carrying 2,683 fills.

**1. The underlying is a coin flip.** The window closed up 50.58% of the time, 95% CI
[49.40%, 51.76%]. Indistinguishable from 50%, and consistent across BTC/ETH and 15m/1h. There is no
drift to harvest - any edge has to come from the *price* being wrong.

**2. Prices are informative but miscalibrated.** Brier skill of **0.474** against an always-50%
forecaster, so the prices carry real information. But the calibration curve bends away from the
diagonal at both ends: markets priced 0.2–0.3 resolved up only 7% of the time.

**3. Most of that curve is the clock, not skill.** Scoring a market by its volume-weighted price
mixes trades from its whole life, including ones placed seconds before expiry when the outcome is
nearly decided. Score each fill separately by how much of the window remained and the dramatic
S-curve flattens out. This check is the difference between a real finding and an artifact of
aggregation.

**4. The edge is real but *not constant* - and that is the actual result.**

| Estimator | Mean error | 95% interval | Reading |
|---|---|---|---|
| Per fill (naive) | −3.10¢ | [−4.59¢, −1.61¢] | t = −4.08 - "obviously real" |
| Clustered by market | −2.59¢ | [−4.63¢, −0.54¢] | t = −2.48 - worth a look |
| Week-block bootstrap | −2.59¢ | **[−5.06¢, +2.12¢]** | **straddles zero** |

The naive estimate counts 2,683 fills as independent observations when they are really 1,200 coin
flips - every fill in one window shares a single outcome. That alone moves the t-statistic from
−4.08 to −2.48. And the errors are correlated in *time* as well: weekly means run −0.5¢, +0.8¢,
−6.6¢, −4.0¢, +18.5¢. They change sign. Resampling whole weeks, the interval covers zero.

**A bot that hard-codes "always fade UP" is fitting last month's weather.** What the data supports
is measuring the edge continuously and standing down when it is not there.

**5. Most markets never trade at all.** Only **17.4%** of settled markets saw a single trade. The
venue's bottleneck is emptiness, not signal quality.

**6. Makers get paid, takers do not.** Settled PnL splits **+1.34% ROI** to the passive side and
**−2.18%** to the aggressive side, on a venue that charges zero fees. So the agent is post-only.

## What we built

Four pieces, each one earned by a finding above.

### 1. An ingest + analytics engine
Pulls the venue's full binary-market history from the Somnia indexer into a local SQLite file, then
computes base rates, calibration curves, cluster-robust and block-bootstrapped edge estimates,
settled per-wallet PnL, and liquidity coverage. Idempotent, resumable, and reproducible - the
database is a plain file you can open and check our arithmetic against.

### 2. The public event-contract API
DreamDEX's own docs are explicit that *"the HTTP API covers spot only - no event-contract
endpoints,"* so today anything wanting this data has to run the TypeScript SDK and hold a viem
client. Calibra serves it as plain JSON over HTTP, no key, permissive CORS - usable from a Python
notebook, a Grafana panel, or a phone.

```
GET /v1/summary            everything, in one call
GET /v1/markets/live       currently tradable contracts, live from the indexer
GET /v1/stats/base-rate    how often the underlying actually closes up
GET /v1/stats/calibration  implied vs realized, including by time-to-expiry
GET /v1/stats/edge         all three estimators side by side
GET /v1/edge/live          the trade / stand-down verdict the agent obeys
GET /v1/traders            settled PnL leaderboard
GET /v1/liquidity          coverage, hour-of-day, participant concentration
```

### 3. The agent
A post-only market maker whose **default state is flat**. Four conditions must all hold before it
quotes anything:

1. Enough resolved markets in the window to estimate anything.
2. The interval **excludes zero** - there is a measurable mispricing.
3. It exceeds the minimum edge, so we are not trading noise into a spread.
4. Its sign **agrees with the long-run estimate**. Condition 2 alone fires by chance about one
   window in twenty; this is what separates a regime from a run of luck, and it is what would have
   kept the agent flat through week 33.

When it does quote: two-sided post-only around an edge-corrected fair value, sized off the *near
bound* of the interval rather than its centre (so a wide interval sizes small even when its centre
looks juicy), refusing markets in the last stretch of their window, never posting inside the touch,
and with order expiry set just past the requote interval so a crashed agent's orders age off the
book by themselves.

Because ~83% of markets have no book at all, seeding an empty market is the main path, not an edge
case - the agent's quotes are usually the only ones there.

### 4. The terminal
A React trading client (`app/`) that puts the measurement next to the money. Connect a wallet,
browse the open BTC/ETH windows with live countdowns and books, and place orders - with Calibra's
fair value and a RICH / CHEAP / IN LINE badge beside every price.

It is opinionated where the data says to be. Post-only is the default order type, because settled
PnL on this venue pays the passive side +1.34% and charges the aggressive side -2.18% on a book
with no fees at all. Claiming is a first-class action, because winnings are claimed rather than
received. And when the measured interval covers zero the app says **no edge** instead of inventing
a number - a trading UI that always has an opinion is one that is lying some of the time.

### 5. The dashboard
A single self-contained HTML file with the whole argument, including the charts. It polls the API
when one is running and falls back to a baked-in snapshot otherwise, so it opens from disk with no
server and no network.

---

## Run it

```bash
npm install
npm run backfill     # pull the venue's full history into data/calibra-mainnet.db  (~3 min)
npm run doctor       # preflight: indexer reachable, venue drift, store age, live verdict
npm run analyze      # print every finding above, recomputed from your own copy
npm run api          # http://localhost:8787
npm run dashboard    # bake web/dashboard.html, openable straight from disk
npm test             # 13 tests over the policy and the statistics
npm run verify       # re-derive every number quoted in this README
npm run app          # the trading terminal on http://localhost:5173
```

Run `npm run api` and `npm run app` together: the terminal proxies `/api` to the stats server, and
without it every price simply shows no fair value rather than a wrong one.

`npm run doctor` is the one to run first, and the one to run when something goes quiet.
It is read-only and needs no key. It will tell you if the venue id has moved, which
happens often - both networks changed theirs three times in a single week, and a bot
pointed at a stale venue finds nothing, forever, with nothing in the log to say so.

The agent defaults to **testnet** and **DRY_RUN**, and logs exactly what it would place:

```bash
ONCE=1 npm run agent                      # one pass, sends nothing
ONCE=1 EDGE_WINDOW_DAYS=30 npm run agent  # a window where the edge does clear zero
```

On **PowerShell** the inline `VAR=value cmd` prefix is not valid syntax - set it first:

```powershell
$env:ONCE=1; npm run agent
$env:ONCE=1; $env:EDGE_WINDOW_DAYS=30; npm run agent
```

To go live, set `PRIVATE_KEY` and `DRY_RUN=false` in `.env`. Get testnet funds at
[testnet.somnia.network](https://testnet.somnia.network).

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `NETWORK` | `testnet` (agent), `mainnet` (analytics) | Which deployment to act on |
| `DRY_RUN` | `true` | Log intended orders, send nothing. Only the exact string `false` disables it |
| `PRIVATE_KEY` | - | Signer. Required for live trading |
| `VENUE_ID` | auto-detected | Venue scope. Read off a live market row if the bundled id has moved |
| `EDGE_WINDOW_DAYS` | `7` | Lookback for the "current regime" estimate |
| `EDGE_MIN` | `0.02` | Minimum edge, in probability points, before quoting |
| `QUOTE_SIZE` | `1` mainnet / `50` testnet | Shares per side at full confidence |
| `REQUOTE_SEC` | `45` | Seconds between passes |

Analytics read mainnet history regardless of where the agent trades - testnet markets are too thin
to estimate anything, and the pricing behaviour being modelled is the venue's, not the chain's.

---

## Notes on method

Three deliberate choices, since the whole project is an argument about measurement.

**Errors are clustered, and we say so.** Fills inside one market are not independent observations.
Every interval in this repo is computed on markets, not fills. `/v1/stats/edge` still returns the
naive number - as a foil, clearly labelled, so the difference is visible rather than hidden.

**The leaderboard filters on distinct markets, not just trade count.** Ten fills inside one
15-minute window are ten slices of one coin flip, so a wallet can post a 200% ROI over "10 trades"
having taken exactly one position. Ranking without that filter puts single-bet wallets on top -
which is the same artifact this project exists to catch elsewhere.

**Concentration is reported next to the edge.** 129 distinct takers, largest holding 16% of flow,
Herfindahl 0.073. It is a real market rather than one bot talking to itself, but it is a *small*
one, and every number here should be read with that in mind.

### Known limits

- The edge is estimated from ~1,200 traded markets over about three weeks. That is enough to reject
  a constant bias; it is not enough to characterise the regimes that replace it.
- Settled PnL counts unredeemed winnings and does not model open inventory. It measures trading
  skill, not wallet balance.
- Venue ids move - both networks changed theirs three times in one week. The backfill reads the
  live venue off a market row and tells you when the bundled constant has drifted.
- The agent has been exercised end-to-end against live testnet books in dry run. It has not been
  run with real capital, and the numbers here are not a backtest of its PnL.

## Layout

```
src/indexer/     GraphQL client + typed queries (keyset paging, numeric-safe)
src/db/          SQLite schema
src/ingest/      idempotent historical backfill
src/analytics/   stats, calibration, edge/regime detection, traders, liquidity
src/api/         the public JSON API (node:http, no framework)
src/agent/       SDK bootstrap + guards, quoting policy, runner
app/             React trading terminal (Vite, wallet-connected)
web/             dashboard (template + baked build)
```

Built with [`@somnia-chain/markets-sdk`](https://www.npmjs.com/package/@somnia-chain/markets-sdk)
against the [DreamDEX event-contract docs](https://docs.dreamdex.io/developers/event-contracts).
