import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useJoinWaitlist } from "@workspace/api-client-react";
import logoUrl from "@assets/seedream-4.0_Hexagonal_gold_emblem_on_deep_black_background_bl_1780317486678.jpg";

/* ── Global styles for landing (scoped via class names) ── */
const G = `
  .adadive-land *, .adadive-land *::before, .adadive-land *::after { box-sizing: border-box; }
  .adadive-land { background: #05070f; color: #e8e0cc; font-family: 'Cormorant', serif; overflow-x: hidden; min-height: 100vh; }

  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #05070f; }
  ::-webkit-scrollbar-thumb { background: #c9a96e44; border-radius: 2px; }

  @keyframes adadiveFadeUp   { from { opacity:0; transform:translateY(32px); } to { opacity:1; transform:translateY(0); } }
  @keyframes adadiveFadeIn   { from { opacity:0; } to { opacity:1; } }
  @keyframes adadiveFloat    { 0%,100% { transform:translateY(0px) rotate(0deg); } 50% { transform:translateY(-14px) rotate(1deg); } }
  @keyframes adadiveRotate   { to { transform: rotate(360deg); } }
  @keyframes adadiveShimmer  { 0%,100% { opacity:.5; } 50% { opacity:1; } }
  @keyframes adadiveScanH    { 0% { top:-4px; } 100% { top:100%; } }
  @keyframes adadivePulse    { 0%,100% { transform:scale(1); opacity:.7; } 50% { transform:scale(1.12); opacity:1; } }
  @keyframes adadiveTicker   { 0% { transform:translateX(0); } 100% { transform:translateX(-50%); } }

  .afu  { animation: adadiveFadeUp .8s cubic-bezier(.22,1,.36,1) both; }
  .afi  { animation: adadiveFadeIn .6s ease both; }
  .ad1  { animation-delay: .1s; }
  .ad2  { animation-delay: .25s; }
  .ad3  { animation-delay: .4s; }
  .ad4  { animation-delay: .55s; }
  .ad5  { animation-delay: .7s; }

  .a-nav-link {
    font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.22em;
    color:#7a8aaa; cursor:pointer; transition:color .2s; text-decoration:none;
    background:none; border:none; padding:0;
  }
  .a-nav-link:hover { color:#c9a96e; }

  .a-stat-card {
    background: rgba(201,169,110,.04);
    border: 1px solid rgba(201,169,110,.14);
    border-radius: 4px; padding: 28px 24px;
    transition: border-color .25s, box-shadow .25s;
  }
  .a-stat-card:hover { border-color: rgba(201,169,110,.32); box-shadow: 0 0 24px rgba(201,169,110,.08); }

  .a-feature-card {
    background: rgba(255,255,255,.018);
    border: 1px solid rgba(201,169,110,.1);
    border-radius:6px; padding:32px 28px;
    transition: border-color .25s, transform .25s;
  }
  .a-feature-card:hover { border-color: rgba(201,169,110,.28); transform: translateY(-4px); }

  .a-token-card {
    background: rgba(201,169,110,.03);
    border: 1px solid rgba(201,169,110,.12);
    border-radius:6px; padding:28px;
    transition: all .25s;
  }
  .a-token-card:hover { border-color: rgba(201,169,110,.3); box-shadow: 0 4px 32px rgba(201,169,110,.07); }

  .a-btn-primary {
    font-family:'Cinzel',serif; font-size:11px; letter-spacing:.3em;
    padding:14px 40px; border-radius:2px; cursor:pointer;
    background: linear-gradient(135deg,rgba(201,169,110,.18),rgba(201,169,110,.08));
    border: 1px solid rgba(201,169,110,.55); color:#c9a96e; transition: all .25s;
  }
  .a-btn-primary:hover { background: rgba(201,169,110,.2); border-color:#c9a96e; box-shadow: 0 0 32px rgba(201,169,110,.18); }

  .a-btn-ghost {
    font-family:'Cinzel',serif; font-size:11px; letter-spacing:.3em;
    padding:14px 40px; border-radius:2px; cursor:pointer;
    background: transparent; border: 1px solid rgba(201,169,110,.22);
    color:#7a8aaa; transition: all .25s;
  }
  .a-btn-ghost:hover { color:#c9a96e; border-color:rgba(201,169,110,.5); }

  .a-divider { display:flex; align-items:center; gap:16px; margin: 0 auto; width:fit-content; }
  .a-divider-line { height:1px; width:48px; background:linear-gradient(90deg,transparent,rgba(201,169,110,.4)); }
  .a-divider-line.r { background:linear-gradient(90deg,rgba(201,169,110,.4),transparent); }

  .a-ticker-wrap { overflow:hidden; width:100%; border-top:1px solid rgba(201,169,110,.08); border-bottom:1px solid rgba(201,169,110,.08); padding:10px 0; }
  .a-ticker-inner { display:flex; animation:adadiveTicker 28s linear infinite; white-space:nowrap; }
  .a-ticker-item  { font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.14em; color:#3a4560; padding:0 32px; border-right:1px solid rgba(201,169,110,.08); }
  .a-ticker-item span { color:#c9a96e; margin-right:8px; }

  /* Mobile nav responsive */
  @media (max-width: 640px) {
    .a-nav-desktop { display: none !important; }
    .a-nav-mobile  { display: flex !important; }
  }
  @media (min-width: 641px) {
    .a-nav-desktop { display: flex; }
    .a-nav-mobile  { display: none !important; }
  }
`;

const T = {
  gold: "#c9a96e", goldLt:"#e8c98a", goldDk:"#8a6732",
  ink: "#05070f",  inkMid:"#0a0e1a",
  mist:"#2a3350",  smoke:"#7a8aaa",   snow:"#e8e0cc",
};

const Ornament = () => (
  <div className="a-divider">
    <div className="a-divider-line" />
    <span style={{ color:T.gold, fontSize:"14px", opacity:.6, animation:"adadiveShimmer 3s ease infinite" }}>✦</span>
    <div className="a-divider-line r" />
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", letterSpacing:".3em", color:T.gold, opacity:.6, marginBottom:"12px", textTransform:"uppercase" as const }}>
    {children}
  </div>
);

const Logo = ({ size = 36 }: { size?: number }) => (
  <img
    src={logoUrl}
    alt="ADADIVE"
    style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, borderRadius: "4px" }}
  />
);

export default function Landing() {
  const [, setLocation] = useLocation();
  const goApp   = () => setLocation("/app");
  const goToken = () => setLocation("/token");

  const [email, setEmail]       = useState("");
  const [subState, setSubState] = useState<"idle" | "loading" | "done" | "duplicate">("idle");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => { document.title = "ADADIVE — Decentralised Storage on Cardano"; }, []);

  const joinMutation = useJoinWaitlist();

  const handleWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || subState !== "idle") return;
    setSubState("loading");
    joinMutation.mutate(
      { data: { email: email.trim() } },
      {
        onSuccess: () => setSubState("done"),
        onError: (err: unknown) => {
          const status = (err as { status?: number })?.status;
          if (status === 409) { setSubState("duplicate"); }
          else { setSubState("idle"); }
        },
      },
    );
  };

  return (
    <div className="adadive-land">
      <style>{G}</style>

      {/* Background grid */}
      <div style={{ position:"fixed", inset:0, backgroundImage:`linear-gradient(rgba(201,169,110,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(201,169,110,.028) 1px,transparent 1px)`, backgroundSize:"56px 56px", pointerEvents:"none", zIndex:0 }} />
      {/* Scanline */}
      <div style={{ position:"fixed", left:0, right:0, height:"3px", background:"linear-gradient(transparent,rgba(201,169,110,.05),transparent)", animation:"adadiveScanH 12s linear infinite", zIndex:1, pointerEvents:"none" }} />
      {/* Orbs */}
      <div style={{ position:"fixed", top:"-15%", left:"50%", transform:"translateX(-50%)", width:"900px", height:"900px", borderRadius:"50%", background:"radial-gradient(ellipse,rgba(201,169,110,.055) 0%,transparent 65%)", pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"fixed", bottom:"-20%", right:"-10%", width:"500px", height:"500px", borderRadius:"50%", background:"radial-gradient(ellipse,rgba(0,180,120,.04) 0%,transparent 65%)", pointerEvents:"none", zIndex:0 }} />

      {/* ─── NAV ─── */}
      <nav style={{ position:"sticky", top:0, zIndex:50, backdropFilter:"blur(14px)", background:"rgba(5,7,15,.85)", borderBottom:"1px solid rgba(201,169,110,.09)", height:"60px", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 clamp(16px,4vw,48px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <Logo size={32} />
          <div>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:"13px", letterSpacing:".35em", color:T.gold, lineHeight:1.1 }}>ADADIVE</div>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"8px", letterSpacing:".2em", color:T.smoke, opacity:.6 }}>by THETA · powered by THT</div>
          </div>
        </div>

        {/* Desktop nav */}
        <div className="a-nav-desktop" style={{ gap:"28px", alignItems:"center" }}>
          {["Protocol","Providers","Deals"].map(n => <button key={n} className="a-nav-link" onClick={goApp}>{n}</button>)}
          <button className="a-nav-link" onClick={goToken} style={{ color:T.gold, opacity:.85 }}>THT Token</button>
          <a href="https://discord.gg/ESj96hvhuR" target="_blank" rel="noopener noreferrer" className="a-nav-link" style={{ color:"#5865F2" }}>Discord</a>
          <button className="a-btn-primary" style={{ padding:"8px 22px", fontSize:"10px" }} onClick={goApp}>Launch App</button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="a-nav-mobile"
          onClick={() => setMobileMenuOpen(v => !v)}
          style={{ background:"none", border:`1px solid rgba(201,169,110,.25)`, color:T.gold, cursor:"pointer", padding:"6px 10px", borderRadius:"2px", fontSize:"14px" }}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </nav>

      {/* Mobile menu drawer */}
      {mobileMenuOpen && (
        <div style={{ position:"fixed", top:"60px", left:0, right:0, zIndex:49, background:"rgba(5,7,15,.97)", borderBottom:"1px solid rgba(201,169,110,.12)", padding:"20px 24px", display:"flex", flexDirection:"column", gap:"18px" }}>
          {["Protocol","Providers","Deals"].map(n => <button key={n} className="a-nav-link" onClick={() => { goApp(); setMobileMenuOpen(false); }} style={{ textAlign:"left", fontSize:"12px" }}>{n}</button>)}
          <button className="a-nav-link" onClick={() => { goToken(); setMobileMenuOpen(false); }} style={{ textAlign:"left", fontSize:"12px", color:T.gold }}>THT Token</button>
          <a href="https://discord.gg/ESj96hvhuR" target="_blank" rel="noopener noreferrer" className="a-nav-link" style={{ fontSize:"12px", color:"#5865F2" }}>Discord Server ↗</a>
          <button className="a-btn-primary" style={{ padding:"10px 20px", fontSize:"10px", width:"fit-content" }} onClick={() => { goApp(); setMobileMenuOpen(false); }}>Launch App</button>
        </div>
      )}

      {/* ─── HERO ─── */}
      <section style={{ position:"relative", zIndex:10, minHeight:"calc(100vh - 60px)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"80px clamp(16px,5vw,48px)" }}>
        {/* Live badge */}
        <div className="afu" style={{ display:"inline-flex", alignItems:"center", gap:"10px", border:"1px solid rgba(201,169,110,.2)", borderRadius:"100px", padding:"6px 20px", marginBottom:"40px" }}>
          <span style={{ width:"6px", height:"6px", borderRadius:"50%", background:"#00ffa3", display:"block", animation:"adadivePulse 2s infinite" }} />
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", letterSpacing:".22em", color:T.smoke }}>LIVE ON CARDANO PREPROD · 36.00 TB ONLINE</span>
        </div>

        <h1 className="afu ad1" style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(32px,7vw,88px)", fontWeight:600, lineHeight:1.08, letterSpacing:"-.01em", marginBottom:"6px" }}>
          <span style={{ background:`linear-gradient(160deg,${T.goldLt} 0%,${T.gold} 45%,${T.goldDk} 100%)`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
            DECENTRALISED
          </span>
        </h1>
        <h1 className="afu ad2" style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(32px,7vw,88px)", fontWeight:600, lineHeight:1.08, letterSpacing:"-.01em", marginBottom:"32px", color:T.snow, opacity:.9 }}>
          STORAGE ECONOMY
        </h1>

        <p className="afu ad3" style={{ fontStyle:"italic", fontWeight:300, fontSize:"clamp(16px,2.2vw,22px)", color:T.smoke, maxWidth:"520px", lineHeight:1.75, marginBottom:"16px" }}>
          A peer-to-peer storage marketplace where providers earn <em style={{ color:T.gold }}>THT</em> and users pay in the same token — all settled on Cardano.
        </p>

        <div className="afu ad3" style={{ marginBottom:"48px" }}><Ornament /></div>

        <div className="afu ad4" style={{ display:"flex", gap:"16px", flexWrap:"wrap", justifyContent:"center" }}>
          <button className="a-btn-primary" onClick={goApp}>EXPLORE NETWORK</button>
          <button className="a-btn-ghost" onClick={goToken}>THT TOKEN ↗</button>
        </div>

        {/* Stats row */}
        <div className="afu ad5" style={{ display:"flex", gap:"clamp(20px,5vw,48px)", marginTop:"80px", flexWrap:"wrap", justifyContent:"center" }}>
          {[["36 TB","Total Storage"],["6","Active Deals"],["19,602","THT Locked"],["5","Providers"],["0.0013 THT","per GB / Epoch"]].map(([v,l]) => (
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(18px,3vw,28px)", color:T.gold, marginBottom:"4px", fontWeight:500 }}>{v}</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", letterSpacing:".15em", color:T.mist }}>{(l as string).toUpperCase()}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Ticker */}
      <div className="a-ticker-wrap">
        <div className="a-ticker-inner">
          {[...Array(2)].map((_,ri) =>
            ["ArkNode Alpha","StorageIO Prime","NileStore","DedaloVault","QuantumVault EU"].map(p => (
              <div key={`${p}-${ri}`} className="a-ticker-item"><span>◆</span>{p} — ACTIVE</div>
            ))
          )}
        </div>
      </div>

      {/* ─── HOW IT WORKS ─── */}
      <section style={{ position:"relative", zIndex:10, padding:"100px clamp(16px,4vw,48px)", maxWidth:"1100px", margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:"64px" }}>
          <SectionLabel>Protocol</SectionLabel>
          <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(24px,4vw,40px)", color:T.snow, marginBottom:"16px", letterSpacing:".02em" }}>How ADADIVE Works</h2>
          <p style={{ fontStyle:"italic", color:T.smoke, fontSize:"18px", fontWeight:300, maxWidth:"480px", margin:"0 auto" }}>
            A three-sided economy of storage, deals, and settlement.
          </p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:"20px" }}>
          {[
            { n:"01", icon:"◈", title:"Providers Register", body:"Storage providers stake THT and register their capacity on-chain. Staking signals commitment and earns reputation over epochs." },
            { n:"02", icon:"◉", title:"Users Create Deals",  body:"Users browse providers, select storage capacity and duration, then lock THT into escrow. The deal is anchored to the Cardano ledger." },
            { n:"03", icon:"◆", title:"Data is Pinned",      body:"Files are content-addressed and pinned. The CID is recorded in Cardano metadata, creating a permanent, verifiable proof of storage." },
            { n:"04", icon:"✦", title:"THT is Released",     body:"On successful epoch proofs, escrowed THT flows to the provider. Failed proofs trigger slashing — keeping providers honest." },
          ].map(c => (
            <div key={c.n} className="a-feature-card">
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", letterSpacing:".2em", color:T.mist }}>{c.n}</span>
                <span style={{ fontSize:"20px", color:T.gold, opacity:.6 }}>{c.icon}</span>
              </div>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:"14px", letterSpacing:".12em", color:T.gold, marginBottom:"12px" }}>{c.title}</div>
              <p style={{ fontSize:"15px", color:T.smoke, lineHeight:1.75, fontWeight:300 }}>{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── LIVE STATS ─── */}
      <section style={{ position:"relative", zIndex:10, padding:"80px clamp(16px,4vw,48px)", background:"rgba(201,169,110,.02)", borderTop:"1px solid rgba(201,169,110,.07)", borderBottom:"1px solid rgba(201,169,110,.07)" }}>
        <div style={{ maxWidth:"1100px", margin:"0 auto" }}>
          <div style={{ textAlign:"center", marginBottom:"48px" }}>
            <SectionLabel>Live Telemetry</SectionLabel>
            <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(22px,3.5vw,36px)", color:T.snow, letterSpacing:".02em" }}>Network Overview</h2>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:"16px" }}>
            {[
              { label:"Total Storage", value:"36.00 TB",   sub:"35% Utilised",         icon:"▣" },
              { label:"Active Deals",  value:"6",          sub:"10 All Time",           icon:"⬡" },
              { label:"THT Locked",    value:"19,602.5",   sub:"In Active Escrow",      icon:"◈" },
              { label:"Avg Price",     value:"0.0013 THT", sub:"per GB / Epoch",        icon:"∿" },
              { label:"Providers",     value:"5",          sub:"4 Active · 1 Inactive", icon:"◉" },
            ].map(s => (
              <div key={s.label} className="a-stat-card" style={{ textAlign:"center" }}>
                <div style={{ fontSize:"20px", color:T.gold, opacity:.5, marginBottom:"12px" }}>{s.icon}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", letterSpacing:".18em", color:T.mist, marginBottom:"8px" }}>{s.label.toUpperCase()}</div>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(18px,3vw,26px)", color:T.gold, marginBottom:"4px" }}>{s.value}</div>
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", color:T.mist, opacity:.7 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── THT TEASER ─── */}
      <section style={{ position:"relative", zIndex:10, padding:"100px clamp(16px,4vw,48px)", maxWidth:"900px", margin:"0 auto", textAlign:"center" }}>
        <SectionLabel>Native Token</SectionLabel>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:"24px" }}>
          <div style={{ position:"relative", animation:"adadiveFloat 6s ease-in-out infinite" }}>
            <Logo size={88} />
            <div style={{ position:"absolute", inset:"-14px", borderRadius:"50%", border:"1px solid rgba(201,169,110,.15)", animation:"adadiveRotate 20s linear infinite" }} />
            <div style={{ position:"absolute", inset:"-26px", borderRadius:"50%", border:"1px solid rgba(201,169,110,.06)", animation:"adadiveRotate 35s linear infinite reverse" }} />
          </div>
        </div>
        <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(24px,4vw,44px)", color:T.gold, marginBottom:"8px", letterSpacing:".04em" }}>THT Token</h2>
        <p style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", letterSpacing:".2em", color:T.mist, marginBottom:"24px" }}>THETA · NATIVE CARDANO TOKEN</p>
        <p style={{ fontStyle:"italic", fontSize:"18px", color:T.smoke, lineHeight:1.8, maxWidth:"520px", margin:"0 auto 40px", fontWeight:300 }}>
          THT is the lifeblood of the ADADIVE economy — used to pay for storage, reward providers, and govern the protocol.
        </p>
        <button className="a-btn-primary" onClick={goToken}>EXPLORE THT TOKEN →</button>
      </section>

      {/* ─── COMMUNITY — Waitlist + Discord ─── */}
      <section style={{ position:"relative", zIndex:10, padding:"80px clamp(16px,4vw,48px)", borderTop:"1px solid rgba(201,169,110,.07)", borderBottom:"1px solid rgba(201,169,110,.07)" }}>
        <div style={{ maxWidth:"900px", margin:"0 auto" }}>
          <div style={{ textAlign:"center", marginBottom:"56px" }}>
            <SectionLabel>Community</SectionLabel>
            <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(22px,4vw,40px)", color:T.snow, marginBottom:"12px", letterSpacing:".02em" }}>Join the Movement</h2>
            <p style={{ fontStyle:"italic", fontSize:"17px", color:T.smoke, fontWeight:300 }}>Be the first to know when ADADIVE launches on mainnet.</p>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:"24px" }}>

            {/* Waitlist card */}
            <div style={{ background:"rgba(201,169,110,.03)", border:"1px solid rgba(201,169,110,.15)", borderRadius:"8px", padding:"36px 32px" }}>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:"11px", letterSpacing:".35em", color:T.gold, marginBottom:"8px", opacity:.8 }}>WAITLIST</div>
              <h3 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(18px,3vw,24px)", color:T.snow, marginBottom:"12px" }}>Early Access</h3>
              <p style={{ fontSize:"14px", color:T.smoke, lineHeight:1.7, fontWeight:300, marginBottom:"28px" }}>
                Reserve your spot before public launch. Early members receive priority onboarding and a THT allocation bonus.
              </p>

              {subState === "done" ? (
                <div style={{ textAlign:"center", padding:"20px 0" }}>
                  <div style={{ fontSize:"28px", color:T.gold, marginBottom:"10px", animation:"adadivePulse 2s infinite" }}>◆</div>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:"13px", letterSpacing:".22em", color:T.gold, marginBottom:"6px" }}>YOU'RE ON THE LIST</div>
                  <p style={{ fontFamily:"'DM Mono',monospace", fontSize:"10px", color:T.smoke }}>We'll reach out at {email}</p>
                </div>
              ) : subState === "duplicate" ? (
                <div style={{ textAlign:"center", padding:"20px 0" }}>
                  <div style={{ fontSize:"22px", color:T.gold, marginBottom:"10px" }}>◇</div>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:"13px", letterSpacing:".22em", color:T.gold, marginBottom:"6px" }}>ALREADY REGISTERED</div>
                  <p style={{ fontFamily:"'DM Mono',monospace", fontSize:"10px", color:T.smoke }}>{email} is already on the waitlist</p>
                </div>
              ) : (
                <form onSubmit={handleWaitlist} style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    style={{
                      background:"rgba(255,255,255,.04)", border:"1px solid rgba(201,169,110,.22)",
                      borderRadius:"2px", padding:"12px 16px", color:T.snow,
                      fontFamily:"'DM Mono',monospace", fontSize:"12px", letterSpacing:".06em",
                      outline:"none", transition:"border-color .2s", width:"100%",
                    }}
                    onFocus={e => (e.target.style.borderColor = "rgba(201,169,110,.6)")}
                    onBlur={e => (e.target.style.borderColor = "rgba(201,169,110,.22)")}
                  />
                  <button
                    type="submit"
                    disabled={subState === "loading"}
                    className="a-btn-primary"
                    style={{ padding:"12px 24px", width:"100%", opacity: subState === "loading" ? 0.7 : 1 }}
                  >
                    {subState === "loading" ? "SUBMITTING..." : "JOIN WAITLIST"}
                  </button>
                </form>
              )}
            </div>

            {/* Discord card */}
            <div style={{ background:"rgba(88,101,242,.06)", border:"1px solid rgba(88,101,242,.25)", borderRadius:"8px", padding:"36px 32px", display:"flex", flexDirection:"column" }}>
              {/* Discord wordmark */}
              <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"16px" }}>
                <svg width="28" height="22" viewBox="0 0 71 55" fill="none">
                  <path d="M60.1 4.9A58.5 58.5 0 0 0 45.6.7a.2.2 0 0 0-.2.1c-.6 1.1-1.3 2.6-1.8 3.8a54 54 0 0 0-16.2 0A38 38 0 0 0 25.6.8a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.9 4.9a.2.2 0 0 0-.1.1C1.6 18.2-.9 31.1.3 43.8v.1a58.9 58.9 0 0 0 17.9 9.1.2.2 0 0 0 .2-.1c1.4-1.9 2.6-3.9 3.7-6a.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4l1.1-.8a.2.2 0 0 1 .2 0c11.5 5.3 24 5.3 35.4 0a.2.2 0 0 1 .2 0l1.1.8a.2.2 0 0 1 0 .4 36 36 0 0 1-5.5 2.6.2.2 0 0 0-.1.3c1.1 2.1 2.3 4.1 3.7 6a.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.9-9.1v-.1c1.5-15.4-2.5-28.2-10.6-39.8a.2.2 0 0 0-.1-.1zM23.7 36.2c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2z" fill="#5865F2"/>
                </svg>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:"13px", letterSpacing:".25em", color:"#8b9cf4" }}>DISCORD</div>
              </div>

              <h3 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(18px,3vw,24px)", color:T.snow, marginBottom:"12px" }}>ADADIVE Community</h3>
              <p style={{ fontSize:"14px", color:T.smoke, lineHeight:1.7, fontWeight:300, marginBottom:"28px", flex:1 }}>
                Chat with the team, get support, discuss the protocol, and stay updated on development milestones and testnet announcements.
              </p>

              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {[
                  ["#announcements", "Protocol updates & launches"],
                  ["#testnet",       "Preprod testing & feedback"],
                  ["#providers",     "Provider onboarding help"],
                ].map(([ch, desc]) => (
                  <div key={ch} style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"10px", color:"#8b9cf4", letterSpacing:".06em" }}>{ch}</span>
                    <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", color:T.mist }}>— {desc}</span>
                  </div>
                ))}
              </div>

              <a
                href="https://discord.gg/ESj96hvhuR"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display:"block", marginTop:"28px", textAlign:"center",
                  padding:"13px 24px", borderRadius:"2px", cursor:"pointer",
                  background:"rgba(88,101,242,.15)", border:"1px solid rgba(88,101,242,.45)",
                  color:"#8b9cf4", fontFamily:"'Cinzel',serif", fontSize:"11px",
                  letterSpacing:".28em", textDecoration:"none", transition:"all .25s",
                }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.background = "rgba(88,101,242,.25)"; el.style.borderColor = "#5865F2"; el.style.color = "#c5cbff"; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.background = "rgba(88,101,242,.15)"; el.style.borderColor = "rgba(88,101,242,.45)"; el.style.color = "#8b9cf4"; }}
              >
                JOIN SERVER ↗
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA BAND ─── */}
      <section style={{ position:"relative", zIndex:10, padding:"80px clamp(16px,4vw,48px)", background:`linear-gradient(135deg,rgba(201,169,110,.06) 0%,rgba(201,169,110,.02) 100%)`, borderTop:"1px solid rgba(201,169,110,.1)", textAlign:"center" }}>
        <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(22px,4vw,40px)", color:T.snow, marginBottom:"16px", letterSpacing:".03em" }}>Ready to Store on Cardano?</h2>
        <p style={{ fontStyle:"italic", fontSize:"17px", color:T.smoke, marginBottom:"40px", fontWeight:300 }}>Connect your Eternl wallet and create your first deal in minutes.</p>
        <div style={{ display:"flex", gap:"16px", justifyContent:"center", flexWrap:"wrap" }}>
          <button className="a-btn-primary" onClick={goApp}>OPEN APP →</button>
          <a href="https://discord.gg/ESj96hvhuR" target="_blank" rel="noopener noreferrer" className="a-btn-ghost" style={{ display:"inline-flex", alignItems:"center", gap:"8px", textDecoration:"none" }}>
            <svg width="16" height="12" viewBox="0 0 71 55" fill="none"><path d="M60.1 4.9A58.5 58.5 0 0 0 45.6.7a.2.2 0 0 0-.2.1c-.6 1.1-1.3 2.6-1.8 3.8a54 54 0 0 0-16.2 0A38 38 0 0 0 25.6.8a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.9 4.9a.2.2 0 0 0-.1.1C1.6 18.2-.9 31.1.3 43.8v.1a58.9 58.9 0 0 0 17.9 9.1.2.2 0 0 0 .2-.1c1.4-1.9 2.6-3.9 3.7-6a.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4l1.1-.8a.2.2 0 0 1 .2 0c11.5 5.3 24 5.3 35.4 0a.2.2 0 0 1 .2 0l1.1.8a.2.2 0 0 1 0 .4 36 36 0 0 1-5.5 2.6.2.2 0 0 0-.1.3c1.1 2.1 2.3 4.1 3.7 6a.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.9-9.1v-.1c1.5-15.4-2.5-28.2-10.6-39.8a.2.2 0 0 0-.1-.1zM23.7 36.2c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2z" fill="#7a8aaa"/></svg>
            JOIN DISCORD
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ position:"relative", zIndex:10, borderTop:"1px solid rgba(201,169,110,.07)", padding:"32px clamp(16px,4vw,48px)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"16px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <Logo size={22} />
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:"11px", letterSpacing:".3em", color:T.gold, opacity:.6 }}>ADADIVE</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", color:T.mist }}>by THETA · powered by THT</span>
        </div>
        <div style={{ display:"flex", gap:"20px", flexWrap:"wrap" }}>
          {["Protocol","Providers","Deals","Pin Files"].map(l => (
            <button key={l} className="a-nav-link" onClick={goApp}>{l}</button>
          ))}
          <button className="a-nav-link" onClick={goToken}>THT Token</button>
          <a href="https://discord.gg/ESj96hvhuR" target="_blank" rel="noopener noreferrer" className="a-nav-link" style={{ color:"#5865F2" }}>Discord</a>
        </div>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", color:T.mist, opacity:.5 }}>PREPROD TESTNET · BUILD 0.1.0-α</span>
      </footer>
    </div>
  );
}
