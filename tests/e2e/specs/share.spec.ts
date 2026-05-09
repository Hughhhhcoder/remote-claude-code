import { expect, test, request as apiRequest } from "@playwright/test";

test("share: generated URL shows readonly badge in a fresh context", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  const sid = await page.evaluate(async () => {
    return new Promise<string>((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error("hello timeout"));
      }, 5000);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg && msg.t === "hello" && Array.isArray(msg.sessions) && msg.sessions[0]) {
            clearTimeout(timer);
            ws.close();
            resolve(msg.sessions[0].id as string);
          }
        } catch {
          // ignore non-JSON
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    });
  });
  expect(sid).toBeTruthy();

  const api = await apiRequest.newContext({ baseURL });
  const res = await api.post("/share/new", {
    data: { sid, ttlMinutes: 5 },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { url: string; token: string; sid: string };
  expect(body.sid).toBe(sid);
  expect(body.url).toContain("share=");

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(body.url);
  await expect(guest.getByText("只读分享")).toBeVisible();
  await guestCtx.close();
  await api.dispose();
});
