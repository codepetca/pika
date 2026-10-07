import { expect, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

type Mode = 'immediate' | 'quiet'
type Command = 'close' | 'escape' | 'backdrop' | 'destination'
interface Frame {
  at: number
  opacity: number
  focusInside: boolean
  isolated: boolean
  overflow: string
  pageY: number
  animations: Array<{ id: number; duration: number | string; easing: string; currentTime: number | null; playState: string }>
}
interface EntryTrace {
  mountedAt: number
  starts: number
  frames: Frame[]
  fast?: { command: Command; before: Frame; followingPaint: { connected: boolean; focusReturned: boolean; isolated: boolean; overflow: string; pageY: number; at: number; inert: boolean; ariaHidden: string | null; ariaModal: string | null; pointerEvents: string } }
  exitFrames?: Array<{ at: number; rootOpacity: number; panelOpacity: number; effectiveOpacity: number }>
  physicallyRemovedAt?: number
}
interface Probe {
  traces: EntryTrace[]
  arm: Command | null
  opener: HTMLElement | null
}
declare global { interface Window { dialogEntryProbe: Probe } }

/** Passive observation only: never changes animation timing, media, opacity or identity. */
export async function installDialogEntryProbe(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = { traces: [], arm: null, opener: null }
    window.dialogEntryProbe = probe
    const seen = new WeakSet<Element>()
    const animationIds = new WeakMap<Animation, number>()
    let nextAnimationId = 0
    function snapshot(panel: HTMLElement): Frame {
      const fixture = document.querySelector('[data-testid="dialog-entry-pattern"]')
      return {
        at: performance.now(), opacity: Number(getComputedStyle(panel).opacity),
        focusInside: panel.contains(document.activeElement),
        isolated: Boolean(fixture?.closest('[inert]')),
        overflow: document.body.style.overflow, pageY: window.scrollY,
        animations: panel.getAnimations().map((animation) => {
          if (!animationIds.has(animation)) animationIds.set(animation, ++nextAnimationId)
          const timing = animation.effect!.getTiming()
          return { id: animationIds.get(animation)!, duration: typeof timing.duration === 'number' ? timing.duration : String(timing.duration), easing: getComputedStyle(panel).animationTimingFunction,
            currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
            playState: animation.playState }
        }),
      }
    }
    function scan() {
      const panel = document.querySelector('[data-testid="dialog-entry-body"]')?.closest<HTMLElement>('[role="dialog"]')
      if (!panel || seen.has(panel)) return
      seen.add(panel)
      const trace: EntryTrace = { mountedAt: performance.now(), starts: 0, frames: [] }
      probe.traces.push(trace)
      panel.addEventListener('animationstart', (event) => { if (event.target === panel) trace.starts += 1 })
      const command = probe.arm
      probe.arm = null
      requestAnimationFrame(function frame() {
        if (!panel!.isConnected) return
        const sample = snapshot(panel!)
        trace.frames.push(sample)
        if (command && !trace.fast) {
          // Synthetic timing checks run in the first actual frame, independent of protocol latency.
          const before = sample
          if (command === 'escape') {
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          } else if (command === 'backdrop') {
            panel!.parentElement!.querySelector<HTMLButtonElement>(':scope > button[aria-label="Close dialog"]')!.click()
          } else if (command === 'close') {
            panel!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click()
          } else {
            Array.from(panel!.querySelectorAll('button')).find((button) => button.textContent === 'Select fixture destination')!.click()
          }
          trace.fast = { command, before, followingPaint: { connected: true, focusReturned: false, isolated: true, overflow: '', pageY: 0, at: 0, inert: false, ariaHidden: null, ariaModal: 'true', pointerEvents: '' } }
          const root = panel!.parentElement!
          trace.exitFrames = []
          requestAnimationFrame(function observeExit() {
            const at = performance.now()
            if (trace.fast!.followingPaint.at === 0) {
              trace.fast!.followingPaint = {
                connected: panel!.isConnected, focusReturned: document.activeElement === probe.opener,
                isolated: Boolean(document.querySelector('[data-testid="dialog-entry-pattern"]')?.closest('[inert]')),
                overflow: document.body.style.overflow, pageY: window.scrollY, at,
                inert: root.inert, ariaHidden: root.getAttribute('aria-hidden'),
                ariaModal: panel!.getAttribute('aria-modal'), pointerEvents: getComputedStyle(root).pointerEvents,
              }
            }
            if (!panel!.isConnected) {
              trace.physicallyRemovedAt = at
              return
            }
            const rootOpacity = Number(getComputedStyle(root).opacity)
            const panelOpacity = Number(getComputedStyle(panel!).opacity)
            trace.exitFrames!.push({ at, rootOpacity, panelOpacity, effectiveOpacity: rootOpacity * panelOpacity })
            if (at - before.at < 600) requestAnimationFrame(observeExit)
          })
          return
        }
        if (sample.at - trace.mountedAt < 350) requestAnimationFrame(frame)
      })
    }
    new MutationObserver(scan).observe(document, { childList: true, subtree: true })
  })
}

export async function captureDialogEntry(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'allow', caret: 'initial' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

export async function openEntry(page: Page, mode: Mode) {
  const opener = page.getByTestId('dialog-entry-pattern').getByRole('button', { name: `Open ${mode} dialog entry`, exact: true })
  await expect(opener).toHaveAccessibleName(`Open ${mode} dialog entry`)
  await opener.focus()
  await opener.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Dialog entry preview', exact: true })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  return { opener, dialog }
}

async function environment(page: Page) {
  return page.evaluate(() => ({ overflow: document.body.style.overflow, pageY: window.scrollY }))
}

async function assertRestored(page: Page, original: { overflow: string; pageY: number }) {
  expect(await environment(page)).toEqual(original)
  expect(await page.getByTestId('dialog-entry-pattern').evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false)
}

export async function verifyDialogEntry(page: Page, testInfo: TestInfo, role: 'teacher' | 'student', motion: 'no-preference' | 'reduce') {
  const errors: string[] = []
  const consoleErrors: string[] = []
  const apiRequests: string[] = []
  const writes: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(`${request.method()} ${request.url()}`)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`)
  })
  await page.emulateMedia({ reducedMotion: motion })
  await installDialogEntryProbe(page)
  const response = await page.goto(`/pattern-lab?role=${role}`, { waitUntil: 'networkidle' })
  expect(response?.status()).toBe(200)
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('html')).toHaveClass(testInfo.project.metadata.theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  await page.getByTestId('dialog-entry-pattern').scrollIntoViewIfNeeded()
  const viewport = page.viewportSize()!
  expect(viewport).toEqual(testInfo.project.metadata.viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 })
  const original = await environment(page)
  let retainedDraft = 'Explain how the example supports your conclusion.'
  const stateEvidence: unknown[] = []
  try {
    for (const mode of ['immediate', 'quiet'] as const) {
      const { opener, dialog } = await openEntry(page, mode)
      const input = dialog.getByRole('textbox', { name: 'Dialog entry draft', exact: true })
      const node = await input.elementHandle()
      const panel = await dialog.elementHandle()
      const scroller = dialog.getByTestId('dialog-entry-body').locator('..')
      await expect(input).toHaveValue(retainedDraft)
      const bounds = (await dialog.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1)
      await captureDialogEntry(page, testInfo, `${mode}-open`)
      await input.focus()
      // macOS End scrolls the reading container; position the caret without that command.
      await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(element.value.length, element.value.length))
      await page.keyboard.type(` ${mode} local draft`)
      retainedDraft += ` ${mode} local draft`
      await expect(input).toHaveValue(retainedDraft)
      await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(2, 8))
      const initialAnimations = await dialog.evaluateHandle((element) => element.getAnimations())
      const initialAnimationTimes = await initialAnimations.evaluate((animations) => animations.map((animation) => animation.currentTime))
      const starts = await page.evaluate(() => window.dialogEntryProbe.traces.at(-1)!.starts)
      const revision = Number((await dialog.getByTestId('dialog-entry-metadata').textContent())!.split(': ')[1])
      // Native click invokes the real local callback without changing focused input or scrolling it into view.
      await dialog.getByRole('button', { name: 'Refresh dialog entry metadata' }).evaluate((element: HTMLButtonElement) => element.click())
      await expect(dialog.getByTestId('dialog-entry-metadata')).toHaveText(`Metadata revision: ${revision + 1}`)
      expect(await input.evaluate((element, originalNode) => element === originalNode, node)).toBe(true)
      expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 8])
      await expect(input).toBeFocused()
      expect(await dialog.evaluate((element, originalPanel) => element === originalPanel, panel)).toBe(true)
      expect(await page.evaluate(() => window.dialogEntryProbe.traces.at(-1)!.starts)).toBe(starts)
      const animationState = await dialog.evaluate((element, originalAnimations) => {
        const animations = element.getAnimations()
        return {
          same: animations.length === originalAnimations.length && animations.every((animation, index) => animation === originalAnimations[index]),
          times: animations.map((animation) => animation.currentTime),
        }
      }, initialAnimations)
      expect(animationState.same).toBe(true)
      for (const [index, before] of initialAnimationTimes.entries()) {
        if (typeof before === 'number') expect(animationState.times[index]).toBeGreaterThanOrEqual(before)
      }
      await initialAnimations.dispose()
      // Leave editing through real keyboard navigation before reading farther down.
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Refresh dialog entry metadata' })).toBeFocused()
      await scroller.evaluate((element) => { element.scrollTop = 180 })
      await scroller.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const scrollTop = await scroller.evaluate((element) => element.scrollTop)
      expect(scrollTop).toBeGreaterThan(0)
      await dialog.getByRole('button', { name: 'Refresh dialog entry metadata' }).evaluate((element: HTMLButtonElement) => element.click())
      await expect(dialog.getByTestId('dialog-entry-metadata')).toHaveText(`Metadata revision: ${revision + 2}`)
      expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollTop)
      expect(await input.evaluate((element, originalNode) => element === originalNode, node)).toBe(true)
      expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 8])
      expect((await environment(page)).pageY).toBe(original.pageY)
      await captureDialogEntry(page, testInfo, `${mode}-draft-scroll`)
      const nestedOpener = dialog.getByRole('button', { name: 'Open dialog entry confirmation' })
      await nestedOpener.focus()
      await nestedOpener.press('Enter')
      const nested = page.getByRole('dialog', { name: 'Dialog entry nested confirmation', exact: true })
      await expect(nested.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
      // The canonical owner hides the parent from the accessibility tree while nested.
      expect(await panel!.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true)
      await captureDialogEntry(page, testInfo, `${mode}-nested`)
      await page.keyboard.press('Escape')
      await expect(nested).toHaveCount(0)
      await expect(nestedOpener).toBeFocused()
      await expect(dialog).toBeVisible()
      expect(await dialog.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false)
      expect(await page.getByTestId('dialog-entry-pattern').evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true)
      expect((await environment(page)).overflow).toBe('hidden')
      const first = dialog.getByRole('button', { name: 'Close', exact: true })
      const last = dialog.getByRole('button', { name: 'Select fixture destination', exact: true })
      await last.focus()
      await page.keyboard.press('Tab')
      await expect(first).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(last).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      await assertRestored(page, original)
      // Logical close is already asserted above; retained presentation must then physically leave.
      await expect.poll(() => node!.evaluate((element) => element.isConnected), { timeout: 2_000 }).toBe(false)
      await openEntry(page, mode)
      const reopenedPanel = await dialog.elementHandle()
      await expect(input).toHaveValue(retainedDraft)
      expect(await input.evaluate((element, originalNode) => element === originalNode, node)).toBe(false)
      await captureDialogEntry(page, testInfo, `${mode}-reopen`)
      if (mode === 'quiet' && motion === 'no-preference') {
        // Observe the natural end state; first-frame command checks below have no completion wait.
        await page.waitForFunction(() => window.dialogEntryProbe.traces.at(-1)?.frames.some((frame) => frame.opacity === 1), undefined, { timeout: 2_000, polling: 'raf' })
      }
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      await assertRestored(page, original)
      await expect.poll(() => reopenedPanel!.evaluate((element) => element.isConnected), { timeout: 2_000 }).toBe(false)
      await reopenedPanel!.dispose()
      stateEvidence.push({ mode, scrollTop, retainedDraft, originalNodeDisconnectedOnClose: true, newNodeOnReopen: true })
    }
    const natural = await page.evaluate(() => window.dialogEntryProbe.traces)
    for (const [index, mode] of ['immediate', 'immediate', 'quiet', 'quiet'].entries()) {
      const trace = natural[index]
      const first = trace.frames[0]
      expect(first.focusInside).toBe(true)
      expect(first.isolated).toBe(true)
      expect(first.overflow).toBe('hidden')
      if (mode === 'quiet' && motion === 'no-preference') {
        expect(first.animations).toHaveLength(1)
        expect(first.animations[0]).toMatchObject({ duration: 200, easing: 'ease-out', playState: 'running' })
        expect(first.animations[0].currentTime).toBeLessThan(200)
        expect(first.opacity).toBeLessThan(1)
        expect(trace.frames.at(-1)!.opacity).toBe(1)
        expect(trace.starts).toBe(1)
        expect(new Set(trace.frames.flatMap((frame) => frame.animations.map((animation) => animation.id))).size).toBe(1)
      } else {
        expect(first.animations).toEqual([])
        expect(first.opacity).toBe(1)
        expect(trace.starts).toBe(0)
      }
    }
    for (const mode of ['immediate', 'quiet'] as const) {
      for (const command of ['close', 'escape', 'backdrop', 'destination'] as const) {
        const opener = page.getByTestId('dialog-entry-pattern').getByRole('button', { name: `Open ${mode} dialog entry`, exact: true })
        await opener.evaluate((element: HTMLButtonElement, command) => {
          window.dialogEntryProbe.arm = command
          window.dialogEntryProbe.opener = element
          element.focus()
          element.click()
        }, command)
        await page.waitForFunction(() => window.dialogEntryProbe.traces.at(-1)?.fast?.followingPaint.at, undefined, { timeout: 2_000, polling: 'raf' })
        const fast = await page.evaluate(() => window.dialogEntryProbe.traces.at(-1)!.fast!)
        expect(fast.before.focusInside).toBe(true)
        expect(fast.before.isolated).toBe(true)
        if (mode === 'quiet' && motion === 'no-preference') {
          expect(fast.before.animations[0]).toMatchObject({ playState: 'running', duration: 200 })
          expect(fast.before.animations[0].currentTime).toBeLessThan(200)
        } else expect(fast.before.animations).toEqual([])
        expect(fast.followingPaint).toMatchObject({ focusReturned: true, isolated: false, overflow: original.overflow, pageY: original.pageY })
        if (mode === 'quiet' && motion === 'no-preference') {
          // A late browser frame may land after the real duration; never invent an intermediate frame.
          if (fast.followingPaint.at - fast.before.at < 200) {
            expect(fast.followingPaint).toMatchObject({ connected: true, inert: true, ariaHidden: 'true', ariaModal: null, pointerEvents: 'none' })
          }
          await page.waitForFunction(() => window.dialogEntryProbe.traces.at(-1)?.physicallyRemovedAt, undefined, { timeout: 2_000, polling: 'raf' })
          const finished = await page.evaluate(() => window.dialogEntryProbe.traces.at(-1)!)
          expect(finished.exitFrames!.some((frame) => frame.rootOpacity > 0 && frame.rootOpacity < 1)).toBe(true)
          for (let index = 1; index < finished.exitFrames!.length; index += 1) {
            expect(finished.exitFrames![index].effectiveOpacity).toBeLessThanOrEqual(finished.exitFrames![index - 1].effectiveOpacity + 0.01)
          }
          expect(finished.physicallyRemovedAt! - fast.before.at).toBeGreaterThanOrEqual(190)
        } else {
          expect(fast.followingPaint.connected).toBe(false)
        }
        if (command === 'destination') await expect(page.getByTestId('dialog-entry-destination')).toHaveText(`Fixture destination selected: ${role === 'teacher' ? 'Teacher dashboard' : 'Student history'}`)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    expect(apiRequests).toEqual([])
    expect(writes).toEqual([])
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
  } finally {
    const receipt = { role, motion, project: testInfo.project.name, viewport, scope: 'development-only shared ContentDialog/ModalLayer entry and explicit opacity-exit presentations; no authenticated route, backend or production performance claim', commands: 'Synthetic real-handler command checks at first rAF; immediate logical close and natural physical exit sampled on subsequent frames', stateEvidence, apiRequests, writes, errors, consoleErrors, traces: await page.evaluate(() => window.dialogEntryProbe.traces) }
    const path = testInfo.outputPath('dialog-entry-receipt.json')
    await writeFile(path, JSON.stringify(receipt, null, 2))
    await testInfo.attach('dialog-entry-receipt', { path, contentType: 'application/json' })
  }
}
