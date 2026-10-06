import { expect, type Locator, type Page } from '@playwright/test'

export interface MobileDrawerVerificationOptions {
  role: 'teacher' | 'student'
  reducedMotion: 'reduce' | 'no-preference'
  theme: 'light' | 'dark'
  /** Optional absolute URL for a standalone runner. */
  baseURL?: string
  capture?: (name: string, image: Buffer) => Promise<void>
}

/** Local Pattern Lab evidence for actual owners, not a student production detail route. */
export async function verifyMobileDrawerControls(page: Page, options: MobileDrawerVerificationOptions) {
  const pageErrors: string[] = []
  const writes: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`)
  })
  await page.emulateMedia({ reducedMotion: options.reducedMotion, colorScheme: options.theme })
  await page.goto(`${options.baseURL ?? ''}/pattern-lab?role=${options.role}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('html')).toHaveClass(options.theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  const fixture = page.getByTestId('mobile-drawer-controls')
  const navigationOpener = fixture.getByRole('button', { name: 'Open example navigation drawer', exact: true })
  const detailOpener = fixture.getByRole('button', { name: 'Open example detail drawer', exact: true })
  const draft = fixture.getByRole('textbox', { name: 'Drawer example draft', exact: true })
  const capture = async (name: string) => {
    if (options.capture) await options.capture(name, await page.screenshot({ animations: 'allow', caret: 'initial' }))
  }

  // Every project checks desktop guards and the actual mobile interaction contract.
  await page.setViewportSize({ width: 1440, height: 900 })
  await fixture.scrollIntoViewIfNeeded()
  await expect(navigationOpener).toBeHidden()
  await expect(detailOpener).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Navigation menu', exact: true })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Drawer example details', exact: true })).toHaveCount(0)
  await capture('desktop-closed')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(navigationOpener).toBeVisible()
  await expect(detailOpener).toBeVisible()
  await draft.fill(`Preserve ${options.role} drawer draft and selection`)
  const originalDraft = await draft.elementHandle()
  expect(originalDraft).not.toBeNull()
  await draft.evaluate((element: HTMLInputElement) => element.setSelectionRange(9, 22))
  const preservedDraft = await draft.inputValue()
  let preservedDraftScroll: number[] = []
  const originalOverflow = await page.evaluate(() => document.body.style.overflow)
  // Keep DOM identities in the page, rather than serializing nodes across the protocol.
  await page.evaluate(() => {
    const state = Array.from(document.body.children).map((element) => ({ element, inert: (element as HTMLElement).inert, hidden: element.getAttribute('aria-hidden') }))
    ;(window as Window & { drawerOriginalEnvironment?: typeof state }).drawerOriginalEnvironment = state
  })

  const expectRestored = async (opener?: Locator) => {
    if (opener) await expect(opener).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(originalOverflow)
    expect(await page.evaluate(() => {
      const state = (window as Window & { drawerOriginalEnvironment?: { element: Element; inert: boolean; hidden: string | null }[] }).drawerOriginalEnvironment!
      return state.every(({ element, inert, hidden }) => element.isConnected && (element as HTMLElement).inert === inert && element.getAttribute('aria-hidden') === hidden)
    })).toBe(true)
    expect(await originalDraft!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await draft.evaluate((element, original) => element === original, originalDraft)).toBe(true)
    await expect(draft).toHaveValue(preservedDraft)
    expect(await draft.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([9, 22])
    if (opener) expect(await draft.evaluate((element) => [element.scrollLeft, element.scrollTop])).toEqual(preservedDraftScroll)
  }
  const assertImmediateClose = async (dialog: Locator, opener: Locator, scrollY: number) => {
    // One paint boundary catches retained exit-animation dialogs without a polling allowance.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    expect(await dialog.count()).toBe(0)
    await expectRestored(opener)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  }
  const open = async (opener: Locator, label: string, controlLabel: string) => {
    await opener.scrollIntoViewIfNeeded()
    await opener.focus()
    preservedDraftScroll = await draft.evaluate((element) => [element.scrollLeft, element.scrollTop])
    const scrollY = await page.evaluate(() => window.scrollY)
    await opener.press('Enter')
    const dialog = page.getByRole('dialog', { name: label, exact: true })
    await expect(dialog).toBeVisible()
    const control = dialog.getByRole('button', { name: controlLabel, exact: true })
    await expect(control).toBeFocused()
    const bounds = await control.boundingBox()
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(await control.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
    expect(await control.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    expect(await fixture.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true)
    await originalDraft!.evaluate((element: HTMLInputElement) => element.focus())
    await expect(control).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await control.focus()
    return { dialog, control, scrollY }
  }

  const exercise = async (kind: 'navigation' | 'detail', minimal = false) => {
    const opener = kind === 'navigation' ? navigationOpener : detailOpener
    const label = kind === 'navigation' ? 'Navigation menu' : 'Drawer example details'
    const controlLabel = kind === 'navigation' ? 'Close navigation' : 'Back'
    const name = minimal ? 'detail-minimal' : kind
    let opened = await open(opener, label, controlLabel)
    if (kind === 'detail') {
      await expect(opened.dialog.getByText('Drawer example details', { exact: true })).toHaveCount(minimal ? 0 : 1)
      await expect(opened.dialog.getByText(`Fixed ${options.role} detail content.`, { exact: true })).toBeVisible()
    } else {
      await expect(opened.dialog.getByText(`${options.role === 'teacher' ? 'Teacher' : 'Student'} navigation fixture`, { exact: true })).toBeVisible()
    }
    await capture(`${name}-initial-focus`)
    await opened.control.hover()
    await expect(page.getByRole('tooltip', { name: controlLabel, exact: true })).toBeVisible()
    await capture(`${name}-hover-tooltip`)
    await page.keyboard.press('Escape')
    await assertImmediateClose(opened.dialog, opener, opened.scrollY)
    await expect(page.getByRole('tooltip', { name: controlLabel, exact: true })).toHaveCount(0)

    opened = await open(opener, label, controlLabel)
    await opened.control.click()
    await assertImmediateClose(opened.dialog, opener, opened.scrollY)
    opened = await open(opener, label, controlLabel)
    await opened.control.press('Enter')
    await assertImmediateClose(opened.dialog, opener, opened.scrollY)

    // At 390px detail fills the viewport. At 768px its exposed scrim is clickable.
    if (kind === 'detail') await page.setViewportSize({ width: 768, height: 844 })
    opened = await open(opener, label, controlLabel)
    const layer = opened.dialog.locator('..')
    const backdrop = layer.getByRole('button', { name: kind === 'navigation' ? 'Close navigation' : 'Close panel', exact: true }).filter({ hasNot: page.locator('svg') })
    const bounds = await opened.dialog.boundingBox()
    const viewport = page.viewportSize()!
    await page.mouse.click(kind === 'navigation' ? bounds!.x + bounds!.width + 12 : bounds!.x - 12, viewport.height / 2)
    await expect(backdrop).toHaveCount(0)
    await assertImmediateClose(opened.dialog, opener, opened.scrollY)
    await page.setViewportSize({ width: 390, height: 844 })

    opened = await open(opener, label, controlLabel)
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(opened.dialog).toHaveCount(0)
    await expectRestored()
    await expect(opener).toBeHidden()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(opened.dialog).toHaveCount(0)
  }
  await fixture.getByRole('button', { name: 'Block drawer home navigation', exact: true }).click()
  const blocked = await open(navigationOpener, 'Navigation menu', 'Close navigation')
  const originalURL = page.url()
  await blocked.dialog.getByRole('link', { name: 'All classrooms', exact: true }).click()
  await expect(blocked.dialog).toBeVisible()
  expect(page.url()).toBe(originalURL)
  await page.keyboard.press('Escape')
  await assertImmediateClose(blocked.dialog, navigationOpener, blocked.scrollY)
  await exercise('navigation')
  await exercise('detail')
  await fixture.getByRole('button', { name: 'Minimal drawer header', exact: true }).click()
  await exercise('detail', true)
  await capture('mobile-closed-draft-preserved')
  expect(pageErrors, 'Unexpected browser errors').toEqual([])
  expect(writes, 'Pattern Lab must not send write requests').toEqual([])
  await originalDraft!.dispose()
  return { pageErrors, writes }
}
