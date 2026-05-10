// Pure helpers for MessageList perf tuning (B13-C).
//
// Used to decide when to auto-collapse rarely-visited older messages whose
// raw content dwarfs the row's reasonable render cost (e.g. a 2MB pty dump
// pasted into chat). Row-level collapse is complementary to B12-C's per-block
// collapse in TextBlock / CodeBlock / DiffBlock.
import type { ChatMessage, ChatSegment } from "@rcc/protocol";

/** Rough per-segment metadata overhead used when estimating in-memory size. */
const SEGMENT_OVERHEAD_BYTES = 200;

/** Threshold above which a message is considered "heavy" and eligible for
 *  row-level defer-render when it's outside the active tail window. */
export const HEAVY_MESSAGE_BYTES = 64 * 1024;

/** Rough in-memory size estimate (bytes) for a ChatMessage, used to decide
 *  when to auto-collapse rarely-visited older messages. Sums segment.content
 *  string lengths (byte-approximate for latin1; close enough for deciding
 *  collapse vs render), plus a fixed metadata overhead per segment. */
export function estimateMessageSize(m: ChatMessage): number {
  let total = 0;
  for (const seg of m.segments) {
    total += SEGMENT_OVERHEAD_BYTES;
    total += segmentContentLength(seg);
  }
  return total;
}

function segmentContentLength(seg: ChatSegment): number {
  switch (seg.kind) {
    case "text":
    case "code":
    case "diff":
    case "thinking":
      return seg.content.length;
    case "tool_use":
      return seg.input.length + (seg.output?.length ?? 0);
    case "tool_result":
      return seg.content.length;
    default:
      return 0;
  }
}
