import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { Shards } from "@/components/shards";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./system.css";
import "./globals.css";
import "./glow.css";
import "./terminal.css";
import "./wallet.css";

/*
  Two faces.

  PLUS JAKARTA SANS carries display and text both. It is geometric with
  generous counters and slightly softened terminals, which is the register the
  reference is in: confident without being industrial. Archivo was drawn for
  signage and it showed - flat terminals and closed apertures read as a warning
  label at 100px, which is the wrong kind of serious for something people are
  meant to want to use. One family across display and text also means the
  headline and the paragraph under it are unmistakably the same voice.

  JETBRAINS MONO still carries data. Drawn for code means drawn for columns of
  digits: unambiguous 0/O and 1/l, and even colour down a column of prices.
*/
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
        <Shards />
        <WalletProvider>
          <Nav />
          <main id="main">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
