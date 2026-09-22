import { useMemo } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import { WalletProvider } from "@/contexts/WalletContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { RPC_ENDPOINT } from "@/lib/chain";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import TokenPage from "@/pages/TokenPage";
import Dashboard from "@/pages/Dashboard";
import Providers from "@/pages/Providers";
import ProviderDetail from "@/pages/ProviderDetail";
import Deals from "@/pages/Deals";
import DealDetail from "@/pages/DealDetail";
import NewDeal from "@/pages/NewDeal";
import PinFiles from "@/pages/PinFiles";
import WaitlistAdmin from "@/pages/WaitlistAdmin";
import { setBaseUrl } from "@workspace/api-client-react";

// Configure API base URL from environment variable
// VITE_API_URL should be set to the production API server URL
const API_URL = import.meta.env.VITE_API_URL as string | undefined;
if (API_URL) {
  setBaseUrl(API_URL);
}

const queryClient = new QueryClient();

function AppRouter() {
  return (
    <Shell>
      <Switch>
        <Route path="/app"               component={Dashboard}      />
        <Route path="/providers"         component={Providers}      />
        <Route path="/providers/:id"     component={ProviderDetail} />
        <Route path="/deals"             component={Deals}          />
        <Route path="/deals/new"         component={NewDeal}        />
        <Route path="/deals/:id"         component={DealDetail}     />
        <Route path="/pin"               component={PinFiles}       />
        <Route path="/waitlist-admin"    component={WaitlistAdmin}  />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/"      component={Landing}   />
      <Route path="/token" component={TokenPage} />
      {/* All other routes go through the app shell */}
      <Route component={AppRouter} />
    </Switch>
  );
}

function App() {
  // Phantom and Solflare are registered explicitly rather than relying on
  // auto-detection, so the connect button's wallet preference (see
  // `contexts/WalletContext`) always has something to pick from.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ThemeProvider>
      <ConnectionProvider endpoint={RPC_ENDPOINT}>
        <SolanaWalletProvider wallets={wallets} autoConnect={false}>
          <QueryClientProvider client={queryClient}>
            <WalletProvider>
              <TooltipProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <Router />
                </WouterRouter>
                <Toaster />
              </TooltipProvider>
            </WalletProvider>
          </QueryClientProvider>
        </SolanaWalletProvider>
      </ConnectionProvider>
    </ThemeProvider>
  );
}

export default App;
