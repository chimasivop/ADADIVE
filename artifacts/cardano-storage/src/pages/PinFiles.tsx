import { useState, useRef, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useListProviders, getListProvidersQueryKey } from "@workspace/api-client-react";
import { THT } from "@/lib/token";
import { useWallet } from "@/contexts/WalletContext";
import { useSignableWallet } from "@/hooks/useSignableWallet";
import { useBackendSession } from "@/hooks/useBackendSession";
import { explorerTxUrl, NETWORK_LABEL } from "@/lib/chain";
import { initializeEscrow, solToLamports } from "@/lib/escrowService";

const STORAGE_LAYERS = [
  { id: "ipfs",    label: "IPFS + Filecoin",  icon: "◈", desc: "Content-addressed, distributed" },
  { id: "arweave", label: "Arweave",           icon: "◉", desc: "Permanent, pay-once storage" },
  { id: "custom",  label: "Solana Native",     icon: "◆", desc: "On-chain metadata anchoring" },
];

const STEPS = ["upload", "configure", "confirm", "done"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS = ["SELECT", "CONFIGURE", "SIGN", "DONE"];

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

interface QueuedFile { file: File; id: string; name: string; size: number; hash: string; }
interface PinnedFile extends QueuedFile {
  ts: string;
  realCid?: string;
  gatewayUrl?: string;
  metadataCid?: string;
  txHash?: string;
  explorerUrl?: string;
  failed?: boolean;
  failReason?: string;
}

const g = {
  accent:       "#00ffa3",
  accentBlue:   "#00d4ff",
  bg:           "hsl(var(--card))",
  border:       "hsl(var(--primary)/0.14)",
  borderAccent: "hsl(var(--primary)/0.4)",
  dim:          "hsl(var(--muted-foreground))",
  mid:          "hsl(var(--foreground)/0.75)",
  text:         "hsl(var(--foreground))",
  mono:         "'DM Mono', 'Space Mono', monospace",
};

interface DealResult {
  file: { cid: string; gatewayUrl: string; ipfsUrl: string; size: number };
  metadataCid: string;
  metadataUrl: string;
  /**
   * The backend's deal package. The field still carries its original name, and
   * still carries the on-chain description of the pin; the anchor transaction is
   * now a Solana initialize rather than a CIP-1337 metadata attachment, so
   * `escrow` is what the client reads from it.
   */
  cardanoMetadata: unknown;
  escrow?: {
    dealId: string;
    provider: string;
    oracle: string;
    amountLamports: string;
  };
}

export default function PinFiles() {
  const { connected: walletConnected, connecting, connect, disconnect, displayAddress, thtBalance, adaBalance } = useWallet();
  const { connection }                      = useConnection();
  const signableWallet                      = useSignableWallet();
  const { ensureSession }                   = useBackendSession();
  const [files, setFiles]                   = useState<QueuedFile[]>([]);
  const [dragging, setDragging]             = useState(false);
  const [layer, setLayer]                   = useState("ipfs");
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [pinning, setPinning]               = useState(false);
  const [pinned, setPinned]                 = useState<PinnedFile[]>([]);
  const [progress, setProgress]             = useState<Record<string, number>>({});
  const [phase, setPhase]                   = useState<Record<string, string>>({});
  const [step, setStep]                     = useState<Step>("upload");
  const [pinError, setPinError]             = useState<string | null>(null);
  const fileRef                             = useRef<HTMLInputElement>(null);

  const { data: providers } = useListProviders(
    { status: "active" },
    { query: { queryKey: getListProvidersQueryKey({ status: "active" }) } }
  );

  const activeProviders  = providers ?? [];
  const selectedProvider = activeProviders.find((p) => p.id === selectedProviderId) ?? activeProviders[0];

  const onDrop = useCallback(
    (e: React.DragEvent | React.ChangeEvent<HTMLInputElement>) => {
      if ("preventDefault" in e) e.preventDefault();
      setDragging(false);
      const raw = "dataTransfer" in e ? e.dataTransfer?.files : (e.target as HTMLInputElement).files;
      const dropped = Array.from(raw || []);
      const mapped: QueuedFile[] = dropped.map((f) => ({
        file: f, id: Math.random().toString(36).slice(2),
        name: f.name, size: f.size, hash: hashPreview(f.name + f.size),
      }));
      setFiles((prev) => [...prev, ...mapped]);
      if (mapped.length > 0 && step === "upload") setStep("configure");
    },
    [step]
  );

  const removeFile = (id: string) => setFiles((f) => f.filter((x) => x.id !== id));

  const startPin = async () => {
    if (!walletConnected) { connect(); return; }
    setPinning(true);
    setPinError(null);
    setStep("confirm");

    const progs: Record<string, number> = {};
    const phases: Record<string, string> = {};
    files.forEach((f) => { progs[f.id] = 0; phases[f.id] = "Starting…"; });
    setProgress(progs);
    setPhase(phases);

    // The initialize transaction signs as the depositor, so a connection without
    // a signable wallet cannot proceed. Checked once, up front, rather than
    // failing per file.
    if (!signableWallet || !displayAddress) {
      setPinning(false);
      setPinError("Connect a Solana wallet before pinning — the escrow is initialized from it.");
      return;
    }

    let anyFailed = false;

    for (const f of files) {
      const setP = (pct: number) => setProgress((p) => ({ ...p, [f.id]: pct }));
      const setLbl = (lbl: string) => setPhase((p) => ({ ...p, [f.id]: lbl }));

      try {
        // ── Phase 1: IPFS pin ─────────────────────────────
        setLbl("Pinning to IPFS…"); setP(15);

        const formData = new FormData();
        formData.append("file", f.file);
        formData.append("providerAddress", selectedProvider?.nodeId ?? "");
        formData.append("userAddress", displayAddress ?? "");
        formData.append("durationEpochs", "10");
        formData.append("pricePerEpochTHT", String(selectedProvider?.pricePerGbPerEpoch ?? 0.0013));

        setP(35);
        const response = await fetch("/api/storage/pin", { method: "POST", body: formData });
        setP(55);

        if (!response.ok) {
          const err = await response.json() as { error?: string };
          throw new Error(err.error ?? `HTTP ${response.status}`);
        }

        const deal = await response.json() as DealResult;
        setLbl("IPFS pinned ✓ — building tx…"); setP(60);

        // ── Phase 2: initialize the on-chain escrow ───────
        // The old code attached CIP-1337 metadata to a self-transfer. The
        // equivalent on Solana is a real escrow: the depositor locks the deal
        // amount into a PDA owned by the program, naming the provider and the
        // oracle. The provider and oracle come from the backend's deal package
        // when it supplies them; otherwise the connected wallet's own key is the
        // stand-in provider, matching the prototype's local-validator walkthrough.
        const escrow = deal.escrow;
        const oracleKey = new PublicKey(
          import.meta.env.VITE_ORACLE_PUBKEY ?? displayAddress
        );
        const providerKey = escrow?.provider
          ? new PublicKey(escrow.provider)
          : new PublicKey(displayAddress);
        const dealId = escrow?.dealId ?? deal.file.cid;
        const amountLamports = escrow?.amountLamports
          ? BigInt(escrow.amountLamports)
          : solToLamports(parseFloat(totalCost));

        let txPct = 60;
        const initResult = await initializeEscrow({
          connection,
          depositor: signableWallet,
          provider: providerKey,
          oracle: oracleKey,
          amountLamports,
          dealId,
          onProgress: (msg) => {
            setLbl(msg);
            txPct = Math.min(95, txPct + 9);
            setP(txPct);
          },
        });

        // Register the deal with the oracle backend so the settle flow can find
        // it. This signs nothing and submits no transaction — it is one
        // authenticated POST, and a deal the backend does not know about cannot
        // be settled through it.
        try {
          const token = await ensureSession();
          const dealPda = initResult.dealPda.toBase58();
          await fetch(`${import.meta.env.VITE_BACKEND_ENDPOINT ?? "/backend"}/deals`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              dealId,
              dealPda,
              depositor: displayAddress,
              provider: providerKey.toBase58(),
              oracle: oracleKey.toBase58(),
              cid: deal.file.cid,
              amountLamports: amountLamports.toString(),
            }),
          });
        } catch (registerErr) {
          // Registration failing does not undo the on-chain initialize; report it
          // on the file's own card rather than aborting the whole batch.
          const msg = registerErr instanceof Error ? registerErr.message : String(registerErr);
          setLbl(`Anchored ✓ — backend registration failed: ${msg}`);
        }

        const txSignature = initResult.signature;
        setP(100); setLbl("Anchored ✓");
        setPinned((prev) => [
          ...prev,
          {
            ...f,
            ts:          new Date().toISOString(),
            realCid:     deal.file.cid,
            gatewayUrl:  deal.file.gatewayUrl,
            metadataCid: deal.metadataCid,
            txHash:      txSignature,
            explorerUrl: explorerTxUrl(txSignature),
          },
        ]);
      } catch (err) {
        anyFailed = true;
        const msg = err instanceof Error ? err.message : String(err);
        setLbl("Failed"); setP(100);
        setPinned((prev) => [
          ...prev,
          { ...f, ts: new Date().toISOString(), failed: true, failReason: msg },
        ]);
        setPinError(`Error: ${msg}`);
      }
    }

    setPinning(false);
    setStep("done");
  };

  const reset = () => { setFiles([]); setPinned([]); setProgress({}); setStep("upload"); setPinError(null); };

  const totalSize      = files.reduce((a, f) => a + f.size, 0);
  const pricePerGb     = selectedProvider?.pricePerGbPerEpoch ?? 0.00012;
  const estimatedCost  = ((totalSize / 1e9) * pricePerGb * 120).toFixed(6);
  const totalCost      = (parseFloat(estimatedCost) + 0.175).toFixed(6);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ fontFamily: g.mono }}>

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4"
        style={{ borderBottom: "1px solid hsl(var(--primary)/0.15)" }}>
        <div>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: "clamp(16px,4vw,22px)", letterSpacing: "0.2em", color: "hsl(var(--primary))", fontWeight: 700 }}>
            PIN FILES
          </p>
          <p style={{ fontSize: "12px", color: g.dim, letterSpacing: "0.1em", marginTop: "3px", fontStyle: "italic", fontFamily: "'Cormorant Garamond', serif" }}>
            Anchor data to the Solana network
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {walletConnected && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", color: g.mid }}>
                <span style={{ color: g.accent }}>◉</span>{" "}
                <span style={{ color: "hsl(var(--muted-foreground))", fontSize: "10px" }}>{displayAddress}</span>
              </div>
              <div style={{ fontSize: "10px", color: g.dim, display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "2px" }}>
                <span><span style={{ color: g.accent }}>{thtBalance != null ? thtBalance.toFixed(4) : "—"}</span> SOL</span>
                <span>◎ {adaBalance != null ? adaBalance.toFixed(2) : "—"}</span>
              </div>
            </div>
          )}
          <button
            onClick={walletConnected ? disconnect : connect}
            disabled={connecting}
            style={{
              background: walletConnected ? "rgba(0,255,163,0.08)" : "transparent",
              border: `1px solid ${walletConnected ? g.accent : "hsl(var(--primary)/0.25)"}`,
              color: walletConnected ? g.accent : "hsl(var(--muted-foreground))",
              padding: "7px 14px", fontSize: "10px", letterSpacing: "0.15em",
              cursor: connecting ? "wait" : "pointer", borderRadius: "2px",
              transition: "all 0.2s", fontFamily: g.mono, whiteSpace: "nowrap",
            }}
          >
            {connecting ? "CONNECTING..." : walletConnected ? "● CONNECTED" : "CONNECT PHANTOM"}
          </button>
        </div>
      </div>

      {/* ── Step indicator ── */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => {
          const active = STEPS.indexOf(step) >= i;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: i < 3 ? 1 : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                <div style={{
                  width: "26px", height: "26px", borderRadius: "50%",
                  border: `1px solid ${active ? "hsl(var(--primary))" : "hsl(var(--primary)/0.18)"}`,
                  background: step === s ? "hsl(var(--primary))" : active ? "hsl(var(--primary)/0.12)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "10px", color: step === s ? "hsl(var(--primary-foreground))" : active ? "hsl(var(--primary))" : g.dim,
                  fontWeight: "700", transition: "all 0.3s", flexShrink: 0,
                }}>{i + 1}</div>
                <span style={{ fontSize: "8px", letterSpacing: "0.1em", color: active ? "hsl(var(--primary))" : g.dim, whiteSpace: "nowrap" }}>
                  {STEP_LABELS[i]}
                </span>
              </div>
              {i < 3 && (
                <div style={{
                  flex: 1, height: "1px",
                  background: active && STEPS.indexOf(step) > i ? "hsl(var(--primary)/0.4)" : "hsl(var(--primary)/0.1)",
                  margin: "0 6px 20px",
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Done screen ── */}
      {step === "done" ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px", color: "hsl(var(--primary))" }} className="vault-pulse">◆</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: "20px", letterSpacing: "0.2em", color: "hsl(var(--primary))", marginBottom: "8px" }}>
            {pinned.some(p => !p.failed) ? "ANCHORED" : "FAILED"}
          </div>
          <div style={{ fontSize: "13px", color: g.dim, marginBottom: "40px", fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic" }}>
            {pinned.filter(p => !p.failed && p.txHash).length > 0
              ? `${pinned.filter(p => !p.failed).length} of ${pinned.length} file${pinned.length !== 1 ? "s" : ""} anchored to Solana Devnet`
              : `${pinned.filter(p => !p.failed).length} of ${pinned.length} file${pinned.length !== 1 ? "s" : ""} pinned to IPFS`}
          </div>

          {pinError && (
            <div style={{ maxWidth: "520px", margin: "0 auto 24px", padding: "12px 16px", background: "rgba(224,92,92,0.08)", border: "1px solid rgba(224,92,92,0.25)", borderRadius: "4px", textAlign: "left" }}>
              <p style={{ fontFamily: g.mono, fontSize: "10px", color: "#e05c5c", letterSpacing: "0.08em" }}>{pinError}</p>
            </div>
          )}

          <div className="flex flex-col gap-3 mb-10 max-w-xl mx-auto">
            {pinned.map((f) => f.failed ? (
              <div key={f.id} style={{
                background: "rgba(224,92,92,0.05)", border: "1px solid rgba(224,92,92,0.2)",
                borderRadius: "4px", padding: "14px 16px", textAlign: "left",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "12px", color: g.text }}>{f.name}</span>
                  <span style={{ fontSize: "10px", color: "#e05c5c" }}>✗ FAILED</span>
                </div>
                <div style={{ fontSize: "9px", color: "#e05c5c", letterSpacing: "0.06em" }}>{f.failReason}</div>
              </div>
            ) : (
              <div key={f.id} style={{
                background: "rgba(0,255,163,0.04)", border: "1px solid rgba(0,255,163,0.15)",
                borderRadius: "4px", padding: "14px 16px", textAlign: "left",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "4px" }}>
                  <span style={{ fontSize: "12px", color: g.text }}>{f.name}</span>
                  <span style={{ fontSize: "10px", color: g.accent }}>{f.txHash ? "✓ ANCHORED" : "✓ PINNED"}</span>
                </div>

                {/* IPFS CID */}
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "5px" }}>
                  <span style={{ fontSize: "9px", color: g.dim, opacity: 0.7, flexShrink: 0, letterSpacing: "0.06em" }}>IPFS CID</span>
                  {f.gatewayUrl ? (
                    <a href={f.gatewayUrl} target="_blank" rel="noopener noreferrer"
                      title={f.realCid}
                      style={{ fontSize: "9px", color: g.accent, fontFamily: g.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>
                      {(f.realCid ?? f.hash).slice(0, 28)}…
                    </a>
                  ) : (
                    <span style={{ fontSize: "9px", color: g.accent, fontFamily: g.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(f.realCid ?? f.hash).slice(0, 28)}…
                    </span>
                  )}
                </div>

                {/* Solana tx */}
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{ fontSize: "9px", color: g.dim, opacity: 0.7, flexShrink: 0, letterSpacing: "0.06em" }}>SOLANA TX</span>
                  {f.txHash ? (
                    <a href={f.explorerUrl} target="_blank" rel="noopener noreferrer"
                      title={f.txHash}
                      style={{ fontSize: "9px", color: "#00d4ff", fontFamily: g.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline" }}>
                      {f.txHash.slice(0, 28)}…
                    </a>
                  ) : (
                    <span style={{ fontSize: "9px", color: g.dim, opacity: 0.5 }}>not anchored</span>
                  )}
                </div>

                {/* Action links */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {f.gatewayUrl && (
                    <a href={f.gatewayUrl} target="_blank" rel="noopener noreferrer" style={{
                      fontFamily: "'Cinzel', serif", fontSize: "7px", letterSpacing: "0.16em",
                      padding: "4px 10px", border: "1px solid rgba(0,255,163,0.3)", borderRadius: "2px",
                      color: g.accent, textDecoration: "none", whiteSpace: "nowrap",
                    }}>VIEW ON IPFS ↗</a>
                  )}
                  {f.explorerUrl && (
                    <a href={f.explorerUrl} target="_blank" rel="noopener noreferrer" style={{
                      fontFamily: "'Cinzel', serif", fontSize: "7px", letterSpacing: "0.16em",
                      padding: "4px 10px", border: "1px solid rgba(0,212,255,0.3)", borderRadius: "2px",
                      color: "#00d4ff", textDecoration: "none", whiteSpace: "nowrap",
                    }}>VIEW ON EXPLORER ↗</a>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button onClick={reset} style={{
            background: "transparent", border: "1px solid hsl(var(--primary)/0.3)",
            color: "hsl(var(--muted-foreground))", padding: "10px 32px", fontSize: "11px",
            letterSpacing: "0.2em", cursor: "pointer", borderRadius: "2px",
            fontFamily: "'Cinzel', serif", transition: "all 0.2s",
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--primary))"; (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--primary))"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "hsl(var(--primary)/0.3)"; (e.currentTarget as HTMLButtonElement).style.color = "hsl(var(--muted-foreground))"; }}
          >
            PIN MORE FILES
          </button>
        </div>
      ) : (
        /* ── Responsive 2-col → 1-col grid ── */
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

          {/* Left column */}
          <div className="flex flex-col gap-5">

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `1px dashed ${dragging ? "hsl(var(--primary))" : "hsl(var(--primary)/0.2)"}`,
                borderRadius: "4px", padding: "clamp(28px, 6vw, 52px) 20px", textAlign: "center",
                cursor: "pointer", transition: "all 0.2s",
                background: dragging ? "hsl(var(--primary)/0.04)" : "transparent",
              }}
            >
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={onDrop} />
              <div style={{ fontSize: "28px", marginBottom: "10px", opacity: 0.4, color: "hsl(var(--primary))" }}>⬡</div>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: "11px", letterSpacing: "0.28em", color: dragging ? "hsl(var(--primary))" : g.mid, marginBottom: "6px", transition: "color 0.2s" }}>
                {dragging ? "RELEASE TO QUEUE" : "DROP FILES HERE"}
              </div>
              <div style={{ fontSize: "11px", color: g.dim }}>or click to browse — any file type</div>
            </div>

            {/* File queue */}
            {files.length > 0 && (
              <div className="flex flex-col gap-2">
                <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: g.dim }}>
                  QUEUE — {files.length} FILE{files.length !== 1 ? "S" : ""}
                </div>
                {files.map((f) => (
                  <div key={f.id} style={{
                    background: "hsl(var(--muted)/0.5)", border: "1px solid hsl(var(--primary)/0.12)",
                    borderRadius: "3px", padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                      <div style={{ minWidth: 0, flex: 1, marginRight: "8px" }}>
                        <div style={{ fontSize: "12px", color: g.text, marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                        <div style={{ fontSize: "10px", color: g.dim }}>{formatBytes(f.size)}</div>
                      </div>
                      {step === "confirm" ? (
                        <span style={{ fontSize: "10px", color: (progress[f.id] ?? 0) < 100 ? "hsl(var(--primary))" : g.accent, flexShrink: 0 }}>
                          {(progress[f.id] ?? 0) < 100 ? `${progress[f.id] ?? 0}%` : "✓"}
                        </span>
                      ) : (
                        <button onClick={() => removeFile(f.id)} style={{ background: "none", border: "none", color: g.dim, cursor: "pointer", fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>×</button>
                      )}
                    </div>
                    {step === "confirm" && (
                      <>
                        <div style={{ height: "2px", background: "hsl(var(--primary)/0.12)", borderRadius: "1px", overflow: "hidden", marginBottom: "5px" }}>
                          <div style={{
                            height: "100%", width: `${progress[f.id] || 0}%`,
                            background: `linear-gradient(90deg, ${g.accent}, ${g.accentBlue})`,
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <div style={{ fontSize: "9px", color: "hsl(var(--primary))", letterSpacing: "0.06em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.85 }}>
                          {phase[f.id] ?? "…"}
                        </div>
                      </>
                    )}
                    {step !== "confirm" && (
                      <div style={{ fontSize: "9px", color: g.dim, letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Preview CID: {f.hash}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Storage layer */}
            {step !== "upload" && (
              <div>
                <div style={{ fontSize: "9px", letterSpacing: "0.18em", color: g.dim, marginBottom: "10px" }}>STORAGE LAYER</div>
                <div className="flex flex-col gap-2">
                  {STORAGE_LAYERS.map((l) => (
                    <div key={l.id} onClick={() => setLayer(l.id)} style={{
                      padding: "12px 14px",
                      border: `1px solid ${layer === l.id ? "hsl(var(--primary)/0.5)" : "hsl(var(--primary)/0.1)"}`,
                      borderRadius: "3px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px",
                      background: layer === l.id ? "hsl(var(--primary)/0.05)" : "transparent", transition: "all 0.15s",
                    }}>
                      <span style={{ color: layer === l.id ? "hsl(var(--primary))" : g.dim, fontSize: "16px", flexShrink: 0 }}>{l.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "11px", color: layer === l.id ? "hsl(var(--primary))" : g.mid, letterSpacing: "0.08em" }}>{l.label}</div>
                        <div style={{ fontSize: "10px", color: g.dim }}>{l.desc}</div>
                      </div>
                      {layer === l.id && <div style={{ marginLeft: "auto", width: "6px", height: "6px", borderRadius: "50%", background: "hsl(var(--primary))", flexShrink: 0 }} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-4">

            {/* Providers */}
            {step !== "upload" && (
              <div style={{ background: "hsl(var(--primary)/0.03)", border: "1px solid hsl(var(--primary)/0.12)", borderRadius: "4px", padding: "18px" }}>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: "9px", letterSpacing: "0.28em", color: "hsl(var(--primary))", marginBottom: "12px", opacity: 0.8 }}>PROVIDERS</div>
                <div className="flex flex-col gap-2">
                  {activeProviders.map((p) => {
                    const sel = p.id === (selectedProvider?.id);
                    return (
                      <div key={p.id} onClick={() => setSelectedProviderId(p.id)} style={{
                        padding: "10px 12px",
                        border: `1px solid ${sel ? "hsl(var(--primary)/0.4)" : "hsl(var(--primary)/0.08)"}`,
                        borderRadius: "3px", cursor: "pointer",
                        background: sel ? "hsl(var(--primary)/0.05)" : "transparent", transition: "all 0.15s",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", color: sel ? "hsl(var(--primary))" : g.mid, letterSpacing: "0.05em" }}>{p.name}</span>
                          {sel && <span style={{ fontSize: "10px", color: "hsl(var(--primary))" }}>▶</span>}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <span style={{ fontSize: "9px", color: g.dim }}>{p.pricePerGbPerEpoch.toFixed(5)} THT/GB</span>
                          <span style={{ fontSize: "9px", color: g.dim }}>{p.region}</span>
                          <span style={{ fontSize: "9px", color: g.dim }}>{p.uptimePercent != null ? `${p.uptimePercent.toFixed(1)}%` : "—"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cost summary */}
            {files.length > 0 && (
              <div style={{ background: "hsl(var(--primary)/0.03)", border: "1px solid hsl(var(--primary)/0.15)", borderRadius: "4px", padding: "18px" }}>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: "9px", letterSpacing: "0.28em", color: "hsl(var(--primary))", marginBottom: "12px", opacity: 0.8 }}>TX SUMMARY</div>
                <div className="flex flex-col gap-2">
                  {([
                    ["Files",       `${files.length}`],
                    ["Total size",  formatBytes(totalSize)],
                    ["Provider",    selectedProvider?.name ?? "—"],
                    ["Layer",       STORAGE_LAYERS.find((l) => l.id === layer)?.label ?? "—"],
                    ["Est. cost",   `${estimatedCost} ${THT.symbol}`],
                    ["Network fee", `0.175000 ${THT.symbol}`],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                      <span style={{ fontSize: "10px", color: g.dim, letterSpacing: "0.05em", flexShrink: 0 }}>{k}</span>
                      <span style={{ fontSize: "10px", color: "hsl(var(--foreground))", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: "1px solid hsl(var(--primary)/0.12)", paddingTop: "8px", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: "10px", letterSpacing: "0.15em", color: "hsl(var(--foreground))" }}>TOTAL</span>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: "14px", color: "hsl(var(--primary))", fontWeight: 700 }}>{totalCost} {THT.symbol}</span>
                  </div>
                </div>
              </div>
            )}

            {/* CTA button */}
            <button
              onClick={files.length === 0 ? () => fileRef.current?.click() : startPin}
              disabled={pinning}
              style={{
                width: "100%", padding: "14px", fontSize: "11px", letterSpacing: "0.28em",
                border: `1px solid ${files.length === 0 ? "hsl(var(--primary)/0.2)" : "hsl(var(--primary))"}`,
                borderRadius: "2px", cursor: pinning ? "wait" : "pointer",
                background: files.length === 0 ? "transparent" : pinning ? "hsl(var(--primary)/0.15)" : "hsl(var(--primary)/0.1)",
                color: files.length === 0 ? g.dim : "hsl(var(--primary))",
                fontWeight: "700", transition: "all 0.2s",
                fontFamily: "'Cinzel', serif",
                boxShadow: files.length > 0 && !pinning ? "0 0 20px hsl(var(--primary)/0.08)" : "none",
              }}
            >
              {pinning
                ? (() => {
                    const lbl = Object.values(phase).find(Boolean) ?? "";
                    if (lbl.toLowerCase().includes("signature") || lbl.toLowerCase().includes("wallet")) return "AWAITING WALLET SIGNATURE…";
                    if (lbl.toLowerCase().includes("submitting") || lbl.toLowerCase().includes("chain")) return "SUBMITTING TO CHAIN…";
                    if (lbl.toLowerCase().includes("building") || lbl.toLowerCase().includes("tx")) return "BUILDING TRANSACTION…";
                    return "PINNING TO IPFS…";
                  })()
                : !walletConnected ? "CONNECT & PIN"
                : files.length === 0 ? "SELECT FILES FIRST"
                : "SIGN & PIN TO SOLANA"}
            </button>

            {!walletConnected && files.length > 0 && (
              <div style={{ fontSize: "9px", color: g.dim, textAlign: "center", letterSpacing: "0.1em", lineHeight: 1.6 }}>
                Wallet signature required<br />to anchor the pin transaction
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between mt-10 pt-4" style={{ borderTop: "1px solid hsl(var(--primary)/0.08)" }}>
        <span style={{ fontSize: "9px", color: g.dim, letterSpacing: "0.12em" }}>ADADIVE by THETA</span>
        <span style={{ fontSize: "9px", color: g.dim, letterSpacing: "0.12em" }}>{NETWORK_LABEL}</span>
      </div>
    </div>
  );
}
