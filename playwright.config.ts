import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/playwright',
  timeout: 45000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list'], ['json', { outputFile: './test-results/browser-results.json' }]],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false, env: { RIPPLE_WORKBENCH_STATE_DIR: path.resolve('node_modules/.tmp/playwright-state') } },
})
