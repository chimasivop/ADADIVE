/**
 * ============================================================
 * ADADIVE — CARDANO TRANSACTION BUILDER
 * cardano-serialization-lib + Eternl Wallet Integration
 * ============================================================
 *
 * This file handles the final step of the ADADIVE deal flow:
 * Taking the cardanoMetadata from the backend and building +
 * signing a real Cardano transaction via the Eternl wallet.
 *
 * HOW TO USE IN YOUR REACT APP:
 * 1. Add the CSL script tag to your index.html (see bottom)
 * 2. Import this file in your Pin Files component
 * 3. Call signAndSubmitDeal(dealPackage, walletApi)
 *
 * ============================================================
 */

// ============================================================
// PART 1: LOAD cardano-serialization-lib IN THE BROWSER
// ============================================================
// Add this to your public/index.html <head> section:
//
// <script src="https://cdn.jsdelivr.net/npm/@emurgo/cardano-serialization-lib-browser@11.5.0/cardano_serialization_lib.js"></script>
//
// After it loads, window.CardanoWasm will be available.
// ============================================================

/**
 * Wait for CardanoWasm to be ready
 * CSL loads asynchronously so we need to wait for it
 */
async function getCSL() {
  // If already loaded
  if (window.CardanoWasm) return window.CardanoWasm;

  // Wait up to 10 seconds for it to load
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (window.CardanoWasm) {
        clearInterval(check);
        resolve(window.CardanoWasm);
      }
      if (attempts > 100) {
        clearInterval(check);
        reject(new Error(
          "cardano-serialization-lib failed to load. " +
          "Make sure the script tag is in your index.html"
        ));
      }
    }, 100);
  });
}

// ============================================================
// PART 2: WALLET CONNECTION
// ============================================================

/**
 * Connect to Eternl wallet
 * Returns the wallet API object needed for all wallet operations
 *
 * @returns {object} { api, address, balanceADA, network }
 */
async function connectEternlWallet() {
  // Check Eternl is installed
  if (!window.cardano) {
    throw new Error(
      "No Cardano wallet detected. " +
      "Please install the Eternl wallet browser extension."
    );
  }

  if (!window.cardano.eternl) {
    throw new Error(
      "Eternl wallet not found. " +
      "Please install Eternl from eternl.io"
    );
  }

  try {
    console.log("[ADADIVE] Connecting to Eternl wallet...");

    // Request wallet access
    const api = await window.cardano.eternl.enable();

    // Get network (0 = testnet/preprod, 1 = mainnet)
    const networkId = await api.getNetworkId();
    const network   = networkId === 1 ? "mainnet" : "preprod";

    // Validate network matches our config
    const expectedNetwork = "preprod"; // Change to "mainnet" when ready
    if (network !== expectedNetwork) {
      throw new Error(
        `Wrong network. ADADIVE is on ${expectedNetwork} but your wallet is on ${network}. ` +
        `Please switch your Eternl wallet to ${expectedNetwork}.`
      );
    }

    // Get wallet address
    const addresses     = await api.getUsedAddresses();
    const changeAddress = await api.getChangeAddress();
    const address       = addresses[0] || changeAddress;

    // Get balance in lovelace (1 ADA = 1,000,000 lovelace)
    const balanceHex    = await api.getBalance();
    const CSL           = await getCSL();
    const balanceValue  = CSL.Value.from_bytes(Buffer.from(balanceHex, "hex"));
    const balanceADA    = parseInt(balanceValue.coin().to_str()) / 1_000_000;

    console.log(`[ADADIVE] ✅ Wallet connected`);
    console.log(`[ADADIVE] Address: ${address.slice(0, 20)}...`);
    console.log(`[ADADIVE] Balance: ${balanceADA.toFixed(2)} ADA`);
    console.log(`[ADADIVE] Network: ${network}`);

    return { api, address, balanceADA, network };

  } catch (error) {
    if (error.code === -3) {
      throw new Error("Wallet access denied. Please approve the connection in Eternl.");
    }
    throw error;
  }
}

// ============================================================
// PART 3: FETCH UTXOs FOR TRANSACTION BUILDING
// ============================================================

/**
 * Get UTXOs from the wallet (inputs for the transaction)
 *
 * @param {object} api - Eternl wallet API
 * @returns {Array} array of UTXO objects
 */
async function getWalletUTXOs(api) {
  const CSL       = await getCSL();
  const utxosHex  = await api.getUtxos();

  if (!utxosHex || utxosHex.length === 0) {
    throw new Error(
      "No UTXOs found in wallet. " +
      "Your wallet needs some test ADA. " +
      "Get free test ADA from: https://docs.cardano.org/cardano-testnet/tools/faucet"
    );
  }

  const utxos = utxosHex.map(utxoHex =>
    CSL.TransactionUnspentOutput.from_bytes(Buffer.from(utxoHex, "hex"))
  );

  console.log(`[ADADIVE] Found ${utxos.length} UTXOs in wallet`);
  return utxos;
}

// ============================================================
// PART 4: BUILD THE CARDANO TRANSACTION
// ============================================================

/**
 * Build a Cardano transaction with ADADIVE deal metadata attached
 *
 * The transaction is a simple ADA self-send (back to your own address)
 * with the IPFS CID and deal metadata attached as Cardano tx metadata.
 * This permanently anchors the storage deal on the Cardano blockchain.
 *
 * Cost: ~0.17 ADA network fee (test ADA on preprod)
 *
 * @param {object} params
 * @param {object} params.api             - Eternl wallet API
 * @param {string} params.changeAddress   - wallet address (hex)
 * @param {Array}  params.utxos           - wallet UTXOs
 * @param {object} params.cardanoMetadata - metadata from backend deal package
 * @param {string} params.cid             - IPFS CID to anchor
 * @returns {string} signed transaction in hex
 */
async function buildDealTransaction({
  api,
  changeAddress,
  utxos,
  cardanoMetadata,
  cid,
}) {
  const CSL = await getCSL();

  console.log("[ADADIVE] Building Cardano transaction...");
  console.log(`[ADADIVE] Anchoring CID: ${cid}`);

  try {
    // ── Protocol parameters (Preprod) ───────────────────
    // These are standard Cardano Preprod parameters
    const linearFee = CSL.LinearFee.new(
      CSL.BigNum.from_str("44"),       // coefficient (lovelace per byte)
      CSL.BigNum.from_str("155381")    // constant (minimum fee)
    );

    const txBuilderConfig = CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(linearFee)
      .pool_deposit(CSL.BigNum.from_str("500000000"))
      .key_deposit(CSL.BigNum.from_str("2000000"))
      .max_value_size(5000)
      .max_tx_size(16384)
      .coins_per_utxo_word(CSL.BigNum.from_str("34482"))
      .build();

    const txBuilder = CSL.TransactionBuilder.new(txBuilderConfig);

    // ── Add inputs (UTXOs from wallet) ───────────────────
    const txInputsBuilder = CSL.TxInputsBuilder.new();
    let totalInput = CSL.BigNum.from_str("0");

    for (const utxo of utxos) {
      const input  = utxo.input();
      const output = utxo.output();
      const amount = output.amount().coin();

      txInputsBuilder.add_key_input(
        CSL.Ed25519KeyHash.from_hex(
          CSL.BaseAddress.from_address(
            CSL.Address.from_bytes(output.address().to_bytes())
          )?.payment_cred()?.to_keyhash()?.to_hex() || ""
        ),
        input,
        output.amount()
      );

      totalInput = totalInput.checked_add(amount);

      // Stop once we have enough (2 ADA is more than enough for fees)
      if (parseInt(totalInput.to_str()) >= 2_000_000) break;
    }

    txBuilder.set_inputs(txInputsBuilder);

    // ── Attach ADADIVE metadata ───────────────────────────
    // Convert our metadata object to Cardano GeneralTransactionMetadata
    const generalMetadata = CSL.GeneralTransactionMetadata.new();

    // Helper: convert JS object to Cardano metadata
    function jsToMetadata(value) {
      if (typeof value === "string") {
        // Cardano metadata strings max 64 bytes — split if longer
        if (value.length <= 64) {
          return CSL.encode_json_str_to_metadatum(
            JSON.stringify(value),
            CSL.MetadataJsonSchema.NoConversions
          );
        } else {
          // Split long strings into 64-char chunks (Cardano standard)
          const chunks   = [];
          const list     = CSL.MetaList.new();
          for (let i = 0; i < value.length; i += 64) {
            list.add(CSL.TransactionMetadatum.new_text(value.slice(i, i + 64)));
          }
          return CSL.TransactionMetadatum.new_list(list);
        }
      }
      if (typeof value === "number") {
        return CSL.TransactionMetadatum.new_int(
          CSL.Int.new(CSL.BigNum.from_str(Math.floor(value).toString()))
        );
      }
      if (typeof value === "boolean") {
        return CSL.TransactionMetadatum.new_text(value ? "true" : "false");
      }
      if (Array.isArray(value)) {
        const list = CSL.MetaList.new();
        value.forEach(item => list.add(jsToMetadata(item)));
        return CSL.TransactionMetadatum.new_list(list);
      }
      if (typeof value === "object" && value !== null) {
        const map = CSL.MetaMap.new();
        Object.entries(value).forEach(([k, v]) => {
          map.insert(
            CSL.TransactionMetadatum.new_text(k.slice(0, 64)),
            jsToMetadata(v)
          );
        });
        return CSL.TransactionMetadatum.new_map(map);
      }
      return CSL.TransactionMetadatum.new_text(String(value).slice(0, 64));
    }

    // Attach label 1337 (ADADIVE protocol data)
    if (cardanoMetadata["1337"]) {
      generalMetadata.insert(
        CSL.BigNum.from_str("1337"),
        jsToMetadata(cardanoMetadata["1337"])
      );
    }

    // Attach label 721 (standard Cardano indexer label)
    if (cardanoMetadata["721"]) {
      generalMetadata.insert(
        CSL.BigNum.from_str("721"),
        jsToMetadata(cardanoMetadata["721"])
      );
    }

    const auxData = CSL.AuxiliaryData.new();
    auxData.set_metadata(generalMetadata);
    txBuilder.set_auxiliary_data(auxData);

    // ── Add output (send min ADA back to self) ────────────
    // Minimum ADA output is ~1 ADA
    const minADA    = CSL.BigNum.from_str("1000000"); // 1 ADA
    const toAddress = CSL.Address.from_bytes(
      Buffer.from(changeAddress, "hex")
    );

    txBuilder.add_output(
      CSL.TransactionOutput.new(toAddress, CSL.Value.new(minADA))
    );

    // ── Set TTL (transaction expiry) ──────────────────────
    // Current slot + 7200 slots (~2 hours on Preprod)
    // We use a large number here; in production fetch current slot from Koios
    const currentSlot = Math.floor(Date.now() / 1000) + 36_000_000; // approx
    txBuilder.set_ttl(currentSlot + 7200);

    // ── Add change output ─────────────────────────────────
    txBuilder.add_change_if_needed(toAddress);

    // ── Build the transaction body ────────────────────────
    const txBody    = txBuilder.build();
    const txHash    = CSL.hash_transaction(txBody);
    const witnesses = CSL.TransactionWitnessSet.new();

    // ── Build unsigned transaction for wallet to sign ─────
    const tx = CSL.Transaction.new(
      txBody,
      witnesses,
      auxData
    );

    const unsignedTxHex = Buffer.from(tx.to_bytes()).toString("hex");

    console.log(`[ADADIVE] ✅ Transaction built`);
    console.log(`[ADADIVE] TX Hash: ${Buffer.from(txHash.to_bytes()).toString("hex")}`);
    console.log(`[ADADIVE] Estimated fee: ~0.17 ADA`);

    return {
      unsignedTxHex,
      txHash: Buffer.from(txHash.to_bytes()).toString("hex"),
      auxiliaryDataHash: Buffer.from(
        CSL.hash_auxiliary_data(auxData).to_bytes()
      ).toString("hex"),
    };

  } catch (error) {
    console.error("[ADADIVE] ❌ Transaction build failed:", error.message);
    throw new Error(`Transaction build failed: ${error.message}`);
  }
}

// ============================================================
// PART 5: SIGN AND SUBMIT
// ============================================================

/**
 * Sign the transaction with Eternl wallet and submit to Cardano
 *
 * @param {object} api           - Eternl wallet API
 * @param {string} unsignedTxHex - the unsigned transaction hex
 * @returns {string} submitted transaction hash
 */
async function signAndSubmitTransaction(api, unsignedTxHex) {
  const CSL = await getCSL();

  try {
    console.log("[ADADIVE] Requesting wallet signature...");
    console.log("[ADADIVE] Please approve the transaction in Eternl.");

    // Request signature from Eternl wallet
    // This triggers the Eternl popup for the user to approve
    const witnessSetHex = await api.signTx(unsignedTxHex, true);

    console.log("[ADADIVE] ✅ Transaction signed by wallet");
    console.log("[ADADIVE] Submitting to Cardano network...");

    // Reconstruct the signed transaction
    const unsignedTx  = CSL.Transaction.from_bytes(Buffer.from(unsignedTxHex, "hex"));
    const witnessSet  = CSL.TransactionWitnessSet.from_bytes(Buffer.from(witnessSetHex, "hex"));

    const signedTx = CSL.Transaction.new(
      unsignedTx.body(),
      witnessSet,
      unsignedTx.auxiliary_data()
    );

    const signedTxHex = Buffer.from(signedTx.to_bytes()).toString("hex");

    // Submit via Eternl wallet (it routes to the right network)
    const submittedTxHash = await api.submitTx(signedTxHex);

    console.log(`[ADADIVE] ✅ Transaction submitted!`);
    console.log(`[ADADIVE] TX Hash: ${submittedTxHash}`);
    console.log(`[ADADIVE] View on explorer: https://preprod.cardanoscan.io/transaction/${submittedTxHash}`);

    return submittedTxHash;

  } catch (error) {
    if (error.code === 2) {
      throw new Error("Transaction declined. You rejected the signing request in Eternl.");
    }
    if (error.code === 3) {
      throw new Error("Transaction failed. Your wallet may not have enough test ADA.");
    }
    console.error("[ADADIVE] ❌ Sign/submit failed:", error);
    throw new Error(`Transaction failed: ${error.info || error.message}`);
  }
}

// ============================================================
// PART 6: MAIN FUNCTION — FULL DEAL FLOW
// ============================================================

/**
 * Complete ADADIVE storage deal — the one function your UI calls
 *
 * Flow:
 * 1. Connect Eternl wallet
 * 2. Upload file to backend (Pinata IPFS + metadata build)
 * 3. Build Cardano transaction with metadata
 * 4. Sign with Eternl wallet (user approves popup)
 * 5. Submit to Cardano Preprod
 * 6. Return real CID + real txHash
 *
 * @param {File}     file        - browser File object from input/drop
 * @param {object}   dealConfig  - { providerAddress, durationEpochs, pricePerEpochTHT }
 * @param {Function} onProgress  - callback(step, message) for UI updates
 * @returns {object} { cid, txHash, gatewayUrl, explorerUrl }
 */
async function signAndSubmitDeal(file, dealConfig, onProgress = () => {}) {
  console.log("\n[ADADIVE] ═══════════════════════════════════════");
  console.log("[ADADIVE] Starting full storage deal flow...");
  console.log("[ADADIVE] ═══════════════════════════════════════\n");

  try {
    // ── Step 1: Connect wallet ──────────────────────────
    onProgress(1, "Connecting Eternl wallet...");
    const { api, address, balanceADA } = await connectEternlWallet();

    if (balanceADA < 0.5) {
      throw new Error(
        `Insufficient balance. You have ${balanceADA.toFixed(2)} test ADA. ` +
        `Get free test ADA from https://docs.cardano.org/cardano-testnet/tools/faucet`
      );
    }

    onProgress(1, `Wallet connected · ${balanceADA.toFixed(2)} ADA`);

    // ── Step 2: Upload file to ADADIVE backend ──────────
    onProgress(2, "Pinning file to IPFS...");

    const formData = new FormData();
    formData.append("file",              file);
    formData.append("userAddress",       address);
    formData.append("providerAddress",   dealConfig.providerAddress || "");
    formData.append("durationEpochs",    String(dealConfig.durationEpochs    || 10));
    formData.append("pricePerEpochTHT",  String(dealConfig.pricePerEpochTHT  || 0.0013));

    const uploadResponse = await fetch("/api/deals/create", {
      method: "POST",
      body:   formData,
    });

    if (!uploadResponse.ok) {
      const err = await uploadResponse.json();
      throw new Error(`Upload failed: ${err.error || uploadResponse.statusText}`);
    }

    const dealPackage = await uploadResponse.json();
    const { cid, gatewayUrl } = dealPackage.file;

    onProgress(2, `Pinned to IPFS · CID: ${cid.slice(0, 16)}...`);
    console.log(`[ADADIVE] File CID: ${cid}`);
    console.log(`[ADADIVE] Gateway: ${gatewayUrl}`);

    // ── Step 3: Get UTXOs from wallet ───────────────────
    onProgress(3, "Preparing Cardano transaction...");
    const utxos         = await getWalletUTXOs(api);
    const changeAddress = await api.getChangeAddress();

    // ── Step 4: Build the transaction ───────────────────
    const { unsignedTxHex, txHash: expectedTxHash } = await buildDealTransaction({
      api,
      changeAddress,
      utxos,
      cardanoMetadata: dealPackage.cardanoMetadata,
      cid,
    });

    onProgress(3, "Transaction built · Awaiting wallet signature...");

    // ── Step 5: Sign and submit ──────────────────────────
    onProgress(4, "Please approve the transaction in Eternl...");
    const txHash = await signAndSubmitTransaction(api, unsignedTxHex);

    // ── Step 6: Return results ───────────────────────────
    const explorerUrl = `https://preprod.cardanoscan.io/transaction/${txHash}`;

    const result = {
      success:     true,
      cid,
      txHash,
      gatewayUrl,
      explorerUrl,
      metadataCid: dealPackage.metadataCid,
      deal:        dealPackage.deal,
      message:     "Storage deal anchored on Cardano Preprod",
    };

    onProgress(4, `Anchored on Cardano · TX: ${txHash.slice(0, 16)}...`);

    console.log("\n[ADADIVE] ═══════════════════════════════════════");
    console.log("[ADADIVE] ✅ DEAL COMPLETE");
    console.log(`[ADADIVE] CID:      ${cid}`);
    console.log(`[ADADIVE] TX Hash:  ${txHash}`);
    console.log(`[ADADIVE] Explorer: ${explorerUrl}`);
    console.log("[ADADIVE] ═══════════════════════════════════════\n");

    return result;

  } catch (error) {
    console.error("[ADADIVE] ❌ Deal failed:", error.message);
    onProgress(0, `Error: ${error.message}`);
    throw error;
  }
}

// ============================================================
// PART 7: REACT COMPONENT — DROP-IN PIN FILES UI UPDATE
// ============================================================
// Replace your existing handlePin function with this one
// in your Pin Files component

const REACT_INTEGRATION = `
// ── PASTE THIS INTO YOUR Pin Files React component ────────

import { signAndSubmitDeal } from "./adadive-cardano-tx";

// Replace your existing doPin function with this:
const doPin = async () => {
  if (files.length === 0) return;
  if (!wallet.ok) { connectWallet(); return; }

  setStep(2); // Show progress UI

  try {
    for (const f of files) {
      // Update progress for this file
      setProgress(p => ({ ...p, [f.id]: 10 }));

      const result = await signAndSubmitDeal(
        f.file, // the actual File object
        {
          providerAddress:  providers.find(p => p.selected)?.address || "",
          durationEpochs:   10,
          pricePerEpochTHT: 0.0013,
        },
        (step, message) => {
          // Map steps to progress percentage
          const pct = { 1: 25, 2: 50, 3: 75, 4: 100 }[step] || 0;
          setProgress(p => ({ ...p, [f.id]: pct }));
          console.log(message);
        }
      );

      // Update file with real CID and txHash
      setPinned(prev => [...prev, {
        ...f,
        cid:        result.cid,        // real IPFS CID
        tx:         result.txHash,     // real Cardano txHash
        gatewayUrl: result.gatewayUrl, // accessible URL
        explorerUrl: result.explorerUrl, // Cardanoscan link
      }]);
    }

    setStep(3); // Done

  } catch (error) {
    console.error("Deal failed:", error.message);
    alert("Deal failed: " + error.message);
    setStep(1); // Back to configure
  }
};

// In your Done screen, show the real links:
// <a href={f.explorerUrl}>View on Cardanoscan ↗</a>
// <a href={f.gatewayUrl}>Access file on IPFS ↗</a>
`;

// ============================================================
// PART 8: index.html SCRIPT TAG
// ============================================================

const INDEX_HTML_ADDITION = `
<!-- Add this to your public/index.html <head> section -->
<!-- cardano-serialization-lib — required for Cardano tx building -->
<script src="https://cdn.jsdelivr.net/npm/@emurgo/cardano-serialization-lib-browser@11.5.0/cardano_serialization_lib.js"></script>

<!-- It loads asynchronously. window.CardanoWasm will be available after load. -->
<!-- The getCSL() function in adadive-cardano-tx.js waits for it automatically. -->
`;

// ============================================================
// EXPORTS — for use in React frontend
// ============================================================
// Since this runs in the browser, use ES module export syntax
// if your project uses Vite/webpack, or add to window if plain JS

if (typeof module !== "undefined" && module.exports) {
  // CommonJS (Node test environment)
  module.exports = {
    connectEternlWallet,
    getWalletUTXOs,
    buildDealTransaction,
    signAndSubmitTransaction,
    signAndSubmitDeal,
  };
} else {
  // Browser — attach to window for global access
  window.ADADIVE = {
    connectEternlWallet,
    getWalletUTXOs,
    buildDealTransaction,
    signAndSubmitTransaction,
    signAndSubmitDeal,
  };
}

/*
 * ============================================================
 * FULL SETUP CHECKLIST
 * ============================================================
 *
 * BACKEND (already done in adadive-storage-integration.js):
 * ✅ Pinata IPFS pinning
 * ✅ Koios Cardano queries
 * ✅ Deal package builder
 * ✅ Express API routes
 *
 * FRONTEND (this file adds):
 * ☐ 1. Add CSL script tag to public/index.html
 *       <script src="https://cdn.jsdelivr.net/npm/@emurgo/cardano-serialization-lib-browser@11.5.0/cardano_serialization_lib.js"></script>
 *
 * ☐ 2. Add this file to your project:
 *       src/adadive-cardano-tx.js
 *
 * ☐ 3. Update your Pin Files component:
 *       Replace doPin() with the version in PART 7 above
 *
 * ☐ 4. In your Done screen, add real links:
 *       Cardanoscan: https://preprod.cardanoscan.io/transaction/{txHash}
 *       IPFS Gateway: {gatewayUrl}
 *
 * ☐ 5. Make sure your wallet is on Preprod network in Eternl settings
 *
 * ☐ 6. Get test ADA if needed:
 *       https://docs.cardano.org/cardano-testnet/tools/faucet
 *
 * MAINNET MIGRATION (when ready):
 * ☐ Change KOIOS_URL secret to https://api.koios.rest/api/v1
 * ☐ Change expectedNetwork to "mainnet" in connectEternlWallet()
 * ☐ Change explorer URL to https://cardanoscan.io/transaction/
 * ☐ Deploy smart contracts to mainnet
 * ☐ Switch Eternl wallet to mainnet
 *
 * ============================================================
 */
