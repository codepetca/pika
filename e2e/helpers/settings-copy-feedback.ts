import { expect, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

export async function verifySettingsCopyFeedback(page: Page, testInfo: TestInfo, motion: 'no-preference' | 'reduce') {
  const theme = testInfo.project.metadata.theme as string
  const viewport = testInfo.project.metadata.viewport as string
  const writes: string[] = []
  await page.route('**/api/**', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) writes.push(new URL(route.request().url()).pathname)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.addInitScript(({ theme }) => {
    localStorage.setItem('pika-theme', theme)
    const probe = {
      mode: 'reject', values: [] as string[],
      pending: [] as Array<{ resolve: () => void; reject: () => void }>,
      install() {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => {
          probe.values.push(text)
          if (probe.mode === 'throw') throw new Error('Controlled synchronous denial')
          if (probe.mode === 'resolve') return Promise.resolve()
          if (probe.mode === 'defer') return new Promise<void>((resolve, reject) => probe.pending.push({ resolve, reject: () => reject(new Error('Controlled denied')) }))
          return Promise.reject(new Error('Controlled denied'))
        } } })
      },
    }
    Object.assign(window, { settingsCopyProbe: probe })
    probe.install()
  }, { theme })
  await page.emulateMedia({ reducedMotion: motion, colorScheme: theme === 'dark' ? 'dark' : 'light' })
  async function load() {
    expect((await page.goto('/e2e-fixtures/teacher-classroom-access?copyOwner=true', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
    expect(await page.locator('html').evaluate(e => e.classList.contains('dark'))).toBe(theme === 'dark')
    expect(page.viewportSize()).toEqual(viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
  }
  async function mode(value: string) {
    await page.evaluate(value => { (window as any).settingsCopyProbe.mode = value }, value)
  }
  async function capture(name: string) {
    const path = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path, animations: 'allow' })
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  async function settle(outcome: 'resolve' | 'reject') {
    await page.evaluate(outcome => { (window as any).settingsCopyProbe.pending.shift()[outcome]() }, outcome)
  }
  const code = page.getByRole('button', { name: 'Copy join code ICS3U2' })
  const link = page.getByRole('button', { name: 'Copy link', exact: true })
  const status = page.getByRole('status')
  const showQr = page.getByRole('button', { name: 'Show QR' })
  const dialog = page.getByRole('dialog', { name: 'Join this classroom' })
  await load()
  await code.focus()
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Join code not copied')
  await expect(code).toBeFocused()
  await expect(page.getByTestId('app-message-pill')).toHaveClass(/text-warning/)
  expect(await status.evaluate(e => e.closest('[inert], [aria-hidden="true"]') === null)).toBe(true)
  expect(await status.evaluate(e => { const text = e.querySelector('span')!; return text.scrollWidth <= text.clientWidth })).toBe(true)
  await capture('code-warning-focus')
  await mode('resolve')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Join code copied')
  await capture('code-success')
  await mode('reject')
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Join link not copied')
  await expect(link).toBeFocused()
  await capture('link-warning-focus')
  await mode('resolve')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Join link copied')
  await showQr.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  const qrCopy = dialog.getByRole('button', { name: 'Copy link' })
  await mode('reject')
  await qrCopy.focus()
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Join link not copied')
  expect(await status.evaluate(e => e.closest('[inert], [aria-hidden="true"]') === null)).toBe(true)
  await expect(qrCopy).toBeFocused()
  await capture('qr-warning-focus')
  await mode('resolve')
  await page.keyboard.press('Enter')
  await expect(status).toHaveText('Join link copied')
  await capture('qr-success')
  expect(await dialog.evaluate(e => getComputedStyle(e).getPropertyValue('--motion-duration-standard').trim())).toBe(motion === 'reduce' ? '0ms' : '200ms')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(showQr).toBeFocused()
  await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0, { timeout: 1000 })
  await showQr.click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(2, 2)
  await expect(dialog).toBeHidden()
  await expect(showQr).toBeFocused()
  await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0, { timeout: 1000 })
  const values = await page.evaluate(() => (window as any).settingsCopyProbe.values)
  const origin = new URL(page.url()).origin
  expect(values).toEqual(['ICS3U2', 'ICS3U2', ...Array(4).fill(`${origin}/join/ICS3U2`)])

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
  await code.click()
  await expect(status).toHaveText('Join code not copied')
  await capture('clipboard-unavailable')
  await page.evaluate(() => (window as any).settingsCopyProbe.install())

  await mode('defer')
  await code.click()
  await expect(status).toHaveCount(0)
  await mode('reject')
  await link.click()
  await expect(status).toHaveText('Join link not copied')
  await settle('resolve')
  await expect(status).toHaveText('Join link not copied')

  // Refresh the same classroom while a copy is pending; its committed owner survives.
  await mode('defer')
  await code.click()
  await page.getByRole('button', { name: 'Refresh copy owner' }).click()
  await settle('resolve')
  await expect(status).toHaveText('Join code copied')

  for (const outcome of ['resolve', 'reject'] as const) {
    await load()
    await mode('defer')
    await code.click()
    await page.getByRole('button', { name: 'Replace copy owner' }).click()
    await expect(page.getByRole('button', { name: 'Copy join code CHEM12' })).toBeVisible()
    await settle(outcome)
    await expect(status).toHaveCount(0)
    await capture(`replacement-${outcome}`)
  }
  for (const outcome of ['resolve', 'reject'] as const) {
    await load()
    await mode('defer')
    await code.click()
    await page.getByRole('button', { name: 'Retire copy owner' }).click()
    await settle(outcome)
    await expect(status).toHaveCount(0)
  }
  await load()
  await mode('resolve')
  await code.click()
  await expect(status).toHaveText('Join code copied')
  await page.getByRole('button', { name: 'Replace copy owner' }).click()
  await expect(status).toHaveCount(0)
  for (const outcome of ['resolve', 'reject'] as const) {
    await load()
    await showQr.click()
    await mode('defer')
    await qrCopy.click()
    await expect(status).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(showQr).toBeFocused()
    await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0)
    await showQr.click()
    await expect(dialog).toBeVisible()
    await settle(outcome)
    await expect(status).toHaveCount(0)
    await capture(`qr-reopened-stale-${outcome}`)
  }
  // Existing notices must not hide synchronous QR failure feedback.
  for (const failure of ['unavailable', 'throw'] as const) {
    await load()
    await mode('resolve')
    await code.click()
    await expect(status).toHaveText('Join code copied')
    await showQr.click()
    await expect(dialog).toBeVisible()
    if (failure === 'unavailable') {
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
    } else await mode('throw')
    await qrCopy.focus()
    await page.keyboard.press('Enter')
    await expect(status).toHaveText('Join link not copied')
    await expect(dialog.getByRole('status')).toHaveText('Join link not copied')
    expect(await status.evaluate(e => e.closest('[inert], [aria-hidden="true"]') === null)).toBe(true)
    await expect(qrCopy).toBeFocused()
    await capture(`qr-existing-notice-${failure}`)
  }
  expect(writes).toEqual([])
  await writeFile(testInfo.outputPath('receipt.json'), JSON.stringify({ theme, viewport, motion, clipboardValues: values, writes, cases: 'three controls/rejection/retry/unavailable/latest/same-owner/replacement/unmount/retire-feedback/QR Escape/backdrop/focus', student: 'n/a teacher-only' }, null, 2))
}
