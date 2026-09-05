import type { Metadata } from "next";
import { Archivo, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { Shards } from "@/components/shards";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./system.css";
import "./globals.css";
import "./glow.css";
import "./terminal.css";
import "./wallet.css";

/*
  Three faces, each doing one job. All self-hosted through next/font, so there
  is no render-blocking request to a font CDN and no layout shift while a
  fallback swaps out.

  ARCHIVO carries the display. It was drawn for signage and highway lettering,
  which is exactly the brief a headline has: read at size, hold its shape when
  set tight, and stay square under weight. At 800 it has closed apertures and
  flat terminals - engineered rather than friendly, which is the register an
  assay office wants.

  INSTRUMENT SANS carries running text and every control. It is narrower than
  the display face and slightly technical in the details, so a paragraph does
  not read as a shrunken headline. Two grotesks only work together when one is
  doing something the other cannot; these differ in width and in weight class,
  and never appear at the same size.

  JETBRAINS MONO carries data. It was drawn for code, which means it is drawn
  for columns of digits: unambiguous 0/O and 1/l, and even colour down a
  column of prices, which is what a book of quotes actually needs.
*/
const display = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://assay.local"),
  title: {
    default: "Assay",
    template: "%s · Assay",
  },
  description:
    "An assay office for prediction market prices. We test what DreamDEX event-contract prices are actually made of, and trade only when the assay says there is something there.",
  openGraph: {
    title: "Assay",
    description:
      "When this venue says 70%, does it happen 70% of the time? An assay office for DreamDEX event-contract prices.",
    type: "website",
  },
};

/**
 * Resolve the stored theme before first paint.
 *
 * Without this the page renders in the OS theme, then flips once React
 * hydrates and reads localStorage - a white flash on a dark terminal, on every
 * navigation. Inlined and blocking on purpose: it must run before the browser
 * paints, and it is three lines.
 */
const THEME_INIT = `
try {
  var t = localStorage.getItem("assay-theme");
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        {/* The nav shows the account and the terminal signs with it, so the
            connection has to sit above both. */}
        <Shards />
        <WalletProvider>
          <Nav />
          <main id="main">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
