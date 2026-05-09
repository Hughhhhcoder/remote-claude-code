import { expect, test } from "@playwright/test";

test.skip("context injector: pull messages from another session into current draft", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  // Desktop default view is terminal. Toggle to chat.
  const toggle = page.getByTitle(/切换终端 \/ 语义化对话视图/);
  if ((await toggle.textContent())?.includes("终端")) {
    await toggle.click();
  }

  // Send a prompt in the bootstrap session so we have something to pull later.
  const textarea = page.getByPlaceholder(/输入消息/);
  await textarea.fill("hello-from-session-one");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("hello-from-session-one").first()).toBeVisible();

  // Create a second session.
  await page.getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("button", { name: "创建会话", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "创建会话", exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建会话", exact: true })).toBeHidden();

  // The new session is the active one; toggle to chat if needed.
  const toggle2 = page.getByTitle(/切换终端 \/ 语义化对话视图/);
  if ((await toggle2.textContent())?.includes("终端")) {
    await toggle2.click();
  }

  await page.getByTitle("复用其他会话上下文").click();
  const dialog = page.locator("div").filter({ hasText: /📋 复用上下文/ }).first();
  await expect(dialog).toBeVisible();

  // Pick the first (source) session from the picker list.
  const pickerDialog = page.locator(".fixed.inset-0.z-50").filter({ hasText: "选择源会话" });
  await pickerDialog.locator("button", { hasText: /cli|sdk/ }).first().click();

  await expect(page.getByText(/以下是来自会话/)).toBeVisible();

  await page.getByRole("button", { name: /最近 10$/ }).click();
  await page.getByRole("button", { name: "注入到当前会话" }).click();

  // Dialog closes after inject.
  await expect(page.getByText("📋 复用上下文").first()).toBeHidden();
});
