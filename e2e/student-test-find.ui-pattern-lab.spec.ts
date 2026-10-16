import { expect, test } from '@playwright/test'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

test.use({ storageState: { cookies: [], origins: [] } })

test('blocks browser Find during the attempt without hiding real exits', async ({ page }, info) => {
  const testId = '30000000-0000-4000-8000-000000000013'
  const assessment = {
    id: testId, classroom_id: TABLE_CLASSROOM_ID, title: 'Find shortcut check',
    assessment_type: 'test', status: 'active', effective_access: 'open',
    student_status: 'not_started', show_results: false, documents: [], position: 0,
  }
  const questions = [{
    id: '60000000-0000-4000-8000-000000000001', test_id: testId,
    question_type: 'open_response', question_text: 'Explain your approach.',
    options: [], points: 1, position: 0, response_max_chars: 2000,
  }]
  const events: Array<{ event_type: string }> = []
  let responses = {}
  let revision = 41
  let submitted = false
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
  await mockTableShellReads(page, 'student')
  await page.route('**/api/student/tests**', async route => {
    const path = new URL(route.request().url()).pathname
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
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=tests')
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
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(() => events.some(event => event.event_type === 'away_start')).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(response).toHaveValue('My draft stays here.')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.getByRole('dialog', { name: 'Submit your answers?' }).getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByText('Response Submitted', { exact: true })).toBeVisible()
  expect(await dispatchFind()).toBe(true)
})
