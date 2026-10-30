import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListProvidersQueryKey,
  useListProviders,
  useUpdateProviderNode,
  type Provider,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RegisterProviderDialog } from "@/components/RegisterProviderDialog";
import { useWallet } from "@/contexts/WalletContext";
import { useToast } from "@/hooks/use-toast";
import logoUrl from "@assets/seedream-4.0_Hexagonal_gold_emblem_on_deep_black_background_bl_1780317486678.jpg";
import {
  ArrowLeft,
  Wallet,
  Loader2,
  Check,
  Copy,
  CircleAlert,
  CircleCheck,
  RefreshCw,
  Download,
} from "lucide-react";

/**
 * The network endpoints a provider's agent talks to.
 *
 * `VITE_PROVIDER_ORACLE_URL` / `VITE_PROVIDER_API_URL` let a deployment name its
 * real service origins. They matter because the agent *requires* its endpoints
 * on distinct origins (`assertDistinctOrigins` in `provider-agent/src/config.ts`)
 * — it signs in to one service and pins through another, so a shared origin
 * would silently misroute one of them and it refuses to start rather than do
 * that. A deployment that fronts both services behind a single origin therefore
 * has to tell the page where they really live; otherwise the instructions below
 * would hand a provider a command that cannot run.
 *
 * Falling back to the page's own origin keeps the page correct for a deployment
 * that *does* expose the two services separately.
 */
const ORIGIN = typeof window === "undefined" ? "" : window.location.origin;

function endpoint(override: string | undefined, path: string): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : `${ORIGIN}${path}`;
}

const NETWORK = {
  oracle: endpoint(import.meta.env.VITE_PROVIDER_ORACLE_URL as string | undefined, "/backend"),
  api: endpoint(import.meta.env.VITE_PROVIDER_API_URL as string | undefined, "/api"),
  /** The built agent, served from the frontend's `public/` directory. */
  agentDownload: `${ORIGIN}${import.meta.env.BASE_URL}adadive-agent.mjs`,
};

/**
 * True when the two service endpoints share an origin, which the agent rejects.
 * Surfaced in the UI rather than letting a provider paste a command that fails
 * at startup with a config error they cannot act on.
 */
const ENDPOINTS_COLLIDE =
  NETWORK.oracle !== NETWORK.api &&
  new URL(NETWORK.oracle, "http://x").origin === new URL(NETWORK.api, "http://x").origin;

/** Heartbeats default to every 30s; anything older than this reads as stale. */
const HEARTBEAT_FRESH_MS = 90_000;

const T = {
  gold: "#c9a96e",
  goldLt: "#e8c98a",
  ink: "#05070f",
  mist: "#2a3350",
  smoke: "#7a8aaa",
  snow: "#e8e0cc",
  green: "#00ffa3",
  red: "#e05c5c",
};

const G = `
  .adadive-prov *, .adadive-prov *::before, .adadive-prov *::after { box-sizing: border-box; }
  .adadive-prov { background:#05070f; color:#e8e0cc; font-family:'Cormorant Garamond',serif; min-height:100vh; }
  .adadive-prov a { text-decoration:none; }
  .a-mono { font-family:'DM Mono',monospace; }
  .a-display { font-family:'Cinzel',serif; }
  .a-prov-card {
    background: rgba(255,255,255,.018);
    border: 1px solid rgba(201,169,110,.12);
    border-radius: 6px;
    transition: border-color .25s;
  }
  .a-prov-card:hover { border-color: rgba(201,169,110,.26); }
  .a-cmd {
    font-family:'DM Mono',monospace; font-size:11.5px; line-height:1.7;
    background: rgba(0,0,0,.45); border:1px solid rgba(201,169,110,.13);
    border-radius:3px; padding:12px 14px; color:#b9c4de;
    white-space:pre-wrap; word-break:break-word; margin:0;
  }
  .a-cmd .c { color:#4d5a78; }
  @media (max-width: 640px) { .a-prov-2col { grid-template-columns: 1fr !important; } }
`;

const Ornament = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", margin: "0 auto" }}>
    <div style={{ height: "1px", width: "44px", background: "linear-gradient(90deg,transparent,rgba(201,169,110,.4))" }} />
    <span style={{ color: T.gold, fontSize: "13px", opacity: 0.6 }}>✦</span>
    <div style={{ height: "1px", width: "44px", background: "linear-gradient(90deg,rgba(201,169,110,.4),transparent)" }} />
  </div>
);

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div
    className="a-mono"
    style={{ fontSize: "9px", letterSpacing: ".3em", color: T.gold, opacity: 0.6, marginBottom: "10px", textTransform: "uppercase" }}
  >
    {children}
  </div>
);

/** A command block with a copy button — the whole point is easy pasting. */
function Command({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div style={{ position: "relative", marginBottom: "10px" }}>
      {label && (
        <div className="a-mono" style={{ fontSize: "9px", letterSpacing: ".18em", color: T.smoke, marginBottom: "5px", textTransform: "uppercase" }}>
          {label}
        </div>
      )}
      <pre className="a-cmd">{children}</pre>
      <button
        onClick={copy}
        title="Copy"
        style={{
          position: "absolute", top: label ? "26px" : "8px", right: "8px",
          background: "rgba(201,169,110,.08)", border: "1px solid rgba(201,169,110,.2)",
          borderRadius: "3px", padding: "4px 7px", cursor: "pointer",
          color: copied ? T.green : T.smoke, display: "flex", alignItems: "center", gap: "4px",
          fontFamily: "'DM Mono',monospace", fontSize: "9px", letterSpacing: ".1em",
        }}
      >
        {copied ? <><Check size={11} /> COPIED</> : <><Copy size={11} /> COPY</>}
      </button>
    </div>
  );
}

function StepCard({
  n,
  title,
  summary,
  done,
  active,
  children,
}: {
  n: string;
  title: string;
  summary: string;
  done: boolean;
  active: boolean;
  children: ReactNode;
}) {
  const border = done ? "rgba(0,255,163,.3)" : active ? "rgba(201,169,110,.4)" : "rgba(201,169,110,.12)";
  return (
    <div className="a-prov-card" style={{ borderColor: border, padding: "28px clamp(18px,3vw,32px)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "18px" }}>
        <div
          className="a-mono"
          style={{
            flexShrink: 0, width: "30px", height: "30px", borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "11px",
            border: `1px solid ${done ? "rgba(0,255,163,.5)" : "rgba(201,169,110,.35)"}`,
            color: done ? T.green : T.gold,
            background: done ? "rgba(0,255,163,.07)" : "rgba(201,169,110,.06)",
          }}
        >
          {done ? <Check size={13} /> : n}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="a-display" style={{ fontSize: "15px", letterSpacing: ".1em", color: done ? T.green : T.gold, margin: "0 0 6px" }}>
            {title}
          </h3>
          <p style={{ fontSize: "15px", color: T.smoke, lineHeight: 1.7, fontWeight: 300, margin: 0 }}>
            {summary}
          </p>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

/** One of the states the status card can report, in plain language. */
type NodeState = "no-wallet" | "unregistered" | "no-node" | "awaiting" | "online" | "stale";

function nodeState(provider: Provider | null, connected: boolean): NodeState {
  if (!connected) return "no-wallet";
  if (!provider) return "unregistered";
  if (!provider.peerId) return "no-node";
  if (!provider.lastHeartbeatAt) return "awaiting";
  const age = Date.now() - new Date(provider.lastHeartbeatAt).getTime();
  return age <= HEARTBEAT_FRESH_MS ? "online" : "stale";
}

const STATE_COPY: Record<NodeState, { label: string; color: string; detail: string }> = {
  "no-wallet": {
    label: "Waiting for a wallet",
    color: T.smoke,
    detail: "Connect the wallet you registered with to see your node's status.",
  },
  unregistered: {
    label: "Not registered yet",
    color: T.gold,
    detail: "No provider is registered to this wallet. Complete step 2 above.",
  },
  "no-node": {
    label: "No node linked",
    color: T.gold,
    detail:
      "Your provider is registered, but it has no storage node. Its deals stay on the platform's own pinning service until you link one in step 3.",
  },
  awaiting: {
    label: "Node linked — waiting for the first heartbeat",
    color: T.gold,
    detail:
      "We have your node's id. Nothing has checked in yet: start the agent (step 3) and it will report in within about 30 seconds.",
  },
  online: {
    label: "Online",
    color: T.green,
    detail: "Your node is checking in and can be assigned work. Nothing more to do — leave it running.",
  },
  stale: {
    label: "Heartbeat is stale",
    color: T.red,
    detail:
      "Your node has not checked in recently. If you stopped the agent, start it again; if it is running, check that it can reach the network and its IPFS node is up.",
  },
};

export default function BecomeAProvider() {
  const [, setLocation] = useLocation();
  const { connected, connecting, connect, address, displayAddress, error: walletError } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [registerOpen, setRegisterOpen] = useState(false);
  const [peerIdInput, setPeerIdInput] = useState("");
  const [peerIdTouched, setPeerIdTouched] = useState(false);

  // Poll so the status card reflects a heartbeat without a manual reload.
  const { data: providers, isFetching, refetch } = useListProviders(
    { status: "all" },
    {
      query: {
        queryKey: getListProvidersQueryKey({ status: "all" }),
        refetchInterval: 8_000,
      },
    }
  );

  // The provider this wallet owns. Solana addresses are case-sensitive base58,
  // so this is an exact match — the same comparison the server makes.
  const myProvider = useMemo(
    () => (address ? providers?.find((p) => p.walletAddress === address) ?? null : null),
    [providers, address]
  );

  const state = nodeState(myProvider, connected);
  const stateCopy = STATE_COPY[state];

  const linkNode = useUpdateProviderNode();

  const peerIdValid = peerIdInput.trim() === "" || /^[1-9A-HJ-NP-Za-km-z]{10,128}$/.test(peerIdInput.trim());

  const linkNodeError = linkNode.error instanceof Error ? linkNode.error.message : null;

  const handleLinkNode = () => {
    setPeerIdTouched(true);
    const peerId = peerIdInput.trim();
    if (!myProvider || !peerIdValid || peerId === "") return;

    linkNode.mutate(
      { id: myProvider.id, data: { peerId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          setPeerIdInput("");
          setPeerIdTouched(false);
          toast({
            title: "Node linked",
            description: "Your provider now serves deals from this storage node.",
          });
        },
      }
    );
  };

  const registeredName = myProvider?.name ?? null;

  return (
    <div className="adadive-prov">
      <style>{G}</style>

      <div
        style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
          backgroundImage:
            "linear-gradient(rgba(201,169,110,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(201,169,110,.028) 1px,transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div
        style={{
          position: "fixed", top: "-15%", left: "50%", transform: "translateX(-50%)",
          width: "900px", height: "900px", borderRadius: "50%", pointerEvents: "none", zIndex: 0,
          background: "radial-gradient(ellipse,rgba(201,169,110,.055) 0%,transparent 65%)",
        }}
      />

      {/* ─── NAV ─── */}
      <nav
        style={{
          position: "sticky", top: 0, zIndex: 50, height: "60px",
          backdropFilter: "blur(14px)", background: "rgba(5,7,15,.85)",
          borderBottom: "1px solid rgba(201,169,110,.09)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 clamp(16px,4vw,48px)",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img src={logoUrl} alt="ADADIVE" style={{ width: "30px", height: "30px", objectFit: "contain", borderRadius: "3px" }} />
          <span className="a-display" style={{ fontSize: "13px", letterSpacing: ".35em", color: T.gold }}>
            ADADIVE
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            className="a-mono"
            onClick={() => setLocation("/")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "10px", letterSpacing: ".22em", color: T.smoke,
              display: "flex", alignItems: "center", gap: "6px",
            }}
          >
            <ArrowLeft size={12} /> BACK
          </button>

          {connected ? (
            <span
              className="a-mono"
              style={{
                fontSize: "9px", letterSpacing: ".16em", color: T.green,
                border: "1px solid rgba(0,255,163,.3)", background: "rgba(0,255,163,.06)",
                borderRadius: "2px", padding: "7px 12px",
              }}
            >
              {displayAddress ?? "CONNECTED"}
            </span>
          ) : (
            <button
              className="a-display"
              onClick={connect}
              disabled={connecting}
              style={{
                display: "flex", alignItems: "center", gap: "7px",
                padding: "8px 18px", borderRadius: "2px",
                cursor: connecting ? "wait" : "pointer",
                background: "transparent", border: "1px solid rgba(201,169,110,.4)",
                color: connecting ? T.smoke : T.gold, fontSize: "10px", letterSpacing: ".24em",
              }}
            >
              {connecting ? <><Loader2 size={12} className="animate-spin" /> CONNECTING</> : <><Wallet size={12} /> CONNECT WALLET</>}
            </button>
          )}
        </div>
      </nav>

      <main style={{ position: "relative", zIndex: 10, maxWidth: "860px", margin: "0 auto", padding: "72px clamp(16px,4vw,32px) 120px" }}>
        {/* ─── INTRO ─── */}
        <header style={{ textAlign: "center", marginBottom: "64px" }}>
          <SectionLabel>Become a Provider</SectionLabel>
          <h1
            className="a-display"
            style={{ fontSize: "clamp(26px,5vw,46px)", color: T.snow, letterSpacing: ".02em", lineHeight: 1.15, margin: "0 0 22px" }}
          >
            Earn SOL by storing other people's files
          </h1>
          <p style={{ fontStyle: "italic", fontSize: "18px", color: T.smoke, lineHeight: 1.8, fontWeight: 300, maxWidth: "620px", margin: "0 auto 28px" }}>
            ADADIVE is a storage marketplace. People pay to keep their files safe; providers like you
            keep a copy on their own computer and get paid for it. No company in the middle.
          </p>
          <Ornament />
        </header>

        {/* ─── WHAT IT INVOLVES ─── */}
        <section style={{ marginBottom: "72px" }}>
          <div className="a-prov-2col" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "16px" }}>
            {[
              {
                t: "What you actually do",
                b: "You run a small program on a computer you own. It listens for files the network asks you to hold, saves them, and confirms it has them. You do not have to find customers or handle payments — the network does that.",
              },
              {
                t: "How you get paid",
                b: "When someone stores files with you, they pay in SOL and it is held safely until your work is confirmed. Your rate is what you set when you register — a price per gigabyte, per period.",
              },
              {
                t: "What you need",
                b: "A computer or server that can stay switched on, free disk space for the files you agree to hold, and a reliable internet connection. A normal home machine is enough to start; more disk space means more work available to you.",
              },
              {
                t: "Why staying online matters",
                b: "Your reputation grows while your node is reachable. If it drops offline, the network stops trusting it and work dries up until it is back — so a machine you can leave running is the main thing.",
              },
            ].map((c) => (
              <div key={c.t} className="a-prov-card" style={{ padding: "24px 22px" }}>
                <div className="a-display" style={{ fontSize: "12px", letterSpacing: ".14em", color: T.gold, marginBottom: "10px" }}>
                  {c.t}
                </div>
                <p style={{ fontSize: "15px", color: T.smoke, lineHeight: 1.75, fontWeight: 300, margin: 0 }}>{c.b}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── STEPS ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Step 1 */}
          <StepCard
            n="1"
            title="Connect your wallet"
            summary="Your wallet is your provider account. It is how the network knows the node is yours and where your earnings are sent. Connecting is free and does not move any funds."
            done={connected}
            active={!connected}
          >
            {connected ? (
              <div className="a-mono" style={{ fontSize: "11px", color: T.green, display: "flex", alignItems: "center", gap: "8px" }}>
                <CircleCheck size={13} /> CONNECTED AS {displayAddress}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <Button
                  onClick={connect}
                  disabled={connecting}
                  className="font-mono w-fit"
                  data-testid="become-provider-connect"
                >
                  {connecting ? <><Loader2 className="size-4 animate-spin" /> Connecting...</> : <><Wallet className="size-4" /> Connect Wallet</>}
                </Button>
                {walletError && (
                  <p className="a-mono" style={{ fontSize: "11px", color: T.red, margin: 0 }}>{walletError}</p>
                )}
                <p style={{ fontSize: "14px", color: T.smoke, fontWeight: 300, margin: 0 }}>
                  You will need the Phantom or Solflare browser extension.
                </p>
              </div>
            )}
          </StepCard>

          {/* Step 2 */}
          <StepCard
            n="2"
            title="Register as a provider"
            summary="Tell the network who you are and what you are offering: a name people will see, where you are, how much space you are putting up, and your price. The wallet from step 1 becomes the owner — you cannot register on someone else's behalf."
            done={Boolean(registeredName)}
            active={connected && !registeredName}
          >
            {registeredName ? (
              <div className="a-mono" style={{ fontSize: "11px", color: T.green, display: "flex", alignItems: "center", gap: "8px" }}>
                <CircleCheck size={13} /> REGISTERED AS “{registeredName.toUpperCase()}”
              </div>
            ) : (
              <>
                <Button
                  onClick={() => setRegisterOpen(true)}
                  disabled={!connected}
                  className="font-mono gap-2 w-fit"
                  data-testid="become-provider-register"
                >
                  Register Provider
                </Button>
                {!connected && (
                  <p style={{ fontSize: "14px", color: T.smoke, fontWeight: 300, margin: "10px 0 0" }}>
                    Connect your wallet first.
                  </p>
                )}
              </>
            )}
          </StepCard>

          {/* Step 3 */}
          <StepCard
            n="3"
            title="Run your storage node"
            summary="This is the only part that happens on your own machine. You install IPFS — free software that stores and shares files — and then a small helper program that keeps it in sync with ADADIVE. Follow the three parts below in order."
            done={Boolean(myProvider?.peerId)}
            active={Boolean(registeredName) && !myProvider?.peerId}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "26px" }}>
              {/* 3a */}
              <div>
                <div className="a-display" style={{ fontSize: "11px", letterSpacing: ".16em", color: T.snow, marginBottom: "8px" }}>
                  3A — INSTALL IPFS
                </div>
                <p style={{ fontSize: "14.5px", color: T.smoke, fontWeight: 300, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Download the IPFS Desktop app for your operating system and open it. It runs quietly in the
                  background and keeps your files available. Then find your node's address:
                </p>
                <Command label="Your node's address">{`ipfs id -f="<id>"`}</Command>
                <p style={{ fontSize: "14px", color: T.smoke, fontWeight: 300, lineHeight: 1.7, margin: 0 }}>
                  The long string it prints (it starts with something like <span className="a-mono" style={{ fontSize: "12px", color: T.goldLt }}>12D3KooW…</span>) is
                  your <strong style={{ color: T.snow, fontWeight: 500 }}>Peer ID</strong>. Keep it — you need it in part 3C.
                </p>
              </div>

              {/* 3b */}
              <div>
                <div className="a-display" style={{ fontSize: "11px", letterSpacing: ".16em", color: T.snow, marginBottom: "8px" }}>
                  3B — START THE HELPER PROGRAM
                </div>
                <p style={{ fontSize: "14.5px", color: T.smoke, fontWeight: 300, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Install <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" style={{ color: T.gold }}>Node.js</a> (choose the LTS
                  version), then download the helper program — a single file, nothing else to install. Save it as{" "}
                  <span className="a-mono" style={{ fontSize: "12px", color: T.goldLt }}>adadive-agent.mjs</span> in a folder you will keep.
                </p>
                <p style={{ margin: "0 0 12px" }}>
                  <a
                    href={NETWORK.agentDownload}
                    download="adadive-agent.mjs"
                    className="a-mono"
                    data-testid="become-provider-download-agent"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "8px",
                      fontSize: "10px", letterSpacing: ".18em",
                      border: "1px solid rgba(201,169,110,.4)", borderRadius: "2px",
                      padding: "9px 16px", color: T.gold, textDecoration: "none",
                    }}
                  >
                    <Download size={13} /> DOWNLOAD THE HELPER
                  </a>
                </p>
                <p style={{ fontSize: "14.5px", color: T.smoke, fontWeight: 300, lineHeight: 1.7, margin: "0 0 12px" }}>
                  It needs the key for the wallet you registered with, so it can prove the node is yours.
                  Export the private key from Phantom (<em>Settings → Security &amp; Privacy → Export Private Key</em>),
                  then turn it into the file format the helper expects:
                </p>
                <Command label="Convert your exported key">{`node -e "const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let s=process.argv[1],n=0n;for(const c of s)n=n*58n+BigInt(A.indexOf(c));const b=[];while(n>0n){b.unshift(Number(n%256n));n/=256n;}for(const c of s){if(c==='1')b.unshift(0);else break;}require('fs').writeFileSync('provider-keypair.json',JSON.stringify(b))" "PASTE_YOUR_KEY_HERE"`}</Command>
                <p style={{ fontSize: "14.5px", color: T.smoke, fontWeight: 300, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Then start it. The first run is a check — it reports in once and exits, so you can see that
                  everything is wired up before leaving it running:
                </p>
                {ENDPOINTS_COLLIDE ? (
                  <div
                    data-testid="become-provider-endpoint-warning"
                    style={{
                      display: "flex", gap: "10px", alignItems: "flex-start",
                      fontSize: "14px", lineHeight: 1.7, color: T.smoke, fontWeight: 300,
                      border: "1px solid rgba(201,169,110,.22)", background: "rgba(201,169,110,.05)",
                      borderRadius: "3px", padding: "12px 14px",
                    }}
                  >
                    <CircleAlert size={14} style={{ flexShrink: 0, marginTop: "3px", color: T.gold }} />
                    <span>
                      This network is not ready for node setup yet: the helper needs ADADIVE's two
                      services reachable at separate addresses, and this one publishes them together.
                      Everything above still works, and registering in step 2 is unaffected. Ask in the{" "}
                      <a href="https://discord.gg/ESj96hvhuR" target="_blank" rel="noopener noreferrer" style={{ color: T.gold }}>
                        #providers
                      </a>{" "}
                      channel and we will help you finish connecting your node.
                    </span>
                  </div>
                ) : (
                  <>
                    <Command label="Check the setup (macOS / Linux)">{`ORACLE_BASE_URL=${NETWORK.oracle} \\
API_BASE_URL=${NETWORK.api} \\
IPFS_API_URL=http://127.0.0.1:5001/api/v0 \\
PROVIDER_KEYPAIR_PATH=./provider-keypair.json \\
node adadive-agent.mjs --once`}</Command>
                    <Command label="Check the setup (Windows PowerShell)">{`$env:ORACLE_BASE_URL="${NETWORK.oracle}"
$env:API_BASE_URL="${NETWORK.api}"
$env:IPFS_API_URL="http://127.0.0.1:5001/api/v0"
$env:PROVIDER_KEYPAIR_PATH=".\\provider-keypair.json"
node adadive-agent.mjs --once`}</Command>
                    <p style={{ fontSize: "14px", color: T.smoke, fontWeight: 300, lineHeight: 1.7, margin: 0 }}>
                      A healthy run prints a heartbeat and no errors. To keep the node working, run the same command
                      without <span className="a-mono" style={{ fontSize: "12px", color: T.goldLt }}>--once</span> and leave it running.
                      If you see <em>“could not sign in”</em>, the key file does not match the wallet you registered with.
                    </p>
                  </>
                )}
              </div>

              {/* 3c */}
              <div>
                <div className="a-display" style={{ fontSize: "11px", letterSpacing: ".16em", color: T.snow, marginBottom: "8px" }}>
                  3C — TELL ADADIVE YOUR NODE'S ADDRESS
                </div>
                <p style={{ fontSize: "14.5px", color: T.smoke, fontWeight: 300, lineHeight: 1.7, margin: "0 0 12px" }}>
                  Paste the Peer ID from part 3A. This is what ties the machine you just set up to your
                  provider account, so work can be sent to it.
                </p>

                {myProvider?.peerId ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div className="a-mono" style={{ fontSize: "11px", color: T.green, display: "flex", alignItems: "center", gap: "8px" }}>
                      <CircleCheck size={13} /> NODE LINKED
                    </div>
                    <div className="a-mono" style={{ fontSize: "10.5px", color: T.smoke, wordBreak: "break-all" }}>
                      {myProvider.peerId}
                    </div>
                    <details>
                      <summary className="a-mono" style={{ fontSize: "10px", letterSpacing: ".16em", color: T.smoke, cursor: "pointer" }}>
                        REPLACE THIS NODE
                      </summary>
                      <div style={{ marginTop: "12px" }}>
                        <Input
                          value={peerIdInput}
                          onChange={(e) => setPeerIdInput(e.target.value)}
                          onBlur={() => setPeerIdTouched(true)}
                          placeholder="12D3KooW…"
                          className="font-mono bg-background/50 border-primary/20 text-sm"
                          data-testid="become-provider-peerid"
                        />
                        <Button
                          onClick={handleLinkNode}
                          disabled={!peerIdValid || peerIdInput.trim() === "" || linkNode.isPending}
                          className="font-mono gap-2 mt-3"
                          data-testid="become-provider-link"
                        >
                          {linkNode.isPending ? <><Loader2 className="size-4 animate-spin" /> Linking...</> : "Link Node"}
                        </Button>
                      </div>
                    </details>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Input
                      value={peerIdInput}
                      onChange={(e) => setPeerIdInput(e.target.value)}
                      onBlur={() => setPeerIdTouched(true)}
                      placeholder="12D3KooW…"
                      disabled={!registeredName}
                      className="font-mono bg-background/50 border-primary/20 text-sm"
                      data-testid="become-provider-peerid"
                    />
                    {peerIdTouched && !peerIdValid && (
                      <p className="a-mono" style={{ fontSize: "11px", color: T.red, margin: 0 }}>
                        That does not look like a Peer ID — it should be letters and numbers only, at least 10 characters.
                      </p>
                    )}
                    <Button
                      onClick={handleLinkNode}
                      disabled={!registeredName || !peerIdValid || peerIdInput.trim() === "" || linkNode.isPending}
                      className="font-mono gap-2 w-fit"
                      data-testid="become-provider-link"
                    >
                      {linkNode.isPending ? <><Loader2 className="size-4 animate-spin" /> Linking...</> : "Link Node"}
                    </Button>
                    {!registeredName && (
                      <p style={{ fontSize: "14px", color: T.smoke, fontWeight: 300, margin: 0 }}>
                        Finish step 2 first — the node is linked to your provider registration.
                      </p>
                    )}
                  </div>
                )}

                {linkNodeError && (
                  <p className="a-mono" style={{ fontSize: "11px", color: T.red, marginTop: "10px", wordBreak: "break-all" }}>
                    {linkNodeError}
                  </p>
                )}
              </div>
            </div>
          </StepCard>

          {/* Step 4 */}
          <StepCard
            n="4"
            title="Check that it is working"
            summary="Once your node is linked and the helper is running, it reports in every 30 seconds. This is the same view the network uses to decide whether your node is available."
            done={state === "online"}
            active={Boolean(myProvider?.peerId) && state !== "online"}
          >
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: "16px", flexWrap: "wrap",
                border: `1px solid ${stateCopy.color}44`,
                background: `${stateCopy.color}0f`,
                borderRadius: "4px", padding: "16px 18px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                {state === "online" ? (
                  <CircleCheck size={18} style={{ color: stateCopy.color, flexShrink: 0 }} />
                ) : state === "no-wallet" || state === "unregistered" ? (
                  <CircleAlert size={18} style={{ color: stateCopy.color, flexShrink: 0 }} />
                ) : (
                  <Loader2 size={18} className="animate-spin" style={{ color: stateCopy.color, flexShrink: 0 }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="a-mono" style={{ fontSize: "11px", letterSpacing: ".12em", color: stateCopy.color }} data-testid="become-provider-status">
                    {stateCopy.label.toUpperCase()}
                  </div>
                  <p style={{ fontSize: "14px", color: T.smoke, fontWeight: 300, margin: "4px 0 0", lineHeight: 1.6 }}>
                    {stateCopy.detail}
                  </p>
                  {myProvider?.lastHeartbeatAt && (
                    <p className="a-mono" style={{ fontSize: "9.5px", color: T.mist, margin: "6px 0 0" }}>
                      LAST CHECK-IN {new Date(myProvider.lastHeartbeatAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              <button
                className="a-mono"
                onClick={() => void refetch()}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  background: "none", border: `1px solid ${stateCopy.color}55`,
                  color: stateCopy.color, borderRadius: "2px", padding: "7px 12px",
                  cursor: "pointer", fontSize: "9px", letterSpacing: ".16em", flexShrink: 0,
                }}
              >
                <RefreshCw size={11} className={isFetching ? "animate-spin" : undefined} /> REFRESH
              </button>
            </div>
          </StepCard>
        </div>

        {/* ─── TROUBLESHOOTING ─── */}
        <section style={{ marginTop: "72px" }}>
          <SectionLabel>If something is not working</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              {
                q: "The status still says “No node linked” after I pasted my Peer ID",
                a: "Check the Peer ID matches the node that is actually running — a typo links a machine that will never check in. Use “Replace this node” in step 3C to correct it.",
              },
              {
                q: "It says my node's id does not match",
                a: "The helper is pointed at a different IPFS node than the one you linked. Run the ipfs id command again and link the id it prints now.",
              },
              {
                q: "The helper will not start and mentions two addresses being the same",
                a: "The helper refuses to run when two of its three addresses resolve to the same place, because it cannot then tell which service it is talking to. This happens when ADADIVE is served from a single address. If you are running your own deployment, give the storage API and the sign-in service their own addresses and use those above; if you are a provider and the ADADIVE address you were given behaves this way, report it — it is a deployment problem, not something you can fix on your machine. Your own IPFS address should always be your own machine (127.0.0.1).",
              },
              {
                q: "The status goes stale after a while",
                a: "The helper program stopped — most often because the computer slept or the terminal window was closed. Start it again and leave it running.",
              },
            ].map((f) => (
              <details key={f.q} className="a-prov-card" style={{ padding: "16px 18px" }}>
                <summary style={{ fontSize: "15px", color: T.snow, fontWeight: 300, cursor: "pointer" }}>{f.q}</summary>
                <p style={{ fontSize: "14.5px", color: T.smoke, fontWeight: 300, lineHeight: 1.75, margin: "10px 0 0" }}>{f.a}</p>
              </details>
            ))}
          </div>

          <p style={{ fontSize: "13px", color: T.mist, textAlign: "center", marginTop: "40px", lineHeight: 1.7 }}>
            Stuck, or want help sizing a machine for the space you plan to offer? Ask in the{" "}
            <a href="https://discord.gg/ESj96hvhuR" target="_blank" rel="noopener noreferrer" style={{ color: T.gold }}>#providers</a> channel.
          </p>
        </section>
      </main>

      <RegisterProviderDialog open={registerOpen} onOpenChange={setRegisterOpen} />
    </div>
  );
}
