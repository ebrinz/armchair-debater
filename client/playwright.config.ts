import { defineConfig } from '@playwright/test';

// Screen behaviour tests against the replay mode: no bot, no credits.
export default defineConfig({
  testDir: 'e2e',
  timeout: 20_000,
  use: { baseURL: 'http://127.0.0.1:5199', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
  },
});
