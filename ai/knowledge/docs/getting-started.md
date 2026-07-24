# ADADIVE Getting Started Guide

## Prerequisites
- Cardano wallet (Nami, Eternl, Flint, Yoroi, or Lace)
- ADA for storage payments and transaction fees
- Web browser with CIP-30 wallet connector

## Quick Start

### 1. Connect Your Wallet
1. Visit [adadive.xyz](https://adadive.xyz)
2. Click "Connect Wallet"
3. Select your wallet from the list
4. Approve the connection request in your wallet

### 2. Fund Your Wallet
You'll need ADA for:
- Storage payments (locked in escrow)
- Transaction fees (~0.2-0.5 ADA per transaction)

Recommended initial amount: 100-500 ADA for testing

### 3. Upload a File
1. Click "Upload" or drag and drop
2. Select your file
3. Wait for IPFS upload and CID generation
4. Note your Content Identifier (CID)

### 4. Create a Storage Deal
1. Review the generated CID
2. Select a storage provider (or use auto-select)
3. Choose storage duration (epochs)
4. Review pricing summary
5. Click "Create Deal"
6. Sign the transaction in your wallet

### 5. Monitor Your Deal
- View active deals in "My Storage" dashboard
- Check provider status
- View transaction history
- Receive notifications on deal updates

## Platform Sections

### Storage
- Upload files to IPFS
- Create and manage storage deals
- View file status and CIDs

### Providers
- Browse available storage providers
- Compare pricing and ratings
- Select preferred providers

### Activity
- Transaction history
- Deal lifecycle tracking
- Payment records

### Settings
- Notification preferences
- Wallet management
- API access (advanced)

## First-Time Tips

### Start Small
Begin with a small file and short duration to understand the flow.

### Keep Records
Save your CIDs! You need them to retrieve files later.

### Monitor Deals
Check your active deals regularly to ensure providers are performing.

### Understand Costs
Review the pricing FAQ before creating large deals.

## Common Tasks

### Retrieving a Stored File
1. Find your deal in "My Storage"
2. Copy the CID
3. Use any IPFS gateway to download:
   - ipfs.io/ipfs/[CID]
   - cloudflare-ipfs.com/ipfs/[CID]

### Extending a Deal
1. Go to deal details
2. Click "Extend"
3. Select new duration
4. Sign extension transaction

### Cancelling a Deal
1. Contact your provider (required)
2. Provider must co-sign cancellation
3. Your escrowed funds are returned

## Troubleshooting

### "Wallet not connected"
- Ensure wallet extension is installed
- Refresh the page
- Try a different wallet

### "Transaction failed"
- Check your ADA balance
- Increase transaction fee if network is congested
- Try again during off-peak hours

### "No providers available"
- Wait for providers to come online
- Try a different region/time
- Contact support

## Next Steps
- Explore [provider documentation](providers.md)
- Learn about [smart contracts](contracts/escrow.md)
- Review [pricing details](../faqs/pricing.md)
- Join our community for updates
