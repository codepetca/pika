import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

const announcement = {
  id: '30000000-0000-4000-8000-000000000041', classroom_id: TABLE_CLASSROOM_ID,
  title: 'Schedule transition update', content: 'Keep this announcement draft intact.',
  created_by: '30000000-0000-4000-8000-000000000012', is_draft: false,
  published_at: '2026-10-05T12:00:00Z', scheduled_for: null,
  created_at: '2026-10-05T12:00:00Z', updated_at: '2026-10-05T12:00:00Z',
}

type MotionProof = {
  first: { connected: boolean; inert: boolean; hidden: string | null; sameDate: boolean }
  frames: { opacity: number; bounds: number[]; fieldBounds: number[]; font: string; sameDate: boolean }[]
  baseline: { bounds: number[]; fieldBounds: number[]; font: string }
  done: boolean
}

async function observeExit(page: Page, date: Locator, action: () => Promise<unknown>, reduced: boolean) {
  await date.evaluate(element => {
    const field = element as HTMLInputElement
    const panel = field.closest('.absolute') as HTMLElement
    const bounds = (node: Element) => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }
    const proof: MotionProof = { baseline: { bounds: bounds(panel), fieldBounds: bounds(field), font: getComputedStyle(field).font },
      first: { connected: false, inert: false, hidden: null, sameDate: false }, frames: [], done: false }
    ;(window as unknown as { scheduleExit: MotionProof }).scheduleExit = proof
    const observer = new MutationObserver(() => {
      if (panel.isConnected && panel.getAttribute('aria-hidden') !== 'true') return
      observer.disconnect()
      proof.first = { connected: panel.isConnected, inert: panel.inert, hidden: panel.getAttribute('aria-hidden'), sameDate: panel.querySelector('input[type="date"]') === field }
      const started = performance.now()
      const frame = () => {
        if (panel.isConnected) proof.frames.push({ opacity: Number(getComputedStyle(panel).opacity), bounds: bounds(panel), fieldBounds: bounds(field), font: getComputedStyle(field).font, sameDate: panel.querySelector('input[type="date"]') === field })
        if (!panel.isConnected || performance.now() - started > 500) proof.done = true
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-hidden'] })
  })
  await action()
  await expect.poll(() => page.evaluate(() => (window as unknown as { scheduleExit: MotionProof }).scheduleExit.done)).toBe(true)
  const proof = await page.evaluate(() => (window as unknown as { scheduleExit: MotionProof }).scheduleExit)
  if (reduced) expect(proof.first.connected).toBe(false)
  else {
    expect(proof.first).toEqual({ connected: true, inert: true, hidden: 'true', sameDate: true })
    expect(proof.frames.some(frame => frame.opacity > 0 && frame.opacity < 1)).toBe(true)
    for (const frame of proof.frames) {
      expect(frame.sameDate).toBe(true)
      expect(frame.font).toBe(proof.baseline.font)
      frame.bounds.forEach((value, index) => expect(Math.abs(value - proof.baseline.bounds[index])).toBeLessThan(0.5))
      frame.fieldBounds.forEach((value, index) => expect(Math.abs(value - proof.baseline.fieldBounds[index])).toBeLessThan(0.5))
    }
  }
  await expect(page.locator('[data-schedule-picker-closing]')).toHaveCount(0)
  return proof
}

async function openSchedule(page: Page) {
  const toggle = page.getByRole('button', { name: 'Choose announcement action', exact: true })
  await toggle.press('Enter')
  await expect(page.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Date (Toronto)', { exact: true })).toBeFocused()
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`teacher Schedule picker keeps native text stable and retires commands (${motion})`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.emulateMedia({ reducedMotion: motion })
    await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
    await mockTableShellReads(page, 'teacher')
    let owner: 'new' | 'draft' | 'posted' = 'new'
    const writes: string[] = [], errors: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.method()) })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.route('**/api/teacher/classrooms/*/announcements', route => route.request().method() === 'GET'
      ? route.fulfill({ json: { announcements: [{ ...announcement, is_draft: owner === 'draft' }] } }) : route.abort())
    const facts: unknown[] = []
    if (motion === 'no-preference') {
      await page.goto('/pattern-lab?role=teacher')
      const reference = page.getByTestId('page-action-icons-example')
      await reference.getByRole('button', { name: 'More actions', exact: true }).click()
      await expect(reference.getByRole('menu')).toBeVisible()
      await reference.screenshot({ path: info.outputPath('reference-page-actions.png'), animations: 'allow' })
    }
    for (owner of ['new', 'draft', 'posted'] as const) {
      await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=announcements')
      await expect(page.getByText(announcement.title, { exact: true })).toBeVisible()
      if (owner === 'new') {
        await page.getByRole('button', { name: 'Create announcement', exact: true }).click()
        await page.getByRole('textbox', { name: 'Announcement body', exact: true }).fill('Retained new scheduling draft')
      } else await page.getByText(announcement.title, { exact: true }).click()
      const body = page.getByRole('textbox', { name: owner === 'new' ? 'Announcement body' : 'Edit announcement body', exact: true })
      const draft = await body.inputValue()
      await openSchedule(page)
      const date = page.getByLabel('Date (Toronto)', { exact: true })
      await date.fill('2099-06-15')
      await page.getByLabel('Time (Toronto)', { exact: true }).fill('09:45')
      await page.screenshot({ path: info.outputPath(`${owner}-picker-open.png`), animations: 'allow' })
      const timing = await date.evaluate(element => {
        const s = getComputedStyle(element.closest('.absolute')!); return { duration: s.transitionDuration, fast: s.getPropertyValue('--motion-duration-fast').trim(), easing: s.transitionTimingFunction, standard: s.getPropertyValue('--motion-easing-standard').trim() }
      })
      const escaped = await observeExit(page, date, () => page.keyboard.press('Escape'), motion === 'reduce')
      await expect(page.getByRole('button', { name: 'Choose announcement action', exact: true })).toBeFocused()
      await expect(body).toHaveValue(draft)
      if (motion === 'no-preference') { expect(timing.duration).toBe('0.15s'); expect(timing.easing).toBe(timing.standard) }
      await openSchedule(page)
      const cancelled = await observeExit(page, date, () => date.locator('xpath=ancestor::div[contains(@class,"absolute")]').getByRole('button', { name: 'Cancel', exact: true }).click(), motion === 'reduce')
      await expect(page.getByRole('button', { name: 'Choose announcement action', exact: true })).toBeFocused()
      await openSchedule(page)
      const tabbed = await observeExit(page, date, () => date.press('Shift+Tab'), motion === 'reduce')
      await expect(page.getByRole('button', { name: 'Choose announcement action', exact: true })).toBeFocused()
      await openSchedule(page)
      await page.keyboard.press('Escape')
      await openSchedule(page)
      await date.fill('2099-06-16')
      await page.waitForTimeout(200)
      await expect(date).toBeFocused()
      await expect(date).toHaveValue('2099-06-16')
      await expect(page.locator('[data-schedule-picker-closing]')).toHaveCount(0)
      const outside = await observeExit(page, date, () => body.click({ position: { x: 8, y: 8 } }), motion === 'reduce')
      await expect(body).toBeFocused()
      await openSchedule(page)
      await date.fill('2099-06-15')
      await page.getByLabel('Time (Toronto)', { exact: true }).fill('09:45')
      const confirmed = await observeExit(page, date, () => page.getByRole('button', { name: 'Done', exact: true }).click(), motion === 'reduce')
      await expect(page.getByRole('button', { name: owner === 'new' ? 'Schedule' : 'Save', exact: true })).toBeFocused()
      await expect(body).toHaveValue(draft)
      await expect(page.getByRole('button', { name: /Jun 15/ })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${owner}-picker-closed.png`), animations: 'allow' })
      facts.push({ owner, motion, timing, escaped, cancelled, tabbed, outside, confirmed })
    }
    expect(writes).toEqual([])
    expect(errors).toEqual([])
    await info.attach('schedule-transition-evidence', { body: JSON.stringify({ facts, writes, errors }), contentType: 'application/json' })
  })
}

test('student Announcement reading remains available without scheduling controls', async ({ page }, info) => {
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  await mockTableShellReads(page, 'student')
  await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
  const writes: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/api/student/classrooms/*/announcements', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { announcements: [announcement] } })
    writes.push(route.request().method())
    return route.fulfill({ json: { success: true, marked: 1 } })
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=announcements')
  await expect(page.getByText(announcement.title, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create announcement', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Date (Toronto)', { exact: true })).toHaveCount(0)
  expect(writes.every(method => method === 'POST')).toBe(true)
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('student-announcement-reading.png') })
})
