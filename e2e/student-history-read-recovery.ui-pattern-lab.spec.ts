import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

test.use({ video: 'on', trace: 'retain-on-failure' })

const alpha = {
  id: '60000000-0000-4000-8000-000000000001', teacher_id: '60000000-0000-4000-8000-000000000003',
  title: 'History Alpha', class_code: 'ALPHA1', theme_color: 'blue', allow_enrollment: true,
  archived_at: null, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
}
const beta = { ...alpha, id: '60000000-0000-4000-8000-000000000002', title: 'History Beta', class_code: 'BETA22' }
const day = { id: '60000000-0000-4000-8000-000000000004', classroom_id: alpha.id,
  date: '2026-10-05', is_class_day: true, prompt_text: 'What did you learn?' }
const entry = { id: '60000000-0000-4000-8000-000000000005', classroom_id: alpha.id,
  student_id: '60000000-0000-4000-8000-000000000006', date: day.date,
  text: 'Alpha log: I explained my evidence and planned the next step.',
  created_at: '2026-10-05T17:05:00Z', updated_at: '2026-10-05T17:05:00Z' }

async function prepare(page: Page, info: TestInfo, motion: 'reduce' | 'no-preference') {
  const theme = info.project.metadata.theme as 'light' | 'dark'
  await page.emulateMedia({ reducedMotion: motion })
  await page.addInitScript(value => localStorage.setItem('theme', value), theme)
  // Dates stay deterministic while CSS animation and natural interaction clocks run.
  await page.clock.setFixedTime(new Date('2026-10-06T15:00:00Z'))
  const writes: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    }
  })
  return writes
}

async function capture(page: Page, info: TestInfo, state: string) {
  await page.screenshot({ path: info.outputPath(`${state}.png`), animations: 'allow', caret: 'initial' })
}

async function verifyWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
}

for (const motion of ['no-preference', 'reduce'] as const) {
  for (const failedRead of ['classrooms', 'days', 'entries'] as const) {
    test(`History rejects unreadable ${failedRead} and keyboard retry recovers (${motion})`, async ({ page }, info) => {
      const writes = await prepare(page, info, motion)
      const pageErrors: string[] = []
      page.on('pageerror', error => pageErrors.push(error.message))
      let mode: 'malformed' | 'held' | 'valid' = 'malformed'
      let failedRequests = 0
      const releases: Array<() => void> = []
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url())
        if (request.method() !== 'GET') return route.abort()
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: entry.student_id, role: 'student' } } })
        const isList = url.pathname === '/api/student/classrooms'
        const isDays = url.pathname.endsWith('/class-days')
        const isEntries = url.pathname === '/api/student/entries'
        const classroomId = isDays ? url.pathname.split('/')[3] : url.searchParams.get('classroom_id')
        const failing = (failedRead === 'classrooms' && isList)
          || (classroomId === alpha.id && ((failedRead === 'days' && isDays) || (failedRead === 'entries' && isEntries)))
        if (failing) {
          failedRequests++
          if (mode === 'held') await new Promise<void>(resolve => releases.push(resolve))
          if (mode === 'malformed') return route.fulfill({ status: 200, contentType: 'application/json', body: 'Unreadable JSON' })
        }
        if (isList) return route.fulfill({ json: { classrooms: [alpha, beta] } })
        if (isDays) return route.fulfill({ json: { class_days: classroomId === alpha.id ? [day] : [] } })
        if (isEntries) return route.fulfill({ json: { entries: classroomId === alpha.id ? [entry] : [] } })
        return route.fulfill({ json: {} })
      })
      try {
        await page.goto('/e2e-fixtures/student-history')
        const region = page.getByRole('region', { name: 'Student attendance', exact: true })
        const errorTitle = failedRead === 'classrooms' ? 'Could not load your classrooms' : 'Could not load attendance history'
        await expect(page.getByRole('heading', { name: errorTitle, exact: true })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'No Classes Yet', exact: true })).toHaveCount(0)
        await expect(page.getByText('No class days yet', { exact: true })).toHaveCount(0)
        await expect(page.getByText('Absent', { exact: true })).toHaveCount(0)
        if (failedRead !== 'classrooms') await expect(page.getByRole('button', { name: /History Alpha/ })).toHaveAttribute('aria-pressed', 'true')
        await verifyWidth(page)
        await capture(page, info, 'unreadable-read-error')
        const originalRegion = await region.elementHandle()
        mode = 'held'
        const retry = page.getByRole('button', { name: 'Try again', exact: true })
        await retry.focus()
        await page.keyboard.press('Enter')
        await expect.poll(() => releases.length).toBeGreaterThan(0)
        await expect(region).toBeFocused()
        await expect(page.getByRole('heading', { name: errorTitle, exact: true })).toHaveCount(0)
        await capture(page, info, 'keyboard-retry-pending')
        mode = 'valid'
        for (const release of releases.splice(0)) release()
        const opener = page.getByRole('button', { name: /View log/ })
        await expect(opener).toBeVisible()
        await expect(page.getByText('Absent', { exact: true })).toHaveCount(1)
        expect(await region.evaluate((node, original) => node === original, originalRegion)).toBe(true)
        await capture(page, info, 'recovered-present-log')
        await opener.focus()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('dialog').getByText(entry.text, { exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(opener).toBeFocused()
        await page.getByRole('button', { name: /History Beta/ }).click()
        await expect(page.getByRole('heading', { name: beta.title, exact: true })).toBeVisible()
        await expect(page.getByText('No class days yet', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: /History Beta/ })).toHaveAttribute('aria-pressed', 'true')
        await verifyWidth(page)
        await capture(page, info, 'valid-empty-beta')
        expect(failedRequests).toBe(2)
        expect(writes).toEqual([])
        expect(pageErrors).toEqual([])
      } finally {
        mode = 'valid'
        for (const release of releases.splice(0)) release()
      }
    })
  }
}

test('shared class-days client keeps teacher Calendar error/retry distinct from generation', async ({ page }, info) => {
  const writes = await prepare(page, info, 'reduce')
  let malformed = true, reads = 0
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() !== 'GET') return route.abort()
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: alpha.teacher_id, role: 'teacher' } } })
    if (url.pathname === '/api/teacher/classrooms') return route.fulfill({ json: { classrooms: [alpha] } })
    if (url.pathname.endsWith('/class-days')) {
      reads++
      return malformed
        ? route.fulfill({ status: 200, contentType: 'application/json', body: 'Unreadable JSON' })
        : route.fulfill({ json: { class_days: [day] } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/e2e-fixtures/teacher-calendar')
  await expect(page.getByRole('heading', { name: 'Could not load calendar', exact: true })).toBeVisible()
  await expect(page.getByText('Semester 1', { exact: true })).toHaveCount(0)
  await verifyWidth(page)
  await capture(page, info, 'teacher-calendar-read-error')
  malformed = false
  await page.getByRole('button', { name: 'Try again', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/ALPHA1.*1 class days/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Could not load calendar', exact: true })).toHaveCount(0)
  await capture(page, info, 'teacher-calendar-recovered')
  expect(reads).toBe(2)
  expect(writes).toEqual([])
})

for (const failedRead of ['days', 'entries'] as const) {
  test(`shared ${failedRead} client preserves Today blocking read/retry`, async ({ page }, info) => {
    const writes = await prepare(page, info, 'reduce')
    await mockTableShellReads(page, 'student')
    let malformed = true, reads = 0, recoveryReads = 0
    const endpoint = failedRead === 'days' ? `**/api/classrooms/${TABLE_CLASSROOM_ID}/class-days` : '**/api/student/entries?*'
    await page.route(endpoint, async route => {
      if (route.request().method() !== 'GET') return route.abort()
      reads++
      if (malformed) return route.fulfill({ status: 200, contentType: 'application/json', body: 'Unreadable JSON' })
      recoveryReads++
      return route.fallback()
    })
    await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=today')
    const title = failedRead === 'days' ? 'Class schedule unavailable' : 'Daily log unavailable'
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await capture(page, info, 'today-blocking-read-error')
    malformed = false
    await page.getByRole('button', { name: 'Try again', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Past logs', exact: true })).toBeVisible()
    await expect(page.getByText('Past daily log 1', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0)
    await verifyWidth(page)
    await capture(page, info, 'today-recovered-past-logs')
    // Today reloads its initial entries when class days arrive. Count the
    // user-triggered recovery separately from those existing cold reads.
    expect(recoveryReads).toBe(1)
    await info.attach('read-counts', { body: JSON.stringify({ reads, recoveryReads }), contentType: 'application/json' })
    expect(writes).toEqual([])
  })
}
