# @workspace/provider-agent

The storage agent a provider runs next to their own IPFS (Kubo) node. It is the
other end of the provider-run storage layer: it polls for deals assigned to the
provider's wallet, fetches and pins each CID locally, confirms the pin, and
heartbeats. It owns no database and is a separate package from `api-server`.

A provider with no registered node does not run this at all — their deals stay on
the centralized Pinata path, unchanged.

## What it does

Once per poll interval:

1. `GET /api/provider/assignments` — the deals assigned to this wallet's node,
   authenticated with a wallet-signed session.
2. `pin.add <cid>` on the local Kubo node (fetches the content if the node does
   not already hold it, then pins it).
3. `POST /api/provider/confirm-pin { assignmentId, cid, peerId }` — echoing the
   `assignmentId` it polled and the node's *actual* peer id, which the api-server
   checks against the assignment. The id, not the CID alone, selects the row:
   `deals.data_hash` is not unique, so two deals can share a CID and a CID-only
   confirm could mark the wrong one stored.

And once per heartbeat interval: `POST /api/provider/heartbeat { peerId }`.
The api-server stamps the heartbeat on the *peer*, not just the provider, and
the oracle's findprovs verification reads that per-peer timestamp to tell
"offline" from "online but no longer advertising the content" — so a provider
that rotates to a new node cannot make an old node's deals look alive.

## Sign-in

It reuses the existing wallet-signature flow, against the **oracle backend** —
there is no new auth:

1. `POST /auth/challenge { wallet }`
2. sign the message with the provider wallet's keypair
3. `POST /auth/verify { wallet, nonce, signature }` → a bearer token the
   api-server also accepts

The token is refreshed automatically on a 401 and is never written to disk.

## Configuration

All from the environment; `PROVIDER_KEYPAIR_PATH` is required (without it every
call would 401, so the agent refuses to start rather than spin).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROVIDER_KEYPAIR_PATH` | — (required) | Solana keypair JSON (`solana-keygen` format) of the provider wallet |
| `ORACLE_BASE_URL` | `http://127.0.0.1:5001` | Oracle backend, for sign-in only |
| `API_BASE_URL` | `http://127.0.0.1:5000/api` | api-server base **including** `/api` |
| `IPFS_API_URL` | `http://127.0.0.1:5001/api/v0` | Kubo HTTP RPC of the local node |
| `POLL_INTERVAL_MS` | `15000` | How often to poll for assignments |
| `HEARTBEAT_INTERVAL_MS` | `30000` | How often to heartbeat |
| `IPFS_TIMEOUT_MS` | `60000` | Timeout for one IPFS operation |
| `NODE_ENV` | `development` | `production` raises the log level to `info` |

The oracle and the Kubo node must be reachable on **different origins**. Their
defaults collide: the oracle's port (`5001`) is also Kubo's, so with only
`PROVIDER_KEYPAIR_PATH` set, sign-in and `pin.add` would both target
`http://127.0.0.1:5001` and one of them would reach the wrong process. The agent
refuses to start in that case and names the variable to change. Point
`ORACLE_BASE_URL` at the oracle and `IPFS_API_URL` at the node, e.g.:

```sh
ORACLE_BASE_URL=http://127.0.0.1:5001 \
IPFS_API_URL=http://127.0.0.1:5002/api/v0 \
PROVIDER_KEYPAIR_PATH=/path/to/keypair.json \
node artifacts/provider-agent/dist/index.mjs --once
```

## Running

```sh
pnpm --filter @workspace/provider-agent run dev      # tsx, watches nothing
pnpm --filter @workspace/provider-agent run build    # bundles to dist/index.mjs
node artifacts/provider-agent/dist/index.mjs         # long-running
node artifacts/provider-agent/dist/index.mjs --once  # one heartbeat + one poll, then exit
```

`--once` is the setup check: run it before leaving the agent running.

## Tests

`pnpm --filter @workspace/provider-agent run test`. No live IPFS node and no
database — the api-server and the node are replaced by fakes. See AGENTS.md
("Test report taxonomy").
