import { test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { verifyMobileDrawerControls } from './helpers/mobile-drawer-controls'

test.use({ video: 'on' })
test.setTimeout(90_000)

for (const role of ['teacher', 'student'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`${role} drawers preserve workspace with ${reducedMotion} motion`, async ({ page }, testInfo) => {
      await verifyMobileDrawerControls(page, {
        role,
        reducedMotion,
        theme: testInfo.project.metadata.theme === 'dark' ? 'dark' : 'light',
        capture: async (name, body) => {
          const path = testInfo.outputPath(`${name}.png`)
          await writeFile(path, body)
          await testInfo.attach(name, { path, contentType: 'image/png' })
        },
      })
    })
  }
}
