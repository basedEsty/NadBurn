import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { api, type BurnHistoryItem } from "@/lib/api";
import { ExternalLink, History, Coins, Flame, Image as ImageIcon } from "lucide-react";
import { formatUnits } from "viem";

const EXPLORERS: Record<number, string> = {
  10143: "https://testnet.monadexplorer.com/tx/",
  1: "https://etherscan.io/tx/",
};

function formatAmount(amount: string, decimals: number) {
  try {
    const n = Number(formatUnits(BigInt(amount), decimals));
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } catch {
    return amount;
  }
}

function HistoryRow({ item }: { item: BurnHistoryItem }) {
  const explorer = EXPLORERS[item.chainId];
  const date = new Date(item.createdAt);
  const isRecover = item.mode === "recover";
  // Treat any non-erc20 (or missing) tokenType as fungible for safety. Only
  // burn rows that explicitly record erc721/erc1155 render as NFT cards —
  // legacy rows from before the migration default to "erc20".
  const isNft = item.tokenType === "erc721" || item.tokenType === "erc1155";
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/5 hover:border-white/10 transition">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            isNft
              ? "bg-fuchsia-500/15 text-fuchsia-300"
              : isRecover
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-primary/15 text-primary"
          }`}
        >
          {isNft ? (
            <ImageIcon className="w-4 h-4" />
          ) : isRecover ? (
            <Coins className="w-4 h-4" />
          ) : (
            <Flame className="w-4 h-4" />
          )}
        </div>
        <div className="min-w-0">
          {isNft ? (
            <div className="text-sm text-white truncate">
              Burned{" "}
              <span className="font-medium">
                {item.collectionName || item.tokenSymbol}
              </span>{" "}
              {item.tokenId && (
                <span className="font-mono text-white/80">#{item.tokenId}</span>
              )}{" "}
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/70 align-middle">
                {item.tokenType === "erc1155" ? "ERC-1155" : "ERC-721"}
              </span>
              {item.tokenType === "erc1155" && item.amount && item.amount !== "1" && (
                <span className="ml-1 font-mono text-xs text-white/60">
                  ×{item.amount}
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm text-white truncate">
              {isRecover ? "Recovered" : "Burned"}{" "}
              <span className="font-mono">
                {formatAmount(item.amount, item.tokenDecimals)} {item.tokenSymbol}
              </span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {date.toLocaleString()} · chain {item.chainId}
          </div>
        </div>
      </div>
      {explorer && (
        <a
          href={`${explorer}${item.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 shrink-0"
        >
          tx <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

export default function HistoryPanel() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();

  const {
    data: items,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["burn-history"],
    queryFn: api.listBurnHistory,
    enabled: isAuthenticated,
  });

  return (
    <div className="p-6 rounded-2xl bg-card border border-white/10 shadow-xl space-y-4 backdrop-blur-sm">
      <h2 className="text-xl font-serif font-bold text-white flex items-center gap-2">
        <History className="w-5 h-5 text-primary" />
        Your History
      </h2>

      {!isAuthenticated && !authLoading && (
        <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground text-center space-y-3">
          <p>Sign in to keep a record of every burn and recovery across devices.</p>
          <button
            onClick={login}
            className="text-primary hover:text-primary/80 font-medium"
          >
            Sign in →
          </button>
        </div>
      )}

      {isAuthenticated && isLoading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}

      {isAuthenticated && isError && (
        <div className="text-sm text-red-300">Couldn't load history.</div>
      )}

      {isAuthenticated && items && items.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No burns yet. Your activity will appear here once you torch some nads.
        </div>
      )}

      {isAuthenticated && items && items.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {items.map((it) => (
            <HistoryRow key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
