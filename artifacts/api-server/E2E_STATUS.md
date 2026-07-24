# E2E Test Status

## Deployment Configuration

### Backend API Server
- **Production URL**: https://workspaceapi-server-production-c05a.up.railway.app
- **Health Check**: GET /api/healthz returns {"status":"ok"}

### Database (Supabase PostgreSQL)
- **Connection String**: `postgresql://postgres:***@db.knaigsdfjfeuaucozoba.supabase.co:5432/postgres`
- **Schema**: Drizzle ORM schema defined in `lib/db/src/schema/`
- **Tables to create**:
  - `providers` - Service providers with reputation scores
  - `deals` - Marketplace deals linked to providers
  - `activity` - User activity logs
  - `waitlist` - Waitlist entries for early access
  - `sessions` - Authentication sessions

### Frontend (cardano-storage)
- **Production URL**: https://adadive.xyz
- **API URL Configuration**: Set via `VITE_API_URL` environment variable
- **Current Backend URL**: `https://workspaceapi-server-production-c05a.up.railway.app`
- **Files Modified**:
  - `artifacts/cardano-storage/src/App.tsx` - Added `setBaseUrl()` call to configure API endpoint
  - `artifacts/cardano-storage/.env.production` - Created with `VITE_API_URL` variable

### Railway Deployment Notes
The `VITE_API_URL` environment variable must be set in Railway's Variables tab for the cardano-storage service to point to the correct API server.

---

## Database Migration Status

### Migration Required
**Status**: ⚠️ Action Required

The Supabase PostgreSQL database is missing the required tables. The Railway backend returns errors like:
- `table "providers" does not exist`
- `table "deals" does not exist`

### Migration Steps

1. **Supabase Configuration Required**:
   - Log into Supabase dashboard: https://supabase.com/dashboard
   - Navigate to the project: `knaigsdfjfeuaucozoba`
   - Go to **Settings > Database**
   - Under **Connection Pooling**, ensure **Connection URI** is accessible
   - Under **Connection Security**, set **Enforce SSL** as needed

2. **Run Migration via GitHub Actions**:
   - Navigate to: https://github.com/chimasivop/ADADIVE/actions/workflows/db-migrate.yml
   - Click **Run workflow**
   - Enter the database URL: `postgresql://postgres:Dognimus09%23@db.knaigsdfjfeuaucozoba.supabase.co:5432/postgres`
   - Enable "Force push" to drop and recreate tables
   - Click **Run workflow**

3. **Or Run Migration via Railway**:
   - Log into Railway dashboard: https://railway.app
   - Navigate to the `workspaceapi-server` project
   - Go to **Variables** tab
   - Add `SKIP_MIGRATIONS=false` (if not already set)
   - Click **Deploy** to trigger a new deployment

### Migration Script
The migration script is defined in `lib/db/drizzle.config.ts` and uses `drizzle-kit push` to sync the schema.

### Verification
After migration completes, test these endpoints:
- `GET https://workspaceapi-server-production-c05a.up.railway.app/api/providers` - Should return `[]`
- `GET https://workspaceapi-server-production-c05a.up.railway.app/api/deals` - Should return `[]`
- `GET https://workspaceapi-server-production-c05a.up.railway.app/api/stats/network` - Should return JSON with epoch data

---

## P0 Security Fixes - Commit: f0604e0

### Changes Applied

| Fix | File | Description | Status |
|-----|------|-------------|--------|
| cookie-parser | `app.ts` | Registered `cookieParser()` middleware before routes | ✅ Complete |
| authMiddleware global | `routes/index.ts` | Applied `authMiddleware` globally so `req.isAuthenticated()` available | ✅ Complete |
| Auth guard | `deals.ts` | Added `requireAuth` to `POST /api/deals` | ✅ Complete |
| Auth guard | `deals.ts` | Added `requireAuth` to `PATCH /api/deplies/:id` | ✅ Complete |
| Auth guard | `providers.ts` | Added `requireAuth` to `POST /api/providers` | ✅ Complete |
| Auth guard | `storage.ts` | Added `requireAuth` to `POST /api/storage/pin` | ✅ Complete |
| multer/validation order | `storage.ts` | Fixed `POST /api/storage/pin` - moved multer before validation | ✅ Complete |

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
| THT policy ID | `cardano-storage/src/lib/token.ts` | Made policy ID configurable via `VITE_THT_POLICY_ID` env var (was 54 chars, needs 56) | ✅ Complete |
| Real epoch from Koios | `api-server/src/routes/stats.ts` | Replaced hardcoded epoch calc with `getCurrentEpochFromKoios()` | ✅ Complete |
| Real price history | `api-server/src/routes/stats.ts` | Replaced `Math.random()` with SQL aggregation from deals table | ✅ Complete |
| Address bech32 display | `cardano-storage/src/contexts/WalletContext.tsx` | Decode hex to bech32 via CSL `Address.from_bytes().to_bech32()` | ✅ Complete |
| SQL filtering deals | `api-server/src/routes/deals.ts` | Replaced `.filter()` with `eq()`/`and()` SQL WHERE clauses | ✅ Complete |
| SQL filtering providers | `api-server/src/routes/providers.ts` | Replaced `.filter()` with `eq()`/`gte()` SQL WHERE clauses | ✅ Complete |
| Rate limiting | `api-server/src/routes/waitlist.ts` | Added `express-rate-limit` middleware to `GET /api/waitlist` | ✅ Complete |
| Timing attack fix | `api-server/src/routes/waitlist.ts` | Replaced `===` with `crypto.timingSafeEqual()` | ✅ Complete |
| FK constraint | `lib/db/src/schema/deals.ts` | Added `.references(() => providersTable.id, { onDelete: "cascade" })` | ✅ Complete |

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
