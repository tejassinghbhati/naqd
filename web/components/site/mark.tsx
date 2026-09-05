/**
 * The Assay mark.
 *
 * A hallmark is what an assay office strikes into metal once it has tested the
 * metal and found it to be what it claims. So the mark is a struck punch, and
 * what is struck into it is the finding itself.
 *
 * Inside the punch: a hairline at centre is ZERO. A bar with hard end caps is a
 * CONFIDENCE INTERVAL, and it sits offset to the left of that line, crossing
 * it. A single filled square on the bar is the point estimate.
 *
 * That is the entire argument of this project in four strokes - the edge is
 * negative, and the interval around it still touches zero - and it is the same
 * glyph the forest plot and the edge gauge draw at full size. A logo that is
 * the smallest possible instance of the product's own chart is the one kind of
 * abstract mark that earns its place.
 *
 * Drawn on a 24-unit grid with everything on whole or half units, so it stays
 * crisp struck small. No curves anywhere: the corner of a punch is a corner.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* The punch. A single heavy frame: a second inner rule turned to mud at
          nav size, and the struck edge is the thing that has to survive. */}
      <rect x="1.25" y="1.25" width="21.5" height="21.5" stroke="currentColor" strokeWidth="1.75" />

      {/* Zero. */}
      <path d="M12 5.5 V18.5" stroke="currentColor" strokeOpacity="0.38" strokeWidth="1" />

      {/* The interval, with hard caps, straddling zero from the left. Thin, so
          the marker on it stays a separate object rather than a thickening. */}
      <path d="M5.75 12 H16" stroke="currentColor" strokeWidth="1" />
      <path d="M5.75 9 V15" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 9 V15" stroke="currentColor" strokeWidth="1.75" />

      {/* The point estimate. Square, because nothing here is round. */}
      <rect x="8" y="10" width="4" height="4" fill="currentColor" />
    </svg>
  );
}
