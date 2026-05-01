import { defineChain } from "viem";
import { createConfig, http, fallback } from "wagmi";
import { mainnet } from "wagmi/chains";
import {
  coinbaseWallet,
  injected,
  walletConnect,
} from "wagmi/connectors";
import type { CreateConnectorFn } from "wagmi";

// Some browser wallets are inconsistent about whether they reach EIP-6963
// (multi-injected provider discovery) when the page runs inside an iframe
// — notably Rabby and Backpack. We register explicit injected fallbacks
// using each wallet's reverse-DNS identifier so wagmi de-duplicates them
// against the EIP-6963 announcement when both are present.
type EvmProvider = import("viem").EIP1193Provider;
type WalletWindow = typeof window & {
  ethereum?: EvmProvider & {
    isRabby?: boolean;
    isBackpack?: boolean;
  };
  backpack?: { ethereum?: EvmProvider };
};

const rabbyFallback = () =>
  injected({
    shimDisconnect: true,
    target() {
      const w =
        typeof window !== "undefined" ? (window as WalletWindow) : undefined;
      const provider = w?.ethereum?.isRabby ? w.ethereum : undefined;
      return { id: "io.rabby", name: "Rabby", provider };
    },
  });

const backpackFallback = () =>
  injected({
    shimDisconnect: true,
    target() {
      const w =
        typeof window !== "undefined" ? (window as WalletWindow) : undefined;
      // Backpack exposes its EVM provider on `window.backpack.ethereum`,
      // and on some versions also tags `window.ethereum.isBackpack`.
      const provider =
        w?.backpack?.ethereum ?? (w?.ethereum?.isBackpack ? w.ethereum : undefined);
      return { id: "app.backpack", name: "Backpack", provider };
    },
  });

// Monad mainnet — chain ID 143, launched November 24, 2025. This is the
// default chain for NadBurn (first entry in the chains array).
// Recovery on Monad mainnet routes through Uniswap's Trading API, since
// Uniswap on Monad is V4-only — see RECOVERY_MODE in lib/constants.ts.
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://monad-mainnet.drpc.org"] },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://monadexplorer.com",
    },
  },
});

// Monad testnet — chain ID 10143. Backed by the official testnet RPC and
// the testnet shard of Monad Explorer (Blockscout-compatible). Definition
// is kept exported so re-enabling the testnet later is a one-line change
// (add it back to `wagmiConfig.chains` and the `transports` map below).
// Currently NOT wired into the active config because the app is live and
// real users shouldn't see a testnet entry in the network picker.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer (Testnet)",
      url: "https://testnet.monadexplorer.com",
    },
  },
  testnet: true,
});

// Production RPC URLs come from env so we don't ship a free public endpoint
// that gets rate-limited the moment real users show up. Falling back to the
// public RPC keeps local dev working without forcing an Alchemy/Infura key.
const MAINNET_RPC = import.meta.env.VITE_MAINNET_RPC_URL as string | undefined;
const MONAD_MAINNET_RPC = import.meta.env.VITE_MONAD_MAINNET_RPC_URL as
  | string
  | undefined;

// Public Monad mainnet RPCs we cycle through with viem's fallback transport.
// All three respond to eth_chainId with the correct value (0x8f / 143). When
// one rate-limits or returns a CORS/HTTP error, viem moves on to the next
// transparently — that's the fix for the "HTTP request failed" the user was
// seeing on token reads. The official endpoint goes first since it tends to
// have the best uptime, with two community endpoints as backup.
const MONAD_MAINNET_PUBLIC_RPCS = [
  "https://rpc.monad.xyz",
  "https://monad-mainnet.drpc.org",
  "https://monad.drpc.org",
];
const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;

// We rely on EIP-6963 multi-injected provider discovery (enabled by default
// in wagmi v2) to surface every browser wallet the user actually has
// installed — MetaMask, Phantom, Frame, Trust, Brave, etc. — so each shows
// up exactly once under its real name and icon.
//
// Rabby and Backpack ship explicit fallbacks because their content scripts
// don't always reach EIP-6963 inside iframes (e.g. the Replit preview).
// The `id` on each fallback target matches the wallet's reverse-DNS
// identifier so wagmi de-duplicates against the EIP-6963 announcement when
// both fire — you'll see Rabby once and Backpack once, never twice.
//
// Coinbase Wallet ships its own SDK with a QR/popup flow that's not pure
// EIP-1193 injected, so it stays as an explicit connector.
const connectors: CreateConnectorFn[] = [
  rabbyFallback(),
  backpackFallback(),
  coinbaseWallet({ appName: "NadBurn", appLogoUrl: undefined }),
];

// WalletConnect requires a project ID from cloud.walletconnect.com. We only
// register the connector when one is provided so dev environments don't crash
// with a missing-projectId error.
if (WC_PROJECT_ID) {
  connectors.push(
    walletConnect({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: "NadBurn",
        description: "Burn or recover dust tokens on Monad and Ethereum.",
        url:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://nadburn.app",
        icons: [],
      },
      showQrModal: true,
    }),
  );
}

// Chain order matters — wagmi treats the first entry as the initial /
// default chain when a wallet first connects. Monad mainnet leads.
//
// Monad testnet is intentionally omitted from the live network picker —
// see the comment on `monadTestnet` above for the re-enable steps.
export const wagmiConfig = createConfig({
  chains: [monadMainnet, mainnet],
  connectors,
  transports: {
    // Prefer the user's RPC, but always keep the public endpoint as a backup
    // so a brief outage on the primary doesn't take the whole UI down.
    // Always wrap Monad mainnet in fallback() so a single rate-limit or
    // CORS hiccup on one public RPC doesn't kill token reads. If the user
    // supplied their own (Alchemy etc.) it goes first.
    [monadMainnet.id]: fallback(
      (MONAD_MAINNET_RPC
        ? [MONAD_MAINNET_RPC, ...MONAD_MAINNET_PUBLIC_RPCS]
        : MONAD_MAINNET_PUBLIC_RPCS
      ).map((url) => http(url)),
    ),
    [mainnet.id]: MAINNET_RPC ? fallback([http(MAINNET_RPC), http()]) : http(),
  },
});
