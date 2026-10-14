import { expect, test } from "@playwright/test";

import { loginAs, resetMockBackend } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetMockBackend(page);
  await loginAs(page, "alice@acme.test");
});

test.describe("table library and grid", () => {
  test("lists the seeded tables with their access badges", async ({ page }) => {
    await page.goto("/tables");
    await expect(page.getByText("Orders")).toBeVisible();
    await expect(page.getByText("Vendors")).toBeVisible();
  });

  test("creates a table, adds a row, and the row appears", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=New table");
    await page.fill("#table-name", "E2E Table");
    await page.fill('input[placeholder="Column 1"]', "Name");
    await page.click('button:has-text("Create table")');
    await page.waitForURL(/\/tables\/[0-9a-f-]+$/, { timeout: 10000 });
    await expect(page.locator("h1:visible")).toHaveText("E2E Table");

    await page.click('button:has-text("Add row")');
    await page.fill("#row-name", "First row");
    await page.click('div[role="dialog"] button:has-text("Add row")');
    await expect(page.locator("tbody")).toContainText("First row");
  });

  test("renames a table and edits its schema", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Vendors");
    await page.waitForSelector('button:has-text("Rename")');

    await page.click('button:has-text("Rename")');
    await page.fill("#rename-table-name", "Suppliers");
    await page.click('div[role="dialog"] button:has-text("Rename")');
    await expect(page.locator("h1:visible")).toHaveText("Suppliers");

    await page.click('button:has-text("Edit columns")');
    await page.click("text=Add column");
    await page.click('div[role="dialog"] button:has-text("Save schema")');
    // Vendors starts with 3 columns; checkbox col + 4 data cols (after adding one) + trailing action col.
    await expect(page.locator("thead th")).toHaveCount(6);
  });

  test("clears data and drops a table, each behind a confirm dialog", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Vendors");
    await page.waitForSelector('button:has-text("Clear data")');

    await page.click('button:has-text("Clear data")');
    await expect(page.getByText("This permanently deletes every row")).toBeVisible();
    await page.click('div[role="alertdialog"] button:has-text("Clear data")');
    await expect(page.getByText("0 rows · 3 columns")).toBeVisible();

    await page.click('button:has-text("Delete table")');
    await expect(page.getByText(/permanently deletes the table/)).toBeVisible();
    await page.click('div[role="alertdialog"] button:has-text("Delete table")');
    await page.waitForURL("**/tables");
    await expect(page.locator("a:visible", { hasText: "Vendors" })).toHaveCount(0);
  });

  test("a view+export-only employee cannot add rows but can export", async ({ page }) => {
    await page.context().clearCookies();
    await loginAs(page, "vic@acme.test");
    await page.goto("/tables");
    await expect(page.locator("a[href^='/tables/']")).toHaveCount(1);
    await page.click("text=Orders");
    await expect(page.locator('button:has-text("Add row")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Export")')).toHaveCount(1);
  });

  test("paginates and sorts the seeded Orders table", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Orders");
    await expect(page.locator("p:visible", { hasText: "250 rows" })).toBeVisible();
    await page.click('thead th >> nth=1'); // sort by the first data column
    await page.click('button:has-text("Next")');
    await expect(page.getByText("Page 2 of")).toBeVisible();
  });
});
