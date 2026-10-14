import { defineConfig, devices } from "@playwright/test";

// Runs against the explicit dev/test mock backend only (APP_BACKEND=mock):
// no hosted Supabase project is involved. Each spec resets the in-memory
// store via /api/dev-reset-mock (see tests/e2e/helpers.ts) so tests don't
// see each other's writes.
const PORT = 3200;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // one shared in-memory mock store; keep runs serialized
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Pre-installed Chromium in this environment; playwright install is
    // unavailable, and its version does not match the devDependency's
    // expected revision.
    launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] },
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
    {
      // Not devices["iPad Mini"]: that preset defaults to WebKit, which
      // isn't installed in this sandbox (only Chromium is). An iPad-sized
      // Chromium viewport with touch emulation covers the same responsive
      // breakpoints.
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: false },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // A production build + `next start`, not `next dev`: this sandbox's
    // egress proxy blocks the dev server's HMR WebSocket upgrade, which
    // silently breaks client-side hydration (every interactive button stops
    // responding) without raising any console error. `next start` has no
    // HMR and is otherwise what the deployed app runs.
    command: `npx next build && APP_BACKEND=mock npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { APP_BACKEND: "mock" },
  },
});
