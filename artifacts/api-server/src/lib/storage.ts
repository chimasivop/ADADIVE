import axios from "axios";
import FormData from "form-data";

function config() {
  return {
    pinata: {
      apiKey:    process.env.PINATA_API_KEY    ?? "",
      apiSecret: process.env.PINATA_API_SECRET ?? "",
      baseUrl:   "https://api.pinata.cloud",
      gateway:   "https://gateway.pinata.cloud/ipfs",
    },
    koios: {
      baseUrl: process.env.KOIOS_URL ?? "https://preprod.koios.rest/api/v1",
    },
  };
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
    keyvalues: { protocol: "ADADIVE", network: "Cardano", timestamp: new Date().toISOString(), ...metadata },
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
      keyvalues: { protocol: "ADADIVE", network: "Cardano", timestamp: new Date().toISOString() },
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

// ─── Koios / Cardano ─────────────────────────────────────────────────────────

export async function getNetworkTip() {
  const c   = config();
  const res = await axios.get(`${c.koios.baseUrl}/tip`);
  const tip = res.data[0] as { block_no: number; epoch_no: number; block_hash: string };
  return { success: true, ...tip };
}

export async function getAddressInfo(address: string) {
  const c   = config();
  const res = await axios.post(
    `${c.koios.baseUrl}/address_info`,
    { _addresses: [address] },
    { headers: { "Content-Type": "application/json" } },
  );
  const info = res.data[0] as { balance?: string; stake_address?: string; utxo_set?: unknown[] };
  if (!info) throw new Error("Address not found on network");
  const balanceLovelace = parseInt(info.balance ?? "0");
  return {
    success:        true,
    address,
    balanceADA:     balanceLovelace / 1_000_000,
    balanceLovelace,
    stakeAddress:   info.stake_address,
    utxoCount:      info.utxo_set?.length ?? 0,
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
      protocol: "ADADIVE", version: "1.0", network: "Cardano", storageLayer: sl,
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
    providerAddress:  dealParams.providerAddress  ?? "addr1_provider",
    userAddress:      dealParams.userAddress      ?? "addr1_user",
    durationEpochs:   dealParams.durationEpochs   ?? 10,
    pricePerEpochTHT: dealParams.pricePerEpochTHT ?? 0.0013,
  });

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
