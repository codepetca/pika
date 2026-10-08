import { expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'

async function tabTo(page: Page, control: Locator) {
  for (let step = 0; step < 20; step += 1) {
    if (await control.evaluate(element => document.activeElement === element)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Native Tab could not reach the Join command')
}

/** Actual public Join owner; every API request is intercepted before navigation. */
export async function verifyJoinRetryContinuity(page: Page, info: TestInfo, motion: 'no-preference' | 'reduce') {
  await page.emulateMedia({ reducedMotion: motion })
  const errors: string[] = []
  const consoleErrors: string[] = []
  const unexpected: string[] = []
  const attempts: Array<{ method: string; path: string; body: unknown; mode: string }> = []
  const pending: Route[] = []
  const screenshots: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  let mode: 'cold' | 'hold' | 'signed-out' = 'cold'
  await page.route('**/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() !== 'POST' || pathname !== '/api/student/classrooms/join') {
      unexpected.push(`${request.method()} ${pathname}`)
      await route.fulfill({ status: 599, json: { error: 'Unexpected API request fenced' } })
      return
    }
    const body = request.postDataJSON()
    attempts.push({ method: request.method(), path: pathname, body, mode })
    expect(body.classCode).toBe('ENTRYTEST')
    if (mode === 'hold') pending.push(route)
    else if (mode === 'signed-out') await route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
    else {
      await new Promise<void>(resolve => setTimeout(resolve, 350))
      await route.fulfill({ status: 403, json: { code: 'enrollment_closed' } })
    }
  })
  const region = page.getByRole('region', { name: 'Join this classroom', exact: true })
  const retry = page.getByRole('button', { name: 'Try again', exact: true })
  async function capture(name: string) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const filename = `join-retry-${name}.png`
    await page.screenshot({ path: info.outputPath(filename), animations: 'allow', fullPage: true })
    screenshots.push(filename)
  }
  async function respond(status: number, body: unknown) {
    await expect.poll(() => pending.length).toBe(1)
    await pending.shift()!.fulfill({ status, json: body })
  }
  const geometry: Array<{ name: string; width: number; height: number }> = []
  async function target(control: Locator, name: string) {
    const box = await control.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
    geometry.push({ name, width: box!.width, height: box!.height })
  }
  const success = { classroom: { id: 'synthetic-join-id', title: 'Synthetic classroom' } }
  await page.goto('/join/ENTRYTEST')
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(info.project.metadata.theme === 'dark')
  await expect(region).toHaveAttribute('aria-busy', 'true')
  await expect(region).not.toBeFocused()
  await capture('initial-pending')
  await expect(retry).toBeVisible()
  await expect(region).not.toBeFocused()
  await capture('initial-error')
  const stableRegion = await region.elementHandle()
  await target(retry, 'Try again')
  mode = 'hold'
  await tabTo(page, retry)
  await page.keyboard.press('Enter')
  await expect(region).toBeFocused()
  await expect(region).toHaveAttribute('aria-busy', 'true')
  await expect(region.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  const focus = await region.evaluate(element => ({ visible: element.matches(':focus-visible'), shadow: getComputedStyle(element).boxShadow }))
  if (focus.visible) expect(focus.shadow).not.toBe('none')
  await capture('retry-pending')
  await respond(403, { code: 'enrollment_closed' })
  await expect(retry).toBeVisible()
  await expect(region).toBeFocused()
  await expect(region).not.toHaveAttribute('aria-busy')
  await capture('retry-error')
  await tabTo(page, retry)
  await page.keyboard.press('Enter')
  await expect(region).toBeFocused()
  await respond(200, success)
  await expect(page.getByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
  await expect(region).toBeFocused()
  expect(await region.evaluate((element, original) => element === original, stableRegion)).toBe(true)
  await capture('retry-success')

  // Tab deliberately leaves the focused region while the request is pending.
  // No completion effect may reclaim it, including after a successful response.
  mode = 'cold'
  await page.goto('/join/ENTRYTEST')
  await expect(retry).toBeVisible()
  mode = 'hold'
  await tabTo(page, retry)
  await page.keyboard.press('Enter')
  await expect(region).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(region).not.toBeFocused()
  const deliberateFocus = await page.evaluateHandle(() => document.activeElement)
  await respond(200, success)
  await expect(page.getByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
  expect(await deliberateFocus.evaluate(element => document.activeElement === element)).toBe(true)
  await capture('deliberate-focus-retained')

  await page.goto('/join/ENTRYTEST?profile=required')
  const first = page.getByLabel('First name', { exact: true })
  const last = page.getByLabel('Last name', { exact: true })
  const number = page.getByLabel('Student number or lab ID (optional)', { exact: true })
  for (const [control, value] of [[first, 'Entry'], [last, 'Student'], [number, 'SYN123']] as const) {
    await tabTo(page, control)
    await page.keyboard.type(value)
  }
  await page.keyboard.press('ArrowLeft')
  const caret = await number.evaluate(element => (element as HTMLInputElement).selectionStart)
  const originalInputs = await page.locator('input').elementHandles()
  const submit = page.getByRole('button', { name: 'Join classroom', exact: true })
  await target(first, 'First name')
  await target(last, 'Last name')
  await target(number, 'Student number')
  await target(submit, 'Join classroom')
  await tabTo(page, submit)
  await page.keyboard.press('Enter')
  await expect(region).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('button', { name: 'Joining…' })).toHaveAttribute('aria-busy', 'true')
  await expect(first).toBeDisabled()
  await capture('profile-pending')
  await respond(429, { code: 'rate_limited', retryAfterSeconds: 1 })
  await expect(region.getByRole('alert')).toContainText('Too many attempts')
  await expect(region).not.toHaveAttribute('aria-busy')
  await expect(first).toHaveValue('Entry')
  await expect(last).toHaveValue('Student')
  await expect(number).toHaveValue('SYN123')
  expect(await number.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(caret)
  for (let index = 0; index < originalInputs.length; index += 1) {
    expect(await page.locator('input').nth(index).evaluate((element, original) => element === original, originalInputs[index])).toBe(true)
  }
  await capture('profile-error-retained')
  await new Promise<void>(resolve => setTimeout(resolve, 1_050))
  await tabTo(page, submit)
  await page.keyboard.press('Enter')
  await expect(region).toHaveAttribute('aria-busy', 'true')
  await respond(200, success)
  await expect(page.getByRole('heading', { name: 'You joined this classroom' })).toBeVisible()
  await expect(region).not.toHaveAttribute('aria-busy')
  await capture('profile-recovered')

  mode = 'signed-out'
  await page.goto('/join/ENTRYTEST')
  await expect(page).toHaveURL(/\/login\?next=%2Fjoin%2FENTRYTEST$/)
  await expect(page.getByLabel('School Email', { exact: true })).toBeVisible()
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
  const expectedConsole = consoleErrors.filter(message => /Failed to load resource: the server responded with a status of (401|403|429)/.test(message))
  expect(consoleErrors).toEqual(expectedConsole)
  await info.attach('join-retry-continuity-receipt', { contentType: 'application/json', body: JSON.stringify({ motion, role: 'anonymous pre-auth UI; teacher/student identity not established', attempts, geometry, focus, caret, screenshots, errors, unexpected, expectedConsole }, null, 2) })
}
