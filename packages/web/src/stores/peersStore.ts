import { createSignal, createMemo } from "solid-js";
import type { PeerInfo } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

export type PeersStore = ReturnType<typeof createPeersStore>;

/**
 * Peer (host federation) domain store. Owns the list of remote hosts and
 * keeps per-peer connection status fresh.
 *
 * Frame dispatch:
 *   peer.list    → replace
 *   peer.status  → patch a single peer's { connected, error, sessionCount }
 *
 * Peer management (add / remove / reconnect) is driven from the PeersModal;
 * this store is read-only from the app shell's perspective.
 */
export function createPeersStore(client: RccClient) {
  const [peers, setPeers] = createSignal<PeerInfo[]>([]);

  const unsubFrame = client.on((frame) => {
    if (frame.t === "peer.list") {
      setPeers(frame.peers);
      return;
    }
    if (frame.t === "peer.status") {
      setPeers((ps) => {
        const idx = ps.findIndex((p) => p.id === frame.peerId);
        if (idx < 0) return ps;
        const next = ps.slice();
        next[idx] = {
          ...next[idx]!,
          connected: frame.connected,
          error: frame.error ?? null,
          sessionCount: frame.sessionCount ?? next[idx]!.sessionCount,
        };
        return next;
      });
      return;
    }
  });

  const connectedPeerCount = createMemo(
    () => peers().filter((p) => p.connected).length,
  );

  return {
    peers,
    connectedPeerCount,
    dispose: () => {
      unsubFrame();
    },
  };
}
