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
            className="group relative flex items-center gap-2 shrink-0 rounded-lg px-1.5 py-1 -mx-1.5 transition-all duration-200 hover:bg-white/5 hover:shadow-[0_0_24px_-4px_rgba(168,85,247,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {/* Subtle violet ring around the flame so it reads as a button, not just decoration */}
            <span
              aria-hidden
              className="absolute left-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full ring-1 ring-primary/30 group-hover:ring-primary/70 transition-all duration-200"
            />
            <FireParticles size={36} count={12} />
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
