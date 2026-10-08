import { expect, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { StudentAttendanceCheckInView } from '../../src/lib/validations/student-attendance'

export async function verifyAttendanceReturnLink(page: Page, testInfo: TestInfo, motion: 'no-preference' | 'reduce') {
  const theme = testInfo.project.metadata.theme as 'light' | 'dark'
  const viewport = testInfo.project.metadata.viewport as string
  const classroomId = '30000000-0000-4000-8000-000000000001'
  type Outcome = 'checked_in' | 'already_checked_in' | 'closed' | 'unavailable'
  let outcome: Outcome = 'checked_in'
  let releaseInitial: (() => void) | undefined
  const initial = new Promise<void>(resolve => { releaseInitial = resolve })
  let firstRequest = true
  const requests: Array<{ outcome: Outcome; attemptId: string }> = []
  const measurements: Array<{ state: string; width: number; height: number; focusShadow: string }> = []
  const unexpectedWrites: string[] = []
  await page.addInitScript(theme => localStorage.setItem('pika-theme', theme), theme)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion })
  await page.route('**/api/**', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) unexpectedWrites.push(new URL(route.request().url()).pathname)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api/student/attendance/classroom-check-in', async route => {
    const body = route.request().postDataJSON() as { attemptId: string }
    expect(body.attemptId).toEqual(expect.any(String))
    requests.push({ outcome, attemptId: body.attemptId })
    if (firstRequest) { firstRequest = false; await initial }
    const result = outcome === 'unavailable'
      ? { error: 'Controlled unavailable response' }
      : outcome === 'closed'
        ? { state: 'closed', title: 'Attendance is not open', description: 'This classroom poster works when your teacher opens attendance.' } satisfies StudentAttendanceCheckInView
        : { state: outcome, title: outcome === 'checked_in' ? 'You are checked in' : 'You are already checked in', description: 'Your attendance was recorded.', classroomId } satisfies StudentAttendanceCheckInView
    await route.fulfill({ status: outcome === 'unavailable' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(result) })
  })
  async function verifyReturn(state: string, successful: boolean) {
    const link = page.getByRole('link', { name: successful ? 'Back to classroom' : 'Back to classrooms', exact: true })
    await expect(link).toHaveAttribute('href', successful ? `/classrooms/${classroomId}?tab=today` : '/classrooms')
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab')
      if (await link.evaluate(element => document.activeElement === element)) break
    }
    await expect(link).toBeFocused()
    const rect = await link.boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.width).toBeGreaterThanOrEqual(44)
    expect(rect!.height).toBeGreaterThanOrEqual(44)
    const focus = await link.evaluate(element => ({ visible: element.matches(':focus-visible'), shadow: getComputedStyle(element).boxShadow }))
    expect(focus.visible).toBe(true)
    expect(focus.shadow).not.toBe('none')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    measurements.push({ state, width: rect!.width, height: rect!.height, focusShadow: focus.shadow })
    const path = testInfo.outputPath(`${state}-return-focus.png`)
    await page.screenshot({ path, animations: 'allow' })
    await testInfo.attach(state, { path, contentType: 'image/png' })
  }
  expect((await page.goto('/e2e-fixtures/student-classroom-attendance', { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Checking you in…' })).toBeVisible()
  expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(theme === 'dark')
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
  expect(page.viewportSize()).toEqual(viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
  await verifyReturn('loading', false)
  releaseInitial!()
  await expect(page.getByRole('heading', { name: 'You are checked in', exact: true })).toBeVisible()
  await verifyReturn('checked_in', true)
  for (outcome of ['already_checked_in', 'closed', 'unavailable'] as const) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: outcome === 'already_checked_in' ? 'You are already checked in' : outcome === 'closed' ? 'Attendance is not open' : 'Not checked-in', exact: true })).toBeVisible()
    await verifyReturn(outcome, outcome === 'already_checked_in')
  }
  const uncertainAttempt = requests.at(-1)!.attemptId
  const previousCount = requests.length
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect.poll(() => requests.length).toBe(previousCount + 1)
  await expect(page.getByRole('heading', { name: 'Not checked-in' })).toBeVisible()
  expect(requests.at(-1)!.attemptId).toBe(uncertainAttempt)
  expect(unexpectedWrites).toEqual([])
  await writeFile(testInfo.outputPath('receipt.json'), JSON.stringify({ theme, viewport, motion, measurements, uncertainRetrySameAttempt: true, unexpectedWrites, responses: 'controlled existing classroom fixture' }, null, 2))
}
