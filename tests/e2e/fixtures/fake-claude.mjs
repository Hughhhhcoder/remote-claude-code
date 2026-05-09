#!/usr/bin/env node
// Minimal CLI that stands in for `claude` during e2e tests. Prints a banner,
// echoes stdin back to stdout so tests can verify pty plumbing, and exits on
// EOF (^D). No prompts, no permission UI — the host's ApprovalWatcher never
// fires and tests stay deterministic.
process.stdout.write("fake-claude ready> ");
if (process.stdin.setRawMode) {
  try {
    process.stdin.setRawMode(true);
  } catch {
    // ignore — not a TTY
  }
}
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  const s = chunk.toString();
  if (s === "\x04") {
    process.exit(0);
  }
  process.stdout.write(s);
  if (s.includes("\r") || s.includes("\n")) {
    process.stdout.write("\nfake-claude ready> ");
  }
});
process.stdin.on("end", () => process.exit(0));
