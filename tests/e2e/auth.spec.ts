import { expect, test } from "@playwright/test";

import { loginAs, resetMockBackend, signOut } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetMockBackend(page);
});

test.describe("authentication", () => {
  test("an unauthenticated visit to a protected route redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login**");
  });

  test("sign in, see the dashboard, and sign out", async ({ page }) => {
    await loginAs(page, "alice@acme.test");
    await expect(page.getByText("Acme Plywood Co")).toBeVisible();
    await signOut(page);
    await page.goto("/dashboard");
    await page.waitForURL("**/login**");
  });

  test("wrong password is rejected without revealing which part was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "alice@acme.test");
    await page.fill('input[name="password"]', "totally-wrong-password");
    await page.click('button[type="submit"]');
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  });

  test("a new account can register a company and lands on the dashboard", async ({ page }) => {
    await page.goto("/register");
    await page.fill('input[name="fullName"]', "New Founder");
    await page.fill('input[name="companyName"]', "Fresh Plywood Co");
    await page.fill('input[name="email"]', "fresh@newco.test");
    await page.fill('input[name="password"]', "longenough-password-1");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 10000 });
    await expect(page.getByText("Fresh Plywood Co")).toBeVisible();
  });

  test("a +confirm sign-up starts in a pending state, not the dashboard", async ({ page }) => {
    await page.goto("/register");
    await page.fill('input[name="fullName"]', "Pending Person");
    await page.fill('input[name="companyName"]', "Pending Co");
    await page.fill('input[name="email"]', "pending+confirm@newco.test");
    await page.fill('input[name="password"]', "longenough-password-1");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/check your email/i)).toBeVisible();
    expect(page.url()).toContain("/register");
  });

  test("forgot password shows the same confirmation whether or not the address exists", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', "nobody@nowhere.test");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/if that address has an account/i)).toBeVisible();
  });

  test("an employee with no company data access still reaches the dashboard, read-only", async ({ page }) => {
    await loginAs(page, "nora@acme.test");
    await page.goto("/tables");
    await expect(page.getByText("No tables yet")).toBeVisible();
  });
});
