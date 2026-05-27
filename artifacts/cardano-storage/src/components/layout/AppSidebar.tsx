import { Link, useLocation } from "wouter";
import { THT } from "@/lib/token";
import { useWallet } from "@/contexts/WalletContext";
import { Activity, Database, LayoutDashboard, Server, Pin, Wallet, LogOut, Loader2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Network", url: "/", icon: LayoutDashboard },
  { title: "Providers", url: "/providers", icon: Server },
  { title: "Deals", url: "/deals", icon: Database },
  { title: "Pin Files", url: "/pin", icon: Pin },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { connected, connecting, connect, disconnect, displayAddress, thtBalance, adaBalance, error } = useWallet();

  return (
    <Sidebar className="border-r border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center space-x-2 px-4 py-4 mb-2">
            <div
              style={{
                width: "24px",
                height: "24px",
                background: "linear-gradient(135deg, #00ffa3, #00b4ff)",
                clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                flexShrink: 0,
              }}
            />
            <div className="flex flex-col leading-none">
              <span className="font-mono font-bold tracking-widest text-sm" style={{ color: "#00ffa3" }}>
                ADADIVE
              </span>
              <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground">
                by THETA
              </span>
            </div>
          </div>

          <div className="px-4 mb-4 flex items-center gap-2">
            <div className="h-px flex-1 bg-border/50" />
            <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/60">
              powered by {THT.symbol}
            </span>
            <div className="h-px flex-1 bg-border/50" />
          </div>

          <SidebarGroupLabel className="font-mono text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Explorer
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}
                    className="font-mono text-sm data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-bold"
                  >
                    <Link href={item.url} className="flex items-center gap-3 px-3 py-2 transition-all hover:pl-4">
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/50 p-3 space-y-2">
        {connected ? (
          <>
            <div className="px-2 py-2 rounded bg-primary/5 border border-primary/20 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-mono text-[10px] text-emerald-400 tracking-wider">CONNECTED</span>
                </div>
                <button
                  onClick={disconnect}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title="Disconnect"
                >
                  <LogOut className="size-3" />
                </button>
              </div>
              {displayAddress && (
                <p className="font-mono text-[10px] text-muted-foreground truncate">{displayAddress}</p>
              )}
              <div className="flex items-center justify-between pt-0.5">
                <span className="font-mono text-[10px] text-muted-foreground">THT</span>
                <span className="font-mono text-xs font-bold text-primary">
                  {thtBalance != null ? thtBalance.toLocaleString() : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">ADA</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  ₳ {adaBalance != null ? adaBalance.toFixed(2) : "—"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            {error && (
              <p className="font-mono text-[10px] text-destructive px-1 leading-tight">{error}</p>
            )}
            <button
              onClick={connect}
              disabled={connecting}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded font-mono text-[11px] tracking-widest transition-all"
              style={{
                background: connecting ? "rgba(0,255,163,0.08)" : "transparent",
                border: "1px solid rgba(0,255,163,0.3)",
                color: connecting ? "#00ffa3" : "#a0aec0",
                cursor: connecting ? "wait" : "pointer",
              }}
            >
              {connecting ? (
                <><Loader2 className="size-3 animate-spin" /> CONNECTING...</>
              ) : (
                <><Wallet className="size-3" /> CONNECT ETERNL</>
              )}
            </button>
            <p className="font-mono text-[9px] text-muted-foreground/50 text-center tracking-wide px-2">
              Requires Eternl browser extension
            </p>
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
