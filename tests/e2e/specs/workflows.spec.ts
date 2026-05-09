import { expect, test } from "@playwright/test";

test("workflows tab: create + run emits WorkflowRunBar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Claude Code 配置/ }).click();
  await expect(page.getByText("Claude Code · 配置")).toBeVisible();

  await page.getByRole("button", { name: /Workflows/ }).click();
  await expect(page.getByRole("heading", { name: "Workflows 工作流" })).toBeVisible();

  await page.getByRole("button", { name: "+ 新建工作流" }).click();
  await expect(page.getByRole("heading", { name: "新建工作流" }).or(page.getByText("新建工作流").first())).toBeVisible();

  await page.getByPlaceholder("deploy-staging").fill("test-wf");
  await page.getByPlaceholder("发送给 Claude 的 prompt 文本").fill("hello");

  await page.getByRole("button", { name: "创建", exact: true }).click();

  const row = page.getByText("test-wf", { exact: true }).first();
  await expect(row).toBeVisible();

  await page.getByRole("button", { name: /▶ 运行/ }).first().click();

  await expect(page.getByText(/正在运行 workflow/)).toBeVisible();
  await expect(page.getByText("test-wf").first()).toBeVisible();
  await expect(page.getByText("1/1")).toBeVisible();
});
