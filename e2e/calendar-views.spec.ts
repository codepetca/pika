import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

for (const role of ['teacher', 'student'] as const) {
  test(`${role} can switch term views and return to today`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 600 })
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
      const lastDay = workspace.locator('[data-calendar-date="2027-01-29"]')
      const scroller = lastDay.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " overflow-auto ")][1]')
      await expect(scroller).toHaveCount(1)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
      await expect.poll(() => scroller.evaluate(element => {
        const outer = element.closest('main')?.parentElement?.closest('main')
        return !!outer && outer.scrollHeight <= outer.clientHeight
      })).toBe(true)
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
      await expect.poll(() => lastDay.evaluate(element => {
        const scroll = element.closest('.overflow-auto')!
        const day = element.getBoundingClientRect()
        const bounds = scroll.getBoundingClientRect()
        return day.bottom <= bounds.bottom + 1 && day.bottom > bounds.top
      })).toBe(true)
      const scrollBounds = await scroller.boundingBox()
      const workspaceBounds = await workspace.boundingBox()
      expect(Math.abs(scrollBounds!.x + scrollBounds!.width - workspaceBounds!.x - workspaceBounds!.width)).toBeLessThanOrEqual(1)
      // Exercise hit testing after the sticky month/weekday header has reached the top.
      await page.getByRole('button', { name: mode === 'List' ? 'Grid' : 'List', exact: true }).click()
      await button.click()
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
    await page.setViewportSize({ width: 390, height: 600 })
    const mobileDates = page.getByRole('region', { name: 'Calendar dates' })
    const mobileActionBar = page.getByRole('group', { name: 'Calendar view' }).locator('xpath=ancestor::div[contains(@class,"sticky")][1]')
    const weekdays = mobileDates.locator('.grid > .sticky').filter({ hasText: /^(S|Mon|Tue|Wed|Thu|Fri)$/ })
    await expect(weekdays).toHaveCount(7)
    for (const position of ['top', 'middle'] as const) {
      await mobileDates.evaluate((element, value) => { element.scrollTop = value === 'top' ? 0 : element.scrollHeight / 2 }, position)
      if (position === 'middle') expect(await mobileDates.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await expect.poll(async () => {
        const bar = await mobileActionBar.boundingBox()
        const scroll = await mobileDates.boundingBox()
        return !!bar && !!scroll && bar.y + bar.height <= scroll.y + 1
      }).toBe(true)
      for (const weekday of await weekdays.all()) {
        await expect.poll(() => weekday.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          return hit === element || element.contains(hit)
        })).toBe(true)
      }
    }
    await page.setViewportSize({ width: 390, height: 401 })
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      return ['/assignments', '/materials', '/announcements'].some(suffix => path.endsWith(suffix))
        ? route.fulfill({ status: 500, json: { error: 'failure' } }) : route.fallback()
    })
    if (role === 'teacher') {
      await page.evaluate(id => sessionStorage.setItem(`pika:blueprint-classroom-overflow:${id}`,
        JSON.stringify(Array.from({ length: 10 }, (_, index) => `Overflow lesson ${index + 1}`))), classroomId)
    }
    await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=calendar&calendarTerm=true&reviewClassDays=1`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('alert').filter({ hasText: 'Some calendar information' })).toBeAttached()
    if (role === 'teacher') {
      await expect(page.getByText('Overflow lesson 10')).toBeAttached()
      const setup = page.getByRole('button', { name: 'Set up now' })
      await setup.scrollIntoViewIfNeeded()
      const bounds = await setup.boundingBox()
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(401)
    }
    const dates = page.getByRole('region', { name: 'Calendar dates' })
    await dates.scrollIntoViewIfNeeded()
    await expect.poll(() => dates.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(160)
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect.poll(() => page.locator('[data-calendar-date="2026-10-05"]').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.bottom > 0 && bounds.top < window.innerHeight
    })).toBe(true)
    await page.setViewportSize({ width: 390, height: 240 })
    await expect(dates).toBeVisible()
    await dates.focus()
    await page.keyboard.press('End')
    expect(await dates.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await expect.poll(() => page.locator('[data-calendar-date="2026-10-05"]').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.bottom > 0 && bounds.top < window.innerHeight
    })).toBe(true)
  })
}
