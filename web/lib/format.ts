/**
 * Shared formatters.
 *
 * These live in one place because a number formatted two ways on two pages is
 * a bug the eye finds instantly, and because the cadence formatter below exists
 * to fix a real one: dividing `intervalSec` by 60 inline printed
 * "ETH 4.966666666666667m" on the research table, since the venue occasionally
 * carries an off-schedule series (298s) left over from a migration.
 */

/** A market's window, as a person would say it. */
export function cadence(intervalSec: number, upper = false): string {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return upper ? "?" : "?";
  const unit = (n: number, u: string) => {
    // One decimal only when the value is genuinely not whole, so 15m stays 15m
    // and an odd 298s series reads 5m rather than 4.966666666666667m.
    const r = Math.round(n * 10) / 10;
    const txt = Number.isInteger(r) ? String(r) : r.toFixed(1);
    return upper ? `${txt}${u.toUpperCase()}` : `${txt}${u}`;
  };
  if (intervalSec >= 86_400) return unit(intervalSec / 86_400, "d");
  if (intervalSec >= 3_600) return unit(intervalSec / 3_600, "h");
  if (intervalSec >= 60) return unit(intervalSec / 60, "m");
  return unit(intervalSec, "s");
}

export const cents = (x: number): string =>
  `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}¢`;

export const pct = (x: number, d = 2): string => `${(x * 100).toFixed(d)}%`;

export const num = (n: number): string => n.toLocaleString("en-US");

/** A countdown, zero-padded so it does not jitter as it ticks. */
export function countdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (m >= 60) return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return `${pad(m)}:${pad(s)}`;
}
