import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// Unauthenticated matrix projects exercise the real public form and destination.
test.use({ video: 'on', trace: 'retain-on-failure' })
test.setTimeout(60_000)

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`join code ${motion} canonical controls and handoff`, async ({ page }, testInfo) => {
    const errors: string[] = []
    const consoleErrors: Array<{ text: string; url: string }> = []
    const requests: Array<{ path: string; body: unknown }> = []
    const writes: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url })
    })
    page.on('request', request => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname)
    })
    await page.route('**/api/**', async route => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      expect(pathname).toBe('/api/student/classrooms/join')
      expect(request.method()).toBe('POST')
      const body = request.postDataJSON()
      expect(body).toEqual({ classCode: 'ABC123' })
      requests.push({ path: pathname, body })
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled unavailable response' }) })
    })
    await page.emulateMedia({ reducedMotion: motion })
    expect((await page.goto('/join', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    await page.evaluate(() => document.fonts.ready)
    const viewport = page.viewportSize()!
    expect(viewport).toEqual(testInfo.project.metadata.viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
    expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(testInfo.project.metadata.theme === 'dark')
    const input = page.getByRole('textbox', { name: 'Join code', exact: true })
    const join = page.getByRole('button', { name: 'Join', exact: true })
    const originalInput = await input.elementHandle()
    const states: string[] = []
    async function capture(name: string) {
      const path = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path, animations: 'allow', caret: 'initial' })
      await testInfo.attach(name, { path, contentType: 'image/png' })
      states.push(name)
    }
    try {
      await expect(join).toBeDisabled()
      const inputBounds = (await input.boundingBox())!
      const buttonBounds = (await join.boundingBox())!
      expect(inputBounds.height).toBeGreaterThanOrEqual(44)
      expect(buttonBounds.height).toBeGreaterThanOrEqual(44)
      expect(buttonBounds.width).toBeGreaterThanOrEqual(44)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await capture('empty-disabled')
      await input.focus()
      await page.keyboard.type(' abc123 ')
      await expect(input).toHaveValue(' ABC123 ')
      await expect(input).toBeFocused()
      expect(await input.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
      await capture('input-focus')
      await page.keyboard.press('Tab')
      await expect(join).toBeFocused()
      expect(await join.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
      await capture('button-focus')
      await input.focus()
      await input.fill('   ')
      await expect(join).toBeDisabled()
      // Exercise the feature guard even for a synthetic submit on a disabled form.
      await input.evaluate(element => element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(new URL(page.url()).pathname).toBe('/join')
      expect(requests).toEqual([])
      await capture('whitespace-disabled')
      await input.fill(' abc123 ')
      await expect(input).toHaveValue(' ABC123 ')
      expect(await input.evaluate((element, original) => element === original, originalInput)).toBe(true)
      await input.press('Enter')
      await expect(page).toHaveURL(/\/join\/ABC123$/)
      await expect(page.getByRole('heading', { name: 'We couldn’t complete the join', exact: true })).toBeVisible()
      await capture('actual-destination')
      expect(requests.length).toBeGreaterThanOrEqual(1)
      expect(writes).toEqual(requests.map(request => request.path))
      const unexpectedConsoleErrors = consoleErrors.filter(error => !(error.url && new URL(error.url).pathname === '/api/student/classrooms/join' && error.text.includes('status of 500')))
      expect(errors).toEqual([])
      expect(unexpectedConsoleErrors).toEqual([])
      const receipt = testInfo.outputPath('join-code-receipt.json')
      await writeFile(receipt, JSON.stringify({ viewport, theme: testInfo.project.metadata.theme, motion, inputBounds, buttonBounds, states, requests, writes, persistedWrites: 0, errors, consoleErrors, unexpectedConsoleErrors,
        limits: 'Actual public entry and unchanged destination with intercepted synthetic HTTP500; shared unauthenticated form, role-specific enrollment not proven. Existing destination may request more than once under development StrictMode; all attempts intercepted. No backend/enrollment, production performance or new motion claim.' }, null, 2))
      await testInfo.attach('join-code-receipt', { path: receipt, contentType: 'application/json' })
    } finally {
      await originalInput?.dispose()
    }
  })
}
