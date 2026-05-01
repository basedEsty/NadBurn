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
import { DiscordIcon } from "./icons/DiscordIcon";
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

