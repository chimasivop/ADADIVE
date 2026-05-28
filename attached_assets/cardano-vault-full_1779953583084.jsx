import { useState, useRef, useCallback, useEffect } from "react";

/* ── Google Fonts injected via style tag ── */
const FontInjector = () => {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Cinzel+Decorative:wght@400;700&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
  return null;
};

/* ── Helpers ── */
function formatBytes(b) {
  if (!b) return "0 B";
  const k = 1024, s = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + " " + s[i];
}
function mockCID(name, size) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return "Qm" + Math.abs(h + size).toString(16).padStart(44,"b").slice(0,44);
}

/* ── Data ── */
const PROVIDERS = [
  { id:1, name:"NodeVault Alpha", glyph:"Ⅰ", price:"0.12 ₳/GB", latency:"12ms", rel:"99.8%", region:"EU–West"  },
  { id:2, name:"SectorForge",     glyph:"Ⅱ", price:"0.09 ₳/GB", latency:"28ms", rel:"99.1%", region:"US–East"  },
  { id:3, name:"ChainKeep",       glyph:"Ⅲ", price:"0.15 ₳/GB", latency:"8ms",  rel:"99.9%", region:"Asia–Pac" },
];
const LAYERS = [
  { id:"ipfs",    label:"IPFS + Filecoin", sub:"Content-addressed · distributed" },
  { id:"arweave", label:"Arweave",         sub:"Permanent · pay-once"            },
  { id:"native",  label:"Cardano Native",  sub:"On-chain metadata anchoring"     },
];
const STEPS = ["SELECT","CONFIGURE","SIGN","DONE"];

/* ── Styles (CSS-in-JS object helpers) ── */
const V = {
  gold:   "#c9a96e",
  goldLt: "#e8c98a",
  goldDk: "#8a6a3a",
  ink:    "#04060f",
  inkMid: "#0a0e1a",
  inkLt:  "#131929",
  mist:   "#2a3350",
  smoke:  "#8899bb",
  snow:   "#e8edf8",
  green:  "#00ffa3",
};

const css = `
  @keyframes fadeUp   { from { opacity:0; transform:translateY(24px) } to { opacity:1; transform:translateY(0) } }
  @keyframes fadeIn   { from { opacity:0 } to { opacity:1 } }
  @keyframes shimmer  { 0%,100% { opacity:.6 } 50% { opacity:1 } }
  @keyframes spin     { to { transform:rotate(360deg) } }
  @keyframes pulse    { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
  @keyframes scanline { 0%{top:-100%} 100%{top:200%} }
  @keyframes orbFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-18px)} }
  .fade-up  { animation: fadeUp  .7s ease both }
  .fade-in  { animation: fadeIn  .5s ease both }
  .anim-d1  { animation-delay:.1s }
  .anim-d2  { animation-delay:.2s }
  .anim-d3  { animation-delay:.35s }
  .anim-d4  { animation-delay:.5s }
  .anim-d5  { animation-delay:.65s }
  * { box-sizing:border-box; margin:0; padding:0 }
  ::-webkit-scrollbar { width:4px }
  ::-webkit-scrollbar-track { background:#04060f }
  ::-webkit-scrollbar-thumb { background:#2a3350; border-radius:2px }
`;

/* ══════════════════════════════════════════════
   SECTION: Landing / Hero
══════════════════════════════════════════════ */
function Landing({ onEnter }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ minHeight:"100vh", background:V.ink, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>

      {/* Atmospheric orbs */}
      <div style={{ position:"absolute", top:"-10%", left:"50%", transform:"translateX(-50%)", width:"700px", height:"700px", borderRadius:"50%", background:"radial-gradient(ellipse, rgba(201,169,110,0.07) 0%, transparent 65%)", pointerEvents:"none", animation:"orbFloat 8s ease-in-out infinite" }} />
      <div style={{ position:"absolute", bottom:"-5%", right:"-5%", width:"400px", height:"400px", borderRadius:"50%", background:"radial-gradient(ellipse, rgba(0,180,120,0.05) 0%, transparent 65%)", pointerEvents:"none" }} />

      {/* Fine grid */}
      <div style={{ position:"absolute", inset:0, backgroundImage:`linear-gradient(rgba(201,169,110,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(201,169,110,0.03) 1px, transparent 1px)`, backgroundSize:"60px 60px", pointerEvents:"none" }} />

      {/* Top rule */}
      <div style={{ width:"100%", height:"1px", background:`linear-gradient(90deg, transparent, ${V.gold}, transparent)`, opacity:.4 }} />

      {/* Nav */}
      <nav style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"24px 48px", position:"relative", zIndex:10 }}>
        <div style={{ fontFamily:"'Cinzel', serif", fontSize:"12px", letterSpacing:"0.35em", color:V.gold, opacity:.7 }}>
          CARDANO · VAULT
        </div>
        <div style={{ display:"flex", gap:"32px" }}>
          {["Protocol","Providers","Docs","Testnet"].map(t => (
            <span key={t} style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", letterSpacing:"0.2em", color:V.smoke, cursor:"pointer", transition:"color .2s" }}
              onMouseEnter={e=>e.target.style.color=V.gold} onMouseLeave={e=>e.target.style.color=V.smoke}>{t}</span>
          ))}
        </div>
      </nav>

      {/* Hero */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"60px 24px", textAlign:"center", position:"relative", zIndex:10 }}>

        {/* Badge */}
        <div className="fade-up" style={{ marginBottom:"32px", display:"inline-flex", alignItems:"center", gap:"10px", border:`1px solid rgba(201,169,110,.25)`, padding:"6px 20px", borderRadius:"100px" }}>
          <span style={{ width:"6px", height:"6px", borderRadius:"50%", background:V.green, display:"block", animation:"pulse 2s infinite" }} />
          <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", letterSpacing:"0.25em", color:V.smoke }}>PREPROD TESTNET · EXPERIMENTAL</span>
        </div>

        {/* Wordmark */}
        <h1 className="fade-up anim-d1" style={{ fontFamily:"'Cinzel Decorative', serif", fontSize:"clamp(42px,8vw,96px)", fontWeight:"700", lineHeight:1.05, letterSpacing:"-0.01em", marginBottom:"8px" }}>
          <span style={{ background:`linear-gradient(160deg, ${V.goldLt} 0%, ${V.gold} 40%, ${V.goldDk} 100%)`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
            VAULT
          </span>
        </h1>
        <h2 className="fade-up anim-d2" style={{ fontFamily:"'Cinzel', serif", fontSize:"clamp(12px,2vw,18px)", fontWeight:"400", letterSpacing:"0.55em", color:V.smoke, marginBottom:"40px" }}>
          DECENTRALIZED STORAGE ECONOMY
        </h2>

        {/* Italic tagline */}
        <p className="fade-up anim-d3" style={{ fontFamily:"'Cormorant Garamond', serif", fontStyle:"italic", fontSize:"clamp(16px,2.2vw,22px)", color:V.smoke, maxWidth:"480px", lineHeight:1.7, marginBottom:"56px", opacity:.8 }}>
          Pin your files to the blockchain. Own your data. <br />Settle in Cardano.
        </p>

        {/* Ornament */}
        <div className="fade-up anim-d3" style={{ display:"flex", alignItems:"center", gap:"16px", marginBottom:"56px" }}>
          <div style={{ width:"60px", height:"1px", background:`linear-gradient(90deg, transparent, ${V.gold})` }} />
          <span style={{ color:V.gold, fontSize:"18px", opacity:.6 }}>✦</span>
          <div style={{ width:"60px", height:"1px", background:`linear-gradient(90deg, ${V.gold}, transparent)` }} />
        </div>

        {/* CTA */}
        <button
          className="fade-up anim-d4"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={onEnter}
          style={{
            fontFamily:"'Cinzel', serif", fontSize:"12px", letterSpacing:"0.35em",
            padding:"16px 48px", border:`1px solid ${hovered ? V.goldLt : V.gold}`,
            background: hovered ? `rgba(201,169,110,0.12)` : "transparent",
            color: hovered ? V.goldLt : V.gold,
            cursor:"pointer", transition:"all .25s", borderRadius:"1px",
            boxShadow: hovered ? `0 0 32px rgba(201,169,110,0.15), inset 0 0 16px rgba(201,169,110,0.05)` : "none",
          }}>
          ENTER VAULT
        </button>

        {/* Stats row */}
        <div className="fade-up anim-d5" style={{ display:"flex", gap:"48px", marginTop:"80px" }}>
          {[["3", "Storage Layers"],["99.9%","Max Reliability"],["0.09 ₳","Min Cost/GB"]].map(([v,l]) => (
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontFamily:"'Cinzel', serif", fontSize:"22px", color:V.gold, marginBottom:"4px" }}>{v}</div>
              <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", letterSpacing:"0.15em", color:V.mist }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom rule */}
      <div style={{ width:"100%", height:"1px", background:`linear-gradient(90deg, transparent, ${V.gold}, transparent)`, opacity:.2 }} />

      {/* Footer */}
      <div style={{ display:"flex", justifyContent:"space-between", padding:"16px 48px" }}>
        <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", letterSpacing:"0.15em", color:V.mist }}>© 2026 CARDANO VAULT PROTOCOL</span>
        <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", letterSpacing:"0.15em", color:V.mist }}>BUILD 0.1.0-ALPHA</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   SECTION: App (dApp UI)
══════════════════════════════════════════════ */
function App({ onBack }) {
  const [wallet, setWallet]     = useState({ addr:"addr1qx9s3...f7a2", bal:"1,247.83 ₳", ok:false });
  const [files, setFiles]       = useState([]);
  const [dragging, setDragging] = useState(false);
  const [layer, setLayer]       = useState("ipfs");
  const [provider, setProvider] = useState(1);
  const [step, setStep]         = useState(0); // 0=select 1=configure 2=sign 3=done
  const [progress, setProgress] = useState({});
  const [pinned, setPinned]     = useState([]);
  const fileRef = useRef();

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const dropped = Array.from(e.dataTransfer?.files || e.target?.files || []);
    const mapped  = dropped.map(f => ({ id:Math.random().toString(36).slice(2), file:f, name:f.name, size:f.size, cid:mockCID(f.name,f.size) }));
    setFiles(p => [...p, ...mapped]);
    if (mapped.length && step === 0) setStep(1);
  }, [step]);

  const removeFile = id => setFiles(f => f.filter(x => x.id !== id));

  const doPin = async () => {
    if (!wallet.ok) { setWallet(w => ({...w, ok:true})); return; }
    setStep(2);
    const prog = {}; files.forEach(f => prog[f.id] = 0); setProgress(prog);
    for (const f of files) {
      for (let v = 0; v <= 100; ) {
        v = Math.min(100, v + Math.random()*18 + 4);
        await new Promise(r => setTimeout(r, 60 + Math.random()*100));
        setProgress(p => ({...p, [f.id]: Math.round(v)}));
      }
      setPinned(p => [...p, {...f, tx:"tx1"+Math.random().toString(36).slice(2,14)}]);
    }
    setStep(3);
  };

  const reset = () => { setFiles([]); setPinned([]); setProgress({}); setStep(0); };

  const totalSize   = files.reduce((a,f) => a+f.size, 0);
  const prov        = PROVIDERS.find(p => p.id === provider);
  const estCost     = ((totalSize/1e9)*0.12).toFixed(6);
  const total       = (parseFloat(estCost)+0.175).toFixed(6);

  return (
    <div style={{ minHeight:"100vh", background:V.ink, display:"flex", flexDirection:"column", position:"relative", overflow:"hidden" }}>

      {/* Grid */}
      <div style={{ position:"fixed", inset:0, backgroundImage:`linear-gradient(rgba(201,169,110,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(201,169,110,.025) 1px,transparent 1px)`, backgroundSize:"50px 50px", pointerEvents:"none", zIndex:0 }} />

      {/* Scanline */}
      <div style={{ position:"fixed", left:0, right:0, height:"2px", background:"linear-gradient(transparent, rgba(201,169,110,.04), transparent)", animation:"scanline 8s linear infinite", zIndex:1, pointerEvents:"none" }} />

      {/* Top rule glow */}
      <div style={{ position:"fixed", top:0, left:0, right:0, height:"1px", background:`linear-gradient(90deg, transparent, ${V.gold}, transparent)`, opacity:.3, zIndex:20 }} />

      {/* ── Header ── */}
      <header style={{ position:"sticky", top:0, zIndex:30, backdropFilter:"blur(12px)", background:"rgba(4,6,15,.8)", borderBottom:`1px solid rgba(201,169,110,.1)`, padding:"0 40px", height:"60px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"16px" }}>
          <button onClick={onBack} style={{ background:"none", border:"none", color:V.mist, cursor:"pointer", fontSize:"18px", lineHeight:1, padding:"4px", transition:"color .2s" }}
            onMouseEnter={e=>e.target.style.color=V.gold} onMouseLeave={e=>e.target.style.color=V.mist}>←</button>
          <div style={{ width:"1px", height:"20px", background:V.mist, opacity:.3 }} />
          <span style={{ fontFamily:"'Cinzel', serif", fontSize:"14px", letterSpacing:"0.35em", color:V.gold }}>VAULT</span>
          <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", letterSpacing:"0.2em", color:V.mist }}>/ UPLOAD & PIN</span>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:"16px" }}>
          {wallet.ok && (
            <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", color:V.mist, letterSpacing:"0.08em" }}>
              <span style={{ color:V.green }}>◉</span>&nbsp;{wallet.addr}&nbsp;&nbsp;<span style={{ color:V.gold }}>{wallet.bal}</span>
            </div>
          )}
          <button onClick={() => setWallet(w => ({...w, ok:!w.ok}))} style={{
            fontFamily:"'Cinzel', serif", fontSize:"10px", letterSpacing:"0.25em",
            padding:"7px 18px", border:`1px solid ${wallet.ok ? "rgba(201,169,110,.5)" : "rgba(201,169,110,.2)"}`,
            background: wallet.ok ? "rgba(201,169,110,.08)" : "transparent",
            color: wallet.ok ? V.gold : V.mist, cursor:"pointer", transition:"all .2s", borderRadius:"1px"
          }}>
            {wallet.ok ? "● CONNECTED" : "CONNECT WALLET"}
          </button>
        </div>
      </header>

      <main style={{ flex:1, position:"relative", zIndex:10, maxWidth:"1000px", margin:"0 auto", width:"100%", padding:"40px 32px" }}>

        {/* ── Step bar ── */}
        <div style={{ display:"flex", alignItems:"center", marginBottom:"44px" }}>
          {STEPS.map((s,i) => {
            const done = step > i, active = step === i;
            return (
              <div key={s} style={{ display:"flex", alignItems:"center", flex: i<3 ? 1 : "none" }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"6px" }}>
                  <div style={{
                    width:"32px", height:"32px", borderRadius:"50%",
                    border:`1px solid ${done||active ? V.gold : "rgba(201,169,110,.15)"}`,
                    background: active ? V.gold : done ? "rgba(201,169,110,.12)" : "transparent",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontFamily:"'Cinzel', serif", fontSize:"11px",
                    color: active ? V.ink : done ? V.gold : V.mist,
                    fontWeight:"700", transition:"all .3s"
                  }}>{done ? "✓" : i+1}</div>
                  <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"8px", letterSpacing:"0.18em", color: done||active ? V.gold : V.mist, whiteSpace:"nowrap" }}>{s}</span>
                </div>
                {i < 3 && (
                  <div style={{ flex:1, height:"1px", margin:"0 8px 20px", background: step > i ? `linear-gradient(90deg,${V.gold},rgba(201,169,110,.3))` : "rgba(201,169,110,.1)", transition:"background .4s" }} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── DONE screen ── */}
        {step === 3 ? (
          <div className="fade-in" style={{ textAlign:"center", padding:"40px 0" }}>
            <div style={{ fontFamily:"'Cinzel Decorative', serif", fontSize:"42px", color:V.gold, marginBottom:"4px", animation:"pulse 3s ease infinite" }}>✦</div>
            <h2 style={{ fontFamily:"'Cinzel', serif", fontSize:"24px", letterSpacing:"0.3em", color:V.gold, marginBottom:"6px" }}>ANCHORED</h2>
            <p style={{ fontFamily:"'Cormorant Garamond', serif", fontStyle:"italic", fontSize:"16px", color:V.smoke, marginBottom:"40px" }}>
              {pinned.length} file{pinned.length!==1?"s":""} permanently recorded on Cardano
            </p>

            <div style={{ display:"flex", flexDirection:"column", gap:"10px", marginBottom:"44px", maxWidth:"640px", margin:"0 auto 44px" }}>
              {pinned.map(f => (
                <div key={f.id} style={{ background:"rgba(201,169,110,.04)", border:"1px solid rgba(201,169,110,.15)", borderRadius:"3px", padding:"16px 20px", textAlign:"left" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"8px" }}>
                    <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"12px", color:V.snow }}>{f.name}</span>
                    <span style={{ fontFamily:"'Cinzel', serif", fontSize:"10px", color:V.gold, letterSpacing:"0.15em" }}>PINNED ✓</span>
                  </div>
                  <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:V.mist, letterSpacing:"0.05em", marginBottom:"3px" }}>CID: {f.cid}</div>
                  <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:V.mist, letterSpacing:"0.05em" }}>TX:&nbsp;&nbsp;{f.tx}</div>
                </div>
              ))}
            </div>

            <button onClick={reset} style={{ fontFamily:"'Cinzel', serif", fontSize:"11px", letterSpacing:"0.3em", padding:"12px 40px", border:`1px solid rgba(201,169,110,.3)`, background:"transparent", color:V.mist, cursor:"pointer", transition:"all .2s", borderRadius:"1px" }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=V.gold;e.currentTarget.style.color=V.gold}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(201,169,110,.3)";e.currentTarget.style.color=V.mist}}>
              PIN MORE FILES
            </button>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:"28px", alignItems:"start" }}>

            {/* ── Left column ── */}
            <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>

              {/* Drop zone */}
              <div
                onDragOver={e=>{e.preventDefault();setDragging(true)}}
                onDragLeave={()=>setDragging(false)}
                onDrop={onDrop}
                onClick={()=>fileRef.current?.click()}
                style={{
                  border:`1px dashed ${dragging ? V.gold : "rgba(201,169,110,.2)"}`,
                  borderRadius:"4px", padding:"56px 24px", textAlign:"center", cursor:"pointer",
                  background: dragging ? "rgba(201,169,110,.04)" : "rgba(201,169,110,.015)",
                  transition:"all .2s", position:"relative", overflow:"hidden"
                }}
              >
                <input ref={fileRef} type="file" multiple style={{display:"none"}} onChange={onDrop}/>
                {/* inner glow on drag */}
                {dragging && <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at center, rgba(201,169,110,.06) 0%, transparent 70%)", pointerEvents:"none" }} />}

                <div style={{ fontFamily:"'Cinzel Decorative', serif", fontSize:"28px", color:dragging?V.gold:V.mist, marginBottom:"14px", transition:"color .2s" }}>⬡</div>
                <div style={{ fontFamily:"'Cinzel', serif", fontSize:"11px", letterSpacing:"0.35em", color:dragging?V.gold:V.mist, marginBottom:"8px", transition:"color .2s" }}>
                  {dragging ? "RELEASE TO QUEUE" : "DROP FILES HERE"}
                </div>
                <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", color:V.mist, opacity:.5 }}>or click to browse — any format accepted</div>
              </div>

              {/* File list */}
              {files.length > 0 && (
                <div>
                  <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", letterSpacing:"0.2em", color:V.mist, marginBottom:"12px" }}>
                    QUEUE — {files.length} FILE{files.length!==1?"S":""}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                    {files.map(f => (
                      <div key={f.id} style={{ background:"rgba(255,255,255,.02)", border:"1px solid rgba(201,169,110,.1)", borderRadius:"3px", padding:"14px 16px", transition:"border-color .2s" }}
                        onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(201,169,110,.25)"}
                        onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(201,169,110,.1)"}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                          <div>
                            <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"12px", color:V.snow, marginBottom:"3px" }}>{f.name}</div>
                            <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", color:V.mist }}>{formatBytes(f.size)}</div>
                          </div>
                          {step === 2 ? (
                            <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"11px", color: (progress[f.id]||0) < 100 ? V.gold : V.green }}>
                              {(progress[f.id]||0) < 100 ? `${progress[f.id]||0}%` : "✓"}
                            </span>
                          ) : (
                            <button onClick={()=>removeFile(f.id)} style={{ background:"none", border:"none", color:V.mist, cursor:"pointer", fontSize:"18px", lineHeight:1, transition:"color .2s" }}
                              onMouseEnter={e=>e.target.style.color="#e05c5c"}
                              onMouseLeave={e=>e.target.style.color=V.mist}>×</button>
                          )}
                        </div>

                        {step === 2 && (
                          <div style={{ height:"1px", background:"rgba(201,169,110,.08)", borderRadius:"1px", overflow:"hidden", marginBottom:"6px" }}>
                            <div style={{ height:"100%", width:`${progress[f.id]||0}%`, background:`linear-gradient(90deg,${V.gold},${V.green})`, transition:"width .12s", borderRadius:"1px" }} />
                          </div>
                        )}
                        <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:"rgba(42,51,80,.8)", letterSpacing:"0.04em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          CID: {f.cid}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Storage layer (shown after step 0) */}
              {step >= 1 && (
                <div>
                  <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", letterSpacing:"0.2em", color:V.mist, marginBottom:"12px" }}>STORAGE PROTOCOL</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                    {LAYERS.map(l => {
                      const sel = layer === l.id;
                      return (
                        <div key={l.id} onClick={()=>setLayer(l.id)} style={{
                          padding:"13px 16px", border:`1px solid ${sel?"rgba(201,169,110,.4)":"rgba(201,169,110,.1)"}`,
                          borderRadius:"3px", cursor:"pointer", display:"flex", alignItems:"center", gap:"14px",
                          background: sel?"rgba(201,169,110,.05)":"transparent", transition:"all .15s"
                        }}>
                          <div style={{ width:"8px", height:"8px", borderRadius:"50%", border:`1px solid ${sel?V.gold:"rgba(201,169,110,.3)"}`, background:sel?V.gold:"transparent", transition:"all .2s", flexShrink:0 }} />
                          <div>
                            <div style={{ fontFamily:"'Cinzel', serif", fontSize:"11px", letterSpacing:"0.15em", color:sel?V.gold:V.smoke, marginBottom:"2px" }}>{l.label}</div>
                            <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:V.mist }}>{l.sub}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right sidebar ── */}
            <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>

              {/* Providers */}
              {step >= 1 && (
                <div style={{ background:"rgba(201,169,110,.02)", border:"1px solid rgba(201,169,110,.1)", borderRadius:"4px", padding:"20px" }}>
                  <div style={{ fontFamily:"'Cinzel', serif", fontSize:"9px", letterSpacing:"0.3em", color:V.gold, marginBottom:"16px", opacity:.7 }}>PROVIDERS</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                    {PROVIDERS.map(p => {
                      const sel = provider === p.id;
                      return (
                        <div key={p.id} onClick={()=>setProvider(p.id)} style={{
                          padding:"11px 13px", border:`1px solid ${sel?"rgba(201,169,110,.35)":"rgba(201,169,110,.07)"}`,
                          borderRadius:"3px", cursor:"pointer", background:sel?"rgba(201,169,110,.05)":"transparent", transition:"all .15s"
                        }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
                            <span style={{ fontFamily:"'Cinzel', serif", fontSize:"11px", color:sel?V.gold:V.smoke, letterSpacing:"0.08em" }}>{p.glyph} {p.name}</span>
                            {sel && <span style={{ color:V.gold, fontSize:"10px" }}>▶</span>}
                          </div>
                          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                            {[p.price,p.latency,p.rel].map(v=>(
                              <span key={v} style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:V.mist }}>{v}</span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Cost summary */}
              {files.length > 0 && (
                <div style={{ background:"rgba(201,169,110,.03)", border:"1px solid rgba(201,169,110,.12)", borderRadius:"4px", padding:"20px" }}>
                  <div style={{ fontFamily:"'Cinzel', serif", fontSize:"9px", letterSpacing:"0.3em", color:V.gold, marginBottom:"16px", opacity:.7 }}>TX SUMMARY</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:"9px" }}>
                    {[["Files",files.length],["Size",formatBytes(totalSize)],["Provider",prov?.name||"—"],["Layer",LAYERS.find(l=>l.id===layer)?.label||"—"],["Est. storage",`${estCost} ₳`],["Network fee","0.175000 ₳"]].map(([k,v])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between" }}>
                        <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", color:V.mist, letterSpacing:"0.06em" }}>{k}</span>
                        <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"10px", color:V.smoke }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ borderTop:"1px solid rgba(201,169,110,.1)", paddingTop:"9px", display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontFamily:"'Cinzel', serif", fontSize:"10px", letterSpacing:"0.15em", color:V.smoke }}>TOTAL</span>
                      <span style={{ fontFamily:"'Cinzel', serif", fontSize:"14px", color:V.gold }}>{total} ₳</span>
                    </div>
                  </div>
                </div>
              )}

              {/* CTA */}
              <button
                onClick={files.length===0 ? ()=>fileRef.current?.click() : doPin}
                disabled={step===2}
                style={{
                  width:"100%", padding:"15px", cursor:step===2?"wait":"pointer",
                  fontFamily:"'Cinzel', serif", fontSize:"11px", letterSpacing:"0.3em",
                  border:`1px solid ${files.length===0?"rgba(201,169,110,.15)":V.gold}`,
                  background: files.length===0 ? "transparent" : step===2 ? "rgba(201,169,110,.15)" : "rgba(201,169,110,.1)",
                  color: files.length===0 ? V.mist : V.gold,
                  transition:"all .25s", borderRadius:"2px",
                  boxShadow: files.length>0 && step!==2 ? `0 0 20px rgba(201,169,110,.08)` : "none"
                }}
                onMouseEnter={e=>{ if(files.length>0&&step!==2){ e.currentTarget.style.background="rgba(201,169,110,.18)"; e.currentTarget.style.boxShadow="0 0 32px rgba(201,169,110,.15)"; }}}
                onMouseLeave={e=>{ if(files.length>0&&step!==2){ e.currentTarget.style.background="rgba(201,169,110,.1)"; e.currentTarget.style.boxShadow="0 0 20px rgba(201,169,110,.08)"; }}}
              >
                {step===2 ? "PINNING TO CHAIN..." : !wallet.ok ? "CONNECT & PIN" : files.length===0 ? "SELECT FILES FIRST" : "SIGN & PIN TO CARDANO"}
              </button>

              {!wallet.ok && files.length>0 && (
                <div style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:V.mist, textAlign:"center", letterSpacing:"0.1em", lineHeight:1.6 }}>
                  Wallet signature required<br/>to anchor the pin transaction
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ position:"relative", zIndex:10, borderTop:"1px solid rgba(201,169,110,.07)", padding:"14px 40px", display:"flex", justifyContent:"space-between" }}>
        <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:"rgba(42,51,80,.5)", letterSpacing:"0.12em" }}>CARDANO VAULT — EXPERIMENTAL PROTOCOL</span>
        <span style={{ fontFamily:"'DM Mono', monospace", fontSize:"9px", color:"rgba(42,51,80,.5)", letterSpacing:"0.12em" }}>PREPROD TESTNET</span>
      </footer>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════ */
export default function Root() {
  const [view, setView] = useState("landing"); // landing | app

  return (
    <>
      <FontInjector />
      <style>{css}</style>
      {view === "landing" ? (
        <Landing onEnter={() => setView("app")} />
      ) : (
        <App onBack={() => setView("landing")} />
      )}
    </>
  );
}
