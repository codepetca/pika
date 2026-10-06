import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

interface ThemeChange { old: string | null; next: string | null; time: number }
interface ThemeProbe { changes: ThemeChange[] }
type ProbeWindow = Window & { __pikaThemeProbe: ThemeProbe }

test.use({ video: 'on', trace: 'retain-on-failure' })
test.setTimeout(90_000)

async function observeInitialization(page: Page, theme: 'light' | 'dark', stored?: 'light' | 'dark') {
  await page.addInitScript(preference => {
    if (preference) localStorage.setItem('theme', preference)
    const probe = { changes: [] as ThemeChange[] }
    ;(window as unknown as ProbeWindow).__pikaThemeProbe = probe
    new MutationObserver(records => {
      const root = document.documentElement
      const changes = records.filter(record => record.target === root && record.attributeName === 'class')
      changes.forEach((record, index) => probe.changes.push({ old: record.oldValue,
        next: index + 1 < changes.length ? changes[index + 1].oldValue : root.getAttribute('class'), time: performance.now() }))
    }).observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] })
  }, stored)
  return async () => {
    const probe = await page.evaluate(() => (window as unknown as ProbeWindow).__pikaThemeProbe)
    // Dark must be applied; an already-light root can require no class mutation.
    if (theme === 'dark') expect(probe.changes.length).toBeGreaterThan(0)
    expect(probe.changes.every(change => (change.next?.split(' ').includes('dark') ?? false) === (theme === 'dark'))).toBe(true)
    expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(theme === 'dark')
    expect(await page.locator('html').evaluate(element => getComputedStyle(element).colorScheme)).toBe(theme)
    return probe
  }
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'allow', caret: 'initial' })
  await info.attach(name, { path, contentType: 'image/png' })
}

for (const role of ['public', 'teacher', 'student'] as const) for (const motion of ['no-preference', 'reduce'] as const) {
  test(`${role} ${motion} theme hydration and retained input`, async ({ page }, info) => {
    const theme = info.project.metadata.theme as 'light' | 'dark'
    const errors: string[] = [], consoleErrors: string[] = [], apiRequests: string[] = [], writes: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname) })
    await page.route('**/api/**', async route => { apiRequests.push(new URL(route.request().url()).pathname); await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Unexpected test API request"}' }) })
    await page.emulateMedia({ reducedMotion: motion })
    const checkInitialization = await observeInitialization(page, theme)
    expect((await page.goto(role === 'public' ? '/join' : `/pattern-lab?role=${role}`, { waitUntil: 'networkidle' }))?.status()).toBe(200)
    await page.evaluate(() => document.fonts.ready)
    const initialProbe = await checkInitialization()
    await capture(page, info, 'initialized-theme')
    const input = page.getByRole('textbox', { name: role === 'public' ? 'Join code' : 'Class name', exact: role === 'public' })
    const original = await input.elementHandle()
    try {
      await input.fill('kept draft')
      const expected = role === 'public' ? 'KEPT DRAFT' : 'kept draft'
      await expect(input).toHaveValue(expected)
      await input.focus()
      await input.evaluate(element => (element as HTMLInputElement).setSelectionRange(2, 4))
      await expect(input).toBeFocused()
      await capture(page, info, 'retained-draft')
      if (role !== 'public') {
        const toggle = page.getByRole('button', { name: theme === 'dark' ? 'Use light theme' : 'Use dark theme', exact: true })
        await toggle.click()
        await expect(page.locator('html')).toHaveClass(theme === 'light' ? /dark/ : /^(?!.*\bdark\b).*$/)
        expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(theme === 'dark' ? 'light' : 'dark')
        expect(await input.evaluate((element, node) => element === node, original)).toBe(true)
        await expect(input).toHaveValue(expected)
        expect(await input.evaluate(element => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd])).toEqual([2, 4])
        await expect(page.getByRole('button', { name: theme === 'dark' ? 'Use dark theme' : 'Use light theme', exact: true })).toBeFocused()
        await capture(page, info, 'manual-theme')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(errors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(apiRequests).toEqual([])
      expect(writes).toEqual([])
      const path = info.outputPath('theme-receipt.json')
      await writeFile(path, JSON.stringify({ role, viewport: page.viewportSize(), theme, motion, initialProbe, errors, consoleErrors, apiRequests, writes,
        retainedInput: true, retainedDraft: expected, manualToggle: role !== 'public',
        limits: 'Public join and real production owners in deterministic teacher/student Pattern Lab references; no authenticated workflow/enrollment/backend or production paint/INP proof.' }, null, 2))
      await info.attach('theme-receipt', { path, contentType: 'application/json' })
    } finally { await original?.dispose() }
  })
}

for (const stored of ['light', 'dark'] as const) {
  test(`stored ${stored} theme takes precedence over system scheme`, async ({ page }, info) => {
    const errors: string[] = [], consoleErrors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    const check = await observeInitialization(page, stored, stored)
    expect((await page.goto('/join', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    const initialProbe = await check()
    await expect(page.getByRole('textbox', { name: 'Join code', exact: true })).toBeVisible()
    await capture(page, info, 'stored-preference')
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    const path = info.outputPath('theme-receipt.json')
    await writeFile(path, JSON.stringify({ role: 'public-stored', viewport: page.viewportSize(), theme: stored, systemTheme: info.project.metadata.theme, motion: 'no-preference', initialProbe, errors, consoleErrors,
      limits: 'Stored-preference actual public entry; no enrollment/backend/production performance proof.' }, null, 2))
    await info.attach('theme-receipt', { path, contentType: 'application/json' })
  })
}
