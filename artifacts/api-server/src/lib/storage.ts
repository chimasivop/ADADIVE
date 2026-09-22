import axios from "axios";
import FormData from "form-data";
import { Connection, PublicKey } from "@solana/web3.js";

function config() {
  return {
    pinata: {
      apiKey:    process.env.PINATA_API_KEY    ?? "",
      apiSecret: process.env.PINATA_API_SECRET ?? "",
      baseUrl:   "https://api.pinata.cloud",
      gateway:   "https://gateway.pinata.cloud/ipfs",
    },
    solana: {
      // Was the Koios Cardano REST base URL. The chain reads below now go over
      // JSON-RPC instead; the field it feeds (`getNetworkTip` / `getAddressInfo`)
      // keeps its name so the routes and the generated clients do not change.
      rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    },
  };
}

let cachedConnection: Connection | null = null;
let cachedRpcUrl: string | null = null;

function solanaConnection(): Connection {
  const { solana } = config();
  if (!cachedConnection || cachedRpcUrl !== solana.rpcUrl) {
    cachedConnection = new Connection(solana.rpcUrl, "confirmed");
    cachedRpcUrl = solana.rpcUrl;
  }
  return cachedConnection;
}

function assertPinataConfig() {
  const c = config();
  const missing: string[] = [];
  if (!c.pinata.apiKey)    missing.push("PINATA_API_KEY");
  if (!c.pinata.apiSecret) missing.push("PINATA_API_SECRET");
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
  return c;
}

// ─── IPFS / Pinata ───────────────────────────────────────────────────────────

export async function pinFileToIPFS(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  metadata: Record<string, string> = {},
) {
  const c  = assertPinataConfig();
  const fd = new FormData();
  fd.append("file", fileBuffer, { filename: fileName, contentType: mimeType });
  fd.append("pinataMetadata", JSON.stringify({
    name: fileName,
    keyvalues: { protocol: "ADADIVE", network: "Solana", timestamp: new Date().toISOString(), ...metadata },
  }));
  fd.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await axios.post(`${c.pinata.baseUrl}/pinning/pinFileToIPFS`, fd, {
    maxBodyLength: Infinity,
    headers: {
      ...fd.getHeaders(),
      pinata_api_key:        c.pinata.apiKey,
      pinata_secret_api_key: c.pinata.apiSecret,
    },
  });

  const cid = res.data.IpfsHash as string;
  return {
    success:    true,
    cid,
    ipfsUrl:    `ipfs://${cid}`,
    gatewayUrl: `${c.pinata.gateway}/${cid}`,
    size:       res.data.PinSize   as number,
    timestamp:  res.data.Timestamp as string,
    fileName,
    mimeType,
  };
}

export async function pinJSONToIPFS(jsonData: object, name = "ADADIVE Metadata") {
  const c = assertPinataConfig();
  const res = await axios.post(`${c.pinata.baseUrl}/pinning/pinJSONToIPFS`, {
    pinataContent: jsonData,
    pinataMetadata: {
      name,
      keyvalues: { protocol: "ADADIVE", network: "Solana", timestamp: new Date().toISOString() },
    },
  }, {
    headers: {
      "Content-Type":        "application/json",
      pinata_api_key:        c.pinata.apiKey,
      pinata_secret_api_key: c.pinata.apiSecret,
    },
  });
  const cid = res.data.IpfsHash as string;
  return {
    success:    true,
    cid,
    ipfsUrl:    `ipfs://${cid}`,
    gatewayUrl: `${c.pinata.gateway}/${cid}`,
  };
}

export async function checkPinStatus(cid: string) {
  const c   = assertPinataConfig();
  const res = await axios.get(`${c.pinata.baseUrl}/pinning/pinList?hashContains=${cid}`, {
    headers: {
      pinata_api_key:        c.pinata.apiKey,
      pinata_secret_api_key: c.pinata.apiSecret,
    },
  });
  const pins   = res.data.rows as Array<{ date_unpinned: string | null }>;
  const pinned = pins.length > 0 && pins[0].date_unpinned === null;
  return { pinned, status: pinned ? "pinned" : "not_found", details: pins[0] ?? null };
}

// ─── Solana RPC ──────────────────────────────────────────────────────────────
//
// These two functions were the Koios (Cardano REST) readers. They keep their
// names and their response shapes — `GET /network/status` and `GET /wallet/:address`
// are consumed by the generated client and by the UI, so the *fields* stay
// exactly as they were. Only the source of the numbers changed:
//
//   tip        → `getEpochInfo()` (slot / absolute slot / epoch)
//   address    → `getBalance()` + `getSignaturesForAddress()` for a tx count
//
// `balanceADA` / `balanceLovelace` keep their misnomers deliberately: renaming
// them would mean a database column change, an OpenAPI change and a codegen run
// for a display-only value. `balanceADA` now carries SOL. See
// `SOLANA_MIGRATION.md`.

export async function getNetworkTip() {
  const info = await solanaConnection().getEpochInfo();
  return {
    success: true,
    // Field names preserved from the Koios response. `block_no` is the current
    // slot and `epoch_no` the Solana epoch; `block_hash` has no Solana analogue
    // at this endpoint, so the genesis hash stands in as a stable network id.
    block_no: info.absoluteSlot,
    epoch_no: info.epoch,
    block_hash: await genesisHash(),
  };
}

let genesisHashPromise: Promise<string> | null = null;

/** The genesis hash is constant per cluster, so resolve it at most once. */
function genesisHash(): Promise<string> {
  if (!genesisHashPromise) {
    genesisHashPromise = solanaConnection()
      .getGenesisHash()
      // The field is informational; a transient RPC failure should not fail the
      // whole tip read.
      .catch(() => "");
  }
  return genesisHashPromise;
}

/**
 * The current Solana epoch, or `null` if the cluster cannot be reached.
 *
 * Replaces the Koios `/tip` epoch read in `routes/stats.ts`. Returns `null`
 * rather than throwing so a stats response degrades to "unavailable" instead of
 * failing, which is how the endpoint behaved when Koios was down.
 */
export async function getCurrentEpoch(): Promise<number | null> {
  try {
    const info = await solanaConnection().getEpochInfo();
    return info.epoch;
  } catch {
    return null;
  }
}

export async function getAddressInfo(address: string) {
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(address);
  } catch {
    throw new Error("Address is not a valid Solana public key");
  }

  const connection = solanaConnection();
  const lamports = await connection.getBalance(publicKey, "confirmed");

  // A bounded page of signatures is enough to report "has this account been
  // used" without paging an unbounded history on a public endpoint.
  const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 1000 });

  return {
    success:        true,
    address:        publicKey.toBase58(),
    balanceADA:     lamports / 1_000_000_000,
    balanceLovelace: lamports,
    // No stake-address concept on a Solana wallet account.
    stakeAddress:   null as string | null,
    utxoCount:      signatures.length,
  };
}

// ─── Deal metadata ───────────────────────────────────────────────────────────

export function buildDealMetadata(params: {
  cid: string; fileName: string; fileSize: number; mimeType: string;
  providerAddress: string; userAddress: string; durationEpochs: number;
  pricePerEpochTHT: number; storageLayer?: string;
}) {
  const sl = params.storageLayer ?? "ipfs";
  return {
    "1337": {
      // The label numbers and the JSON shape are unchanged — the client still
      // receives a `cardanoMetadata` object — but `network` now names the chain
      // the escrow actually settles on.
      protocol: "ADADIVE", version: "1.0", network: "Solana", storageLayer: sl,
      deal: {
        cid:           params.cid,
        fileName:      params.fileName.slice(0, 64),
        fileSize:      params.fileSize,
        mimeType:      params.mimeType.slice(0, 64),
        provider:      params.providerAddress,
        user:          params.userAddress,
        epochs:        params.durationEpochs,
        pricePerEpoch: params.pricePerEpochTHT,
        createdAt:     Math.floor(Date.now() / 1000),
        status:        "active",
      },
    },
    "721": {
      ADADIVE: {
        [params.cid]: {
          name:        params.fileName.slice(0, 64),
          description: `ADADIVE storage deal - ${sl.toUpperCase()}`,
          ipfs:        `ipfs://${params.cid}`,
          protocol:    "ADADIVE",
        },
      },
    },
  };
}

// ─── Combined: create storage deal ───────────────────────────────────────────

export async function createStorageDeal(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  dealParams: {
    providerAddress?: string;
    userAddress?: string;
    durationEpochs?: number;
    pricePerEpochTHT?: number;
  },
) {
  const ipfsResult = await pinFileToIPFS(fileBuffer, fileName, mimeType, {
    provider: dealParams.providerAddress ?? "",
    user:     dealParams.userAddress     ?? "",
  });

  const metadataResult = await pinJSONToIPFS({
    protocol: "ADADIVE", version: "1.0",
    cid:           ipfsResult.cid,
    fileName,
    fileSize:      ipfsResult.size,
    mimeType,
    gatewayUrl:    ipfsResult.gatewayUrl,
    provider:      dealParams.providerAddress ?? "",
    user:          dealParams.userAddress     ?? "",
    durationEpochs:   dealParams.durationEpochs   ?? 10,
    pricePerEpoch:    dealParams.pricePerEpochTHT  ?? 0.0013,
    storageLayer:  "ipfs",
    createdAt:     new Date().toISOString(),
  }, `ADADIVE Deal - ${fileName}`);

  const cardanoMetadata = buildDealMetadata({
    cid:              ipfsResult.cid,
    fileName,
    fileSize:         ipfsResult.size,
    mimeType,
    providerAddress:  dealParams.providerAddress  ?? "11111111111111111111111111111111",
    userAddress:      dealParams.userAddress      ?? "11111111111111111111111111111111",
    durationEpochs:   dealParams.durationEpochs   ?? 10,
    pricePerEpochTHT: dealParams.pricePerEpochTHT ?? 0.0013,
  });

  // The escrow parameters the browser needs to call `initialize` on-chain. The
  // backend cannot pick the provider or oracle for the user, so these are echoes
  // of what was supplied plus a deal id derived from the CID — the client
  // prefers them but falls back to its own connected wallet when they are blank.
  const escrow = {
    dealId:        ipfsResult.cid,
    provider:      dealParams.providerAddress ?? "",
    oracle:        process.env.ORACLE_PUBKEY ?? "",
    amountLamports: String(
      BigInt(Math.max(0, Math.floor((dealParams.durationEpochs ?? 10) * (dealParams.pricePerEpochTHT ?? 0.0013) * 1_000_000_000)))
    ),
  };

  return {
    success: true,
    file: {
      name:       fileName,
      mimeType,
      size:       ipfsResult.size,
      cid:        ipfsResult.cid,
      ipfsUrl:    ipfsResult.ipfsUrl,
      gatewayUrl: ipfsResult.gatewayUrl,
    },
    metadataCid: metadataResult.cid,
    metadataUrl: metadataResult.gatewayUrl,
    cardanoMetadata,
    escrow,
    deal: {
      status:         "ready_to_sign",
      provider:       dealParams.providerAddress,
      user:           dealParams.userAddress,
      durationEpochs: dealParams.durationEpochs  ?? 10,
      pricePerEpoch:  dealParams.pricePerEpochTHT ?? 0.0013,
      totalCostTHT:   (dealParams.durationEpochs ?? 10) * (dealParams.pricePerEpochTHT ?? 0.0013),
      storageLayer:   "ipfs",
      createdAt:      new Date().toISOString(),
    },
  };
}
