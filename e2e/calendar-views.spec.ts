import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

for (const role of ['teacher', 'student'] as const) {
  test(`${role} can switch term views and return to today`, async ({ page }, testInfo) => {
    const classroomId = '30000000-0000-4000-8000-000000000011'
    await page.clock.setFixedTime(new Date('2026-10-05T16:00:00Z'))
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') return route.abort()
      let body: unknown = {}
      if (path === '/api/auth/me') body = { user: { id: role === 'teacher'
        ? '30000000-0000-4000-8000-000000000012' : '30000000-0000-4000-8000-000000000015',
      role, email: `${role}@example.invalid`, first_name: 'Fixture', last_name: role } }
      else if (path.endsWith('/class-days')) body = { class_days: [] }
      else if (path.endsWith('/lesson-plans')) body = { lesson_plans: [1, 5, 30].map(day => ({
        id: `lesson-${day}`, classroom_id: classroomId, date: `2026-10-${String(day).padStart(2, '0')}`,
        content: null, content_markdown: `Lesson ${day}`, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
      })) }
      else if (path.endsWith('/announcements')) body = { announcements: [] }
      else if (path.endsWith('/assignments')) body = { assignments: [] }
      else if (path.endsWith('/materials')) body = { materials: [] }
      else if (path.endsWith('/classrooms')) body = { classrooms: [] }
      else if (path.endsWith('/notifications')) body = { notifications: [] }
      await route.fulfill({ json: body })
    })
    await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=calendar&calendarTerm=true`, { waitUntil: 'networkidle' })
    const workspace = page.getByRole('region', { name: 'Calendar workspace' })
    await expect(workspace).toBeVisible()
    for (const mode of ['List', 'Grid'] as const) {
      const button = page.getByRole('button', { name: mode, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByText('Lesson 1', { exact: true })).toBeAttached()
      await expect(page.getByText('Lesson 30', { exact: true })).toBeAttached()
      await page.screenshot({ path: testInfo.outputPath(`${role}-${mode.toLowerCase()}.png`) })
      if (mode === 'List') {
        await page.locator('[data-calendar-date="2027-01-15"]').scrollIntoViewIfNeeded()
        const monthHeader = workspace.locator('[data-calendar-month="January 2027"] > div').first()
        await expect.poll(() => monthHeader.evaluate(element => {
          let scroller = element.parentElement
          while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
          if (!scroller) return false
          const header = element.getBoundingClientRect()
          const surface = scroller.getBoundingClientRect()
          return Math.abs(header.top - surface.top) <= 2 && header.bottom > surface.top
        })).toBe(true)
        const actionBar = page.getByRole('group', { name: 'Calendar view' }).locator('xpath=ancestor::div[contains(@class,"sticky")][1]')
        await expect(actionBar).not.toContainText('January 2027')
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator('[data-calendar-date="2026-10-31"]').scrollIntoViewIfNeeded()
        const today = page.getByRole('button', { name: 'Today', exact: true })
        const todayBounds = await today.boundingBox()
        expect(todayBounds).not.toBeNull()
        expect(todayBounds!.y).toBeGreaterThanOrEqual(0)
        expect(todayBounds!.y + todayBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
        await today.click()
        await expect.poll(() => page.locator('[data-calendar-date="2026-10-05"]').evaluate(element => {
          const bounds = element.getBoundingClientRect()
          let ancestor = element.parentElement
          while (ancestor && !['auto', 'scroll'].includes(getComputedStyle(ancestor).overflowY)) ancestor = ancestor.parentElement
          if (!ancestor) return false
          const surface = ancestor.getBoundingClientRect()
          return bounds.bottom > surface.top && bounds.top < surface.bottom
        })).toBe(true)
      }
    }
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
}
