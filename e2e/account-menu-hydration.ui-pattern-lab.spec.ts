import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockTableShellReads } from './helpers/teacher-student-tables'

async function observeMotion(panel: Locator, page: Page, action: () => Promise<void>, reduced: boolean) {
  const handle = await panel.evaluateHandle(element => {
    const frames: { x: number; y: number; width: number; height: number; opacity: number; animations: number }[] = []
    const observation = { frames, complete: false }
    const initialHidden = element.getAttribute('aria-hidden')
    let changedAt: number | null = null
    const observer = new MutationObserver(() => {
      if (changedAt === null && element.getAttribute('aria-hidden') !== initialHidden) changedAt = performance.now()
    })
    observer.observe(element, { attributes: true, attributeFilter: ['aria-hidden'] })
    const sample = () => {
      const bounds = element.getBoundingClientRect()
      frames.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        opacity: Number(getComputedStyle(element).opacity), animations: element.getAnimations().length })
      // Start the window at the real state change, not before the automation
      // round trip: a slow input delivery must not consume the fade capture.
      if (changedAt === null || performance.now() - changedAt < 250) requestAnimationFrame(sample)
      else { observer.disconnect(); observation.complete = true }
    }
    sample()
    return observation
  })
  await action()
  await expect.poll(() => handle.evaluate(observation => observation.complete)).toBe(true)
  const frames = await handle.evaluate(observation => observation.frames)
  await handle.dispose()
  expect(frames.length).toBeGreaterThan(2)
  for (const frame of frames) for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(frame[key] - frames[0][key])).toBeLessThan(0.5)
  }
  if (reduced) expect(frames.every(frame => frame.animations === 0 && [0, 1].includes(frame.opacity))).toBe(true)
  else expect(frames.some(frame => frame.opacity > 0 && frame.opacity < 1)).toBe(true)
  return frames
}

for (const role of ['teacher', 'student'] as const) {
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`${role} account menu attaches unique hydrated relationships and keyboard focus (${motion})`, async ({ page }, info) => {
      await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
      await page.emulateMedia({ reducedMotion: motion })
      await mockTableShellReads(page, role)
      await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
      const errors: string[] = []
      const consoleErrors: string[] = []
      const writes: string[] = []
      page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.method())
      })
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      const response = await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=assignments`, { waitUntil: 'networkidle' })
      expect(response?.status()).toBe(200)
      const serverId = (await response!.text()).match(/<button[^>]*id="([^"]+)"[^>]*aria-label="User menu"/)?.[1]
      expect(serverId).toBeUndefined()
      const trigger = page.getByRole('button', { name: 'User menu', exact: true })
      await expect(trigger).toHaveAttribute('id', /.+-trigger$/)
      const triggerId = await trigger.getAttribute('id')
      const menuId = await trigger.getAttribute('aria-controls')
      const panel = page.locator(`[id="${menuId}"]`)
      await expect(panel).toHaveAttribute('aria-labelledby', triggerId!)
      await expect(page.getByRole('menu')).toHaveCount(0)
      await trigger.focus()
      const opening = await observeMotion(panel, page, () => page.keyboard.press('ArrowDown'), motion === 'reduce')
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('menuitem').first()).toBeFocused()
      await expect(menu).toHaveCSS('opacity', '1')
      const timing = await panel.evaluate(element => {
        const styles = getComputedStyle(element)
        return { duration: styles.transitionDuration, fast: styles.getPropertyValue('--motion-duration-fast').trim() }
      })
      const milliseconds = (value: string) => parseFloat(value) * (value.endsWith('ms') ? 1 : 1000)
      expect(milliseconds(timing.duration)).toBe(milliseconds(timing.fast))
      await page.screenshot({ path: info.outputPath('account-menu-open.png') })
      const closing = await observeMotion(panel, page, async () => {
        await page.keyboard.press('Escape')
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await expect(panel).toHaveAttribute('inert')
        await expect(panel).toHaveAttribute('aria-hidden', 'true')
        await expect(panel.getByRole('menuitem', { includeHidden: true })).toHaveCount(3)
        expect(await panel.locator('[role="menuitem"]').evaluateAll(items => items.every(item => (item as HTMLElement).tabIndex === -1))).toBe(true)
        await expect(trigger).toBeFocused()
      }, motion === 'reduce')
      await expect(trigger).toBeFocused()
      await expect(trigger).toHaveAttribute('id', triggerId!)
      await expect(page.getByRole('menu')).toHaveCount(0)

      // Reopening during the fade must remain open after the old exit would end.
      await trigger.click()
      await page.keyboard.press('Escape')
      await trigger.click()
      await page.waitForTimeout(220)
      await expect(menu).toBeVisible()
      await page.keyboard.press('End')
      await expect(menu.getByRole('menuitem', { name: 'Logout', exact: true })).toBeFocused()
      await page.keyboard.press('Home')
      await expect(menu.getByRole('menuitem').first()).toBeFocused()
      const darkBefore = await page.locator('html').evaluate(element => element.classList.contains('dark'))
      await menu.getByRole('menuitem', { name: /dark mode|light mode/i }).click()
      await expect(menu).toBeVisible()
      expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(!darkBefore)
      await menu.getByRole('menuitem', { name: 'Send Feedback', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Send Feedback', exact: true })).toBeVisible()
      await expect(panel).toHaveAttribute('inert')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await trigger.click()
      await trigger.click()
      await expect(menu).toHaveCount(0)
      await trigger.click()
      const outside = { x: page.viewportSize()!.width - 20, y: page.viewportSize()!.height - 20 }
      expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest('button,a'), outside)).toBeNull()
      await page.mouse.click(outside.x, outside.y)
      await expect(menu).toHaveCount(0)
      await trigger.focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Tab')
      await expect(menu).toHaveCount(0)
      expect(await panel.evaluate(element => element.contains(document.activeElement))).toBe(false)
      await info.attach('account-menu-motion', { body: Buffer.from(JSON.stringify({ opening, closing, timing })), contentType: 'application/json' })
      expect(await page.locator('[id]').evaluateAll(nodes => new Set(nodes.map(node => node.id)).size === nodes.length)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      expect(errors).toEqual([])
      expect(consoleErrors).toEqual([])
      expect(writes).toEqual([])
    })
  }
}
