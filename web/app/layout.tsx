import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./globals.css";
import "./terminal.css";
import "./wallet.css";

// Self-hosted through next/font: no render-blocking request to a font CDN, and
// no layout shift while a fallback swaps out.
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// The display voice. An assay office publishes reports, so the research
// surfaces speak in a serif with editorial weight; the terminal stays mono.
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif",
  display: "swap",
});
const mono = IBM_Plex_Mono({
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
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <div className="lightfield" aria-hidden="true" />
        <a href="#main" className="skip">
          Skip to content
        </a>
        {/* The nav shows the account and the terminal signs with it, so the
            connection has to sit above both. */}
        <WalletProvider>
          <Nav />
          <main id="main">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
