/**
 * Live status of a deal as the oracle backend sees it.
 *
 * The backend owns the deal state machine (pending verification → challenge
 * window → settled / disputed / refunded), so this card does not re-derive any
 * of it: it polls `GET /deals/:id`, renders `describeStatus`, and offers the
 * two actions the backend authorises — the provider requesting settlement and
 * the depositor disputing while the window is open. `canDispute` and
 * `challengeWindowOpen` are computed server-side, so the buttons follow the
 * same rules the routes enforce rather than a second copy of them.
 *
 * Polling (not a socket) matches how the rest of this app reads chain state
 * (`WalletContext` polls the balance); the window closes on the backend's own
 * timer, so the card only has to notice.
 */

import { useCallback, useEffect, useState } from "react";

import {
  BackendError,
  describeStatus,
  formatRemaining,
  windowRemainingMs,
  type BackendApi,
  type BackendDealState,
} from "@workspace/solana-escrow";
import { requestBackendSettle } from "@/lib/escrowService";

const POLL_MS = 5000;

const statusAccent: Record<string, string> = {
  pending_verification: "#d4a017",
  in_challenge_window: "#00d4ff",
  disputed: "#e05c5c",
  settled: "#00ffa3",
  refunded: "#00ffa3",
  settlement_failed: "#e05c5c",
};

interface DealStatusCardProps {
  api: BackendApi;
  /** The backend's deal identifier (the CID, for deals created via Pin Files). */
  dealId: string;
  /** The connected wallet, to decide which actions it is allowed to take. */
  wallet: string | null;
  ensureSession: () => Promise<string>;
}

export function DealStatusCard({ api, dealId, wallet, ensureSession }: DealStatusCardProps) {
  const [state, setState] = useState<BackendDealState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const next = await api.getDealState(dealId);
        if (!cancelled) {
          setState(next);
          setError(null);
          setNotFound(false);
        }
      } catch (err) {
        if (cancelled) return;
        // A 404 is an answer, not a fault: the deal exists on chain but this
        // backend has no record of it (e.g. it was never registered, or was
        // registered against a different oracle). Render it as a plain state
        // rather than a red error, and stop polling a row that will not appear.
        if (err instanceof BackendError && err.status === 404) {
          setNotFound(true);
          setError(null);
          return;
        }
        // Any other failure (transport blip, 5xx) keeps the last good state so
        // a status the user is watching does not blank out.
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    void read();
    const timer = setInterval(() => {
      setNow(Date.now());
      void read();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, dealId]);

  const run = useCallback(
    async (action: () => Promise<string>) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        setNotice(await action());
      } catch (err) {
        setError(
          err instanceof BackendError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err)
        );
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const isProvider = state !== null && wallet !== null && state.deal.provider === wallet;
  const isDepositor = state !== null && wallet !== null && state.deal.depositor === wallet;
  const remaining = state ? windowRemainingMs(state, now) : null;

  return (
    <div
      style={{
        border: "1px solid hsl(var(--primary)/0.2)",
        borderRadius: "4px",
        padding: "12px 14px",
        textAlign: "left",
        fontFamily: "'DM Mono', 'Space Mono', monospace",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontSize: "9px", letterSpacing: "0.12em", color: "hsl(var(--muted-foreground))" }}>
          ORACLE DEAL STATUS
        </span>
        <span
          style={{
            fontSize: "10px",
            color: notFound ? "#d4a017" : state ? statusAccent[state.deal.status] ?? "#888" : "#888",
          }}
        >
          {notFound ? "Not registered" : state ? describeStatus(state.deal.status) : "loading…"}
        </span>
      </div>

      <div style={{ fontSize: "9px", color: "hsl(var(--muted-foreground))", opacity: 0.7, wordBreak: "break-all" }}>
        {dealId}
      </div>

      {notFound && (
        <div style={{ fontSize: "9px", color: "#d4a017", marginTop: "6px" }}>
          Not registered with the oracle backend — settlement cannot run until it is.
        </div>
      )}

      {remaining !== null && (
        <div style={{ fontSize: "10px", color: "#00d4ff", marginTop: "6px" }}>
          Challenge window: {formatRemaining(remaining)} remaining
        </div>
      )}

      {state?.deal.settleTxSignature && (
        <div style={{ fontSize: "9px", marginTop: "6px", wordBreak: "break-all" }}>
          <span style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>SETTLE TX </span>
          <span style={{ color: "#00ffa3" }}>{state.deal.settleTxSignature.slice(0, 28)}…</span>
        </div>
      )}

      {state?.deal.settleError && (
        <div style={{ fontSize: "9px", color: "#e05c5c", marginTop: "6px" }}>
          {state.deal.settleError}
        </div>
      )}

      {state?.disputes.length ? (
        <div style={{ fontSize: "9px", color: "#e05c5c", marginTop: "6px" }}>
          {state.disputes.length} dispute{state.disputes.length !== 1 ? "s" : ""} raised
        </div>
      ) : null}

      {notice && <div style={{ fontSize: "9px", color: "#00d4ff", marginTop: "8px" }}>{notice}</div>}
      {error && <div style={{ fontSize: "9px", color: "#e05c5c", marginTop: "8px" }}>{error}</div>}

      {isProvider && (
        <button
          onClick={() =>
            void run(async () => {
              const token = await ensureSession();
              const { outcome } = await requestBackendSettle(api, token, dealId);
              return `Settle request: ${outcome}`;
            })
          }
          disabled={busy}
          style={actionButtonStyle}
        >
          {busy ? "WORKING…" : "REQUEST SETTLEMENT"}
        </button>
      )}

      {isDepositor && state?.canDispute && (
        <div style={{ marginTop: "10px", display: "flex", gap: "6px" }}>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason for dispute"
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid hsl(var(--primary)/0.25)",
              borderRadius: "2px",
              padding: "5px 8px",
              fontSize: "10px",
              color: "inherit",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={() =>
              void run(async () => {
                const token = await ensureSession();
                await api.dispute(token, dealId, reason.trim());
                setReason("");
                return "Dispute recorded";
              })
            }
            disabled={busy || reason.trim().length === 0}
            style={{ ...actionButtonStyle, marginTop: 0 }}
          >
            DISPUTE
          </button>
        </div>
      )}
    </div>
  );
}

const actionButtonStyle: React.CSSProperties = {
  marginTop: "10px",
  background: "transparent",
  border: "1px solid hsl(var(--primary)/0.3)",
  color: "hsl(var(--muted-foreground))",
  padding: "5px 12px",
  fontSize: "9px",
  letterSpacing: "0.16em",
  cursor: "pointer",
  borderRadius: "2px",
  fontFamily: "'Cinzel', serif",
};
