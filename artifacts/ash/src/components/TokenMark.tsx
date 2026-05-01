/**
 * Neutral, plainly-non-branded mark used when no real logo URL is
 * available from Uniswap, CoinGecko, or the native-token override.
 *
 * Pure CSS (no external assets, no fetch, no color seeding from address)
 * so an unknown scam token never looks like it has an "official" identity.
 * Same dimensions as a 32x32 logo `<img>` so swapping mark ↔ image
 * doesn't shift surrounding layout.
 */

import { useEffect, useState } from "react";

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
 * Convenience wrapper that picks `<img>` when a URL is available and
 * `<TokenMark>` otherwise. Keeps every render site on the same code path
 * so the fallback decision lives in exactly one place.
 *
 * If the hosted logo URL 404s or CORS-fails at render time, we swap to
 * the neutral mark — the user always sees a glyph, never an empty circle.
 */
interface TokenLogoProps {
  src: string | null | undefined;
  symbol?: string | null;
  size?: number;
  className?: string;
}

export function TokenLogo({ src, symbol, size = 32, className = "" }: TokenLogoProps) {
  const [errored, setErrored] = useState(false);

  // Reset the error flag whenever the upstream URL changes (e.g. after
  // primeTokenLogos() resolves and the same row re-renders with a real
  // src) so a previously-broken image gets a fresh chance.
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
