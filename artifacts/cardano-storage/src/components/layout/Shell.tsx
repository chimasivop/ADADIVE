import { ReactNode } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      {/* Full-screen gradient background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        {/* Base */}
        <div className="absolute inset-0" style={{ background: "hsl(232 55% 5%)" }} />
        {/* Cyan orb — top right */}
        <div
          className="absolute"
          style={{
            top: "-15%",
            right: "-10%",
            width: "60vw",
            height: "60vw",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,212,255,0.18) 0%, transparent 65%)",
            filter: "blur(2px)",
          }}
        />
        {/* Purple orb — bottom left */}
        <div
          className="absolute"
          style={{
            bottom: "-20%",
            left: "-10%",
            width: "55vw",
            height: "55vw",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(120,60,220,0.2) 0%, transparent 65%)",
            filter: "blur(2px)",
          }}
        />
        {/* Green orb — center (THT brand) */}
        <div
          className="absolute"
          style={{
            top: "35%",
            left: "40%",
            width: "40vw",
            height: "40vw",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,255,163,0.07) 0%, transparent 65%)",
          }}
        />
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

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
