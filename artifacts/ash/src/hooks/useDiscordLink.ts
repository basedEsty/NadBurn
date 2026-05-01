import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useWalletAuth } from "@/hooks/useWalletAuth";
import { apiUrl } from "@/lib/api-base";

export interface DiscordStatus {
  linked: boolean;
  signedIn: boolean;
  discordUserId?: string;
  discordUsername?: string;
}

export const DISCORD_STATUS_QUERY_KEY_ROOT = "discord-status" as const;

/**
 * Shared Discord-link state + handlers used by both `DiscordPill` (the
 * dedicated desktop pill) and `ConnectWallet` (the mobile dropdown items).
 *
 * Status is fetched through React Query so both consumers share the same
 * cache: linking or unlinking from one location automatically updates the
 * other without prop drilling or context.
 *
 * The query key is scoped by the current wallet `address` and wallet-auth
 * `isAuthenticated` flag so that changing wallet or signing in/out triggers
 * a refetch instead of showing stale Discord status from a previous session.
 */
export function useDiscordLink() {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, signIn } = useWalletAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [busy, setBusy] = useState(false);

  const queryKey = [
    DISCORD_STATUS_QUERY_KEY_ROOT,
    address ?? null,
    isAuthenticated,
  ] as const;

  const {
    data: status = null,
    refetch,
  } = useQuery<DiscordStatus | null>({
    queryKey,
    queryFn: async () => {
      const r = await fetch(apiUrl("/api/auth/discord/status"), {
        credentials: "include",
      });
      if (!r.ok) return null;
      return (await r.json()) as DiscordStatus;
    },
    enabled: isConnected,
    staleTime: 30_000,
  });

  const refreshStatus = useCallback(async () => {
    // Invalidate every Discord-status query (across all wallet/auth scopes)
    // so all mounted consumers re-sync after a link/unlink action.
    await queryClient.invalidateQueries({
      queryKey: [DISCORD_STATUS_QUERY_KEY_ROOT],
    });
    await refetch();
  }, [queryClient, refetch]);

  const handleLink = useCallback(async () => {
    setBusy(true);
    try {
      if (!isAuthenticated) await signIn();
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

  return {
    isConnected,
    status,
    busy,
    handleLink,
    handleUnlink,
    refreshStatus,
  };
}
