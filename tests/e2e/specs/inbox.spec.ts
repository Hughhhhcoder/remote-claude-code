import { expect, test } from "@playwright/test";

test("inbox: open panel, switch tabs, close", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  await page.getByTitle("Inbox 活动流").click();

  await expect(page.getByRole("button", { name: "全部", exact: true })).toBeVisible();
  await expect(page.getByText("Inbox", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "审批", exact: true }).click();
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await page.getByRole("button", { name: "系统", exact: true }).click();
  await page.getByRole("button", { name: "全部", exact: true }).click();

  await page.getByTitle("关闭", { exact: true }).click();
  await expect(page.getByRole("button", { name: "全部", exact: true })).toBeHidden();
});
