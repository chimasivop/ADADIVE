import { Link, useLocation } from "wouter";
import { Activity, Database, LayoutDashboard, Settings, Server } from "lucide-react";
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
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar className="border-r border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarContent>
        <SidebarGroup>
          <div className="flex items-center space-x-2 px-4 py-4 mb-4">
            <div className="size-6 bg-primary rounded-sm flex items-center justify-center">
              <Activity className="size-4 text-primary-foreground" />
            </div>
            <span className="font-mono font-bold tracking-tight text-lg text-primary">ADA_STORE</span>
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
