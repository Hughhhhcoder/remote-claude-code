import { createMemo, createSignal, onMount } from "solid-js";
import type { CommandSummary, Starter } from "@rcc/protocol";
import type { RccClient } from "../client.ts";

/**
 * Fallback pinned command list used before the host responds with the
 * real pinned ids (or when the user hasn't pinned anything yet).
 * Copied from App.tsx — keep in sync until App.tsx is trimmed in P3-C.
 */
const FALLBACK_PINNED: readonly CommandSummary[] = [
  { id: "builtin:review", name: "review", description: "完整 PR 代码审查", scope: "builtin", pinned: true },
  { id: "builtin:security-review", name: "security-review", description: "安全审查", scope: "builtin", pinned: true },
  { id: "builtin:simplify", name: "simplify", description: "重构", scope: "builtin", pinned: true },
  { id: "builtin:clear", name: "clear", description: "清空", scope: "builtin", pinned: true },
];

export interface CommandsStore {
  commandsById: () => Record<string, CommandSummary>;
  pinnedIds: () => string[];
  starters: () => Starter[];
  /** Resolved pinned commands with fallback when ids are empty/unknown. */
  pinnedCommands: () => readonly CommandSummary[];
  /** Toggle pin status on the host (fires cmd.pin). */
  togglePin: (id: string, pinned: boolean) => void;
  dispose: () => void;
}

/**
 * Owns slash commands + pinned state + starters. Frames consumed:
 *   - cmd.list     → rebuild commandsById map
 *   - cmd.pinned   → replace pinnedIds
 *   - starter.list → replace starters
 *   - hello        → seed pinnedIds from `frame.pinnedCommands` (first boot)
 *
 * On mount we request both `cmd.list` and `starter.list` so consumers get
 * a populated store even if App didn't request them explicitly.
 */
export function createCommandsStore(client: RccClient): CommandsStore {
  const [commandsById, setCommandsById] = createSignal<Record<string, CommandSummary>>({});
  const [pinnedIds, setPinnedIds] = createSignal<string[]>([]);
  const [starters, setStarters] = createSignal<Starter[]>([]);

  const unsub = client.on((frame) => {
    if (frame.t === "hello") {
      if (frame.pinnedCommands) setPinnedIds(frame.pinnedCommands);
    }
    if (frame.t === "cmd.list") {
      const map: Record<string, CommandSummary> = {};
      for (const c of frame.commands) map[c.id] = c;
      setCommandsById(map);
    }
    if (frame.t === "cmd.pinned") {
      setPinnedIds(frame.ids);
    }
    if (frame.t === "starter.list") {
      setStarters(frame.starters);
    }
  });

  onMount(() => {
    client.send({ v: 1, t: "cmd.list.request" });
    client.send({ v: 1, t: "starter.list.request" });
  });

  const pinnedCommands = createMemo<readonly CommandSummary[]>(() => {
    const ids = pinnedIds();
    const map = commandsById();
    if (ids.length === 0) return FALLBACK_PINNED;
    const out: CommandSummary[] = [];
    for (const id of ids) {
      const meta = map[id];
      if (meta) {
        out.push(meta);
      } else {
        // Derive minimal meta from id (scope:name) before cmd.list arrives.
        const [scope, ...rest] = id.split(":");
        out.push({
          id,
          name: rest.join(":"),
          description: "",
          scope: (scope === "user" || scope === "project" || scope === "builtin"
            ? scope
            : "builtin") as CommandSummary["scope"],
          pinned: true,
        });
      }
    }
    return out;
  });

  function togglePin(id: string, pinned: boolean): void {
    client.send({ v: 1, t: "cmd.pin", id, pinned });
  }

  return {
    commandsById,
    pinnedIds,
    starters,
    pinnedCommands,
    togglePin,
    dispose: unsub,
  };
}
