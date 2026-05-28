import { Link, useLocation } from "wouter";
import { THT } from "@/lib/token";
import { useWallet } from "@/contexts/WalletContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutDashboard, Server, Database, Pin,
  Wallet, LogOut, Loader2, Sun, Moon,
} from "lucide-react";
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
  { title: "Network",   url: "/",          icon: LayoutDashboard },
  { title: "Providers", url: "/providers", icon: Server          },
  { title: "Deals",     url: "/deals",     icon: Database        },
  { title: "Pin Files", url: "/pin",       icon: Pin             },
];

/* Gold palette refs */
const gold   = "#c9a96e";
const goldLt = "#e8c98a";
const goldDk = "#8a6a3a";
const green  = "#00ffa3";
const smoke  = "#8899bb";
const mist   = "#4a5a7a";

export function AppSidebar() {
  const [location] = useLocation();
  const { connected, connecting, connect, disconnect, displayAddress, thtBalance, adaBalance, error } = useWallet();
  const { isDark, toggleTheme } = useTheme();

  const accent = isDark ? gold : goldDk;
  const dim    = isDark ? smoke : mist;
  const bg     = isDark ? "rgba(201,169,110,0.06)" : "rgba(139,106,58,0.06)";
  const borderC = isDark ? "rgba(201,169,110,0.18)" : "rgba(139,106,58,0.2)";

  return (
    <Sidebar className="border-r border-primary/10 bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/70">
      <SidebarContent>
        <SidebarGroup>
          {/* ── Wordmark ── */}
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5 mb-1">
              {/* Hexagon glyph */}
              <div
                style={{
                  width: "22px",
                  height: "22px",
                  background: `linear-gradient(135deg, ${accent}, ${isDark ? goldDk : "#a07840"})`,
                  clipPath: "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)",
                  flexShrink: 0,
                }}
              />
              <div className="flex flex-col leading-none">
                <span
                  style={{
                    fontFamily: "'Cinzel', serif",
                    fontSize: "13px",
                    letterSpacing: "0.35em",
                    color: accent,
                    fontWeight: 700,
                  }}
                >
                  ADADIVE
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "9px",
                    letterSpacing: "0.22em",
                    color: dim,
                    marginTop: "1px",
                  }}
                >
                  by THETA
                </span>
              </div>
            </div>
          </div>

          {/* ── Gold divider: powered by THT ── */}
          <div className="px-5 mb-4 flex items-center gap-2">
            <div
              style={{
                flex: 1,
                height: "1px",
                background: `linear-gradient(90deg, transparent, ${accent})`,
                opacity: 0.4,
              }}
            />
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "8px",
                letterSpacing: "0.22em",
                color: dim,
                opacity: 0.7,
              }}
            >
              powered by {THT.symbol}
            </span>
            <div
              style={{
                flex: 1,
                height: "1px",
                background: `linear-gradient(90deg, ${accent}, transparent)`,
                opacity: 0.4,
              }}
            />
          </div>

          {/* ── Nav group label ── */}
          <SidebarGroupLabel
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: "9px",
              letterSpacing: "0.25em",
              color: dim,
              paddingLeft: "20px",
              marginBottom: "6px",
              opacity: 0.7,
            }}
          >
            EXPLORER
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active =
                  location === item.url ||
                  (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.18em",
                        color: active ? accent : dim,
                        background: active ? bg : "transparent",
                        border: active ? `1px solid ${borderC}` : "1px solid transparent",
                        borderRadius: "2px",
                        transition: "all 0.2s",
                      }}
                    >
                      <Link
                        href={item.url}
                        className="flex items-center gap-3 px-3 py-2"
                        style={{ color: "inherit" }}
                      >
                        <item.icon
                          className="size-3.5"
                          style={{ color: active ? accent : dim }}
                        />
                        <span>{item.title.toUpperCase()}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter
        style={{
          borderTop: `1px solid ${borderC}`,
          padding: "12px",
          gap: "10px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── Theme toggle ── */}
        <button
          onClick={toggleTheme}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            padding: "6px 10px",
            background: "transparent",
            border: `1px solid ${borderC}`,
            borderRadius: "2px",
            cursor: "pointer",
            color: dim,
            fontFamily: "'DM Mono', monospace",
            fontSize: "9px",
            letterSpacing: "0.18em",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = accent;
            (e.currentTarget as HTMLButtonElement).style.color = accent;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = borderC;
            (e.currentTarget as HTMLButtonElement).style.color = dim;
          }}
        >
          {isDark ? <Sun className="size-3" /> : <Moon className="size-3" />}
          {isDark ? "LIGHT MODE" : "DARK MODE"}
        </button>

        {/* ── Wallet section ── */}
        {connected ? (
          <div
            style={{
              padding: "10px 12px",
              background: bg,
              border: `1px solid ${borderC}`,
              borderRadius: "2px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: green,
                    display: "block",
                    animation: "vaultPulse 2s infinite",
                  }}
                />
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "9px",
                    letterSpacing: "0.18em",
                    color: green,
                  }}
                >
                  CONNECTED
                </span>
              </div>
              <button
                onClick={disconnect}
                style={{ background: "none", border: "none", color: dim, cursor: "pointer", padding: "2px" }}
                title="Disconnect"
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#e05c5c")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = dim)}
              >
                <LogOut className="size-3" />
              </button>
            </div>

            {displayAddress && (
              <p
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "9px",
                  color: dim,
                  letterSpacing: "0.05em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayAddress}
              </p>
            )}

            {[
              ["THT", thtBalance != null ? thtBalance.toLocaleString() : "—", accent],
              ["ADA", adaBalance != null ? `₳ ${adaBalance.toFixed(2)}` : "—", dim],
            ].map(([label, val, col]) => (
              <div key={label as string} style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "9px",
                    letterSpacing: "0.12em",
                    color: dim,
                  }}
                >
                  {label as string}
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "10px",
                    fontWeight: 500,
                    color: col as string,
                  }}
                >
                  {val as string}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {error && (
              <p
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "9px",
                  color: "#e05c5c",
                  letterSpacing: "0.08em",
                  paddingLeft: "4px",
                }}
              >
                {error}
              </p>
            )}
            <button
              onClick={connect}
              disabled={connecting}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "7px",
                padding: "9px 12px",
                background: connecting ? bg : "transparent",
                border: `1px solid ${connecting ? borderC : "rgba(201,169,110,0.22)"}`,
                borderRadius: "2px",
                color: connecting ? accent : dim,
                cursor: connecting ? "wait" : "pointer",
                fontFamily: "'Cinzel', serif",
                fontSize: "10px",
                letterSpacing: "0.28em",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!connecting) {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.borderColor = accent;
                  el.style.color = accent;
                  el.style.background = bg;
                }
              }}
              onMouseLeave={(e) => {
                if (!connecting) {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.borderColor = "rgba(201,169,110,0.22)";
                  el.style.color = dim;
                  el.style.background = "transparent";
                }
              }}
            >
              {connecting ? (
                <><Loader2 className="size-3 animate-spin" /> CONNECTING...</>
              ) : (
                <><Wallet className="size-3" /> CONNECT ETERNL</>
              )}
            </button>
            <p
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: "8px",
                color: dim,
                textAlign: "center",
                letterSpacing: "0.1em",
                opacity: 0.6,
              }}
            >
              Requires Eternl browser extension
            </p>
          </>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
