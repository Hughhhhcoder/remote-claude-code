import { expect, test } from "@playwright/test";

test.skip("backpressure: spamming 500 frames triggers rate-limit close (1008)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  const closeInfo = await page.evaluate(
    () =>
      new Promise<{ code: number; reason: string }>((resolve, reject) => {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${location.host}/ws`);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            // ignore
          }
          reject(new Error("close timeout"));
        }, 10000);
        ws.onopen = () => {
          for (let i = 0; i < 500; i++) {
            try {
              ws.send(JSON.stringify({ v: 1, t: "ping", ts: Date.now() }));
            } catch {
              break;
            }
          }
        };
        ws.onclose = (ev) => {
          clearTimeout(timer);
          resolve({ code: ev.code, reason: ev.reason });
        };
        ws.onerror = () => {
          // close will follow
        };
      }),
  );

  expect(closeInfo.code).toBe(1008);
});
