import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { decode } from "cbor-x";
import { THT } from "@/lib/token";

interface WalletState {
  connected: boolean;
  connecting: boolean;
  address: string | null; // bech32 format (addr_test1...)
  adaBalance: number | null;
  thtBalance: number | null;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  displayAddress: string | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Convert hex bytes to bech32 address using CSL
async function hexToBech32(hex: string): Promise<string> {
  // Check if already bech32 (starts with addr_)
  if (hex.startsWith("addr_")) return hex;
  
  try {
    const CSL = await getCSL();
    const bytes = hexToBytes(hex);
    return CSL.Address.from_bytes(bytes).to_bech32();
  } catch {
    // Fallback: return as-is if CSL not available
    return hex;
  }
}

// Load CSL from CDN
function getCSL(): Promise<any> {
  if ((window as any).CardanoWasm) return Promise.resolve((window as any).CardanoWasm);
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if ((window as any).CardanoWasm) {
        clearInterval(check);
        resolve((window as any).CardanoWasm);
      }
      if (attempts > 100) {
        clearInterval(check);
        reject(new Error("CSL timeout"));
      }
    }, 100);
  });
}

function shortenAddress(bech32: string): string {
  if (bech32.length < 16) return bech32;
  return bech32.slice(0, 12) + "..." + bech32.slice(-8);
}

function parseThtBalance(cborHex: string): { ada: number; tht: number } {
  let ada = 0;
  let tht = 0;

  try {
    const decoded = decode(hexToBytes(cborHex));

    if (typeof decoded === "bigint" || typeof decoded === "number") {
      ada = Number(decoded) / 1_000_000;
    } else if (Array.isArray(decoded) && decoded.length === 2) {
      ada = Number(decoded[0]) / 1_000_000;
      const multiAsset = decoded[1];

      if (multiAsset instanceof Map) {
        for (const [policyBytes, assets] of multiAsset.entries()) {
          const policyHex = bytesToHex(policyBytes);
          if (policyHex === THT.policyId && assets instanceof Map) {
            for (const [nameBytes, amount] of assets.entries()) {
              const nameHex = bytesToHex(nameBytes);
              // "THT" in hex = 544854
              if (nameHex === "544854" || nameHex === "") {
                tht = Number(amount);
              }
            }
          }
        }
      }
    }
  } catch {
    // fallback — return zeros
  }

  return { ada, tht };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    connected: false,
    connecting: false,
    address: null,
    adaBalance: null,
    thtBalance: null,
    error: null,
  });

  const connect = useCallback(async () => {
    const cardano = (window as any).cardano;

    if (!cardano?.eternl) {
      setState((s) => ({
        ...s,
        error: "Eternl wallet not found. Please install the Eternl browser extension.",
      }));
      return;
    }

    setState((s) => ({ ...s, connecting: true, error: null }));

    try {
      const api = await cardano.eternl.enable();

      const [balanceCbor, addresses] = await Promise.all([
        api.getBalance(),
        api.getUsedAddresses({ paginate: { page: 0, limit: 1 } }),
      ]);

      const { ada, tht } = parseThtBalance(balanceCbor);
      // Convert hex to bech32 address
      const addressHex = addresses?.[0] ?? null;
      const address = addressHex ? await hexToBech32(addressHex) : null;

      setState({
        connected: true,
        connecting: false,
        address,
        adaBalance: ada,
        thtBalance: tht,
        error: null,
      });
    } catch (err: any) {
      setState((s) => ({
        ...s,
        connecting: false,
        error: err?.message ?? "Failed to connect wallet.",
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({
      connected: false,
      connecting: false,
      address: null,
      adaBalance: null,
      thtBalance: null,
      error: null,
    });
  }, []);

  const displayAddress = state.address ? shortenAddress(state.address) : null;

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect, displayAddress }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
