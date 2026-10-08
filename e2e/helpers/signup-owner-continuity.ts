import { expect, type Page, type Locator, type Route, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const EMAIL = 'owner@example.invalid', TOKEN = 'synthetic-owner-handoff-token', PASSWORD = 'SyntheticOwner123!', NEXT = '/join/OWNERSAFE?profile=required', KEY = 'pika.signupHandoffToken'
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 20; i++) { if (await target.evaluate(node => node === document.activeElement)) return; await page.keyboard.press('Tab') }
  throw new Error('Native Tab could not reach signup owner command')
}
async function focused(target: Locator) {
  await expect(target).toBeFocused()
  expect(await target.evaluate(node => node.matches(':focus-visible') && getComputedStyle(node).boxShadow !== 'none')).toBe(true)
}
/** Fenced synthetic signup chain: client ownership/storage only, no account or enrollment proof. */
export async function verifySignupOwnerContinuity(page: Page, info: TestInfo, motion: 'no-preference' | 'reduce') {
  const theme = info.project.metadata.theme === 'dark' ? 'dark' : 'light'
  await page.emulateMedia({ reducedMotion: motion, colorScheme: theme })
  expect(await page.context().cookies()).toEqual([])
  const queue: Array<{ endpoint: string; status: number; body: object; hold: Promise<void>; release: () => void }> = []
  const releases: Array<() => void> = [], requests: Array<{ endpoint: string; method: string; body: unknown; status?: number; at: number }> = []
  const errors: string[] = [], consoleErrors: string[] = [], unexpected: string[] = [], destinations: string[] = [], states: unknown[] = []
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  function next(endpoint: string, status: number, body: object) {
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve }); queue.push({ endpoint, status, body, hold, release }); releases.push(release); return release
  }
  const fence = async (route: Route) => {
    const request = route.request(), endpoint = new URL(request.url()).pathname, item = queue.shift(), body = request.postDataJSON()
    requests.push({ endpoint, method: request.method(), body, status: item?.status, at: Date.now() })
    if (!item || item.endpoint !== endpoint || request.method() !== 'POST') {
      unexpected.push(`${request.method()} ${endpoint}`); await route.fulfill({ status: 599, json: { error: 'Unexpected API blocked' } }); return
    }
    expect(body.email).toBe(EMAIL)
    if (endpoint === '/api/auth/signup') expect(body).toEqual({ email: EMAIL })
    else if (endpoint === '/api/auth/verify-signup') expect(Object.keys(body).sort()).toEqual(['code', 'email'])
    else expect(body).toMatchObject({ email: EMAIL, password: PASSWORD, handoffToken: TOKEN })
    await item.hold; await route.fulfill({ status: item.status, json: item.body })
  }
  await page.route('**/api/**', fence)
  await page.route('**/join/OWNERSAFE**', async route => {
    const url = new URL(route.request().url()); url.searchParams.delete('_rsc')
    expect(url.pathname + url.search).toBe(NEXT); destinations.push(route.request().resourceType())
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><h1>Requested destination only: Join</h1><p>No identity or enrollment verified.</p>' })
  })
  const form = page.locator('form'), email = page.getByLabel(/^School Email/), code = page.getByLabel(/^Verification Code/)
  const send = page.getByRole('button', { name: 'Send Verification Code', exact: true }), verify = page.getByRole('button', { name: 'Verify Email', exact: true }), create = page.getByRole('button', { name: 'Create Account', exact: true })
  const password = page.getByLabel(/^Password/), confirmation = page.getByLabel(/^Confirm Password/), resend = page.getByRole('button', { name: 'Resend verification code', exact: true })
  const path = (route: string) => `${route}?email=${encodeURIComponent(EMAIL)}&next=${encodeURIComponent(NEXT)}`
  async function capture(name: string) {
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const state = await page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null
      const box = document.querySelector('form')?.parentElement?.getBoundingClientRect()
      return { at: Date.now(), path: location.pathname, focus: { tag: active?.tagName, visible: active?.matches(':focus-visible'), caret: active?.selectionStart }, busy: document.querySelector('form')?.getAttribute('aria-busy'), card: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null, fields: [...document.querySelectorAll('input')].map(node => ({ label: node.getAttribute('aria-labelledby'), value: node.value, caret: node.selectionStart, disabled: node.disabled })), errors: [...document.querySelectorAll('form [role=alert]')].map(node => node.textContent) }
    }); states.push({ name, ...state })
    const shot = info.outputPath(`signup-owner-${name}.png`); await page.screenshot({ path: shot, fullPage: true, animations: 'allow', caret: 'initial' }); await info.attach(name, { path: shot, contentType: 'image/png' })
  }
  async function mark(node: Locator) { await node.evaluate(element => { (element as HTMLInputElement & { ownerNode?: boolean }).ownerNode = true }) }
  async function retained(node: Locator, value: string) { await expect(node).toHaveValue(value); expect(await node.evaluate(element => (element as HTMLInputElement & { ownerNode?: boolean }).ownerNode)).toBe(true) }
  async function activate(command: Locator) { await tabTo(page, command); await focused(command); await command.press('Enter') }
  async function stored() { return page.evaluate(key => sessionStorage.getItem(key), KEY) }
  try {
    await page.goto(path('/signup')); await expect(email).toHaveValue(EMAIL); await mark(email); await capture('01-signup-default')
    let release = next('/api/auth/signup', 429, { error: 'Synthetic retry requested' }); await activate(send)
    await expect(form).toHaveAttribute('aria-busy', 'true'); const signupPending = await form.locator('..').boundingBox(); await capture('02-signup-held-error'); release()
    await expect(form.getByRole('alert')).toHaveText('Synthetic retry requested'); await focused(send); await retained(email, EMAIL)
    expect(await form.locator('..').boundingBox()).toEqual(signupPending); await capture('03-signup-recovered')
    release = next('/api/auth/signup', 200, { success: true }); await send.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true'); release()
    const ack = page.getByText('Verification code sent! Redirecting...', { exact: true }); await expect(ack).toHaveAttribute('role', 'status'); await expect(ack).toHaveAttribute('aria-live', 'polite')
    const acknowledged = Date.now(); await capture('04-signup-status'); await expect(page).toHaveURL(/\/verify-signup\?/); const continuationDelay = Date.now() - acknowledged; expect(continuationDelay).toBeGreaterThanOrEqual(800)
    await expect(code).toBeVisible(); await code.fill('A7QF'); await code.press('Home'); await code.press('ArrowRight'); await code.press('ArrowRight'); await page.keyboard.type('b')
    await expect(code).toHaveValue('A7BQF'); expect(await code.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(3); await mark(code); await capture('05-verify-middle-caret')
    release = next('/api/auth/verify-signup', 400, { error: 'Invalid or expired code' }); await activate(verify); await expect(form.getByRole('button', { name: 'Verifying...', exact: true })).toHaveAttribute('aria-busy', 'true'); const verifyPending = await form.locator('..').boundingBox(); await capture('06-verify-held-error'); release()
    await expect(form.getByRole('alert')).toHaveText('Invalid or expired code'); await focused(verify); await retained(code, 'A7BQF'); expect(await code.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(3)
    expect(await form.locator('..').boundingBox()).toEqual(verifyPending); await capture('07-verify-recovered')
    release = next('/api/auth/verify-signup', 400, { error: 'Expired synthetic code' }); await verify.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true'); await page.getByRole('heading', { name: 'Verify Your Email' }).click(); release()
    await expect(form.getByRole('alert')).toHaveText('Expired synthetic code'); expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true); await capture('08-verify-deliberate-no-theft')
    release = next('/api/auth/signup', 429, { error: 'Synthetic resend throttled' }); await activate(resend); await expect(form).toHaveAttribute('aria-busy', 'true'); await expect(verify).toBeDisabled(); await expect(code).toBeDisabled(); await capture('09-resend-exclusive'); release()
    await expect(form.getByRole('alert')).toHaveText('Failed to resend code. Please try again.'); await focused(resend); await retained(code, 'A7BQF')
    release = next('/api/auth/verify-signup', 200, { handoffToken: TOKEN }); await activate(verify); await expect(form.getByRole('alert')).toHaveCount(0); await expect(resend).toBeDisabled(); release()
    await expect(page).toHaveURL(/\/create-password\?/); await expect(confirmation).toBeVisible(); expect(JSON.parse((await stored())!)).toEqual({ email: EMAIL, token: TOKEN })
    expect(page.url()).not.toContain(TOKEN); await password.fill(PASSWORD); await confirmation.fill('SyntheticMismatch123!'); await mark(password); await mark(confirmation)
    release = next('/api/auth/create-password', 400, { error: 'Passwords do not match' }); await activate(create); await expect(form.getByRole('button', { name: 'Creating Account...', exact: true })).toHaveAttribute('aria-busy', 'true'); const createPending = await form.locator('..').boundingBox(); await capture('10-create-held-mismatch'); release()
    await expect(form.getByRole('alert')).toHaveText('Passwords do not match'); await focused(create); await retained(password, PASSWORD); await retained(confirmation, 'SyntheticMismatch123!'); expect(await form.locator('..').boundingBox()).toEqual(createPending); await capture('11-create-mismatch-recovered')
    await confirmation.fill(PASSWORD); await confirmation.press('Home'); await confirmation.press('ArrowRight'); await confirmation.press('ArrowRight'); await confirmation.press('ArrowRight')
    release = next('/api/auth/create-password', 500, { error: 'Synthetic password service is temporarily unavailable. Please try again.' }); await activate(create); await expect(form).toHaveAttribute('aria-busy', 'true'); await page.getByRole('heading', { name: 'Create Your Password' }).click(); release()
    await expect(form.getByRole('alert')).toContainText('temporarily unavailable'); expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true); await retained(confirmation, PASSWORD); expect(await confirmation.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(3); await capture('12-create-long-error-natural-growth')
    release = next('/api/auth/create-password', 500, { error: 'Synthetic create retry' }); await activate(create); await expect(form).toHaveAttribute('aria-busy', 'true'); release()
    await expect(form.getByRole('alert')).toHaveText('Synthetic create retry'); await focused(create); await retained(password, PASSWORD); await retained(confirmation, PASSWORD); const shortCard = await form.locator('..').boundingBox(); await capture('13-create-short-error')
    release = next('/api/auth/create-password', 200, { redirectUrl: '/classrooms' }); await create.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true'); expect(await form.locator('..').boundingBox()).toEqual(shortCard); await capture('14-create-held-success'); release()
    await expect(page).toHaveURL(/\/join\/OWNERSAFE\?profile=required$/); await expect(page.getByRole('heading', { name: 'Requested destination only: Join' })).toBeVisible(); expect(await stored()).toBeNull()
    const successfulDestinations = destinations.length
    for (const mode of ['held', 'timer'] as const) {
      await page.goto(path('/signup')); await expect(email).toHaveValue(EMAIL); release = next('/api/auth/signup', 200, { success: true }); await activate(send); await expect(form).toHaveAttribute('aria-busy', 'true')
      if (mode === 'timer') { release(); await expect(page.getByText('Verification code sent! Redirecting...', { exact: true })).toBeVisible() }
      await activate(page.getByRole('button', { name: 'Login', exact: true })); await expect(page).toHaveURL(/\/login\?next=/); await expect(page.getByLabel('School Email')).toBeVisible()
      if (mode === 'held') release(); await page.waitForTimeout(1200); expect(new URL(page.url()).pathname).toBe('/login'); await capture(`15-signup-${mode}-departure-retired`)
    }
    await page.goto(path('/verify-signup')); await code.fill('A7Q2F'); release = next('/api/auth/verify-signup', 200, { handoffToken: 'obsolete-verify-token' }); await activate(verify); await expect(form).toHaveAttribute('aria-busy', 'true')
    await page.goto(path('/signup')); await expect(email).toBeVisible(); release(); await page.waitForTimeout(200); expect(new URL(page.url()).pathname).toBe('/signup'); expect(await stored()).toBeNull(); await capture('16-verify-unmount-retired')
    await page.goto(path('/verify-signup')); await code.fill('A7Q2F'); release = next('/api/auth/verify-signup', 200, { handoffToken: TOKEN }); await activate(verify); release(); await expect(confirmation).toBeVisible(); await password.fill(PASSWORD); await confirmation.fill(PASSWORD)
    release = next('/api/auth/create-password', 200, { redirectUrl: '/classrooms' }); await activate(create); await expect(form).toHaveAttribute('aria-busy', 'true'); await capture('17-create-held-before-back')
    await page.goBack(); await expect(code).toBeVisible(); release(); await page.waitForTimeout(200); expect(new URL(page.url()).pathname).toBe('/verify-signup'); expect(JSON.parse((await stored())!)).toEqual({ email: EMAIL, token: TOKEN }); expect(destinations.length).toBe(successfulDestinations); await capture('18-create-back-retired')
    expect(queue).toEqual([]); expect(unexpected).toEqual([]); expect(errors).toEqual([])
    await writeFile(info.outputPath('signup-owner-evidence.json'), JSON.stringify({ project: info.project.name, motion, theme, requests, unexpected, errors, consoleErrors, states, destinations, actualContinuationDelay: continuationDelay, scope: 'Fenced client ownership/storage; no account, auth session, email or enrollment proof' }, null, 2))
  } finally { releases.forEach(release => release()); await page.unroute('**/api/**', fence) }
}
