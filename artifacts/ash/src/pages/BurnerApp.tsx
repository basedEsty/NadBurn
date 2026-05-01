import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useAccount,
  useChainId,
  useBalance,
  useReadContracts,
  useWriteContract,
  useSendTransaction,
  usePublicClient,
} from "wagmi";
import { formatUnits, maxUint256, parseUnits } from "viem";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Flame, Wallet, Plus, Loader2, AlertCircle, Sparkles, RefreshCw, Coins, Star, Image as ImageIcon } from "lucide-react";
import {
  BURN_ADDRESS,
  ERC20_ABI,
  ERC20_APPROVE_ABI,
  V2_ROUTER_ABI,
  CURATED_TOKENS,
  DEX_ROUTERS,
  FEE_RECIPIENT,
  RECOVERY_FEE_WEI,
  EXPLORER_TX,
  SLIPPAGE_BPS,
  DEFAULT_SLIPPAGE_BPS,
  SWAP_DEADLINE_SECONDS,
  RECOVERY_MODE,
} from "@/lib/constants";
import {
  uniswapTrading,
  extractQuoteOut,
  NATIVE_TOKEN_SENTINEL,
  type TradingApiError,
} from "@/lib/uniswap-trading";
import { useSwitchChain } from "wagmi";
import { FireParticles } from "@/components/FireParticles";
import { BurnProgress, type ProgressStep } from "@/components/BurnProgress";
import HistoryPanel from "@/components/HistoryPanel";
import { ConfirmBurnDialog, type ConfirmTokenLine } from "@/components/ConfirmBurnDialog";
import { NftBurner } from "@/components/NftBurner";
import { api } from "@/lib/api";
import { apiUrl } from "@/lib/api-base";
import { getTokenLogo, fallbackTokenLogo } from "@/lib/token-logos";

// Resolves a token logo. Uses Uniswap's official default token list (cached
// from tokens.uniswap.org), with deterministic dicebear fallback for tokens
// the list doesn't know about.
function getTokenLogoUrl(chainId: number, address: string): string {
  if (address === "native") {
    // Native gas tokens use a chain-keyed seed so MON / ETH have distinct icons
    return `https://api.dicebear.com/7.x/shapes/svg?seed=native-${chainId}&backgroundColor=7c3aed`;
  }
  const fromUniswap = getTokenLogo(chainId, address);
  if (fromUniswap) return fromUniswap;
  return fallbackTokenLogo(address);
}

interface TokenBalance {
  address: `0x${string}` | "native";
  symbol: string;
  name: string;
  balance: bigint;
  decimals: number;
}

type BurnMode = "burn" | "recover";
type AssetMode = "tokens" | "nfts";

async function fetchAutoTokenList(chainId: number): Promise<`0x${string}`[]> {
  try {
    const res = await fetch("https://tokens.uniswap.org");
    if (!res.ok) return [];
    const data = await res.json();
    const tokens: { address: string; chainId: number }[] = data.tokens ?? [];
    return tokens
      .filter((t) => t.chainId === chainId)
      .map((t) => t.address as `0x${string}`);
  } catch {
    return [];
  }
}

// We hit the chain's block explorer through our own server so we sidestep
// CORS/rate-limit issues that the browser would otherwise hit when calling
// Blockscout directly. The server tries multiple endpoint shapes and returns
// a normalized { tokens: [{ address, symbol, ... }] } payload.
type WalletTokenScan = {
  addresses: `0x${string}`[];
  /**
   * `true` when the backend explicitly reported a missing indexer API key
   * (currently only on Monad mainnet without BLOCKVISION_API_KEY). Used to
   * drive a one-time "configure auto-detect" toast instead of silently
   * returning zero results.
   */
  missingKey?: boolean;
};

async function fetchWalletTokenAddresses(
  chainId: number,
  address: string,
): Promise<WalletTokenScan> {
  try {
    const res = await fetch(
      apiUrl(`/api/explorer/tokens?chainId=${chainId}&address=${address}`),
      { credentials: "include" },
    );
    if (!res.ok) return { addresses: [] };
    const data = (await res.json()) as {
      tokens?: Array<{ address?: string }>;
      source?: string;
      code?: string;
    };
    if (data?.code === "MISSING_BLOCKVISION_API_KEY") {
      return { addresses: [], missingKey: true };
    }
    const list = Array.isArray(data?.tokens) ? data.tokens : [];
    const addresses = list
      .map((t) => t?.address ?? "")
      .filter((a): a is string => /^0x[a-fA-F0-9]{40}$/.test(a))
      .map((a) => a as `0x${string}`);
    return { addresses };
  } catch {
    return { addresses: [] };
  }
}

// Chains the app actually understands. Anything outside this list shows a
// "switch network" banner because we have no DEX/explorer/burn wiring for it.
const SUPPORTED_CHAIN_IDS = [143, 1] as const;
const SUPPORTED_CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  143: "Monad",
};

// Native gas-token symbol per chain. Used in UI strings for the "Recover X"
// flow. Chains without a DEX wiring still appear here because burn-mode UI
// also references the symbol when summarizing the wallet.
const NATIVE_SYMBOL: Record<number, string> = {
  1: "ETH",
  143: "MON",
};

export default function BurnerApp() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { toast } = useToast();
  const publicClient = usePublicClient();
  const { chains, switchChain } = useSwitchChain();

  // Wrap switchChain with toast feedback. Wallets like Phantom only allow
  // EVM chains the user has explicitly enabled in their wallet settings —
  // for new chains (Monad mainnet) they refuse the request entirely instead
  // of prompting the standard "add network?" dialog. Without a catch the
  // user just sees nothing happen and assumes our app is broken.
  const handleSwitchChain = useCallback(
    (id: number) => {
      switchChain(
        { chainId: id },
        {
          onError: (err) => {
            const msg =
              (err as { shortMessage?: string }).shortMessage ?? err.message;
            const isMonad = id === 143;
            toast({
              title: "Couldn't switch network",
              description: isMonad
                ? `${msg} — if your wallet says "network not activated", open your wallet settings and enable Monad mainnet, then try again.`
                : msg,
              variant: "destructive",
            });
          },
        },
      );
    },
    [switchChain, toast],
  );
  const isSupportedChain = (SUPPORTED_CHAIN_IDS as readonly number[]).includes(
    chainId,
  );

  // Auto-switch to Monad mainnet (chain 143) on first connect. Most wallets
  // come back online on Ethereum mainnet by default, but Nadburn is a Monad-
  // first dApp — landing on the wrong chain confuses users and shows zero
  // tokens. We only attempt once per session so users who deliberately want
  // to operate on Ethereum can switch back without us yanking them away.
  const [autoSwitchAttempted, setAutoSwitchAttempted] = useState(false);
  useEffect(() => {
    if (!isConnected) {
      setAutoSwitchAttempted(false);
      return;
    }
    if (autoSwitchAttempted) return;
    if (chainId === 143) return;
    setAutoSwitchAttempted(true);
    switchChain(
      { chainId: 143 },
      {
        onError: () => {
          // Swallow — wallet may not have Monad enabled. The "Couldn't switch
          // network" toast from handleSwitchChain would be confusing here
          // since the user didn't explicitly ask to switch.
        },
      },
    );
  }, [isConnected, chainId, autoSwitchAttempted, switchChain]);

  const [customTokenInput, setCustomTokenInput] = useState("");
  const [customTokens, setCustomTokens] = useState<`0x${string}`[]>([]);
  const [autoTokens, setAutoTokens] = useState<`0x${string}`[]>([]);
  const [autoScanning, setAutoScanning] = useState(false);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  // Snapshot of full TokenBalance data taken at the moment a user selects a
  // token. We can't rely on looking the token back up in `discoveredTokens`
  // at confirm/burn time — that array is rebuilt on every balance refetch
  // and a momentary 0n read (RPC blip, indexer race, mid-burn refresh) can
  // make a token disappear from the list. Without this snapshot the confirm
  // dialog would silently drop those tokens, which surfaced as the
  // "selected 3, dialog shows 1" bug.
  const [selectedSnapshots, setSelectedSnapshots] = useState<
    Record<string, TokenBalance>
  >({});
  const [mode, setMode] = useState<BurnMode>("burn");
  const [assetMode, setAssetMode] = useState<AssetMode>("tokens");
  const [quotes, setQuotes] = useState<Record<string, bigint>>({});
  // Per-token reason a quote came back zero. We surface this in the UI so
  // the user knows whether it's "Uniswap doesn't have a pool for this token"
  // (very common on Monad mainnet — V4 just launched, most pairs live on
  // other DEXs) versus a thin pool / amount-too-small / API issue.
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [quotingInFlight, setQuotingInFlight] = useState(false);
  // Per-token amount overrides. When undefined we burn/recover the full
  // balance; otherwise we use the override. Stored as raw base units (bigint
  // string) so we keep precision through React state and don't lose dust.
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({});

  // Resolve the actual amount to burn/recover for a token. Override wins,
  // capped at the wallet balance so a stale or fat-fingered value can never
  // produce a transaction we know will revert. Declared early because quote
  // and burn effects below reference it in their dependency arrays — moving
  // it later would trigger a TDZ error at first render.
  const amountFor = useCallback(
    (addr: string, balance: bigint): bigint => {
      const raw = tokenAmounts[addr];
      if (!raw) return balance;
      try {
        const parsed = BigInt(raw);
        if (parsed <= 0n) return balance;
        return parsed > balance ? balance : parsed;
      } catch {
        return balance;
      }
    },
    [tokenAmounts],
  );

  const dex = DEX_ROUTERS[chainId];
  const recoveryMode = RECOVERY_MODE[chainId];
  // Recovery is available if either (a) we have a V2 router for this chain,
  // or (b) we have a Trading API integration for it. Burning works regardless.
  const recoveryAvailable =
    recoveryMode === "trading-api" || (recoveryMode === "v2" && !!dex?.router);
  const nativeSymbol = NATIVE_SYMBOL[chainId];
  const recoveryFeeWei = RECOVERY_FEE_WEI[chainId] ?? 0n;
  // Set when the Trading API proxy reports the server-side API key is
  // missing — we surface a configuration banner instead of silently 0-quoting.
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const { data: savedTokens } = useQuery({
    queryKey: ["saved-tokens"],
    queryFn: api.listSavedTokens,
    enabled: isAuthenticated,
  });

  const savedForChain = useMemo(
    () => (savedTokens ?? []).filter((s) => s.chainId === chainId),
    [savedTokens, chainId],
  );

  const savedAddresses = useMemo(
    () => new Set(savedForChain.map((s) => s.tokenAddress.toLowerCase())),
    [savedForChain],
  );

  const saveTokenMut = useMutation({
    mutationFn: api.saveToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-tokens"] }),
  });

  const deleteSavedMut = useMutation({
    mutationFn: api.deleteSavedToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-tokens"] }),
  });

  const handleToggleSaved = (token: TokenBalance) => {
    if (!isAuthenticated) {
      toast({
        title: "Sign in required",
        description: "Sign in with the button up top to save tokens to your list.",
      });
      return;
    }
    if (token.address === "native") return;
    const existing = savedForChain.find(
      (s) => s.tokenAddress.toLowerCase() === (token.address as string).toLowerCase(),
    );
    if (existing) {
      deleteSavedMut.mutate(existing.id);
    } else {
      saveTokenMut.mutate({
        chainId,
        tokenAddress: token.address as string,
        tokenSymbol: token.symbol,
        tokenName: token.name || null,
        decimals: token.decimals,
      });
    }
  };

  const { data: nativeBalance, refetch: refetchNative } = useBalance({
    address,
  });

  const tokensToCheck = useMemo<`0x${string}`[]>(() => {
    const curated = (CURATED_TOKENS[chainId] || []).map((t) => t.address);
    const saved = savedForChain.map((s) => s.tokenAddress as `0x${string}`);
    const all = [...curated, ...saved, ...customTokens, ...autoTokens];
    const seen = new Set<string>();
    const out: `0x${string}`[] = [];
    for (const a of all) {
      const k = a.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
    return out;
  }, [chainId, customTokens, autoTokens, savedForChain]);

  const contracts = useMemo(
    () =>
      tokensToCheck.flatMap((tokenAddr) => [
        { address: tokenAddr, abi: ERC20_ABI, functionName: "balanceOf", args: [address as `0x${string}`] },
        { address: tokenAddr, abi: ERC20_ABI, functionName: "decimals" },
        { address: tokenAddr, abi: ERC20_ABI, functionName: "symbol" },
        { address: tokenAddr, abi: ERC20_ABI, functionName: "name" },
      ]),
    [tokensToCheck, address]
  );

  const {
    data: tokenData,
    isLoading: isLoadingTokens,
    isFetching: isFetchingTokens,
    refetch: refetchTokens,
  } = useReadContracts({
    contracts: contracts as any,
    query: {
      enabled: !!address && tokensToCheck.length > 0,
    },
  });

  const [discoveredTokens, setDiscoveredTokens] = useState<TokenBalance[]>([]);

  useEffect(() => {
    const tokens: TokenBalance[] = [];

    if (nativeBalance && nativeBalance.value > 0n) {
      tokens.push({
        address: "native",
        symbol: nativeBalance.symbol,
        name: "Native Token",
        balance: nativeBalance.value,
        decimals: nativeBalance.decimals,
      });
    }

    if (tokenData) {
      for (let i = 0; i < tokensToCheck.length; i++) {
        const balanceRes = tokenData[i * 4];
        const decimalsRes = tokenData[i * 4 + 1];
        const symbolRes = tokenData[i * 4 + 2];
        const nameRes = tokenData[i * 4 + 3];

        // Only require a successful, non-zero balance read. Symbol/name/
        // decimals fall back to safe defaults so weird tokens that don't
        // implement the optional ERC-20 metadata still appear in the list
        // instead of being silently dropped.
        if (
          balanceRes?.status === "success" &&
          (balanceRes.result as bigint) > 0n
        ) {
          const addr = tokensToCheck[i];
          tokens.push({
            address: addr,
            symbol:
              symbolRes?.status === "success"
                ? (symbolRes.result as string)
                : `${addr.slice(0, 6)}…${addr.slice(-4)}`,
            name: nameRes?.status === "success" ? (nameRes.result as string) : "Unknown token",
            balance: balanceRes.result as bigint,
            decimals:
              decimalsRes?.status === "success" ? (decimalsRes.result as number) : 18,
          });
        }
      }
    }

    setDiscoveredTokens(tokens);
  }, [nativeBalance, tokenData, tokensToCheck]);

  // Keep selection snapshots in sync with the freshest discovered balances
  // so that, if the user lets the page sit between selecting and confirming,
  // we burn against the latest known balance — but a momentary 0n drop in
  // the live list never deletes a snapshot. The snapshot is only ever
  // cleared by an explicit deselect or by completing a burn batch.
  useEffect(() => {
    if (discoveredTokens.length === 0) return;
    setSelectedSnapshots((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of discoveredTokens) {
        if (t.address in prev) {
          const cur = prev[t.address];
          if (
            cur.balance !== t.balance ||
            cur.decimals !== t.decimals ||
            cur.symbol !== t.symbol
          ) {
            next[t.address] = t;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [discoveredTokens]);

  // Quote selected tokens in recover mode. Two backends:
  //   - "v2": on-chain getAmountsOut against a Uniswap V2 router
  //   - "trading-api": Uniswap Trading API via our backend proxy (chain 143)
  useEffect(() => {
    if (mode !== "recover" || !recoveryAvailable) {
      setQuotes({});
      return;
    }
    const erc20Selected = discoveredTokens.filter(
      (t) => t.address !== "native" && selectedTokens.has(t.address)
    );
    if (erc20Selected.length === 0) {
      setQuotes({});
      return;
    }

    let cancelled = false;
    setQuotingInFlight(true);
    // Clear any stale "API key missing" banner from a previous chain so it
    // doesn't persist after switching to a chain that doesn't use the API.
    setApiKeyMissing(false);

    (async () => {
      const next: Record<string, bigint> = {};

      if (recoveryMode === "v2" && publicClient && dex?.router) {
        await Promise.all(
          erc20Selected.map(async (t) => {
            const amt = amountFor(t.address as string, t.balance);
            try {
              const result = (await publicClient.readContract({
                address: dex.router as `0x${string}`,
                abi: V2_ROUTER_ABI,
                functionName: "getAmountsOut",
                args: [
                  amt,
                  [t.address as `0x${string}`, dex.wrappedNative],
                ],
              })) as bigint[];
              next[t.address as string] = result[result.length - 1] ?? 0n;
            } catch {
              next[t.address as string] = 0n;
            }
          })
        );
      } else if (recoveryMode === "trading-api" && address) {
        // Slippage in the Trading API is a percentage (e.g. 2.0 = 2%),
        // whereas SLIPPAGE_BPS is in basis points (200 = 2%). Convert.
        const slippagePct =
          Number(SLIPPAGE_BPS[chainId] ?? DEFAULT_SLIPPAGE_BPS) / 100;
        let sawMissingKey = false;
        const nextErrors: Record<string, string> = {};
        await Promise.all(
          erc20Selected.map(async (t) => {
            const amt = amountFor(t.address as string, t.balance);
            try {
              const q = await uniswapTrading.quote({
                tokenIn: t.address,
                tokenOut: NATIVE_TOKEN_SENTINEL,
                amount: amt.toString(),
                type: "EXACT_INPUT",
                tokenInChainId: chainId,
                tokenOutChainId: chainId,
                swapper: address,
                slippageTolerance: slippagePct,
              });
              const out = extractQuoteOut(q);
              next[t.address as string] = out;
              if (out === 0n) {
                // Trading API responded successfully but with no usable
                // amount. Treat as "no Uniswap pool" — the most common cause.
                nextErrors[t.address as string] =
                  "Uniswap returned no route (no V4 pool for this token).";
              }
            } catch (err: unknown) {
              const e = err as TradingApiError;
              if (e?.code === "MISSING_UNISWAP_API_KEY") sawMissingKey = true;
              next[t.address as string] = 0n;
              // Surface the upstream message verbatim — Trading API errors
              // like "NO_ROUTES_FOUND", "amount too small", etc are
              // user-actionable. Generic fallback if nothing useful came back.
              const reason =
                e?.error || e?.detail || "Couldn't fetch a Uniswap quote.";
              nextErrors[t.address as string] = reason.slice(0, 180);
            }
          })
        );
        if (!cancelled) {
          setApiKeyMissing(sawMissingKey);
          setQuoteErrors(nextErrors);
        }
      }

      if (!cancelled) {
        setQuotes(next);
        setQuotingInFlight(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    selectedTokens,
    discoveredTokens,
    recoveryAvailable,
    recoveryMode,
    publicClient,
    dex?.router,
    dex?.wrappedNative,
    address,
    chainId,
    // Re-quote whenever the user changes a per-token amount, otherwise the
    // displayed estimate stays stale and the swap call would use a different
    // amount than what was quoted.
    amountFor,
  ]);

  const handleAutoDetect = useCallback(
    async (silent = false) => {
      if (!address) return;
      setAutoScanning(true);
      try {
        // Preferred path: ask the chain's indexer which ERC-20s this wallet
        // actually holds. Ethereum + Monad testnet use Blockscout; Monad
        // mainnet uses Blockvision (server-side API key required — when it
        // isn't configured the backend returns missingKey:true so we can
        // surface a friendly setup nudge instead of a silent zero result).
        const wallet = await fetchWalletTokenAddresses(chainId, address);
        if (wallet.missingKey) {
          setAutoTokens([]);
          if (!silent) {
            toast({
              title: "Monad auto-detect not configured",
              description:
                "Add a Blockvision API key on the server to enable auto-detect, or paste tokens manually below.",
            });
          }
          return;
        }
        if (wallet.addresses.length > 0) {
          setAutoTokens(wallet.addresses);
          if (!silent) {
            toast({
              title: `Found ${wallet.addresses.length} token${wallet.addresses.length === 1 ? "" : "s"}`,
              description: "Pulling balances and details from the chain…",
            });
          }
          return;
        }
        // Fallback: filter a public token list by chain (legacy path, best
        // effort on chains without an explorer-backed scan).
        const list = await fetchAutoTokenList(chainId);
        if (list.length > 0) {
          setAutoTokens(list);
          if (!silent) {
            toast({
              title: "Broad scan started",
              description: `Checking balances across ${list.length} known tokens.`,
            });
          }
        } else if (!silent) {
          toast({
            title: "No tokens detected",
            description:
              "Try Refresh, or paste a token contract below to add it manually.",
          });
        }
      } finally {
        setAutoScanning(false);
      }
    },
    [address, chainId, toast],
  );

  // Kick off a silent background scan as soon as the wallet connects or the
  // user switches networks, so the nads pile is already populated by the time
  // they look at it. The button stays available for manual re-scans.
  useEffect(() => {
    if (!isConnected || !address) {
      // Reset detected tokens when the wallet disconnects so a stale list
      // doesn't linger.
      setAutoTokens([]);
      return;
    }
    void handleAutoDetect(true);
  }, [isConnected, address, chainId, handleAutoDetect]);

  // Reset every selection-adjacent piece of state when the active wallet,
  // network, or connection status changes. Without this, a selection made
  // on chain A would still be actionable after switching to chain B (the
  // action button is gated on `selectedTokens.size`), and we'd happily
  // send `transfer` calls against chain-A addresses on chain B's RPC.
  useEffect(() => {
    setSelectedTokens(new Set());
    setSelectedSnapshots({});
    setTokenAmounts({});
    setQuotes({});
    setQuoteErrors({});
    setConfirmOpen(false);
  }, [chainId, address, isConnected]);

  const handleSelectAll = () => {
    if (selectedTokens.size === discoveredTokens.length) {
      setSelectedTokens(new Set());
      setSelectedSnapshots({});
    } else {
      setSelectedTokens(new Set(discoveredTokens.map((t) => t.address)));
      setSelectedSnapshots(
        Object.fromEntries(discoveredTokens.map((t) => [t.address, t])),
      );
    }
  };

  const handleAddCustomToken = async () => {
    const raw = customTokenInput.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
      toast({
        title: "Invalid Address",
        description: "Paste a valid 0x… ERC-20 contract address.",
        variant: "destructive",
      });
      return;
    }
    const addr = raw as `0x${string}`;
    if (customTokens.find((c) => c.toLowerCase() === addr.toLowerCase())) {
      toast({ title: "Already in your list", description: addr });
      setCustomTokenInput("");
      return;
    }
    if (!publicClient || !address) {
      toast({
        title: "Connect a wallet first",
        variant: "destructive",
      });
      return;
    }
    // Sanity check: the public client we read from must actually be on the
    // chain the wallet thinks it's on. If they disagree it almost always
    // means the wallet rejected (or never received) a chain switch — e.g.
    // Phantom on Monad mainnet without "Monad" enabled in the wallet's
    // network settings. Reading a Monad contract from an Ethereum RPC just
    // returns an empty/cryptic error, so flag the real cause up-front.
    if (publicClient.chain && publicClient.chain.id !== chainId) {
      toast({
        title: "Wallet and app are on different networks",
        description: `Your wallet is on chain ${publicClient.chain.id} but the app shows ${SUPPORTED_CHAIN_LABELS[chainId] ?? `chain ${chainId}`}. Switch networks in your wallet, then try again.`,
        variant: "destructive",
      });
      return;
    }
    // Pre-flight the contract so the user gets immediate feedback. We use
    // allSettled and accept the token if *any* ERC-20 method responds — some
    // tokens have non-standard implementations where one read may revert
    // even though the contract is otherwise functional. If nothing responds,
    // we surface the actual RPC error so the user knows whether it's a
    // wrong-chain issue, a bad address, or just an RPC blip.
    const [balanceRes, symbolRes, decimalsRes] = await Promise.allSettled([
      publicClient.readContract({
        address: addr,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: addr,
        abi: ERC20_ABI,
        functionName: "symbol",
      }) as Promise<string>,
      publicClient.readContract({
        address: addr,
        abi: ERC20_ABI,
        functionName: "decimals",
      }) as Promise<number>,
    ]);

    const anyOk =
      balanceRes.status === "fulfilled" ||
      symbolRes.status === "fulfilled" ||
      decimalsRes.status === "fulfilled";

    if (!anyOk) {
      // Pull a useful one-liner out of whichever rejection we have.
      const reason =
        balanceRes.status === "rejected" ? balanceRes.reason : null;
      const msg =
        (reason && typeof reason === "object" && "shortMessage" in reason
          ? (reason as { shortMessage?: string }).shortMessage
          : null) ??
        (reason instanceof Error ? reason.message : null) ??
        "No response from contract.";
      toast({
        title: "Couldn't read this token",
        description: `${msg.slice(0, 140)}${msg.length > 140 ? "…" : ""} — check the address is on ${SUPPORTED_CHAIN_LABELS[chainId] ?? "this chain"}.`,
        variant: "destructive",
      });
      return;
    }

    const symbol = symbolRes.status === "fulfilled" ? symbolRes.value : "TOKEN";
    const balance = balanceRes.status === "fulfilled" ? balanceRes.value : null;

    setCustomTokens((prev) => [...prev, addr]);
    setCustomTokenInput("");
    if (balance === null) {
      toast({
        title: `${symbol} added`,
        description: "Token added — balance read failed but it'll be retried.",
      });
    } else if (balance === 0n) {
      toast({
        title: `${symbol} added`,
        description: "Your wallet holds 0 of this token, so it won't show in the list.",
      });
    } else {
      toast({
        title: `${symbol} found`,
        description: "Loaded into your nads pile.",
      });
    }
  };

  const toggleSelection = (tokenAddr: string) => {
    // Functional updaters for every related piece of state so that two
    // taps in the same event tick (Radix Checkbox click + bubbled row
    // onClick) can never read a stale closure value and clobber each
    // other. We also derive the selection-related state changes from the
    // *previous* selection set, not from the current closure, so all three
    // pieces (selection, snapshot, amount override) stay consistent.
    let nowSelected = false;
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      if (next.has(tokenAddr)) {
        next.delete(tokenAddr);
        nowSelected = false;
      } else {
        next.add(tokenAddr);
        nowSelected = true;
      }
      return next;
    });
    setSelectedSnapshots((prev) => {
      if (tokenAddr in prev && !nowSelected) {
        const { [tokenAddr]: _, ...rest } = prev;
        return rest;
      }
      if (nowSelected && !(tokenAddr in prev)) {
        // Snapshot the freshest token data so the confirm dialog and burn
        // loop both see this exact entry even if the live token list
        // refetches and momentarily drops it.
        const fresh = discoveredTokens.find((t) => t.address === tokenAddr);
        if (!fresh) return prev;
        return { ...prev, [tokenAddr]: fresh };
      }
      return prev;
    });
    // Drop any custom amount override only when the token is being
    // deselected — so a later re-select starts from "full balance" again.
    if (!nowSelected) {
      setTokenAmounts((prev) => {
        if (!(tokenAddr in prev)) return prev;
        const next = { ...prev };
        delete next[tokenAddr];
        return next;
      });
    }
  };

  const setAmountFraction = (
    addr: string,
    balance: bigint,
    numerator: bigint,
    denominator: bigint,
  ) => {
    const next = (balance * numerator) / denominator;
    setTokenAmounts((prev) => ({ ...prev, [addr]: next.toString() }));
  };

  const setAmountFromInput = (
    addr: string,
    decimals: number,
    balance: bigint,
    text: string,
  ) => {
    const trimmed = text.trim();
    if (trimmed === "") {
      setTokenAmounts((prev) => {
        if (!(addr in prev)) return prev;
        const copy = { ...prev };
        delete copy[addr];
        return copy;
      });
      return;
    }
    // Accept comma or dot decimal separators; reject anything else early so
    // we never call parseUnits with junk that throws and tanks the input.
    const normalized = trimmed.replace(",", ".");
    if (!/^\d*\.?\d*$/.test(normalized)) return;
    try {
      const raw = parseUnits(normalized as `${number}`, decimals);
      const capped = raw > balance ? balance : raw;
      setTokenAmounts((prev) => ({ ...prev, [addr]: capped.toString() }));
    } catch {
      // parseUnits throws on too many decimal places — ignore so the user
      // can keep typing without losing focus.
    }
  };

  const totalRecoveryEstimate = useMemo(() => {
    if (mode !== "recover") return 0n;
    let total = 0n;
    for (const k of Object.keys(quotes)) {
      if (selectedTokens.has(k)) total += quotes[k];
    }
    return total;
  }, [quotes, selectedTokens, mode]);

  const { writeContractAsync, isPending: isWritingContract } = useWriteContract();
  const { sendTransactionAsync, isPending: isSendingTx } = useSendTransaction();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressFinished, setProgressFinished] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reset token-side modals + transient progress whenever the user switches
  // to NFT mode (and vice versa). Without this, a half-open ConfirmBurnDialog
  // from the token flow would still render once the user toggles to NFTs.
  useEffect(() => {
    setConfirmOpen(false);
    setProgressOpen(false);
  }, [assetMode]);

  const confirmTokens = useMemo<ConfirmTokenLine[]>(() => {
    return Array.from(selectedTokens)
      .map(
        (a) =>
          // Snapshot is the source of truth — `discoveredTokens` can briefly
          // drop a token on a 0n RPC blip, which used to make the dialog
          // show fewer rows than the user actually selected.
          selectedSnapshots[a] ??
          discoveredTokens.find((t) => t.address === a),
      )
      .filter((t): t is TokenBalance => !!t)
      .map((t) => {
        const quote = t.address === "native" ? 0n : quotes[t.address as string] ?? 0n;
        const willRecover =
          mode === "recover" && recoveryAvailable && t.address !== "native" && quote > 0n;
        return {
          address: t.address as string,
          symbol: t.symbol,
          decimals: t.decimals,
          // Show the chosen amount (full balance unless overridden) so the
          // confirm dialog matches what we're actually about to send.
          balance: amountFor(t.address as string, t.balance),
          willRecover,
          quote,
        };
      });
  }, [selectedTokens, discoveredTokens, quotes, mode, recoveryAvailable]);

  const updateStep = (id: string, patch: Partial<ProgressStep>) => {
    setProgressSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const willChargeFee = useMemo(() => {
    if (mode !== "recover" || !recoveryAvailable || recoveryFeeWei === 0n) return false;
    // Fee charged only if at least one selected ERC-20 has a non-zero quote
    return discoveredTokens.some(
      (t) =>
        t.address !== "native" &&
        selectedTokens.has(t.address) &&
        (quotes[t.address as string] ?? 0n) > 0n
    );
  }, [mode, recoveryAvailable, recoveryFeeWei, discoveredTokens, selectedTokens, quotes]);

  const handleAction = async () => {
    if (!address) return;

    // Build initial step list. Read from snapshots first (taken at
    // selection time) so a refetch that briefly drops a token from
    // `discoveredTokens` doesn't cause it to silently vanish from the burn
    // batch — the bug behind "selected 3, only 1 burned" reports.
    const tokensInOrder = Array.from(selectedTokens)
      .map(
        (a) =>
          selectedSnapshots[a] ??
          discoveredTokens.find((t) => t.address === a),
      )
      .filter((t): t is TokenBalance => !!t);

    const steps: ProgressStep[] = [];
    if (willChargeFee) {
      steps.push({
        id: "fee",
        type: "fee",
        label: `Service fee · ${formatUnits(recoveryFeeWei, 18)} ${nativeSymbol ?? "native"}`,
        status: "pending",
      });
    }
    for (const t of tokensInOrder) {
      const quote = t.address === "native" ? 0n : quotes[t.address as string] ?? 0n;
      const willRecover = mode === "recover" && recoveryAvailable && t.address !== "native" && quote > 0n;
      if (willRecover) {
        steps.push({
          id: `${t.address}-approve`,
          type: "approve",
          label: `Approve ${t.symbol}`,
          status: "pending",
        });
        steps.push({
          id: `${t.address}-swap`,
          type: "swap",
          label: `Recover ${t.symbol} → ${nativeSymbol ?? "native"}`,
          status: "pending",
          detail: `≈ ${Number(formatUnits(quote, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${nativeSymbol ?? "native"}`,
        });
      } else {
        steps.push({
          id: `${t.address}-burn`,
          type: "burn",
          label: `Burn ${t.symbol}`,
          status: "pending",
        });
      }
    }

    setProgressSteps(steps);
    setProgressOpen(true);
    setProgressFinished(false);
    setIsProcessing(true);

    let recovered = 0;
    let burned = 0;
    let failed = 0;

    try {
      // Charge recovery fee once per batch
      if (willChargeFee) {
        updateStep("fee", { status: "active" });
        try {
          const feeHash = await sendTransactionAsync({
            to: FEE_RECIPIENT,
            value: recoveryFeeWei,
          });
          // Wait for the fee tx to mine before kicking off the per-token
          // loop — same wallet-nonce/gas-estimation reason as every other
          // tx below. Without this, the first token's signature request can
          // hit the wallet while the fee is still in mempool.
          await publicClient!.waitForTransactionReceipt({ hash: feeHash });
          updateStep("fee", { status: "success", detail: `Tx: ${feeHash.slice(0, 14)}…`, txHash: feeHash });
        } catch (err: any) {
          updateStep("fee", {
            status: "failed",
            detail: err.shortMessage || err.message || "Cancelled",
          });
          setProgressFinished(true);
          setIsProcessing(false);
          return;
        }
      }

      for (const token of tokensInOrder) {
        // The user-controlled amount for this token (full balance unless
        // they entered a custom value or hit a 25/50/75% chip). Used in
        // every approve/quote/swap/burn call below so manual amounts
        // propagate consistently through both burn and recover flows.
        const amt = amountFor(token.address as string, token.balance);
        const quote = token.address === "native" ? 0n : quotes[token.address as string] ?? 0n;
        const wantsRecover =
          mode === "recover" && recoveryAvailable && token.address !== "native" && quote > 0n;

        try {
          if (token.address === "native") {
            const burnId = `${token.address}-burn`;
            updateStep(burnId, { status: "active" });
            const hash = await sendTransactionAsync({
              to: BURN_ADDRESS,
              value: amt,
            });
            // Wait for the tx to mine before moving to the next token. Some
            // wallets (mobile especially) get confused about nonce / gas
            // estimation when a second signature request arrives before the
            // first tx is in a block — this is what caused the "last token
            // in batch fails but works alone" reports.
            await publicClient!.waitForTransactionReceipt({ hash });
            updateStep(burnId, { status: "success", detail: `Tx: ${hash.slice(0, 14)}…`, txHash: hash });
            burned += 1;
            api
              .recordBurn({
                chainId,
                tokenAddress: "native",
                tokenSymbol: token.symbol,
                tokenDecimals: token.decimals,
                amount: amt.toString(),
                mode: "burn",
                txHash: hash,
                recoveredNative: null,
              })
              .catch(() => undefined);
          } else if (wantsRecover && recoveryMode === "trading-api") {
            // V4 / Trading API path. Same UX as V2 (approve + swap), but the
            // approve target and swap calldata both come from Uniswap's API
            // — the API has already chosen the best route across V2/V3/V4
            // and built the calldata for the proxy Universal Router.
            const approveId = `${token.address}-approve`;
            const swapId = `${token.address}-swap`;
            updateStep(approveId, { status: "active" });

            // 1) Ask the API whether this token+amount needs an on-chain
            //    approve to the proxy router. If yes, it returns a tx for us
            //    to forward to the wallet.
            let approval = null as Awaited<ReturnType<typeof uniswapTrading.checkApproval>>["approval"];
            try {
              const checkResp = await uniswapTrading.checkApproval({
                walletAddress: address,
                token: token.address,
                amount: amt.toString(),
                chainId,
              });
              approval = checkResp.approval;
            } catch (err) {
              const e = err as TradingApiError;
              updateStep(approveId, {
                status: "failed",
                detail: e?.error || e?.detail || "Approval check failed",
              });
              failed += 1;
              continue;
            }

            if (approval) {
              try {
                const approveHash = await sendTransactionAsync({
                  to: approval.to,
                  data: approval.data,
                  value: BigInt(approval.value || "0"),
                });
                await publicClient!.waitForTransactionReceipt({
                  hash: approveHash,
                });
                updateStep(approveId, {
                  status: "success",
                  detail: `Tx: ${approveHash.slice(0, 14)}…`,
                });
              } catch (err: any) {
                updateStep(approveId, {
                  status: "failed",
                  detail: err?.shortMessage || err?.message || "Cancelled",
                });
                failed += 1;
                continue;
              }
            } else {
              updateStep(approveId, {
                status: "success",
                detail: "Already approved",
              });
            }

            // 2) Re-quote at execution time so we don't swap on a stale
            //    price, then ask the API to build the swap calldata.
            updateStep(swapId, { status: "active" });
            const slippagePct =
              Number(SLIPPAGE_BPS[chainId] ?? DEFAULT_SLIPPAGE_BPS) / 100;
            let swapTx;
            // Track the fresh quote so we record the actual amount the user
            // received, not the (potentially stale) one from the scan phase.
            let liveQuoteOut = 0n;
            try {
              const liveQuote = await uniswapTrading.quote({
                tokenIn: token.address,
                tokenOut: NATIVE_TOKEN_SENTINEL,
                amount: amt.toString(),
                type: "EXACT_INPUT",
                tokenInChainId: chainId,
                tokenOutChainId: chainId,
                swapper: address,
                slippageTolerance: slippagePct,
              });
              liveQuoteOut = extractQuoteOut(liveQuote);
              if (liveQuoteOut === 0n) {
                throw { error: "No live route — falling back to burn" };
              }
              const buildResp = await uniswapTrading.swap({
                quote: liveQuote.quote,
              });
              swapTx = buildResp.swap;
            } catch (err) {
              const e = err as TradingApiError;
              // Fall back to burning this token rather than leaving it stranded.
              updateStep(swapId, {
                status: "failed",
                detail: e?.error || "No route — burning instead",
              });
              try {
                const burnHash = await writeContractAsync({
                  address: token.address,
                  abi: ERC20_ABI,
                  functionName: "transfer",
                  args: [BURN_ADDRESS, amt],
                });
                await publicClient!.waitForTransactionReceipt({
                  hash: burnHash,
                });
                setProgressSteps((prev) => [
                  ...prev,
                  {
                    id: `${token.address}-burn-fallback`,
                    type: "burn",
                    label: `Burn ${token.symbol} (no liquidity)`,
                    status: "success",
                    detail: `Tx: ${burnHash.slice(0, 14)}…`,
                    txHash: burnHash,
                  },
                ]);
                burned += 1;
                // Record the fallback burn server-side so it shows up in
                // history alongside the user's other burns.
                api
                  .recordBurn({
                    chainId,
                    tokenAddress: token.address,
                    tokenSymbol: token.symbol,
                    tokenDecimals: token.decimals,
                    amount: amt.toString(),
                    mode: "burn",
                    txHash: burnHash,
                    recoveredNative: null,
                  })
                  .catch(() => undefined);
              } catch {
                failed += 1;
              }
              continue;
            }

            // 3) Send the swap transaction to the proxy Universal Router.
            try {
              const swapHash = await sendTransactionAsync({
                to: swapTx.to,
                data: swapTx.data,
                value: BigInt(swapTx.value || "0"),
              });
              await publicClient!.waitForTransactionReceipt({ hash: swapHash });
              updateStep(swapId, {
                status: "success",
                detail: `Tx: ${swapHash.slice(0, 14)}…`,
                txHash: swapHash,
              });
              recovered += 1;
              api
                .recordBurn({
                  chainId,
                  tokenAddress: token.address,
                  tokenSymbol: token.symbol,
                  tokenDecimals: token.decimals,
                  amount: amt.toString(),
                  mode: "recover",
                  txHash: swapHash,
                  recoveredNative: liveQuoteOut.toString(),
                })
                .catch(() => undefined);
            } catch (err: any) {
              updateStep(swapId, {
                status: "failed",
                detail: err?.shortMessage || err?.message || "Cancelled",
              });
              failed += 1;
            }
          } else if (wantsRecover && recoveryMode === "v2" && dex?.router) {
            // approve
            const approveId = `${token.address}-approve`;
            updateStep(approveId, { status: "active" });
            const allowance = (await publicClient!.readContract({
              address: token.address,
              abi: ERC20_APPROVE_ABI,
              functionName: "allowance",
              args: [address, dex.router],
            })) as bigint;
            if (allowance < amt) {
              const approveHash = await writeContractAsync({
                address: token.address,
                abi: ERC20_APPROVE_ABI,
                functionName: "approve",
                args: [dex.router, maxUint256],
              });
              await publicClient!.waitForTransactionReceipt({ hash: approveHash });
              updateStep(approveId, { status: "success", detail: `Tx: ${approveHash.slice(0, 14)}…`, txHash: approveHash });
            } else {
              updateStep(approveId, { status: "success", detail: "Already approved" });
            }

            // Re-quote against the live pool right before swapping. The
            // original quote is potentially minutes old by this point — on
            // mainnet that gap is wide enough for prices to move and for MEV
            // bots to exploit a stale `minOut`. We use the freshest possible
            // amount as the basis for slippage, and abort if the pool no
            // longer has liquidity.
            const swapId = `${token.address}-swap`;
            updateStep(swapId, { status: "active" });
            let liveQuote = 0n;
            try {
              const live = (await publicClient!.readContract({
                address: dex.router as `0x${string}`,
                abi: V2_ROUTER_ABI,
                functionName: "getAmountsOut",
                args: [amt, [token.address, dex.wrappedNative]],
              })) as bigint[];
              liveQuote = live[live.length - 1] ?? 0n;
            } catch {
              liveQuote = 0n;
            }
            if (liveQuote === 0n) {
              updateStep(swapId, {
                status: "failed",
                detail: "No live liquidity — falling back to burn",
              });
              // Fall through to burn this token instead of leaving it stranded.
              const burnHash = await writeContractAsync({
                address: token.address,
                abi: ERC20_ABI,
                functionName: "transfer",
                args: [BURN_ADDRESS, amt],
              });
              await publicClient!.waitForTransactionReceipt({
                hash: burnHash,
              });
              setProgressSteps((prev) => [
                ...prev,
                {
                  id: `${token.address}-burn-fallback`,
                  type: "burn",
                  label: `Burn ${token.symbol} (no liquidity)`,
                  status: "success",
                  detail: `Tx: ${burnHash.slice(0, 14)}…`,
                  txHash: burnHash,
                },
              ]);
              burned += 1;
              continue;
            }
            const slippageBps =
              SLIPPAGE_BPS[chainId] ?? DEFAULT_SLIPPAGE_BPS;
            const minOut = (liveQuote * (10000n - slippageBps)) / 10000n;
            const deadline = BigInt(
              Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS,
            );
            const swapHash = await writeContractAsync({
              address: dex.router,
              abi: V2_ROUTER_ABI,
              functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
              args: [amt, minOut, [token.address, dex.wrappedNative], address, deadline],
            });
            await publicClient!.waitForTransactionReceipt({ hash: swapHash });
            updateStep(swapId, {
              status: "success",
              detail: `Tx: ${swapHash.slice(0, 14)}…`,
              txHash: swapHash,
            });
            recovered += 1;
            api
              .recordBurn({
                chainId,
                tokenAddress: token.address,
                tokenSymbol: token.symbol,
                tokenDecimals: token.decimals,
                amount: amt.toString(),
                mode: "recover",
                txHash: swapHash,
                recoveredNative: quote.toString(),
              })
              .catch(() => undefined);
          } else {
            const burnId = `${token.address}-burn`;
            updateStep(burnId, { status: "active" });
            const hash = await writeContractAsync({
              address: token.address,
              abi: ERC20_ABI,
              functionName: "transfer",
              args: [BURN_ADDRESS, amt],
            });
            await publicClient!.waitForTransactionReceipt({ hash });
            updateStep(burnId, { status: "success", detail: `Tx: ${hash.slice(0, 14)}…`, txHash: hash });
            burned += 1;
            api
              .recordBurn({
                chainId,
                tokenAddress: token.address,
                tokenSymbol: token.symbol,
                tokenDecimals: token.decimals,
                amount: amt.toString(),
                mode: "burn",
                txHash: hash,
                recoveredNative: null,
              })
              .catch(() => undefined);
          }
        } catch (err: any) {
          console.error(`Failed for ${token.symbol}`, err);
          failed += 1;
          // Mark whichever step is currently active for this token as failed
          const detail = err.shortMessage || err.message || "Reverted";
          setProgressSteps((prev) =>
            prev.map((s) =>
              s.id.startsWith(token.address as string) && s.status === "active"
                ? { ...s, status: "failed", detail }
                : s
            )
          );
        }
      }

      setSelectedTokens(new Set());
      setSelectedSnapshots({});
      refetchNative();
      refetchTokens();
      if (isAuthenticated) {
        queryClient.invalidateQueries({ queryKey: ["burn-history"] });
      }

      toast({
        title: "Done",
        description: `${recovered} recovered · ${burned} burned · ${failed} failed`,
      });
    } finally {
      setProgressFinished(true);
      setIsProcessing(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="container mx-auto relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] py-12 px-4">
        <div className="max-w-md w-full mx-auto p-8 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl text-center space-y-6">
          <Wallet className="w-16 h-16 mx-auto text-primary/70" />
          <h2 className="text-2xl font-serif font-bold text-white text-halo-soft">Connect to Continue</h2>
          <p className="text-muted-foreground">
            Link a wallet to scan your bags for nads and step inside the furnace.
          </p>
        </div>
      </div>
    );
  }

  const scanning = autoScanning || isLoadingTokens || isFetchingTokens;
  const busy = isProcessing || isWritingContract || isSendingTx;

  return (
    <div className="container mx-auto relative z-10 py-12 px-4 flex flex-col items-center">
      <div className="w-full max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="halo-wrap font-serif text-4xl md:text-5xl font-bold text-white text-halo-soft">
            The <span className="text-primary text-halo">Incinerator</span>
          </h1>
          <p className="text-muted-foreground">
            <span className="text-white/80">
              {SUPPORTED_CHAIN_LABELS[chainId] ?? `Chain ${chainId}`}
            </span>{" "}
            <span className="font-mono text-white/40">· id {chainId}</span> ·
            scan your wallet, pick the nads, then burn them or recover what's
            worth saving.
          </p>
        </div>

        {/* Unsupported-chain banner. We block all on-chain actions until the
            user switches to a chain we have wiring for, otherwise things will
            silently misbehave (no DEX router, no explorer link, etc.). */}
        {!isSupportedChain && (
          <div className="p-4 rounded-xl bg-red-500/10 border-2 border-red-500/40 text-sm text-red-100 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-200">
                  Unsupported network
                </p>
                <p className="text-red-100/80 text-xs mt-1">
                  NadBurn only knows how to burn or recover on Ethereum and
                  Monad. Switch your wallet to one of those chains to continue.
                  If your wallet says Monad isn't activated, enable it in your
                  wallet's network settings first.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_CHAIN_IDS.map((id) => {
                const known = chains.find((c) => c.id === id);
                if (!known) return null;
                return (
                  <Button
                    key={id}
                    size="sm"
                    variant="secondary"
                    onClick={() => handleSwitchChain(id)}
                  >
                    Switch to {SUPPORTED_CHAIN_LABELS[id] ?? known.name}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Asset toggle: ERC-20 tokens vs NFTs. Switching to NFTs swaps in
            the dedicated NftBurner surface below (and hides the burn/recover
            mode toggle, since recovery doesn't apply to NFTs). */}
        <div className="flex p-1 rounded-xl bg-white/5 border border-white/10 max-w-sm mx-auto">
          <button
            onClick={() => setAssetMode("tokens")}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              assetMode === "tokens"
                ? "bg-primary text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]"
                : "text-muted-foreground hover:text-white"
            }`}
          >
            <Coins className="w-4 h-4" /> Tokens
          </button>
          <button
            onClick={() => setAssetMode("nfts")}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              assetMode === "nfts"
                ? "bg-primary text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]"
                : "text-muted-foreground hover:text-white"
            }`}
          >
            <ImageIcon className="w-4 h-4" /> NFTs
          </button>
        </div>

        {assetMode === "nfts" ? (
          <NftBurner chainId={chainId} isSupportedChain={isSupportedChain} />
        ) : (
          <>
        {/* Mode toggle */}
        <div className="flex p-1 rounded-xl bg-white/5 border border-white/10 max-w-sm mx-auto">
          <button
            onClick={() => setMode("burn")}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              mode === "burn"
                ? "bg-primary text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]"
                : "text-muted-foreground hover:text-white"
            }`}
          >
            <Flame className="w-4 h-4" /> Burn
          </button>
          <button
            onClick={() => setMode("recover")}
            disabled={!recoveryAvailable}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              mode === "recover"
                ? "bg-primary text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]"
                : "text-muted-foreground hover:text-white disabled:opacity-30 disabled:hover:text-muted-foreground"
            }`}
            title={recoveryAvailable ? "" : "No DEX router configured for this chain"}
          >
            <Coins className="w-4 h-4" /> Recover {nativeSymbol ?? "Native"}
          </button>
        </div>

        {mode === "recover" && !recoveryAvailable && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-200 text-center">
            Recovery isn't configured for this chain yet. Switch to a supported
            chain or burn directly.
          </div>
        )}

        {mode === "recover" && recoveryAvailable && apiKeyMissing && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-200 space-y-1">
            <div className="font-medium">
              Uniswap Trading API key not configured.
            </div>
            <div className="text-yellow-200/80">
              Recovery on {SUPPORTED_CHAIN_LABELS[chainId] ?? "this chain"}{" "}
              routes through Uniswap's Trading API. Set{" "}
              <code className="font-mono text-yellow-100">
                UNISWAP_TRADING_API_KEY
              </code>{" "}
              on the API server (request one at{" "}
              <a
                href="https://hub.uniswap.org"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-yellow-100"
              >
                hub.uniswap.org
              </a>
              ), or burn directly while you wait.
            </div>
          </div>
        )}

        {/* Action bar */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            onClick={() => void handleAutoDetect(false)}
            disabled={scanning}
            className="h-12 bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.35)]"
          >
            {scanning ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : (
              <Sparkles className="w-5 h-5 mr-2" />
            )}
            Auto-Detect Tokens
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              refetchNative();
              refetchTokens();
            }}
            disabled={scanning}
            className="h-12"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Discovery card */}
        <div className="p-6 rounded-2xl bg-card border border-white/10 shadow-xl space-y-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-bold text-white flex items-center gap-2">
              <FireParticles size={28} count={10} />
              The Nad Pile
            </h2>
            {discoveredTokens.length > 0 && (
              <button
                onClick={handleSelectAll}
                className="text-sm text-primary hover:text-primary/80 transition-colors"
              >
                {selectedTokens.size === discoveredTokens.length ? "Clear" : "Select all"}
              </button>
            )}
          </div>

          {scanning && discoveredTokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-primary gap-3">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm text-muted-foreground">Scanning your wallet…</p>
            </div>
          ) : discoveredTokens.length > 0 ? (
            <div className="space-y-2">
              <AnimatePresence>
                {discoveredTokens.map((token, idx) => {
                  const isSelected = selectedTokens.has(token.address);
                  const quote = quotes[token.address as string];
                  const showRecoverEstimate =
                    mode === "recover" && token.address !== "native" && recoveryAvailable;
                  return (
                    <motion.div
                      key={token.address}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.04 }}
                      className={`flex flex-col gap-3 p-4 rounded-xl bg-white/5 border transition-all ${
                        isSelected
                          ? "border-primary/60 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                          : "border-white/5 hover:border-primary/30"
                      }`}
                    >
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => toggleSelection(token.address)}
                      >
                        <div className="flex items-center gap-4">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelection(token.address)}
                          />
<div>
                            <p className="font-medium text-white">{token.symbol}</p>
                            <p className="text-xs text-muted-foreground">{token.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm text-white">
                            {Number(formatUnits(token.balance, token.decimals)).toLocaleString(undefined, {
                              maximumFractionDigits: 8,
                            })}{" "}
                            {token.symbol}
                          </p>
                          {showRecoverEstimate && isSelected && (
                            <p
                              className="text-xs text-primary mt-0.5"
                              title={quoteErrors[token.address as string]}
                            >
                              {quotingInFlight && quote === undefined
                                ? "quoting…"
                                : quote && quote > 0n
                                ? `≈ ${Number(formatUnits(quote, 18)).toLocaleString(undefined, {
                                    maximumFractionDigits: 6,
                                  })} ${nativeSymbol ?? "native"}`
                                : quoteErrors[token.address as string]
                                ? `${quoteErrors[token.address as string]} — will burn instead`
                                : "no Uniswap route → will burn"}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Per-token amount controls. Visible only when the
                          token is selected. The 4 chips set common fractions;
                          the input lets the user type any amount up to their
                          balance (extra decimals or > balance values are
                          silently capped). Same UX in burn and recover. */}
                      {isSelected && (
                        <div
                          className="flex flex-col gap-2 pt-3 border-t border-white/5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2">
                            {(
                              [
                                ["25%", 1n, 4n],
                                ["50%", 1n, 2n],
                                ["75%", 3n, 4n],
                                ["Max", 1n, 1n],
                              ] as const
                            ).map(([label, num, den]) => {
                              const chipAmt =
                                (token.balance * num) / den;
                              const currentAmt = amountFor(
                                token.address as string,
                                token.balance,
                              );
                              const isActive = chipAmt === currentAmt;
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() =>
                                    setAmountFraction(
                                      token.address as string,
                                      token.balance,
                                      num,
                                      den,
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                    isActive
                                      ? "bg-primary text-white"
                                      : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                                  }`}
                                >
                                  {label}
                                </button>
                              );
                            })}
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder={`Amount in ${token.symbol}`}
                              value={
                                tokenAmounts[token.address as string]
                                  ? formatUnits(
                                      amountFor(
                                        token.address as string,
                                        token.balance,
                                      ),
                                      token.decimals,
                                    )
                                  : ""
                              }
                              onChange={(e) =>
                                setAmountFromInput(
                                  token.address as string,
                                  token.decimals,
                                  token.balance,
                                  e.target.value,
                                )
                              }
                              className="flex-1 min-w-0 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-primary/60"
                            />
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-10 text-center space-y-3 opacity-80">
              <AlertCircle className="w-12 h-12 text-muted-foreground" />
              <p className="text-white font-medium">Your wallet looks clean.</p>
              {chainId === 143 ? (
                <p className="text-sm text-muted-foreground max-w-sm">
                  No ERC-20 dust found on Monad. Paste a token contract address below to add it manually.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Tap <span className="text-primary">Auto-Detect</span> to scan a wider list, or paste a token address below.
                </p>
              )}
            </div>
          )}

          <div className="pt-4 border-t border-white/10 space-y-3">
            <Label className="text-muted-foreground text-xs uppercase tracking-wider">
              Add Custom Token
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder="0x..."
                value={customTokenInput}
                onChange={(e) => setCustomTokenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomToken();
                  }
                }}
                className="bg-black/50 border-white/10 text-white font-mono"
              />
              <Button variant="secondary" onClick={handleAddCustomToken}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Action confirmation */}
        <div className="p-6 rounded-2xl bg-card border border-primary/20 shadow-[0_0_30px_rgba(168,85,247,0.12)] space-y-5 backdrop-blur-sm">
          <div className="text-center">
            <h2 className="text-xl font-serif font-bold text-white mb-2">
              {mode === "recover" ? `Recover ${nativeSymbol ?? "Native"}` : "Send to the Void"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "recover"
                ? "Tokens with a live pool are swapped to native and sent to your wallet. The rest are burned."
                : "Tokens are sent to the dead address."}
              <br />
              <span className="font-mono text-xs text-white/60">
                {BURN_ADDRESS.slice(0, 10)}…{BURN_ADDRESS.slice(-8)}
              </span>
            </p>
            {willChargeFee && (
              <p className="mt-3 text-xs text-yellow-200/90">
                Service fee:{" "}
                <span className="font-mono text-yellow-300">
                  {formatUnits(recoveryFeeWei, 18)} {nativeSymbol ?? "native"}
                </span>{" "}
                charged once per recovery batch.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
            <div className="p-4 rounded-xl bg-black/40 border border-white/5 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Selected</p>
              <p className="text-2xl font-bold text-white">{selectedTokens.size}</p>
            </div>
            <div className="p-4 rounded-xl bg-black/40 border border-white/5 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Est. Recovery
              </p>
              <p className="text-2xl font-bold text-primary">
                {mode === "recover"
                  ? Number(formatUnits(totalRecoveryEstimate, 18)).toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })
                  : "—"}
              </p>
            </div>
          </div>

          <Button
            className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.45)] hover:shadow-[0_0_35px_rgba(168,85,247,0.65)] transition-all"
            disabled={selectedTokens.size === 0 || busy}
            onClick={() => setConfirmOpen(true)}
          >
            {busy ? (
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
            ) : mode === "recover" ? (
              <Coins className="w-6 h-6 mr-2" />
            ) : (
              <span className="mr-2"><FireParticles size={28} count={10} /></span>
            )}
            {mode === "recover" ? `Recover ${nativeSymbol ?? "Native"}` : "Burn Selected"}
          </Button>
        </div>
          </>
        )}
      </div>

      {/* Token-flow dialogs only render in tokens mode. NftBurner owns its
          own confirm + progress UI when in NFTs mode, and we don't want
          the token state machinery (confirmTokens / progressSteps) to
          surface dialogs on top of it. */}
      {assetMode === "tokens" && (
        <>
          <ConfirmBurnDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            mode={mode}
            nativeSymbol={nativeSymbol ?? "native"}
            feeWei={recoveryFeeWei}
            willChargeFee={willChargeFee}
            tokens={confirmTokens}
            totalRecoveryEstimate={totalRecoveryEstimate}
            onConfirm={() => {
              setConfirmOpen(false);
              void handleAction();
            }}
          />

          <BurnProgress
            open={progressOpen}
            steps={progressSteps}
            finished={progressFinished}
            chainId={chainId}
            onClose={() => setProgressOpen(false)}
          />
        </>
      )}
    </div>
  );
}
