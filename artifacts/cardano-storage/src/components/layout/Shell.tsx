import { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useTheme } from "@/contexts/ThemeContext";

export function Shell({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();

  const gold = "rgba(201,169,110,";
  const gridColor = isDark ? `${gold}0.028)` : `${gold}0.12)`;

  return (
    <SidebarProvider defaultOpen>
      {/* ── Full-screen atmospheric background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {/* Base fill */}
        <div
          className="absolute inset-0 transition-colors duration-500"
          style={{ background: isDark ? "hsl(228 58% 4%)" : "hsl(44 40% 96%)" }}
        />

        {/* Gold orb — top center, floating */}
        <div
          className="absolute orb-float"
          style={{
            top: "-8%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "700px",
            height: "700px",
            borderRadius: "50%",
            background: isDark
              ? `radial-gradient(ellipse, ${gold}0.07) 0%, transparent 65%)`
              : `radial-gradient(ellipse, ${gold}0.18) 0%, transparent 65%)`,
            pointerEvents: "none",
          }}
        />

        {/* Green orb — bottom right (THT brand) */}
        <div
          className="absolute"
          style={{
            bottom: "-5%",
            right: "-5%",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: isDark
              ? "radial-gradient(ellipse, rgba(0,180,120,0.05) 0%, transparent 65%)"
              : "radial-gradient(ellipse, rgba(0,160,100,0.08) 0%, transparent 65%)",
            pointerEvents: "none",
          }}
        />

        {/* Fine gold grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
            pointerEvents: "none",
          }}
        />

        {/* Animated scanline */}
        {isDark && (
          <div
            className="absolute left-0 right-0"
            style={{
              height: "2px",
              background: `linear-gradient(transparent, ${gold}0.05), transparent)`,
              animation: "scanline 10s linear infinite",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* ── Top gold rule ── */}
      <div
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          height: "1px",
          background: `linear-gradient(90deg, transparent, ${gold}0.5), ${gold}0.5), transparent)`,
        }}
      />

      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 w-full max-w-7xl mx-auto p-6 md:p-8 overflow-y-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
