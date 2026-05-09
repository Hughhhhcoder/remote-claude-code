import type { FullConfig } from "@playwright/test";
import { startHost, type HostHandle } from "./host.ts";

declare global {
  // eslint-disable-next-line no-var
  var __rccHost: HostHandle | undefined;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const port = Number(process.env.RCC_E2E_PORT ?? 7799);
  const handle = await startHost({ port });
  globalThis.__rccHost = handle;
  process.env.RCC_E2E_BASE_URL = handle.url;
}
