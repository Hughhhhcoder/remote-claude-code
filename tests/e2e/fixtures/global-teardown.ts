import type { HostHandle } from "./host.ts";

export default async function globalTeardown(): Promise<void> {
  const handle = (globalThis as { __rccHost?: HostHandle }).__rccHost;
  if (handle) await handle.kill();
}
