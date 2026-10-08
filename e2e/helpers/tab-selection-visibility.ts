import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

async function selectedBounds(list: Locator) {
  return list.evaluate((element) => {
    const selected = element.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!selected) throw new Error('No selected tab')
    const container = element.getBoundingClientRect()
    const tab = selected.getBoundingClientRect()
    return {
      left: tab.left - container.left - element.clientLeft,
      right: tab.right - container.left - element.clientLeft,
      width: element.clientWidth,
      scroll: element.scrollLeft,
    }
  })
}

async function expectSelectedVisible(list: Locator) {
  await expect.poll(async () => {
    const bounds = await selectedBounds(list)
    return bounds.left >= -1 && bounds.right <= bounds.width + 1
  }).toBe(true)
}

export async function verifyTabSelectionVisibility(
  page: Page,
  testInfo: TestInfo,
  role: 'teacher' | 'student',
  reducedMotion: 'no-preference' | 'reduce',
) {
  const theme = testInfo.project.metadata.theme
  const pageErrors: string[] = []
  const writes: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(request.url())
      await route.abort()
    } else {
      await route.continue()
    }
  })
  await page.emulateMedia({ reducedMotion })
  await page.addInitScript((selectedTheme) => localStorage.setItem('theme', String(selectedTheme)), theme)
  await page.goto(`/pattern-lab?role=${role}#tab-selection-visibility`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  const measurements = []
  const capture = async (example: Locator, name: string) => {
    await testInfo.attach(name, {
      body: await example.screenshot({ path: testInfo.outputPath(`${name}.png`) }),
      contentType: 'image/png',
    })
  }

  for (const variant of ['underline', 'connected', 'rtl'] as const) {
    const example = page.getByTestId(`visibility-${variant}`)
    const list = example.getByRole('tablist', { name: `${variant} visibility panels` })
    const draft = example.getByRole('textbox', { name: `${variant} retained draft` })
    const settings = list.getByRole('tab', { name: 'Settings', exact: true })
    const overview = list.getByRole('tab', { name: 'Overview', exact: true })
    await example.scrollIntoViewIfNeeded()
    await expect(settings).toHaveAttribute('aria-selected', 'true')
    await expectSelectedVisible(list)
    const mountedBounds = await selectedBounds(list)
    expect(await list.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    await capture(example, `${variant}-mounted-selected`)

    await draft.fill('Unsaved continuity draft')
    const draftHandle = await draft.elementHandle()
    await draft.evaluate((element: HTMLInputElement) => element.setSelectionRange(4, 11))
    const remount = example.getByRole('button', { name: 'Remount tab list' })
    await remount.focus()
    const beforeRemountScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
    await remount.press('Enter')
    await expect(remount).toBeFocused()
    await expectSelectedVisible(list)
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(beforeRemountScroll)
    expect(await draftHandle!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await draft.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([4, 11])
    await expect(draft).toHaveValue('Unsaved continuity draft')
    await capture(example, `${variant}-remounted-selected`)

    const showOverview = example.getByRole('button', { name: 'Show Overview' })
    await showOverview.focus()
    const outerScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
    await showOverview.press('Enter')
    await expect(overview).toHaveAttribute('aria-selected', 'true')
    await expectSelectedVisible(list)
    await expect(showOverview).toBeFocused()
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(outerScroll)
    const showSettings = example.getByRole('button', { name: 'Show Settings' })
    await showSettings.focus()
    await showSettings.press('Enter')
    await expect(settings).toHaveAttribute('aria-selected', 'true')
    await expectSelectedVisible(list)
    await expect(showSettings).toBeFocused()
    const controlledBounds = await selectedBounds(list)
    await capture(example, `${variant}-controlled-selected`)

    // Browsing the list manually is not a new selection. Unrelated editing must
    // leave that scroll position, input DOM, focus and caret with the user.
    await list.evaluate((element) => { element.scrollLeft = 0 })
    const manuallyScrolled = await list.evaluate((element) => element.scrollLeft)
    await draft.focus()
    await draft.press('!')
    await expect(draft).toHaveValue('Unsa!tinuity draft')
    expect(await draft.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([5, 5])
    await expect(draft).toBeFocused()
    expect(await list.evaluate((element) => element.scrollLeft)).toBe(manuallyScrolled)
    expect(await draftHandle!.evaluate((element) => element.isConnected)).toBe(true)

    const narrow = example.getByRole('button', { name: 'Narrow tab list' })
    await narrow.focus()
    const beforeResizeScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
    await narrow.press('Enter')
    await expectSelectedVisible(list)
    await expect(example.getByRole('button', { name: 'Widen tab list' })).toBeFocused()
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(beforeResizeScroll)
    await capture(example, `${variant}-resized-selected`)

    await settings.focus()
    await settings.press('Home')
    await expect(overview).toBeFocused()
    await expect(overview).toHaveAttribute('aria-selected', 'true')
    await expectSelectedVisible(list)
    await overview.press('End')
    await expect(settings).toBeFocused()
    await expect(settings).toHaveAttribute('aria-selected', 'true')
    await expectSelectedVisible(list)
    await expect(example.getByRole('tabpanel', { name: 'Settings', exact: true })).toBeVisible()
    await expect(settings).toHaveAttribute('aria-controls', `visibility-${variant}-settings-panel`)
    await capture(example, `${variant}-keyboard-selected`)
    measurements.push({ variant, mountedBounds, controlledBounds, resizedBounds: await selectedBounds(list), manuallyScrolled })
    await draftHandle!.dispose()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  expect(pageErrors).toEqual([])
  expect(writes).toEqual([])
  await testInfo.attach('tab-selection-visibility-geometry', {
    body: JSON.stringify({ role, theme, reducedMotion, scope: 'canonical production Tabs in deterministic Pattern Lab; not auth or feature data proof', measurements, pageErrors, writes }),
    contentType: 'application/json',
  })
}
