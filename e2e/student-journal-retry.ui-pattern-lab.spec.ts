import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { getStudentEntryHistoryCacheKey } from '../src/lib/student-entry-history'

test.use({ video: 'on', trace: 'retain-on-failure' })
test.setTimeout(90_000)
const classroomId = '30000000-0000-4000-8000-000000000011'
const studentId = '30000000-0000-4000-8000-000000000015'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

for (const blockedStorage of [false, true]) for (const recovery of ['confirmed-draft', 'different-server-log'] as const) {
  test(`${recovery} recovery retains truthful journal state (blocked storage=${blockedStorage})`, async ({ page }, info) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
    const today = `${parts.year}-${parts.month}-${parts.day}`
    const entry = { id: '50000000-0000-4000-8000-000000000099', classroom_id: classroomId, student_id: studentId, date: today, text: 'Saved baseline', rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved baseline' }] }] }, version: 1, on_time: true, minutes_reported: null, mood: null, feedback: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId, limit: 11 })
    await page.addInitScript(({ entry, cacheKey, blockedStorage }) => {
      sessionStorage.setItem(cacheKey, JSON.stringify([entry]))
      if (blockedStorage) {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === localStorage && key.startsWith('daily-log-draft:v2:')) throw new DOMException('Controlled draft storage denial', 'QuotaExceededError')
          return original.call(this, key, value)
        }
      }
    }, { entry, cacheKey, blockedStorage })
    let retry = false
    let savedContent: typeof entry.rich_content | null = null
    const saveBodies: Record<string, unknown>[] = [], errors: string[] = [], consoleErrors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (request.method() !== 'GET') {
        expect(path).toBe('/api/student/entries')
        expect(request.method()).toBe('PATCH')
        const body = request.postDataJSON()
        saveBodies.push(body)
        expect(body.rich_content).toBeTruthy()
        if (saveBodies.length === 1) savedContent = body.rich_content
        return route.fulfill({ status: 503, json: { error: 'Controlled lost save response' } })
      }
      if (path === '/api/student/entries') {
        if (!retry) return route.fulfill({ status: 503, json: { error: 'Controlled read failure' } })
        expect(savedContent).toBeTruthy()
        const serverContent = recovery === 'confirmed-draft' ? savedContent : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Different saved log' }] }] }
        return route.fulfill({ json: { entries: [{ ...entry, version: 2, rich_content: serverContent, text: recovery === 'confirmed-draft' ? 'Saved baseline Draft' : 'Different saved log' }] } })
      }
      let body: object = {}
      if (path === '/api/auth/me') body = { user: { id: studentId, role: 'student', email: 'student@example.invalid', first_name: 'Fixture', last_name: 'Student' } }
      else if (path.endsWith('/class-days')) body = { class_days: [{ id: entry.id, classroom_id: classroomId, date: today, prompt_text: 'What is your plan today?', is_class_day: true }] }
      else for (const suffix of ['assignments', 'announcements', 'lesson-plans', 'materials', 'notifications']) if (path.endsWith(`/${suffix}`)) body = { [suffix.replace('-', '_')]: [] }
      return route.fulfill({ json: body })
    })
    expect((await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=today', { waitUntil: 'networkidle' }))?.status()).toBe(200)
    await page.evaluate(() => document.fonts.ready)
    const editor = page.getByRole('textbox', { name: 'Daily Log', exact: true })
    await expect(editor).toHaveText('Saved baseline')
    await expect(page.getByText('The latest daily log could not be loaded.', { exact: true })).toBeVisible()
    const original = await editor.elementHandle()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.insertText(' Draft')
    await page.getByRole('heading', { name: 'Daily Log', exact: true }).click()
    await expect(page.getByText('Controlled lost save response', { exact: true })).toBeVisible()
    expect(saveBodies).toHaveLength(1)
    await capture(page, info, 'lost-save-response')
    retry = true
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByText('The latest daily log could not be loaded.', { exact: true })).toHaveCount(0)
    expect(await original!.evaluate(node => node.isConnected)).toBe(true)
    expect(await editor.evaluate((node, previous) => node === previous, original)).toBe(true)
    await expect(editor).toHaveText('Saved baseline Draft')
    if (recovery === 'confirmed-draft') {
      await expect(page.getByText('Saved', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toHaveCount(0)
      await expect(page.getByText('Controlled lost save response', { exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('daily-log-draft:v2:')))).toEqual([])
      await capture(page, info, 'read-confirmed-draft')
      await editor.click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.insertText(' Continued')
      await page.getByRole('heading', { name: 'Daily Log', exact: true }).click()
      await expect.poll(() => saveBodies.length).toBe(2)
      expect(saveBodies[1].version).toBe(2)
      await expect(page.getByText('Controlled lost save response', { exact: true })).toBeVisible()
      await expect(editor).toHaveText('Saved baseline Draft Continued')
      await expect(page.getByText('Saved', { exact: true })).toHaveCount(0)
    } else {
      const message = page.getByText('This log changed elsewhere. Review before replacing the newer version.', { exact: true })
      await expect(message).toBeVisible()
      await capture(page, info, 'read-conflict')
      await editor.click()
      await page.keyboard.press('ControlOrMeta+z')
      await expect(editor).toHaveText('Saved baseline')
      await expect(page.getByText('Saved', { exact: true })).toHaveCount(0)
      await expect(message).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toBeVisible()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.insertText(' Continued after conflict')
      await expect(editor).toHaveText('Saved baseline Continued after conflict')
      await expect(message).toBeVisible()
      await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible()
      await capture(page, info, 'conflict-after-revert-and-edit')
      await page.getByRole('button', { name: 'Reload latest', exact: true }).click()
      await expect(editor).toHaveText('Different saved log')
      await expect(page.getByText('Saved', { exact: true })).toBeVisible()
      expect(saveBodies).toHaveLength(1)
    }
    await capture(page, info, 'recovery-final')
    expect(await original!.evaluate(node => node.isConnected)).toBe(true)
    expect(errors).toEqual([])
    const expectedConsoleErrors = consoleErrors.filter(message => message.startsWith('Failed to load resource: the server responded with a status of 503') || message.startsWith('Error loading today tab: Error: Controlled read failure') || message.startsWith('Error saving: Error: Controlled lost save response'))
    expect(consoleErrors.filter(message => !expectedConsoleErrors.includes(message))).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const path = info.outputPath('journal-recovery-receipt.json')
    await writeFile(path, JSON.stringify({ recovery, blockedStorage, viewport: page.viewportSize(), theme: info.project.metadata.theme, motion: 'no-preference', today, saveBodies, errors, consoleErrors, persistedBackendWrites: 0, editorRetained: true, limits: 'Guarded actual student owner, controlled server contracts; simulated committed-but-unacknowledged save, no real backend persistence. Existing16case continuity matrix covers reduced motion; these16supplemental recovery cases cover normal-motion display/storage combinations.' }, null, 2))
    await info.attach('journal-recovery-receipt', { path, contentType: 'application/json' })
    await original?.dispose()
  })
}
async function capture(page: Page, info: TestInfo, state: string) {
  const path = info.outputPath(`${state}.png`)
  await page.screenshot({ path, animations: 'allow', caret: 'initial' })
  await info.attach(state, { path, contentType: 'image/png' })
}

for (const blockedStorage of [false, true]) for (const motion of ['no-preference', 'reduce'] as const) {
  test(`${blockedStorage ? 'blocked storage' : 'durable draft'} ${motion} retains live journal through failed and successful retries`, async ({ page }, info) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
    const today = `${parts.year}-${parts.month}-${parts.day}`
    const entry = { id: '50000000-0000-4000-8000-000000000099', classroom_id: classroomId, student_id: studentId, date: today, text: 'Saved baseline', rich_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved baseline' }] }] }, version: 1, on_time: true, minutes_reported: null, mood: null, feedback: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const pastEntries = Array.from({ length: 10 }, (_, index) => ({ ...entry, id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, date: new Date(Date.parse(`${today}T12:00:00Z`) - (index + 1) * 86_400_000).toISOString().slice(0, 10), text: `Past log ${index + 1}`, rich_content: null }))
    pastEntries[0].text = Array.from({ length: 30 }, (_, index) => `Past log detail line ${index + 1}`).join('\n')
    const entries = [entry, ...pastEntries]
    const cacheKey = getStudentEntryHistoryCacheKey({ classroomId, limit: 11 })
    await page.addInitScript(({ entries, cacheKey, blockedStorage }) => {
      sessionStorage.setItem(cacheKey, JSON.stringify(entries))
      if (blockedStorage) {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key: string, value: string) {
          if (this === localStorage && key.startsWith('daily-log-draft:v2:')) throw new DOMException('Controlled draft storage denial', 'QuotaExceededError')
          return original.call(this, key, value)
        }
      }
    }, { entries, cacheKey, blockedStorage })
    await page.emulateMedia({ reducedMotion: motion })
    const readGates = [deferred(), deferred()], saveGate = deferred()
    let reads = 0, retryAttempt = 0
    const pendingRetries = new Set<number>()
    const errors: string[] = [], consoleErrors: string[] = [], requests: { path: string; method: string; body: string | null }[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      requests.push({ path, method: request.method(), body: request.postData() })
      if (request.method() !== 'GET') {
        expect(path).toBe('/api/student/entries')
        expect(request.method()).toBe('PATCH')
        await saveGate.promise
        return route.fulfill({ status: 503, json: { error: 'Controlled save failure' } })
      }
      if (path === '/api/student/entries') {
        reads += 1
        const attempt = retryAttempt
        if (attempt > 0) {
          pendingRetries.add(attempt)
          await readGates[attempt - 1].promise
        }
        return route.fulfill(attempt < 2 ? { status: 503, json: { error: 'Controlled read failure' } } : { json: { entries } })
      }
      let body: object = {}
      if (path === '/api/auth/me') body = { user: { id: studentId, role: 'student', email: 'student@example.invalid', first_name: 'Fixture', last_name: 'Student' } }
      else if (path.endsWith('/class-days')) body = { class_days: entries.map(item => ({ id: item.id, classroom_id: classroomId, date: item.date, prompt_text: 'What is your plan today?', is_class_day: true })) }
      else for (const suffix of ['assignments', 'announcements', 'lesson-plans', 'materials', 'notifications']) if (path.endsWith(`/${suffix}`)) body = { [suffix.replace('-', '_')]: [] }
      return route.fulfill({ json: body })
    })
    const editor = page.getByRole('textbox', { name: 'Daily Log', exact: true })
    let original: Awaited<ReturnType<typeof editor.elementHandle>> = null
    try {
      expect((await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=today', { waitUntil: 'networkidle' }))?.status()).toBe(200)
      await page.evaluate(() => document.fonts.ready)
      await expect(page.getByText('The latest daily log could not be loaded.', { exact: true })).toBeVisible()
      await expect(editor).toHaveText('Saved baseline')
      original = await editor.elementHandle()
      const pastLogs = await page.getByRole('heading', { name: 'Past logs', exact: true }).elementHandle()
      const pastLog = page.getByRole('region', { name: 'Past logs', exact: true }).getByRole('button').first()
      await pastLog.click()
      await expect(pastLog).toHaveAttribute('aria-expanded', 'true')
      const scrollPane = await editor.evaluateHandle(node => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent
        }
        const documentPane = document.scrollingElement
        if (documentPane && documentPane.scrollHeight > documentPane.clientHeight) return documentPane
        throw new Error('Expected scrollable journal pane after expanding long past log')
      })
      let scrollBeforeRead = 0, scrollAfterRead = 0
      await capture(page, info, 'cached-read-error')
      await editor.click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.insertText(' My unsaved revision')
      const draft = 'Saved baseline My unsaved revision'
      await expect(editor).toHaveText(draft)
      await page.keyboard.press('ArrowLeft')
      const caret = await editor.evaluate(node => {
        const selection = window.getSelection()
        return { inside: Boolean(selection?.anchorNode && node.contains(selection.anchorNode)), anchor: selection?.anchorOffset, focus: selection?.focusOffset }
      })
      expect(caret.inside).toBe(true)
      if (blockedStorage) await expect(page.getByText('This draft could not be kept on this device. Keep this page open until it says Saved.', { exact: true })).toBeVisible()
      await capture(page, info, 'live-draft')
      for (let index = 0; index < 2; index += 1) {
        retryAttempt = index + 1
        await page.getByRole('button', { name: 'Try again', exact: true }).click()
        await expect.poll(() => pendingRetries.has(index + 1)).toBe(true)
        expect(await original!.evaluate(node => node.isConnected)).toBe(true)
        expect(await pastLogs!.evaluate(node => node.isConnected)).toBe(true)
        await expect(editor).toHaveText(draft)
        expect(await editor.evaluate((node, previous) => node === previous, original)).toBe(true)
        expect(await editor.evaluate(node => {
          const selection = window.getSelection()
          return { inside: Boolean(selection?.anchorNode && node.contains(selection.anchorNode)), anchor: selection?.anchorOffset, focus: selection?.focusOffset }
        })).toEqual(caret)
        await expect(pastLog).toHaveAttribute('aria-expanded', 'true')
        await expect(page.getByText('Saved', { exact: true })).toHaveCount(0)
        if (blockedStorage) await expect(page.getByText('This draft could not be kept on this device. Keep this page open until it says Saved.', { exact: true })).toBeVisible()
        if (index === 1) {
          scrollBeforeRead = await scrollPane.evaluate(node => { node.scrollTop = 80; return node.scrollTop })
          expect(scrollBeforeRead).toBe(80)
        }
        await capture(page, info, `retry-${index + 1}-pending`)
        const completedRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/entries' && response.request().method() === 'GET' && response.status() === (index === 0 ? 503 : 200))
        readGates[index].resolve()
        await (await completedRead).finished()
        if (index === 0) await expect(page.getByText('The latest daily log could not be loaded.', { exact: true })).toBeVisible()
        else await expect(page.getByText('The latest daily log could not be loaded.', { exact: true })).toHaveCount(0)
        if (index === 1) {
          // Ensure the successful retry is reconciled before checking scroll.
          await expect.poll(() => page.getByText('Past log detail line 30', { exact: false }).count()).toBe(1)
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
          expect(await scrollPane.evaluate(node => node.isConnected)).toBe(true)
          scrollAfterRead = await scrollPane.evaluate(node => node.scrollTop)
          expect(scrollAfterRead).toBe(scrollBeforeRead)
        }
        await expect(editor).toHaveText(draft)
        expect(await original!.evaluate(node => node.isConnected)).toBe(true)
        await capture(page, info, `retry-${index + 1}-resolved`)
      }
      await editor.click()
      // Undo/redo the edit made before retry: this establishes retained history
      // without assuming how the editor groups rapidly consecutive typing.
      await page.keyboard.press('ControlOrMeta+z')
      await expect(editor).toHaveText('Saved baseline')
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(editor).toHaveText(draft)
      const continuationOffset = await editor.evaluate(node => {
        const selection = window.getSelection()
        if (!selection?.anchorNode || !node.contains(selection.anchorNode) || selection.anchorNode.textContent !== node.textContent) throw new Error('Expected journal text selection after redo')
        return selection.anchorOffset
      })
      await page.keyboard.insertText(' Continued')
      const continuedDraft = `${draft.slice(0, continuationOffset)} Continued${draft.slice(continuationOffset)}`
      await expect(editor).toHaveText(continuedDraft)
      await expect(editor).toBeFocused()
      saveGate.resolve()
      await expect(page.getByText('Controlled save failure', { exact: true })).toBeVisible()
      await expect(editor).toHaveText(continuedDraft)
      await expect(page.getByText('Saved', { exact: true })).toHaveCount(0)
      await capture(page, info, 'continued-edit-save-failure')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(errors).toEqual([])
      const expectedConsoleErrors = consoleErrors.filter(message => message.startsWith('Failed to load resource: the server responded with a status of 503') || message.startsWith('Error loading today tab: Error: Controlled read failure') || message.startsWith('Error saving: Error: Controlled save failure'))
      expect(consoleErrors.filter(message => !expectedConsoleErrors.includes(message))).toEqual([])
      const path = info.outputPath('journal-retry-receipt.json')
      await writeFile(path, JSON.stringify({ role: 'student', viewport: page.viewportSize(), theme: info.project.metadata.theme, motion, blockedStorage, today, errors, consoleErrors, expectedConsoleErrors, requests, reads, originalEditorRetained: true, pastLogsRetained: true, retainedDraft: continuedDraft, continuedTypingAndUndo: true, scrollBeforeRead, scrollAfterRead, persistedBackendWrites: 0, limits: 'Actual production ClassroomPageClient and StudentTodayTab in existing development-only guarded fixture, intercepted read/save contracts. Teacher owner unchanged. Scroll checks cover an already-scrolled mounted pane during successful retry, after deliberate retry-button activation. No authenticated backend, production performance or full-family completion proof.' }, null, 2))
      await info.attach('journal-retry-receipt', { path, contentType: 'application/json' })
      await pastLogs?.dispose()
      await scrollPane.dispose()
    } finally {
      readGates.forEach(gate => gate.resolve())
      saveGate.resolve()
      await original?.dispose()
    }
  })
}
