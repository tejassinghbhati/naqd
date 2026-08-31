/**
 * Calibra - GraphQL client for the Somnia markets indexer.
 *
 * The indexer is public and unauthenticated, which is the only reason a project
 * like this can exist: DreamDEX's HTTP API covers spot only, so every
 * event-contract consumer has to come through here or through the TS SDK. This
 * module is the thin, typed layer we build the rest of Calibra on.
 *
 * Two things to know about the shape of the data:
 *
 *  1. Every numeric field arrives as a STRING. Prices and sizes are fixed-point
 *     in the collateral's decimals (18 on mainnet / USDso, 6 on testnet /
 *     tUSDC), timestamps are unix seconds. Nothing here converts silently -
 *     callers ask for the scale they want.
 *
 *  2. Rows lag the chain by seconds. That is fine for analytics (we only ever
 *     read markets that already resolved) but it is NOT safe for trading. The
 *     agent gates every write on the on-chain status instead; see
 *     src/agent/quote.ts.
 */

export type Network = "testnet" | "mainnet";

export const INDEXER_URL: Record<Network, string> = {
  testnet: "https://dev.smk.somnia.host/v1/graphql",
  mainnet: "https://prd.smk.somnia.host/v1/graphql",
};

/** Venue ids move - both networks changed theirs three times in one week. These
 *  are a starting point; `calibra doctor` reads the live value off a market row
 *  and tells you when this constant has drifted. */
export const KNOWN_VENUE: Record<Network, string> = {
  testnet: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  mainnet: "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d",
};

export const COLLATERAL_DECIMALS: Record<Network, number> = { testnet: 6, mainnet: 18 };

export class IndexerError extends Error {
  constructor(message: string, readonly query: string) {
    super(message);
    this.name = "IndexerError";
  }
}

export interface IndexerOptions {
  network?: Network;
  url?: string;
  /** Retries on transport / 5xx failures. GraphQL validation errors never retry. */
  retries?: number;
  timeoutMs?: number;
}

export class Indexer {
  readonly url: string;
  readonly network: Network;
  private readonly retries: number;
  private readonly timeoutMs: number;

  constructor(opts: IndexerOptions = {}) {
    this.network = opts.network ?? "mainnet";
    this.url = opts.url ?? INDEXER_URL[this.network];
    this.retries = opts.retries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(250 * 2 ** (attempt - 1));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          lastErr = new IndexerError(`HTTP ${res.status} ${res.statusText}`, query);
          continue;
        }
        const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
        if (body.errors?.length) {
          // A malformed query is a bug, not a blip - fail immediately rather
          // than retrying the same broken request three more times.
          throw new IndexerError(body.errors.map((e) => e.message).join("; "), query);
        }
        if (!body.data) throw new IndexerError("response carried no data", query);
        return body.data;
      } catch (e) {
        if (e instanceof IndexerError) throw e;
        lastErr = e as Error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new IndexerError(`failed after ${this.retries + 1} attempts: ${lastErr?.message}`, query);
  }

  /**
   * Page through a collection with keyset pagination.
   *
   * Deliberately NOT offset-based: we page over tens of thousands of rows while
   * new ones are being written at the head, and an offset walk silently skips
   * or repeats rows when that happens. Keying on a strictly-ordered column and
   * carrying the last value forward is stable under concurrent writes.
   */
  async *paginate<T extends Record<string, unknown>>(args: {
    table: string;
    fields: string;
    /** Strictly-ordered, unique column to key on (e.g. "marketId", "id"). */
    cursorField: string;
    where?: string;
    pageSize?: number;
    /** Stop once this many rows have been yielded. */
    limit?: number;
  }): AsyncGenerator<T[], void, unknown> {
    const pageSize = args.pageSize ?? 500;
    let cursor: string | null = null;
    let seen = 0;

    while (true) {
      const clauses: string = [args.where, cursor ? `${args.cursorField}: {_gt: ${JSON.stringify(cursor)}}` : null]
        .filter(Boolean)
        .join(", ");
      const where: string = clauses ? `where: {${clauses}}, ` : "";
      const take = args.limit ? Math.min(pageSize, args.limit - seen) : pageSize;
      if (take <= 0) return;

      const q: string = `query { ${args.table}(${where}order_by: {${args.cursorField}: asc}, limit: ${take}) { ${args.fields} } }`;
      const data: Record<string, T[]> = await this.query<Record<string, T[]>>(q);
      const rows: T[] = data[args.table] ?? [];
      if (rows.length === 0) return;

      yield rows;
      seen += rows.length;

      const last: T | undefined = rows[rows.length - 1];
      const next: unknown = last?.[args.cursorField];
      if (next == null) return;
      cursor = String(next);
      if (rows.length < take) return;
    }
  }
  /**
   * Page through a collection keyed on a NUMERIC column.
   *
   * `paginate` keys on a string column with `_gt`, which is wrong for anything
   * whose ordering is numeric: `Fill.id` is `"<block>_<logIndex>"`, so
   * `"400232377_10"` sorts BEFORE `"400232377_8"` lexicographically and a
   * string cursor walks straight past rows it never returned. Here we advance
   * on a numeric column with `_gte` and let the caller's primary key absorb the
   * duplicate rows on the page boundary - overlapping is cheap, skipping is
   * silent data loss.
   */
  async *paginateNumeric<T extends Record<string, unknown>>(args: {
    table: string;
    fields: string;
    /** Numeric-valued column to advance on (e.g. "blockNumber", "timestamp"). */
    cursorField: string;
    where?: string;
    pageSize?: number;
    limit?: number;
  }): AsyncGenerator<T[], void, unknown> {
    const pageSize = args.pageSize ?? 500;
    let cursor: bigint | null = null;
    let seen = 0;

    while (true) {
      const clauses: string = [args.where, cursor !== null ? `${args.cursorField}: {_gte: ${JSON.stringify(String(cursor))}}` : null]
        .filter(Boolean)
        .join(", ");
      const where: string = clauses ? `where: {${clauses}}, ` : "";
      const take = args.limit ? Math.min(pageSize, args.limit - seen) : pageSize;
      if (take <= 0) return;

      const q: string = `query { ${args.table}(${where}order_by: {${args.cursorField}: asc}, limit: ${take}) { ${args.fields} } }`;
      const data: Record<string, T[]> = await this.query<Record<string, T[]>>(q);
      const rows: T[] = data[args.table] ?? [];
      if (rows.length === 0) return;

      yield rows;
      seen += rows.length;
      if (rows.length < take) return;

      const last: unknown = rows[rows.length - 1]?.[args.cursorField];
      if (last == null) return;
      const next: bigint = BigInt(String(last));
      // A page that never left one cursor value would loop forever re-fetching
      // it. Step past it and accept losing any remainder in that single bucket
      // rather than hanging; pageSize is far larger than any real block's
      // fill count, so this is a guard, not a code path we expect to hit.
      cursor = next === cursor ? next + 1n : next;
    }
  }

}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fixed-point string → float, at the collateral's scale. Returns null for
 *  null/empty so "no price" never becomes a misleading 0. */
export function toFloat(raw: string | null | undefined, decimals: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw) / 10 ** decimals;
  return Number.isFinite(n) ? n : null;
}
