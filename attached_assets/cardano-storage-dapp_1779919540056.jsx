import { useState, useRef, useCallback } from "react";

const MOCK_WALLET = {
  address: "addr1qx9s3...f7a2",
  balance: "1,247.83 ₳",
  connected: false,
};

const MOCK_PROVIDERS = [
  { id: 1, name: "NodeVault Alpha", price: "0.12 ₳/GB", latency: "12ms", reliability: "99.8%", region: "EU-West", selected: true },
  { id: 2, name: "SectorForge", price: "0.09 ₳/GB", latency: "28ms", reliability: "99.1%", region: "US-East", selected: false },
  { id: 3, name: "ChainKeep", price: "0.15 ₳/GB", latency: "8ms", reliability: "99.9%", region: "Asia-Pac", selected: false },
];

const STORAGE_LAYERS = [
  { id: "ipfs", label: "IPFS + Filecoin", icon: "◈", desc: "Content-addressed, distributed" },
  { id: "arweave", label: "Arweave", icon: "◉", desc: "Permanent, pay-once storage" },
  { id: "custom", label: "Cardano Native", icon: "◆", desc: "On-chain metadata anchoring" },
];

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function hashPreview(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return "Qm" + Math.abs(hash).toString(16).padStart(44, "a").slice(0, 44);
}

export default function App() {
  const [wallet, setWallet] = useState(MOCK_WALLET);
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [layer, setLayer] = useState("ipfs");
  const [providers, setProviders] = useState(MOCK_PROVIDERS);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState([]);
  const [progress, setProgress] = useState({});
  const [step, setStep] = useState("upload"); // upload | configure | confirm | done
  const fileRef = useRef();

  const connectWallet = () => setWallet((w) => ({ ...w, connected: !w.connected }));

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer?.files || e.target.files || []);
    const mapped = dropped.map((f) => ({ file: f, id: Math.random().toString(36).slice(2), name: f.name, size: f.size, hash: hashPreview(f.name + f.size) }));
    setFiles((prev) => [...prev, ...mapped]);
    if (mapped.length > 0 && step === "upload") setStep("configure");
  }, [step]);

  const removeFile = (id) => setFiles((f) => f.filter((x) => x.id !== id));

  const toggleProvider = (id) => setProviders((p) => p.map((x) => ({ ...x, selected: x.id === id })));

  const startPin = async () => {
    if (!wallet.connected) { connectWallet(); return; }
    setPinning(true);
    setStep("confirm");
    const progs = {};
    files.forEach((f) => (progs[f.id] = 0));
    setProgress(progs);

    for (const f of files) {
      for (let i = 0; i <= 100; i += Math.random() * 15 + 5) {
        await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));
        setProgress((p) => ({ ...p, [f.id]: Math.min(100, Math.round(i)) }));
      }
      setProgress((p) => ({ ...p, [f.id]: 100 }));
      setPinned((prev) => [...prev, { ...f, txId: "tx1" + Math.random().toString(36).slice(2, 14), ts: new Date().toISOString() }]);
    }
    setPinning(false);
    setStep("done");
  };

  const reset = () => { setFiles([]); setPinned([]); setProgress({}); setStep("upload"); };

  const selectedProvider = providers.find((p) => p.selected);
  const totalSize = files.reduce((a, f) => a + f.size, 0);
  const estimatedCost = ((totalSize / 1e9) * 0.12).toFixed(6);

  return (
    <div style={{
      minHeight: "100vh", background: "#050810",
      fontFamily: "'Courier New', 'Lucida Console', monospace",
      color: "#e2e8f0", position: "relative", overflow: "hidden"
    }}>
      {/* Grid background */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        backgroundImage: `linear-gradient(rgba(0,200,150,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,150,0.04) 1px, transparent 1px)`,
        backgroundSize: "40px 40px",
        pointerEvents: "none"
      }} />

      {/* Glow orbs */}
      <div style={{ position: "fixed", top: "-120px", right: "-80px", width: "400px", height: "400px", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,255,163,0.08) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "fixed", bottom: "-80px", left: "-60px", width: "300px", height: "300px", borderRadius: "50%", background: "radial-gradient(circle, rgba(100,100,255,0.07) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <header style={{ position: "relative", zIndex: 10, borderBottom: "1px solid rgba(0,255,163,0.15)", padding: "0 32px", height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", backdropFilter: "blur(8px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "28px", height: "28px", background: "linear-gradient(135deg, #00ffa3, #00b4ff)", clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)", flexShrink: 0 }} />
          <span style={{ fontSize: "13px", letterSpacing: "0.2em", color: "#00ffa3", fontWeight: "700" }}>CARDANO</span>
          <span style={{ fontSize: "13px", letterSpacing: "0.2em", color: "#4a5568" }}>VAULT</span>
          <span style={{ fontSize: "10px", background: "rgba(0,255,163,0.1)", border: "1px solid rgba(0,255,163,0.3)", color: "#00ffa3", padding: "1px 6px", borderRadius: "2px", letterSpacing: "0.15em" }}>EXPERIMENTAL</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {wallet.connected && (
            <div style={{ fontSize: "11px", color: "#718096", letterSpacing: "0.1em" }}>
              <span style={{ color: "#00ffa3" }}>◉</span> {wallet.address} <span style={{ color: "#a0aec0", marginLeft: "8px" }}>{wallet.balance}</span>
            </div>
          )}
          <button onClick={connectWallet} style={{
            background: wallet.connected ? "rgba(0,255,163,0.08)" : "transparent",
            border: `1px solid ${wallet.connected ? "#00ffa3" : "rgba(255,255,255,0.15)"}`,
            color: wallet.connected ? "#00ffa3" : "#a0aec0",
            padding: "6px 16px", fontSize: "11px", letterSpacing: "0.15em",
            cursor: "pointer", borderRadius: "2px", transition: "all 0.2s"
          }}>
            {wallet.connected ? "● CONNECTED" : "CONNECT WALLET"}
          </button>
        </div>
      </header>

      <main style={{ position: "relative", zIndex: 10, maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Step indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "0", marginBottom: "40px" }}>
          {["upload", "configure", "confirm", "done"].map((s, i) => {
            const steps = ["upload", "configure", "confirm", "done"];
            const labels = ["SELECT FILES", "CONFIGURE", "PIN & SIGN", "COMPLETE"];
            const active = steps.indexOf(step) >= i;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", flex: i < 3 ? 1 : "none" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    border: `1px solid ${active ? "#00ffa3" : "rgba(255,255,255,0.1)"}`,
                    background: step === s ? "#00ffa3" : active ? "rgba(0,255,163,0.12)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11px", color: step === s ? "#000" : active ? "#00ffa3" : "#4a5568",
                    fontWeight: "700", transition: "all 0.3s"
                  }}>{i + 1}</div>
                  <span style={{ fontSize: "9px", letterSpacing: "0.1em", color: active ? "#00ffa3" : "#4a5568", whiteSpace: "nowrap" }}>{labels[i]}</span>
                </div>
                {i < 3 && <div style={{ flex: 1, height: "1px", background: active && steps.indexOf(step) > i ? "rgba(0,255,163,0.4)" : "rgba(255,255,255,0.08)", margin: "0 8px 20px" }} />}
              </div>
            );
          })}
        </div>

        {step === "done" ? (
          /* Done screen */
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>◆</div>
            <div style={{ fontSize: "20px", letterSpacing: "0.2em", color: "#00ffa3", marginBottom: "8px" }}>PINNED SUCCESSFULLY</div>
            <div style={{ fontSize: "12px", color: "#4a5568", marginBottom: "40px" }}>{pinned.length} file{pinned.length !== 1 ? "s" : ""} anchored to Cardano</div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "40px" }}>
              {pinned.map((f) => (
                <div key={f.id} style={{ background: "rgba(0,255,163,0.04)", border: "1px solid rgba(0,255,163,0.15)", borderRadius: "4px", padding: "16px 20px", textAlign: "left" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontSize: "13px", color: "#e2e8f0" }}>{f.name}</span>
                    <span style={{ fontSize: "11px", color: "#00ffa3" }}>✓ PINNED</span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#4a5568", letterSpacing: "0.08em" }}>CID: {f.hash}</div>
                  <div style={{ fontSize: "10px", color: "#4a5568", letterSpacing: "0.08em" }}>TX: {f.txId}</div>
                </div>
              ))}
            </div>

            <button onClick={reset} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#a0aec0", padding: "10px 32px", fontSize: "11px", letterSpacing: "0.15em", cursor: "pointer", borderRadius: "2px" }}>
              PIN MORE FILES
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "24px" }}>
            {/* Left column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `1px dashed ${dragging ? "#00ffa3" : "rgba(255,255,255,0.12)"}`,
                  borderRadius: "6px", padding: "48px 24px", textAlign: "center",
                  cursor: "pointer", transition: "all 0.2s",
                  background: dragging ? "rgba(0,255,163,0.04)" : "rgba(255,255,255,0.01)",
                  position: "relative", overflow: "hidden"
                }}
              >
                <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={onDrop} />
                <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.4 }}>⬡</div>
                <div style={{ fontSize: "13px", letterSpacing: "0.15em", color: dragging ? "#00ffa3" : "#718096", marginBottom: "6px" }}>
                  {dragging ? "RELEASE TO QUEUE" : "DROP FILES TO PIN"}
                </div>
                <div style={{ fontSize: "11px", color: "#4a5568" }}>or click to browse — any file type</div>
              </div>

              {/* File queue */}
              {files.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: "#4a5568", marginBottom: "4px" }}>QUEUE — {files.length} FILE{files.length !== 1 ? "S" : ""}</div>
                  {files.map((f) => (
                    <div key={f.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "4px", padding: "12px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                        <div>
                          <div style={{ fontSize: "13px", color: "#e2e8f0", marginBottom: "2px" }}>{f.name}</div>
                          <div style={{ fontSize: "10px", color: "#4a5568" }}>{formatBytes(f.size)}</div>
                        </div>
                        {step === "confirm" ? (
                          <div style={{ fontSize: "11px", color: "#718096" }}>
                            {progress[f.id] < 100 ? (
                              <span style={{ color: "#00ffa3" }}>{progress[f.id]}%</span>
                            ) : (
                              <span style={{ color: "#00ffa3" }}>✓</span>
                            )}
                          </div>
                        ) : (
                          <button onClick={() => removeFile(f.id)} style={{ background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "0" }}>×</button>
                        )}
                      </div>

                      {step === "confirm" && (
                        <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", borderRadius: "1px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${progress[f.id] || 0}%`, background: "linear-gradient(90deg, #00ffa3, #00b4ff)", transition: "width 0.1s", borderRadius: "1px" }} />
                        </div>
                      )}

                      {step !== "confirm" && (
                        <div style={{ fontSize: "9px", color: "#2d3748", letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>CID: {f.hash}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Storage layer selector */}
              {step !== "upload" && (
                <div>
                  <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: "#4a5568", marginBottom: "10px" }}>STORAGE LAYER</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {STORAGE_LAYERS.map((l) => (
                      <div key={l.id} onClick={() => setLayer(l.id)} style={{
                        padding: "12px 16px", border: `1px solid ${layer === l.id ? "rgba(0,255,163,0.4)" : "rgba(255,255,255,0.06)"}`,
                        borderRadius: "4px", cursor: "pointer", display: "flex", alignItems: "center", gap: "14px",
                        background: layer === l.id ? "rgba(0,255,163,0.04)" : "transparent", transition: "all 0.15s"
                      }}>
                        <span style={{ color: layer === l.id ? "#00ffa3" : "#4a5568", fontSize: "18px" }}>{l.icon}</span>
                        <div>
                          <div style={{ fontSize: "12px", color: layer === l.id ? "#e2e8f0" : "#718096", letterSpacing: "0.05em" }}>{l.label}</div>
                          <div style={{ fontSize: "10px", color: "#4a5568" }}>{l.desc}</div>
                        </div>
                        {layer === l.id && <div style={{ marginLeft: "auto", width: "6px", height: "6px", borderRadius: "50%", background: "#00ffa3" }} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right column — sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

              {/* Provider panel */}
              {step !== "upload" && (
                <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "6px", padding: "20px" }}>
                  <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: "#4a5568", marginBottom: "14px" }}>STORAGE PROVIDERS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {providers.map((p) => (
                      <div key={p.id} onClick={() => toggleProvider(p.id)} style={{
                        padding: "10px 12px", border: `1px solid ${p.selected ? "rgba(0,255,163,0.3)" : "rgba(255,255,255,0.05)"}`,
                        borderRadius: "4px", cursor: "pointer",
                        background: p.selected ? "rgba(0,255,163,0.04)" : "transparent", transition: "all 0.15s"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontSize: "12px", color: p.selected ? "#e2e8f0" : "#718096" }}>{p.name}</span>
                          {p.selected && <span style={{ fontSize: "10px", color: "#00ffa3" }}>▶</span>}
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                          <span style={{ fontSize: "10px", color: "#4a5568" }}>{p.price}</span>
                          <span style={{ fontSize: "10px", color: "#4a5568" }}>{p.latency}</span>
                          <span style={{ fontSize: "10px", color: "#4a5568" }}>{p.reliability}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost summary */}
              {files.length > 0 && (
                <div style={{ background: "rgba(0,255,163,0.03)", border: "1px solid rgba(0,255,163,0.12)", borderRadius: "6px", padding: "20px" }}>
                  <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: "#4a5568", marginBottom: "14px" }}>TRANSACTION SUMMARY</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {[
                      ["Files", `${files.length}`],
                      ["Total size", formatBytes(totalSize)],
                      ["Provider", selectedProvider?.name || "—"],
                      ["Layer", STORAGE_LAYERS.find(l => l.id === layer)?.label || "—"],
                      ["Est. cost", `${estimatedCost} ₳`],
                      ["Network fee", "0.175000 ₳"],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "11px", color: "#4a5568", letterSpacing: "0.05em" }}>{k}</span>
                        <span style={{ fontSize: "11px", color: "#a0aec0" }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "8px", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "11px", color: "#718096", letterSpacing: "0.05em" }}>TOTAL</span>
                      <span style={{ fontSize: "13px", color: "#00ffa3", fontWeight: "700" }}>{(parseFloat(estimatedCost) + 0.175).toFixed(6)} ₳</span>
                    </div>
                  </div>
                </div>
              )}

              {/* CTA button */}
              <button
                onClick={files.length === 0 ? () => fileRef.current?.click() : startPin}
                disabled={pinning}
                style={{
                  width: "100%", padding: "14px", fontSize: "12px", letterSpacing: "0.2em",
                  border: "none", borderRadius: "4px", cursor: pinning ? "wait" : "pointer",
                  background: files.length === 0
                    ? "rgba(255,255,255,0.06)"
                    : pinning
                    ? "rgba(0,255,163,0.3)"
                    : "linear-gradient(135deg, #00ffa3, #00d4ff)",
                  color: files.length === 0 ? "#4a5568" : "#000",
                  fontWeight: "700", transition: "all 0.2s",
                  fontFamily: "inherit"
                }}
              >
                {pinning
                  ? "PINNING..."
                  : !wallet.connected
                  ? "CONNECT & PIN"
                  : files.length === 0
                  ? "SELECT FILES FIRST"
                  : "PIN TO CARDANO"}
              </button>

              {!wallet.connected && files.length > 0 && (
                <div style={{ fontSize: "10px", color: "#4a5568", textAlign: "center", letterSpacing: "0.08em" }}>
                  Wallet connection required to sign the pin transaction
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ position: "relative", zIndex: 10, borderTop: "1px solid rgba(255,255,255,0.05)", padding: "16px 32px", display: "flex", justifyContent: "space-between", marginTop: "40px" }}>
        <span style={{ fontSize: "10px", color: "#2d3748", letterSpacing: "0.1em" }}>CARDANO VAULT — EXPERIMENTAL BUILD</span>
        <span style={{ fontSize: "10px", color: "#2d3748", letterSpacing: "0.1em" }}>PREPROD TESTNET</span>
      </footer>
    </div>
  );
}
