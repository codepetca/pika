import { test, expect } from '@playwright/test'

test.use({ video: 'on' })

for (const viewport of ['desktop', 'mobile'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const motion of ['no-preference', 'reduce'] as const) {
      test.describe(`${viewport} ${theme} ${motion}`, () => {
        test.use({
          viewport: viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 },
          colorScheme: theme,
          contextOptions: { reducedMotion: motion },
          isMobile: viewport === 'mobile',
          hasTouch: viewport === 'mobile',
        })

        test('dismisses the real assignment preview while preserving its editor', async ({ page }, testInfo) => {
          const errors: string[] = []
          const writes: string[] = []
          page.on('pageerror', (error) => errors.push(error.message))
          await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
          // Every API response is isolated. None of these requests reaches a backend.
          await page.route('**/api/**', async (route) => {
            if (route.request().method() !== 'GET') writes.push(route.request().method())
            await route.fulfill({ json: { provenance: null } })
          })
          const response = await page.goto('/e2e-fixtures/teacher-assignment-preview', { waitUntil: 'networkidle' })
          expect(response?.status()).toBe(200)
          expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
          expect(await page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(theme === 'dark')
          expect(page.viewportSize()).toEqual(sizeFor(viewport))
          await page.getByRole('button', { name: 'Edit fixture assignment' }).click()
          const owner = page.getByRole('dialog', { name: 'Edit Draft', exact: true })
          const editor = owner.getByRole('textbox', { name: 'Instructions', exact: true })
          const editorNode = await editor.elementHandle()
          const ownerNode = await owner.elementHandle()
          const opener = owner.getByRole('button', { name: 'Preview', exact: true })
          await expect(editor).toContainText('Read the field guide.')
          await editor.click()
          await page.keyboard.press('ControlOrMeta+End')
          await page.keyboard.type(' Additional observation.')
          await expect(editor).toContainText('Additional observation.')
          await page.keyboard.press('ControlOrMeta+z')
          await expect(editor).not.toContainText('Additional observation.')
          expect(await editor.evaluate((element, original) => element === original, editorNode)).toBe(true)
          const evidence: unknown[] = []

          for (const command of ['header', 'escape', 'backdrop'] as const) {
            await opener.click()
            const preview = page.getByRole('dialog', { name: 'Instructions', exact: true })
            await expect(preview).toContainText('Bring one observation and one question to discuss.')
            await expect(preview.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
            const root = await preview.evaluateHandle((element) => element.closest<HTMLElement>('[data-modal-state]')!)
            const bounds = (await preview.boundingBox())!
            const size = page.viewportSize()!
            expect(bounds.x).toBeGreaterThanOrEqual(0)
            expect(bounds.y).toBeGreaterThanOrEqual(0)
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width + 1)
            expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height + 1)
            await testInfo.attach(`${command}-open`, { body: await page.screenshot({ animations: 'allow' }), contentType: 'image/png' })

            if (command === 'header') await preview.getByRole('button', { name: 'Close', exact: true }).click()
            else if (command === 'escape') await page.keyboard.press('Escape')
            else await page.mouse.click(2, 2)

            await expect(opener).toBeFocused()
            await expect(preview).toHaveCount(0)
            expect(await editor.evaluate((element, original) => element === original, editorNode)).toBe(true)
            expect(await owner.evaluate((element, original) => element === original, ownerNode)).toBe(true)
            expect(await owner.evaluate((element) => element.closest('[inert]') === null)).toBe(true)
            expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
            await expect(editor).toContainText('Read the field guide.')
            await expect.poll(() => root.evaluate((element) => element.isConnected)).toBe(false)
            evidence.push({ command, physicallyRemoved: true, editorIdentityPreserved: true, parentInteractive: true })
          }

          // Native close/reopen crosses the old exit timer without remounting the editor.
          await opener.click()
          const preview = page.getByRole('dialog', { name: 'Instructions', exact: true })
          const root = await preview.evaluateHandle((element) => element.closest<HTMLElement>('[data-modal-state]')!)
          await preview.getByRole('button', { name: 'Close', exact: true }).click()
          await opener.click()
          await expect(preview).toBeVisible()
          if (motion === 'no-preference') {
            expect(await preview.evaluate((element, original) => element.closest('[data-modal-state]') === original, root)).toBe(true)
          }
          // Wait beyond the obsolete timer; this is a race observation, not an action delay.
          await page.waitForTimeout(250)
          await expect(preview).toBeVisible()
          await expect(preview.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
          await page.keyboard.press('Escape')
          await expect(opener).toBeFocused()
          if (motion === 'no-preference') {
            expect(await root.evaluate((element) => element.isConnected && element.dataset.modalState === 'closing')).toBe(true)
            await page.emulateMedia({ reducedMotion: 'reduce' })
            await expect.poll(() => root.evaluate((element) => element.isConnected)).toBe(false)
            await expect(opener).toBeFocused()
          }
          await expect.poll(() => root.evaluate((element) => element.isConnected)).toBe(false)
          await testInfo.attach('editor-after-dismissal', { body: await page.screenshot({ animations: 'allow' }), contentType: 'image/png' })
          await owner.getByRole('button', { name: 'Close assignment modal', exact: true }).click()
          await expect(owner).toHaveCount(0)
          expect(await editorNode!.evaluate((element) => element.isConnected)).toBe(false)
          await expect(page.getByRole('button', { name: 'Edit fixture assignment' })).toBeFocused()
          expect(writes).toEqual([])
          expect(errors).toEqual([])
          await testInfo.attach('preview-lifecycle', {
            body: Buffer.from(JSON.stringify({ viewport: sizeFor(viewport), theme, motion, evidence, writes, errors }, null, 2)),
            contentType: 'application/json',
          })
        })
      })
    }
  }
}

function sizeFor(viewport: 'desktop' | 'mobile') {
  return viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 }
}
