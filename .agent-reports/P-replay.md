# P · Replay protection (M5 batch 2)

E2E envelope now carries `s` (uint32 seq) + `ts` (Date.now ms). Both host and
web track a per-connection outbound counter and a 64-slot sliding-window
bitmap for inbound replay. Timestamps ±60s outside now are rejected. Host
closes bad frames with code 4402 (`replay` / `too_old` / `timestamp_skew`);
web mirrors the check and drops frames + reconnects on 4402. Loopback /
unencrypted connections bypass the gate. Seq + window are reset on every
(re)connect so clocks/counters self-heal.

## 已知局限

- Seq is uint32 — at ~4B frames/conn it would wrap; one side would reject
  until the other resets (in practice reconnect long before that).
- `s` / `ts` ride outside the secretbox MAC: tampering can only trigger
  reject, not forge decrypt — acceptable.
- Host and client clocks that drift >60s will hard-reject every frame until
  NTP realigns. Visible failure, not silent corruption.
