/**
 * Shown wherever the stats API is unreachable.
 *
 * A research site whose whole content is a measurement has to say something
 * useful when the measurement is not available - not a blank panel, and
 * certainly not a zero, which would read as "no edge" rather than "no data".
 */
export function OfflineNotice() {
  return (
    <div className="notice warn">
      <span className="ic">!</span>
      <div>
        <strong>The stats API is not reachable.</strong> Every figure on this site is computed from
        the venue&rsquo;s settled history by a local service. Start it with{" "}
        <code>npm run api</code> in the project root, after <code>npm run backfill</code>.
      </div>
    </div>
  );
}
