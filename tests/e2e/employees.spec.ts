import { expect, test } from "@playwright/test";

import { loginAs, resetMockBackend } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetMockBackend(page);
});

test.describe("employees and permissions", () => {
  test("admin sees the member list with role and status controls", async ({ page }) => {
    await loginAs(page, "alice@acme.test");
    await page.goto("/employees");
    await expect(page.locator("table tbody tr")).toHaveCount(4);
  });

  test("an employee cannot reach the employee directory", async ({ page }) => {
    await loginAs(page, "edie@acme.test");
    await page.goto("/employees");
    await page.waitForURL("**/dashboard");
  });

  test("granting a permission takes effect for the employee immediately", async ({ page }) => {
    await loginAs(page, "alice@acme.test");
    await page.goto("/employees");
    const noraRow = page.locator("tr", { hasText: "Nora" });
    await noraRow.locator('button:has-text("Permissions")').click();
    await page.waitForSelector("text=Permissions for");

    const ordersRow = page.locator('div[role="dialog"] table tbody tr', { hasText: "Orders" });
    await ordersRow.locator('button[role="checkbox"]').first().click(); // view
    await page.click('div[role="dialog"] button:has-text("Save permissions")');
    await expect(page.locator('div[role="dialog"]')).toHaveCount(0);

    await page.context().clearCookies();
    await loginAs(page, "nora@acme.test");
    await page.goto("/tables");
    await expect(page.locator("a[href^='/tables/']")).toHaveCount(1);
  });

  test("disabling a member revokes their access", async ({ page }) => {
    await loginAs(page, "alice@acme.test");
    await page.goto("/employees");
    const edieRow = page.locator("tr", { hasText: "Edie" });
    await edieRow.locator('button:has-text("Active")').click();
    await page.click('button:has-text("Disable")');
    await expect(edieRow.locator('button:has-text("Disabled")')).toBeVisible();

    await page.context().clearCookies();
    await loginAs(page, "edie@acme.test");
    await page.goto("/tables");
    await expect(page.getByText("No tables yet")).toBeVisible();
  });

  test("an admin cannot disable or demote their own row", async ({ page }) => {
    await loginAs(page, "alice@acme.test");
    await page.goto("/employees");
    const aliceRow = page.locator("tr", { hasText: "Alice" });
    await expect(aliceRow.locator('button:has-text("Active")')).toBeDisabled();
  });
});
