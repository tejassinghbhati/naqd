/**
 * What the connected wallet actually holds, and what it has working.
 *
 * A trading interface that cannot show a balance is not a trading interface.
 * This is the read side of that: collateral, gas, outcome-token positions, and
 * resting orders, plus the two write actions that belong to the account rather
 * than to a market - cancelling an order and pulling testnet funds.
 *
 * Two numbers matter and are easy to conflate:
 *
 *   Collateral (tUSDC on testnet, USDso on mainnet) is what buys contracts.
 *   Native (STT / SOMI) pays gas. A wallet full of collateral and empty of gas
 *   can do nothing at all, and the failure it produces - a revert with no
 *   obvious cause - is one of the least helpful in this stack. Both are shown,
 *   always, and low gas is called out before it can bite.
 */

import type { SomniaMarkets, UnifiedOrder } from "@somnia-chain/markets-sdk";
import { erc20Abi, formatUnits, type Address, type PublicClient, type WalletClient } from "viem";
import type { NetworkConfig } from "./chain";

export interface Balances {
  /** Spendable collateral, human units. */
  collateral: number;
  /** Native gas token, human units. */
  native: number;
  /** Outcome-token holdings, keyed by the SDK's symbol for them. */
  outcomes: { symbol: string; amount: number }[];
  /** True when gas is too low to reliably land a transaction. */
  lowGas: boolean;
}

const EMPTY: Balances = { collateral: 0, native: 0, outcomes: [], lowGas: false };

/**
 * Below this much native, a transaction is likely to fail for gas rather than
 * for anything the user did. Warning early is cheaper than explaining a revert.
 */
const LOW_GAS = 0.001;

export async function loadBalances(
  exchange: SomniaMarkets,
  cfg: NetworkConfig,
  address: Address,
): Promise<Balances> {
  const client = exchange.client.getViemClient() as PublicClient;

  const [unified, native] = await Promise.all([
    exchange.fetchBalance().catch(() => null),
    client.getBalance({ address }).catch(() => 0n),
  ]);

  // Prefer the collateral read straight from the token: the unified balance
  // map keys by symbol, and the symbol differs per network.
  let collateral = 0;
  const token = cfg.addresses.collateral as Address | undefined;
  if (token) {
    try {
      const raw = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      collateral = Number(formatUnits(raw, cfg.decimals));
    } catch {
      collateral = unified?.[cfg.collateralSymbol]?.free ?? 0;
    }
  }

  const outcomes = unified
    ? Object.entries(unified)
        // Outcome tokens carry the market symbol; collateral and gas do not.
        .filter(([code, b]) => code.includes("#") && b.total > 0)
        .map(([symbol, b]) => ({ symbol, amount: b.total }))
        .sort((a, b) => b.amount - a.amount)
    : [];

  const nativeHuman = Number(formatUnits(native, 18));
  return {
    collateral,
    native: nativeHuman,
    outcomes,
    lowGas: nativeHuman < LOW_GAS,
  };
}

export interface RestingOrder {
  id: string;
  symbol: string;
  side: string;
  price: number;
  amount: number;
  remaining: number;
}

export async function loadOpenOrders(exchange: SomniaMarkets): Promise<RestingOrder[]> {
  try {
    const rows = (await exchange.fetchOpenOrders()) as UnifiedOrder[];
    return rows.map((o) => ({
      id: String(o.id),
      symbol: String(o.symbol ?? ""),
      side: String(o.side ?? ""),
      price: Number(o.price ?? 0),
      amount: Number(o.amount ?? 0),
      remaining: Number(o.remaining ?? o.amount ?? 0),
    }));
  } catch {
    // No signer, or nothing resting. Both are ordinary.
    return [];
  }
}

/**
 * Testnet collateral, straight from the faucet the token exposes.
 *
 * Only on testnet: on mainnet the collateral is USDso, a real stablecoin with
 * no faucet, and offering the button there would be a lie. `faucet(uint256)` is
 * public on the TestUSDC contract.
 */
export async function faucet(
  wallet: WalletClient,
  cfg: NetworkConfig,
  amountHuman = 1000,
): Promise<string> {
  if (cfg.network !== "testnet") throw new Error("The faucet only exists on testnet.");
  const token = cfg.addresses.testUsdc as Address | undefined;
  if (!token) throw new Error("No faucet token configured for this network.");
  // Take the wallet client directly rather than reaching into `exchange.trader`:
  // the SDK does not expose its signer, and depending on a private field would
  // break silently on any SDK update.
  if (!wallet.account) throw new Error("Connect a wallet first.");

  const amount = BigInt(Math.round(amountHuman * 10 ** cfg.decimals));
  const hash = await wallet.writeContract({
    address: token,
    abi: [
      {
        type: "function",
        name: "faucet",
        stateMutability: "nonpayable",
        inputs: [{ name: "amount", type: "uint256" }],
        outputs: [],
      },
    ] as const,
    functionName: "faucet",
    args: [amount],
    chain: cfg.chain,
    account: wallet.account,
  });
  return hash;
}
