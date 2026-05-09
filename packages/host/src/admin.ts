#!/usr/bin/env tsx
// Admin CLI for the rcc-host trust store. Run from the host's terminal
// when you need to inspect or revoke devices without going through the UI
// (e.g. lost phone).
import { TrustStore } from "./trust.ts";
import { loadAllSnapshots, purgeAll, purgeStale, SESSIONS_DIR } from "./persistence.ts";

function usage(): never {
  console.error(`
Usage:
  rcc-admin devices                # list paired devices
  rcc-admin revoke <device-id>     # remove a device
  rcc-admin rename <device-id> <new-name>
  rcc-admin sessions               # list persisted session snapshots
  rcc-admin sessions --purge       # delete all snapshots in ~/.rcc/sessions/
  rcc-admin sessions --stale       # delete snapshots idle > 30 days
`);
  process.exit(1);
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "sessions" || cmd === "ss") {
  const flag = args[1];
  if (flag === "--purge") {
    const n = await purgeAll();
    console.log(`purged ${n} snapshot(s) from ${SESSIONS_DIR}`);
  } else if (flag === "--stale") {
    const n = await purgeStale();
    console.log(`purged ${n} stale snapshot(s) (idle > 30d)`);
  } else {
    const snaps = await loadAllSnapshots();
    if (snaps.length === 0) {
      console.log(`(no snapshots in ${SESSIONS_DIR})`);
    } else {
      for (const s of snaps) {
        const created = new Date(s.meta.createdAt).toISOString().slice(0, 19).replace("T", " ");
        const seen = new Date(s.meta.lastActiveAt).toISOString().slice(0, 19).replace("T", " ");
        console.log(
          `${s.meta.id}  ${s.meta.driver.padEnd(3)}  ${s.meta.title ?? s.meta.cwd}`,
        );
        console.log(
          `        created ${created}  last ${seen}  chat ${s.chat.length}  ring ${s.ringTail.length}B`,
        );
      }
    }
  }
  process.exit(0);
}

const trust = await TrustStore.load();

if (cmd === "devices" || cmd === "list" || cmd === "ls") {
  const rows = trust.devices();
  if (rows.length === 0) {
    console.log("(no paired devices)");
  } else {
    for (const d of rows) {
      const paired = new Date(d.createdAt).toISOString().slice(0, 19).replace("T", " ");
      const last = new Date(d.lastSeenAt).toISOString().slice(0, 19).replace("T", " ");
      // ANSI green ✓ when this device has an E2E shared key, dim ✗ otherwise.
      const e2e = d.sharedKey ? "\x1b[32m✓\x1b[0m" : "\x1b[2m✗\x1b[0m";
      console.log(`${d.id}  ${d.name.padEnd(24)}  paired ${paired}  last seen ${last}  e2e ${e2e}`);
    }
  }
} else if (cmd === "revoke" && args[1]) {
  const ok = await trust.revoke(args[1]);
  console.log(ok ? `revoked ${args[1]}` : `unknown device: ${args[1]}`);
} else if (cmd === "rename" && args[1] && args[2]) {
  const ok = await trust.rename(args[1], args[2]);
  console.log(ok ? `renamed ${args[1]} -> "${args[2]}"` : `unknown device: ${args[1]}`);
} else {
  usage();
}
