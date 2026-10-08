import { expect, type Page, type TestInfo } from '@playwright/test'

/** Real ClassroomPageClient Calendar owner; synthetic reads never reach a backend. */
export async function verifyCalendarDayInteraction(page: Page, testInfo: TestInfo,
  role: 'teacher' | 'student', motion: 'no-preference' | 'reduce') {
  const theme = testInfo.project.metadata.theme as 'light' | 'dark'
  const writes: string[] = []
  const reads: string[] = []
  const errors: string[] = []
  const consoleDiagnostics: { type: string; text: string; location: { url: string; lineNumber: number; columnNumber: number } }[] = []
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleDiagnostics.push({ type: message.type(), text: message.text(), location: message.location() })
    }
  })
  // Fix Date only: setFixedTime keeps timers, performance and native RAF advancing.
  await page.clock.setFixedTime(new Date('2026-10-05T16:00:00Z'))
  const classroomId = '30000000-0000-4000-8000-000000000011'
  const date = (day: number) => `2026-10-${String(day).padStart(2, '0')}`
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(value => localStorage.setItem('theme', value), theme)
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${path}`)
      await route.abort()
      return
    }
    reads.push(path)
    let body: unknown = {}
    if (path === '/api/auth/me') body = { user: { id: role === 'teacher'
      ? '30000000-0000-4000-8000-000000000012' : '30000000-0000-4000-8000-000000000015',
    role, email: `${role}@example.invalid`, first_name: 'Fixture', last_name: role } }
    else if (path.endsWith('/class-days')) body = { class_days: Array.from({ length: 31 }, (_, index) => ({
      id: `day-${index}`, classroom_id: classroomId, date: date(index + 1), is_class_day: true, prompt_text: '',
    })) }
    else if (path.endsWith('/lesson-plans')) body = { max_date: date(31), lesson_plans: Array.from({ length: 31 }, (_, index) => ({
      id: `lesson-${index}`, classroom_id: classroomId, date: date(index + 1), content: null,
      content_markdown: `# Lesson ${index + 1}\n\n` + Array(8).fill('Discuss the calendar reading and concrete next steps.').join('\n\n') + '\n\nFINAL READING LINE',
      created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    })) }
    else if (path.endsWith('/announcements')) body = { announcements: [{ id: 'calendar-announcement', classroom_id: classroomId,
      title: 'Calendar reading reminder', content: 'FINAL EVENT LINE', is_draft: false, scheduled_for: null,
      published_at: `${date(5)}T12:00:00Z`, created_at: `${date(5)}T12:00:00Z`, updated_at: `${date(5)}T12:00:00Z`,
      created_by: '30000000-0000-4000-8000-000000000012' }] }
    else if (path.endsWith('/assignments')) body = { assignments: [] }
    else if (path.endsWith('/notifications')) body = { notifications: [] }
    else if (path.endsWith('/materials')) body = { materials: [] }
    else if (path.endsWith('/classrooms')) body = { classrooms: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=calendar`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('region', { name: 'Calendar workspace' })).toBeVisible()
  const verifiedDate = await page.evaluate(() => ({ iso: new Date().toISOString(),
    toronto: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }))
  expect(verifiedDate).toEqual({ iso: '2026-10-05T16:00:00.000Z', toronto: '2026-10-05' })
  const liveClock = await page.evaluate(() => new Promise<{ before: { date: number; performance: number }; after: { date: number; performance: number } }>(resolve => {
    const before = { date: Date.now(), performance: performance.now() }
    setTimeout(() => requestAnimationFrame(() => resolve({ before,
      after: { date: Date.now(), performance: performance.now() } })), 25)
  }))
  expect(liveClock.after.date).toBe(liveClock.before.date)
  expect(liveClock.after.performance).toBeGreaterThan(liveClock.before.performance)
  const media = await page.evaluate(() => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    dark: matchMedia('(prefers-color-scheme: dark)').matches }))
  expect(media.reduced).toBe(motion === 'reduce')
  expect(media.dark).toBe(theme === 'dark')
  expect(page.viewportSize()).toEqual(testInfo.project.metadata.viewport === 'desktop'
    ? { width: 1440, height: 900 } : { width: 390, height: 844 })
  expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(theme === 'dark')
  const opener = page.getByRole('button', { name: /Open Monday, October 5, 2026/i })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Mon Oct 5, 2026' })
  const reading = page.getByRole('region', { name: 'Day lesson and events' })
  await expect(dialog).toBeVisible()
  const geometry = await dialog.evaluate(element => ({ panel: element.getBoundingClientRect().toJSON(),
    viewport: { width: innerWidth, height: innerHeight }, documentOverflow: document.documentElement.scrollWidth > innerWidth,
    exitDuration: getComputedStyle(element.closest('[data-modal-state]')!).getPropertyValue('--motion-duration-standard').trim() }))
  expect(geometry.documentOverflow).toBe(false)
  expect(geometry.panel.x).toBeGreaterThanOrEqual(0)
  expect(geometry.panel.y).toBeGreaterThanOrEqual(0)
  expect(geometry.panel.right).toBeLessThanOrEqual(geometry.viewport.width + 1)
  expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Previous day', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(reading).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Next day', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(reading).toBeFocused()
  const initial = await reading.evaluate(element => element.scrollTop)
  await page.keyboard.press('PageDown')
  await expect.poll(() => reading.evaluate(element => element.scrollTop)).toBeGreaterThan(initial)
  const afterPage = await reading.evaluate(element => element.scrollTop)
  await page.keyboard.press('Home')
  await expect.poll(() => reading.evaluate(element => element.scrollTop)).toBe(0)
  await page.keyboard.press('Space')
  await expect.poll(() => reading.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('Home')
  await expect.poll(() => reading.evaluate(element => element.scrollTop)).toBe(0)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => reading.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(dialog).toBeVisible()
  for (let index = 0; index < 8; index++) await page.keyboard.press('PageDown')
  const end = reading.getByText('FINAL EVENT LINE', { exact: true })
  await expect.poll(() => end.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const region = element.closest('[role="region"]')!.getBoundingClientRect()
    return bounds.bottom <= region.bottom + 1 && bounds.top >= region.top
  })).toBe(true)
  const capture = async (state: string) => {
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-modal-state]')).every(element =>
      element.getAttribute('data-modal-state') === 'open' && getComputedStyle(element).opacity === '1'))
    await page.screenshot({ path: testInfo.outputPath(`${role}-${motion}-${state}.png`), animations: 'allow' })
  }
  await capture('reading-end')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog', { name: 'Tue Oct 6, 2026' })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(dialog).toBeVisible()
  await capture('reading-focus')
  const observations: unknown[] = []
  for (const command of ['escape', 'backdrop'] as const) {
    const root = await dialog.evaluateHandle(element => element.closest<HTMLElement>('[data-modal-state]')!)
    // RAF sampling observes actual native close, without altering browser time or opacity.
    const closeFrames = await page.evaluateHandle(element => {
      const frames: unknown[] = []
      const start = performance.now()
      const sample = () => {
        frames.push({ ms: performance.now() - start, connected: element!.isConnected,
          state: element!.dataset.modalState, hidden: element!.getAttribute('aria-hidden'),
          inert: element!.inert, opacity: getComputedStyle(element!).opacity })
        if (performance.now() - start < 350) requestAnimationFrame(sample)
      }
      document.addEventListener('keydown', event => { if (event.key === 'Escape') requestAnimationFrame(sample) }, { once: true, capture: true })
      document.addEventListener('click', () => requestAnimationFrame(sample), { once: true, capture: true })
      return frames
    }, root)
    if (command === 'escape') await page.keyboard.press('Escape')
    else await page.mouse.click(2, 2)
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(375)
    const frames = await closeFrames.jsonValue() as { connected: boolean; state: string; hidden: string; inert: boolean }[]
    await testInfo.attach(`${command}-native-close-frames`, { body: Buffer.from(JSON.stringify({ command, frames })), contentType: 'application/json' })
    if (motion === 'no-preference') expect(frames.some(frame => frame.connected && frame.state === 'closing' && frame.hidden === 'true' && frame.inert)).toBe(true)
    else expect(frames.every(frame => !frame.connected)).toBe(true)
    expect(await root.evaluate(element => element.isConnected)).toBe(false)
    observations.push({ command, frames })
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
  }
  const root = await dialog.evaluateHandle(element => element.closest<HTMLElement>('[data-modal-state]')!)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  if (motion === 'no-preference') expect(await dialog.evaluate((element, original) => element.closest('[data-modal-state]') === original, root)).toBe(true)
  await page.waitForTimeout(250)
  await expect(dialog).toBeVisible()
  await capture('reopened')
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
  await expect.poll(() => page.locator('[data-modal-state]').count()).toBe(0)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await testInfo.attach('calendar-day-native-evidence', { body: Buffer.from(JSON.stringify({ role, theme, motion,
    viewport: page.viewportSize(), verifiedDate, liveClock, consoleDiagnostics, media, geometry, initial, afterPage, observations, reads, writes, errors }, null, 2)), contentType: 'application/json' })
}
