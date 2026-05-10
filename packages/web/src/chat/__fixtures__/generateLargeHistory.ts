// Dev-only helper to generate a realistic large chat history for manual
// performance testing (B13-C). NOT wired into any prod path — intended to be
// imported in a REPL, a scratch story, or a dev panel and swapped in for
// real `ChatMessage[]` data while benchmarking MessageList scrolling.
//
// Typical invocation:
//   import { generateLargeHistory } from "./__fixtures__/generateLargeHistory";
//   setMessages(generateLargeHistory("dev-sid", 10_000));
// ~10k messages with this mix produce roughly 10MB of total content.
import type { ChatMessage, ChatSegment } from "@rcc/protocol";

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod " +
  "tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
  "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip.";

const CODE_SAMPLE = [
  "function fib(n: number): number {",
  "  if (n < 2) return n;",
  "  return fib(n - 1) + fib(n - 2);",
  "}",
  "",
  "const out = Array.from({ length: 20 }, (_, i) => fib(i));",
  "console.log(out);",
].join("\n");

const DIFF_SAMPLE = [
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,3 +1,4 @@",
  " export function greet(name: string) {",
  "-  return `hi ${name}`;",
  "+  return `hello, ${name}!`;",
  "+  // v2",
  " }",
].join("\n");

function repeat(str: string, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += str;
  return out;
}

function pickSegments(i: number): ChatSegment[] {
  // Mix: mostly text; every 5th has code; every 13th has a diff; every 37th
  // is "heavy" (~100KB) to stress the row-level collapse path.
  const segs: ChatSegment[] = [];
  const heavy = i % 37 === 0;
  const reps = heavy ? 400 : 2;
  segs.push({ kind: "text", content: repeat(`[#${i}] ${LOREM} `, reps) });
  if (i % 5 === 0) segs.push({ kind: "code", lang: "ts", content: CODE_SAMPLE });
  if (i % 13 === 0) segs.push({ kind: "diff", path: "foo.ts", content: DIFF_SAMPLE });
  if (i % 17 === 0) {
    segs.push({
      kind: "tool_use",
      tool: "Bash",
      input: `ls -la /tmp/run-${i}`,
      output: repeat(`drwxr-xr-x  3 user  staff   96 file-${i}\n`, 20),
      collapsed: true,
    });
  }
  return segs;
}

export function generateLargeHistory(sid: string, count: number): ChatMessage[] {
  const out: ChatMessage[] = new Array(count);
  const start = Date.now() - count * 1000;
  for (let i = 0; i < count; i++) {
    const role: ChatMessage["role"] =
      i % 3 === 0 ? "user" : i % 50 === 0 ? "system" : "assistant";
    out[i] = {
      id: `${sid}-${i}`,
      sid,
      role,
      segments: pickSegments(i),
      timestamp: start + i * 1000,
    };
  }
  return out;
}
