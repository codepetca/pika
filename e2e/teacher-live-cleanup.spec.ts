import { expect, test } from '@playwright/test'

const target = {
  student_id: '20000000-0000-4000-8000-000000000001',
  generation_id: '40000000-0000-4000-8000-000000000001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
}

for (const viewport of ['desktop', 'mobile'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`${viewport} ${theme}: removed memberships never expose teacher cleanup`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport === 'desktop'
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 })
    await page.addInitScript(selected => localStorage.setItem('theme', selected), theme)
    const purgeRequests: string[] = []
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.includes('/purge')) purgeRequests.push(url.pathname)
      if (url.pathname.endsWith('/roster')) {
        await route.fulfill({ json: { roster: [], live_cleanup_targets: [target] } })
        return
      }
      await route.fulfill({ status: 403, json: { error: 'Fixture rejects unrelated request' } })
    })

    await page.goto('/e2e-fixtures/teacher-live-cleanup')
    await page.getByRole('button', { name: 'More actions' }).click()
    const menu = page.getByRole('menu', { name: 'More actions' })
    await expect(menu.getByRole('menuitem', { name: /Clean up live class data/ })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Clean up live class data' })).toHaveCount(0)
    expect(purgeRequests).toEqual([])
    await page.screenshot({
      path: testInfo.outputPath(`system-owned-cleanup-${viewport}-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    })
  })
}
