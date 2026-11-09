import { expect, type Page, type TestInfo } from '@playwright/test'

const longAnnouncementTitle = 'Calendar reading reminder: bring your notes and questions about the field observations to the next class'

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
      content_markdown: index === 4
        ? '# Lesson 5\n\n' + Array(8).fill('Discuss the calendar reading and concrete next steps.').join('\n\n') + '\n\nFINAL READING LINE'
        : index === 18 ? Array.from({ length: 16 }, (_, line) => `Future lab step ${line + 1}`).join('\n')
        : `Lesson ${index + 1}`,
      created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    })) }
    else if (path.endsWith('/announcements')) body = { announcements: [
      { title: longAnnouncementTitle, content: 'FINAL EVENT LINE', day: 5 },
      { title: 'Weekend prep', content: 'Review the reading.', day: 4 },
      { title: 'Weekend reminder', content: 'Bring your notes.', day: 4 },
    ].map(({ title, content, day }, index) => ({
      id: `calendar-announcement-${index}`, classroom_id: classroomId, title, content, is_draft: false,
      scheduled_for: null, calendar_date: date(day),
      published_at: `${date(day)}T12:00:00Z`, created_at: `${date(day)}T12:00:00Z`, updated_at: `${date(day)}T12:00:00Z`,
      created_by: '30000000-0000-4000-8000-000000000012',
    })) }
    else if (path.endsWith('/assignments')) body = { assignments: [] }
    else if (path.endsWith('/notifications')) body = { notifications: [] }
    else if (path.endsWith('/materials')) body = { materials: [] }
    else if (path.endsWith('/classrooms')) body = { classrooms: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=calendar&calendarTerm=true`, { waitUntil: 'domcontentloaded' })
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
  const dates = page.getByRole('region', { name: 'Calendar dates' })
  await expect(dates.getByRole('button', { name: longAnnouncementTitle })).toBeVisible()
  const heading = dates.getByText('Mon', { exact: true })
  const expectGridPosition = () => expect.poll(() => heading.evaluate(element => {
    const scroller = element.closest<HTMLElement>('[role="region"]')!
    const previousWeek = scroller.querySelector('[data-calendar-date="2026-09-28"]')!.getBoundingClientRect()
    const today = scroller.querySelector('[data-calendar-date="2026-10-05"]')!.getBoundingClientRect()
    const headingBounds = element.getBoundingClientRect()
    const contentTop = headingBounds.bottom
    return scroller.scrollTop > 0 && Math.abs(previousWeek.top - contentTop) <= 1
      && Math.abs(previousWeek.bottom - today.top) <= 1
      && today.top <= contentTop + (scroller.clientHeight - headingBounds.height) / 2
  })).toBe(true)
  await expectGridPosition()
  await page.screenshot({ path: testInfo.outputPath(`${role}-${motion}-grid-opening.png`) })
  await dates.evaluate(element => { element.scrollTop = 0 })
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expectGridPosition()
  await page.getByRole('button', { name: 'List', exact: true }).click()
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
  await expect(dialog).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
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
  await verifyGridLessonInteraction(page, role, capture)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await testInfo.attach('calendar-day-native-evidence', { body: Buffer.from(JSON.stringify({ role, theme, motion,
    viewport: page.viewportSize(), verifiedDate, liveClock, consoleDiagnostics, media, geometry, initial, afterPage, observations, reads, writes, errors }, null, 2)), contentType: 'application/json' })
}

/** Grid shows every entry on first paint and retains teacher editing. */
async function verifyGridLessonInteraction(page: Page, role: 'teacher' | 'student', capture: (state: string) => Promise<void>) {
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  const day = page.locator('[data-calendar-date="2026-10-05"]')
  const preview = day.locator('.calendar-lesson-preview')
  const title = day.getByRole('button', { name: longAnnouncementTitle }).locator('span')
  await expect.poll(() => title.evaluate(element =>
    element.scrollWidth > element.clientWidth && getComputedStyle(element).maskImage.includes('linear-gradient'))).toBe(true)

  const weekend = page.locator('[data-calendar-date="2026-10-04"]')
  for (const name of ['Weekend prep', 'Weekend reminder']) {
    await expect(weekend.getByRole('button', { name })).toBeInViewport()
  }

  // DOM presence alone would pass with a line clamp. Check that the last
  // line is inside both the painted preview and the cell before any click.
  await expect.poll(() => preview.evaluate(element => {
    const text = element.querySelector('div')!
    const range = document.createRange()
    range.selectNodeContents(text)
    const end = Array.from(range.getClientRects()).at(-1)
    return text.textContent?.endsWith('FINAL READING LINE') && !!end
      && end.bottom <= text.getBoundingClientRect().bottom + 1
      && end.bottom <= element.closest('[data-calendar-date]')!.getBoundingClientRect().bottom + 1

  })).toBe(true)
  await expect(preview.getByText('Discuss the calendar reading and concrete next steps.').first()).toHaveCSS('mask-image', /linear-gradient/)
  await expect(preview.getByText('Lesson 5', { exact: true })).toHaveCSS('mask-image', 'none')
  await expect(title).toBeInViewport()
  await capture('grid-first-items')
  await preview.evaluate(element => element.scrollIntoView({ block: 'end' }))
  await capture('grid-last-line')

  if (role === 'teacher') {
    await preview.press('Enter')
    const editor = page.getByRole('textbox', { name: 'Lesson plan for October 5, 2026' })
    await expect(editor).toBeFocused()
    await expect.poll(() => editor.evaluate(element =>
      element.getBoundingClientRect().bottom <= element.closest('[data-calendar-date]')!.getBoundingClientRect().bottom + 1)).toBe(true)
    await capture('grid-editing')
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(preview).toBeFocused()
  } else {
    await expect(day.getByRole('button', { name: /edit lesson|add lesson/i })).toHaveCount(0)
  }
}

/** Empty non-class weekdays must not let the lesson overlay intercept event clicks. */
export async function verifyEmptyCalendarLessonTargets(page: Page, testInfo: TestInfo) {
  const classroomId = '30000000-0000-4000-8000-000000000011'
  const writes: string[] = []
  const unknown: string[] = []
  const errors: string[] = []
  await page.clock.setFixedTime(new Date('2026-10-05T16:00:00Z'))
  await page.addInitScript(theme => localStorage.setItem('theme', theme), testInfo.project.metadata.theme)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${path}`)
      return route.abort()
    }
    if ([...url.searchParams.keys()].some(key => !['start', 'end', 'classroom_id'].includes(key))) {
      unknown.push(request.url())
      return route.abort()
    }
    let body: unknown
    if (path === '/api/auth/me') body = { user: { id: '30000000-0000-4000-8000-000000000012',
      role: 'teacher', email: 'teacher@example.invalid', first_name: 'Fixture' } }
    else if (path === `/api/classrooms/${classroomId}/class-days`) body = {
      class_days: Array.from({ length: 31 }, (_, index) => ({ id: `day-${index}`, classroom_id: classroomId,
        date: `2026-10-${String(index + 1).padStart(2, '0')}`, is_class_day: index !== 5, prompt_text: '' })),
    }
    else if (path === `/api/teacher/classrooms/${classroomId}/lesson-plans`) body = { lesson_plans: [] }
    else if (path === `/api/teacher/classrooms/${classroomId}/announcements`) body = { announcements: [{
      id: 'empty-day-event', classroom_id: classroomId, title: 'Blank day event', content: 'Event content',
      is_draft: false, scheduled_for: null, published_at: '2026-10-06T12:00:00Z',
      created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z',
      created_by: '30000000-0000-4000-8000-000000000012',
    }] }
    else if (path === `/api/teacher/classrooms/${classroomId}/materials`) body = { materials: [] }
    else if (path === '/api/teacher/assignments') body = { assignments: [] }
    else if (path === '/api/teacher/tests') body = { tests: [] }
    else if (path === '/api/teacher/classrooms') body = { classrooms: [] }
    else {
      unknown.push(request.url())
      return route.abort()
    }
    await route.fulfill({ json: body })
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=calendar', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'List', exact: true }).click()
  const add = page.getByRole('button', { name: 'Add lesson for October 6, 2026', exact: true })
  const event = page.getByRole('button', { name: 'Blank day event', exact: true })
  // Center the row below the sticky month heading, then reveal its hover action
  // as a pointer user would before clicking it.
  await event.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await event.hover()
  const bounds = await add.evaluate(element => {
    const button = element.getBoundingClientRect()
    const region = element.closest('.calendar-day-text')!.getBoundingClientRect()
    return { top: button.top - region.top, bottom: button.bottom - region.bottom, height: button.height }
  })
  expect(bounds.top).toBeGreaterThanOrEqual(-1)
  expect(bounds.bottom).toBeLessThanOrEqual(1)
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  await expect(add).toHaveCSS('opacity', '1')
  expect(await add.evaluate(element => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
  })).toBe(true)
  await add.click()
  await expect(page.getByRole('textbox', { name: 'Lesson plan for October 6, 2026' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Lesson plan for October 6, 2026' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
  await event.scrollIntoViewIfNeeded()
  expect(await event.evaluate(element => {
    const box = element.getBoundingClientRect()
    return document.elementFromPoint(box.left + 10, box.top + 5)?.closest('button') === element
  })).toBe(true)
  await testInfo.attach('empty-nonclass-lesson-and-event', { body: await page.screenshot(), contentType: 'image/png' })
  await event.click({ position: { x: 10, y: 5 } })
  await expect(page.getByRole('region', { name: 'Calendar workspace' })).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Lesson plan for October 6, 2026' })).toHaveCount(0)
  expect(writes).toEqual([])
  expect(unknown).toEqual([])
  expect(errors).toEqual([])
}
