import { Link, useLocation } from "wouter";
import { THT } from "@/lib/token";
import { Activity, Database, LayoutDashboard, Server, Pin } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Network", url: "/", icon: LayoutDashboard },
  { title: "Providers", url: "/providers", icon: Server },
  { title: "Deals", url: "/deals", icon: Database },
  { title: "Pin Files", url: "/pin", icon: Pin },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar className="border-r border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center space-x-2 px-4 py-4 mb-4">
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
    </Sidebar>
  );
}
