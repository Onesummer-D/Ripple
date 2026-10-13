import { defineConfig } from '@playwright/test'

const acceptanceDate = process.env.RIPPLE_ACCEPTANCE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'chrome', headless: true },
  reporter: [['list'], ['json', { outputFile: `../../docs/acceptance/${acceptanceDate}/evidence/browser-results.json` }]],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
})
