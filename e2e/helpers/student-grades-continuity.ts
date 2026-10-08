import { expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './teacher-student-tables'
import type { StudentGradesResponse } from '../../src/lib/student-grades'

const initialGrades: StudentGradesResponse = {
  currentPercent: 84,
  items: Array.from({ length: 35 }, (_, index) => ({
    id: `returned-${index}`, kind: index === 0 ? 'Gradebook item' : 'Classwork',
    title: `Returned work ${String(index).padStart(2, '0')}`,
    earned: index === 0 ? 0 : 8, possible: 10, percent: index === 0 ? 0 : 80,
    included: index !== 1,
    href: index === 0 ? null : `/classrooms/${TABLE_CLASSROOM_ID}?tab=assignments&assignmentId=returned-${index}`,
  })),
}

async function nativeTabTo(page: Page, target: Locator) {
  for (let count = 0; count < 80; count += 1) {
    if (await target.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Keyboard did not reach the intended Grades control')
}

async function openNavigation(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Open classroom navigation', exact: true }).click()
}

async function navigate(page: Page, name: string, mobile: boolean) {
  await openNavigation(page, mobile)
  await page.getByRole('link', { name, exact: true }).click()
  if (mobile) await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toHaveCount(0)
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.getByRole('region', { name: 'Grades', exact: true }).locator('..')).toHaveCSS('opacity', '1')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`grades-${name}.png`), animations: 'allow' })
}

/** Native owner/shell evidence. API payloads and identities are synthetic; no clocks are changed. */
export async function verifyStudentGradesContinuity(page: Page, testInfo: TestInfo) {
  const mobile = testInfo.project.metadata.viewport === 'mobile'
  const errors: string[] = [], writes: string[] = [], requests: Route[] = []
  const held = new Map<number, Route>()
  let lastSuccessAt = 0
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.method())
  })
  await mockTableShellReads(page, 'student')
  await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/student/classrooms/*/grades', async route => {
    requests.push(route)
    if (requests.length === 1) {
      await route.fulfill({ json: initialGrades })
      lastSuccessAt = Date.now()
    } else held.set(requests.length, route)
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&grades=true&tab=grades')
  const region = page.getByRole('region', { name: 'Grades', exact: true })
  const view = page.getByTestId('student-grades-view')
  await expect(view).toBeVisible()
  await expect(view.getByText('84%', { exact: true })).toBeVisible()
  await expect(view.getByText('Not counted', { exact: true })).toBeVisible()
  await expect(view.getByRole('link', { name: /Returned work 00/ })).toHaveCount(0)
  const row = await view.getByText('Returned work 20', { exact: true }).elementHandle()
  if (!row) throw new Error('Returned row missing')
  const firstLink = view.getByRole('link', { name: /Returned work 01/ })
  await expect(firstLink).toHaveAttribute('href', /assignmentId=returned-1/)
  await screenshot(page, testInfo, 'returned')
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'auto' }))
  const savedScroll = await page.evaluate(() => window.scrollY)
  expect(savedScroll).toBeGreaterThan(500)
  await navigate(page, 'Classwork', mobile)
  expect(await row.evaluate(element => element.isConnected)).toBe(true)
  await navigate(page, 'Grades', mobile)
  await expect(view).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(await row.evaluate(element => element.isConnected)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(savedScroll, 0)
  await navigate(page, 'Classwork', mobile)
  // Wait for the real 30-second cache expiry; this is not a fake-clock motion test.
  await expect.poll(() => Date.now() - lastSuccessAt, { timeout: 35_000, intervals: [500] }).toBeGreaterThan(30_250)
  await openNavigation(page, mobile)
  const gradesNav = page.getByRole('link', { name: 'Grades', exact: true })
  await nativeTabTo(page, gradesNav)
  await expect.poll(() => requests.length).toBe(2)
  // Intent has started the actual shell prefetch before Grades is active.
  await expect(gradesNav).not.toHaveAttribute('aria-current', 'page')
  await gradesNav.press('Enter')
  await expect(view).toBeVisible()
  await expect(region).toHaveAttribute('aria-busy', 'true')
  expect(await row.evaluate(element => element.isConnected)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(savedScroll, 0)
  await screenshot(page, testInfo, 'warm-pending')
  await held.get(2)!.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } })
  held.delete(2)
  const retry = region.getByRole('button', { name: 'Retry', exact: true })
  await expect(region.getByText('Grades could not be refreshed. Showing the last returned grades.')).toBeVisible()
  expect(await row.evaluate(element => element.isConnected)).toBe(true)
  await screenshot(page, testInfo, 'warm-error')
  await nativeTabTo(page, retry)
  await screenshot(page, testInfo, 'warm-error-focused')
  const retryScroll = await page.evaluate(() => window.scrollY)
  await retry.press('Enter')
  await expect.poll(() => requests.length).toBe(3)
  await expect(region).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(retryScroll)
  await expect(retry).toHaveCount(0)
  await screenshot(page, testInfo, 'retry-pending')
  await held.get(3)!.fulfill({ status: 500, json: { error: 'Still temporarily unavailable' } })
  held.delete(3)
  await expect(retry).toBeVisible()
  await nativeTabTo(page, retry)
  await retry.press('Enter')
  await expect.poll(() => requests.length).toBe(4)
  await expect(region).toBeFocused()
  const updated = { ...initialGrades, currentPercent: 85, items: initialGrades.items.slice(0, -1) }
  await held.get(4)!.fulfill({ json: updated })
  lastSuccessAt = Date.now()
  held.delete(4)
  await expect(view.getByText('85%', { exact: true })).toBeVisible()
  await expect(view.getByText('Returned work 34', { exact: true })).toHaveCount(0)
  expect(await row.evaluate(element => element.isConnected)).toBe(true)
  await expect(region).toBeFocused()
  await screenshot(page, testInfo, 'recovered')
  await navigate(page, 'Classwork', mobile)
  await expect.poll(() => Date.now() - lastSuccessAt, { timeout: 35_000, intervals: [500] }).toBeGreaterThan(30_250)
  await openNavigation(page, mobile)
  const deniedIntent = page.getByRole('link', { name: 'Grades', exact: true })
  await nativeTabTo(page, deniedIntent)
  await expect.poll(() => requests.length).toBe(5)
  await expect(deniedIntent).not.toHaveAttribute('aria-current', 'page')
  // The retained hidden owner must consume a settled intent denial before activation.
  await held.get(5)!.fulfill({ status: 403, contentType: 'text/plain', body: 'Unavailable' })
  held.delete(5)
  await expect.poll(() => row.evaluate(element => element.isConnected)).toBe(false)
  await expect(view).toHaveCount(0)
  await expect(deniedIntent).toBeFocused()
  await expect(deniedIntent).not.toHaveAttribute('aria-current', 'page')
  await deniedIntent.press('Enter')
  await expect.poll(() => requests.length).toBe(6)
  await expect(region).toHaveAttribute('aria-busy', 'true')
  await expect(view).toHaveCount(0)
  await held.get(6)!.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary outage' })
  held.delete(6)
  await expect(region.getByText('Grades unavailable', { exact: true })).toBeVisible()
  await expect(view).toHaveCount(0)
  await screenshot(page, testInfo, 'denied')
  const coldRetry = region.getByRole('button', { name: 'Retry', exact: true })
  await nativeTabTo(page, coldRetry)
  await coldRetry.press('Enter')
  await expect.poll(() => requests.length).toBe(7)
  await expect(region).toBeFocused()
  await screenshot(page, testInfo, 'cold-retry-pending')
  await held.get(7)!.fulfill({ json: { currentPercent: null, items: [] } })
  held.delete(7)
  await expect(view.getByText('No grades yet', { exact: true })).toBeVisible()
  await expect(view.getByText('—', { exact: true })).toBeVisible()
  await expect(region).toBeFocused()
  await screenshot(page, testInfo, 'empty')
  expect(requests).toHaveLength(7)
  expect(held.size).toBe(0)
  expect(errors).toEqual([])
  expect(writes).toEqual([])
  await testInfo.attach('grades-native-receipt', { body: JSON.stringify({
    requests: requests.length, realCacheExpiryWaits: 2, savedScroll, retryScroll,
    rowIdentityRetained: true, prefetchBeforeActivation: true, deniedSnapshotCleared: true, settledInactiveDenialConsumed: true,
    pendingAndRecoverableReadAfterDenialShowsNoOldMarks: true,
    keyboardRetryFocus: true, errors, writes,
    limits: 'Real production ClassroomPageClient/Grades owners with native navigation and actual 30s TTL; synthetic identities and intercepted reads; no authenticated persistence or hardware performance claim.',
  }, null, 2), contentType: 'application/json' })
}
