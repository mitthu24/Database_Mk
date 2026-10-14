import { expect, test } from "@playwright/test";

import { loginAs, resetMockBackend } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetMockBackend(page);
  await loginAs(page, "founder@mock.test");
});

test.describe("founder console", () => {
  test("a non-founder cannot reach the founder console", async ({ page }) => {
    await page.context().clearCookies();
    await loginAs(page, "alice@acme.test");
    await page.goto("/founder");
    await page.waitForURL("**/dashboard");
  });

  test("overview shows real totals", async ({ page }) => {
    await page.goto("/founder");
    await expect(page.getByText("Companies").first()).toBeVisible();
    await expect(page.getByText("Signups by month")).toBeVisible();
  });

  test("filters the company directory by state", async ({ page }) => {
    await page.goto("/founder/companies");
    await expect(page.locator("table tbody tr")).toHaveCount(20);
    await page.goto("/founder/companies?state=suspended");
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Cedar Boards");
  });

  test("approving a pending payment flips the company's access to full", async ({ page }) => {
    await page.goto("/founder/payments");
    await expect(page.locator("table tbody tr")).toHaveCount(1); // Birch, pending
    await page.click('button:has-text("Approve")');
    await expect(page.locator("table tbody tr", { hasText: "pending" })).toHaveCount(0);

    await page.goto("/founder/companies");
    const birchRow = page.locator("tr", { hasText: "Birch" });
    await expect(birchRow.getByText("full")).toBeVisible();
  });

  test("rejecting a payment requires a reason", async ({ page }) => {
    await page.goto("/founder/payments");
    await page.click('button:has-text("Reject")');
    await expect(page.locator('div[role="alertdialog"] button:has-text("Reject")')).toBeDisabled();
    await page.fill("textarea", "Amount did not match the invoice.");
    await expect(page.locator('div[role="alertdialog"] button:has-text("Reject")')).toBeEnabled();
  });

  test("suspends and re-activates a company, and it shows in the audit log", async ({ page }) => {
    await page.goto("/founder/companies");
    await page.click("text=Acme Plywood Co");
    await page.waitForSelector('button:has-text("Suspend company")');
    await page.click('button:has-text("Suspend company")');
    await page.click('div[role="alertdialog"] button:has-text("Suspend")');
    await expect(page.locator('button:has-text("Re-activate company")')).toBeVisible();

    await page.goto("/founder/audit");
    await expect(page.locator("table tbody tr").first()).toContainText("company.status_changed");
  });

  test("provisions a new company end to end", async ({ page }) => {
    await page.goto("/founder/companies");
    await page.click("text=New company");
    await page.fill('input[name="companyName"]', "E2E Plywood Co");
    await page.fill('input[name="fullName"]', "New Admin");
    await page.fill('input[name="email"]', "newadmin@e2e.test");
    await page.click('button:has-text("Create company")');
    await page.waitForURL(/\/founder\/companies\/[0-9a-f-]+$/, { timeout: 10000 });
    await expect(page.locator("h1:visible")).toHaveText("E2E Plywood Co");
  });

  test("saves a platform setting", async ({ page }) => {
    await page.goto("/founder/settings");
    const textarea = page.locator("textarea").nth(1); // support email
    await textarea.fill("newsupport@e2e.test");
    await page.locator('button:has-text("Save")').nth(1).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });
});
