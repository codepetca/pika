import { expect, type Page, type Route, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const EMAIL = 'reset@example.invalid'
const PASSWORD = 'SyntheticReset123!'
const TOKEN = 'synthetic-reset-token-0000000000000000000000'
type Motion = 'no-preference' | 'reduce'
type Mock = { endpoint: string; status: number; body: object | string; release: () => void; held: Promise<void> | null }

function mockResponse(endpoint: string, status: number, body: object | string, held = false): Mock {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { endpoint, status, body, release, held: held ? promise : null }
}

async function publicContext(page: Page, testInfo: TestInfo, motion: Motion) {
  const theme = testInfo.project.metadata.theme
  await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light', reducedMotion: motion })
  expect(await page.context().cookies()).toEqual([])
  return async () => {
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
    expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(theme === 'dark')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
}

async function targets(page: Page) {
  for (const control of await page.locator('form').locator('..').locator('input,button').all()) {
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
}
async function visibleFocus(control: ReturnType<Page['getByRole']>) {
  await expect(control).toBeFocused()
  expect(await control.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).boxShadow !== 'none')).toBe(true)
}

export async function verifyPasswordResetContinuity(page: Page, testInfo: TestInfo, motion: Motion) {
  const assertMedia = await publicContext(page, testInfo, motion)
  const queue: Mock[] = []
  const pending: Mock[] = []
  const requests: Array<{ path: string; method: string; payload: unknown; status?: number; receivedAt: number; fulfilledAt?: number }> = []
  const unexpected: string[] = []
  const navigation: Array<{ pathname: string; type: string }> = []
  const errors: string[] = []
  const consoleErrors: string[] = []
  const states: unknown[] = []
  const onError = (error: Error) => errors.push(error.message)
  const onConsole = (message: { type: () => string; text: () => string }) => { if (message.type() === 'error') consoleErrors.push(message.text()) }
  page.on('pageerror', onError)
  page.on('console', onConsole)
  const fence = async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const item = queue.shift()
    const log = { path, method: request.method(), payload: request.postDataJSON(), status: item?.status, receivedAt: Date.now(), fulfilledAt: undefined as number | undefined }
    requests.push(log)
    if (!item || request.method() !== 'POST' || path !== item.endpoint) {
      unexpected.push(`${request.method()} ${path}`)
      await route.fulfill({ status: 599, contentType: 'application/json', body: '{"error":"Unexpected API request blocked"}' })
      return
    }
    if (item.held) await item.held
    log.fulfilledAt = Date.now()
    await route.fulfill({ status: item.status, contentType: typeof item.body === 'string' ? 'text/plain' : 'application/json', body: typeof item.body === 'string' ? item.body : JSON.stringify(item.body) })
  }
  const destination = async (route: Route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname !== '/classrooms') { await route.continue(); return }
    navigation.push({ pathname, type: request.resourceType() })
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Requested destination only: /classrooms</h1><p>No identity or classroom access verified.</p></body></html>' })
  }
  await page.route('**/api/**', fence)
  await page.route('**/classrooms**', destination)
  function next(endpoint: string, status: number, body: object | string, held = false) {
    const item = mockResponse(endpoint, status, body, held)
    queue.push(item); pending.push(item)
    return item.release
  }
  async function capture(name: string) {
    if (name !== '10-requested-destination-only') await assertMedia()
    states.push({ name, ...(await page.evaluate(() => {
      const active = document.activeElement
      const form = document.querySelector('form')
      const box = form?.parentElement?.getBoundingClientRect()
      return { at: Date.now(), controls: [...document.querySelectorAll('input,button')].map(element => { const input = element as HTMLInputElement; const bounds = element.getBoundingClientRect(); return { tag: element.tagName, text: element.tagName === 'BUTTON' ? element.textContent?.trim() : undefined, label: element.getAttribute('aria-labelledby'), value: element.tagName === 'INPUT' ? input.value : undefined, caret: element.tagName === 'INPUT' ? input.selectionStart : undefined, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } } }), url: location.href, focus: { tag: active?.tagName, visible: active?.matches(':focus-visible') }, card: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null }
    })) })
    const path = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path, animations: 'allow', caret: 'initial', fullPage: true })
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const alert = page.locator('form p[role="alert"]')
  const card = () => page.locator('form').locator('..').boundingBox()
  try {
    await page.goto('/forgot-password?next=%2Fjoin%2FRESETTEST')
    await expect(page.getByRole('heading', { name: 'Forgot Password', exact: true })).toBeVisible()
    await targets(page)
    await capture('01-forgot-default')
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('School Email')).toBeFocused()
    await page.keyboard.type(EMAIL)
    await page.keyboard.press('Tab')
    const send = page.getByRole('button', { name: 'Send Reset Code', exact: true })
    await visibleFocus(send)
    next('/api/auth/forgot-password', 500, { error: 'Failed to send reset code' })
    await page.keyboard.press('Enter')
    await expect(alert).toHaveText('Failed to send reset code')
    await visibleFocus(send)
    await expect(page.getByLabel('School Email')).toHaveValue(EMAIL)
    await capture('02-forgot-error')
    const beforeForgot = await card()
    const releaseForgot = next('/api/auth/forgot-password', 200, { success: true }, true)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Sending...', exact: true })).toBeDisabled()
    expect(await card()).toEqual(beforeForgot)
    await capture('03-forgot-pending')
    releaseForgot()
    await expect(page.getByRole('status')).toContainText('If an account exists with this email')
    const acknowledged = Date.now()
    await capture('04-forgot-generic-status')
    await page.waitForURL('**/reset-password?email=*')
    expect(Date.now() - acknowledged).toBeGreaterThanOrEqual(1850)
    expect(new URL(page.url()).searchParams.get('email')).toBe(EMAIL)
    expect(new URL(page.url()).searchParams.has('next')).toBe(false)
    await targets(page)
    const code = page.getByLabel('Reset Code')
    await code.focus()
    await page.keyboard.type('ab')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('z')
    await expect(code).toHaveValue('AZB')
    expect(await code.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(2)
    await capture('05-reset-middle-caret')
    await page.keyboard.press('End')
    await page.keyboard.type('2f')
    const codeNode = await code.elementHandle()
    await page.keyboard.press('Tab')
    const verify = page.getByRole('button', { name: 'Verify Code', exact: true })
    await visibleFocus(verify)
    next('/api/auth/reset-password/verify', 401, { error: 'Invalid email or code' })
    await page.keyboard.press('Enter')
    await expect(alert).toHaveText('Invalid email or code')
    await visibleFocus(verify)
    expect(await codeNode!.evaluate(element => element.isConnected && (element as HTMLInputElement).value === 'AZB2F' && (element as HTMLInputElement).selectionStart === 5)).toBe(true)
    await capture('06-reset-invalid')
    const noTheft = next('/api/auth/reset-password/verify', 401, { error: 'Invalid email or code' }, true)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Verifying...', exact: true })).toBeDisabled()
    await page.getByRole('heading', { name: 'Reset Password', exact: true }).click()
    noTheft()
    await expect(alert).toHaveText('Invalid email or code')
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    await code.focus()
    await page.keyboard.press('Tab')
    next('/api/auth/reset-password/verify', 200, 'malformed-json')
    await page.keyboard.press('Enter')
    await expect(alert).toBeVisible()
    await visibleFocus(verify)
    await expect(code).toHaveValue('AZB2F')
    await capture('07-reset-malformed')
    next('/api/auth/reset-password/verify', 200, { success: true, handoffToken: TOKEN })
    await code.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Set New Password', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    expect(page.url()).not.toContain(TOKEN)
    expect(await page.evaluate(token => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(token), TOKEN)).toBe(false)
    const password = page.getByLabel('New Password')
    const confirmation = page.getByLabel('Confirm Password')
    await password.focus(); await page.keyboard.type(PASSWORD)
    await page.keyboard.press('Tab'); await expect(confirmation).toBeFocused()
    await page.keyboard.type(PASSWORD); await page.keyboard.press('ArrowLeft')
    const caret = await confirmation.evaluate(element => (element as HTMLInputElement).selectionStart)
    const passwordNode = await password.elementHandle(), confirmationNode = await confirmation.elementHandle()
    await page.keyboard.press('Tab')
    const reset = page.getByRole('button', { name: 'Reset Password', exact: true })
    await visibleFocus(reset)
    next('/api/auth/reset-password/confirm', 500, { error: 'Failed to reset password' })
    await page.keyboard.press('Enter')
    await expect(alert).toHaveText('Failed to reset password')
    await visibleFocus(reset)
    expect(await passwordNode!.evaluate(element => element.isConnected && (element as HTMLInputElement).value === 'SyntheticReset123!')).toBe(true)
    expect(await confirmationNode!.evaluate((element, caret) => element.isConnected && (element as HTMLInputElement).value === 'SyntheticReset123!' && (element as HTMLInputElement).selectionStart === caret, caret)).toBe(true)
    await capture('08-confirm-error')
    const beforeConfirm = await card()
    const releaseConfirm = next('/api/auth/reset-password/confirm', 200, { success: true, redirectUrl: '/classrooms' }, true)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Resetting Password...', exact: true })).toBeDisabled()
    expect(await card()).toEqual(beforeConfirm)
    await expect(password).toHaveValue(PASSWORD); await expect(confirmation).toHaveValue(PASSWORD)
    await capture('09-confirm-pending')
    releaseConfirm()
    await expect(page.getByRole('heading', { name: 'Requested destination only: /classrooms' })).toBeVisible()
    expect(navigation.some(item => item.type === 'document')).toBe(true)
    await capture('10-requested-destination-only')
    for (const request of requests) {
      if (request.path === '/api/auth/forgot-password') expect(request.payload).toEqual({ email: EMAIL })
      else if (request.path.endsWith('/verify')) expect(request.payload).toEqual({ email: EMAIL, code: 'AZB2F' })
      else expect(request.payload).toEqual({ email: EMAIL, password: PASSWORD, passwordConfirmation: PASSWORD, handoffToken: TOKEN })
    }
    await page.goto('/reset-password?email=reset%40example.invalid')
    await expect(code).toBeVisible(); await code.fill('AZB2F'); await code.focus(); await page.keyboard.press('Tab')
    next('/api/auth/reset-password/verify', 200, { success: true, handoffToken: TOKEN })
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Set New Password', exact: true })).toBeVisible()
    await page.reload()
    await expect(code).toBeVisible(); await expect(code).toHaveValue('')
    await capture('11-refresh-restarts-verification')
    // The acknowledged owner's real two-second timer must not replace explicit departure.
    await page.goto('/forgot-password')
    await page.getByLabel('School Email').fill(EMAIL)
    next('/api/auth/forgot-password', 200, { success: true })
    await page.getByRole('button', { name: 'Send Reset Code' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toContainText('Check your email!')
    const back = page.getByRole('button', { name: 'Back to login' })
    await back.focus(); await visibleFocus(back); await page.keyboard.press('Enter')
    await page.waitForURL('**/login')
    await page.waitForTimeout(2200)
    await expect(page).toHaveURL(/\/login$/)
    await capture('12-owner-departure-no-stale-redirect')
    expect(queue).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
    expect(consoleErrors.filter(message => !/Failed to load resource: the server responded with a status of (401|500)/.test(message))).toEqual([])
  } finally {
    pending.forEach(item => item.release())
    await page.unroute('**/api/**', fence)
    await page.unroute('**/classrooms**', destination)
    page.off('pageerror', onError); page.off('console', onConsole)
    const logPath = testInfo.outputPath('password-reset-evidence.json')
    await writeFile(logPath, JSON.stringify({ motion, project: testInfo.project.name, requests, unexpected, errors, consoleErrors, navigation, states }, null, 2))
    await testInfo.attach('password-reset-evidence', { path: logPath, contentType: 'application/json' })
  }
}

export async function verifyLoginSignupTarget(page: Page, testInfo: TestInfo, motion: Motion) {
  const assertMedia = await publicContext(page, testInfo, motion)
  const unexpected: string[] = []
  const fence = async (route: Route) => {
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.fulfill({ status: 599, contentType: 'application/json', body: '{"error":"Unexpected API request blocked"}' })
  }
  await page.route('**/api/**', fence)
  try {
    await page.goto('/login?next=%2Fjoin%2FRESETTEST%3Fprofile%3Drequired')
    await page.getByLabel('School Email').fill(EMAIL)
    const signup = page.getByRole('button', { name: 'Sign up', exact: true })
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).focus()
    await page.keyboard.press('Tab')
    await visibleFocus(signup)
    const box = await signup.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44)
    await assertMedia()
    const focusPath = testInfo.outputPath('login-signup-focus.png')
    await page.screenshot({ path: focusPath, animations: 'allow', caret: 'initial' })
    await testInfo.attach('login-signup-focus', { path: focusPath, contentType: 'image/png' })
    await page.keyboard.press('Enter')
    await page.waitForURL('**/signup?*')
    expect(new URL(page.url()).searchParams.get('email')).toBe(EMAIL)
    expect(new URL(page.url()).searchParams.get('next')).toBe('/join/RESETTEST?profile=required')
    await expect(page.getByLabel('School Email')).toHaveValue(EMAIL)
    await assertMedia()
    const continuationPath = testInfo.outputPath('signup-continuation-only.png')
    await page.screenshot({ path: continuationPath, animations: 'allow', caret: 'initial' })
    await testInfo.attach('signup-continuation-only', { path: continuationPath, contentType: 'image/png' })
    expect(unexpected).toEqual([])
    await writeFile(testInfo.outputPath('signup-target-evidence.json'), JSON.stringify({ motion, project: testInfo.project.name, target: box, url: page.url(), unexpected }, null, 2))
  } finally { await page.unroute('**/api/**', fence) }
}
