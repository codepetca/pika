import { test } from '@playwright/test'
import { verifyDialogEntry } from './helpers/dialog-entry-preview'

// All captures and video preserve the real animation; there are no golden snapshots.
test.use({ video: 'on', trace: 'retain-on-failure' })
test.setTimeout(90_000)

for (const role of ['teacher', 'student'] as const) {
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`${role} ${motion} actual dialog entry lifecycle`, async ({ page }, testInfo) => {
      await verifyDialogEntry(page, testInfo, role, motion)
    })
  }
}
