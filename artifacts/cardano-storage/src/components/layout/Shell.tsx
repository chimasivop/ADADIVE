import { ReactNode } from "react";
import { Link } from "wouter";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useTheme } from "@/contexts/ThemeContext";
import logoUrl from "@assets/seedream-4.0_Hexagonal_gold_emblem_on_deep_black_background_bl_1780317486678.jpg";

export function Shell({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();

  const gold = "rgba(201,169,110,";
  const gridColor = isDark ? `${gold}0.028)` : `${gold}0.12)`;

  return (
    <SidebarProvider defaultOpen>
      {/* ── Full-screen atmospheric background ── */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0 transition-colors duration-500"
          style={{ background: isDark ? "hsl(228 58% 4%)" : "hsl(44 40% 96%)" }}
        />
        {/* Gold orb — top centre, floating */}
        <div
          className="absolute orb-float"
          style={{
            top: "-8%", left: "50%", transform: "translateX(-50%)",
            width: "min(700px, 120vw)", height: "min(700px, 120vw)",
            borderRadius: "50%",
            background: isDark
              ? `radial-gradient(ellipse, ${gold}0.07) 0%, transparent 65%)`
              : `radial-gradient(ellipse, ${gold}0.18) 0%, transparent 65%)`,
            pointerEvents: "none",
          }}
        />
        {/* Green orb — bottom right */}
        <div
          className="absolute"
          style={{
            bottom: "-5%", right: "-5%",
            width: "min(400px, 70vw)", height: "min(400px, 70vw)",
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
        {/* Scanline */}
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

        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* ── Mobile header (hidden on md+) ── */}
          <header
            className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14"
            style={{
              background: isDark ? "rgba(4,6,15,0.92)" : "rgba(250,248,242,0.92)",
              backdropFilter: "blur(12px)",
              borderBottom: `1px solid ${gold}0.18)`,
            }}
          >
            <SidebarTrigger
              style={{ color: "hsl(var(--primary))", background: "none", border: "none", cursor: "pointer" }}
            />
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
              <img src={logoUrl} alt="ADADIVE" style={{ width: "22px", height: "22px", objectFit: "contain", borderRadius: "2px" }} />
              <span
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: "12px",
                  letterSpacing: "0.35em",
                  color: "hsl(var(--primary))",
                  fontWeight: 700,
                }}
              >
                ADADIVE
              </span>
            </Link>
            {/* Right spacer keeps logo centred */}
            <div style={{ width: "36px" }} />
          </header>

          {/* ── Page content ── */}
          <div className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8 overflow-y-auto">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
