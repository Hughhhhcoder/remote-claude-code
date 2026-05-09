import { expect, test, request as apiRequest } from "@playwright/test";

test("recording: start → stop produces playable .cast file", async ({ page, baseURL }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  // Spin up a fresh session so the RecordingPanel renders in idle state
  // regardless of whatever recordings prior tests may have produced.
  await page.getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("button", { name: "创建会话", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建会话", exact: true })).toBeHidden();

  // Resolve the active sid by asking the host for its session list.
  const sid = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${location.host}/ws`);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            // ignore
          }
          reject(new Error("hello timeout"));
        }, 5000);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
            if (msg?.t === "hello" && Array.isArray(msg.sessions) && msg.sessions.length > 0) {
              clearTimeout(timer);
              ws.close();
              // The most recently created session is last in the list.
              const last = msg.sessions[msg.sessions.length - 1];
              resolve(last.id as string);
            }
          } catch {
            // ignore
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("ws error"));
        };
      }),
  );
  expect(sid).toBeTruthy();

  const startBtn = page.getByTitle(/开始录制会话/);
  await expect(startBtn).toBeVisible();
  await startBtn.click();

  const stopBtn = page.getByTitle("停止录制");
  await expect(stopBtn).toBeVisible();
  await stopBtn.click();

  await expect(page.getByTitle("回放录制")).toBeVisible({ timeout: 10_000 });

  // Fetch and verify the produced cast is a valid asciinema v2 stream for
  // the session we just recorded.
  const api = await apiRequest.newContext({ baseURL });
  const res = await api.get(`/recording/${sid}.cast`);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body.startsWith('{"version":2')).toBe(true);
  await api.dispose();
});
