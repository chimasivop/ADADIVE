import { useListWaitlist, getListWaitlistQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";

const mono = "'DM Mono', 'Space Mono', monospace";
const gold = "hsl(var(--primary))";

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    + "  "
    + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function WaitlistAdmin() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();

  const { data: entries, isLoading, error, refetch } = useListWaitlist(
    { query: { queryKey: getListWaitlistQueryKey(), enabled: isAuthenticated } },
  );

  if (authLoading) {
    return (
      <p style={{ fontFamily: mono, fontSize: "11px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.1em" }}>
        LOADING...
      </p>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: "460px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{
            fontFamily: "'Cinzel', serif",
            fontSize: "clamp(18px, 3vw, 26px)",
            letterSpacing: "0.22em",
            color: gold,
            marginBottom: "8px",
          }}>
            WAITLIST ADMIN
          </h1>
          <p style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
            Sign in to view waitlist signups
          </p>
        </div>

        <div style={{ height: "1px", background: "hsl(var(--primary)/0.12)", marginBottom: "32px" }} />

        <div style={{
          padding: "32px",
          border: "1px solid hsl(var(--primary)/0.2)",
          borderRadius: "4px",
          background: "hsl(var(--card))",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "28px", color: gold, marginBottom: "16px" }}>◆</div>
          <p style={{ fontFamily: mono, fontSize: "11px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.1em", marginBottom: "24px" }}>
            THIS PAGE IS RESTRICTED
          </p>
          <button
            onClick={login}
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: "11px",
              letterSpacing: "0.28em",
              padding: "10px 28px",
              background: "transparent",
              border: "1px solid hsl(var(--primary)/0.5)",
              borderRadius: "2px",
              color: gold,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "hsl(var(--primary)/0.08)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            LOG IN
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "860px" }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 style={{
            fontFamily: "'Cinzel', serif",
            fontSize: "clamp(18px, 3vw, 26px)",
            letterSpacing: "0.22em",
            color: gold,
            marginBottom: "6px",
          }}>
            WAITLIST
          </h1>
          <p style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
            Early-access signups from the landing page
          </p>
        </div>

        <button
          onClick={() => refetch()}
          style={{
            fontFamily: mono, fontSize: "9px", letterSpacing: "0.18em",
            padding: "7px 14px",
            background: "transparent",
            border: "1px solid hsl(var(--primary)/0.25)",
            borderRadius: "2px",
            color: "hsl(var(--muted-foreground))",
            cursor: "pointer",
            transition: "all 0.2s",
            flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = gold; (e.currentTarget as HTMLButtonElement).style.color = gold; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--primary)/0.25)"; (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"; }}
        >
          ↻ REFRESH
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: "hsl(var(--primary)/0.12)", marginBottom: "28px" }} />

      {/* Count badge */}
      {!isLoading && !error && entries && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "8px",
          padding: "5px 14px",
          background: "hsl(var(--primary)/0.08)",
          border: "1px solid hsl(var(--primary)/0.2)",
          borderRadius: "2px",
          marginBottom: "20px",
        }}>
          <span style={{ fontFamily: mono, fontSize: "22px", fontWeight: 700, color: gold }}>
            {entries.length}
          </span>
          <span style={{ fontFamily: mono, fontSize: "9px", letterSpacing: "0.2em", color: "hsl(var(--muted-foreground))" }}>
            {entries.length === 1 ? "SIGNUP" : "SIGNUPS"}
          </span>
        </div>
      )}

      {isLoading && (
        <p style={{ fontFamily: mono, fontSize: "11px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.1em" }}>
          LOADING...
        </p>
      )}

      {error && (
        <p style={{ fontFamily: mono, fontSize: "11px", color: "#e05c5c", letterSpacing: "0.1em" }}>
          Failed to load entries.
        </p>
      )}

      {!isLoading && !error && entries?.length === 0 && (
        <div style={{
          padding: "48px 24px",
          border: "1px dashed hsl(var(--primary)/0.15)",
          borderRadius: "4px",
          textAlign: "center",
        }}>
          <p style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.1em" }}>
            No signups yet
          </p>
          <p style={{ fontFamily: mono, fontSize: "10px", color: "hsl(var(--muted-foreground))", opacity: 0.6, marginTop: "6px" }}>
            Share the landing page to collect emails
          </p>
        </div>
      )}

      {/* Table */}
      {entries && entries.length > 0 && (
        <div style={{ border: "1px solid hsl(var(--primary)/0.14)", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 180px",
            padding: "8px 16px",
            background: "hsl(var(--primary)/0.06)",
            borderBottom: "1px solid hsl(var(--primary)/0.14)",
          }}>
            {["EMAIL", "JOINED"].map(h => (
              <span key={h} style={{ fontFamily: mono, fontSize: "8px", letterSpacing: "0.2em", color: "hsl(var(--muted-foreground))" }}>
                {h}
              </span>
            ))}
          </div>

          {entries.map((entry, i) => (
            <div
              key={entry.id}
              style={{
                display: "grid", gridTemplateColumns: "1fr 180px",
                padding: "12px 16px",
                background: i % 2 === 0 ? "transparent" : "hsl(var(--primary)/0.025)",
                borderBottom: i < entries.length - 1 ? "1px solid hsl(var(--primary)/0.08)" : "none",
              }}
            >
              <span style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.email}
              </span>
              <span style={{ fontFamily: mono, fontSize: "10px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em" }}>
                {fmt(entry.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontFamily: mono, fontSize: "9px", color: "hsl(var(--muted-foreground))", opacity: 0.5, marginTop: "20px", letterSpacing: "0.1em" }}>
        ADADIVE by THETA — waitlist data stored in your Replit PostgreSQL database
      </p>
    </div>
  );
}
