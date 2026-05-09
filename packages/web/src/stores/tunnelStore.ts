import { createSignal } from "solid-js";
import type { TunnelInfo } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

export interface TunnelStore {
  tunnel: () => TunnelInfo | null;
  dispose: () => void;
}

/**
 * Owns the public-tunnel state (cloudflared / named tunnel).
 * Frames consumed:
 *   - hello         → seed from `frame.tunnel` if present
 *   - tunnel.status → replace with the live status
 *
 * No actions — this state is host-controlled.
 */
export function createTunnelStore(client: RccClient): TunnelStore {
  const [tunnel, setTunnel] = createSignal<TunnelInfo | null>(null);

  const unsub = client.on((frame) => {
    if (frame.t === "hello") {
      if (frame.tunnel) setTunnel(frame.tunnel);
    } else if (frame.t === "tunnel.status") {
      setTunnel(frame.tunnel);
    }
  });

  return {
    tunnel,
    dispose: unsub,
  };
}
