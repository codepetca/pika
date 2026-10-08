import { expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const EMAIL = 'retry@example.invalid'
const PASSWORD = 'SyntheticLogin123!'
const NEXT = '/classrooms?entry=recovery'
async function tabTo(page: Page, control: Locator) {
  for (let i = 0; i < 20; i++) {
    if (await control.evaluate(node => document.activeElement === node)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Native Tab could not reach entry control')
}
async function focusVisible(control: Locator) {
  await expect(control).toBeFocused()
  expect(await control.evaluate(node => node.matches(':focus-visible') && getComputedStyle(node).boxShadow !== 'none')).toBe(true)
}

/** Anonymous classic Login owner; all APIs fenced before navigation; no account/session proof. */
export async function verifyLoginRecoveryContinuity(page: Page, info: TestInfo, motion: 'no-preference' | 'reduce') {
  const theme = info.project.metadata.theme === 'dark' ? 'dark' : 'light'
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion })
  expect(await page.context().cookies()).toEqual([])
  const queue: Array<{ status: number; body: object | string; hold: Promise<void>; release: () => void }> = []
  const releases: Array<() => void> = []
  const requests: unknown[] = [], unexpected: string[] = [], errors: string[] = [], consoleErrors: string[] = [], states: unknown[] = [], destinations: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  function next(status: number, body: object | string) {
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    queue.push({ status, body, hold, release }); releases.push(release)
    return release
  }
  const fence = async (route: Route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    const item = queue.shift()
    requests.push({ path, method: request.method(), body: request.postDataJSON(), status: item?.status })
    if (path !== '/api/auth/login' || request.method() !== 'POST' || !item) {
      unexpected.push(`${request.method()} ${path}`)
      await route.fulfill({ status: 599, json: { error: 'Unexpected API blocked' } }); return
    }
    expect(request.postDataJSON()).toEqual({ email: EMAIL, password: PASSWORD })
    await item.hold
    await route.fulfill({ status: item.status, contentType: 'application/json', body: typeof item.body === 'string' ? item.body : JSON.stringify(item.body) })
  }
  await page.route('**/api/**', fence)
  await page.route('**/classrooms**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path !== '/classrooms') { await route.continue(); return }
    destinations.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><h1>Requested destination only</h1><p>No identity or classroom access verified.</p>' })
  })
  const email = page.getByLabel('School Email'), password = page.getByLabel(/Password/), form = page.locator('form'), card = form.locator('..')
  const login = page.getByRole('button', { name: 'Login', exact: true })
  async function capture(name: string) {
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    states.push({ name, url: page.url(), data: await page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null
      const card = document.querySelector('form')?.parentElement?.getBoundingClientRect()
      return { focus: { tag: active?.tagName, visible: active?.matches(':focus-visible'), caret: active?.selectionStart }, busy: document.querySelector('form')?.getAttribute('aria-busy'), card: card ? { x: card.x, y: card.y, width: card.width, height: card.height } : null }
    }) })
    const path = info.outputPath(`login-${name}.png`)
    await page.screenshot({ path, animations: 'allow', caret: 'initial', fullPage: true })
    await info.attach(name, { path, contentType: 'image/png' })
  }
  async function start() {
    await page.goto(`/login?next=${encodeURIComponent(NEXT)}`)
    await expect(email).toBeVisible(); await email.fill(EMAIL); await password.fill(PASSWORD)
  }
  async function assertDrafts() {
    await expect(email).toHaveValue(EMAIL); await expect(password).toHaveValue(PASSWORD)
    expect(await password.evaluate(node => (node as HTMLInputElement & { continuityNode?: boolean }).continuityNode)).toBe(true)
    expect(await email.evaluate(node => (node as HTMLInputElement & { continuityNode?: boolean }).continuityNode)).toBe(true)
  }
  try {
    await start()
    await email.evaluate(node => { (node as HTMLInputElement & { continuityNode?: boolean }).continuityNode = true })
    await password.evaluate(node => { (node as HTMLInputElement & { continuityNode?: boolean }).continuityNode = true })
    await password.press('Home'); await password.press('ArrowRight'); await password.press('ArrowRight'); await password.press('ArrowRight')
    expect(await password.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(3)
    await password.press('Tab'); await focusVisible(login)
    await capture('01-default-keyboard')
    const before = await card.boundingBox()
    let release = next(401, { error: 'Synthetic credentials rejected' })
    await login.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true'); await expect(password).toBeDisabled()
    await capture('02-held-401'); expect(await card.boundingBox()).toEqual(before)
    release(); await expect(page.getByText('Synthetic credentials rejected', { exact: true })).toBeVisible(); await focusVisible(login)
    await assertDrafts(); expect(await password.evaluate(node => (node as HTMLInputElement).selectionStart)).toBe(3)
    await capture('03-recovered-401'); expect(await card.boundingBox()).toEqual(before)

    release = next(500, { error: 'Synthetic server failure' }); await login.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true')
    await page.getByRole('heading', { name: 'Pika Classroom' }).click(); release()
    await expect(page.getByText('Synthetic server failure', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    await assertDrafts(); await capture('04-deliberate-pointer-no-theft'); expect(await card.boundingBox()).toEqual(before)

    await tabTo(page, login); release = next(401, { error: 'Synthetic keyboard recovery' }); await login.press('Enter')
    await expect(form).toHaveAttribute('aria-busy', 'true'); await tabTo(page, page.getByRole('button', { name: 'Forgot password?' }))
    const forgot = page.getByRole('button', { name: 'Forgot password?' }); release()
    await expect(page.getByText('Synthetic keyboard recovery', { exact: true })).toBeVisible(); await focusVisible(forgot)
    await capture('05-deliberate-keyboard-no-theft')

    await tabTo(page, login); release = next(200, 'malformed synthetic JSON'); await login.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true'); release()
    await expect(form.getByRole('alert')).toBeVisible(); await focusVisible(login); await assertDrafts(); await capture('06-malformed-recovered')

    release = next(200, { redirectUrl: '/classrooms?ignored=server' }); await login.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true')
    await capture('07-held-success-retry'); release()
    await expect(page).toHaveURL(/\/classrooms\?entry=recovery$/); await expect(page.getByRole('heading', { name: 'Requested destination only' })).toBeVisible()
    expect(destinations.some(url => new URL(url).search === '?entry=recovery')).toBe(true)

    for (const departure of ['Forgot password?', 'Sign up', 'unmount'] as const) {
      await start(); await password.press('Tab'); release = next(200, { redirectUrl: '/classrooms?obsolete=true' }); await login.press('Enter'); await expect(form).toHaveAttribute('aria-busy', 'true')
      if (departure === 'unmount') await page.goto('/forgot-password')
      else { const control = page.getByRole('button', { name: departure, exact: true }); await tabTo(page, control); await control.press('Enter') }
      await expect(page).toHaveURL(departure === 'Sign up' ? /\/signup\?email=retry%40example.invalid&next=/ : /\/forgot-password$/)
      const departedUrl = page.url(); release(); await page.waitForTimeout(200); expect(page.url()).toBe(departedUrl)
      await capture(`08-departed-${departure.replace(/\W+/g, '-')}`)
    }
    await page.goto(`/signup?email=${encodeURIComponent(EMAIL)}&next=${encodeURIComponent(NEXT)}`)
    const footer = page.getByRole('button', { name: 'Login', exact: true }); await tabTo(page, footer); await focusVisible(footer)
    const footerBox = await footer.boundingBox(); expect(footerBox!.height).toBeGreaterThanOrEqual(44); expect(footerBox!.width).toBeGreaterThanOrEqual(44)
    await capture('09-signup-footer-keyboard')
    await footer.press('Enter'); await expect(page).toHaveURL(/\/login\?next=%2Fclassrooms%3Fentry%3Drecovery$/)
    await capture('10-footer-continuation')
    expect(unexpected).toEqual([]); expect(errors).toEqual([]); expect(queue).toEqual([])
    await writeFile(info.outputPath('login-recovery-evidence.json'), JSON.stringify({ project: info.project.name, motion, theme, requests, unexpected, errors, consoleErrors, states, destinations, footerBox, scope: 'Synthetic client ownership only; no account/session/password persistence' }, null, 2))
  } finally {
    releases.forEach(release => release())
    await page.unroute('**/api/**', fence)
  }
}
