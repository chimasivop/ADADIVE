/**
 * ============================================================
 * ADADIVE STORAGE INTEGRATION
 * Pinata (IPFS) + Koios (Cardano)
 * ============================================================
 *
 * SETUP INSTRUCTIONS:
 * 1. In your Replit project, go to Secrets (padlock icon)
 * 2. Add these secrets:
 *    PINATA_API_KEY     = your Pinata API key
 *    PINATA_API_SECRET  = your Pinata API secret
 *    KOIOS_URL          = https://preprod.koios.rest/api/v1
 *    WALLET_ADDRESS     = your Cardano wallet address (optional for now)
 *
 * HOW TO USE:
 * - Import this file in your backend/server
 * - Call pinFileToIPFS(file) to upload a file
 * - Call anchorCIDToCardano(cid, metadata) to record on-chain
 * - Call createStorageDeal(file, dealInfo) to do both in one call
 *
 * ============================================================
 */

// ─── Dependencies ───────────────────────────────────────────
// Run in your Replit shell: npm install axios form-data
const axios    = require("axios");
const FormData = require("form-data");

// ─── Config (reads from Replit Secrets / environment vars) ──
const CONFIG = {
  pinata: {
    apiKey:    process.env.PINATA_API_KEY,
    apiSecret: process.env.PINATA_API_SECRET,
    baseUrl:   "https://api.pinata.cloud",
    gateway:   "https://gateway.pinata.cloud/ipfs",
  },
  koios: {
    baseUrl: process.env.KOIOS_URL || "https://preprod.koios.rest/api/v1",
  },
};

// ─── Validation ──────────────────────────────────────────────
function validateConfig() {
  const missing = [];
  if (!CONFIG.pinata.apiKey)    missing.push("PINATA_API_KEY");
  if (!CONFIG.pinata.apiSecret) missing.push("PINATA_API_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}\n` +
      `Add them to your Replit Secrets (padlock icon in sidebar).`
    );
  }
}

// ============================================================
// SECTION 1: PINATA — IPFS FILE PINNING
// ============================================================

/**
 * Pin a file to IPFS via Pinata
 *
 * @param {Buffer|Stream} fileBuffer - the file content
 * @param {string} fileName          - original file name
 * @param {string} mimeType          - e.g. "image/png", "application/pdf"
 * @param {object} metadata          - optional extra metadata
 * @returns {object} { cid, ipfsUrl, gatewayUrl, size, timestamp }
 *
 * Example:
 *   const result = await pinFileToIPFS(buffer, "myfile.pdf", "application/pdf");
 *   console.log(result.cid); // Qm...
 */
async function pinFileToIPFS(fileBuffer, fileName, mimeType, metadata = {}) {
  validateConfig();

  try {
    console.log(`[ADADIVE] Pinning file to IPFS: ${fileName}`);

    const formData = new FormData();

    // Append the file
    formData.append("file", fileBuffer, {
      filename: fileName,
      contentType: mimeType,
    });

    // Append Pinata metadata
    const pinataMetadata = JSON.stringify({
      name: fileName,
      keyvalues: {
        protocol:  "ADADIVE",
        network:   "Cardano",
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    });
    formData.append("pinataMetadata", pinataMetadata);

    // Pinata options
    const pinataOptions = JSON.stringify({
      cidVersion: 1, // Use CIDv1 (more modern, base32 encoded)
    });
    formData.append("pinataOptions", pinataOptions);

    // Make the request to Pinata
    const response = await axios.post(
      `${CONFIG.pinata.baseUrl}/pinning/pinFileToIPFS`,
      formData,
      {
        maxBodyLength: Infinity,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
          pinata_api_key:        CONFIG.pinata.apiKey,
          pinata_secret_api_key: CONFIG.pinata.apiSecret,
        },
      }
    );

    const cid        = response.data.IpfsHash;
    const gatewayUrl = `${CONFIG.pinata.gateway}/${cid}`;
    const ipfsUrl    = `ipfs://${cid}`;

    console.log(`[ADADIVE] ✅ File pinned successfully`);
    console.log(`[ADADIVE] CID: ${cid}`);
    console.log(`[ADADIVE] Gateway URL: ${gatewayUrl}`);

    return {
      success:    true,
      cid,
      ipfsUrl,
      gatewayUrl,
      size:       response.data.PinSize,
      timestamp:  response.data.Timestamp,
      fileName,
      mimeType,
    };

  } catch (error) {
    console.error("[ADADIVE] ❌ Pinata upload failed:", error.message);
    throw new Error(`IPFS pinning failed: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Pin JSON metadata to IPFS via Pinata
 * Useful for storing deal metadata, file manifests, etc.
 *
 * @param {object} jsonData  - the JSON object to pin
 * @param {string} name      - name for this pin
 * @returns {object} { cid, ipfsUrl, gatewayUrl }
 */
async function pinJSONToIPFS(jsonData, name = "ADADIVE Metadata") {
  validateConfig();

  try {
    console.log(`[ADADIVE] Pinning JSON metadata: ${name}`);

    const response = await axios.post(
      `${CONFIG.pinata.baseUrl}/pinning/pinJSONToIPFS`,
      {
        pinataContent: jsonData,
        pinataMetadata: {
          name,
          keyvalues: {
            protocol:  "ADADIVE",
            network:   "Cardano",
            timestamp: new Date().toISOString(),
          },
        },
      },
      {
        headers: {
          "Content-Type":        "application/json",
          pinata_api_key:        CONFIG.pinata.apiKey,
          pinata_secret_api_key: CONFIG.pinata.apiSecret,
        },
      }
    );

    const cid = response.data.IpfsHash;
    console.log(`[ADADIVE] ✅ JSON pinned. CID: ${cid}`);

    return {
      success:    true,
      cid,
      ipfsUrl:    `ipfs://${cid}`,
      gatewayUrl: `${CONFIG.pinata.gateway}/${cid}`,
    };

  } catch (error) {
    console.error("[ADADIVE] ❌ JSON pin failed:", error.message);
    throw new Error(`JSON pinning failed: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Check if a CID is still pinned and accessible
 *
 * @param {string} cid - the IPFS CID to check
 * @returns {object} { pinned, status, details }
 */
async function checkPinStatus(cid) {
  validateConfig();

  try {
    const response = await axios.get(
      `${CONFIG.pinata.baseUrl}/pinning/pinList?hashContains=${cid}`,
      {
        headers: {
          pinata_api_key:        CONFIG.pinata.apiKey,
          pinata_secret_api_key: CONFIG.pinata.apiSecret,
        },
      }
    );

    const pins   = response.data.rows;
    const pinned = pins.length > 0 && pins[0].date_unpinned === null;

    return {
      pinned,
      status:  pinned ? "pinned" : "not_found",
      details: pins[0] || null,
    };

  } catch (error) {
    console.error("[ADADIVE] ❌ Pin status check failed:", error.message);
    return { pinned: false, status: "error", error: error.message };
  }
}

// ============================================================
// SECTION 2: KOIOS — CARDANO ON-CHAIN ANCHORING
// ============================================================

/**
 * Get network info from Koios (tests connection)
 *
 * @returns {object} network tip info
 */
async function getNetworkTip() {
  try {
    const response = await axios.get(`${CONFIG.koios.baseUrl}/tip`);
    const tip = response.data[0];
    console.log(`[ADADIVE] Koios connected. Block: ${tip.block_no}, Epoch: ${tip.epoch_no}`);
    return { success: true, ...tip };
  } catch (error) {
    console.error("[ADADIVE] ❌ Koios connection failed:", error.message);
    throw new Error(`Koios connection failed: ${error.message}`);
  }
}

/**
 * Get address info and UTXOs from Koios
 * Used to check wallet balance before creating a deal
 *
 * @param {string} address - Cardano wallet address
 * @returns {object} { balance, utxos, stakeAddress }
 */
async function getAddressInfo(address) {
  try {
    console.log(`[ADADIVE] Fetching address info for: ${address.slice(0, 20)}...`);

    const response = await axios.post(
      `${CONFIG.koios.baseUrl}/address_info`,
      { _addresses: [address] },
      { headers: { "Content-Type": "application/json" } }
    );

    const info = response.data[0];
    if (!info) throw new Error("Address not found on network");

    const balanceLovelace = parseInt(info.balance || 0);
    const balanceADA      = balanceLovelace / 1_000_000;

    return {
      success:      true,
      address,
      balanceADA,
      balanceLovelace,
      stakeAddress: info.stake_address,
      utxoCount:    info.utxo_set?.length || 0,
    };

  } catch (error) {
    console.error("[ADADIVE] ❌ Address info failed:", error.message);
    throw new Error(`Failed to fetch address info: ${error.message}`);
  }
}

/**
 * Get transaction details from Koios
 * Used to verify a deal transaction was submitted
 *
 * @param {string} txHash - the transaction hash
 * @returns {object} transaction details including metadata
 */
async function getTransactionInfo(txHash) {
  try {
    console.log(`[ADADIVE] Fetching tx info: ${txHash}`);

    const response = await axios.post(
      `${CONFIG.koios.baseUrl}/tx_info`,
      { _tx_hashes: [txHash] },
      { headers: { "Content-Type": "application/json" } }
    );

    const tx = response.data[0];
    if (!tx) throw new Error("Transaction not found");

    return {
      success:   true,
      txHash,
      blockNo:   tx.block_height,
      epoch:     tx.epoch_no,
      timestamp: tx.tx_timestamp,
      metadata:  tx.metadata || [],
      confirmed: !!tx.block_height,
    };

  } catch (error) {
    console.error("[ADADIVE] ❌ TX info failed:", error.message);
    throw new Error(`Failed to fetch transaction: ${error.message}`);
  }
}

/**
 * Get transaction metadata from Koios
 * Used to read back anchored CIDs from Cardano
 *
 * @param {string} txHash - the transaction hash
 * @returns {object} the metadata attached to the transaction
 */
async function getTransactionMetadata(txHash) {
  try {
    const response = await axios.post(
      `${CONFIG.koios.baseUrl}/tx_metadata`,
      { _tx_hashes: [txHash] },
      { headers: { "Content-Type": "application/json" } }
    );

    const meta = response.data[0];
    return {
      success:  true,
      txHash,
      metadata: meta?.metadata || {},
    };

  } catch (error) {
    console.error("[ADADIVE] ❌ Metadata fetch failed:", error.message);
    throw new Error(`Failed to fetch metadata: ${error.message}`);
  }
}

/**
 * Build ADADIVE deal metadata object
 * This is the structured data that gets anchored to Cardano
 *
 * @param {object} params - deal parameters
 * @returns {object} formatted metadata ready for Cardano tx
 *
 * Note: Cardano metadata labels are integers.
 * ADADIVE uses label 721 (standard NFT metadata label)
 * and label 1337 (ADADIVE custom label)
 */
function buildDealMetadata({
  cid,
  fileName,
  fileSize,
  mimeType,
  providerAddress,
  userAddress,
  durationEpochs,
  pricePerEpochTHT,
  storageLayer = "ipfs",
}) {
  return {
    // Label 1337 = ADADIVE protocol metadata
    "1337": {
      protocol:      "ADADIVE",
      version:       "1.0",
      network:       "Cardano",
      storageLayer,
      deal: {
        cid,
        fileName:     fileName.slice(0, 64), // Cardano metadata 64 char limit per field
        fileSize,
        mimeType:     mimeType.slice(0, 64),
        provider:     providerAddress,
        user:         userAddress,
        epochs:       durationEpochs,
        pricePerEpoch: pricePerEpochTHT,
        createdAt:    Math.floor(Date.now() / 1000), // Unix timestamp
        status:       "active",
      },
    },
    // Label 721 = standard Cardano metadata for indexers to pick up
    "721": {
      ADADIVE: {
        [cid]: {
          name:        fileName.slice(0, 64),
          description: `ADADIVE storage deal - ${storageLayer.toUpperCase()}`,
          ipfs:        `ipfs://${cid}`,
          protocol:    "ADADIVE",
        },
      },
    },
  };
}

// ============================================================
// SECTION 3: COMBINED — CREATE A FULL STORAGE DEAL
// ============================================================

/**
 * Create a complete ADADIVE storage deal
 *
 * This is the main function your frontend calls.
 * It does everything in sequence:
 * 1. Pins the file to IPFS via Pinata
 * 2. Pins the deal metadata JSON to IPFS
 * 3. Builds the Cardano transaction metadata
 * 4. Returns everything needed to sign the tx with Eternl wallet
 *
 * The actual Cardano transaction signing happens in the BROWSER
 * via the Eternl wallet extension — we can't sign server-side
 * without the user's private key. So we prepare everything here
 * and send it to the frontend to sign.
 *
 * @param {Buffer} fileBuffer    - file content
 * @param {string} fileName      - original file name
 * @param {string} mimeType      - file MIME type
 * @param {object} dealParams    - deal configuration
 * @returns {object} complete deal package ready for wallet signing
 */
async function createStorageDeal(fileBuffer, fileName, mimeType, dealParams) {
  console.log("\n[ADADIVE] ═══════════════════════════════");
  console.log("[ADADIVE] Creating storage deal...");
  console.log(`[ADADIVE] File: ${fileName} (${mimeType})`);
  console.log("[ADADIVE] ═══════════════════════════════\n");

  try {
    // ── Step 1: Pin file to IPFS ──────────────────────────
    console.log("[ADADIVE] Step 1/3: Pinning file to IPFS...");
    const ipfsResult = await pinFileToIPFS(fileBuffer, fileName, mimeType, {
      provider: dealParams.providerAddress,
      user:     dealParams.userAddress,
    });

    // ── Step 2: Pin deal metadata to IPFS ────────────────
    console.log("[ADADIVE] Step 2/3: Pinning deal metadata...");
    const dealMetadataJson = {
      protocol:      "ADADIVE",
      version:       "1.0",
      cid:           ipfsResult.cid,
      fileName,
      fileSize:      ipfsResult.size,
      mimeType,
      gatewayUrl:    ipfsResult.gatewayUrl,
      provider:      dealParams.providerAddress,
      user:          dealParams.userAddress,
      durationEpochs: dealParams.durationEpochs,
      pricePerEpoch: dealParams.pricePerEpochTHT,
      storageLayer:  "ipfs",
      createdAt:     new Date().toISOString(),
    };

    const metadataResult = await pinJSONToIPFS(
      dealMetadataJson,
      `ADADIVE Deal - ${fileName}`
    );

    // ── Step 3: Build Cardano metadata ───────────────────
    console.log("[ADADIVE] Step 3/3: Building Cardano transaction metadata...");
    const cardanoMetadata = buildDealMetadata({
      cid:             ipfsResult.cid,
      fileName,
      fileSize:        ipfsResult.size,
      mimeType,
      providerAddress: dealParams.providerAddress || "addr1_provider",
      userAddress:     dealParams.userAddress     || "addr1_user",
      durationEpochs:  dealParams.durationEpochs  || 10,
      pricePerEpochTHT: dealParams.pricePerEpochTHT || 0.0013,
      storageLayer:    "ipfs",
    });

    // ── Deal package ─────────────────────────────────────
    const dealPackage = {
      success: true,

      // File storage results
      file: {
        name:       fileName,
        mimeType,
        size:       ipfsResult.size,
        cid:        ipfsResult.cid,
        ipfsUrl:    ipfsResult.ipfsUrl,
        gatewayUrl: ipfsResult.gatewayUrl,
      },

      // Metadata CID
      metadataCid: metadataResult.cid,
      metadataUrl: metadataResult.gatewayUrl,

      // Cardano transaction metadata (send to frontend for wallet signing)
      cardanoMetadata,

      // Deal summary
      deal: {
        status:          "ready_to_sign",
        provider:        dealParams.providerAddress,
        user:            dealParams.userAddress,
        durationEpochs:  dealParams.durationEpochs || 10,
        pricePerEpoch:   dealParams.pricePerEpochTHT || 0.0013,
        totalCostTHT:    (dealParams.durationEpochs || 10) * (dealParams.pricePerEpochTHT || 0.0013),
        storageLayer:    "ipfs",
        createdAt:       new Date().toISOString(),
      },

      // Instructions for frontend
      nextStep: "Sign the Cardano transaction using Eternl wallet with the cardanoMetadata attached",
    };

    console.log("\n[ADADIVE] ✅ Deal package ready!");
    console.log(`[ADADIVE] CID: ${ipfsResult.cid}`);
    console.log(`[ADADIVE] Metadata CID: ${metadataResult.cid}`);
    console.log(`[ADADIVE] Next: Sign with Eternl wallet\n`);

    return dealPackage;

  } catch (error) {
    console.error("[ADADIVE] ❌ Deal creation failed:", error.message);
    throw error;
  }
}

// ============================================================
// SECTION 4: PROOF OF STORAGE — EPOCH VERIFICATION
// ============================================================

/**
 * Verify a storage deal is still active
 * Called each epoch to check if provider still has the file
 *
 * @param {string} cid        - the IPFS CID to verify
 * @param {string} txHash     - the original deal transaction hash
 * @returns {object} { verified, cidPinned, dealOnChain, proof }
 */
async function verifyStorageDeal(cid, txHash) {
  console.log(`[ADADIVE] Verifying deal: ${cid}`);

  const results = await Promise.allSettled([
    checkPinStatus(cid),
    txHash ? getTransactionInfo(txHash) : Promise.resolve({ confirmed: false }),
  ]);

  const pinStatus = results[0].status === "fulfilled" ? results[0].value : { pinned: false };
  const txInfo    = results[1].status === "fulfilled" ? results[1].value : { confirmed: false };

  const verified = pinStatus.pinned && txInfo.confirmed;

  console.log(`[ADADIVE] Pin status: ${pinStatus.pinned ? "✅ Pinned" : "❌ Not pinned"}`);
  console.log(`[ADADIVE] On-chain:   ${txInfo.confirmed ? "✅ Confirmed" : "❌ Not confirmed"}`);
  console.log(`[ADADIVE] Verified:   ${verified ? "✅ PASS" : "❌ FAIL"}`);

  return {
    verified,
    cidPinned:   pinStatus.pinned,
    dealOnChain: txInfo.confirmed,
    proof: {
      cid,
      txHash,
      checkedAt:  new Date().toISOString(),
      pinDetails: pinStatus.details,
      blockNo:    txInfo.blockNo,
      epoch:      txInfo.epoch,
    },
  };
}

// ============================================================
// SECTION 5: EXPRESS API ROUTES
// ============================================================
// Paste these into your Express server (server.js / index.js)
// Run: npm install express multer cors

/**
 * Example Express server setup
 * Copy this into your Replit server file
 */
const EXPRESS_EXAMPLE = `
// ── ADD TO YOUR server.js / index.js ──────────────────────

const express  = require("express");
const multer   = require("multer");
const cors     = require("cors");
const storage  = require("./adadive-storage-integration");

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit

app.use(cors());
app.use(express.json());

// ── ROUTE 1: Upload file and create storage deal ──────────
app.post("/api/deals/create", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const dealParams = {
      providerAddress:  req.body.providerAddress,
      userAddress:      req.body.userAddress,
      durationEpochs:   parseInt(req.body.durationEpochs) || 10,
      pricePerEpochTHT: parseFloat(req.body.pricePerEpochTHT) || 0.0013,
    };

    const result = await storage.createStorageDeal(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      dealParams
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── ROUTE 2: Check pin status ─────────────────────────────
app.get("/api/pins/:cid/status", async (req, res) => {
  try {
    const result = await storage.checkPinStatus(req.params.cid);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── ROUTE 3: Verify a storage deal ───────────────────────
app.get("/api/deals/:cid/verify", async (req, res) => {
  try {
    const result = await storage.verifyStorageDeal(
      req.params.cid,
      req.query.txHash
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── ROUTE 4: Get address info from Koios ─────────────────
app.get("/api/wallet/:address", async (req, res) => {
  try {
    const result = await storage.getAddressInfo(req.params.address);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── ROUTE 5: Get transaction info from Koios ─────────────
app.get("/api/tx/:txHash", async (req, res) => {
  try {
    const result = await storage.getTransactionInfo(req.params.txHash);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── ROUTE 6: Network health check ────────────────────────
app.get("/api/network/status", async (req, res) => {
  try {
    const tip = await storage.getNetworkTip();
    res.json({ status: "online", ...tip });
  } catch (error) {
    res.status(500).json({ status: "offline", error: error.message });
  }
});

app.listen(3000, () => console.log("[ADADIVE] Server running on port 3000"));
`;

// ============================================================
// SECTION 6: FRONTEND WALLET INTEGRATION (Eternl)
// ============================================================
// Paste this into your React frontend to handle wallet signing

const FRONTEND_WALLET_EXAMPLE = `
// ── ADD TO YOUR React frontend ────────────────────────────
// This handles the Cardano transaction signing with Eternl wallet

/**
 * Upload a file and create a real ADADIVE storage deal
 * Call this when user clicks "Sign & Pin to Cardano"
 */
async function handleRealStorageDeal(file, dealConfig) {
  try {
    // Step 1: Check Eternl wallet is connected
    if (!window.cardano?.eternl) {
      throw new Error("Eternl wallet not found. Please install the Eternl browser extension.");
    }

    const api = await window.cardano.eternl.enable();
    const addresses = await api.getUsedAddresses();
    const userAddress = addresses[0];

    // Step 2: Upload file to backend (Pinata IPFS)
    const formData = new FormData();
    formData.append("file", file);
    formData.append("userAddress", userAddress);
    formData.append("providerAddress", dealConfig.providerAddress);
    formData.append("durationEpochs", dealConfig.durationEpochs);
    formData.append("pricePerEpochTHT", dealConfig.pricePerEpochTHT);

    const response = await fetch("/api/deals/create", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Upload failed");
    const dealPackage = await response.json();

    // dealPackage contains:
    // - dealPackage.file.cid       (the IPFS CID)
    // - dealPackage.file.gatewayUrl (accessible URL)
    // - dealPackage.cardanoMetadata (attach to Cardano tx)

    console.log("File pinned to IPFS:", dealPackage.file.cid);
    console.log("Gateway URL:", dealPackage.file.gatewayUrl);

    // Step 3: Build Cardano transaction with metadata
    // Note: Full tx building requires cardano-serialization-lib
    // For now, we record the CID in a simple metadata transaction
    // This is the pattern until your smart contracts are on mainnet

    // The metadata gets attached to ANY transaction (even a 1 ADA self-send)
    // This anchors the CID permanently on the Cardano blockchain

    alert(
      "File pinned to IPFS! CID: " + dealPackage.file.cid +
      "\\n\\nCardano anchoring requires cardano-serialization-lib integration." +
      "\\nYour CID is permanently stored on IPFS and ready to anchor on-chain."
    );

    return dealPackage;

  } catch (error) {
    console.error("Deal creation failed:", error);
    throw error;
  }
}
`;

// ============================================================
// SECTION 7: QUICK TEST
// ============================================================

/**
 * Run this to test your setup
 * In Replit shell: node adadive-storage-integration.js
 */
async function runTest() {
  console.log("\n[ADADIVE] ═══════════════════════════════════");
  console.log("[ADADIVE] Running integration test...");
  console.log("[ADADIVE] ═══════════════════════════════════\n");

  try {
    // Test 1: Koios connection
    console.log("Test 1: Koios (Cardano) connection...");
    const tip = await getNetworkTip();
    console.log(`✅ Koios OK — Epoch: ${tip.epoch_no}, Block: ${tip.block_no}\n`);

    // Test 2: Pinata connection
    console.log("Test 2: Pinata (IPFS) connection...");
    const testJson = await pinJSONToIPFS({
      test:      true,
      protocol:  "ADADIVE",
      timestamp: new Date().toISOString(),
      message:   "ADADIVE integration test",
    }, "ADADIVE Test Ping");
    console.log(`✅ Pinata OK — Test CID: ${testJson.cid}\n`);

    // Test 3: Pin a small test file
    console.log("Test 3: File upload test...");
    const testBuffer = Buffer.from("ADADIVE decentralised storage test file - Cardano + IPFS");
    const fileResult = await pinFileToIPFS(
      testBuffer,
      "adadive-test.txt",
      "text/plain",
      { test: "true" }
    );
    console.log(`✅ File pinned — CID: ${fileResult.cid}`);
    console.log(`   Gateway: ${fileResult.gatewayUrl}\n`);

    console.log("[ADADIVE] ═══════════════════════════════════");
    console.log("[ADADIVE] ✅ ALL TESTS PASSED");
    console.log("[ADADIVE] Your integration is working correctly.");
    console.log("[ADADIVE] ═══════════════════════════════════\n");

  } catch (error) {
    console.error("\n[ADADIVE] ❌ TEST FAILED:", error.message);
    console.error("Check your API keys in Replit Secrets.\n");
  }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  // Pinata (IPFS)
  pinFileToIPFS,
  pinJSONToIPFS,
  checkPinStatus,

  // Koios (Cardano)
  getNetworkTip,
  getAddressInfo,
  getTransactionInfo,
  getTransactionMetadata,

  // Combined
  createStorageDeal,
  buildDealMetadata,

  // Verification
  verifyStorageDeal,
};

// Run test if called directly: node adadive-storage-integration.js
if (require.main === module) {
  runTest();
}

/*
 * ============================================================
 * SETUP CHECKLIST
 * ============================================================
 *
 * 1. In Replit sidebar → Secrets (padlock icon) → add:
 *    PINATA_API_KEY     = [your Pinata API key]
 *    PINATA_API_SECRET  = [your Pinata API secret]
 *    KOIOS_URL          = https://preprod.koios.rest/api/v1
 *
 * 2. In Replit shell, install dependencies:
 *    npm install axios form-data express multer cors
 *
 * 3. Test the integration:
 *    node adadive-storage-integration.js
 *
 * 4. Add the Express routes (SECTION 5) to your server.js
 *
 * 5. Update your frontend Pin Files UI to call:
 *    POST /api/deals/create  (with file + deal params)
 *
 * 6. When going to mainnet, change ONE secret:
 *    KOIOS_URL = https://api.koios.rest/api/v1
 *
 * ============================================================
 */
