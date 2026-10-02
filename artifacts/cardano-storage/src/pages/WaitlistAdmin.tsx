import { useState, useEffect, useCallback } from "react";

const mono = "'DM Mono', 'Space Mono', monospace";
const gold = "hsl(var(--primary))";
const SESSION_KEY = "adadive_admin_pw";

interface WaitlistEntry { id: number; email: string; createdAt: string; }

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    + "  "
    + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

async function fetchEntries(password: string): Promise<WaitlistEntry[]> {
  const res = await fetch("/api/waitlist", {
    headers: { Authorization: `Bearer ${password}` },
  });
  if (res.status === 401) throw new Error("wrong_password");
  if (!res.ok) throw new Error("server_error");
  return res.json() as Promise<WaitlistEntry[]>;
}

export default function WaitlistAdmin() {
  const [password, setPassword]   = useState("");
  const [unlocked, setUnlocked]   = useState(false);
  const [entries, setEntries]     = useState<WaitlistEntry[] | null>(null);
  const [authError, setAuthError] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const load = useCallback(async (pw: string) => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await fetchEntries(pw);
      setEntries(data);
      setUnlocked(true);
      sessionStorage.setItem(SESSION_KEY, pw);
    } catch (e) {
      if ((e as Error).message === "wrong_password") {
        setAuthError(true);
        sessionStorage.removeItem(SESSION_KEY);
      } else {
        setFetchError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) load(saved);
  }, [load]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setAuthError(false);
    load(password.trim());
  };

  if (!unlocked) {
    return (
      <div style={{ maxWidth: "420px" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: "clamp(18px,3vw,26px)", letterSpacing: "0.22em", color: gold, marginBottom: "8px" }}>
            WAITLIST ADMIN
          </h1>
          <p style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
            Enter your admin password to view signups
          </p>
        </div>

        <div style={{ height: "1px", background: "hsl(var(--primary)/0.12)", marginBottom: "32px" }} />

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setAuthError(false); }}
            placeholder="Password"
            autoFocus
            style={{
              background: "hsl(var(--card))",
              border: `1px solid ${authError ? "#e05c5c" : "hsl(var(--primary)/0.25)"}`,
              borderRadius: "2px",
              padding: "12px 16px",
              color: "hsl(var(--foreground))",
              fontFamily: mono,
              fontSize: "13px",
              letterSpacing: "0.08em",
              outline: "none",
              transition: "border-color 0.2s",
              width: "100%",
            }}
            onFocus={e => { if (!authError) e.target.style.borderColor = gold; }}
            onBlur={e => { if (!authError) e.target.style.borderColor = "hsl(var(--primary)/0.25)"; }}
          />

          {authError && (
            <p style={{ fontFamily: mono, fontSize: "10px", color: "#e05c5c", letterSpacing: "0.1em", marginTop: "-6px" }}>
              Incorrect password
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: "10px",
              letterSpacing: "0.28em",
              padding: "11px 24px",
              background: "transparent",
              border: "1px solid hsl(var(--primary)/0.4)",
              borderRadius: "2px",
              color: gold,
              cursor: loading ? "wait" : "pointer",
              transition: "all 0.2s",
              opacity: loading ? 0.6 : 1,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "hsl(var(--primary)/0.08)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            {loading ? "VERIFYING..." : "UNLOCK"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "860px" }}>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: "clamp(18px,3vw,26px)", letterSpacing: "0.22em", color: gold, marginBottom: "6px" }}>
            WAITLIST
          </h1>
          <p style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
            Early-access signups from the landing page
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
          <button
            onClick={() => { const pw = sessionStorage.getItem(SESSION_KEY) ?? ""; load(pw); }}
            style={{ fontFamily: mono, fontSize: "9px", letterSpacing: "0.18em", padding: "7px 14px", background: "transparent", border: "1px solid hsl(var(--primary)/0.25)", borderRadius: "2px", color: "hsl(var(--muted-foreground))", cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = gold; (e.currentTarget as HTMLButtonElement).style.color = gold; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--primary)/0.25)"; (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"; }}
          >
            ↻ REFRESH
          </button>
          <button
            onClick={() => { sessionStorage.removeItem(SESSION_KEY); setUnlocked(false); setEntries(null); setPassword(""); }}
            style={{ fontFamily: mono, fontSize: "9px", letterSpacing: "0.18em", padding: "7px 14px", background: "transparent", border: "1px solid hsl(var(--primary)/0.15)", borderRadius: "2px", color: "hsl(var(--muted-foreground))", cursor: "pointer", transition: "all 0.2s", opacity: 0.7 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#e05c5c"; (e.currentTarget as HTMLButtonElement).style.color = "#e05c5c"; (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--primary)/0.15)"; (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"; (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
          >
            LOCK
          </button>
        </div>
      </div>

      <div style={{ height: "1px", background: "hsl(var(--primary)/0.12)", marginBottom: "28px" }} />

      {entries && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "5px 14px", background: "hsl(var(--primary)/0.08)", border: "1px solid hsl(var(--primary)/0.2)", borderRadius: "2px", marginBottom: "20px" }}>
          <span style={{ fontFamily: mono, fontSize: "22px", fontWeight: 700, color: gold }}>{entries.length}</span>
          <span style={{ fontFamily: mono, fontSize: "9px", letterSpacing: "0.2em", color: "hsl(var(--muted-foreground))" }}>
            {entries.length === 1 ? "SIGNUP" : "SIGNUPS"}
          </span>
        </div>
      )}

      {loading && <p style={{ fontFamily: mono, fontSize: "11px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.1em" }}>LOADING...</p>}
      {fetchError && <p style={{ fontFamily: mono, fontSize: "11px", color: "#e05c5c", letterSpacing: "0.1em" }}>Failed to load entries.</p>}

      {!loading && !fetchError && entries?.length === 0 && (
        <div style={{ padding: "48px 24px", border: "1px dashed hsl(var(--primary)/0.15)", borderRadius: "4px", textAlign: "center" }}>
          <p style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.1em" }}>No signups yet</p>
          <p style={{ fontFamily: mono, fontSize: "10px", color: "hsl(var(--muted-foreground))", opacity: 0.6, marginTop: "6px" }}>Share the landing page to collect emails</p>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div style={{ border: "1px solid hsl(var(--primary)/0.14)", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", padding: "8px 16px", background: "hsl(var(--primary)/0.06)", borderBottom: "1px solid hsl(var(--primary)/0.14)" }}>
            {["EMAIL", "JOINED"].map(h => (
              <span key={h} style={{ fontFamily: mono, fontSize: "8px", letterSpacing: "0.2em", color: "hsl(var(--muted-foreground))" }}>{h}</span>
            ))}
          </div>
          {entries.map((entry, i) => (
            <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "1fr 180px", padding: "12px 16px", background: i % 2 === 0 ? "transparent" : "hsl(var(--primary)/0.025)", borderBottom: i < entries.length - 1 ? "1px solid hsl(var(--primary)/0.08)" : "none" }}>
              <span style={{ fontFamily: mono, fontSize: "12px", color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.email}</span>
              <span style={{ fontFamily: mono, fontSize: "10px", color: "hsl(var(--muted-foreground))", letterSpacing: "0.04em" }}>{fmt(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontFamily: mono, fontSize: "9px", color: "hsl(var(--muted-foreground))", opacity: 0.5, marginTop: "20px", letterSpacing: "0.1em" }}>
        ADADIVE — waitlist data stored in your Replit PostgreSQL database
      </p>
    </div>
  );
}
