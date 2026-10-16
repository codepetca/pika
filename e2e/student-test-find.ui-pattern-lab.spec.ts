import { expect, test } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

test.use({ storageState: { cookies: [], origins: [] } })

test('blocks Find and exempts selected-text browser focus without hiding real exits', async ({ page }, info) => {
  test.setTimeout(90_000)
  const testId = '30000000-0000-4000-8000-000000000013'
  const assessment = {
    id: testId, classroom_id: TABLE_CLASSROOM_ID, title: 'Find shortcut check',
    assessment_type: 'test', status: 'active', effective_access: 'open',
    student_status: 'not_started', show_results: false, documents: [{
      id: 'reference', title: 'Allowed HTML reference', source: 'link',
      url: 'https://example.invalid/reference', snapshot_path: 'synthetic.html', snapshot_content_type: 'text/html',
    }], position: 0,
  }
  const questions = [{
    id: '60000000-0000-4000-8000-000000000001', test_id: testId,
    question_type: 'open_response', question_text: 'Explain your approach.',
    options: [], points: 1, position: 0, response_max_chars: 2000,
  }]
  const events: Array<{ event_type: string; metadata?: Record<string, unknown> }> = []
  let responses = {}
  let revision = 41
  let submitted = false
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  await mockTableShellReads(page, 'student')
  await page.route('**/api/student/tests**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/snapshot')) return route.fulfill({ contentType: 'text/html', body: '<button>Read reference</button>' })
    if (path.endsWith('/session-status')) return route.fulfill({ json: { can_continue: true } })
    if (path.endsWith('/focus-events')) {
      events.push(route.request().postDataJSON())
      return route.fulfill({ json: { success: true } })
    }
    if (path.endsWith('/attempt')) {
      if (route.request().method() === 'PATCH') {
        responses = route.request().postDataJSON().responses
        revision++
      }
      return route.fulfill({ json: { attempt: { responses, draft_revision: revision } } })
    }
    if (path.endsWith('/start')) return route.fulfill({ json: { questions, attempt: { responses, draft_revision: revision } } })
    if (path.endsWith('/respond')) {
      submitted = true
      return route.fulfill({ json: { success: true } })
    }
    const current = { ...assessment, student_status: submitted ? 'submitted' : 'not_started' }
    if (path === '/api/student/tests') return route.fulfill({ json: { tests: [current] } })
    return route.fulfill({ json: { test: current, questions, student_status: current.student_status, student_responses: responses } })
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=tests', { timeout: 60_000 })
  await page.getByText(assessment.title, { exact: true }).first().click()
  const dispatchFind = () => page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'f', ctrlKey: true, cancelable: true, bubbles: true,
  })))
  expect(await dispatchFind()).toBe(true)
  // Keep compliance deterministic at both desktop and mobile fixture viewports.
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement })
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: () => Promise.resolve() })
  })
  await page.getByRole('button', { name: 'Start the Test', exact: true }).click()
  await page.getByRole('button', { name: 'Start test', exact: true }).click()
  const response = page.getByPlaceholder('Write your response...')
  await expect(response).toBeVisible()
  await response.fill('My draft stays here.')
  await page.evaluate(() => {
    window.addEventListener('keydown', event => {
      if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
        document.documentElement.dataset.findPrevented = String(event.defaultPrevented)
      }
    }, true)
  })
  for (const key of ['Control+f', 'Meta+f']) {
    await page.keyboard.press(key)
    await expect(page.locator('html')).toHaveAttribute('data-find-prevented', 'true')
    await expect(response).toBeFocused()
    await expect(response).toHaveValue('My draft stays here.')
  }
  // Wait beyond the former exemption, then prove no exit or lock was generated.
  await page.waitForTimeout(2200)
  expect(events).toEqual([])
  await expect(page.getByTestId('exam-content-obscurer')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('active-test-find-blocked.png'), animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

  expect(await dispatchFind()).toBe(false)
  await response.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 8)
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    window.dispatchEvent(new Event('blur'))
  })
  await page.waitForTimeout(900)
  expect(events).toEqual([])
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => events.filter(event => event.metadata?.source === 'browser_interaction').length).toBe(1)
  expect(events[0].event_type).toBe('away_end')
  await expect(response).toHaveValue('My draft stays here.')
  await page.screenshot({ path: info.outputPath('browser-interaction-return.png'), animations: 'disabled' })
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(() => events.some(event => event.event_type === 'away_start')).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(response).toHaveValue('My draft stays here.')
  await page.getByRole('button', { name: 'Allowed HTML reference', exact: true }).click()
  const frame = page.frameLocator('iframe[title="Allowed HTML reference"]')
  await frame.getByRole('button', { name: 'Read reference' }).focus()
  for (const key of ['Control+f', 'Meta+f']) {
    await frame.locator('body').evaluate(body => {
      body.ownerDocument.defaultView!.addEventListener('keydown', event => {
        body.dataset.findPrevented = String(event.defaultPrevented)
      }, true)
    })
    await page.keyboard.press(key)
    await expect(frame.locator('body')).toHaveAttribute('data-find-prevented', 'true')
  }
  const awayBeforeReferenceMenu = events.filter(event => event.event_type === 'away_start').length
  await frame.getByRole('button', { name: 'Read reference' }).evaluate(element => {
    const doc = element.ownerDocument
    const range = doc.createRange()
    range.selectNodeContents(element)
    doc.getSelection()!.removeAllRanges()
    doc.getSelection()!.addRange(range)
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  })
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForTimeout(900)
  expect(events.filter(event => event.event_type === 'away_start')).toHaveLength(awayBeforeReferenceMenu)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => events.filter(event => event.metadata?.source === 'browser_interaction').length).toBe(2)
  await page.screenshot({ path: info.outputPath('reference-find-blocked.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.getByRole('dialog', { name: 'Submit your answers?' }).getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByText('Response Submitted', { exact: true })).toBeVisible()
  expect(await dispatchFind()).toBe(true)
})

test('shows separate browser evidence without a teacher exit warning', async ({ page }, info) => {
  test.setTimeout(90_000)
  const testId = '30000000-0000-4000-8000-000000000013'
  const assessment = { id: testId, classroom_id: TABLE_CLASSROOM_ID, title: 'Browser interaction check',
    assessment_type: 'test', status: 'active', show_results: false, documents: [], position: 0,
    stats: { total_students: 1, responded: 0, submitted: 0, questions_count: 1 } }
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  await mockTableShellReads(page, 'teacher')
  await page.route('**/api/teacher/tests**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/results')) return route.fulfill({ json: {
      test: assessment, questions: [], active_ai_grading_run: null, students: [{
        student_id: '40000000-0000-4000-8000-000000000001', name: 'Student Alpha',
        first_name: 'Student', last_name: 'Alpha', email: 'student@example.invalid',
        status: 'not_started', points_earned: 0, points_possible: 1, percent: null,
        graded_open_responses: 0, ungraded_open_responses: 0, effective_access: 'open', access_source: 'test',
        focus_summary: { exit_count: 0, away_count: 0, away_total_seconds: 0, route_exit_attempts: 0,
          window_unmaximize_attempts: 0, browser_interaction_count: 2, browser_interaction_seconds: 8,
          last_away_started_at: null, last_away_ended_at: null },
      }],
    } })
    return route.fulfill({ json: { tests: [assessment] } })
  })
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=tests', { timeout: 60_000 })
  await page.getByText(assessment.title, { exact: true }).click()
  const exit = page.getByLabel(/Exits 0\. .*Browser interactions 2/)
  await expect(exit).toHaveCount(1)
  await expect(page.getByTestId('test-exit-detected-alert')).toHaveCount(0)
  if (info.project.metadata.viewport === 'desktop') {
    await exit.hover()
    await expect(page.getByRole('tooltip')).toContainText('Browser interactions: 2 (0:08), excluded from exits.')
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath('teacher-browser-evidence.png'), animations: 'disabled' })
})
