import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { loginAs, resetMockBackend } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetMockBackend(page);
  await loginAs(page, "alice@acme.test");
});

test.describe("import and export", () => {
  test("exports the Orders table as CSV with the right row count", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Orders");
    await page.click('button:has-text("Export")');
    await page.waitForSelector("text=CSV");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('a:has-text("CSV")')]);
    const content = fs.readFileSync(await download.path(), "utf8");
    expect(content.trim().split("\n")).toHaveLength(251); // header + 250 seeded rows
  });

  test("imports a CSV, previews it, and the rows land in the grid and history", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Vendors");
    await page.click('a:has-text("Import")');
    await page.waitForURL(/\/tables\/.*\/import$/);

    const csvPath = path.join(os.tmpdir(), "e2e-import.csv");
    fs.writeFileSync(csvPath, "Vendor,Contact,Active\nNew Vendor Co,hello@newvendor.test,true\n");
    await page.setInputFiles('input[type="file"]', csvPath);
    await page.click('button:has-text("Preview")');
    await page.waitForSelector("text=Column mapping");
    await page.click('button:has-text("Import rows")');
    await page.waitForURL(/\/tables\/[0-9a-f-]+$/, { timeout: 10000 });
    await expect(page.locator("tbody:visible")).toContainText("New Vendor Co");

    await page.goto(new URL("import", page.url() + "/").toString());
    await expect(page.getByText("Recent imports")).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toContainText("succeeded");
  });

  test("blocks an import with a missing required field and explains why", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Vendors");
    await page.click('a:has-text("Import")');
    await page.waitForURL(/\/tables\/.*\/import$/);

    const csvPath = path.join(os.tmpdir(), "e2e-import-bad.csv");
    fs.writeFileSync(csvPath, "Vendor,Contact,Active\n,bad@x.test,true\n");
    await page.setInputFiles('input[type="file"]', csvPath);
    await page.click('button:has-text("Preview")');
    await page.waitForSelector("text=Column mapping");
    await expect(page.locator('button:has-text("Import rows")')).toHaveCount(0);
  });

  test("exports the Orders table as XLSX", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Orders");
    await page.click('button:has-text("Export")');
    await page.waitForSelector("text=XLSX");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('a:has-text("XLSX")')]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    expect(fs.statSync(filePath!).size).toBeGreaterThan(0);
  });

  test("exports the Orders table as JSON with the right row count", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Orders");
    await page.click('button:has-text("Export")');
    await page.waitForSelector("text=JSON");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('a:has-text("JSON")')]);
    const content = fs.readFileSync(await download.path(), "utf8");
    const rows = JSON.parse(content);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(250);
  });

  test("imports a JSON file and the rows land in the grid", async ({ page }) => {
    await page.goto("/tables");
    await page.click("text=Vendors");
    await page.click('a:has-text("Import")');
    await page.waitForURL(/\/tables\/.*\/import$/);

    const jsonPath = path.join(os.tmpdir(), "e2e-import.json");
    fs.writeFileSync(jsonPath, JSON.stringify([{ Vendor: "JSON Vendor Co", Contact: "hello@jsonvendor.test", Active: true }]));
    await page.setInputFiles('input[type="file"]', jsonPath);
    await page.click('button:has-text("Preview")');
    await page.waitForSelector("text=Column mapping");
    await page.click('button:has-text("Import rows")');
    await page.waitForURL(/\/tables\/[0-9a-f-]+$/, { timeout: 10000 });
    await expect(page.locator("tbody:visible")).toContainText("JSON Vendor Co");
  });
});
