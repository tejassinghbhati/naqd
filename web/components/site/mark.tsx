/**
 * The Assay mark.
 *
 * A hallmark: the small stamp an assay office strikes into metal once it has
 * been tested and found to be what it claims. Drawn as a square punch enclosing
 * a calibration diagonal, with a single node sitting off that line - the same
 * geometry as the research page's central chart, reduced to sixteen pixels.
 *
 * Deliberately not a logotype or an abstract swoosh. It means something
 * specific, and it is the one graphic device the identity uses.
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
      {/* The punch */}
      <rect x="1.5" y="1.5" width="21" height="21" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      {/* Perfect calibration */}
      <path d="M5 19 L19 5" stroke="currentColor" strokeWidth="1.25" strokeOpacity="0.42" strokeLinecap="round" />
      {/* The reading, off the line */}
      <circle cx="14.5" cy="13" r="2.4" fill="currentColor" />
    </svg>
  );
}
