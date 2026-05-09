// standup-note — summarise recent chat into a one-line progress note.
//
// Demonstrates reading session chat and producing a human-friendly
// summary. The `chat:read` permission is declared; today the plugin
// receives chat lines via the call payload (the client reads them and
// passes them in). When the host exposes a ctx.readChat API, this plugin
// will be able to fetch them directly.
//
// Install:
//   cp -R examples/plugins/standup-note ~/.rcc/plugins/standup-note

type Permission = "session:read" | "session:write" | "chat:read" | "broadcast";

interface CallContext {
  id: string;
  log: (msg: string) => void;
  hasPermission: (p: Permission) => boolean;
}

interface ChatLine {
  role: "user" | "assistant" | "system" | string;
  text: string;
  at?: number;
}

interface SummarizePayload {
  sid?: string;
  lines?: ChatLine[];
  limit?: number;
}

const DEFAULT_LIMIT = 10;
const VERB_HINTS = [
  { re: /\b(fix|fixed|fixing)\b/i, label: "修复" },
  { re: /\b(add|added|adding|implement|implemented)\b/i, label: "新增" },
  { re: /\b(refactor|refactored|clean)\b/i, label: "重构" },
  { re: /\b(test|tests|testing|coverage)\b/i, label: "测试" },
  { re: /\b(doc|docs|readme)\b/i, label: "文档" },
  { re: /\b(deploy|release|ship)\b/i, label: "发布" },
  { re: /\b(debug|investigate|trace)\b/i, label: "排查" },
];

function tidyText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function classify(text: string): string {
  for (const h of VERB_HINTS) if (h.re.test(text)) return h.label;
  return "进展";
}

function summarise(lines: ChatLine[], limit: number): string {
  const tail = lines.slice(-limit);
  const user = tail.filter((l) => l.role === "user");
  const assistant = tail.filter((l) => l.role === "assistant");

  if (tail.length === 0) return "今日进展:(无对话记录)";

  const topicLine = user[user.length - 1] ?? tail[tail.length - 1];
  const topic = tidyText(topicLine?.text ?? "", 120);
  const verb = classify(topic);

  const assistantTail = assistant[assistant.length - 1];
  const outcome = assistantTail ? tidyText(assistantTail.text, 120) : "";

  const pieces = [
    `今日进展:${verb}「${topic}」`,
    outcome ? `最新结论:${outcome}` : "",
    `(${tail.length} 条对话,user ${user.length} / assistant ${assistant.length})`,
  ].filter(Boolean);

  return pieces.join(" | ");
}

const plugin = {
  id: "standup-note",
  name: "Standup Note",
  version: "1.0.0",

  onLoad(ctx: { log: (m: string) => void }) {
    ctx.log("standup-note loaded");
  },

  async handleCall(method: string, payload: unknown, ctx: CallContext) {
    if (method === "summarize") {
      const p = (payload ?? {}) as SummarizePayload;
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const limit = typeof p.limit === "number" && p.limit > 0 ? Math.min(p.limit, 50) : DEFAULT_LIMIT;
      if (!ctx.hasPermission("chat:read")) {
        ctx.log("warning: chat:read permission missing — summary may be incomplete");
      }
      const summary = summarise(lines, limit);
      return {
        sid: p.sid ?? null,
        considered: Math.min(lines.length, limit),
        summary,
        generatedAt: Date.now(),
      };
    }
    if (method === "help") {
      return {
        methods: ["summarize", "help"],
        summarize: {
          payload: "{ sid?: string, lines: ChatLine[], limit?: number }",
          returns: "{ sid, considered, summary, generatedAt }",
        },
      };
    }
    throw new Error(`unknown method: ${method}`);
  },
};

export default plugin;
