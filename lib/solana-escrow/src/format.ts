/** Formatting helpers for the demo. Display only — never used for fee math. */

export function sol(lamports: bigint): string {
  const negative = lamports < BigInt(0);
  const abs = negative ? -lamports : lamports;
  const whole = abs / BigInt(1_000_000_000);
  const frac = (abs % BigInt(1_000_000_000)).toString().padStart(9, "0");
  // Trim trailing zeros so 1.000000000 reads as 1.
  const trimmed = frac.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${trimmed ? "." + trimmed : ""}`;
}

export function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
}
