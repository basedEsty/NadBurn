import { Link } from "wouter";
import { FireParticles } from "./FireParticles";
import ConnectWallet from "./ConnectWallet";
import PerformanceMenu from "./PerformanceMenu";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-background/50 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-3 sm:px-6 max-w-full overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link
            href="/"
            aria-label="Back to home"
            title="Back to home"
            className="group relative flex items-center gap-2 shrink-0 rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {/* Brighter violet drop-shadow glow under the flame so the colors
                read as vivid + interactive without needing an outlined ring. */}
            <span className="drop-shadow-[0_0_10px_rgba(192,132,252,0.85)] group-hover:drop-shadow-[0_0_16px_rgba(216,180,254,1)] transition-all duration-200">
              <FireParticles size={36} count={12} />
            </span>
            {/* Hide the wordmark on the smallest phones so the perf toggle
                and connect-wallet button never get clipped. The flame logo
                still anchors the brand. */}
            <span className="hidden sm:inline font-serif text-xl font-bold tracking-tight text-white">
              NadBurn
            </span>
          </Link>
          <PerformanceMenu />
        </div>
        <div className="shrink-0 min-w-0">
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
