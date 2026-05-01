import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Skull,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { BurnProgress, type ProgressStep } from "@/components/BurnProgress";
import { FireParticles } from "@/components/FireParticles";
import { BURN_ADDRESS } from "@/lib/constants";
import { api } from "@/lib/api";
import {
  ERC1155_BURN_ABI,
  ERC721_BURN_ABI,
  fetchWalletNfts,
  nftKey,
  nftLabel,
  type NftItem,
} from "@/lib/nfts";

interface NftBurnerProps {
  chainId: number;
  isSupportedChain: boolean;
}

const CONFIRM_PHRASE = "BURN";

// Tile size for the gallery grid. Kept fixed so very-tall portrait images
// don't shove later rows around as they decode.
const TILE_PX = 132;

/**
 * Self-contained NFT discovery + burn surface. Lives alongside the existing
 * ERC-20 token panel inside BurnerApp; toggling assetMode in the parent
 * mounts/unmounts this. We keep all NFT-specific state local so the legacy
 * token flow's reducers / effects stay untouched.
 */
export function NftBurner({ chainId, isSupportedChain }: NftBurnerProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { writeContractAsync, isPending: isWritingContract } = useWriteContract();

  const [nfts, setNfts] = useState<NftItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [missingKey, setMissingKey] = useState(false);
  // Composite contractAddress:tokenId keys, so two NFTs from the same
  // collection are independently selectable.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Snapshots taken at selection time. Same reasoning as the token list:
  // the live list refetches and we don't want a momentary indexer gap to
  // delete a user's selection.
  const [snapshots, setSnapshots] = useState<Record<string, NftItem>>({});
  // Per-image render failure flags — when an image errors out we drop to
  // the deterministic fallback so the grid doesn't show broken-image icons.
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressSteps, setProgressSteps] = useState<ProgressStep[]>([]);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressFinished, setProgressFinished] = useState(false);

  // ─── Discovery ─────────────────────────────────────────────────────
  // Monotonic scan token. Each handleScan() bumps it; when a response
  // resolves we only apply state if we're still the latest invocation.
  // Prevents a slow chain-A response from clobbering chain-B's grid after
  // a wallet/network switch (or a rapid double-tap of Refresh).
  const scanIdRef = useRef(0);
  const lastScanContextRef = useRef<{ chainId: number; address: string } | null>(null);

  const handleScan = useCallback(
    async (silent = false) => {
      if (!address) return;
      const myScanId = ++scanIdRef.current;
      const myContext = { chainId, address: address.toLowerCase() };
      lastScanContextRef.current = myContext;
      setScanning(true);
      try {
        const result = await fetchWalletNfts(chainId, address);
        // Drop the response if a newer scan started, or if the wallet/chain
        // moved out from under us mid-flight.
        if (
          scanIdRef.current !== myScanId ||
          lastScanContextRef.current?.chainId !== myContext.chainId ||
          lastScanContextRef.current?.address !== myContext.address
        ) {
          return;
        }
        setMissingKey(!!result.missingKey);
        setNfts(result.nfts);
        if (!silent) {
          if (result.missingKey) {
            toast({
              title: "Monad NFT auto-detect not configured",
              description:
                "Add a Blockvision API key on the server to enable NFT discovery on Monad.",
            });
          } else if (result.nfts.length === 0) {
            toast({
              title: "No NFTs found",
              description: "We didn't find any ERC-721 or ERC-1155 tokens in your wallet on this chain.",
            });
          } else {
            toast({
              title: `Found ${result.nfts.length} NFT${result.nfts.length === 1 ? "" : "s"}`,
              description: "Select the ones you want to burn forever.",
            });
          }
        }
      } finally {
        // Only clear the spinner if we're still the most recent scan;
        // otherwise an older request resolving last would prematurely hide
        // the spinner for a still-pending newer scan.
        if (scanIdRef.current === myScanId) setScanning(false);
      }
    },
    [address, chainId, toast],
  );

  // Auto-scan whenever the wallet/chain changes. Silent so we don't spam
  // toasts on every chain switch.
  useEffect(() => {
    if (!isConnected || !address || !isSupportedChain) {
      // Invalidate any in-flight scan so a slow response from the previous
      // chain/wallet can't commit to the now-cleared grid. Bumping the
      // ref here mirrors what handleScan does on its own start.
      scanIdRef.current++;
      lastScanContextRef.current = null;
      setScanning(false);
      setNfts([]);
      setSelected(new Set());
      setSnapshots({});
      setMissingKey(false);
      return;
    }
    void handleScan(true);
  }, [isConnected, address, chainId, isSupportedChain, handleScan]);

  // Reset selection on wallet/chain change so a selection on chain A can't
  // accidentally drive a transferFrom on chain B's contract.
  useEffect(() => {
    setSelected(new Set());
    setSnapshots({});
    setConfirmOpen(false);
    setBrokenImages(new Set());
  }, [chainId, address, isConnected]);

  const toggleSelection = useCallback((nft: NftItem) => {
    const key = nftKey(nft);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSnapshots((prev) => {
      if (key in prev) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: nft };
    });
  }, []);

  const handleSelectAll = () => {
    if (selected.size === nfts.length) {
      setSelected(new Set());
      setSnapshots({});
    } else {
      setSelected(new Set(nfts.map(nftKey)));
      setSnapshots(Object.fromEntries(nfts.map((n) => [nftKey(n), n])));
    }
  };

  // The freshest snapshot is preferred; falling back to the live list
  // covers the case where the user just selected something and the
  // snapshot map hasn't caught up.
  const burnList = useMemo<NftItem[]>(
    () =>
      Array.from(selected)
        .map((k) => snapshots[k] ?? nfts.find((n) => nftKey(n) === k))
        .filter((n): n is NftItem => !!n),
    [selected, snapshots, nfts],
  );

  // ─── Burn execution ────────────────────────────────────────────────
  const updateStep = useCallback(
    (id: string, patch: Partial<ProgressStep>) => {
      setProgressSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  const handleBurn = useCallback(async () => {
    if (!address || !publicClient || burnList.length === 0) return;

    const steps: ProgressStep[] = burnList.map((n) => ({
      id: `nft-${nftKey(n)}`,
      type: "burn",
      label: `Burn ${nftLabel(n)}`,
      status: "pending",
      detail:
        n.type === "erc1155" && n.balance !== "1"
          ? `${n.type.toUpperCase()} · ×${n.balance}`
          : n.type.toUpperCase(),
    }));
    setProgressSteps(steps);
    setProgressOpen(true);
    setProgressFinished(false);
    setIsProcessing(true);

    let burned = 0;
    let failed = 0;

    try {
      for (const nft of burnList) {
        const stepId = `nft-${nftKey(nft)}`;
        updateStep(stepId, { status: "active" });
        try {
          // Both standards burn via safeTransferFrom to the dead address —
          // wallets / explorers count this as a burn, and we don't need an
          // extra approval per item because we're the owner sending it
          // directly.
          let hash: `0x${string}`;
          if (nft.type === "erc721") {
            hash = await writeContractAsync({
              address: nft.contractAddress,
              abi: ERC721_BURN_ABI,
              functionName: "safeTransferFrom",
              args: [
                address as `0x${string}`,
                BURN_ADDRESS,
                BigInt(nft.tokenId),
              ],
            });
          } else {
            // ERC-1155 burns the full owned balance for this token id.
            // We deliberately do NOT coerce a missing/zero/malformed
            // balance to 1 — that would silently invent an amount the
            // user didn't see in the dialog, and ERC-1155 transfers of
            // an arbitrary "1" can mean very different value across
            // collections. Fail this NFT explicitly instead.
            let amount: bigint;
            try {
              amount = BigInt(nft.balance);
            } catch {
              throw new Error(
                "Indexer returned an invalid balance for this token; refresh and retry.",
              );
            }
            if (amount <= 0n) {
              throw new Error(
                "Owned balance is 0 — wallet may have already moved this token.",
              );
            }
            hash = await writeContractAsync({
              address: nft.contractAddress,
              abi: ERC1155_BURN_ABI,
              functionName: "safeTransferFrom",
              args: [
                address as `0x${string}`,
                BURN_ADDRESS,
                BigInt(nft.tokenId),
                amount,
                "0x",
              ],
            });
          }
          // Wait between txs — same wallet-nonce / gas-estimation reason as
          // the ERC-20 burn loop. Sequential signing is also a more
          // predictable UX than ten popups all at once.
          await publicClient.waitForTransactionReceipt({ hash });
          updateStep(stepId, {
            status: "success",
            detail: `Tx: ${hash.slice(0, 14)}…`,
            txHash: hash,
          });
          burned += 1;

          // Persist to history. Decimals = 0 (NFTs don't have decimals);
          // amount = ERC-721 -> "1", ERC-1155 -> burned balance. Symbol is
          // best-effort: collection name first, falling back to a short
          // contract address slice.
          const histAmount =
            nft.type === "erc1155" ? nft.balance || "1" : "1";
          const fallbackSymbol = `${nft.contractAddress.slice(0, 6)}…${nft.contractAddress.slice(-4)}`;
          api
            .recordBurn({
              chainId,
              tokenAddress: nft.contractAddress,
              tokenSymbol: (nft.collectionName || nft.name || fallbackSymbol).slice(0, 64),
              tokenDecimals: 0,
              amount: histAmount,
              mode: "burn",
              txHash: hash,
              recoveredNative: null,
              tokenType: nft.type,
              tokenId: nft.tokenId,
              collectionName: nft.collectionName,
            })
            .catch(() => undefined);
        } catch (err: any) {
          failed += 1;
          const detail =
            err?.shortMessage || err?.message || "Reverted";
          updateStep(stepId, { status: "failed", detail });
        }
      }
    } finally {
      setProgressFinished(true);
      setIsProcessing(false);
      setSelected(new Set());
      setSnapshots({});
      // Re-scan in the background so the burned items disappear from the
      // grid — Blockvision typically needs a few seconds to catch up, so
      // this won't be instant on Monad mainnet.
      void handleScan(true);
      if (isAuthenticated) {
        queryClient.invalidateQueries({ queryKey: ["burn-history"] });
      }
      toast({
        title: "Done",
        description: `${burned} burned · ${failed} failed`,
      });
    }
  }, [
    address,
    publicClient,
    burnList,
    chainId,
    writeContractAsync,
    updateStep,
    handleScan,
    isAuthenticated,
    queryClient,
    toast,
  ]);

  // ─── Render helpers ────────────────────────────────────────────────
  // Reset typed phrase whenever the dialog opens/closes.
  useEffect(() => {
    if (!confirmOpen) setTypedPhrase("");
  }, [confirmOpen]);

  const phraseMatches = typedPhrase.trim().toUpperCase() === CONFIRM_PHRASE;
  const canBurn =
    selected.size > 0 && !isProcessing && !isWritingContract && isSupportedChain;

  return (
    <>
      {/* Action bar */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button
          onClick={() => void handleScan(false)}
          disabled={scanning || !isSupportedChain}
          className="h-12 bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.35)]"
        >
          {scanning ? (
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
          ) : (
            <Sparkles className="w-5 h-5 mr-2" />
          )}
          Auto-Detect NFTs
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleScan(true)}
          disabled={scanning || !isSupportedChain}
          className="h-12"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {missingKey && (
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-200 space-y-1">
          <div className="font-medium">Monad NFT auto-detect not configured.</div>
          <div className="text-yellow-200/80">
            Set <code className="font-mono text-yellow-100">BLOCKVISION_API_KEY</code>{" "}
            on the API server to enable NFT discovery on Monad mainnet.
          </div>
        </div>
      )}

      {/* Discovery card */}
      <div className="p-6 rounded-2xl bg-card border border-white/10 shadow-xl space-y-5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-serif font-bold text-white flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-primary" />
            Your NFT Collection
          </h2>
          {nfts.length > 0 && (
            <button
              onClick={handleSelectAll}
              className="text-sm text-primary hover:text-primary/80 transition-colors"
            >
              {selected.size === nfts.length ? "Clear" : "Select all"}
            </button>
          )}
        </div>

        {scanning && nfts.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-primary gap-3">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm text-muted-foreground">Scanning your wallet…</p>
          </div>
        ) : nfts.length > 0 ? (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_PX}px, 1fr))`,
            }}
          >
            <AnimatePresence>
              {nfts.map((nft, idx) => {
                const key = nftKey(nft);
                const isSelected = selected.has(key);
                const broken = brokenImages.has(key);
                return (
                  <motion.button
                    key={key}
                    type="button"
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                    onClick={() => toggleSelection(nft)}
                    className={`group relative text-left rounded-xl overflow-hidden border transition-all bg-black/40 ${
                      isSelected
                        ? "border-primary/70 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                        : "border-white/5 hover:border-primary/30"
                    }`}
                  >
                    <div className="relative aspect-square bg-gradient-to-br from-primary/10 to-black/40 overflow-hidden">
                      {nft.imageUrl && !broken ? (
                        <img
                          src={nft.imageUrl}
                          alt={nftLabel(nft)}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setBrokenImages((prev) => {
                              if (prev.has(key)) return prev;
                              const next = new Set(prev);
                              next.add(key);
                              return next;
                            })
                          }
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <NftFallbackTile
                          collection={nft.collectionName || nft.name || "NFT"}
                          tokenId={nft.tokenId}
                        />
                      )}
                      {nft.type === "erc1155" && nft.balance !== "1" && (
                        <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/70 text-white/90 border border-white/10">
                          ×{nft.balance}
                        </span>
                      )}
                      <span
                        className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center transition ${
                          isSelected
                            ? "bg-primary text-white shadow-[0_0_12px_rgba(168,85,247,0.6)]"
                            : "bg-black/60 border border-white/20 text-transparent group-hover:text-white/40"
                        }`}
                      >
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </span>
                    </div>
                    <div className="p-2 space-y-0.5">
                      <p className="text-xs font-medium text-white truncate">
                        {nft.collectionName || nft.name || "Unknown collection"}
                      </p>
                      <p className="text-[11px] font-mono text-muted-foreground truncate">
                        #{nft.tokenId}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-10 text-center space-y-3 opacity-80">
            <AlertCircle className="w-12 h-12 text-muted-foreground" />
            <p className="text-white font-medium">No NFTs detected.</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {missingKey
                ? "Configure Blockvision to scan Monad mainnet, or switch chains."
                : "Tap Refresh once your wallet has finished syncing, or switch to a chain where you hold NFTs."}
            </p>
          </div>
        )}
      </div>

      {/* Action confirmation */}
      <div className="p-6 rounded-2xl bg-card border border-primary/20 shadow-[0_0_30px_rgba(168,85,247,0.12)] space-y-5 backdrop-blur-sm">
        <div className="text-center">
          <h2 className="text-xl font-serif font-bold text-white mb-2">
            Send NFTs to the Void
          </h2>
          <p className="text-sm text-muted-foreground">
            Each selected NFT is sent to the dead address with{" "}
            <span className="font-mono text-white/70">safeTransferFrom</span>.
            <br />
            <span className="font-mono text-xs text-white/60">
              {BURN_ADDRESS.slice(0, 10)}…{BURN_ADDRESS.slice(-8)}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
          <div className="p-4 rounded-xl bg-black/40 border border-white/5 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Selected</p>
            <p className="text-2xl font-bold text-white">{selected.size}</p>
          </div>
          <div className="p-4 rounded-xl bg-black/40 border border-white/5 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Signatures
            </p>
            <p className="text-2xl font-bold text-primary">{selected.size}</p>
          </div>
        </div>

        <Button
          className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.45)] hover:shadow-[0_0_35px_rgba(168,85,247,0.65)] transition-all"
          disabled={!canBurn}
          onClick={() => setConfirmOpen(true)}
        >
          {isProcessing || isWritingContract ? (
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
          ) : (
            <span className="mr-2">
              <FireParticles size={28} count={10} />
            </span>
          )}
          Burn Selected NFTs
        </Button>
      </div>

      {/* Confirm dialog (NFT-specific — different summary shape than the
          ERC-20 dialog so we don't try to format decimals/amounts that
          don't apply to NFTs). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="bg-card border-white/10 text-white max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-2xl flex items-center gap-2 text-white">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
              Confirm — this is irreversible
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Once a transaction is broadcast, the NFTs leave your wallet for
              good. Review the list below carefully.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 my-2">
            <div className="rounded-lg border-2 border-red-500/50 bg-red-500/10 p-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
              <div className="text-sm text-red-100/95 space-y-1">
                <div className="font-semibold text-red-200">
                  You're about to burn {burnList.length} NFT
                  {burnList.length === 1 ? "" : "s"} forever
                </div>
                <div className="text-red-100/80 text-xs leading-relaxed">
                  Each NFT is transferred to the dead address and can never be
                  recovered. There is no undo, no refund, and no marketplace
                  rescue.
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Skull className="w-4 h-4" />
                <span>Burn destination (verifiable on-chain):</span>
              </div>
              <code className="block text-xs font-mono text-amber-300 break-all">
                {BURN_ADDRESS}
              </code>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 max-h-48 overflow-y-auto divide-y divide-white/5">
              {burnList.map((nft) => (
                <div
                  key={nftKey(nft)}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ImageIcon className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-white truncate">
                      {nft.collectionName || nft.name || "NFT"} #{nft.tokenId}
                    </span>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <div className="text-white/80">
                      {nft.type === "erc1155" ? `ERC-1155 ×${nft.balance}` : "ERC-721"}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                Type{" "}
                <span className="font-mono text-amber-300">{CONFIRM_PHRASE}</span>{" "}
                to confirm
              </Label>
              <Input
                autoFocus
                value={typedPhrase}
                onChange={(e) => setTypedPhrase(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                className="bg-black/50 border-white/10 text-white font-mono uppercase"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10 text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!phraseMatches || burnList.length === 0}
              onClick={() => {
                setConfirmOpen(false);
                void handleBurn();
              }}
              className="bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.45)] disabled:opacity-40 disabled:shadow-none"
            >
              Burn forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BurnProgress
        open={progressOpen}
        steps={progressSteps}
        finished={progressFinished}
        chainId={chainId}
        onClose={() => setProgressOpen(false)}
      />
    </>
  );
}

// Deterministic neutral fallback tile — initials over a dark gradient.
// We use the first two glyphs of the collection name, falling back to "??"
// when the indexer didn't surface a name. Keeps the grid visually
// consistent even when image URLs are missing or 404.
function NftFallbackTile({
  collection,
  tokenId,
}: {
  collection: string;
  tokenId: string;
}) {
  const initials = collection
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "??";
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center p-2">
      <span className="font-serif text-2xl text-primary/80 drop-shadow-[0_0_8px_rgba(168,85,247,0.4)]">
        {initials}
      </span>
      <span className="text-[10px] font-mono text-white/40 mt-1 truncate max-w-full">
        #{tokenId}
      </span>
    </div>
  );
}
