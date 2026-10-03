import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.NEBENBEI_E2E_PORT ?? "4308", 10);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}/Nebenbei/`,
    trace: "on-first-retry",
  },
  // The preview serves the build with the production Content-Security-Policy.
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
  // Nebenbei is made for a laptop browser.
  projects: [{ name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } }],
});
