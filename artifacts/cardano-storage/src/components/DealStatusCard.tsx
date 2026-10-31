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
 *
 * Refund is the one action that is *not* a backend call. The `refund`
 * instruction on chain lets the depositor reclaim their lamports unilaterally
 * once the deal's `deadline` has passed (the oracle may also sign alone, at any
 * time), so the button builds and submits a wallet transaction directly. The
 * deadline lives on the `Deal` account and not in the backend's row, which is
 * why the card reads it on chain rather than trusting a copy.
 */

import { useCallback, useEffect, useState } from "react";
import { PublicKey, type Connection } from "@solana/web3.js";

import {
  BackendError,
  EscrowClient,
  describeStatus,
  formatRemaining,
  windowRemainingMs,
  type BackendApi,
  type BackendDealState,
  type SignableWallet,
} from "@workspace/solana-escrow";
import { refundEscrow, requestBackendSettle } from "@/lib/escrowService";
import { WAKING_MESSAGE } from "@/lib/fetchWithTimeout";

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
  /** RPC connection, for the on-chain refund. */
  connection: Connection;
  /** The connected wallet as a signer, for the on-chain refund. */
  signer: SignableWallet | null;
  /**
   * True while a sign-in is waiting on a cold backend, so the card can explain
   * the delay instead of showing a bare "WORKING…".
   */
  waking?: boolean;
}

export function DealStatusCard({
  api,
  dealId,
  wallet,
  ensureSession,
  connection,
  signer,
  waking = false,
}: DealStatusCardProps) {
  const [state, setState] = useState<BackendDealState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  /** The on-chain deadline, in unix seconds; null until read or if unreadable. */
  const [deadline, setDeadline] = useState<number | null>(null);
  /** True once the deadline read has been attempted, success or failure. */
  const [deadlineChecked, setDeadlineChecked] = useState(false);

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

  // Read the on-chain deadline once we know which PDA the deal lives at. This
  // is what gates the depositor's refund: before the deadline only the oracle
  // can refund, so the button must not appear early. A failed read leaves
  // `deadline` null, which hides the button rather than showing one that would
  // be rejected on chain. Keyed on the PDA string, not the whole state object,
  // so the 5s poll does not re-read the account every tick.
  const dealPda = state?.deal.dealPda ?? null;
  useEffect(() => {
    if (!dealPda) {
      setDeadline(null);
      setDeadlineChecked(false);
      return;
    }
    let cancelled = false;
    setDeadlineChecked(false);

    const read = async () => {
      try {
        const deal = await EscrowClient.readOnly(connection).deal(
          new PublicKey(dealPda)
        );
        // A null account means it was closed — by settle, refund or cancel —
        // so there is nothing left to refund and the button must disappear.
        if (!cancelled) {
          setDeadline(deal ? Number(deal.deadline.toString()) : null);
          setDeadlineChecked(true);
        }
      } catch {
        // Leave the button hidden; the RPC may just be unreachable. The flag
        // still flips so the card can say so instead of appearing to hang.
        if (!cancelled) setDeadlineChecked(true);
      }
    };

    void read();
    return () => {
      cancelled = true;
    };
  }, [connection, dealPda]);



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

  // The depositor may reclaim only once the on-chain deadline has passed. The
  // oracle can refund at any time, but its key is server-side, so the browser
  // never signs that path. A missing PDA means the account is gone (settled,
  // refunded or cancelled), and there is nothing left to reclaim.
  const deadlinePassed = deadline !== null && now / 1000 > deadline;
  const canRefund = isDepositor && signer !== null && dealPda !== null && deadlinePassed;
  /** Depositor with an open account whose deadline has not been read yet. */
  const refundChecking =
    isDepositor && signer !== null && dealPda !== null && deadline === null && !deadlineChecked;
  /** Depositor whose deadline is known and still in the future. */
  const refundNotYet =
    isDepositor && signer !== null && dealPda !== null && deadline !== null && !deadlinePassed;

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
      {waking && <div style={{ fontSize: "9px", color: "#00d4ff", marginTop: "8px" }}>{WAKING_MESSAGE}</div>}
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

      {refundChecking && (
        <div style={{ fontSize: "9px", color: "hsl(var(--muted-foreground))", marginTop: "10px" }}>
          Checking the on-chain deadline…
        </div>
      )}

      {refundNotYet && (
        <div style={{ fontSize: "9px", color: "hsl(var(--muted-foreground))", marginTop: "10px" }}>
          Refund unlocks after the deal deadline. Until then only the oracle can
          release the funds.
        </div>
      )}

      {canRefund && (
        <button
          onClick={() =>
            void run(async () => {
              const signature = await refundEscrow({
                connection,
                dealPda: new PublicKey(dealPda as string),
                authority: signer as SignableWallet,
              });
              setDeadline(null);
              return `Refund submitted: ${signature}`;
            })
          }
          disabled={busy}
          style={actionButtonStyle}
        >
          {busy ? "WORKING…" : "REFUND ESCROW"}
        </button>
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
