import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// Uses the four unauthenticated matrix projects, but navigates real public forms.
test.use({ video: 'on', trace: 'retain-on-failure' })
test.setTimeout(60_000)

for (const kind of ['signup', 'reset'] as const) for (const motion of ['no-preference', 'reduce'] as const) {
  test(`${kind} ${motion} actual resend recovery`, async ({ page }, testInfo) => {
    const errors: string[] = []
    const consoleErrors: Array<{ text: string; url: string }> = []
    const writes: string[] = []
    const requests: string[] = []
    const failedResources = new Set<string>()
    const resendPath = kind === 'signup' ? '/api/auth/signup' : '/api/auth/forgot-password'
    const verifyPath = kind === 'signup' ? '/api/auth/verify-signup' : '/api/auth/reset-password/verify'
    const failureStatus = kind === 'signup' ? 429 : 500
    let release: ((response: { status: number; body: unknown }) => void) | undefined
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url })
    })
    page.on('request', request => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname)
    })
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname
      expect(route.request().method()).toBe('POST')
      expect([resendPath, verifyPath]).toContain(pathname)
      requests.push(pathname)
      const response = await new Promise<{ status: number; body: unknown }>(resolve => { release = resolve })
      if (response.status >= 400) failedResources.add(`${pathname}:${response.status}`)
      await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) })
    })
    await page.emulateMedia({ reducedMotion: motion })
    await page.addInitScript(() => {
      const observed: unknown[] = []
      Object.assign(window, { authResendTimings: observed })
      if (PerformanceObserver.supportedEntryTypes.includes('event')) {
        const options: PerformanceObserverInit & { durationThreshold: number } = {
          type: 'event', buffered: true, durationThreshold: 16,
        }
        new PerformanceObserver(list => {
          for (const item of list.getEntries()) {
            const entry = item as PerformanceEntry & { interactionId?: number; processingStart?: number; processingEnd?: number; target?: Node }
            observed.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration, interactionId: entry.interactionId,
              processingStart: entry.processingStart, processingEnd: entry.processingEnd,
              target: entry.target instanceof Element ? entry.target.getAttribute('aria-label') || entry.target.tagName : entry.target?.nodeName })
          }
        }).observe(options)
      }
    })
    const route = kind === 'signup' ? '/verify-signup' : '/reset-password'
    expect((await page.goto(`${route}?email=baseline%40example.invalid`, { waitUntil: 'networkidle' }))?.status()).toBe(200)
    await page.evaluate(() => document.fonts.ready)
    const viewport = page.viewportSize()!
    expect(viewport).toEqual(testInfo.project.metadata.viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
    expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(testInfo.project.metadata.theme === 'dark')
    const email = page.getByLabel(/^School Email/)
    const code = page.getByLabel(kind === 'signup' ? /^Verification Code/ : /^Reset Code/)
    const fieldError = page.locator('form').getByRole('alert')
    const verify = page.getByRole('button', { name: kind === 'signup' ? 'Verify Email' : 'Verify Code', exact: true })
    const resend = page.getByRole('button', { name: kind === 'signup' ? 'Resend verification code' : 'Resend reset code', exact: true })
    await code.click()
    await page.keyboard.type('A7Q2F')
    await code.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 4))
    const originalCode = await code.elementHandle()
    const originalResend = await resend.elementHandle()
    const originalPageY = await page.evaluate(() => window.scrollY)
    const bounds = (await resend.boundingBox())!
    expect(bounds.height).toBeGreaterThanOrEqual(44)
    expect(bounds.width).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const states: unknown[] = []
    async function capture(name: string) {
      const path = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path, animations: 'allow', caret: 'initial' })
      await testInfo.attach(name, { path, contentType: 'image/png' })
      states.push({ name, focus: await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.textContent })), pageY: await page.evaluate(() => window.scrollY) })
    }
    async function startResend(expectedCount: number) {
      await resend.focus()
      await resend.press('Enter')
      await expect.poll(() => requests.length).toBe(expectedCount)
      const pending = page.getByRole('button', { name: 'Sending…', exact: true })
      await expect(pending).toBeDisabled()
      await expect(pending).toHaveAttribute('aria-busy', 'true')
      await expect(email).toBeDisabled()
      await expect(code).toBeDisabled()
      await expect(verify).toBeDisabled()
      await expect(page.getByText(/^(Verification|Reset) code requested$/)).toHaveCount(0)
      // Exercise the real disabled control and form guard; these are synthetic handler checks.
      await originalResend!.evaluate(element => (element as HTMLButtonElement).click())
      await code.evaluate(element => element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(requests).toHaveLength(expectedCount)
    }
    async function finish(response: { status: number; body: unknown }, restoreFocus = true) {
      expect(release).toBeDefined()
      release!(response)
      release = undefined
      await expect(resend).toBeEnabled()
      await expect(code).toBeEnabled()
      await expect(email).toBeEnabled()
      await expect(verify).toBeEnabled()
      expect(await code.evaluate((element, original) => element === original, originalCode)).toBe(true)
      expect(await code.inputValue()).toBe('A7Q2F')
      expect(await code.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 4])
      expect(await page.evaluate(() => window.scrollY)).toBe(originalPageY)
      if (restoreFocus) await expect(resend).toBeFocused()
      else await expect(resend).not.toBeFocused()
    }
    try {
      await capture('initial-draft')
      await startResend(1)
      await capture('pending')
      await finish({ status: failureStatus, body: { error: 'Controlled unavailable response' } })
      await expect(fieldError).toHaveText('Failed to resend code. Please try again.')
      await expect(code).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByText(/^(Verification|Reset) code requested$/)).toHaveCount(0)
      await capture('failure-draft')
      await startResend(2)
      // Deliberate pointer movement to the page background must cancel focus restoration.
      await page.mouse.click(4, 4)
      await finish({ status: 200, body: { success: true } }, false)
      await expect(page.getByText(kind === 'signup' ? 'Verification code requested' : 'Reset code requested', { exact: true })).toBeVisible()
      await expect(fieldError).toHaveCount(0)
      await capture('retry-accepted')
      await startResend(3)
      await finish({ status: failureStatus, body: { error: 'Controlled unavailable response' } })
      await expect(fieldError).toHaveText('Failed to resend code. Please try again.')
      await expect(page.getByText(/^(Verification|Reset) code requested$/)).toHaveCount(0)
      await capture('old-success-cleared')
      await verify.focus()
      await verify.press('Enter')
      await expect.poll(() => requests.length).toBe(4)
      await expect(resend).toBeDisabled()
      await originalResend!.evaluate(element => (element as HTMLButtonElement).click())
      expect(requests).toEqual([resendPath, resendPath, resendPath, verifyPath])
      release!({ status: 400, body: { error: 'Invalid code' } })
      release = undefined
      await expect(resend).toBeEnabled()
      await expect(fieldError).toHaveText('Invalid code')
      await capture('verification-exclusion')
      const unexpectedConsoleErrors = consoleErrors.filter(error => {
        if (!error.url) return true
        const pathname = new URL(error.url).pathname
        return ![400, failureStatus].some(status => failedResources.has(`${pathname}:${status}`) && error.text.includes(`status of ${status}`))
      })
      expect(errors).toEqual([])
      expect(unexpectedConsoleErrors).toEqual([])
      expect(writes).toEqual(requests)
      const receipt = testInfo.outputPath('auth-resend-receipt.json')
      await writeFile(receipt, JSON.stringify({ kind, motion, viewport, theme: testInfo.project.metadata.theme, bounds, requests, writes,
        persistedWrites: 0, errors, consoleErrors, unexpectedConsoleErrors, states,
        timings: await page.evaluate(() => (window as unknown as { authResendTimings: unknown[] }).authResendTimings),
        limits: 'Actual public page owners with intercepted synthetic responses; shared unauthenticated entry. Local dev Event Timing observations at16ms threshold; absent entries are not zero latency. No production INP, auth backend/email delivery or hardware performance claim.' }, null, 2))
      await testInfo.attach('auth-resend-receipt', { path: receipt, contentType: 'application/json' })
    } finally {
      release?.({ status: 500, body: { error: 'Test cleanup' } })
      await originalCode?.dispose()
      await originalResend?.dispose()
    }
  })
}
