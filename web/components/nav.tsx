"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";
import { useWallet } from "./wallet/WalletProvider";
import { AccountMenu } from "./wallet/AccountMenu";
import { Mark } from "./site/mark";

const LINKS = [
  { href: "/research", label: "Research" },
  { href: "/agent", label: "Agent" },
  { href: "/terminal", label: "Terminal" },
  { href: "/developers", label: "Developers" },
];

export function Nav() {
  const path = usePathname();
  const { cfg, conn, balances, wrongChain, openConnect, disconnect, switchChain, runFaucet, faucetBusy } =
    useWallet();

  return (
    <nav className="nav">
      <div className="nav-inner">
      <Link href="/" className="brand" aria-label="Assay, home">
        <span className="brand-punch">
          <Mark size={20} />
        </span>
        <span className="brand-name">Assay</span>
        {/* The register mark. A hallmark carries the office that struck it, and
            it is the one place the venue's name belongs at this size. */}
        <span className="brand-reg">DreamDEX</span>
      </Link>

      <span className="nav-sep" aria-hidden="true" />

      <div className="nav-links">
        {LINKS.map((l, i) => {
          // The landing is not in this list - the wordmark is the way home - so a
          // prefix match is safe here and keeps nested routes lighting up their parent.
          const active = path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
              <span className="nav-idx">{String(i + 1).padStart(2, "0")}</span>
              <span className="nav-label">{l.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="spacer" />

      {/* One cluster, not two floating buttons. Sharing a border is what makes
          a pair of controls read as a single piece of hardware. */}
      <div className="nav-actions">
      {conn ? (
        <AccountMenu
          cfg={cfg}
          conn={conn}
          balances={balances}
          wrongChain={wrongChain}
          faucetBusy={faucetBusy}
          onFaucet={runFaucet}
          onSwitchChain={switchChain}
          onDisconnect={disconnect}
        />
      ) : (
        <button type="button" className="btn btn-glass" onClick={openConnect}>
          Connect wallet
        </button>
      )}

      <ThemeToggle />
      </div>
      </div>
    </nav>
  );
}
