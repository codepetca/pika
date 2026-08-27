/**
 * Auth Setup - Generates storage states for authenticated users
 *
 * This file runs before all tests to create reusable auth sessions.
 * Storage states are saved to .auth/ directory and reused across tests.
 */
import { test as setup, expect } from '@playwright/test'

const TEACHER_EMAIL = process.env.E2E_TEACHER_EMAIL || 'teacher@example.com'
const STUDENT_EMAIL = process.env.E2E_STUDENT_EMAIL || 'student1@example.com'
const PASSWORD = process.env.E2E_PASSWORD || 'test1234'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'

/**
 * Logs in and saves authentication state
 */
async function authenticate(page: any, email: string, storagePath: string) {
  await page.goto('/login')

  // Fill login form
  await page.getByLabel('School Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)

  // Submit and wait for redirect
  await page.getByRole('button', { name: 'Login' }).click()
  await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/classrooms/)

  // Verify successful login
  await expect(page).toHaveURL(/\/classrooms/)

  // Save authentication state
  await page.context().storageState({ path: storagePath })
}

setup('authenticate as teacher', async ({ page }) => {
  await authenticate(page, TEACHER_EMAIL, TEACHER_STORAGE)

  const classroomsResponse = await page.request.get('/api/teacher/classrooms')
  expect(classroomsResponse.ok()).toBe(true)
  const payload = await classroomsResponse.json() as {
    classrooms?: Array<{ id: string; title: string }>
  }
  const classroom = payload.classrooms?.find((item) => item.title === 'Test Classroom')
  if (!classroom) throw new Error('Teacher browser fixture is missing Test Classroom')

  const guideResponse = await page.request.patch(`/api/teacher/classrooms/${classroom.id}`, {
    data: {
      courseOverviewMarkdown: 'This course develops practical problem-solving, collaboration, and communication skills through guided study and classroom work.',
      actualSiteSlug: 'e2e-test-course-guide',
      actualSitePublished: true,
      actualSiteConfig: {
        overview: true,
        outline: false,
        resources: true,
        assignments: true,
        tests: true,
        lesson_plans: true,
        announcements: true,
        lesson_plan_scope: 'current_week',
      },
    },
  })
  expect(guideResponse.ok()).toBe(true)
})

setup('authenticate as student', async ({ page }) => {
  await authenticate(page, STUDENT_EMAIL, STUDENT_STORAGE)
})
