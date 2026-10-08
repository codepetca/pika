import { expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'
import type { CourseGuideData } from '../../src/lib/course-guide'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './teacher-student-tables'

const nextClassroomId = '30000000-0000-4000-8000-000000000016'
const guide: CourseGuideData = {
  classroom: { title: 'Retained course guide' },
  visibility: { overview: true, resources: false, assignments: true, tests: true },
  overviewMarkdown: Array.from({ length: 24 }, (_, index) => `## Week ${index + 1}\n\nRead, practice and reflect together.`).join('\n\n'),
  resourcesContent: null,
  assignments: Array.from({ length: 24 }, (_, index) => ({ key: `reflection-${index}`, title: `Course reflection ${index + 1}` })),
  tests: [{ key: 'check', title: 'Knowledge check' }],
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.workspace-entry:visible').first()).toHaveCSS('opacity', '1')
  await expect(page.locator('[data-modal-state="closing"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`guide-${name}.png`), animations: 'allow' })
}

async function activateWithoutScrolling(page: Page, locator: Locator) {
  await locator.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }))
  await expect(locator).toBeFocused()
  await page.keyboard.press('Enter')
}

/** Actual ClassroomPageClient/CourseGuidePanel with explicitly controlled, synthetic reads. */
export async function verifyCourseGuideContinuity(page: Page, info: TestInfo, reducedMotion: 'no-preference' | 'reduce') {
  await page.emulateMedia({ reducedMotion })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(reducedMotion === 'reduce')
  const errors: string[] = []
  page.on('pageerror', error => {
    errors.push(error.message)
    void info.attach('course-guide-page-error', { body: error.stack || error.message, contentType: 'text/plain' })
  })
  const receipts: unknown[] = []
  for (const role of ['teacher', 'student'] as const) {
    await page.unrouteAll({ behavior: 'wait' })
    await mockTableShellReads(page, role)
    const reads: Array<{ classroomId: string; route: Route }> = []
    await page.route(/\/api\/classrooms\/[^/]+\/course-guide(?:\?|$)/, async route => {
      expect(route.request().method()).toBe('GET')
      reads.push({ classroomId: new URL(route.request().url()).pathname.split('/')[3], route })
    })
    await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=resources&guideContinuity=true`)
    await expect.poll(() => reads.length).toBe(1)
    expect(reads[0].classroomId).toBe(TABLE_CLASSROOM_ID)
    await expect(page.getByText('Loading course guide', { exact: true })).toBeVisible()
    await capture(page, info, `${role}-cold-pending`)
    await reads[0].route.fulfill({ status: 503, json: { error: 'Temporary guide failure' } })
    await expect(page.getByText('Course guide unavailable', { exact: true })).toBeVisible()
    await capture(page, info, `${role}-cold-failed`)
    await activateWithoutScrolling(page, page.getByRole('button', { name: 'Retry', exact: true }))
    await expect.poll(() => reads.length).toBe(2)
    await reads[1].route.fulfill({ json: { guide } })
    const heading = page.getByRole('heading', { name: guide.classroom.title, exact: true })
    await expect(heading).toBeVisible()
    const originalHeading = await heading.elementHandle()
    await capture(page, info, `${role}-ready`)

    let editor: Locator | null = null
    let originalEditor = null
    const draft = '# Unsaved guide\n\n' + Array.from({ length: 32 }, (_, i) => `Keep draft line ${i + 1}`).join('\n')
    if (role === 'teacher') {
      await page.getByRole('button', { name: 'More actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Edit with Markdown', exact: true }).click()
      editor = page.getByRole('textbox', { name: 'Course guide Markdown', exact: true })
      await editor.fill(draft)
      originalEditor = await editor.elementHandle()
      await editor.evaluate(element => {
        const input = element as HTMLTextAreaElement
        input.style.height = '440px'
        input.setSelectionRange(12, 12)
        input.scrollTop = 90
      })
      await capture(page, info, 'teacher-draft')
    }
    const anchor = editor || heading
    const scrollers = await anchor.evaluateHandle(element => {
      const result: HTMLElement[] = []
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) result.push(parent)
      }
      return result
    })
    const scrollerCount = await scrollers.evaluate(elements => elements.length)
    if (info.project.metadata.viewport === 'desktop') expect(scrollerCount).toBeGreaterThan(0)
    await scrollers.evaluate(elements => {
      if (elements.length) elements[0].scrollTop = 120
      else window.scrollTo({ top: 120, behavior: 'instant' })
    })
    const paneScroll = await scrollers.evaluate(elements => elements.length ? elements[0].scrollTop : window.scrollY)
    expect(paneScroll).toBeGreaterThan(0)
    const editorFacts = editor ? await editor.evaluate(element => {
      const input = element as HTMLTextAreaElement
      return { height: input.style.height, physicalHeight: input.getBoundingClientRect().height, scrollTop: input.scrollTop, start: input.selectionStart, end: input.selectionEnd }
    }) : null
    const assertRetained = async () => {
      expect(await originalHeading!.evaluate(element => element.isConnected)).toBe(true)
      expect(await heading.elementHandle().then(handle => handle!.evaluate((element, original) => element === original, originalHeading))).toBe(true)
      expect(await scrollers.evaluate(elements => elements.length ? elements[0].scrollTop : window.scrollY)).toBe(paneScroll)
      if (editor && originalEditor && editorFacts) {
        expect(await originalEditor.evaluate(element => element.isConnected)).toBe(true)
        await expect(editor).toHaveValue(draft)
        expect(await editor.evaluate(element => { const input = element as HTMLTextAreaElement; return {
          height: input.style.height, physicalHeight: input.getBoundingClientRect().height, scrollTop: input.scrollTop, start: input.selectionStart, end: input.selectionEnd,
        } })).toEqual(editorFacts)
      }
    }
    await activateWithoutScrolling(page, page.getByRole('button', { name: 'Refresh guide fixture', exact: true }))
    await expect.poll(() => reads.length).toBe(3)
    if (editor) await editor.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }))
    await assertRetained()
    await expect(page.getByText('Loading course guide', { exact: true })).toHaveCount(0)
    await capture(page, info, `${role}-warm-pending`)
    await reads[2].route.fulfill({ status: 503, json: { error: 'Temporary guide failure' } })
    const retry = page.getByRole('button', { name: 'Retry', exact: true })
    await expect(retry).toBeVisible()
    await assertRetained()
    if (editor) await expect(editor).toBeFocused()
    await capture(page, info, `${role}-warm-failed`)
    // Targeted style evidence may scroll to the footer; restore the verified reading position before recovery.
    await page.getByRole('region', { name: 'Course guide workspace', exact: true }).getByRole('alert').screenshot({ path: info.outputPath(`guide-${role}-warm-feedback.png`), animations: 'allow' })
    await scrollers.evaluate((elements, position) => {
      if (elements.length) elements[0].scrollTop = position
      else window.scrollTo({ top: position, behavior: 'instant' })
    }, paneScroll)
    await activateWithoutScrolling(page, retry)
    await expect.poll(() => reads.length).toBe(4)
    await reads[3].route.fulfill({ json: { guide: { ...guide, assignments: [...guide.assignments, { key: 'new', title: 'Updated reflection' }] } } })
    await expect(page.getByText('Updated reflection', { exact: true })).toBeVisible()
    await assertRetained()
    await expect(page.getByRole('region', { name: 'Course guide workspace', exact: true })).toBeFocused()
    await capture(page, info, `${role}-warm-recovered`)

    if (role === 'teacher') {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('button', { name: 'More actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
      const visual = page.getByRole('textbox', { name: 'Course guide', exact: true })
      await visual.fill('Visual guide draft with retained selection.')
      const visualNode = await visual.elementHandle()
      await visual.evaluate(element => {
        const firstText = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
        if (!firstText) throw new Error('Real visual editor has no text node')
        const range = document.createRange()
        range.setStart(firstText, 8)
        range.collapse(true)
        const selection = getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
      const facts = await visual.evaluate(element => ({
        html: element.innerHTML,
        selectionText: getSelection()?.anchorNode?.textContent,
        anchorOffset: getSelection()?.anchorOffset,
      }))
      await activateWithoutScrolling(page, page.getByRole('button', { name: 'Refresh guide fixture', exact: true }))
      await expect.poll(() => reads.length).toBe(5)
      await visual.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }))
      await expect(visual).toBeFocused()
      expect(await visualNode!.evaluate(element => element.isConnected)).toBe(true)
      await reads[4].route.fulfill({ status: 503, json: { error: 'Temporary visual guide refresh failure' } })
      await expect(retry).toBeVisible()
      await expect(visual).toBeFocused()
      expect(await visualNode!.evaluate(element => element.isConnected)).toBe(true)
      expect(await visual.evaluate(element => ({ html: element.innerHTML,
        selectionText: getSelection()?.anchorNode?.textContent, anchorOffset: getSelection()?.anchorOffset }))).toEqual(facts)
      await capture(page, info, 'teacher-visual-failed')
      await activateWithoutScrolling(page, retry)
      await expect.poll(() => reads.length).toBe(6)
      await reads[5].route.fulfill({ json: { guide } })
      await expect(retry).toHaveCount(0)
      expect(await visualNode!.evaluate(element => element.isConnected)).toBe(true)
      await expect(visual).toHaveText('Visual guide draft with retained selection.')
      await capture(page, info, 'teacher-visual-recovered')
    }
    const retiredIndex = reads.length
    // Retire an obsolete same-owner request before a new classroom read settles.
    await activateWithoutScrolling(page, page.getByRole('button', { name: 'Refresh guide fixture', exact: true }))
    await expect.poll(() => reads.length).toBe(retiredIndex + 1)
    await activateWithoutScrolling(page, page.getByRole('button', { name: 'Change guide classroom', exact: true }))
    // The real development parent remounts the guide and replays mount effects.
    await expect.poll(() => reads.length).toBe(retiredIndex + 3)
    expect(reads[retiredIndex + 1].classroomId).toBe(nextClassroomId)
    expect(reads[retiredIndex + 2].classroomId).toBe(nextClassroomId)
    await expect(heading).toHaveCount(0)
    if (editor) await expect(editor).toHaveCount(0)
    await reads[retiredIndex].route.fulfill({ json: { guide: { ...guide, classroom: { title: 'Obsolete guide response' } } } })
    await expect(page.getByRole('heading', { name: 'Obsolete guide response' })).toHaveCount(0)
    await expect(page.getByText('Loading course guide', { exact: true })).toBeVisible()
    await capture(page, info, `${role}-changed-owner-pending`)
    await reads[retiredIndex + 1].route.fulfill({ status: 403, json: { error: 'Retired development mount' } })
    await expect(page.getByText('Loading course guide', { exact: true })).toBeVisible()
    const differentGuide = { ...guide, classroom: { title: 'Different classroom guide' } }
    await reads[retiredIndex + 2].route.fulfill({ json: { guide: differentGuide } })
    await expect(page.getByRole('heading', { name: 'Different classroom guide' })).toBeVisible()
    await capture(page, info, `${role}-changed-owner-ready`)
    await activateWithoutScrolling(page, page.getByRole('button', { name: 'Refresh guide fixture', exact: true }))
    await expect.poll(() => reads.length).toBe(retiredIndex + 4)
    await reads[retiredIndex + 3].route.fulfill({ status: 403, json: { error: 'Access unavailable' } })
    await expect(page.getByText('Course guide unavailable', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Different classroom guide' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Course guide Markdown' })).toHaveCount(0)
    await capture(page, info, `${role}-denied`)
    await activateWithoutScrolling(page, page.getByRole('button', { name: 'Retry', exact: true }))
    await expect.poll(() => reads.length).toBe(retiredIndex + 5)
    await reads[retiredIndex + 4].route.fulfill({ json: { guide: { ...differentGuide, overviewMarkdown: '', assignments: [], tests: [] } } })
    await expect(page.getByText('Course guide details are being prepared.', { exact: true })).toBeVisible()
    await capture(page, info, `${role}-empty`)
    expect(reads).toHaveLength(retiredIndex + 5)
    receipts.push({ role, reads: reads.map(read => read.classroomId), scrollerCount, paneScroll, editorFacts, realMotion: reducedMotion })
  }
  expect(errors).toEqual([])
  await info.attach('course-guide-continuity-receipt', { body: JSON.stringify({ receipts, errors }, null, 2), contentType: 'application/json' })
}
