import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { loginAs, resetMockBackend } from "./helpers";

// Automated accessibility checks (axe-core, WCAG 2a/2aa) across public and
// authenticated pages. These catch missing labels, contrast and ARIA
// mistakes; they do not replace a manual screen-reader pass.
async function checkNoViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test.describe("accessibility", () => {
  test("marketing landing page", async ({ page }) => {
    await page.goto("/");
    await checkNoViolations(page);
  });

  test("login page", async ({ page }) => {
    await page.goto("/login");
    await checkNoViolations(page);
  });

  test("register page", async ({ page }) => {
    await page.goto("/register");
    await checkNoViolations(page);
  });

  test("dashboard", async ({ page }) => {
    await resetMockBackend(page);
    await loginAs(page, "alice@acme.test");
    await checkNoViolations(page);
  });

  test("table grid", async ({ page }) => {
    await resetMockBackend(page);
    await loginAs(page, "alice@acme.test");
    await page.goto("/tables");
    await page.click("text=Orders");
    await page.waitForSelector("table tbody tr");
    // Let Radix's Select hydrate (its displayed value is set by a layout
    // effect slightly after the row data streams in).
    await expect(page.getByRole("combobox")).toHaveText("25");
    await checkNoViolations(page);
  });

  test("founder console", async ({ page }) => {
    await resetMockBackend(page);
    await loginAs(page, "founder@mock.test");
    await page.goto("/founder");
    await checkNoViolations(page);
  });
});
