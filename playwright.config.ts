import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL
if (!baseURL) {
  throw new Error('E2E_BASE_URL is required (set it to your staging URL)')
}

export default defineConfig({
  testDir: './e2e',
  reporter: [['list'], ['html', { open: 'never' }]],
  retries: 0,
  use: {
    baseURL,
  },
  projects: [
    {
      name: 'desktop-1440x900',
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop-1280x720',
      use: { viewport: { width: 1280, height: 720 } },
    },
  ],
})

