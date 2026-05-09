import { createSignal, onCleanup, onMount } from "solid-js";
import type { PromptTemplate } from "@rcc/protocol";
import type { RccClient } from "./client.ts";

const PREFIX_RE = /(^|\s)\/p:([A-Za-z0-9._-][A-Za-z0-9._:-]{0,63})(\s|$)/;

export interface PromptPrefixMatch {
  name: string;
  /** Full `/p:<name>` match (including surrounding whitespace, without leading space). */
  matchStart: number;
  matchEnd: number;
  /** Just the `/p:<name>` literal, excluding any trailing space. */
  literalStart: number;
  literalEnd: number;
}

export function detectPromptPrefix(text: string): PromptPrefixMatch | null {
  const m = PREFIX_RE.exec(text);
  if (!m) return null;
  const lead = m[1] ?? "";
  const name = m[2]!;
  const trail = m[3] ?? "";
  const matchStart = m.index + lead.length;
  const literalStart = matchStart;
  const literalEnd = literalStart + ("/p:" + name).length;
  const matchEnd = literalEnd + trail.length;
  return { name, matchStart, matchEnd, literalStart, literalEnd };
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    return values[key] ?? "";
  });
}

export interface PromptExpansionApi {
  prompts: () => PromptTemplate[];
  findByName: (name: string) => PromptTemplate | null;
  hasPrefix: (text: string) => boolean;
  detect: (text: string) => PromptPrefixMatch | null;
  fill: (template: string, values: Record<string, string>) => string;
}

export function usePromptExpansion(client: RccClient): PromptExpansionApi {
  const [list, setList] = createSignal<PromptTemplate[]>([]);

  const unsub = client.on((frame) => {
    if (frame.t === "prompt.list") setList(frame.prompts);
  });
  onCleanup(unsub);

  onMount(() => {
    client.send({ v: 1, t: "prompt.list.request" });
  });

  function findByName(name: string): PromptTemplate | null {
    const n = name.trim();
    if (!n) return null;
    return list().find((p) => p.name === n) ?? null;
  }

  function hasPrefix(text: string): boolean {
    const m = detectPromptPrefix(text);
    return !!m && !!findByName(m.name);
  }

  return {
    prompts: list,
    findByName,
    hasPrefix,
    detect: detectPromptPrefix,
    fill: fillTemplate,
  };
}
