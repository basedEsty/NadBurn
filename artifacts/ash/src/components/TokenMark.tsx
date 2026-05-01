/**
 * Neutral, plainly-non-branded mark used when no real logo URL is
 * available from Uniswap, CoinGecko, or the native-token override.
 *
 * Pure CSS (no external assets, no fetch, no color seeding from address)
 * so an unknown scam token never looks like it has an "official" identity.
 * Same dimensions as a 32x32 logo `<img>` so swapping mark ↔ image
 * doesn't shift surrounding layout.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  resolveTokenLogo,
  subscribeTokenLogos,
  getTokenLogosVersion,
} from "@/lib/token-logos";

/**
 * Subscribe to the token-logo registry version so any row using
 * `<TokenLogo>` deterministically re-renders the moment the Uniswap +
 * CoinGecko lists hydrate (cache hit or network completion). Without
 * this, components show the neutral mark on cold cache until something
 * unrelated triggers a re-render.
 */
function useTokenLogosVersion(): number {
  return useSyncExternalStore(
    subscribeTokenLogos,
    getTokenLogosVersion,
    () => 0, // SSR snapshot — no logos available pre-hydration
  );
}

interface TokenMarkProps {
  symbol?: string | null;
  size?: number;
  className?: string;
}

export function TokenMark({ symbol, size = 32, className = "" }: TokenMarkProps) {
  const initial = (symbol ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      role="img"
      aria-label={
        symbol ? `${symbol} (no logo available)` : "Unknown token (no logo available)"
      }
      className={`inline-flex items-center justify-center rounded-full bg-black/40 border border-white/10 text-muted-foreground font-medium select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        lineHeight: 1,
      }}
    >
      {initial}
    </div>
  );
}

/**
 * Single render path for every token logo in the app — render `<img>`
 * when Uniswap or CoinGecko returns a URL for `(chainId, address)`,
 * otherwise render the neutral `<TokenMark>`. The component subscribes
 * to logo-list hydration so rows automatically swap from mark → real
 * image as soon as the lists load.
 *
 * If the hosted URL 404s or CORS-fails at render time we also swap to
 * the neutral mark — the user always sees a glyph, never an empty circle.
 */
interface TokenLogoProps {
  chainId: number;
  /** ERC-20 address (`0x...`) or the literal `"native"` for the gas token. */
  address: string;
  symbol?: string | null;
  size?: number;
  className?: string;
}

export function TokenLogo({
  chainId,
  address,
  symbol,
  size = 32,
  className = "",
}: TokenLogoProps) {
  // Triggers a re-render whenever the registry version bumps so the
  // resolveTokenLogo() call below picks up newly-hydrated entries.
  useTokenLogosVersion();
  const src = resolveTokenLogo(chainId, address);

  const [errored, setErrored] = useState(false);

  // Reset the error flag whenever the upstream URL changes so a
  // previously-broken image gets a fresh chance after rehydration.
  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (!src || errored) {
    return <TokenMark symbol={symbol} size={size} className={className} />;
  }

  return (
    <img
      src={src}
      alt={symbol ? `${symbol} logo` : "Token logo"}
      width={size}
      height={size}
      loading="lazy"
      className={`rounded-full bg-black/40 border border-white/10 object-cover ${className}`}
      style={{ width: size, height: size }}
      onError={() => setErrored(true)}
    />
  );
}
