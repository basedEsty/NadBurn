import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, Loader2, Check } from "lucide-react";
import { useWalletAuth, type AuthedUser } from "@/hooks/useWalletAuth";
import { useToast } from "@/hooks/use-toast";

/**
 * Sign-In with Ethereum button.
 *
 * - When wallet is connected and NOT signed in → "Sign in" CTA
 * - When already signed in → shows shortened address + sign-out option
 * - Gasless flow — just a wallet popup to sign a plain text message
 */
export function SignInButton({
  className,
  onSignedIn,
}: {
  className?: string;
  onSignedIn?: (user: AuthedUser) => void;
}) {
  const { user, isAuthenticated, isLoading, signIn, signOut } = useWalletAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleSignIn = useCallback(async () => {
    setBusy(true);
    try {
      const u = await signIn();
      toast({
        title: "Signed in",
        description: u.nadName ?? `${u.walletAddress.slice(0, 6)}…${u.walletAddress.slice(-4)}`,
      });
      onSignedIn?.(u);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      toast({
        title: "Sign-in failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [signIn, toast, onSignedIn]);

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    await signOut();
    toast({ title: "Signed out" });
    setBusy(false);
  }, [signOut, toast]);

  if (isLoading) {
    return (
      <Button variant="ghost" disabled className={className}>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Loading…
      </Button>
    );
  }

  if (isAuthenticated && user) {
    const label = user.nadName ?? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`;
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
          <Check className="w-3 h-3" />
          {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={handleSignOut}
          title="Sign out"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="default"
      disabled={busy}
      onClick={handleSignIn}
      className={className}
    >
      {busy ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <LogIn className="w-4 h-4 mr-2" />
      )}
      Sign in with wallet
    </Button>
  );
}
