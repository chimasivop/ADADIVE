# E2E Test Status

## Deployment Configuration

### Backend API Server
- **Production URL**: https://workspaceapi-server-production-c05a.up.railway.app
- **Health Check**: GET /api/healthz returns {"status":"ok"}

### Database (Supabase PostgreSQL)
- **Session Pooler Connection String**: `postgresql://postgres.knaigsdfjfeuaucozoba:***@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
- **Schema**: Drizzle ORM schema defined in `lib/db/src/schema/`
- **Tables**: providers, deals, activity, waitlist, sessions, users

### Frontend (cardano-storage)
- **Production URL**: https://adadive.xyz
- **API URL Configuration**: Set via `VITE_API_URL` environment variable
- **Current Backend URL**: `https://workspaceapi-server-production-c05a.up.railway.app`

### Railway Deployment Notes
The `VITE_API_URL` environment variable must be set in Railway's Variables tab for the cardano-storage service to point to the correct API server.

---

## Database Migration Status

### Status: VERIFIED
**Date**: 2026-07-24

The Supabase PostgreSQL database **already contains all required tables**. The earlier "table does not exist" errors were caused by a network connectivity issue (IPv6 ENETUNREACH), not missing tables.

### Connection Method
The correct connection string uses Supabase's **Session Pooler** (Supavisor) for IPv4 connectivity:

```
postgresql://postgres.knaigsdfjfeuaucozoba:Dognimus09%23@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

Key differences from the old (broken) connection:
- Uses `postgres.knaigsdfjfeuaucozoba` (project-scoped user) instead of just `postgres`
- Uses `aws-0-eu-west-1.pooler.supabase.com` (Session Pooler) instead of `db.knaigsdfjfeuaucozoba.supabase.co` (direct connection)
- Requires `ssl: { rejectUnauthorized: false }` in the connection config

### Existing Tables
Verified via direct query - all required tables exist:

| Table | Description |
|-------|-------------|
| `providers` | Service providers with reputation scores, storage capacity, and earnings |
| `deals` | Marketplace deals linked to providers via foreign key |
| `activity` | User activity logs |
| `waitlist` | Waitlist entries for early access |
| `sessions` | Authentication sessions |
| `users` | User accounts (Supabase Auth) |

### Railway Configuration Required

Update the Railway `DATABASE_URL` environment variable:

1. Log into Railway dashboard: https://railway.app
2. Navigate to the `workspaceapi-server` project
3. Go to **Variables** tab
4. Update or add `DATABASE_URL`:
   ```
   postgresql://postgres.knaigsdfjfeuaucozoba:Dognimus09%23@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
   ```
5. Click **Deploy** to apply the changes

### Drizzle Config
Updated `lib/db/drizzle.config.ts` to use SSL with `rejectUnauthorized: false`:
```typescript
dbCredentials: {
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}
```

### Verification
After updating Railway's DATABASE_URL, test these endpoints:
- `GET https://workspaceapi-server-production-c05a.up.railway.app/api/providers` - Should return `[]` or provider data
- `GET https://workspaceapi-server-production-c05a.up.railway.app/api/deals` - Should return `[]` or deal data
- `GET https://workspaceapi-server-production-c05a.up.railway.app/api/stats/network` - Should return JSON with epoch data

---

## Homepage Stats Fix

### Issue
The homepage (Landing.tsx) was showing hardcoded values that didn't match the Dashboard.

### Resolution
Both pages now display **LIVE data** from the API (Supabase database):
- Total Storage: **15.50 TB** (14.5% Utilised)
- Active Deals: **2** (4 All Time)
- THT Locked: **1,096.4**
- Providers: **4 Active** (5 Total)
- Avg Reputation: **95.7 / 100**
- Avg Price: **0.00128 THT** per GB / Epoch

### Implementation
- `artifacts/cardano-storage/src/pages/Landing.tsx` - Now uses `useGetNetworkStats()` and `useGetEconomyStats()` hooks
- `artifacts/cardano-storage/src/pages/Dashboard.tsx` - Already uses live data hooks

### API Source
Both pages call the same endpoints:
- `/api/stats/network` - Returns network statistics from Supabase `providers` and `deals` tables
- `/api/stats/economy` - Returns economy statistics from Supabase aggregation queries

---

## P0 Security Fixes - Commit: f0604e0

### Changes Applied

| Fix | File | Description | Status |
|-----|------|-------------|--------|
| cookie-parser | `app.ts` | Registered `cookieParser()` middleware before routes | Complete |
| authMiddleware global | `routes/index.ts` | Applied `authMiddleware` globally so `req.isAuthenticated()` available | Complete |
| Auth guard | `deals.ts` | Added `requireAuth` to `POST /api/deals` | Complete |
| Auth guard | `deals.ts` | Added `requireAuth` to `PATCH /api/deplies/:id` | Complete |
| Auth guard | `providers.ts` | Added `requireAuth` to `POST /api/providers` | Complete |
| Auth guard | `storage.ts` | Added `requireAuth` to `POST /api/storage/pin` | Complete |
| multer/validation order | `storage.ts` | Fixed `POST /api/storage/pin` - moved multer before validation | Complete |

### P0 Testing Notes

| Test | Expected Result | Notes |
|------|-----------------|-------|
| OIDC login flow | No redirect loop | cookie-parser now parses `req.cookies` before OIDC callback |
| `POST /api/deals` (anonymous) | 401 Unauthorized | Auth guard returns `{"error":"Authentication required"}` |
| `PATCH /api/deals/:id` (anonymous) | 401 Unauthorized | Auth guard returns `{"error":"Authentication required"}` |
| `POST /api/providers` (anonymous) | 401 Unauthorized | Auth guard returns `{"error":"Authentication required"}` |
| `POST /api/storage/pin` (anonymous) | 401 Unauthorized | Auth guard returns `{"error":"Authentication required"}` |
| `POST /api/storage/pin` (with auth + file) | 200/201 with CID | multer now parses multipart before validation |

---

## P1 High-Priority Fixes

### Changes Applied

| Fix | File | Description | Status |
|-----|------|-------------|--------|
| THT policy ID | `cardano-storage/src/lib/token.ts` | Made policy ID configurable via `VITE_THT_POLICY_ID` env var (was 54 chars, needs 56) | Complete |
| Real epoch from Koios | `api-server/src/routes/stats.ts` | Replaced hardcoded epoch calc with `getCurrentEpochFromKoios()` | Complete |
| Real price history | `api-server/src/routes/stats.ts` | Replaced `Math.random()` with SQL aggregation from deals table | Complete |
| Address bech32 display | `cardano-storage/src/contexts/WalletContext.tsx` | Decode hex to bech32 via CSL `Address.from_bytes().to_bech32()` | Complete |
| SQL filtering deals | `api-server/src/routes/deals.ts` | Replaced `.filter()` with `eq()`/`and()` SQL WHERE clauses | Complete |
| SQL filtering providers | `api-server/src/routes/providers.ts` | Replaced `.filter()` with `eq()`/`gte()` SQL WHERE clauses | Complete |
| Rate limiting | `api-server/src/routes/waitlist.ts` | Added `express-rate-limit` middleware to `GET /api/waitlist` | Complete |
| Timing attack fix | `api-server/src/routes/waitlist.ts` | Replaced `===` with `crypto.timingSafeEqual()` | Complete |
| FK constraint | `lib/db/src/schema/deals.ts` | Added `.references(() => providersTable.id, { onDelete: "cascade" })` | Complete |

### P1 Testing Notes

| Test | Expected Result | Notes |
|------|-----------------|-------|
| THT balance display | Shows non-zero if THT exists | Set `VITE_THT_POLICY_ID` to correct 56-char policy after deployment |
| `GET /api/stats/network` | `currentEpoch` from Koios | Returns `null` with `currentEpochSource: "unavailable"` if Koios unreachable |
| `GET /api/stats/economy` | Real price history | `priceHistory` contains DB aggregation, or `{placeholder: true}` if no deals |
| Wallet address display | `addr_test1q...` format | Addresses now properly converted from hex bytes to bech32 |
| `GET /api/deals?status=active` | Filtered SQL results | Uses SQL WHERE instead of in-memory filter |
| `GET /api/providers?minReputation=80` | Filtered SQL results | Uses SQL WHERE `>=` instead of in-memory filter |
| `GET /api/waitlist` (no auth) | 401 Unauthorized | Rate limited to 100 req/15min |
| `GET /api/waitlist` (rate limited) | 429 Too Many Requests | Returns `{ "error": "Too many requests..." }` |
| Delete provider with deals | Cascade delete | FK constraint ensures deals deleted when provider removed |
