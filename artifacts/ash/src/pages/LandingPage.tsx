import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Flame, Info, Shield, Zap } from "lucide-react";
import { FireParticles } from "@/components/FireParticles";

export default function LandingPage() {
  return (
    <div className="container mx-auto relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] py-12 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="max-w-3xl text-center space-y-8 mx-auto"
      >
        <div className="inline-flex items-center justify-center mb-4">
          <FireParticles size={72} count={18} />
        </div>
        
        <h1 className="halo-wrap font-serif text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight text-white text-halo-soft break-words">
          NadBurn — <span className="text-primary text-halo">Burn your Nads</span>
        </h1>
        
        <p className="text-lg sm:text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          The cleanest way to wipe worthless tokens and dead NFTs from your wallet. Send the nads straight to the void on Monad and Ethereum — or melt fungible dust back into MON when liquidity allows.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
          <Link href="/app">
            <Button size="lg" className="h-14 px-8 text-lg bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.45)] hover:shadow-[0_0_35px_rgba(168,85,247,0.65)] transition-all">
              Enter the Furnace
              <Flame className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
        className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl mt-24 mx-auto"
      >
        <div className="flex flex-col items-center text-center space-y-4 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
          <div className="p-3 rounded-full bg-white/5 text-primary">
            <Zap className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-medium text-white text-halo-soft">Sweep &amp; Burn</h3>
          <p className="text-muted-foreground">Pick a pile of nads tokens and send the whole batch to ash in a single signed transaction.</p>
        </div>

        <div className="flex flex-col items-center text-center space-y-4 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
          <div className="p-3 rounded-full bg-white/5 text-primary">
            <Shield className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-medium text-white text-halo-soft">Permanently Gone</h3>
          <p className="text-muted-foreground">Burns route to <span className="font-mono">0x00…dEaD</span> — the canonical black hole. Once it's there, it isn't coming back.</p>
        </div>

        <div className="flex flex-col items-center text-center space-y-4 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
          <div className="p-3 rounded-full bg-white/5 text-primary">
            <Info className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-medium text-white text-halo-soft">Tokens &amp; NFTs</h3>
          <p className="text-muted-foreground">Auto‑detect surfaces every ERC‑20, ERC‑721, and ERC‑1155 in your wallet — paste a contract for the obscure ones, then torch them in one batch.</p>
        </div>
      </motion.div>
    </div>
  );
}
