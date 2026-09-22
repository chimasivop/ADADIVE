/**
 * The deal lifecycle as this backend models it.
 *
 * This is a *superset* of what the on-chain program knows: the program only
 * ever sees "settle happened" or "it did not". The intermediate states exist
 * because optimistic settlement is a multi-step, multi-day process that the
 * backend has to remember across restarts.
 *
 *   pending_verification ──(pin verified)──▶ in_challenge_window
 *            │                                     │        │
 *            │(pin not verified)                   │        │(window closes,
 *            ▼                                     │         │ no dispute)
 *     settlement_failed                            │        ▼
 *                                                  │     settled
 *                                       (dispute raised)
 *                                                  ▼
 *                                              disputed  ──▶ (manual review, out of scope)
 *
 * `refunded` is reachable from any pre-settlement state when the depositor
 * reclaims after the deadline, which can legitimately happen while a challenge
 * window is still open (the window is shorter than the deal deadline in the
 * intended configuration, but nothing enforces that ordering). A refund must
 * stop the auto-settle job too, so it is a terminal state it checks for.
 */
export type DealStatus =
  | "pending_verification"
  | "in_challenge_window"
  | "disputed"
  | "settled"
  | "refunded"
  | "settlement_failed";

/** States from which the auto-settle job may act. */
export const SETTLEABLE_STATUSES: readonly DealStatus[] = ["in_challenge_window"];

/** States that mean "this deal is finished, never touch it again". */
export const TERMINAL_STATUSES: readonly DealStatus[] = [
  "settled",
  "refunded",
  "disputed",
];

export interface Deal {
  id: number;
  dealId: string;
  dealPda: string;
  depositor: string;
  provider: string;
  oracle: string;
  cid: string;
  amountLamports: bigint;
  status: DealStatus;
  challengeWindowSeconds: number;
  challengeWindowEndsAt: Date | null;
  pinVerifiedAt: Date | null;
  pinVerificationDetail: string | null;
  settleTxSignature: string | null;
  settleAttemptedAt: Date | null;
  settleError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Dispute {
  id: number;
  dealId: number;
  raisedBy: string;
  reason: string;
  raisedAt: Date;
  resolved: boolean;
}

/** Fields accepted when registering a new deal with the backend. */
export interface NewDeal {
  dealId: string;
  dealPda: string;
  depositor: string;
  provider: string;
  oracle: string;
  cid: string;
  amountLamports: bigint;
  challengeWindowSeconds: number;
}
