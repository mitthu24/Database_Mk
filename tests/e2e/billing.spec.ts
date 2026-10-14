import { expect, test } from "@playwright/test";

import { loginAs, resetMockBackend } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetMockBackend(page);
});

test.describe("billing states", () => {
  test("a trialing admin can submit a payment and sees it in history", async ({ page }) => {
    await loginAs(page, "alice@acme.test");
    await page.goto("/company/billing");
    await expect(page.locator('button:has-text("Submit payment")')).toBeVisible();

    await page.fill('input[name="amount"]', "49");
    await page.fill('input[name="currency"]', "USD");
    await page.fill('input[name="months"]', "1");
    await page.fill('input[name="method"]', "Bank transfer");
    await page.fill('input[name="reference"]', "E2E-REF-001");
    await page.click('button:has-text("Submit payment")');
    await expect(page.getByText(/payment submitted/i)).toBeVisible();
    await expect(page.locator("table tbody tr")).toContainText("E2E-REF-001");
  });

  test("an expired-trial admin sees the read-only banner but can still submit a payment", async ({ page }) => {
    await loginAs(page, "bob@birch.test");
    await page.goto("/company/billing");
    await expect(page.getByText(/your free trial has ended/i)).toBeVisible();
    await expect(page.locator('button:has-text("Submit payment")')).toBeVisible();
  });

  test("a suspended company's admin sees the suspended banner and no submit form", async ({ page }) => {
    await loginAs(page, "carol@cedar.test");
    await page.goto("/company/billing");
    await expect(page.getByText(/suspended/i).first()).toBeVisible();
    await expect(page.locator('button:has-text("Submit payment")')).toHaveCount(0);
  });

  test("an employee cannot submit a payment, only the admin", async ({ page }) => {
    await loginAs(page, "edie@acme.test");
    await page.goto("/company/billing");
    await expect(page.locator('button:has-text("Submit payment")')).toHaveCount(0);
    await expect(page.getByText(/only your company administrator/i)).toBeVisible();
  });
});
