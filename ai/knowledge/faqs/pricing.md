# ADADIVE Pricing Guide

## Overview
ADADIVE uses a transparent, on-chain pricing model. All costs are calculated and locked in smart contracts at deal creation time.

## Cost Components

### Storage Cost
- **Per GB per Epoch**: Varies by provider
- **Formula**: `storage_cost = storage_gb × epochs × provider_rate`

### Transaction Fees
- **Deal Creation**: Standard Cardano transaction fee
- **Deal Settlement**: Paid by provider from escrow
- **Cancellation**: Both parties split fees

## Provider Rates
Each storage provider sets their own rates. Factors affecting rates:
- Geographic location
- Redundancy level
- Additional services (CDN, encryption)
- SLA guarantees

## Example Pricing

### Basic Storage
| Storage | Duration | Provider Rate | Est. Cost |
|---------|----------|---------------|-----------|
| 1 GB | 30 epochs | 10 ADA/GB/epoch | 300 ADA |
| 10 GB | 30 epochs | 10 ADA/GB/epoch | 3,000 ADA |
| 100 GB | 90 epochs | 8 ADA/GB/epoch | 72,000 ADA |

### Long-term Storage
| Storage | Duration | Discount |
|---------|----------|----------|
| Any | 90+ epochs | 10% |
| Any | 180+ epochs | 20% |
| 1+ TB | Any | Contact us |

## Payment Flow
1. **At Creation**: Full amount locked in escrow
2. **At Settlement**: Provider receives payment minus fees
3. **At Cancellation**: Client receives refund minus fees
4. **At Expiry**: Client can reclaim via Refund action

## Gas Considerations
Cardano transaction fees are dynamic:
- Busy network = higher fees
- Larger transactions = higher fees
- Complex smart contracts = higher fees

Plan for ~0.2-0.5 ADA transaction fees.

## FAQ

**Q: Are prices fixed once a deal is created?**
A: Yes. The total cost is locked at creation. No surprises.

**Q: Can I negotiate custom pricing?**
A: For enterprise storage (>1TB), contact us for custom arrangements.

**Q: What if ADA price changes?**
A: Your escrow amount is fixed in ADA. USD equivalent will vary with market.

**Q: Are there hidden fees?**
A: No. All costs are visible before transaction signing.
