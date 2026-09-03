/**
 * Shared page furniture.
 *
 * These exist so the marketing surfaces cannot drift apart. Before this, every
 * page hand-rolled its own section header with slightly different gaps and
 * heading sizes, which is exactly how a site starts looking assembled rather
 * than designed.
 *
 * Server components throughout: none of this needs state, and keeping it on the
 * server means the page arrives whole.
 */

import Link from "next/link";

export function Section({
  children,
  id,
  tone = "plain",
}: {
  children: React.ReactNode;
  id?: string;
  /** `sunk` gives a section a faint recessed ground, for rhythm across a long page. */
  tone?: "plain" | "sunk";
}) {
  return (
    <section id={id} className={`section ${tone === "sunk" ? "section-sunk" : ""}`}>
      <div className="wrap">{children}</div>
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  align = "left",
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <header className={`sec-head ${align === "center" ? "sec-head-c" : ""}`}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="display sec-title">{title}</h2>
      {lede && <p className="prose sec-lede">{lede}</p>}
    </header>
  );
}

/** A wide band of headline figures. Used once per page at most. */
export function StatBand({
  items,
}: {
  items: { k: string; v: string; s?: string; tone?: "ok" | "bad" }[];
}) {
  return (
    <div className="tiles">
      {items.map((i) => (
        <div key={i.k} className="tile">
          <div className="k">{i.k}</div>
          <div
            className={`v ${i.v.length > 7 ? "md" : ""}`}
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

/**
 * The site footer.
 *
 * Columns rather than a single line, because the site now has five destinations
 * and a one-line footer stops being navigation at about three.
 */
export function SiteFooter({ asOf }: { asOf?: number }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-brand">
            <span className="display" style={{ fontSize: 26 }}>
              Assay
            </span>
            <p className="sm dim" style={{ marginTop: 10, maxWidth: "34ch", lineHeight: 1.6 }}>
              An assay office for prediction market prices. We test what DreamDEX event-contract
              prices are actually made of, and act only when the assay says there is something there.
            </p>
          </div>

          <nav className="footer-col" aria-label="Product">
            <span className="lbl">Product</span>
            <Link href="/research">Research</Link>
            <Link href="/agent">The agent</Link>
            <Link href="/terminal">Terminal</Link>
            <Link href="/developers">Developers</Link>
          </nav>

          <nav className="footer-col" aria-label="External">
            <span className="lbl">Built on</span>
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
        </div>

        <div className="footer-base">
          <span className="xs dimmer">
            Not financial advice. Event contracts can lose their entire stake.
          </span>
          <span className="xs dimmer mono">
            {asOf ? `Assayed ${new Date(asOf * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : "Stats API offline"}
          </span>
        </div>
      </div>
    </footer>
  );
}

/** A large underlined text link. The primary call to action across the site. */
export function TextCta({
  href,
  children,
  size = "lg",
}: {
  href: string;
  children: React.ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <Link href={href} className="cta-text" style={size === "md" ? { fontSize: "clamp(19px, 2.2vw, 24px)" } : undefined}>
      {children}
      <span className="arw" aria-hidden="true">
        &rarr;
      </span>
    </Link>
  );
}
