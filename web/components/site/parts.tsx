/**
 * Page furniture.
 *
 * Every page composes from these, so a heading on the landing page and a
 * heading on the research page are the same object rather than two similar
 * ones. That is the difference between a site with a system and a site with a
 * house style someone remembers most of the time.
 *
 * All of them lay out on the shared twelve-column grid from system.css.
 */

import Link from "next/link";
import { Mark } from "./mark";

/** A full-width horizontal band. Vertical rhythm comes from the space scale. */
export function Band({
  children,
  id,
  rule = true,
  fill = false,
  size = "md",
}: {
  children: React.ReactNode;
  id?: string;
  /** Hairline above the band. Off for the first band on a page. */
  rule?: boolean;
  fill?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const cls = size === "sm" ? "band-sm" : size === "lg" ? "band-lg" : "band";
  return (
    <section id={id} className={`${cls} ${rule ? "band-rule" : ""} ${fill ? "band-fill" : ""}`}>
      <div className="grid">{children}</div>
    </section>
  );
}

/**
 * A section heading.
 *
 * Spans columns 1-5 by default so the body beside it starts on column 7 - a
 * consistent relationship the reader learns after one section.
 */
export function Head({
  eyebrow,
  title,
  lede,
  span = "col-5",
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  span?: string;
}) {
  return (
    <header className={`${span} v4`}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="h2">{title}</h2>
      {lede && <p className="prose">{lede}</p>}
    </header>
  );
}

/** A ruled row of headline figures. At most one per page. */
export function Figures({
  items,
}: {
  items: { k: string; v: string; s?: string; tone?: "ok" | "bad" }[];
}) {
  return (
    <div className="figures col-12">
      {items.map((i) => (
        <div key={i.k} className="figure">
          <div className="k">{i.k}</div>
          <div
            className={`v ${i.v.length > 7 ? "sm" : ""}`}
            style={i.tone ? { color: i.tone === "ok" ? "var(--ok)" : "var(--bad)" } : undefined}
          >
            {i.v}
          </div>
          {i.s && <div className="s">{i.s}</div>}
        </div>
      ))}
    </div>
  );
}

/** The oversized underlined link. The publication's primary call to action. */
export function Cta({
  href,
  children,
  small = false,
}: {
  href: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <Link href={href} className={`cta ${small ? "cta-sm" : ""}`}>
      {children}
      <span className="arw" aria-hidden="true">
        &rarr;
      </span>
    </Link>
  );
}

export function Footer({ asOf }: { asOf?: number }) {
  return (
    <footer className="footer">
      <div className="grid">
        <div className="col-5 v4">
          <Link href="/" className="brand" aria-label="Assay, home">
            <Mark size={20} />
            <span className="brand-name">Assay</span>
          </Link>
          <p className="body-sm" style={{ maxWidth: "38ch" }}>
            An assay office for prediction market prices. We test what DreamDEX event-contract prices
            are actually made of, and act only when the assay says there is something there.
          </p>
        </div>

        <nav className="col-3 start-7 footer-col" aria-label="Product">
          <span className="eyebrow">Product</span>
          <Link href="/research">Research</Link>
          <Link href="/agent">The agent</Link>
          <Link href="/terminal">Terminal</Link>
          <Link href="/developers">Developers</Link>
        </nav>

        <nav className="col-3 footer-col" aria-label="External links">
          <span className="eyebrow">Built on</span>
          <a href="https://docs.dreamdex.io/developers/event-contracts" target="_blank" rel="noreferrer">
            DreamDEX docs
          </a>
          <a href="https://somnia.network" target="_blank" rel="noreferrer">
            Somnia
          </a>
          <a href="https://dorahacks.io/hackathon/event-contracts/detail" target="_blank" rel="noreferrer">
            The hackathon
          </a>
        </nav>

        <div className="col-12 footer-base">
          <span>Not financial advice. Event contracts can lose their entire stake.</span>
          <span className="mono">
            {asOf
              ? `Assayed ${new Date(asOf * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`
              : "Stats API offline"}
          </span>
        </div>
      </div>
    </footer>
  );
}
