import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import { WalletProvider } from "@/contexts/WalletContext";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Providers from "@/pages/Providers";
import ProviderDetail from "@/pages/ProviderDetail";
import Deals from "@/pages/Deals";
import DealDetail from "@/pages/DealDetail";
import NewDeal from "@/pages/NewDeal";
import PinFiles from "@/pages/PinFiles";

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/providers" component={Providers} />
        <Route path="/providers/:id" component={ProviderDetail} />
        <Route path="/deals" component={Deals} />
        <Route path="/deals/new" component={NewDeal} />
        <Route path="/deals/:id" component={DealDetail} />
        <Route path="/pin" component={PinFiles} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
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
  );
}

export default App;
