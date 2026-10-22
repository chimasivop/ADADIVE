/**
 * Local IPFS (Kubo) node access.
 *
 * The agent pins to the provider's *own* node — that is the point of the
 * provider-run storage layer. The node is assumed to be a local Kubo daemon
 * reachable over its HTTP RPC API, whose URL is configurable (`IPFS_API_URL`,
 * `http://127.0.0.1:5001/api/v0` by default).
 *
 * Only two operations are needed:
 *
 *   - `pinCid(cid)` — fetch the content by CID and pin it locally. `pin.add` on
 *     a CID that the node does not already hold fetches it from the network and
 *     pins it, which is exactly "fetch the file by CID, then pin it".
 *   - `peerId()` — the node's own libp2p peer id, which the assignment carries
 *     and confirm-pin must echo back so the api-server can check the report came
 *     from the right node.
 *
 * `kubo-rpc-client` rather than the deprecated `ipfs-http-client`, which is
 * superseded by this package.
 */

import type { Logger } from "./logger";

/**
 * The slice of the Kubo client the agent uses.
 *
 * Declared as an interface rather than importing `kubo-rpc-client`'s concrete
 * types at every call site so tests can pass a fake without constructing a real
 * client. `createKuboClient` is the only place the real package is imported.
 */
export interface IpfsNode {
  /** Fetch `cid` if needed and pin it locally. Returns the pinned CID string. */
  pinCid(cid: string): Promise<string>;
  /** This node's libp2p peer id, base58. */
  peerId(): Promise<string>;
}

export interface IpfsOptions {
  apiUrl: string;
  timeoutMs: number;
  logger: Logger;
}

export class IpfsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpfsError";
  }
}

/**
 * Build an `IpfsNode` backed by a real Kubo node.
 *
 * The dynamic import keeps `kubo-rpc-client` out of the module graph until it is
 * actually needed — the config and auth modules are exercised by unit tests that
 * must not require an IPFS stack to be present.
 */
export async function createKuboClient(options: IpfsOptions): Promise<IpfsNode> {
  const { create } = await import("kubo-rpc-client");
  const client = create({ url: options.apiUrl });

  return {
    async pinCid(cid: string): Promise<string> {
      try {
        // `pin add <cid>` fetches the content if the node does not already hold
        // it and pins it locally — "fetch the file by CID, then pin it". It
        // resolves to the pinned CID. `timeout` bounds a fetch that cannot find
        // any provider for the content.
        const pinned = await client.pin.add(cid, {
          timeout: `${options.timeoutMs}ms`,
        });
        options.logger.debug("pinned cid", { cid, pinned: String(pinned) });
        return String(pinned);
      } catch (err) {
        throw new IpfsError(
          `failed to pin ${cid}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },

    async peerId(): Promise<string> {
      try {
        const id = await client.id();
        return String(id.id);
      } catch (err) {
        throw new IpfsError(
          `could not read the node's peer id: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    },
  };
}
