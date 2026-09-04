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
        <Mark />
        <span className="brand-name">Assay</span>
      </Link>

      <div className="nav-links">
        {LINKS.map((l) => {
          // The landing is not in this list - the wordmark is the way home - so a
          // prefix match is safe here and keeps nested routes lighting up their parent.
          const active = path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
              {l.label}
            </Link>
          );
        })}
      </div>

      <div className="spacer" />

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
        <button type="button" className="btn-primary" onClick={openConnect}>
          Connect wallet
        </button>
      )}

      <ThemeToggle />
      </div>
    </nav>
  );
}
