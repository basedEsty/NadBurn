import { Component, lazy, Suspense, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { wagmiConfig } from "@/lib/wagmi";
import LandingPage from "@/pages/LandingPage";
import Navbar from "@/components/Navbar";
import EmberBackground from "@/components/EmberBackground";
import CustomCursor from "@/components/CustomCursor";

// Heavy routes (BurnerApp pulls in framer-motion screens, dialogs, charts)
// are split into their own chunk so the landing page paints fast on mobile
// without dragging in the whole burn UI bundle. Wouter triggers the import
// only when the matching route is visited.
const BurnerApp = lazy(() => import("@/pages/BurnerApp"));
const NotFound = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient();

// Tiny visual fallback (matches the dark background) shown while a lazy
// route chunk is being fetched. Intentionally empty — a spinner would just
// flash for a few hundred ms and feel jankier than nothing.
function RouteFallback() {
  return <div className="flex-1" aria-hidden />;
}

// Catches chunk-load failures (stale CDN cache after a deploy, flaky
// network, etc.) so users get a recoverable message instead of a blank
// page when a lazy route can't be fetched. Class component because React
// only supports error boundaries via componentDidCatch.
class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[NadBurn] route chunk failed to load:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center gap-4">
        <h2 className="font-serif text-2xl font-bold text-white">
          Couldn't load this page
        </h2>
        <p className="text-muted-foreground max-w-md">
          A new version of NadBurn may have just shipped. Reloading usually
          fixes it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
        >
          Reload
        </button>
      </div>
    );
  }
}

function Router() {
  return (
    <div className="relative min-h-screen flex flex-col font-sans selection:bg-primary/30">
      <EmberBackground />
      <CustomCursor />
      <Navbar />
      <main className="flex-1 relative z-10 flex flex-col">
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Switch>
              <Route path="/" component={LandingPage} />
              <Route path="/app" component={BurnerApp} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </RouteErrorBoundary>
      </main>
    </div>
  );
}

function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
