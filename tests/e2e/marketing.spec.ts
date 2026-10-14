import { expect, test } from "@playwright/test";

test.describe("marketing site", () => {
  for (const path of ["/", "/features", "/use-cases", "/how-it-works", "/pricing", "/faq", "/contact"]) {
    test(`${path} renders`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
    });
  }

  test("mobile menu opens and navigates", async ({ page, isMobile }) => {
    await page.goto("/");
    if (isMobile) {
      await page.click('button[aria-label="Open menu"]');
      await page.click('nav[aria-label="Mobile"] a[href="/pricing"]');
    } else {
      await page.click('nav[aria-label="Main"] a[href="/pricing"]');
    }
    await page.waitForURL("**/pricing");
    await expect(page.locator("h1:visible")).toHaveText("Pricing");
  });

  test("sitemap and robots are served", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain("Disallow: /dashboard");
  });
});
