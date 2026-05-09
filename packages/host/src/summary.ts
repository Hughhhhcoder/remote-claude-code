import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, ChatSegment, SessionSummary } from "@rcc/protocol";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";
const CALL_TIMEOUT_MS = 30_000;
const RECENT_CHAT_CAP = 50;
const MAX_TITLE_CHARS = 60;
const MAX_BULLETS = 5;
const MIN_BULLETS = 3;

export interface SummaryInput {
  sid: string;
  chat: readonly ChatMessage[];
}

export async function summarizeSession(input: SummaryInput): Promise<SessionSummary> {
  const recent = input.chat.slice(-RECENT_CHAT_CAP);
  const apiKey = await resolveApiKey();
  if (apiKey) {
    try {
      const out = await callAnthropic(apiKey, recent);
      if (out) return { ...out, updatedAt: Date.now() };
    } catch (err) {
      // Redact: never log the key. err.message can include upstream details.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[rcc-host] summary anthropic call failed (${input.sid}): ${msg}`);
    }
  }
  return { ...heuristic(recent), updatedAt: Date.now() };
}

function heuristic(chat: readonly ChatMessage[]): { title: string; bullets: string[] } {
  const userMsgs = chat.filter((m) => m.role === "user");
  const firstUserText = userMsgs[0] ? flattenMessage(userMsgs[0]) : "";
  const title = (firstUserText.trim().slice(0, MAX_TITLE_CHARS) || "Untitled session").replace(
    /\s+/g,
    " ",
  );
  const bullets: string[] = [];
  for (const m of userMsgs) {
    if (bullets.length >= MIN_BULLETS) break;
    const text = flattenMessage(m).trim().replace(/\s+/g, " ");
    if (!text) continue;
    bullets.push(text.slice(0, 120));
  }
  if (bullets.length === 0) bullets.push("(no user messages)");
  return { title, bullets };
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
      return `\`\`\`${s.lang ?? ""}\n${s.content}\n\`\`\``;
    case "diff":
      return `[diff ${s.path ?? ""}]`;
    case "tool_use":
      return `[tool ${s.tool}] ${s.input}`;
    case "tool_result":
      return s.content;
    default:
      return "";
  }
}

async function callAnthropic(
  apiKey: string,
  chat: readonly ChatMessage[],
): Promise<{ title: string; bullets: string[] } | null> {
  const transcript = chat
    .map((m) => `[${m.role}] ${flattenMessage(m).slice(0, 1500)}`)
    .join("\n\n")
    .slice(0, 12_000);
  const system =
    "You summarize coding sessions. Reply with exactly one short title line (<= 60 characters) followed by 3-5 dash-prefixed bullets that capture what was asked and done. Preserve the user's language (Chinese or English). No preamble, no code fences, no numbering.";
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 300,
    system,
    messages: [
      {
        role: "user",
        content: `Summarize this coding session:\n\n${transcript}`,
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`anthropic ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (data.content ?? [])
    .map((b) => (typeof b?.text === "string" ? b.text : ""))
    .join("\n")
    .trim();
  if (!text) return null;
  return parseSummary(text);
}

function parseSummary(text: string): { title: string; bullets: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { title: "Untitled session", bullets: [] };
  const rawTitle = lines[0]!.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim();
  const title = rawTitle.slice(0, MAX_TITLE_CHARS) || "Untitled session";
  const bullets: string[] = [];
  for (const line of lines.slice(1)) {
    if (bullets.length >= MAX_BULLETS) break;
    const b = line
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+\.\s*/, "")
      .trim();
    if (!b) continue;
    bullets.push(b.slice(0, 200));
  }
  return { title, bullets };
}

async function resolveApiKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const raw = await readFile(join(homedir(), ".rcc", "config.json"), "utf8");
    const cfg = JSON.parse(raw) as { anthropic?: { apiKey?: string } };
    const key = cfg.anthropic?.apiKey;
    if (typeof key === "string" && key.trim()) return key.trim();
  } catch {
    // no config or unreadable — fall through to heuristic
  }
  return null;
}
