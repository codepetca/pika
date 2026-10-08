import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mockLongTeacherTable, mockTableShellReads, TABLE_CLASSROOM_ID } from './teacher-student-tables'

const assignmentId = '30000000-0000-4000-8000-000000000014'

async function sampleClick(trigger: Locator, selector: string, waitForInspector = false) {
  return trigger.evaluate(async (element, { target, waitForInspector }) => {
    const samples: Array<{ elapsed: number; opacity: number; width: number; inspectorOpacity?: number; inspectorWidth?: number; kind: 'natural-frame' | 'forced-midpoint' }> = []
    const start = performance.now()
    let openedAt: number | undefined
    const probedElements = new WeakSet<HTMLElement>()
    const captureMidpoint = () => {
      const pane = document.querySelector<HTMLElement>(target)
      const inspector = document.querySelector<HTMLElement>('[data-workspace-inspector="open"]')
      for (const animated of new Set([pane, inspector])) {
        if (!animated || probedElements.has(animated)) continue
        getComputedStyle(animated).opacity
        const animations = animated.getAnimations().filter(animation =>
          Number(animation.effect?.getTiming().duration) > 0)
        if (animations.length === 0) continue
        probedElements.add(animated)
        for (const animation of animations) {
          animation.pause()
          animation.currentTime = Number(animation.effect?.getTiming().duration) / 2
        }
        samples.push({ kind: 'forced-midpoint', elapsed: performance.now() - start,
          opacity: pane ? Number(getComputedStyle(pane).opacity) : 1,
          width: pane?.getBoundingClientRect().width ?? 0,
          inspectorOpacity: inspector ? Number(getComputedStyle(inspector).opacity) : undefined,
          inspectorWidth: inspector?.getBoundingClientRect().width })
        for (const animation of animations) animation.play()
      }
    }
    // Probe the real browser transition midpoint even when a busy host drops animation frames.
    const observer = new MutationObserver(captureMidpoint)
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true })
    ;(element as HTMLElement).click()
    await new Promise<void>(resolve => {
      function frame() {
        const pane = document.querySelector<HTMLElement>(target)
        const inspector = document.querySelector<HTMLElement>('[data-workspace-inspector]')
        if (inspector?.dataset.workspaceInspector === 'open' && openedAt === undefined) openedAt = performance.now()
        if (pane) samples.push({ kind: 'natural-frame', inspectorOpacity: inspector ? Number(getComputedStyle(inspector).opacity) : undefined, inspectorWidth: inspector?.getBoundingClientRect().width, elapsed: performance.now() - start,
          opacity: Number(getComputedStyle(pane).opacity), width: pane.getBoundingClientRect().width })
        if (performance.now() - start < 5000 && (performance.now() - start < 350 || (waitForInspector && (openedAt === undefined || performance.now() - openedAt < 350)))) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    observer.disconnect()
    return samples
  }, { target: selector, waitForInspector })
}

export async function verifyWorkspaceMotion(page: Page, testInfo: TestInfo,
  surface: 'assignment' | 'test' | 'student', reducedMotion: 'reduce' | 'no-preference') {
  const { theme, viewport } = testInfo.project.metadata as { theme: string; viewport: string }
  const workspaceSelector = surface === 'student'
    ? '[role="region"][aria-label="Classwork"].workspace-entry'
    : `[role="region"][aria-label="${surface === 'test' ? 'Tests' : 'Classwork'}"] .workspace-entry`
  await page.emulateMedia({ reducedMotion })
  await page.addInitScript(({ theme, workspaceSelector }) => {
    localStorage.setItem('theme', theme)
    ;(window as any).workspaceEntries = 0
    document.addEventListener('animationstart', event => {
      if (event.animationName === 'workspace-entry' && event.target instanceof Element && event.target.matches(workspaceSelector)) {
        ;(window as any).workspaceEntries += 1
      }
    })
  }, { theme, workspaceSelector })
  let studentWorkReads = 0
  page.on('request', request => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith(`/api/teacher/assignments/${assignmentId}/students/`)) studentWorkReads += 1
  })
  const role = surface === 'student' ? 'student' : 'teacher'
  await mockTableShellReads(page, role)
  if (surface !== 'student') await mockLongTeacherTable(page, surface, TABLE_CLASSROOM_ID)
  else {
    const assignment = { id: assignmentId, classroom_id: TABLE_CLASSROOM_ID, title: 'Motion assignment',
      description: '', instructions_markdown: '', rich_instructions: null, due_at: null, position: 0,
      is_draft: false, released_at: '2026-01-01T12:00:00Z', status: 'in_progress',
      created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' }
    const doc = { id: 'motion-doc', assignment_id: assignmentId,
      student_id: '30000000-0000-4000-8000-000000000015',
      content: { type: 'doc', content: Array.from({ length: 40 }, (_, index) => ({
        type: 'paragraph', content: [{ type: 'text', text: `Draft paragraph ${index + 1}` }] })) },
      is_submitted: false, viewed_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' }
    await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
    await page.route('**/api/student/assignments?**', route => route.fulfill({ json: { assignments: [{ ...assignment, doc }] } }))
    await page.route(`**/api/assignment-docs/${assignmentId}`, route => route.fulfill({ json: { assignment, doc, feedback_entries: [] } }))
  }
  await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=${surface === 'test' ? 'tests' : 'assignments'}`, { waitUntil: 'domcontentloaded' })
  const title = surface === 'test' ? 'Long roster test' : surface === 'student' ? 'Motion assignment' : 'Long roster assignment'
  const trigger = page.getByText(title, { exact: true }).first()
  await expect(trigger).toBeVisible()
  const artifactDir = process.env.MOTION_ARTIFACT_DIR
  if (artifactDir) await mkdir(artifactDir, { recursive: true })
  const artifact = (state: string) => artifactDir
    ? path.join(artifactDir, `${surface}-${viewport}-${theme}-${reducedMotion}-${state}.png`)
    : testInfo.outputPath(`${surface}-${state}.png`)
  const frame = page.locator(workspaceSelector)
  await expect(frame).toHaveCount(0)
  await page.screenshot({ animations: 'disabled', path: artifact('summary') })
  const entry = await sampleClick(trigger, workspaceSelector, surface === 'assignment')
  await expect(frame).toHaveCount(1)
  await expect(frame).toBeVisible()
  await testInfo.attach('selected-workspace-entry', {
    body: JSON.stringify({ workspaceSelector, entry }, null, 2), contentType: 'application/json',
  })
  expect(await frame.evaluate(element => getComputedStyle(element).animationDuration)).toBe(reducedMotion === 'reduce' ? '0s' : '0.2s')
  if (reducedMotion === 'no-preference') expect(entry.some(sample => sample.opacity > 0 && sample.opacity < 1)).toBe(true)
  const frameHandle = await frame.elementHandle()
  const entries = await page.evaluate(() => (window as any).workspaceEntries)
  const measurements: Record<string, unknown> = { entry, entries }
  if (surface === 'student') {
    const editor = page.locator('[contenteditable="true"]').first()
    await expect(editor).toBeVisible()
    const editorHandle = await editor.elementHandle()
    await editor.click()
    await page.keyboard.type(' Typed draft')
    await expect(editor).toBeFocused()
    expect(await editor.evaluate((element, original) => element === original, editorHandle)).toBe(true)
    await page.screenshot({ animations: 'disabled', path: artifact('editing') })
  } else {
    const scroll = page.getByTestId(surface === 'test' ? 'test-grading-student-scroll-pane' : 'assignment-student-scroll-pane')
    await expect(scroll).toBeVisible()
    const scrollHandle = await scroll.elementHandle()
    const row = scroll.getByText('Student 01', { exact: true }).first()
    const firstRow = await row.elementHandle()
    const inspector = page.locator('[data-workspace-inspector]').first()
    const inspectorHandle = await inspector.elementHandle()
    if (surface === 'test') {
      await expect(inspector).toHaveAttribute('inert', '')
      expect(await inspector.evaluate(element => getComputedStyle(element).opacity)).toBe('0')
      await inspector.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
      measurements.open = await sampleClick(row, '[data-workspace-inspector]', true)
    } else {
      // Classwork intentionally selects its first student when the workspace opens.
      measurements.open = entry.map(sample => ({ opacity: sample.inspectorOpacity }))
    }
    await expect(inspector).toHaveAttribute('data-workspace-inspector', 'open')
    expect(await inspector.evaluate(element => getComputedStyle(element).transitionDuration)).toBe(reducedMotion === 'reduce' ? '0s' : '0.2s')
    if (artifactDir) await writeFile(path.join(artifactDir, `${surface}-${viewport}-${theme}-${reducedMotion}-open.json`), JSON.stringify(measurements, null, 2))
    if (reducedMotion === 'no-preference') expect((measurements.open as Array<{ opacity: number }>).some(sample => sample.opacity > 0 && sample.opacity < 1)).toBe(true)
    expect(await scroll.evaluate((element, original) => element === original, scrollHandle)).toBe(true)
    expect(await row.evaluate((element, original) => element === original, firstRow)).toBe(true)
    await page.screenshot({ animations: 'disabled', path: artifact('selected') })
    await scroll.evaluate(element => { element.scrollTop = 100 })
    const rememberedScroll = await scroll.evaluate(element => element.scrollTop)
    await scroll.getByText('Student 02', { exact: true }).first().evaluate(element => (element as HTMLElement).click())
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(rememberedScroll)
    expect(await inspector.evaluate((element, original) => element === original, inspectorHandle)).toBe(true)
    await expect.poll(() => scroll.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop })).toBeGreaterThan(0)
    await page.screenshot({ animations: 'disabled', path: artifact('scrolled') })
    await scroll.evaluate(element => { element.scrollTop = 0 })
    if (viewport === 'desktop') {
      const separator = page.getByRole('separator', { name: /Resize (students|grading)/ }).first()
      await expect(separator).toBeVisible()
      const box = await separator.boundingBox()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + 20)
      await page.mouse.down()
      await page.mouse.move(box!.x - 35, box!.y + 20)
      measurements.drag = await inspector.evaluate(element => ({ property: getComputedStyle(element).transitionProperty, width: element.getBoundingClientRect().width }))
      expect((measurements.drag as { property: string }).property).toBe('none')
      const percent = Number(await separator.getAttribute('aria-valuenow'))
      const splitWidth = await inspector.evaluate(element => element.parentElement!.getBoundingClientRect().width)
      expect(Math.abs((measurements.drag as { width: number }).width - (splitWidth * percent / 100 - 6))).toBeLessThanOrEqual(1)
      await page.mouse.up()
      await separator.focus()
      const before = await separator.getAttribute('aria-valuenow')
      await page.keyboard.press('ArrowLeft')
      await expect(separator).not.toHaveAttribute('aria-valuenow', before!)
      await expect(separator).toBeFocused()
    }
    if (surface === 'assignment') {
      const comment = inspector.getByRole('textbox', { name: 'Teacher comment draft' })
      await expect(comment).toBeVisible()
      await comment.fill('Unsaved layout comment')
      const commentHandle = await comment.elementHandle()
      const gradingScroller = inspector.getByTestId('grading-inspector-pane').locator(':scope > div').first()
      const gradingScrollerHandle = await gradingScroller.elementHandle()
      await comment.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 8))
      await gradingScroller.evaluate(element => { element.scrollTop = 120 })
      const gradingScrollTop = await gradingScroller.evaluate(element => element.scrollTop)
      const readsBeforeLayout = studentWorkReads
      const layout = page.getByRole('button', { name: /^Change assignment layout:/ })
      await layout.click()
      await expect(layout).toHaveAccessibleName('Change assignment layout: Content + grading')
      await expect(inspector.getByRole('textbox', { name: 'Teacher comment draft' })).toHaveValue('Unsaved layout comment')
      expect(await comment.evaluate((element, original) => element === original, commentHandle)).toBe(true)
      expect(await gradingScroller.evaluate((element, original) => element === original, gradingScrollerHandle)).toBe(true)
      expect(await comment.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 8])
      await expect.poll(() => gradingScroller.evaluate(element => element.scrollTop)).toBe(gradingScrollTop)
      expect(await inspector.evaluate((element, original) => element === original, inspectorHandle)).toBe(true)
      await expect.poll(() => inspector.evaluate(element => Math.abs(element.getBoundingClientRect().width - element.parentElement!.getBoundingClientRect().width))).toBeLessThanOrEqual(1)
      await comment.scrollIntoViewIfNeeded()
      await expect(comment).toBeInViewport()
      await comment.click()
      await expect(comment).toBeFocused()
      await page.screenshot({ animations: 'disabled', path: artifact('content-grading') })
      await layout.click()
      await expect(layout).toHaveAccessibleName('Change assignment layout: Students + content')
      await layout.click()
      await expect(layout).toHaveAccessibleName('Change assignment layout: Students + grading')
      await expect(inspector.getByRole('textbox', { name: 'Teacher comment draft' })).toHaveValue('Unsaved layout comment')
      expect(await scroll.evaluate((element, original) => element === original, scrollHandle)).toBe(true)
      expect(studentWorkReads).toBe(readsBeforeLayout)
      measurements.layoutReads = { before: readsBeforeLayout, after: studentWorkReads }
      await page.screenshot({ animations: 'disabled', path: artifact('layout-restored') })
    }
    if (surface === 'test') {
      await page.locator('body').click({ position: { x: 1, y: 1 } })
      await page.keyboard.press('Escape')
      await expect(inspector).toHaveAttribute('inert', '')
      await expect(inspector).toHaveAttribute('aria-hidden', 'true')
      await expect(page.getByTestId('test-grading-inspector-scroll-pane')).toHaveCount(0)
      expect(await inspector.evaluate((element, original) => element === original, inspectorHandle)).toBe(true)
      expect(await scroll.evaluate((element, original) => element === original, scrollHandle)).toBe(true)
      await page.screenshot({ animations: 'disabled', path: artifact('closed') })
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  expect(await frame.evaluate((element, original) => element === original, frameHandle)).toBe(true)
  expect(await page.evaluate(() => (window as any).workspaceEntries)).toBe(entries)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  if (artifactDir) await writeFile(path.join(artifactDir, `${surface}-${viewport}-${theme}-${reducedMotion}-measurements.json`), JSON.stringify(measurements, null, 2))
  await testInfo.attach('workspace-motion-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
}
