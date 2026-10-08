import { expect, test } from '@playwright/test'
test.setTimeout(90_000)

const classroomId = '30000000-0000-4000-8000-000000000011'
const teacherId = '30000000-0000-4000-8000-000000000012'
const timestamp = '2026-01-01T00:00:00.000Z'

for (const mobile of [false, true]) {
  for (const theme of ['light', 'dark']) {
    test(`created work placement ${mobile ? 'mobile' : 'desktop'} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 })
      await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      const assignments = [
        { id: 'released', classroom_id: classroomId, title: 'Released assignment', description: '', instructions_markdown: '', due_at: '2027-01-01T00:00:00Z', is_draft: false, position: 0, created_by: teacherId, created_at: timestamp, updated_at: timestamp, stats: { total_students: 0, submitted: 0, late: 0 } },
        { id: 'draft', classroom_id: classroomId, title: 'Existing draft', description: '', instructions_markdown: '', due_at: '2027-01-01T00:00:00Z', is_draft: true, position: 2, created_by: teacherId, created_at: timestamp, updated_at: timestamp, stats: { total_students: 0, submitted: 0, late: 0 } },
      ]
      const materials = [{ id: 'material', classroom_id: classroomId, title: 'Released material', content: '', is_draft: false, position: 1, created_by: teacherId, created_at: timestamp, updated_at: timestamp }]
      const survey = { id: 'new-survey', classroom_id: classroomId, title: 'New survey', status: 'draft', position: 3, show_results: true, dynamic_responses: false, created_by: teacherId, created_at: timestamp, updated_at: timestamp, stats: { total_students: 0, responded: 0, questions_count: 0 } }
      let created = false
      let role = 'teacher'
      const reorderBodies: unknown[] = []
      await page.route('**/api/**', async (route) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        let body: unknown = {}
        if (path === '/api/teacher/assignments') body = { assignments }
        else if (path.endsWith('/materials')) body = { materials }
        else if (path === '/api/teacher/surveys') {
          if (request.method() === 'POST') { created = true; body = { survey } }
          else body = { surveys: created ? [survey] : [] }
        } else if (path === `/api/teacher/surveys/${survey.id}`) body = { survey, questions: [] }
        else if (path.endsWith('/classwork/reorder')) {
          const payload = request.postDataJSON()
          reorderBodies.push(payload)
          for (const [position, item] of payload.items.entries()) {
            const row = [...assignments, ...materials, survey].find((row) => row.id === item.id)
            if (row) row.position = position
          }
          body = { success: true }
        } else if (path === '/api/student/assignments') body = { assignments: assignments.filter((row) => !row.is_draft).map((row) => ({ ...row, status: 'not_started', doc: null })) }
        else if (path === '/api/student/surveys') body = { surveys: [] }
        else if (path.endsWith('/gradebook-items')) body = { items: [] }
        else if (path.endsWith('/class-days')) body = { class_days: [] }
        else if (path.endsWith('/roster')) body = { students: [] }
        else if (path === '/api/auth/me') body = { user: { id: role === 'teacher' ? teacherId : '30000000-0000-4000-8000-000000000015', role, email: `${role}@example.invalid` } }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      })
      await page.goto('/e2e-fixtures/teacher-student-tables?tab=assignments')
      await expect(page.getByRole('button', { name: 'Existing draft', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'New classwork', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Survey', exact: true }).click()
      await expect.poll(() => reorderBodies.length).toBe(1)
      expect(reorderBodies[0]).toEqual({ items: [
        { type: 'assignment', id: 'released' }, { type: 'material', id: 'material' },
        { type: 'survey', id: 'new-survey' }, { type: 'assignment', id: 'draft' },
      ] })
      await page.getByRole('button', { name: 'Close survey editor' }).click()
      const assertTeacherOrder = async () => {
        const titles = ['Released assignment', 'Released material', 'New survey', 'Existing draft']
        let lastY = -1
        for (const title of titles) {
          const button = page.getByRole('button', { name: title === 'Released material' ? `Open ${title}` : title, exact: true })
          await expect(button).toBeVisible()
          const box = await button.boundingBox()
          expect(box!.y).toBeGreaterThan(lastY)
          lastY = box!.y
        }
      }
      await assertTeacherOrder()
      await page.reload()
      await assertTeacherOrder()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('teacher-created-placement.png'), animations: 'disabled' })
      role = 'student'
      await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=assignments')
      await expect(page.getByText('Released assignment', { exact: true })).toBeVisible()
      await expect(page.getByText('Released material', { exact: true })).toBeVisible()
      await expect(page.getByText('Existing draft', { exact: true })).toHaveCount(0)
      await expect(page.getByText('New survey', { exact: true })).toHaveCount(0)
      expect(pageErrors).toEqual([])
      await page.screenshot({ path: testInfo.outputPath('student-released-placement.png'), animations: 'disabled' })
    })
  }
}
