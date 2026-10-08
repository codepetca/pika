import { expect, test } from '@playwright/test'

for (const role of ['teacher', 'student'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`${role} retains pointer activation while tab selection hydrates with ${reducedMotion} motion`, async ({ page }, testInfo) => {
      const pageErrors: string[] = []
      const writes: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
      })
      await page.emulateMedia({ reducedMotion })
      const theme = testInfo.project.metadata.theme
      await page.addInitScript((value) => localStorage.setItem('theme', String(value)), theme)
      let releaseHydration!: () => void
      const hydrationGate = new Promise<void>((resolve) => { releaseHydration = resolve })
      let heldScripts = 0
      await page.route('**/_next/static/chunks/app/pattern-lab/page.js*', async (route) => {
        heldScripts += 1
        await hydrationGate
        await route.continue()
      })
      try {
        await page.goto(`/pattern-lab?role=${role}#tab-selection-visibility`, { waitUntil: 'commit' })
        const example = page.getByTestId('visibility-underline')
        const list = example.getByRole('tablist', { name: 'underline visibility panels' })
        const overview = list.getByRole('tab', { name: 'Overview', exact: true })
        const settings = list.getByRole('tab', { name: 'Settings', exact: true })
        await expect(settings).toHaveAttribute('aria-selected', 'true')
        await expect.poll(() => heldScripts).toBeGreaterThan(0)
        await expect(list).toHaveCSS('display', 'flex')
        await overview.scrollIntoViewIfNeeded()
        const bounds = (await overview.boundingBox())!
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await page.mouse.down()
        releaseHydration()
        await page.waitForLoadState('networkidle')
        await page.evaluate(() => document.fonts.ready)
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
        await testInfo.attach('pointer-held-through-hydration', {
          body: await example.screenshot({ path: testInfo.outputPath('pointer-held-through-hydration.png') }),
          contentType: 'image/png',
        })
        await page.mouse.up()
        await expect(overview).toHaveAttribute('aria-selected', 'true')
        await expect(overview).toBeFocused()
        await expect(example.getByRole('tabpanel', { name: 'Overview', exact: true })).toBeVisible()
        await expect.poll(() => overview.evaluate((element) => {
          const container = element.parentElement!
          const tabBounds = element.getBoundingClientRect()
          const listBounds = container.getBoundingClientRect()
          return tabBounds.left >= listBounds.left - 1 && tabBounds.right <= listBounds.right + 1
        })).toBe(true)
        await testInfo.attach('pointer-selected-after-hydration', {
          body: await example.screenshot({ path: testInfo.outputPath('pointer-selected-after-hydration.png') }),
          contentType: 'image/png',
        })
        await overview.press('End')
        await expect(settings).toHaveAttribute('aria-selected', 'true')
        await expect(settings).toBeFocused()
        await expect(example.getByRole('tabpanel', { name: 'Settings', exact: true })).toBeVisible()
        expect(pageErrors).toEqual([])
        expect(writes).toEqual([])
      } finally {
        releaseHydration()
      }
    })
  }
}
