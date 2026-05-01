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
import { DiscordIcon } from "./icons/DiscordIcon";
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
        {/* Chain pill — desktop only; collapsed into the wallet dropdown on mobile. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex border-white/10 bg-white/5 hover:bg-white/10"
            >
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
            {/* Mobile-only chain switcher. */}
            <DropdownMenuLabel className="sm:hidden flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Globe className="h-3 w-3 text-primary" />
              <span className="truncate">
                {currentChain?.name ?? "Unknown Chain"}
              </span>
            </DropdownMenuLabel>
            {chains.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => switchChain({ chainId: c.id })}
                className="sm:hidden cursor-pointer focus:bg-white/10 pl-6"
              >
                {c.name}
                {c.id === chainId ? (
                  <span className="ml-auto text-xs text-primary">•</span>
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="sm:hidden bg-white/10" />

            {/* Mobile-only Discord controls (desktop has the standalone DiscordPill). */}
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

