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
      await page.route('**/api/**', async (route) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        let body: unknown = {}
        if (path === '/api/teacher/surveys') {
          if (request.method() === 'POST') {
            createCount += 1
            survey = { ...survey, ...request.postDataJSON(), stats: { ...survey.stats, questions_count: 0 } }
            questions = []
            body = { survey }
          } else body = { surveys: [survey] }
        } else if (path === `/api/teacher/surveys/${surveyId}`) {
          if (request.method() === 'PATCH') survey = { ...survey, ...request.postDataJSON() }
          body = { survey, questions }
        } else if (path === `/api/teacher/surveys/${surveyId}/questions`) {
          const question = { ...request.postDataJSON(), id: `question-${questions.length + 1}`, survey_id: surveyId, position: questions.length, created_at: timestamp, updated_at: timestamp }
          questions.push(question)
          body = { question }
        } else if (path.startsWith(`/api/teacher/surveys/${surveyId}/questions/`)) {
          const id = path.split('/').pop()
          questions = questions.map((question) => question.id === id ? { ...question, ...request.postDataJSON() } : question)
          body = { question: questions.find((question) => question.id === id) }
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
      await expect(dialog.getByLabel('Prompt', { exact: true })).toHaveValue(questions[0].question_text)
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
      await capture('multiple-choice')
      await dialog.getByLabel('Prompt', { exact: true }).fill('Which activity helped you learn today?')
      await dialog.getByRole('button', { name: 'Edit question 2', exact: true }).click()
      await expect(dialog.getByLabel('Prompt', { exact: true })).toHaveValue(questions[1].question_text)
      expect(questions[0].question_text).toBe('Which activity helped you learn today?')
      await expect(dialog.getByLabel('Type', { exact: true })).toHaveValue('short_text')
      await capture('open-response')
      await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(dialog.getByText('Student preview', { exact: true })).toBeVisible()
      await capture('preview')
      await dialog.getByRole('button', { name: 'Code', exact: true }).click()
      await expect(dialog.getByLabel('Survey markdown editor')).toBeVisible()
      await capture('markdown')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      // Returning to Classwork opens the real creation menu, then directly opens an empty draft.
      await page.goto('/e2e-fixtures/teacher-student-tables?tab=assignments')
      await page.getByRole('button', { name: 'New classwork', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Survey', exact: true }).click()
      await expect(dialog.getByLabel('Survey title')).toBeFocused()
      await expect(dialog.getByLabel('New question', { exact: true })).toBeVisible()
      expect(createCount).toBe(1)
      await capture('new-draft')
      await dialog.getByLabel('New question', { exact: true }).fill('What should we explore next?')
      await dialog.getByLabel('Type', { exact: true }).selectOption('short_text')
      await dialog.getByRole('button', { name: 'Add question', exact: true }).click()
      await expect(dialog.getByLabel('Prompt', { exact: true })).toHaveValue('What should we explore next?')
      expect(questions[0].question_type).toBe('short_text')
      expect(errors).toEqual([])
    })
  }
}
