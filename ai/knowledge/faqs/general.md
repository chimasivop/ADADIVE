# ADADIVE Frequently Asked Questions

## General Questions

### What is ADADIVE?
ADADIVE is a decentralized storage platform built on the Cardano blockchain. It enables users to store files on IPFS through a network of storage providers, with payments handled via Cardano's native ADA cryptocurrency. The platform uses smart contracts (deal escrow) to ensure secure, trustless storage agreements between clients and providers.

### How does ADADIVE work?
1. Users upload their files to IPFS and get a Content Identifier (CID)
2. A storage deal is created on the blockchain via the deal escrow smart contract
3. Payment is locked in escrow until the deal is completed
4. Storage providers store the files and periodically prove storage
5. Once the deal completes successfully, the provider is paid from escrow

### What is IPFS?
IPFS (InterPlanetary File System) is a distributed storage network. Files are content-addressed using CIDs (Content Identifiers), making them verifiable and resilient to tampering.

### What wallets are supported?
ADADIVE supports any Cardano wallet that supports CIP-30 (Cardano dApp connector), including:
- Nami
- Eternl
- Flint
- Yoroi
- Lace
- Typhon

## Storage Deals

### How do I create a storage deal?
1. Connect your Cardano wallet
2. Select the files you want to store
3. Choose a storage provider (or let ADADIVE select one)
4. Set the storage duration and confirm the price
5. Sign the transaction to lock payment in escrow
6. The provider begins storing your file

### How is pricing calculated?
Pricing is based on:
- Storage size (GB per epoch)
- Duration (number of epochs)
- Provider-specific rates

The total cost is locked in the escrow contract when the deal is created.

### What is an epoch?
An epoch is Cardano's time unit, approximately 5 days. Storage deals are typically measured in epochs.

### Can I extend a storage deal?
Yes, you can renew or extend active deals before they expire.

### What happens if a provider fails to store my file?
If a provider fails to maintain storage (e.g., goes offline), the escrow contract ensures:
- Partial refunds may be available depending on failure timing
- You can create a new deal with a different provider
- The oracle attests to proof-of-storage to trigger settlements

## Smart Contracts

### What is the deal escrow contract?
The ADADIVE escrow contract is a Cardano smart contract (Plutus V3) that:
- Holds payment in escrow during the storage period
- Releases payment to the provider upon successful completion (oracle-attested)
- Returns payment to the client if the provider fails or after deadline

### How does the oracle work?
The oracle is a trusted key that attests to whether a provider successfully stored the file. This is necessary because Cardano cannot directly verify off-chain storage proofs.

### Can the escrow be cancelled?
Yes, deals can be cancelled if both client and provider sign the cancellation transaction. The client must receive at least the original payment amount back.

## Security

### Is my data encrypted?
ADADIVE stores files on IPFS. For sensitive data, we recommend encrypting files before uploading.

### Who can access my stored files?
Files stored on IPFS are content-addressed. Anyone with the CID can potentially access the file. Use encryption for private data.

### Are transactions safe?
ADADIVE never accesses your private keys. All wallet interactions use CIP-30 connectors, giving you full control over signing transactions.
