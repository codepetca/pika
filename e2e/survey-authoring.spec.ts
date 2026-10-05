import { expect, test } from '@playwright/test'
import type { SurveyQuestion, SurveyWithStats } from '@/types'

const classroomId = '30000000-0000-4000-8000-000000000011'
const teacherId = '30000000-0000-4000-8000-000000000012'
const surveyId = '30000000-0000-4000-8000-000000000090'
const timestamp = '2026-01-01T00:00:00.000Z'

for (const mobile of [false, true]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`survey authoring ${mobile ? 'mobile' : 'desktop'} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      let survey: SurveyWithStats = {
        id: surveyId, classroom_id: classroomId, title: 'Class feedback', status: 'draft',
        opens_at: null, show_results: true, dynamic_responses: false, position: 0,
        created_by: teacherId, created_at: timestamp, updated_at: timestamp,
        stats: { total_students: 2, responded: 0, questions_count: 2 },
      }
      let questions: SurveyQuestion[] = [
        { id: 'question-1', survey_id: surveyId, question_type: 'multiple_choice',
          question_text: 'Which activity helped you learn?', options: ['Group discussion', 'Practice problems', 'Independent reading'],
          response_max_chars: 1200, position: 0, created_at: timestamp, updated_at: timestamp },
        { id: 'question-2', survey_id: surveyId, question_type: 'short_text',
          question_text: 'What would you like to practise next?', options: [],
          response_max_chars: 1200, position: 1, created_at: timestamp, updated_at: timestamp },
      ]
      let createCount = 0
      let nextQuestionId = 3
      let loadError = true
      await page.route('**/api/**', async (route) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        let body: unknown = {}
        if (path === '/api/teacher/surveys') {
          if (request.method() === 'POST') {
            createCount += 1
            survey = { ...survey, ...request.postDataJSON(), status: 'draft', stats: { ...survey.stats, questions_count: 0 } }
            questions = []
            body = { survey }
          } else body = { surveys: [survey] }
        } else if (path === `/api/teacher/surveys/${surveyId}`) {
          if (request.method() === 'GET' && loadError) {
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Survey unavailable' }) })
            return
          }
          if (request.method() === 'PATCH') survey = { ...survey, ...request.postDataJSON() }
          body = { survey, questions }
        } else if (path === `/api/teacher/surveys/${surveyId}/questions`) {
          const question = { ...request.postDataJSON(), id: `question-${nextQuestionId++}`, survey_id: surveyId, position: questions.length, created_at: timestamp, updated_at: timestamp }
          questions.push(question)
          body = { question }
        } else if (path.startsWith(`/api/teacher/surveys/${surveyId}/questions/`)) {
          const id = path.split('/').pop()
          if (request.method() === 'DELETE') {
            questions = questions.filter((question) => question.id !== id)
            body = { success: true }
          } else {
            questions = questions.map((question) => question.id === id ? { ...question, ...request.postDataJSON() } : question)
            body = { question: questions.find((question) => question.id === id) }
          }
        } else if (path.endsWith('/results')) body = { survey, results: [], stats: { total_students: 2, responded: 0 } }
        else if (path === '/api/teacher/assignments') body = { assignments: [] }
        else if (path === '/api/teacher/materials') body = { materials: [] }
        else if (path.endsWith('/class-days')) body = { class_days: [] }
        else if (path.endsWith('/roster')) body = { students: [] }
        else if (path === '/api/auth/me') body = { user: { id: teacherId, role: 'teacher', email: 'teacher@example.invalid' } }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      })
      await page.goto('/e2e-fixtures/teacher-student-tables?tab=assignments')
      await page.getByRole('button', { name: 'Class feedback', exact: true }).click()
      await page.getByTestId('survey-workspace-actionbar-center').getByRole('button').nth(1).click()
      await page.getByRole('menuitem', { name: 'Edit survey', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit survey', exact: true })
      await expect(dialog.getByRole('alert')).toHaveText('Survey unavailable')
      await dialog.screenshot({ path: testInfo.outputPath('unavailable.png'), animations: 'disabled' })
      await dialog.getByRole('button', { name: 'Close survey editor' }).click()
      await expect(dialog).toHaveCount(0)
      await page.getByTestId('survey-workspace-actionbar-center').getByRole('button').nth(1).click()
      await page.getByRole('menuitem', { name: 'Edit survey', exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText('Survey unavailable')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      loadError = false
      await page.getByTestId('survey-workspace-actionbar-center').getByRole('button').nth(1).click()
      await page.getByRole('menuitem', { name: 'Edit survey', exact: true }).click()
      await expect(dialog.getByRole('textbox', { name: 'Prompt', exact: true })).toContainText(questions[0].question_text)
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
      const capture = async (state: string) => {
        await testInfo.attach(state, { body: await dialog.screenshot({ path: testInfo.outputPath(`${state}.png`), animations: 'disabled' }), contentType: 'image/png' })
        if (mobile) {
          await dialog.getByTestId('survey-editor-content-pane').scrollIntoViewIfNeeded()
          await testInfo.attach(`${state}-content`, { body: await dialog.screenshot({ path: testInfo.outputPath(`${state}-content.png`), animations: 'disabled' }), contentType: 'image/png' })
        }
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      }
      const details = await dialog.getByTestId('survey-editor-details-pane').boundingBox()
      const content = await dialog.getByTestId('survey-editor-content-pane').boundingBox()
      if (mobile) expect(content!.y).toBeGreaterThan(details!.y)
      else {
        expect(content!.x).toBeGreaterThan(details!.x)
        expect(content!.width / details!.width).toBeCloseTo(2, 0)
      }
      const prompt = dialog.getByRole('textbox', { name: 'Prompt', exact: true })
      const number = dialog.getByRole('spinbutton', { name: 'Question number' })
      const actions = dialog.getByRole('button', { name: 'Question actions', exact: true })
      await capture('multiple-choice')
      await prompt.fill('Which activity helped you learn today?')
      await dialog.getByRole('textbox', { name: 'Option A', exact: true }).fill('Updated group discussion')
      await dialog.getByRole('button', { name: /Reorder option A;/ }).press('ArrowDown')
      await expect(dialog.getByRole('textbox', { name: 'Option B', exact: true })).toHaveValue('Updated group discussion')
      await dialog.getByRole('button', { name: 'Next question', exact: true }).click()
      await expect(prompt).toContainText('What would you like to practise next?')
      expect(questions[0].question_text).toBe('Which activity helped you learn today?')
      expect(questions[0].options).toEqual(['Practice problems', 'Updated group discussion', 'Independent reading'])
      await expect(number).toHaveValue('2')
      await expect(dialog.getByRole('spinbutton', { name: 'Response character limit' })).toHaveValue('1200')
      await capture('open-response')

      await actions.click()
      await page.getByRole('menuitem', { name: 'Add multiple-choice question', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'New question', exact: true }).fill('An incomplete question to discard')
      await capture('staged-question')
      await dialog.getByRole('button', { name: 'Cancel new question' }).click()
      await expect(prompt).toContainText('What would you like to practise next?')
      await expect(number).toHaveValue('2')
      expect(questions.length).toBe(2)

      await actions.click()
      await page.getByRole('menuitem', { name: 'Duplicate question', exact: true }).click()
      await expect.poll(() => questions.length).toBe(3)
      await expect(prompt).toContainText('What would you like to practise next?')
      await actions.click()
      await page.getByRole('menuitem', { name: 'Delete question', exact: true }).click()
      await expect.poll(() => questions.length).toBe(2)
      await expect(number).toHaveValue('2')

      const settings = dialog.getByRole('button', { name: 'Settings', exact: true })
      await settings.press('Enter')
      await expect(page.getByRole('menuitemcheckbox', { name: 'Show class results to students' })).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Space')
      await expect.poll(() => survey.dynamic_responses).toBe(true)
      await settings.click()
      await expect(page.getByRole('menuitemcheckbox', { name: 'Allow students to update responses' })).toHaveAttribute('aria-checked', 'true')
      await capture('settings')
      await page.keyboard.press('Escape')
      await expect(settings).toBeFocused()

      await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(dialog.getByText('Student preview', { exact: true })).toBeVisible()
      await expect(dialog.getByText('Which activity helped you learn today?', { exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Updated group discussion', exact: true })).toBeVisible()
      await capture('preview')
      await dialog.getByRole('button', { name: 'Back to editor', exact: true }).click()
      await expect(prompt).toBeVisible()
      await dialog.getByRole('button', { name: 'Markdown', exact: true }).click()
      const markdown = dialog.getByRole('textbox', { name: 'Survey markdown editor' })
      await expect(markdown).toBeVisible()
      const originalMarkdown = await markdown.inputValue()
      await markdown.fill(originalMarkdown.replace('Type: multiple_choice', 'Type: unsupported'))
      await dialog.getByRole('button', { name: 'Apply Markdown', exact: true }).click()
      await expect(dialog.getByText(/Type must be multiple_choice, short_text, or link/)).toBeVisible()
      await markdown.fill(originalMarkdown.replace('Title: Class feedback', 'Title: Updated class feedback'))
      await capture('markdown')
      await dialog.getByRole('button', { name: 'Apply Markdown', exact: true }).click()
      await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Updated class feedback')
      expect(survey.title).toBe('Updated class feedback')
      await expect(prompt).toBeVisible()
      await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
      await expect.poll(() => survey.status).toBe('active')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)

      // The real creation menu creates a draft and opens the same authoring surface.
      await page.goto('/e2e-fixtures/teacher-student-tables?tab=assignments')
      await page.getByRole('button', { name: 'New classwork', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Survey', exact: true }).click()
      await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused()
      await expect(dialog.getByRole('textbox', { name: 'New question', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
      expect(createCount).toBe(1)
      await capture('new-draft')
      await dialog.getByRole('textbox', { name: 'New question', exact: true }).fill('An incomplete first question')
      await dialog.getByRole('button', { name: 'Cancel new question' }).click()
      await expect(dialog.getByRole('textbox', { name: 'New question', exact: true })).toBeEmpty()
      expect(questions).toHaveLength(0)
      await actions.click()
      await page.getByRole('menuitem', { name: 'Add open-response question', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'New question', exact: true }).fill('What should we explore next?')
      await dialog.getByRole('button', { name: 'Add question', exact: true }).click()
      await expect(prompt).toContainText('What should we explore next?')
      expect(questions[0].question_type).toBe('short_text')
      await expect(dialog.getByRole('spinbutton', { name: 'Response character limit' })).toHaveValue('500')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      expect(errors).toEqual([])
    })
  }
}
