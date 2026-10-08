import { writeFile } from 'node:fs/promises'
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mockLongTeacherTable, mockTableShellReads, TABLE_CLASSROOM_ID } from './teacher-student-tables'

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 80; count += 1) {
    if (await target.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Native Tab did not reach Gradebook Retry')
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    const rect = active?.getBoundingClientRect()
    return {
      focus: { name: active?.getAttribute('aria-label'), tag: active?.tagName,
        connected: active?.isConnected, visible: Boolean(rect?.width && rect.height),
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null },
      width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth,
      table: (() => {
        const table = document.querySelector<HTMLElement>('[data-testid="gradebook-student-scroll-pane"]')
        return { visible: Boolean(table?.getClientRects().length), scrollTop: table?.scrollTop,
          height: table?.clientHeight, scrollHeight: table?.scrollHeight }
      })(),
    }
  })
}

/** Controlled GET payloads, native production owner/focus. No database persistence or clocks. */
export async function verifyGradebookRetryFocus(page: Page, testInfo: TestInfo) {
  const mobile = testInfo.project.metadata.viewport === 'mobile'
  const theme = testInfo.project.metadata.theme === 'dark' ? 'dark' : 'light'
  await page.addInitScript(value => localStorage.setItem('theme', value), theme)
  await mockTableShellReads(page)
  await mockLongTeacherTable(page, 'gradebook', TABLE_CLASSROOM_ID)
  let reads = 0
  let releaseCold!: () => void
  let releaseWarm!: () => void
  let releaseResize!: () => void
  const coldGate = new Promise<void>(resolve => { releaseCold = resolve })
  const warmGate = new Promise<void>(resolve => { releaseWarm = resolve })
  const resizeGate = new Promise<void>(resolve => { releaseResize = resolve })
  const requests: Array<{ path: string; query: string; method: string; status?: number }> = []
  const mutations: string[] = []
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const states: Record<string, Awaited<ReturnType<typeof measure>>> = {}
  await page.route('**/api/teacher/gradebook?*', async route => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('classroom_id')).toBe(TABLE_CLASSROOM_ID)
    reads += 1
    if (reads === 1) return route.fulfill({ status: 500, json: { error: 'Controlled Gradebook cold failure' } })
    if (reads === 2) await coldGate
    if (reads === 3) {
      await warmGate
      return route.fulfill({ status: 500, json: { error: 'Controlled Gradebook warm failure' } })
    }
    if (reads === 5) return route.fulfill({ status: 500, json: { error: 'Controlled resize retry failure' } })
    if (reads === 6) await resizeGate
    return route.fallback()
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    if (request.method() !== 'GET') {
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`)
      return route.abort()
    }
    return route.fallback()
  })
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, query: url.search,
      method: response.request().method(), status: response.status() })
  })
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  async function capture(name: string) {
    states[name] = await measure(page)
    expect(states[name].overflow).toBe(0)
    await page.screenshot({ path: testInfo.outputPath(`gradebook-${name}.png`), animations: 'allow' })
  }
  async function navigate(label: string) {
    if (mobile) await page.getByRole('button', { name: 'Open classroom navigation', exact: true }).click()
    await page.getByRole('link', { name: label, exact: true }).click()
    if (mobile) await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toHaveCount(0)
  }
  const workspace = () => page.getByRole('region', { name: mobile ? 'Gradebook workspace' : 'Gradebook students', exact: true })
  try {
    await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=gradebook')
    await expect(page.getByText('Gradebook unavailable', { exact: true })).toBeVisible()
    await expect(page.getByText('No students enrolled yet.', { exact: true })).toHaveCount(0)
    await capture('cold-error')
    const retry = page.getByRole('button', { name: 'Retry loading gradebook', exact: true })
    await tabTo(page, retry)
    await capture('cold-retry-focus')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Retrying gradebook', exact: true })).toBeFocused()
    await capture('cold-pending')
    releaseCold()
    await expect(workspace()).toBeFocused()
    await expect(page.getByText('Gradebook unavailable', { exact: true })).toHaveCount(0)
    await capture('cold-success')
    const table = page.getByTestId('gradebook-student-scroll-pane')
    const tableNode = await table.elementHandle()
    if (!mobile) {
      await table.evaluate(element => { element.scrollTop = 600 })
      await expect.poll(() => table.evaluate(element => element.scrollTop)).toBe(600)
      await capture('table-scroll')
    } else {
      const selector = page.getByLabel('Student', { exact: true })
      await expect(selector.locator('option')).toHaveCount(46)
      await selector.selectOption('40000000-0000-4000-8000-000000000045')
      await expect(page.getByRole('heading', { name: 'Student 45 Alpha45', exact: true })).toBeVisible()
    }
    await navigate('Roster')
    await navigate('Gradebook')
    await expect.poll(() => reads).toBe(3)
    await capture('warm-pending')
    expect(await table.evaluate((element, original) => element === original, tableNode)).toBe(true)
    releaseWarm()
    const warmFailure = page.getByText('Gradebook could not be refreshed. Showing the last loaded grades.', { exact: true })
    await expect(warmFailure).toBeVisible()
    await capture('warm-error')
    if (!mobile) expect(await table.evaluate(element => element.scrollTop)).toBe(600)
    await tabTo(page, page.getByRole('button', { name: 'Retry loading gradebook', exact: true }))
    await capture('warm-retry-focus')
    await page.keyboard.press('Enter')
    await expect(workspace()).toBeFocused()
    await expect(warmFailure).toHaveCount(0)
    expect(await table.evaluate((element, original) => element === original, tableNode)).toBe(true)
    if (!mobile) expect(await table.evaluate(element => element.scrollTop)).toBe(600)
    await capture('warm-success')
    // Resize while an explicit retry is pending; CSS presentation at commit owns focus.
    await navigate('Roster')
    await navigate('Gradebook')
    await expect(warmFailure).toBeVisible()
    await tabTo(page, page.getByRole('button', { name: 'Retry loading gradebook', exact: true }))
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Retrying gradebook', exact: true })).toBeFocused()
    await page.setViewportSize(mobile ? { width: 1440, height: 900 } : { width: 390, height: 844 })
    await capture('resized-pending')
    releaseResize()
    await expect(page.getByRole('region', { name: mobile ? 'Gradebook students' : 'Gradebook workspace', exact: true })).toBeFocused()
    await capture('resized-success')
    expect(mutations).toEqual([])
    expect(pageErrors).toEqual([])
    expect(reads).toBe(6)
  } finally {
    releaseCold()
    releaseWarm()
    releaseResize()
    const facts = JSON.stringify({ controlledGETs: true, students: 45, assessmentColumns: 0,
      motion: testInfo.title.includes('reduce') ? 'reduce' : 'no-preference', theme, mobile,
      states, requests, mutations, pageErrors, consoleErrors }, null, 2)
    await writeFile(testInfo.outputPath('native-facts.json'), facts)
    await testInfo.attach('Gradebook retry native facts', {
      body: JSON.stringify({ controlledGETs: true, students: 45, assessmentColumns: 0,
        motion: testInfo.title.includes('reduce') ? 'reduce' : 'no-preference', theme, mobile,
        states, requests, mutations, pageErrors, consoleErrors }, null, 2), contentType: 'application/json',
    })
  }
}
