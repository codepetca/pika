import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

for (const role of ['teacher', 'student'] as const) {
  test(`${role} can navigate an incomplete calendar`, async ({ page }, testInfo) => {
    const classroomId = '30000000-0000-4000-8000-000000000011'
    await page.clock.setFixedTime(new Date('2026-10-05T16:00:00Z'))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET') return route.abort()
      let body: unknown = {}
      if (url.pathname === '/api/auth/me') body = { user: { id: role === 'teacher' ? '30000000-0000-4000-8000-000000000012' : '30000000-0000-4000-8000-000000000015', role, email: `${role}@example.invalid`, first_name: 'Fixture', last_name: role } }
      else if (url.pathname.endsWith('/class-days')) body = { class_days: [] }
      else if (url.pathname.endsWith('/lesson-plans')) body = { lesson_plans: url.searchParams.get('start') === '2026-09-01' ? [{ id: 'prior', classroom_id: classroomId, date: '2026-09-15', content: null, content_markdown: 'Previous lesson', created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z' }] : [], max_date: null }
      else if (url.pathname.endsWith('/announcements')) body = { announcements: [] }
      else if (url.pathname.endsWith('/assignments')) body = { assignments: [] }
      else if (url.pathname.endsWith('/materials')) body = { materials: [] }
      else if (url.pathname.endsWith('/classrooms')) body = { classrooms: [] }
      else if (url.pathname.endsWith('/notifications')) body = { notifications: [] }
      await route.fulfill({ json: body })
    })
    await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=calendar`, { waitUntil: 'networkidle', timeout: 90000 })
    await page.getByRole('button', { name: 'List', exact: true }).click()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByText('Previous lesson', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`${role}-undated-list.png`) })
    await page.getByRole('button', { name: 'Grid', exact: true }).click()
    await expect(page.getByText('Previous lesson', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`${role}-undated-grid.png`) })
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.locator('[data-calendar-date="2026-10-05"]')).toBeAttached()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
