import { expect, test } from "@playwright/test";

// [federation] First-pass coverage: the feature is opt-in per user (requires
// editing ~/.rcc/peers.json) and spinning a second host with a valid device
// token is non-trivial in a single-process e2e harness. This suite is kept
// intentionally thin:
//
//  1. The host starts without a peers.json and doesn't crash.
//  2. The local client sees an empty peer.list (no 🌐 badge rendered).
//  3. The PeersModal can be opened and displays the "暂无 peer" empty state.
//
// A full two-host integration is deferred (TODO: spawn a second fake host
// process and inject peers.json so the FederatedClient actually connects).

test("host boots without peers and no federation badge shown", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  // The 🌐 N/M badge is only rendered when peers().length > 0. With an empty
  // peers.json the button should be absent.
  const badge = page.getByTitle(/Host federation/);
  await expect(badge).toHaveCount(0);
});

test("peers modal opens via command palette and shows empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  // Open command palette
  await page.keyboard.press("Meta+KeyK").catch(() => page.keyboard.press("Control+KeyK"));
  // Fallback if keyboard shortcut didn't fire: open modal directly by typing.
  // The palette action label is "管理 peers".
  await page.keyboard.type("peers");
  // Press Enter on the first result
  await page.keyboard.press("Enter").catch(() => {});
  // Look for the PeersModal heading.
  await expect(page.getByText("Host Federation · Peers")).toBeVisible({ timeout: 3000 });
  await expect(page.getByText("暂无 peer · 下方添加")).toBeVisible();
});
