import { expect, test } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

for (const mode of ['immediate', 'keyboard', 'failed-prefetch'] as const) {
  test(`Tests navigation ${mode}`, async ({ page }) => {
    await mockTableShellReads(page)
    let summaries = 0
    let full = 0
    const row = { id: '30000000-0000-4000-8000-000000000013', classroom_id: TABLE_CLASSROOM_ID, title: 'Synthetic Unit Test', status: 'active', position: 0, documents: [] }
    await page.route('**/api/teacher/tests/summary?**', async route => {
      summaries++
      await new Promise(resolve => setTimeout(resolve, 300))
      if (mode === 'failed-prefetch' && summaries === 1) return route.fulfill({ status: 500, json: { error: 'Unavailable' } })
      return route.fulfill({ json: { tests: [row] } })
    })
    await page.route('**/api/teacher/tests?**', async route => {
      full++
      await new Promise(resolve => setTimeout(resolve, 900))
      await route.fulfill({ json: { tests: [{ ...row, stats: { total_students: 30, responded: 12, submitted: 10, open_access: 20, closed_access: 10, questions_count: 3 } }] } })
    })
    await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=announcements')
    const tab = page.getByRole('link', { name: 'Tests', exact: true }).first()
    if (mode === 'keyboard') { await tab.focus(); await page.waitForTimeout(650); await page.keyboard.press('Enter') }
    else if (mode === 'failed-prefetch') { await tab.hover(); await page.waitForTimeout(650); await tab.click() }
    else await tab.click()
    const title = page.getByRole('button', { name: 'Synthetic Unit Test', exact: true })
    await expect(title).toBeVisible()
    await expect(title).toBeEnabled()
    expect(full).toBe(1)
    expect(summaries).toBe(mode === 'failed-prefetch' ? 2 : 1)
  })
}
