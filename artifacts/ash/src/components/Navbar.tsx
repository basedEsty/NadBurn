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
            className="flex items-center gap-2 transition-opacity hover:opacity-80 shrink-0"
          >
            <FireParticles size={28} count={8} />
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
