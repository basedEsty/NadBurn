import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useWalletAuth } from "@/hooks/useWalletAuth";
import { apiUrl } from "@/lib/api-base";
import { Loader2, Check, X } from "lucide-react";

interface DiscordStatus {
  linked: boolean;
  signedIn: boolean;
  discordUserId?: string;
  discordUsername?: string;
  linkedAt?: string;
}

/**
 * Integrated Discord linking — appears below the header when the wallet is
 * connected. Single click handles the entire flow:
 *   1. If not yet SIWE-authed → silent sign popup
 *   2. Redirect to Discord OAuth
 *   3. On return, status auto-refreshes to show "Connected as @username"
 *
 * Reads `?discord=...` query params on mount to surface success/failure
 * toasts after the OAuth redirect lands back here.
 */
export function DiscordLinkCard() {
  const { isConnected } = useAccount();
  const { isAuthenticated, signIn } = useWalletAuth();
  const { toast } = useToast();

  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [busy, setBusy] = useState(false);

  // Check link status whenever auth state changes
  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/auth/discord/status"), { credentials: "include" });
      const data = (await r.json()) as DiscordStatus;
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (isConnected) void refreshStatus();
  }, [isConnected, isAuthenticated, refreshStatus]);

  // Handle the redirect from Discord OAuth — show a toast + clean URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("discord");
    if (!result) return;

    const messages: Record<string, { title: string; variant?: "default" | "destructive" }> = {
      "linked":                  { title: "Discord linked" },
      "cancelled":               { title: "Linking cancelled", variant: "destructive" },
      "signin-required":         { title: "Sign in first", variant: "destructive" },
      "state-mismatch":          { title: "Security check failed — try again", variant: "destructive" },
      "missing-params":          { title: "Discord didn't send a code", variant: "destructive" },
      "token-exchange-failed":   { title: "Discord rejected the link", variant: "destructive" },
      "user-fetch-failed":       { title: "Couldn't read Discord profile", variant: "destructive" },
      "db-error":                { title: "Couldn't save link", variant: "destructive" },
      "not-configured":          { title: "Discord OAuth not configured", variant: "destructive" },
    };
    const m = messages[result];
    if (m) toast({ title: m.title, variant: m.variant });

    // Strip the param from the URL so refreshes don't re-toast
    params.delete("discord");
    const cleaned = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState(null, "", cleaned);
    void refreshStatus();
  }, [toast, refreshStatus]);

  const handleLink = useCallback(async () => {
    setBusy(true);
    try {
      // Make sure we have a SIWE session first — it's how the callback
      // knows which wallet to attach the Discord identity to.
      if (!isAuthenticated) {
        await signIn();
      }
      // Hard-redirect to the start endpoint, which 302s into Discord's
      // consent flow. The browser comes back to /api/auth/discord/callback,
      // which redirects us back to / with ?discord=linked.
      window.location.href = apiUrl("/api/auth/discord/start");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Link failed";
      toast({
        title: "Couldn't start Discord link",
        description: msg,
        variant: "destructive",
      });
      setBusy(false);
    }
  }, [isAuthenticated, signIn, toast]);

  const handleUnlink = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(apiUrl("/api/auth/discord/status"), {
        method: "DELETE",
        credentials: "include",
      });
      toast({ title: "Discord unlinked" });
      await refreshStatus();
    } catch {
      toast({ title: "Unlink failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [toast, refreshStatus]);

  if (!isConnected) return null;

  // Linked state — show username + unlink option
  if (status?.linked) {
    return (
      <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
        <Check className="w-4 h-4 text-emerald-400" />
        <span className="text-sm text-emerald-200">
          Discord: <strong>@{status.discordUsername ?? status.discordUserId}</strong>
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={handleUnlink}
          className="text-xs text-muted-foreground hover:text-white"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
        </Button>
      </div>
    );
  }

  // Not linked — show the link CTA
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
      <span className="text-sm text-muted-foreground">
        Link your Discord to track XP and unlock chess-piece roles
      </span>
      <Button
        size="sm"
        disabled={busy}
        onClick={handleLink}
        className="bg-[#5865F2] hover:bg-[#4752c4] text-white"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <DiscordIcon className="w-4 h-4 mr-2" />
        )}
        Link Discord
      </Button>
    </div>
  );
}

// Inline Discord brand mark — saves an icon dependency
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 00-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 00-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33a.06.06 0 00-.03.02C1.01 9.36.27 13.27.64 17.13a.07.07 0 00.03.05c1.81 1.33 3.55 2.13 5.27 2.66a.07.07 0 00.07-.02 11 11 0 00.94-1.53.07.07 0 00-.04-.1c-.5-.19-.99-.42-1.45-.68-.05-.03-.05-.1-.01-.13.1-.07.2-.15.29-.22a.07.07 0 01.07-.01c3.04 1.39 6.34 1.39 9.34 0a.07.07 0 01.07.01c.1.08.2.15.29.22.05.03.04.1-.01.13-.46.27-.94.49-1.45.68a.07.07 0 00-.04.1c.27.5.59 1.03.94 1.53a.07.07 0 00.07.02c1.73-.53 3.46-1.33 5.27-2.66a.07.07 0 00.03-.05c.45-4.46-.74-8.34-3.13-11.78a.06.06 0 00-.03-.02zM8.52 14.81c-1.04 0-1.9-.95-1.9-2.12 0-1.18.84-2.13 1.9-2.13 1.07 0 1.92.96 1.9 2.13 0 1.17-.85 2.12-1.9 2.12zm7.03 0c-1.04 0-1.9-.95-1.9-2.12 0-1.18.84-2.13 1.9-2.13 1.07 0 1.92.96 1.9 2.13 0 1.17-.84 2.12-1.9 2.12z" />
    </svg>
  );
}
