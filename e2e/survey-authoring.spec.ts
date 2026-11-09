import { expect, test } from '@playwright/test'
import type { SurveyQuestion, SurveyWithStats } from '@/types'

test.setTimeout(120_000)

const classroomId = '30000000-0000-4000-8000-000000000011'
const teacherId = '30000000-0000-4000-8000-000000000012'
const surveyId = '30000000-0000-4000-8000-000000000090'
const newSurveyId = '30000000-0000-4000-8000-000000000091'
const timestamp = '2026-01-01T00:00:00.000Z'
const sourceRevision = 'a'.repeat(64)
type Snapshot = {
  title: string
  show_results: boolean
  dynamic_responses: boolean
  questions: Array<Pick<SurveyQuestion, 'id' | 'question_type' | 'question_text' | 'options' | 'response_max_chars'>>
  editor?: { unresolved: boolean; markdownDirty?: boolean; [key: string]: unknown }
}

for (const mobile of [false, true]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`survey authoring ${mobile ? 'mobile' : 'desktop'} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      const surveys: Record<string, SurveyWithStats> = {
        [surveyId]: { id: surveyId, classroom_id: classroomId, title: 'Class feedback', status: 'draft',
          opens_at: null, show_results: true, dynamic_responses: false, position: 0, created_by: teacherId,
          created_at: timestamp, updated_at: timestamp, stats: { total_students: 2, responded: 0, questions_count: 2 } },
      }
      const questions: Record<string, SurveyQuestion[]> = {
        [surveyId]: [
          { id: '30000000-0000-4000-8000-000000000101', survey_id: surveyId, question_type: 'multiple_choice',
            question_text: 'Which activity helped you learn?', options: ['Group discussion', 'Practice problems', 'Independent reading'],
            response_max_chars: 1200, position: 0, created_at: timestamp, updated_at: timestamp },
          { id: '30000000-0000-4000-8000-000000000102', survey_id: surveyId, question_type: 'short_text',
            question_text: 'What would you like to practise next?', options: [], response_max_chars: 1200,
            position: 1, created_at: timestamp, updated_at: timestamp },
        ],
      }
      const drafts: Record<string, { revision: string; content: Snapshot }> = {}
      let revisionNumber = 0
      let creates = 0
      let writes = 0
      let loadError = true
      const draftPath = `/api/teacher/classrooms/${classroomId}/classwork-authoring/survey/`
      await page.route('**/api/**', async (route) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        const method = request.method()
        let body: unknown = {}
        if (path.startsWith(draftPath)) {
          const id = path.slice(draftPath.length)
          if (method === 'GET') {
            if (loadError) {
              await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Survey unavailable' }) })
              return
            }
            body = { item: { ...surveys[id], questions: questions[id] }, draft: drafts[id] ?? null, sourceRevision }
          } else if (id === 'new' && method === 'POST') {
            const input = request.postDataJSON() as { content: Snapshot }
            creates += 1
            writes += 1
            surveys[newSurveyId] = { ...surveys[surveyId], id: newSurveyId, title: 'Untitled Survey', status: 'draft', stats: { total_students: 2, responded: 0, questions_count: 0 } }
            questions[newSurveyId] = []
            drafts[newSurveyId] = { revision: `revision-${++revisionNumber}`, content: input.content }
            body = { item: surveys[newSurveyId], draft: drafts[newSurveyId], sourceRevision }
          } else if (method === 'PUT') {
            const input = request.postDataJSON() as { content: Snapshot; expectedRevision: string | null; expectedSourceRevision: string }
            expect(input.expectedRevision).toBe(drafts[id]?.revision ?? null)
            expect(input.expectedSourceRevision).toBe(sourceRevision)
            writes += 1
            drafts[id] = { revision: `revision-${++revisionNumber}`, content: input.content }
            body = { draft: drafts[id] }
          } else if (method === 'POST') {
            const input = request.postDataJSON() as { revision: string; publish?: boolean }
            expect(input.revision).toBe(drafts[id].revision)
            expect(drafts[id].content.editor?.unresolved).not.toBe(true)
            const snapshot = drafts[id].content
            surveys[id] = { ...surveys[id], title: snapshot.title, show_results: snapshot.show_results,
              dynamic_responses: snapshot.dynamic_responses, status: input.publish ? 'active' : surveys[id].status,
              stats: { ...surveys[id].stats, questions_count: snapshot.questions.length } }
            questions[id] = snapshot.questions.map((question, position) => ({ ...question, survey_id: id, position, created_at: timestamp, updated_at: timestamp }))
            delete drafts[id]
            body = { item: { ...surveys[id], questions: questions[id] }, sourceRevision }
          }
        } else if (path === '/api/teacher/surveys') body = { surveys: Object.values(surveys) }
        else if (path.startsWith('/api/teacher/surveys/') && path.endsWith('/results')) body = { survey: surveys[surveyId], results: [], stats: { total_students: 2, responded: 0 } }
        else if (path === '/api/teacher/assignments') body = { assignments: [] }
        else if (path === '/api/teacher/materials') body = { materials: [] }
        else if (path.endsWith('/class-days')) body = { class_days: [] }
        else if (path.endsWith('/roster')) body = { students: [] }
        else if (path === '/api/auth/me') body = { user: { id: teacherId, role: 'teacher', email: 'teacher@example.invalid' } }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      })
      await page.goto('/e2e-fixtures/teacher-student-tables?tab=assignments')
      await page.getByRole('button', { name: 'Class feedback', exact: true }).click()
      const openEditor = async () => {
        await page.getByTestId('survey-workspace-actionbar-center').getByRole('button').nth(1).click()
        await page.getByRole('menuitem', { name: 'Edit survey', exact: true }).click()
      }
      await openEditor()
      const dialog = page.getByRole('dialog', { name: 'Edit survey', exact: true })
      await expect(dialog.getByRole('alert')).toHaveText('Survey unavailable')
      loadError = false
      await dialog.getByRole('button', { name: 'Retry' }).click()
      const prompt = dialog.getByRole('textbox', { name: 'Prompt', exact: true })
      await expect(prompt).toContainText('Which activity helped you learn?')
      expect(writes).toBe(0)
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
      const details = await dialog.getByTestId('survey-editor-details-pane').boundingBox()
      const content = await dialog.getByTestId('survey-editor-content-pane').boundingBox()
      if (mobile) expect(content!.y).toBeGreaterThan(details!.y)
      else expect(content!.x).toBeGreaterThan(details!.x)
      await testInfo.attach('survey-editor', { body: await dialog.screenshot({ animations: 'disabled' }), contentType: 'image/png' })

      await prompt.fill('Which activity helped you learn today?')
      await expect.poll(() => drafts[surveyId]?.content.questions[0]?.question_text).toBe('Which activity helped you learn today?')
      expect(questions[surveyId][0].question_text).toBe('Which activity helped you learn?')
      await dialog.getByRole('button', { name: 'Next question' }).click()
      await expect(prompt).toContainText('What would you like to practise next?')
      await expect(dialog.getByRole('spinbutton', { name: 'Question number' })).toHaveValue('2')
      await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(dialog.getByText('Which activity helped you learn today?', { exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Back to editor' }).click()
      await dialog.getByRole('button', { name: 'Markdown' }).click()
      const markdown = dialog.getByRole('textbox', { name: 'Survey markdown editor' })
      const originalMarkdown = await markdown.inputValue()
      await markdown.fill(originalMarkdown.replace('Type: multiple_choice', 'Type: unsupported'))
      await dialog.getByRole('button', { name: 'Apply Markdown' }).click()
      await expect(dialog.getByRole('alert')).toContainText('Type')
      await markdown.fill(originalMarkdown.replace('Title: Class feedback', 'Title: Updated class feedback'))
      await dialog.getByRole('button', { name: 'Apply Markdown' }).click()
      await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Updated class feedback')
      expect(surveys[surveyId].title).toBe('Class feedback')
      await dialog.getByRole('button', { name: 'Close survey editor' }).click()
      await expect(dialog).toHaveCount(0)
      await openEditor()
      await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Updated class feedback')
      await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
      await expect.poll(() => surveys[surveyId].status).toBe('active')
      expect(surveys[surveyId].title).toBe('Updated class feedback')
      await dialog.getByRole('textbox', { name: 'Title' }).fill('Private revision')
      await expect.poll(() => drafts[surveyId]?.content.title).toBe('Private revision')
      expect(surveys[surveyId].title).toBe('Updated class feedback')
      await dialog.getByRole('button', { name: 'Apply changes' }).click()
      await expect.poll(() => surveys[surveyId].title).toBe('Private revision')
      await dialog.getByRole('button', { name: 'Close survey editor' }).click()
      await expect(dialog).toHaveCount(0)

      await page.goto('/e2e-fixtures/teacher-student-tables?tab=assignments')
      await page.getByRole('button', { name: 'New classwork', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Survey', exact: true }).click()
      await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused()
      expect(creates).toBe(0)
      await dialog.getByRole('button', { name: 'Close survey editor' }).click()
      expect(creates).toBe(0)
      await page.getByRole('button', { name: 'New classwork', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Survey', exact: true }).click()
      await dialog.getByRole('textbox', { name: 'New question' }).fill('An incomplete first question')
      await dialog.getByRole('button', { name: 'Close survey editor' }).click()
      await expect.poll(() => creates).toBe(1)
      expect(drafts[newSurveyId].content.editor?.unresolved).toBe(true)
      expect(drafts[newSurveyId].content.questions).toHaveLength(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      expect(errors).toEqual([])
    })
  }
}
