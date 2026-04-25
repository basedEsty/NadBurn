import { Link } from "wouter";
import { FireParticles } from "./FireParticles";
import ConnectWallet from "./ConnectWallet";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-background/50 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <FireParticles size={28} count={8} />
          <span className="font-serif text-xl font-bold tracking-tight text-white">
            NadBurn
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
