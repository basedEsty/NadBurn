import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useDiscordLink } from "@/hooks/useDiscordLink";
import { Loader2, LogOut } from "lucide-react";

/**
 * Compact Discord status pill for the desktop Navbar. Matches the chain +
 * wallet pill styling (`border-white/10 bg-white/5`).
 *
 *   - Wallet not connected           → hidden
 *   - Connected, no Discord linked   → "Link Discord" outline button
 *   - Connected + linked             → "@username" with dropdown to unlink
 *
 * On mobile the parent (`Navbar`) hides this component via CSS — but it stays
 * mounted so the `?discord=...` post-OAuth toast effect below still fires
 * exactly once per page load regardless of viewport. The mobile equivalent
 * controls live inside `ConnectWallet`'s wallet dropdown menu.
 */
export default function DiscordPill() {
  const { isConnected, status, busy, handleLink, handleUnlink, refreshStatus } =
    useDiscordLink();
  const { toast } = useToast();

  // Surface toast feedback when we come back from Discord OAuth, then strip
  // the `?discord=...` param so a refresh doesn't re-toast. This effect is
  // intentionally kept here (not in the shared hook) because it must run
  // only once per page load — DiscordPill is always mounted (just CSS-hidden
  // on mobile), so this is the safe single home for it.
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

    params.delete("discord");
    const cleaned = window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
    window.history.replaceState(null, "", cleaned);
    void refreshStatus();
  }, [toast, refreshStatus]);

  if (!isConnected) return null;

  if (status?.linked) {
    const username = status.discordUsername ?? status.discordUserId ?? "Discord";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/5 hover:bg-white/10"
          >
            <DiscordIcon className="mr-2 h-4 w-4 text-[#5865F2]" />
            @{username}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 bg-card border-white/10 text-white">
          <DropdownMenuItem
            onClick={handleUnlink}
            disabled={busy}
            className="text-destructive focus:bg-destructive/10 cursor-pointer"
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            Unlink Discord
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={handleLink}
      className="border-white/10 bg-white/5 hover:bg-white/10"
    >
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <DiscordIcon className="mr-2 h-4 w-4 text-[#5865F2]" />
      )}
      Link Discord
    </Button>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 00-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 00-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33a.06.06 0 00-.03.02C1.01 9.36.27 13.27.64 17.13a.07.07 0 00.03.05c1.81 1.33 3.55 2.13 5.27 2.66a.07.07 0 00.07-.02 11 11 0 00.94-1.53.07.07 0 00-.04-.1c-.5-.19-.99-.42-1.45-.68-.05-.03-.05-.1-.01-.13.1-.07.2-.15.29-.22a.07.07 0 01.07-.01c3.04 1.39 6.34 1.39 9.34 0a.07.07 0 01.07.01c.1.08.2.15.29.22.05.03.04.1-.01.13-.46.27-.94.49-1.45.68a.07.07 0 00-.04.1c.27.5.59 1.03.94 1.53a.07.07 0 00.07.02c1.73-.53 3.46-1.33 5.27-2.66a.07.07 0 00.03-.05c.45-4.46-.74-8.34-3.13-11.78a.06.06 0 00-.03-.02zM8.52 14.81c-1.04 0-1.9-.95-1.9-2.12 0-1.18.84-2.13 1.9-2.13 1.07 0 1.92.96 1.9 2.13 0 1.17-.85 2.12-1.9 2.12zm7.03 0c-1.04 0-1.9-.95-1.9-2.12 0-1.18.84-2.13 1.9-2.13 1.07 0 1.92.96 1.9 2.13 0 1.17-.84 2.12-1.9 2.12z" />
    </svg>
  );
}
