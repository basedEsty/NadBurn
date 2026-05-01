import { useState, useEffect } from "react";
import { formatUnits } from "viem";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Flame, Coins, Skull } from "lucide-react";
import { TokenLogo } from "@/components/TokenMark";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

export interface ConfirmTokenLine {
  address: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  willRecover: boolean;
  quote?: bigint;
}

export interface ConfirmBurnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "burn" | "recover";
  nativeSymbol: string;
  /** Active chain ID — used to look up the right per-chain token logo. */
  chainId: number;
  feeWei: bigint;
  willChargeFee: boolean;
  tokens: ConfirmTokenLine[];
  totalRecoveryEstimate: bigint;
  onConfirm: () => void;
}

const CONFIRM_PHRASE = "BURN";

function fmt(value: bigint, decimals: number, max = 6) {
  try {
    return Number(formatUnits(value, decimals)).toLocaleString(undefined, {
      maximumFractionDigits: max,
    });
  } catch {
    return value.toString();
  }
}

export function ConfirmBurnDialog({
  open,
  onOpenChange,
  mode,
  nativeSymbol,
  chainId,
  feeWei,
  willChargeFee,
  tokens,
  totalRecoveryEstimate,
  onConfirm,
}: ConfirmBurnDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const burnCount = tokens.filter((t) => !t.willRecover).length;
  const recoverCount = tokens.filter((t) => t.willRecover).length;
  const isRecover = mode === "recover" && recoverCount > 0;
  const matches = typed.trim().toUpperCase() === CONFIRM_PHRASE;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card border-white/10 text-white max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-2xl flex items-center gap-2 text-white">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
            Confirm — this is irreversible
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            Once a transaction is broadcast, the tokens leave your wallet for good. Review the
            details below carefully.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 my-2">
          {/* Big, hard-to-miss danger banner. Different copy for burn vs.
              recover so the user knows exactly what's about to happen. */}
          <div className="rounded-lg border-2 border-red-500/50 bg-red-500/10 p-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
            <div className="text-sm text-red-100/95 space-y-1">
              <div className="font-semibold text-red-200">
                {isRecover
                  ? "You're about to swap and burn tokens"
                  : "You're about to burn tokens forever"}
              </div>
              <div className="text-red-100/80 text-xs leading-relaxed">
                {isRecover
                  ? "Tokens with live liquidity will be swapped for native and the rest will be sent to the dead address. Neither action can be undone — double-check the list below before confirming."
                  : "Selected tokens will be sent to the dead address and can never be recovered, refunded, or reversed by anyone. Make sure you actually want to destroy them."}
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

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Burn
              </div>
              <div className="mt-1 text-2xl font-bold text-white flex items-center justify-center gap-2">
                <Flame className="w-5 h-5 text-primary" />
                {burnCount}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Recover
              </div>
              <div className="mt-1 text-2xl font-bold text-white flex items-center justify-center gap-2">
                <Coins className="w-5 h-5 text-emerald-300" />
                {recoverCount}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 max-h-48 overflow-y-auto divide-y divide-white/5">
            {tokens.map((t) => (
              <div
                key={t.address}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {t.willRecover ? (
                    <Coins className="w-4 h-4 text-emerald-300 shrink-0" />
                  ) : (
                    <Flame className="w-4 h-4 text-primary shrink-0" />
                  )}
                  <TokenLogo
                    chainId={chainId}
                    address={t.address}
                    symbol={t.symbol}
                    size={20}
                    className="shrink-0"
                  />
                  <span className="text-white truncate">{t.symbol}</span>
                </div>
                <div className="text-right font-mono text-xs">
                  <div className="text-white/90">
                    {fmt(t.balance, t.decimals)} {t.symbol}
                  </div>
                  {t.willRecover && t.quote && t.quote > 0n && (
                    <div className="text-emerald-300">
                      → ≈ {fmt(t.quote, 18)} {nativeSymbol}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {isRecover && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200 flex items-center justify-between">
              <span>Estimated recovery</span>
              <span className="font-mono font-semibold">
                ≈ {fmt(totalRecoveryEstimate, 18)} {nativeSymbol}
              </span>
            </div>
          )}

          {willChargeFee && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200 flex items-center justify-between">
              <span>One-time service fee</span>
              <span className="font-mono font-semibold">
                {fmt(feeWei, 18)} {nativeSymbol}
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">
              Type{" "}
              <span className="font-mono text-amber-300">{CONFIRM_PHRASE}</span> to confirm
            </Label>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
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
            disabled={!matches || tokens.length === 0}
            onClick={onConfirm}
            className="bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.45)] disabled:opacity-40 disabled:shadow-none"
          >
            {isRecover ? "Recover & Burn" : "Burn forever"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
