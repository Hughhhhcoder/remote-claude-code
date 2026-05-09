import type { ChatMessage, ChatSegment, SearchMatch } from "@rcc/protocol";

const MAX_MATCHES = 30;
const EXCERPT_CHARS = 200;
const EXCERPT_RADIUS = 80;
const MAX_EXCERPTS_PER_SID = 3;

interface SessionMetaLite {
  id: string;
  title?: string;
  summaryTitle?: string;
}

/**
 * In-memory inverted index over persisted chat bodies. Built at host boot from
 * snapshot chat arrays and kept fresh via `update(sid, chat)` on every
 * chat.append. Search is AND-match on tokens with hit-count ranking — no
 * BM25 / tf-idf. Excerpts are sliced from the stored full-body string and
 * capped to EXCERPT_CHARS.
 */
export class SearchIndex {
  private readonly index = new Map<string, Set<string>>();
  private readonly sessionBodies = new Map<string, string>();
  private readonly sessionTokens = new Map<string, Set<string>>();
  private readonly metas = new Map<string, SessionMetaLite>();

  rebuild(entries: Array<{ sid: string; chat: readonly ChatMessage[]; meta: SessionMetaLite }>): void {
    this.index.clear();
    this.sessionBodies.clear();
    this.sessionTokens.clear();
    this.metas.clear();
    for (const e of entries) {
      this.metas.set(e.sid, e.meta);
      this.indexOne(e.sid, e.chat);
    }
  }

  update(sid: string, chat: readonly ChatMessage[], meta?: SessionMetaLite): void {
    if (meta) this.metas.set(sid, meta);
    this.removeSidFromIndex(sid);
    this.indexOne(sid, chat);
  }

  setMeta(sid: string, meta: SessionMetaLite): void {
    this.metas.set(sid, meta);
  }

  remove(sid: string): void {
    this.removeSidFromIndex(sid);
    this.metas.delete(sid);
  }

  search(query: string): SearchMatch[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    let candidates: Set<string> | null = null;
    for (const term of terms) {
      const hits = this.index.get(term);
      if (!hits || hits.size === 0) return [];
      if (candidates === null) {
        candidates = new Set(hits);
      } else {
        for (const sid of candidates) if (!hits.has(sid)) candidates.delete(sid);
      }
      if (candidates.size === 0) return [];
    }
    if (!candidates) return [];
    const scored: SearchMatch[] = [];
    for (const sid of candidates) {
      const body = this.sessionBodies.get(sid) ?? "";
      const score = countHits(body, terms);
      if (score === 0) continue;
      const meta = this.metas.get(sid);
      scored.push({
        sid,
        title: meta?.summaryTitle || meta?.title || sid,
        score,
        excerpts: makeExcerpts(body, terms),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_MATCHES);
  }

  private indexOne(sid: string, chat: readonly ChatMessage[]): void {
    const body = chat.map(flattenMessage).filter(Boolean).join("\n");
    this.sessionBodies.set(sid, body);
    const tokens = new Set(tokenize(body));
    this.sessionTokens.set(sid, tokens);
    for (const tok of tokens) {
      let bucket = this.index.get(tok);
      if (!bucket) {
        bucket = new Set();
        this.index.set(tok, bucket);
      }
      bucket.add(sid);
    }
  }

  private removeSidFromIndex(sid: string): void {
    const tokens = this.sessionTokens.get(sid);
    if (!tokens) return;
    for (const tok of tokens) {
      const bucket = this.index.get(tok);
      if (!bucket) continue;
      bucket.delete(sid);
      if (bucket.size === 0) this.index.delete(tok);
    }
    this.sessionTokens.delete(sid);
    this.sessionBodies.delete(sid);
  }
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?·。,!?;:""''【】《》()]/g, " ");
  const parts = cleaned.split(/\s+/);
  const out: string[] = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed.length > 1) out.push(trimmed);
  }
  return out;
}

function flattenMessage(m: ChatMessage): string {
  return m.segments.map(flattenSegment).filter(Boolean).join(" ");
}

function flattenSegment(s: ChatSegment): string {
  switch (s.kind) {
    case "text":
    case "thinking":
      return s.content;
    case "code":
      return s.content;
    case "diff":
      return s.content;
    case "tool_use":
      return `${s.tool} ${s.input} ${s.output ?? ""}`;
    case "tool_result":
      return s.content;
    default:
      return "";
  }
}

function countHits(body: string, terms: string[]): number {
  const hay = body.toLowerCase();
  let total = 0;
  for (const t of terms) {
    let idx = 0;
    while (idx < hay.length) {
      const found = hay.indexOf(t, idx);
      if (found < 0) break;
      total++;
      idx = found + t.length;
    }
  }
  return total;
}

function makeExcerpts(body: string, terms: string[]): string[] {
  const hay = body.toLowerCase();
  const out: string[] = [];
  const seen = new Set<number>();
  for (const t of terms) {
    let idx = 0;
    while (out.length < MAX_EXCERPTS_PER_SID && idx < hay.length) {
      const found = hay.indexOf(t, idx);
      if (found < 0) break;
      const start = Math.max(0, found - EXCERPT_RADIUS);
      const key = Math.floor(start / EXCERPT_RADIUS);
      if (!seen.has(key)) {
        seen.add(key);
        const end = Math.min(body.length, start + EXCERPT_CHARS);
        const prefix = start > 0 ? "…" : "";
        const suffix = end < body.length ? "…" : "";
        out.push((prefix + body.slice(start, end) + suffix).replace(/\s+/g, " ").trim());
      }
      idx = found + t.length;
    }
    if (out.length >= MAX_EXCERPTS_PER_SID) break;
  }
  return out;
}
