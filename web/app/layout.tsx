import type { Metadata } from "next";
import { Schibsted_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./system.css";
import "./globals.css";
import "./terminal.css";
import "./wallet.css";

// Self-hosted through next/font: no render-blocking request to a font CDN, and
// no layout shift while a fallback swaps out.
// One family for everything. A display serif beside a text sans is a
// contrast the page has to earn; without it the type system is quieter and
// there is one voice to get right instead of two. Numbers stay monospaced.
const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
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
