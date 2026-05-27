import { useState, useRef, useCallback } from "react";
import { useListProviders, getListProvidersQueryKey } from "@workspace/api-client-react";
import { THT } from "@/lib/token";
import { useWallet } from "@/contexts/WalletContext";

const STORAGE_LAYERS = [
  { id: "ipfs", label: "IPFS + Filecoin", icon: "◈", desc: "Content-addressed, distributed" },
  { id: "arweave", label: "Arweave", icon: "◉", desc: "Permanent, pay-once storage" },
  { id: "custom", label: "Cardano Native", icon: "◆", desc: "On-chain metadata anchoring" },
];

const STEPS = ["upload", "configure", "confirm", "done"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS = ["SELECT FILES", "CONFIGURE", "PIN & SIGN", "COMPLETE"];

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function hashPreview(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return "Qm" + Math.abs(hash).toString(16).padStart(44, "a").slice(0, 44);
}

interface QueuedFile {
  file: File;
  id: string;
  name: string;
  size: number;
  hash: string;
}

interface PinnedFile extends QueuedFile {
  txId: string;
  ts: string;
}

const g = {
  accent: "#00ffa3",
  accentBlue: "#00b4ff",
  bg: "rgba(255,255,255,0.015)",
  border: "rgba(255,255,255,0.07)",
  borderAccent: "rgba(0,255,163,0.3)",
  dim: "#4a5568",
  mid: "#718096",
  text: "#e2e8f0",
  mono: "'Space Mono', 'Courier New', monospace",
};

export default function PinFiles() {
  const { connected: walletConnected, connecting, connect, disconnect, displayAddress, thtBalance, adaBalance } = useWallet();
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [layer, setLayer] = useState("ipfs");
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState<PinnedFile[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [step, setStep] = useState<Step>("upload");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: providers } = useListProviders(
    { status: "active" },
    { query: { queryKey: getListProvidersQueryKey({ status: "active" }) } }
  );

  const activeProviders = providers ?? [];
  const selectedProvider = activeProviders.find((p) => p.id === selectedProviderId) ?? activeProviders[0];

  const onDrop = useCallback(
    (e: React.DragEvent | React.ChangeEvent<HTMLInputElement>) => {
      if ("preventDefault" in e) e.preventDefault();
      setDragging(false);
      const raw =
        "dataTransfer" in e ? e.dataTransfer?.files : (e.target as HTMLInputElement).files;
      const dropped = Array.from(raw || []);
      const mapped: QueuedFile[] = dropped.map((f) => ({
        file: f,
        id: Math.random().toString(36).slice(2),
        name: f.name,
        size: f.size,
        hash: hashPreview(f.name + f.size),
      }));
      setFiles((prev) => [...prev, ...mapped]);
      if (mapped.length > 0 && step === "upload") setStep("configure");
    },
    [step]
  );

  const removeFile = (id: string) => setFiles((f) => f.filter((x) => x.id !== id));

  const startPin = async () => {
    if (!walletConnected) {
      setWalletConnected(true);
      return;
    }
    setPinning(true);
    setStep("confirm");
    const progs: Record<string, number> = {};
    files.forEach((f) => (progs[f.id] = 0));
    setProgress(progs);

    for (const f of files) {
      for (let i = 0; i <= 100; i += Math.random() * 15 + 5) {
        await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));
        setProgress((p) => ({ ...p, [f.id]: Math.min(100, Math.round(i)) }));
      }
      setProgress((p) => ({ ...p, [f.id]: 100 }));
      setPinned((prev) => [
        ...prev,
        { ...f, txId: "tx1" + Math.random().toString(36).slice(2, 14), ts: new Date().toISOString() },
      ]);
    }
    setPinning(false);
    setStep("done");
  };

  const reset = () => {
    setFiles([]);
    setPinned([]);
    setProgress({});
    setStep("upload");
  };

  const totalSize = files.reduce((a, f) => a + f.size, 0);
  const pricePerGb = selectedProvider?.pricePerGbPerEpoch ?? 0.00012;
  const estimatedCost = ((totalSize / 1e9) * pricePerGb * 120).toFixed(6);
  const totalCost = (parseFloat(estimatedCost) + 0.175).toFixed(6);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ fontFamily: g.mono }}>
      {/* Wallet bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "32px", paddingBottom: "16px",
        borderBottom: "1px solid rgba(0,255,163,0.12)"
      }}>
        <div>
          <p style={{ fontSize: "20px", letterSpacing: "0.15em", color: g.accent, fontWeight: 700, margin: 0 }}>
            PIN FILES
          </p>
          <p style={{ fontSize: "11px", color: g.dim, letterSpacing: "0.12em", margin: "4px 0 0" }}>
            ANCHOR DATA TO CARDANO
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {walletConnected && (
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "11px", color: g.mid, letterSpacing: "0.08em" }}>
                <span style={{ color: g.accent }}>◉</span>{" "}
                <span style={{ color: "#a0aec0" }}>{displayAddress}</span>
              </span>
              <div style={{ fontSize: "10px", color: g.dim, marginTop: "2px", display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <span><span style={{ color: g.accent }}>{thtBalance != null ? thtBalance.toLocaleString() : "—"}</span> THT</span>
                <span>₳ {adaBalance != null ? adaBalance.toFixed(2) : "—"}</span>
              </div>
            </div>
          )}
          <button
            onClick={walletConnected ? disconnect : connect}
            disabled={connecting}
            style={{
              background: walletConnected ? "rgba(0,255,163,0.08)" : "transparent",
              border: `1px solid ${walletConnected ? g.accent : "rgba(255,255,255,0.15)"}`,
              color: walletConnected ? g.accent : "#a0aec0",
              padding: "6px 16px", fontSize: "11px", letterSpacing: "0.15em",
              cursor: connecting ? "wait" : "pointer", borderRadius: "2px",
              transition: "all 0.2s", fontFamily: g.mono, opacity: connecting ? 0.7 : 1
            }}
          >
            {connecting ? "CONNECTING..." : walletConnected ? "● CONNECTED" : "CONNECT ETERNL"}
          </button>
        </div>
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: "36px" }}>
        {STEPS.map((s, i) => {
          const active = STEPS.indexOf(step) >= i;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: i < 3 ? 1 : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                <div style={{
                  width: "28px", height: "28px", borderRadius: "50%",
                  border: `1px solid ${active ? g.accent : "rgba(255,255,255,0.1)"}`,
                  background: step === s ? g.accent : active ? "rgba(0,255,163,0.12)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "11px", color: step === s ? "#000" : active ? g.accent : g.dim,
                  fontWeight: "700", transition: "all 0.3s"
                }}>{i + 1}</div>
                <span style={{ fontSize: "9px", letterSpacing: "0.1em", color: active ? g.accent : g.dim, whiteSpace: "nowrap" }}>
                  {STEP_LABELS[i]}
                </span>
              </div>
              {i < 3 && (
                <div style={{
                  flex: 1, height: "1px",
                  background: active && STEPS.indexOf(step) > i ? "rgba(0,255,163,0.4)" : "rgba(255,255,255,0.08)",
                  margin: "0 8px 20px"
                }} />
              )}
            </div>
          );
        })}
      </div>

      {step === "done" ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px", color: g.accent }}>◆</div>
          <div style={{ fontSize: "20px", letterSpacing: "0.2em", color: g.accent, marginBottom: "8px" }}>
            PINNED SUCCESSFULLY
          </div>
          <div style={{ fontSize: "12px", color: g.dim, marginBottom: "40px" }}>
            {pinned.length} file{pinned.length !== 1 ? "s" : ""} anchored to Cardano
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "40px", maxWidth: "600px", margin: "0 auto 40px" }}>
            {pinned.map((f) => (
              <div key={f.id} style={{
                background: "rgba(0,255,163,0.04)", border: "1px solid rgba(0,255,163,0.15)",
                borderRadius: "4px", padding: "16px 20px", textAlign: "left"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", color: g.text }}>{f.name}</span>
                  <span style={{ fontSize: "11px", color: g.accent }}>✓ PINNED</span>
                </div>
                <div style={{ fontSize: "10px", color: g.dim, letterSpacing: "0.08em" }}>CID: {f.hash}</div>
                <div style={{ fontSize: "10px", color: g.dim, letterSpacing: "0.08em" }}>TX: {f.txId}</div>
              </div>
            ))}
          </div>

          <button onClick={reset} style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
            color: "#a0aec0", padding: "10px 32px", fontSize: "11px",
            letterSpacing: "0.15em", cursor: "pointer", borderRadius: "2px", fontFamily: g.mono
          }}>
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
                border: `1px dashed ${dragging ? g.accent : "rgba(255,255,255,0.12)"}`,
                borderRadius: "6px", padding: "48px 24px", textAlign: "center",
                cursor: "pointer", transition: "all 0.2s",
                background: dragging ? "rgba(0,255,163,0.04)" : "rgba(255,255,255,0.01)",
              }}
            >
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={onDrop} />
              <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.4 }}>⬡</div>
              <div style={{ fontSize: "13px", letterSpacing: "0.15em", color: dragging ? g.accent : g.mid, marginBottom: "6px" }}>
                {dragging ? "RELEASE TO QUEUE" : "DROP FILES TO PIN"}
              </div>
              <div style={{ fontSize: "11px", color: g.dim }}>or click to browse — any file type</div>
            </div>

            {/* File queue */}
            {files.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: g.dim, marginBottom: "4px" }}>
                  QUEUE — {files.length} FILE{files.length !== 1 ? "S" : ""}
                </div>
                {files.map((f) => (
                  <div key={f.id} style={{
                    background: "rgba(255,255,255,0.02)", border: `1px solid ${g.border}`,
                    borderRadius: "4px", padding: "12px 16px"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                      <div>
                        <div style={{ fontSize: "13px", color: g.text, marginBottom: "2px" }}>{f.name}</div>
                        <div style={{ fontSize: "10px", color: g.dim }}>{formatBytes(f.size)}</div>
                      </div>
                      {step === "confirm" ? (
                        <div style={{ fontSize: "11px", color: g.mid }}>
                          {(progress[f.id] ?? 0) < 100
                            ? <span style={{ color: g.accent }}>{progress[f.id] ?? 0}%</span>
                            : <span style={{ color: g.accent }}>✓</span>}
                        </div>
                      ) : (
                        <button onClick={() => removeFile(f.id)} style={{ background: "none", border: "none", color: g.dim, cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: 0 }}>×</button>
                      )}
                    </div>

                    {step === "confirm" && (
                      <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", borderRadius: "1px", overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${progress[f.id] || 0}%`,
                          background: `linear-gradient(90deg, ${g.accent}, ${g.accentBlue})`,
                          transition: "width 0.1s", borderRadius: "1px"
                        }} />
                      </div>
                    )}

                    {step !== "confirm" && (
                      <div style={{ fontSize: "9px", color: "#2d3748", letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        CID: {f.hash}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Storage layer selector */}
            {step !== "upload" && (
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: g.dim, marginBottom: "10px" }}>STORAGE LAYER</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {STORAGE_LAYERS.map((l) => (
                    <div key={l.id} onClick={() => setLayer(l.id)} style={{
                      padding: "12px 16px",
                      border: `1px solid ${layer === l.id ? "rgba(0,255,163,0.4)" : "rgba(255,255,255,0.06)"}`,
                      borderRadius: "4px", cursor: "pointer", display: "flex", alignItems: "center", gap: "14px",
                      background: layer === l.id ? "rgba(0,255,163,0.04)" : "transparent", transition: "all 0.15s"
                    }}>
                      <span style={{ color: layer === l.id ? g.accent : g.dim, fontSize: "18px" }}>{l.icon}</span>
                      <div>
                        <div style={{ fontSize: "12px", color: layer === l.id ? g.text : g.mid, letterSpacing: "0.05em" }}>{l.label}</div>
                        <div style={{ fontSize: "10px", color: g.dim }}>{l.desc}</div>
                      </div>
                      {layer === l.id && <div style={{ marginLeft: "auto", width: "6px", height: "6px", borderRadius: "50%", background: g.accent }} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Provider panel */}
            {step !== "upload" && (
              <div style={{ background: g.bg, border: `1px solid ${g.border}`, borderRadius: "6px", padding: "20px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: g.dim, marginBottom: "14px" }}>STORAGE PROVIDERS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {activeProviders.map((p) => {
                    const sel = p.id === (selectedProvider?.id);
                    return (
                      <div key={p.id} onClick={() => setSelectedProviderId(p.id)} style={{
                        padding: "10px 12px",
                        border: `1px solid ${sel ? g.borderAccent : "rgba(255,255,255,0.05)"}`,
                        borderRadius: "4px", cursor: "pointer",
                        background: sel ? "rgba(0,255,163,0.04)" : "transparent", transition: "all 0.15s"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontSize: "12px", color: sel ? g.text : g.mid }}>{p.name}</span>
                          {sel && <span style={{ fontSize: "10px", color: g.accent }}>▶</span>}
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                          <span style={{ fontSize: "10px", color: g.dim }}>{p.pricePerGbPerEpoch.toFixed(5)} THT/GB</span>
                          <span style={{ fontSize: "10px", color: g.dim }}>{p.region}</span>
                          <span style={{ fontSize: "10px", color: g.dim }}>{p.uptimePercent?.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cost summary */}
            {files.length > 0 && (
              <div style={{ background: "rgba(0,255,163,0.03)", border: "1px solid rgba(0,255,163,0.12)", borderRadius: "6px", padding: "20px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: g.dim, marginBottom: "14px" }}>TRANSACTION SUMMARY</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {([
                    ["Files", `${files.length}`],
                    ["Total size", formatBytes(totalSize)],
                    ["Provider", selectedProvider?.name ?? "—"],
                    ["Layer", STORAGE_LAYERS.find((l) => l.id === layer)?.label ?? "—"],
                    ["Est. cost", `${estimatedCost} THT`],
                    ["Network fee", "0.175000 THT"],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "11px", color: g.dim, letterSpacing: "0.05em" }}>{k}</span>
                      <span style={{ fontSize: "11px", color: "#a0aec0" }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: `1px solid ${g.border}`, paddingTop: "8px", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "11px", color: g.mid, letterSpacing: "0.05em" }}>TOTAL</span>
                    <span style={{ fontSize: "13px", color: g.accent, fontWeight: "700" }}>
                      {totalCost} THT
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* CTA */}
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
                  : `linear-gradient(135deg, ${g.accent}, ${g.accentBlue})`,
                color: files.length === 0 ? g.dim : "#000",
                fontWeight: "700", transition: "all 0.2s", fontFamily: g.mono
              }}
            >
              {pinning
                ? "PINNING..."
                : !walletConnected
                ? "CONNECT & PIN"
                : files.length === 0
                ? "SELECT FILES FIRST"
                : "PIN TO CARDANO"}
            </button>

            {!walletConnected && files.length > 0 && (
              <div style={{ fontSize: "10px", color: g.dim, textAlign: "center", letterSpacing: "0.08em" }}>
                Wallet connection required to sign the pin transaction
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: "48px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "10px", color: "#2d3748", letterSpacing: "0.1em" }}>ADADIVE by THETA</span>
        <span style={{ fontSize: "10px", color: "#2d3748", letterSpacing: "0.1em" }}>PREPROD TESTNET</span>
      </div>
    </div>
  );
}
