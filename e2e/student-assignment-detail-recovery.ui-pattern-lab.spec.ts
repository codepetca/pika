import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

const assignmentId = '30000000-0000-4000-8000-000000000014'
const studentId = '30000000-0000-4000-8000-000000000015'
const storageKey = `assignment-draft:${studentId}:${assignmentId}`
const rich = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const assignment = { id: assignmentId, classroom_id: TABLE_CLASSROOM_ID, title: 'Recoverable assignment', description: '', instructions_markdown: 'Explain your approach.', rich_instructions: null, due_at: null, position: 0, is_draft: false, released_at: '2026-01-01T12:00:00Z', status: 'in_progress', created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' }
const doc = { id: '30000000-0000-4000-8000-000000000016', assignment_id: assignmentId, student_id: studentId, content: rich('Saved assignment'), is_submitted: false, viewed_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' }

test.use({ video: 'on', trace: 'retain-on-failure' })
test.setTimeout(60_000)

async function shot(page: Page, info: TestInfo, state: string) {
  const path = info.outputPath(`${state}.png`)
  await page.screenshot({ path, animations: 'allow', caret: 'initial' })
  await info.attach(state, { path, contentType: 'image/png' })
}

for (const recoveredDraft of [false, true]) for (const motion of ['no-preference', 'reduce'] as const) {
  test(`initial assignment retry preserves selection and ${recoveredDraft ? 'local recovery' : 'server content'} (${motion})`, async ({ page }, info) => {
    const recovery = { draft_id: '60000000-0000-4000-8000-000000000001', generation: 1, content: rich('Preserved local assignment'), base_revision: doc.updated_at, paste_word_count: 0, keystroke_count: 0, saved_at: new Date().toISOString() }
    await page.addInitScript(({ theme, storageKey, recovery, recoveredDraft }) => {
      localStorage.setItem('theme', theme)
      if (recoveredDraft) {
        localStorage.setItem(storageKey, JSON.stringify(recovery))
        sessionStorage.setItem(storageKey, JSON.stringify(recovery))
      }
    }, { theme: info.project.metadata.theme as string, storageKey, recovery, recoveredDraft })
    await page.emulateMedia({ reducedMotion: motion })
    await mockTableShellReads(page, 'student')
    await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
    await page.route('**/api/student/assignments?**', route => route.fulfill({ json: { assignments: [{ ...assignment, doc }] } }))
    const errors: string[] = [], consoleErrors: string[] = [], mutations: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') mutations.push(request.method() + ' ' + request.url()) })
    const gates: Array<() => void> = []
    let reads = 0
    await page.route(`**/api/assignment-docs/${assignmentId}`, async route => {
      expect(route.request().method()).toBe('GET')
      reads += 1
      const attempt = reads
      if (attempt > 1) await new Promise<void>(resolve => { gates.push(resolve) })
      await route.fulfill(attempt < 3 ? { status: 503, json: { error: 'Controlled assignment detail read failure' } } : { json: { assignment, doc, student_id: studentId, feedback_entries: [], submission_requirements: [], submission_artifacts: [] } })
    })
    try {
      expect((await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=assignments', { waitUntil: 'networkidle' }))?.status()).toBe(200)
      await page.evaluate(() => document.fonts.ready)
      await page.getByText(assignment.title, { exact: true }).click()
      const region = page.getByRole('region', { name: 'Assignment work', exact: true })
      await expect(region.getByRole('heading', { name: "Assignment couldn't load", exact: true })).toBeVisible()
      const original = await region.elementHandle()
      const selectedUrl = page.url()
      expect(reads).toBe(1)
      const recoveryBefore = await page.evaluate(storageKey => localStorage.getItem(storageKey), storageKey)
      if (recoveredDraft) expect(JSON.parse(recoveryBefore!).content).toEqual(recovery.content)
      await shot(page, info, 'initial-error')
      for (const attempt of [2, 3]) {
        const retry = region.getByRole('button', { name: 'Try again', exact: true })
        await retry.focus()
        await expect(retry).toBeFocused()
        await page.keyboard.press('Enter')
        await expect.poll(() => reads).toBe(attempt)
        await expect(region).toBeFocused()
        await expect(region.getByRole('status')).toContainText('Loading assignment')
        expect(page.url()).toBe(selectedUrl)
        expect(await region.evaluate((node, prior) => node === prior, original)).toBe(true)
        if (motion === 'reduce') expect(await region.locator('[data-page-state="loading"] svg').evaluate(node => getComputedStyle(node).animationName)).toBe('none')
        expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), storageKey)).toBe(recoveryBefore)
        expect(mutations).toEqual([])
        await shot(page, info, `retry-${attempt}-pending`)
        gates[attempt - 2]()
        if (attempt === 2) {
          await expect(region.getByRole('heading', { name: "Assignment couldn't load", exact: true })).toBeVisible()
          await expect(region).toBeFocused()
          await shot(page, info, 'repeat-error')
        }
      }
      const editor = region.locator('[contenteditable="true"]').first()
      await expect(editor).toHaveText(recoveredDraft ? 'Preserved local assignment' : 'Saved assignment')
      await expect(region).toBeFocused()
      expect(page.url()).toBe(selectedUrl)
      expect(await region.evaluate((node, prior) => node === prior, original)).toBe(true)
      expect(reads).toBe(3)
      expect(mutations).toEqual([])
      await shot(page, info, 'recovered-content')
      expect(errors).toEqual([])
      expect(consoleErrors.filter(message => !message.startsWith('Failed to load resource: the server responded with a status of 503'))).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      const path = info.outputPath('assignment-read-recovery-receipt.json')
      await writeFile(path, JSON.stringify({ recoveredDraft, motion, theme: info.project.metadata.theme, viewport: page.viewportSize(), reads, mutations, selectedUrl, regionRetained: true, errors, consoleErrors, persistedBackendWrites: 0, limits: 'Actual guarded student Classwork owner; controlled three-read failure/retry/success and optional local recovery. Teacher not affected; standalone compatibility and protected-response behavior covered by owner tests. Natural recording retained; no authenticated production or whole-family performance claim.' }, null, 2))
      await info.attach('assignment-read-recovery-receipt', { path, contentType: 'application/json' })
      await original?.dispose()
    } finally { gates.forEach(resolve => resolve()) }
  })
}
