import { useEffect } from "react";
import { useLocation } from "wouter";
import logoUrl from "@assets/seedream-4.0_Hexagonal_gold_emblem_on_deep_black_background_bl_1780317486678.jpg";

const T = {
  gold: "#c9a96e", goldLt:"#e8c98a", goldDk:"#8a6732",
  ink: "#05070f",
  mist:"#2a3350",  smoke:"#7a8aaa",  snow:"#e8e0cc",
};

const G = `
  .adadive-token *, .adadive-token *::before, .adadive-token *::after { box-sizing: border-box; }
  .adadive-token { background:#05070f; color:#e8e0cc; font-family:'Cormorant',serif; overflow-x:hidden; min-height:100vh; }

  @keyframes tFloat  { 0%,100%{transform:translateY(0)rotate(0)} 50%{transform:translateY(-14px)rotate(1deg)} }
  @keyframes tRotate { to{transform:rotate(360deg)} }
  @keyframes tShimmer{ 0%,100%{opacity:.5} 50%{opacity:1} }
  @keyframes tFadeUp { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }

  .tfu { animation:tFadeUp .8s cubic-bezier(.22,1,.36,1) both; }
  .td1 { animation-delay:.1s; } .td2 { animation-delay:.25s; } .td3 { animation-delay:.4s; }

  .t-nav-link { font-family:'DM Mono',monospace; font-size:10px; letter-spacing:.22em; color:#7a8aaa; cursor:pointer; transition:color .2s; background:none; border:none; padding:0; text-decoration:none; }
  .t-nav-link:hover { color:#c9a96e; }

  .t-btn-primary { font-family:'Cinzel',serif; font-size:11px; letter-spacing:.3em; padding:12px 36px; border-radius:2px; cursor:pointer; background:linear-gradient(135deg,rgba(201,169,110,.18),rgba(201,169,110,.08)); border:1px solid rgba(201,169,110,.55); color:#c9a96e; transition:all .25s; }
  .t-btn-primary:hover { background:rgba(201,169,110,.2); border-color:#c9a96e; box-shadow:0 0 32px rgba(201,169,110,.18); }
  .t-btn-ghost  { font-family:'Cinzel',serif; font-size:11px; letter-spacing:.3em; padding:12px 36px; border-radius:2px; cursor:pointer; background:transparent; border:1px solid rgba(201,169,110,.22); color:#7a8aaa; transition:all .25s; }
  .t-btn-ghost:hover  { color:#c9a96e; border-color:rgba(201,169,110,.5); }

  .t-feature-card { background:rgba(255,255,255,.018); border:1px solid rgba(201,169,110,.1); border-radius:6px; padding:28px 24px; transition:border-color .25s,transform .25s; }
  .t-feature-card:hover { border-color:rgba(201,169,110,.28); transform:translateY(-4px); }
  .t-token-card  { background:rgba(201,169,110,.03); border:1px solid rgba(201,169,110,.12); border-radius:6px; padding:24px; transition:all .25s; }
  .t-token-card:hover  { border-color:rgba(201,169,110,.3); box-shadow:0 4px 32px rgba(201,169,110,.07); }

  .t-divider { display:flex; align-items:center; gap:16px; margin:0 auto; width:fit-content; }
  .t-divider-line { height:1px; width:48px; background:linear-gradient(90deg,transparent,rgba(201,169,110,.4)); }
  .t-divider-line.r { background:linear-gradient(90deg,rgba(201,169,110,.4),transparent); }
`;

const Ornament = () => (
  <div className="t-divider">
    <div className="t-divider-line" />
    <span style={{ color:T.gold, fontSize:"14px", opacity:.6, animation:"tShimmer 3s ease infinite" }}>✦</span>
    <div className="t-divider-line r" />
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", letterSpacing:".3em", color:T.gold, opacity:.6, marginBottom:"12px", textTransform:"uppercase" as const }}>{children}</div>
);

const Logo = ({ size = 36 }: { size?: number }) => (
  <img src={logoUrl} alt="ADADIVE" style={{ width:size, height:size, objectFit:"contain", flexShrink:0, borderRadius:"4px" }} />
);

export default function TokenPage() {
  const [, setLocation] = useLocation();
  const goLanding = () => setLocation("/");
  const goApp     = () => setLocation("/app");

  useEffect(() => { document.title = "THT Token — ADADIVE"; }, []);

  const SUPPLY = 100_000_000;
  const LOCKED  = 19602.5;
  const PRICE   = 0.0013;

  const dist = [
    { label:"Community Rewards", pct:40, color:T.gold    },
    { label:"Protocol Reserve",  pct:25, color:"#e8c98a" },
    { label:"Team & Advisors",   pct:15, color:"#8a6732" },
    { label:"Ecosystem Grants",  pct:12, color:"#5a4020" },
    { label:"Initial Liquidity", pct:8,  color:"#3a2a10" },
  ];

  const DonutChart = () => {
    const r = 70, cx = 90, cy = 90, stroke = 28;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const slices = dist.map(d => {
      const len = (d.pct / 100) * circ;
      const s = { ...d, dash:`${len} ${circ - len}`, offset };
      offset += len;
      return s;
    });
    return (
      <svg viewBox="0 0 180 180" width="180" height="180" style={{ overflow:"visible" }}>
        {slices.map(s => (
          <circle key={s.label} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={stroke} strokeDasharray={s.dash}
            strokeDashoffset={-s.offset} transform={`rotate(-90 ${cx} ${cy})`} opacity={.85} />
        ))}
        <text x={cx} y={cy-8}  textAnchor="middle" fill={T.gold}  fontSize="13" fontFamily="Cinzel,serif" fontWeight="600">THT</text>
        <text x={cx} y={cy+10} textAnchor="middle" fill={T.smoke} fontSize="8"  fontFamily="DM Mono,monospace" letterSpacing="1">100M</text>
        <text x={cx} y={cy+22} textAnchor="middle" fill={T.mist}  fontSize="7"  fontFamily="DM Mono,monospace">SUPPLY</text>
      </svg>
    );
  };

  return (
    <div className="adadive-token">
      <style>{G}</style>

      <div style={{ position:"fixed", inset:0, backgroundImage:`linear-gradient(rgba(201,169,110,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(201,169,110,.025) 1px,transparent 1px)`, backgroundSize:"56px 56px", pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"fixed", top:"-20%", left:"50%", transform:"translateX(-50%)", width:"700px", height:"700px", borderRadius:"50%", background:"radial-gradient(ellipse,rgba(201,169,110,.06) 0%,transparent 65%)", pointerEvents:"none", zIndex:0 }} />

      {/* NAV */}
      <nav style={{ position:"sticky", top:0, zIndex:50, backdropFilter:"blur(14px)", background:"rgba(5,7,15,.85)", borderBottom:"1px solid rgba(201,169,110,.09)", height:"60px", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 clamp(16px,4vw,48px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <button onClick={goLanding} style={{ background:"none", border:"none", color:T.smoke, cursor:"pointer", fontSize:"18px", padding:"4px 8px 4px 0", transition:"color .2s" }} onMouseEnter={e=>(e.currentTarget.style.color=T.gold)} onMouseLeave={e=>(e.currentTarget.style.color=T.smoke)}>←</button>
          <Logo size={28} />
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:"12px", letterSpacing:".35em", color:T.gold }}>ADADIVE</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", color:T.mist, opacity:.6 }}>/ THT TOKEN</span>
        </div>
        <div style={{ display:"flex", gap:"24px", alignItems:"center" }}>
          <button className="t-nav-link" onClick={goLanding}>Home</button>
          <button className="t-nav-link" onClick={goApp}>App</button>
          <button className="t-btn-primary" style={{ padding:"8px 22px", fontSize:"10px" }} onClick={goApp}>Launch App</button>
        </div>
      </nav>

      <main style={{ position:"relative", zIndex:10, maxWidth:"1060px", margin:"0 auto", padding:"80px clamp(16px,4vw,32px)" }}>

        {/* HERO */}
        <div className="tfu" style={{ textAlign:"center", marginBottom:"80px" }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:"32px" }}>
            <div style={{ position:"relative", animation:"tFloat 6s ease-in-out infinite" }}>
              <Logo size={96} />
              <div style={{ position:"absolute", inset:"-16px", borderRadius:"50%", border:"1px solid rgba(201,169,110,.18)", animation:"tRotate 22s linear infinite" }} />
              <div style={{ position:"absolute", inset:"-30px", borderRadius:"50%", border:"1px solid rgba(201,169,110,.07)", animation:"tRotate 38s linear infinite reverse" }} />
            </div>
          </div>
          <SectionLabel>Native Cardano Token</SectionLabel>
          <h1 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(40px,8vw,80px)", fontWeight:600, lineHeight:1, letterSpacing:".04em", marginBottom:"12px" }}>
            <span style={{ background:`linear-gradient(160deg,${T.goldLt},${T.gold},${T.goldDk})`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>THT</span>
          </h1>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"10px", letterSpacing:".25em", color:T.mist, marginBottom:"20px" }}>THETA TOKEN · POLICY ID: theta1q9...f7a2 (testnet)</div>
          <p className="tfu td2" style={{ fontStyle:"italic", fontSize:"clamp(15px,2vw,20px)", color:T.smoke, maxWidth:"560px", margin:"0 auto 32px", lineHeight:1.8, fontWeight:300 }}>
            The utility token powering every storage deal, provider stake, and governance vote on the ADADIVE protocol.
          </p>
          <div className="tfu td3"><Ornament /></div>
        </div>

        {/* KEY METRICS */}
        <div className="tfu td1" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:"14px", marginBottom:"80px" }}>
          {[
            { label:"Total Supply",     value:"100,000,000", unit:"THT"              },
            { label:"Current Price",    value:`${PRICE}`,    unit:"THT / GB·Epoch"   },
            { label:"Locked in Escrow", value:"19,602.5",    unit:"THT"              },
            { label:"Circulating",      value:"~4.2M",       unit:"THT (est.)"       },
            { label:"Network",          value:"Cardano",     unit:"Preprod Testnet"  },
          ].map(m => (
            <div key={m.label} className="t-token-card" style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"8px", letterSpacing:".2em", color:T.mist, marginBottom:"10px" }}>{m.label.toUpperCase()}</div>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(16px,2.5vw,24px)", color:T.gold, marginBottom:"4px" }}>{m.value}</div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"8px", color:T.mist, opacity:.7, letterSpacing:".1em" }}>{m.unit}</div>
            </div>
          ))}
        </div>

        {/* UTILITY */}
        <div style={{ marginBottom:"80px" }}>
          <div style={{ textAlign:"center", marginBottom:"48px" }}>
            <SectionLabel>Token Utility</SectionLabel>
            <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(22px,3.5vw,36px)", color:T.snow, letterSpacing:".02em" }}>What THT Powers</h2>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:"16px" }}>
            {[
              { icon:"◈", title:"Storage Payment", body:"Users lock THT into escrow to pay for storage deals. Funds release to providers per epoch upon successful proof of storage." },
              { icon:"◆", title:"Provider Staking", body:"Providers stake THT to register on the network. Higher stakes unlock larger deal sizes and build on-chain reputation." },
              { icon:"◉", title:"Deal Collateral",  body:"Both sides lock THT. Providers who fail proof verification are slashed — aligning incentives for reliable storage." },
              { icon:"✦", title:"Governance",       body:"THT holders vote on protocol upgrades, pricing parameters, and new provider onboarding criteria via on-chain governance." },
              { icon:"∿", title:"Fee Burning",      body:"A portion of every deal fee is burned, creating deflationary pressure on supply as network usage grows." },
              { icon:"⬡", title:"Epoch Rewards",    body:"Providers earn bonus THT rewards each epoch based on uptime, deal volume, and proof reliability scores." },
            ].map(c => (
              <div key={c.title} className="t-feature-card">
                <div style={{ fontSize:"22px", color:T.gold, opacity:.55, marginBottom:"16px" }}>{c.icon}</div>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:"13px", letterSpacing:".12em", color:T.gold, marginBottom:"10px" }}>{c.title}</div>
                <p style={{ fontSize:"14px", color:T.smoke, lineHeight:1.8, fontWeight:300 }}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* DISTRIBUTION */}
        <div style={{ marginBottom:"80px", background:"rgba(201,169,110,.02)", border:"1px solid rgba(201,169,110,.1)", borderRadius:"8px", padding:"clamp(24px,4vw,48px)" }}>
          <div style={{ textAlign:"center", marginBottom:"40px" }}>
            <SectionLabel>Tokenomics</SectionLabel>
            <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(20px,3vw,32px)", color:T.snow, letterSpacing:".02em" }}>Supply Distribution</h2>
          </div>
          <div style={{ display:"flex", gap:"48px", alignItems:"center", justifyContent:"center", flexWrap:"wrap" }}>
            <DonutChart />
            <div style={{ display:"flex", flexDirection:"column", gap:"12px", minWidth:"200px" }}>
              {dist.map(d => (
                <div key={d.label} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                  <div style={{ width:"10px", height:"10px", borderRadius:"2px", background:d.color, flexShrink:0 }} />
                  <div style={{ flex:1, fontFamily:"'DM Mono',monospace", fontSize:"10px", color:T.smoke, letterSpacing:".06em" }}>{d.label}</div>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:"14px", color:T.gold }}>{d.pct}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* HOW TO GET THT */}
        <div style={{ marginBottom:"80px" }}>
          <div style={{ textAlign:"center", marginBottom:"40px" }}>
            <SectionLabel>Acquisition</SectionLabel>
            <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(20px,3vw,32px)", color:T.snow, letterSpacing:".02em" }}>How to Get THT</h2>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:"16px" }}>
            {[
              { n:"01", title:"Provide Storage",  body:"Register as a provider, stake THT, and earn rewards each epoch from storage deals you fulfil on the network." },
              { n:"02", title:"DEX / Swap",        body:"Once live on mainnet, THT will be available on Cardano DEXes (Minswap, SundaeSwap). Check back for official pools." },
              { n:"03", title:"Ecosystem Grants",  body:"Contribute to the ADADIVE protocol — tooling, SDKs, documentation — and apply for THT grants from the reserve." },
              { n:"04", title:"Testnet Faucet",    body:"Currently on Preprod testnet. Developers can request THT from the testnet faucet to experiment with storage deals." },
            ].map(c => (
              <div key={c.n} className="t-token-card">
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"9px", color:T.mist, marginBottom:"14px" }}>{c.n}</div>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:"13px", letterSpacing:".12em", color:T.gold, marginBottom:"10px" }}>{c.title}</div>
                <p style={{ fontSize:"14px", color:T.smoke, lineHeight:1.8, fontWeight:300 }}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div style={{ textAlign:"center", padding:"60px 0" }}>
          <Ornament />
          <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:"clamp(20px,3.5vw,36px)", color:T.snow, margin:"32px 0 12px", letterSpacing:".03em" }}>Start Earning THT Today</h2>
          <p style={{ fontStyle:"italic", fontSize:"17px", color:T.smoke, marginBottom:"36px", fontWeight:300 }}>
            Become a provider, create a deal, or just explore the live network.
          </p>
          <div style={{ display:"flex", gap:"16px", justifyContent:"center", flexWrap:"wrap" }}>
            <button className="t-btn-primary" onClick={goApp}>OPEN ADADIVE APP →</button>
            <button className="t-btn-ghost"  onClick={goLanding}>← BACK TO HOME</button>
          </div>
        </div>
      </main>

      <footer style={{ position:"relative", zIndex:10, borderTop:"1px solid rgba(201,169,110,.07)", padding:"28px clamp(16px,4vw,48px)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"12px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <Logo size={20} />
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:"10px", letterSpacing:".28em", color:T.gold, opacity:.6 }}>ADADIVE</span>
          <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"8px", color:T.mist }}>by THETA · powered by THT</span>
        </div>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:"8px", color:T.mist, opacity:.4 }}>PREPROD TESTNET · NOT FINANCIAL ADVICE</span>
      </footer>
    </div>
  );
}
