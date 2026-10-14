import type { Page } from "@playwright/test";

export const MOCK_PASSWORD = "mock-password-123";

/** Resets the in-memory mock store to its deterministic seed before a test. */
export async function resetMockBackend(page: Page) {
  const res = await page.request.post("/api/dev-reset-mock");
  if (!res.ok()) throw new Error(`Failed to reset mock backend: ${res.status()}`);
}

export async function loginAs(page: Page, email: string, password = MOCK_PASSWORD) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard");
}

export async function signOut(page: Page) {
  await page.locator('form[action] button:has-text("Sign out")').click();
  await page.waitForURL("**/login");
}
