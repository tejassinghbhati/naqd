import type { Metadata } from "next";
import TerminalClient from "./TerminalClient";

export const metadata: Metadata = {
  title: "Terminal",
  description:
    "Trade DreamDEX event contracts with a measured fair value beside every price. Live books, countdowns, depth and tape.",
};

/**
 * The terminal reads live chain state and holds a wallet, so the workspace
 * itself is a client component. This wrapper stays on the server purely to own
 * the route's metadata - there is nothing to prerender, and pretending
 * otherwise would just ship a skeleton the client immediately replaces.
 */
export default function TerminalPage() {
  return <TerminalClient />;
}
