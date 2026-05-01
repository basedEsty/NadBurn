import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDiscordLink } from "@/hooks/useDiscordLink";
import { Wallet, LogOut, Globe, Loader2 } from "lucide-react";

export default function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { chains, switchChain } = useSwitchChain();
  const {
    status: discordStatus,
    busy: discordBusy,
    handleLink: handleLinkDiscord,
    handleUnlink: handleUnlinkDiscord,
  } = useDiscordLink();

  const currentChain = chains.find((c) => c.id === chainId);
  const discordUsername =
    discordStatus?.discordUsername ?? discordStatus?.discordUserId ?? "Discord";

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="border-white/10 bg-white/5 hover:bg-white/10">
              <Globe className="mr-2 h-4 w-4 text-primary" />
              {currentChain?.name ?? "Unknown Chain"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-card border-white/10 text-white">
            {chains.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => switchChain({ chainId: c.id })}
                className="cursor-pointer focus:bg-white/10"
              >
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="border-white/10 bg-white/5 hover:bg-white/10 font-mono">
              <Wallet className="mr-2 h-4 w-4 text-muted-foreground" />
              {address.slice(0, 6)}...{address.slice(-4)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-card border-white/10 text-white">
            {/*
              Mobile-only Discord controls. On desktop these are hidden
              because the dedicated `<DiscordPill />` in the navbar covers
              the same actions. Keeping them inside the wallet dropdown
              de-clutters the mobile header to a single pill.
            */}
            {discordStatus?.linked ? (
              <>
                <DropdownMenuLabel className="sm:hidden flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  <DiscordIcon className="h-3 w-3 text-[#5865F2]" />
                  <span className="truncate">@{discordUsername}</span>
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={handleUnlinkDiscord}
                  disabled={discordBusy}
                  className="sm:hidden cursor-pointer text-destructive focus:bg-destructive/10"
                >
                  {discordBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  Unlink Discord
                </DropdownMenuItem>
                <DropdownMenuSeparator className="sm:hidden bg-white/10" />
              </>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={handleLinkDiscord}
                  disabled={discordBusy}
                  className="sm:hidden cursor-pointer focus:bg-white/10"
                >
                  {discordBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <DiscordIcon className="mr-2 h-4 w-4 text-[#5865F2]" />
                  )}
                  Link Discord
                </DropdownMenuItem>
                <DropdownMenuSeparator className="sm:hidden bg-white/10" />
              </>
            )}

            <DropdownMenuItem
              onClick={() => disconnect()}
              className="text-destructive focus:bg-destructive/10 cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_rgba(255,69,0,0.5)] transition-all hover:shadow-[0_0_25px_rgba(255,69,0,0.7)]">
          <Wallet className="mr-2 h-4 w-4" />
          Connect Wallet
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 bg-card border-white/10 text-white">
        {connectors.map((connector) => (
          <DropdownMenuItem
            key={connector.uid}
            onClick={() => connect({ connector })}
            className="cursor-pointer focus:bg-white/10"
          >
            {connector.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 00-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 00-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33a.06.06 0 00-.03.02C1.01 9.36.27 13.27.64 17.13a.07.07 0 00.03.05c1.81 1.33 3.55 2.13 5.27 2.66a.07.07 0 00.07-.02 11 11 0 00.94-1.53.07.07 0 00-.04-.1c-.5-.19-.99-.42-1.45-.68-.05-.03-.05-.1-.01-.13.1-.07.2-.15.29-.22a.07.07 0 01.07-.01c3.04 1.39 6.34 1.39 9.34 0a.07.07 0 01.07.01c.1.08.2.15.29.22.05.03.04.1-.01.13-.46.27-.94.49-1.45.68a.07.07 0 00-.04.1c.27.5.59 1.03.94 1.53a.07.07 0 00.07.02c1.73-.53 3.46-1.33 5.27-2.66a.07.07 0 00.03-.05c.45-4.46-.74-8.34-3.13-11.78a.06.06 0 00-.03-.02zM8.52 14.81c-1.04 0-1.9-.95-1.9-2.12 0-1.18.84-2.13 1.9-2.13 1.07 0 1.92.96 1.9 2.13 0 1.17-.85 2.12-1.9 2.12zm7.03 0c-1.04 0-1.9-.95-1.9-2.12 0-1.18.84-2.13 1.9-2.13 1.07 0 1.92.96 1.9 2.13 0 1.17-.84 2.12-1.9 2.12z" />
    </svg>
  );
}
