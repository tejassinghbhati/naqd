/** `npm run backfill` - pull the venue's full binary-market history locally. */
import "dotenv/config";
import { Indexer, KNOWN_VENUE, COLLATERAL_DECIMALS, type Network } from "../indexer/client.js";
import { openDb } from "../db/schema.js";
import { backfill } from "../ingest/backfill.js";
import { observedVenues } from "../indexer/queries.js";

const network = ((process.env.NETWORK ?? "mainnet").toLowerCase() === "testnet" ? "testnet" : "mainnet") as Network;
const dbPath = process.env.NAQD_DB ?? `data/naqd-${network}.db`;

const main = async () => {
  const ix = new Indexer({ network });

  // Venue ids move - both networks changed theirs three times in one week. So
  // rather than trust the bundled constant, look at where the live markets
  // actually are and say so when the two disagree.
  const venues = await observedVenues(ix);
  const top = venues[0];
  const venueId = process.env.VENUE_ID ?? top?.venueId ?? KNOWN_VENUE[network];
  if (top && top.venueId !== KNOWN_VENUE[network] && !process.env.VENUE_ID) {
    console.log(`note: venue has moved. bundled=${KNOWN_VENUE[network]} observed=${top.venueId}`);
  }
  if (venues.length > 1) {
    console.log(`note: ${venues.length} venues seen in recent markets; scoping to ${venueId}`);
  }

  console.log(`naqd backfill - ${network} - venue ${venueId.slice(0, 10)}... -> ${dbPath}`);
  const db = openDb(dbPath);

  let lastLine = "";
  const res = await backfill(db, ix, {
    network,
    venueId,
    decimals: COLLATERAL_DECIMALS[network],
    marketLimit: process.env.MARKET_LIMIT ? Number(process.env.MARKET_LIMIT) : undefined,
    onProgress: (p) => {
      const line = `  ${p.stage}: ${p.rows}`;
      if (line !== lastLine) {
        process.stdout.write(`\r${line.padEnd(40)}`);
        lastLine = line;
      }
    },
  });

  process.stdout.write(`\r${" ".repeat(42)}\r`);
  console.log(
    `done in ${(res.elapsedMs / 1000).toFixed(1)}s - ` +
      `${res.markets} markets, ${res.fills} fills, ${res.oracleAnswers} oracle answers, ${res.candles} candles`,
  );
  db.close();
};

main().catch((e) => {
  console.error(`backfill failed: ${e.message}`);
  process.exit(1);
});
