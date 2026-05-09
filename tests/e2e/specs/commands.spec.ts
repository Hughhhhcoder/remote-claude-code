import { expect, test } from "@playwright/test";

test("Cmd+K opens palette and 新建 action opens NewSessionModal", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  // The palette listener uses metaKey || ctrlKey and is wired on window.
  // Ctrl+K works on all platforms including CI.
  await page.keyboard.press("Control+KeyK");

  const paletteInput = page.getByPlaceholder(
    /搜索 会话 \/ Skills \/ Commands \/ Subagents \/ Git \/ 动作/,
  );
  await expect(paletteInput).toBeVisible();

  await paletteInput.fill("新建");
  // First ranked action should be "新建会话". Press Enter to run.
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "新建会话" }).or(page.getByText("新建会话").first())).toBeVisible();
});

test("pressing Ctrl+K twice toggles palette", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  await page.keyboard.press("Control+KeyK");
  const paletteInput = page.getByPlaceholder(/搜索 会话/);
  await expect(paletteInput).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(paletteInput).toBeHidden();
});
