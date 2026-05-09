#!/usr/bin/env node
// node-pty's pnpm-based install sometimes leaves `spawn-helper` without +x.
// Without execute permission `posix_spawnp` fails and the pty call blows up.
// Fix it idempotently after install.
import { chmodSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

function findHelpers() {
  try {
    const out = execSync(
      "find node_modules -type f -name spawn-helper -path '*/node-pty/*' 2>/dev/null",
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

for (const p of findHelpers()) {
  if (!existsSync(p)) continue;
  const mode = statSync(p).mode;
  if ((mode & 0o111) === 0) {
    chmodSync(p, 0o755);
    console.log(`[rcc] chmod +x ${p}`);
  }
}
