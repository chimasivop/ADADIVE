/**
 * ADADIVE — Cardano Transaction Builder (browser-only)
 * Uses window.CardanoWasm (cardano-serialization-lib v11) loaded from CDN.
 * No Node.js Buffer — only Uint8Array.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    CardanoWasm: any;
  }
}

type EternlAPI = {
  getNetworkId(): Promise<number>;
  getUsedAddresses(opts?: { paginate?: { page: number; limit: number } }): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getBalance(): Promise<string>;
  getUtxos(): Promise<string[] | null | undefined>;
  signTx(tx: string, partial?: boolean): Promise<string>;
  submitTx(tx: string): Promise<string>;
};

export interface CardanoTxResult {
  txHash: string;
  explorerUrl: string;
}

// ─── Hex helpers (no Buffer) ──────────────────────────────────────────────────

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

// ─── Load CSL ────────────────────────────────────────────────────────────────

export async function getCSL(): Promise<any> {
  if (window.CardanoWasm) return window.CardanoWasm;
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
        reject(new Error("cardano-serialization-lib failed to load from CDN"));
      }
    }, 100);
  });
}

// ─── Eternl wallet API ───────────────────────────────────────────────────────

async function getEternlApi(): Promise<EternlAPI> {
  const cardano = (window as any).cardano;
  if (!cardano?.eternl) {
    throw new Error("Eternl wallet not found. Please install the Eternl browser extension.");
  }
  try {
    const api: EternlAPI = await cardano.eternl.enable();
    const networkId = await api.getNetworkId();
    if (networkId !== 0) {
      throw new Error(
        "Wrong network. ADADIVE is on Preprod — please switch your Eternl wallet to the Preprod/Preview testnet."
      );
    }
    return api;
  } catch (err: any) {
    if (err?.code === -3) {
      throw new Error("Wallet access denied. Please approve the connection in Eternl.");
    }
    throw err;
  }
}

// ─── Convert JS metadata object → CSL TransactionMetadatum ──────────────────

function jsToMetadatum(CSL: any, value: unknown): any {
  if (typeof value === "string") {
    if (value.length <= 64) return CSL.TransactionMetadatum.new_text(value);
    const list = CSL.MetaList.new();
    for (let i = 0; i < value.length; i += 64) {
      list.add(CSL.TransactionMetadatum.new_text(value.slice(i, i + 64)));
    }
    return CSL.TransactionMetadatum.new_list(list);
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
    value.forEach((item) => list.add(jsToMetadatum(CSL, item)));
    return CSL.TransactionMetadatum.new_list(list);
  }
  if (value !== null && typeof value === "object") {
    const map = CSL.MetaMap.new();
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      map.insert(
        CSL.TransactionMetadatum.new_text(k.slice(0, 64)),
        jsToMetadatum(CSL, v)
      );
    });
    return CSL.TransactionMetadatum.new_map(map);
  }
  return CSL.TransactionMetadatum.new_text(String(value).slice(0, 64));
}

// ─── Main: build + sign + submit ─────────────────────────────────────────────

export async function buildAndSubmitTx(
  cardanoMetadata: Record<string, unknown>,
  cid: string,
  onProgress: (msg: string) => void
): Promise<CardanoTxResult> {
  const CSL = await getCSL();

  onProgress("Connecting wallet…");
  const api = await getEternlApi();

  // Get UTXOs
  onProgress("Fetching UTXOs…");
  const utxosRaw = await api.getUtxos();
  if (!utxosRaw || utxosRaw.length === 0) {
    throw new Error(
      "No UTXOs in wallet. Get free test ADA from https://docs.cardano.org/cardano-testnet/tools/faucet"
    );
  }

  const utxos = utxosRaw.map((hex: string) =>
    CSL.TransactionUnspentOutput.from_bytes(hexToBytes(hex))
  );

  const changeAddressHex = await api.getChangeAddress();
  const changeAddress = CSL.Address.from_bytes(hexToBytes(changeAddressHex));

  // Build tx
  onProgress("Building Cardano transaction…");

  const linearFee = CSL.LinearFee.new(
    CSL.BigNum.from_str("44"),
    CSL.BigNum.from_str("155381")
  );

  // Try coins_per_utxo_byte (Babbage+); fall back to coins_per_utxo_word (pre-Vasil)
  let txBuilderConfig: any;
  try {
    txBuilderConfig = CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(linearFee)
      .pool_deposit(CSL.BigNum.from_str("500000000"))
      .key_deposit(CSL.BigNum.from_str("2000000"))
      .max_value_size(5000)
      .max_tx_size(16384)
      .coins_per_utxo_byte(CSL.BigNum.from_str("4310"))
      .build();
  } catch {
    txBuilderConfig = CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(linearFee)
      .pool_deposit(CSL.BigNum.from_str("500000000"))
      .key_deposit(CSL.BigNum.from_str("2000000"))
      .max_value_size(5000)
      .max_tx_size(16384)
      .coins_per_utxo_word(CSL.BigNum.from_str("34482"))
      .build();
  }

  const txBuilder = CSL.TransactionBuilder.new(txBuilderConfig);

  // Add inputs
  const inputsBuilder = CSL.TxInputsBuilder.new();
  let totalInput = CSL.BigNum.from_str("0");

  for (const utxo of utxos) {
    const inp    = utxo.input();
    const outp   = utxo.output();
    const amount = outp.amount().coin();
    const addrBytes = outp.address().to_bytes();

    // Try BaseAddress first, then EnterpriseAddress
    const addr = CSL.Address.from_bytes(addrBytes);
    let keyHash: any = null;
    try {
      keyHash = CSL.BaseAddress.from_address(addr)?.payment_cred()?.to_keyhash();
    } catch { /* ignore */ }
    if (!keyHash) {
      try {
        keyHash = CSL.EnterpriseAddress.from_address(addr)?.payment_cred()?.to_keyhash();
      } catch { /* ignore */ }
    }
    if (!keyHash) continue;

    inputsBuilder.add_key_input(keyHash, inp, outp.amount());
    totalInput = totalInput.checked_add(amount);
    if (parseInt(totalInput.to_str()) >= 2_000_000) break;
  }

  txBuilder.set_inputs(inputsBuilder);

  // Attach metadata (labels 721 + 1337)
  const generalMetadata = CSL.GeneralTransactionMetadata.new();
  if (cardanoMetadata["1337"]) {
    generalMetadata.insert(
      CSL.BigNum.from_str("1337"),
      jsToMetadatum(CSL, cardanoMetadata["1337"])
    );
  }
  if (cardanoMetadata["721"]) {
    generalMetadata.insert(
      CSL.BigNum.from_str("721"),
      jsToMetadatum(CSL, cardanoMetadata["721"])
    );
  }

  const auxData = CSL.AuxiliaryData.new();
  auxData.set_metadata(generalMetadata);
  txBuilder.set_auxiliary_data(auxData);

  // Min-ADA output back to self
  txBuilder.add_output(
    CSL.TransactionOutput.new(changeAddress, CSL.Value.new(CSL.BigNum.from_str("1000000")))
  );

  // TTL ~2 hours from now (slot approximation)
  txBuilder.set_ttl(Math.floor(Date.now() / 1000) + 36_000_000 + 7200);

  // Change
  txBuilder.add_change_if_needed(changeAddress);

  const txBody    = txBuilder.build();
  const txHash    = CSL.hash_transaction(txBody);
  const witnesses = CSL.TransactionWitnessSet.new();
  const unsignedTx = CSL.Transaction.new(txBody, witnesses, auxData);
  const unsignedHex = bytesToHex(unsignedTx.to_bytes());

  // Sign
  onProgress("Awaiting wallet signature — approve in Eternl…");
  let witnessHex: string;
  try {
    witnessHex = await api.signTx(unsignedHex, true);
  } catch (err: any) {
    if (err?.code === 2) throw new Error("Transaction declined. You rejected the signing request in Eternl.");
    throw new Error(`Signing failed: ${err?.info ?? err?.message ?? String(err)}`);
  }

  // Reconstruct signed tx
  const witnessSet = CSL.TransactionWitnessSet.from_bytes(hexToBytes(witnessHex));
  const signedTx   = CSL.Transaction.new(unsignedTx.body(), witnessSet, unsignedTx.auxiliary_data());
  const signedHex  = bytesToHex(signedTx.to_bytes());

  // Submit
  onProgress("Submitting to Cardano Preprod…");
  let submittedHash: string;
  try {
    submittedHash = await api.submitTx(signedHex);
  } catch (err: any) {
    if (err?.code === 3) throw new Error("Submission failed: insufficient ADA. Get test ADA from the Cardano faucet.");
    throw new Error(`Submission failed: ${err?.info ?? err?.message ?? String(err)}`);
  }

  const finalHash = submittedHash || bytesToHex(txHash.to_bytes());
  return {
    txHash:      finalHash,
    explorerUrl: `https://preprod.cardanoscan.io/transaction/${finalHash}`,
  };
}
