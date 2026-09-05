/**
 * The dev server, with a crash guard.
 *
 * `.next` is written incrementally, so a dev server that dies mid-compile - a
 * force-kill, a closed terminal, a machine sleeping - leaves a directory that
 * EXISTS and is INCOMPLETE. Next then trusts it and serves HTML referencing
 * chunks that were never finished: the page arrives with no stylesheet and a
 * 404 on `/_next/static/css/app/layout.css`, and nothing in that says the
 * problem is a directory you have to delete.
 *
 * Detecting it by inspecting the cache does not work. The obvious test - is a
 * build manifest present, is there a static directory - passes on exactly the
 * broken cache that produced the bug, because both were written before the
 * process died. What actually distinguishes a broken cache is not its
 * contents; it is that the previous run never got to exit.
 *
 * So the run leaves a lock behind and removes it on the way out. A lock still
 * present at startup means the last server was killed rather than stopped, and
 * only then is the cache cleared. An ordinary restart keeps its warm cache.
 *
 * The lock is deliberately biased toward clearing. Windows has no real POSIX
 * signals, so a hard terminate - which is what most tooling does, and what a
 * `kill` from a bash shell does here - runs no handler and leaves the lock
 * behind even though the stop was intentional. The cost of that false positive
 * is ONE slower compile. The cost of a false negative is a page with no
 * stylesheet and an error that names a chunk instead of the cache. Erring
 * toward clearing is the right way round.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const cache = join(root, ".next");
/*
  The lock lives OUTSIDE the cache. Inside it, Next clears the directory on
  startup and takes the lock with it, so the crash signal is destroyed by the
  very next run and the guard never fires - which is exactly what the first
  version of this did.
*/
const lock = join(root, ".dev.lock");

if (existsSync(lock)) {
  console.log("[assay] the last dev server was killed rather than stopped, so .next may be");
  console.log("[assay] half-written. Clearing it; the first compile will be slower than usual.");
  rmSync(cache, { recursive: true, force: true });
}
writeFileSync(lock, String(process.pid));

const unlock = () => {
  try {
    rmSync(lock, { force: true });
  } catch {
    /* already gone, or the whole cache was removed under us */
  }
};
process.on("exit", unlock);

const child = spawn(
  process.execPath,
  [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", ...process.argv.slice(2)],
  { stdio: "inherit" },
);

// Forward the signal AND drop the lock: a deliberate stop is not a crash.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    unlock();
    child.kill(sig);
  });
}
child.on("exit", (code) => {
  unlock();
  process.exit(code ?? 0);
});
