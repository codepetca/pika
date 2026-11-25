import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'America/Toronto' })

const classroomId = '30000000-0000-4000-8000-000000000011'
const teacherId = '30000000-0000-4000-8000-000000000012'
const stamp = '2026-10-05T16:00:00Z'
function announcement(id: string, title: string, schedule: string | null = null) {
  return {
    id, title, content: title, classroom_id: classroomId, is_draft: false,
    created_by: teacherId, posted_on: '2026-10-05', published_at: schedule ? null : stamp,
    scheduled_for: schedule, created_at: stamp, updated_at: stamp,
  }
}

for (const role of ['teacher', 'student'] as const) {
  test(`${role} calendar announcement appearance and activation`, async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const theme = testInfo.project.metadata.theme as 'light' | 'dark'
    const mobile = testInfo.project.metadata.viewport === 'mobile'
    await page.addInitScript(value => localStorage.setItem('theme', value), theme)
    await page.clock.setFixedTime(new Date(stamp))
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      const method = route.request().method()
      if (method === 'POST' && role === 'student' && path === `/api/student/classrooms/${classroomId}/announcements`) {
        return route.fulfill({ json: { success: true, marked: 1 } })
      }
      if (method !== 'GET') {
        await route.abort()
        throw new Error(`Unexpected fixture write: ${method} ${path}`)
      }
      const responses: Record<string, unknown> = {
        'class-days': { class_days: [] }, 'lesson-plans': { lesson_plans: [], max_date: null },
        assignments: { assignments: [] }, materials: { materials: [] }, classrooms: { classrooms: [] },
        notifications: { notifications: [] },
        announcements: { announcements: [announcement('published', 'Bring headphones'), ...(role === 'teacher'
          ? [announcement('scheduled', 'Field trip reminder', '2026-10-06T16:00:00Z')] : [])] },
      }
      const user = { user: { id: role === 'teacher' ? teacherId : '30000000-0000-4000-8000-000000000015',
        role, email: `${role}@example.invalid`, first_name: 'Fixture', last_name: role } }
      await route.fulfill({ json: path === '/api/auth/me' ? user : responses[path.split('/').pop()!] ?? {} })
    })

    await page.goto(`/pattern-lab?role=${role}`, { waitUntil: 'networkidle' })
    const example = page.getByTestId('calendar-identity-pattern')
    await expect(example).toBeVisible()
    for (const mode of ['Week', 'Grid'] as const) {
      await example.getByRole('button', { name: mode, exact: true }).click()
      const chip = example.getByRole('button', { name: 'Bring headphones', exact: true })
      await expect(chip).toBeVisible()
      await example.getByRole('button', { name: 'Survey: Field trip check-in' }).click()
      await expect(example.getByRole('status')).toHaveText('Open survey')
      await chip.focus()
      await page.keyboard.press('Enter')
      await expect(example.getByRole('status')).toHaveText('Open announcement')
      await example.screenshot({ path: testInfo.outputPath(`pattern-${mode.toLowerCase()}.png`), animations: 'disabled' })
    }

    await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=calendar&calendarTerm=true`)
    const workspace = page.getByRole('region', { name: 'Calendar workspace' })
    await expect(workspace).toBeVisible()
    await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark')))
      .toBe(theme === 'dark')
    // Resolve each candidate token independently using the browser's color parser.
    const { fill, ink, hover, rawPalette } = await page.evaluate(() => {
      const probe = document.createElement('span')
      document.body.appendChild(probe)
      const rawPalette: string[] = []
      const root = getComputedStyle(document.documentElement)
      const resolve = (token: string) => {
        const literal = root.getPropertyValue(token).trim()
        if (!literal) throw new Error(`Missing appearance token ${token}`)
        rawPalette.push(literal)
        probe.style.color = `var(${token})`
        return getComputedStyle(probe).color
      }
      const result = {
        ink: resolve('--color-calendar-announcement'),
        fill: resolve('--color-calendar-announcement-bg'),
        hover: resolve('--color-calendar-announcement-hover'),
        rawPalette,
      }
      probe.remove()
      return result
    })
    // Compare against the checked-out candidate, independently of browser CSS.
    const source = readFileSync('src/styles/tokens.css', 'utf8')
    const properties = ['--color-calendar-announcement', '--color-calendar-announcement-bg', '--color-calendar-announcement-hover']
    const expectedPalette = properties.map(property => {
      const matches = [...source.matchAll(new RegExp(`^\\s*${property}:\\s*([^;]+);`, 'gm'))]
      expect(matches).toHaveLength(2)
      return matches[theme === 'dark' ? 1 : 0][1].trim()
    })
    expect(rawPalette).toEqual(expectedPalette)
    for (const mode of ['List', 'Grid'] as const) {
      const modeButton = page.getByRole('button', { name: mode, exact: true })
      await modeButton.click()
      await expect(modeButton).toHaveAttribute('aria-pressed', 'true')
      const day = workspace.locator('[data-calendar-date="2026-10-05"]')
      const chip = day.getByRole('button', { name: 'Bring headphones', exact: true })
      await expect(chip).toBeVisible()
      await chip.scrollIntoViewIfNeeded()
      await expect(chip).toHaveCSS('background-color', fill)
      await expect(chip).toHaveCSS('color', ink)
      const icon = chip.locator('svg.lucide-megaphone')
      await expect(icon).toHaveCSS('color', ink)
      await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      if (role === 'teacher') {
        const scheduled = day.getByRole('button', { name: /Field trip reminder/ })
        await expect(scheduled).toBeVisible()
        if (mode === 'Grid') await expect(scheduled).toHaveCSS('box-shadow', new RegExp(ink.replace(/\(/g, '\\(').replace(/\)/g, '\\)')))
      }
      await day.screenshot({ path: testInfo.outputPath(`${mode.toLowerCase()}.png`), animations: 'disabled' })
      if (!mobile) {
        await chip.hover()
        await expect(chip).toHaveCSS('background-color', hover)
        await chip.focus()
        await expect(chip).toBeFocused()
        await chip.screenshot({ path: testInfo.outputPath(`${mode.toLowerCase()}-hover-focus.png`), animations: 'disabled' })
        await page.mouse.move(0, 0)
      }
    }
    await workspace.getByRole('button', { name: 'Bring headphones', exact: true }).click()
    await expect(page).toHaveURL(/tab=announcements/)
    await expect(workspace).toBeHidden()
  })
}
