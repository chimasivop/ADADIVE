import { NETWORK_LABEL } from "@/lib/chain";
import { DEVNET_DEMO } from "@/lib/demo";
import { FlaskConical } from "lucide-react";

const gold = "#c9a96e";

/**
 * The "Devnet demo" banner.
 *
 * Shown only when the build sets `VITE_DEVNET_DEMO` (see `lib/demo.ts`), so a
 * normal build renders nothing. Its job is to stop a judge from mistaking demo
 * data for production: it says the app is on Solana devnet, that the data is
 * seeded for the demo, and that the reliability advisor is advisory only.
 */
export function DevnetDemoBanner() {
  if (!DEVNET_DEMO) return null;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        flexWrap: "wrap",
        padding: "8px 16px",
        background: "rgba(201,169,110,0.08)",
        borderBottom: "1px solid rgba(201,169,110,0.28)",
        color: gold,
        fontFamily: "'DM Mono', monospace",
        fontSize: "10px",
        letterSpacing: "0.16em",
        textAlign: "center",
      }}
    >
      <FlaskConical className="size-3.5" style={{ flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>DEVNET DEMO</span>
      <span style={{ opacity: 0.75 }}>
        {NETWORK_LABEL} · seeded demo data · no real funds · AI advisory only
      </span>
    </div>
  );
}
