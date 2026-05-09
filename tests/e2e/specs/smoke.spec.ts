import { expect, test } from "@playwright/test";

test("loopback: web loads and connects to host", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
});

test("bootstrap session visible in sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
  await expect(page.locator("main").getByText(/rcc-host|session/i).first()).toBeVisible();
});
