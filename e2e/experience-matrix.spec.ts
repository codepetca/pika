import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { PLANNED_COURSE_FIXTURE } from '../scripts/seed-planned-course-fixtures'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'
const BLUEPRINT_ID = '10000000-0000-4000-8000-000000000101'

const rolloverBlueprint = {
  id: BLUEPRINT_ID,
  teacher_id: '10000000-0000-4000-8000-000000000001',
  title: 'Computer Science 11',
  subject: 'Computer Science',
  grade_level: 'Grade 11',
  course_code: 'ICS3U',
  term_template: 'Semester 1',
  overview_markdown: '',
  outline_markdown: '',
  resources_markdown: '',
  planned_site_slug: null,
  planned_site_published: false,
  planned_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
  },
  position: 0,
  created_at: '2026-08-17T12:00:00.000Z',
  updated_at: '2026-08-17T12:00:00.000Z',
}

test.setTimeout(90_000)

type ExperienceMetadata = {
  theme: 'light' | 'dark'
  viewport: 'desktop' | 'mobile'
}

function getExperienceMetadata(testInfo: TestInfo): ExperienceMetadata {
  const { theme, viewport } = testInfo.project.metadata

  if ((theme !== 'light' && theme !== 'dark') || (viewport !== 'desktop' && viewport !== 'mobile')) {
    throw new Error(`Project ${testInfo.project.name} is missing experience matrix metadata`)
  }

  return { theme, viewport }
}

async function applyProjectTheme(page: Page, testInfo: TestInfo) {
  const { theme } = getExperienceMetadata(testInfo)
  await page.addInitScript((projectTheme) => {
    localStorage.setItem('theme', projectTheme)
  }, theme)
}

async function verifyProjectContract(page: Page, testInfo: TestInfo) {
  const { theme, viewport } = getExperienceMetadata(testInfo)
  const expectedWidth = viewport === 'mobile' ? 390 : 1440

  expect(page.viewportSize()?.width).toBe(expectedWidth)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe(theme)
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
}

async function verifyActiveClassroomTab(page: Page, testInfo: TestInfo, label: 'Daily' | 'Today') {
  const { viewport } = getExperienceMetadata(testInfo)

  if (viewport === 'mobile') {
    await page.getByRole('button', { name: 'Open classroom navigation' }).click()
  }

  await expect(page.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')

  if (viewport === 'mobile') {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open classroom navigation' })).toBeVisible()
  }
}

async function enterSeededClassroom(page: Page, role: 'teacher' | 'student') {
  await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })
  const classroom = page.getByRole('button', { name: /Test Classroom/ })
  await expect(classroom).toHaveCount(1)

  const response = await page.request.get(`/api/${role}/classrooms`)
  expect(response.ok()).toBe(true)
  const payload = await response.json() as { classrooms?: Array<{ id: string; title: string }> }
  const seededClassroom = payload.classrooms?.find((item) => item.title === 'Test Classroom')
  if (!seededClassroom) {
    throw new Error(`${role} browser fixture is missing Test Classroom`)
  }

  const tab = role === 'teacher' ? 'daily' : 'today'
  await page.goto(`/classrooms/${seededClassroom.id}?tab=${tab}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })

  return seededClassroom.id
}

async function mockBlueprintRollover(page: Page) {
  await page.route('**/api/teacher/course-blueprints', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ blueprints: [rolloverBlueprint] }),
    })
  })
  await page.route(`**/api/teacher/course-blueprints/${BLUEPRINT_ID}/instantiate`, async (route) => {
    expect(route.request().headers()['idempotency-key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        classroom: {
          id: '20000000-0000-4000-8000-000000000101',
          title: 'Computer Science 11 - Period 2',
        },
        lesson_mapping: {
          applied_lesson_templates: 2,
          overflow_lesson_templates: ['Final project workshop'],
        },
      }),
    })
  })
}

test.describe('teacher experience matrix', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test.beforeEach(async ({ page }, testInfo) => {
    await applyProjectTheme(page, testInfo)
  })

  test('opens the classroom attendance summary', async ({ page }, testInfo) => {
    await enterSeededClassroom(page, 'teacher')

    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('row', { name: /Student1 Test/ })).toBeVisible()
    await verifyActiveClassroomTab(page, testInfo, 'Daily')
    await verifyProjectContract(page, testInfo)
  })

  test('opens the shared teacher utility shell', async ({ page }, testInfo) => {
    await page.goto('/teacher/blueprints', { waitUntil: 'domcontentloaded' })

    const navigation = page.getByRole('navigation', { name: 'Teacher tools' })
    await expect(navigation.getByRole('link', { name: 'Blueprints' })).toHaveAttribute('aria-current', 'page')
    await verifyProjectContract(page, testInfo)
  })

  test('reviews a classroom created from a blueprint', async ({ page }, testInfo) => {
    await mockBlueprintRollover(page)
    await page.goto('/classrooms')
    await page.waitForLoadState('networkidle')
    const organizeButton = page.getByRole('button', { name: 'Organize classrooms' })
    await organizeButton.click()
    await expect(organizeButton).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByRole('textbox', { name: 'Classroom Name' }).fill('Computer Science 11 - Period 2')
    await page.getByRole('button', { name: 'Choose classroom creation path' }).click()
    await page.getByRole('menuitem', { name: 'From Course Blueprint' }).click()
    await page.getByRole('combobox', { name: 'Course Blueprint' }).selectOption(BLUEPRINT_ID)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByRole('heading', { name: 'Classroom Created' })).toBeFocused()
    await expect(page.getByText(/assignments and tests are unpublished/i)).toBeVisible()
    await expect(page.getByText('Final project workshop')).toBeVisible()
    const reviewButton = page.getByRole('button', { name: 'Review Classroom' })
    await expect(reviewButton).toBeVisible()
    await verifyProjectContract(page, testInfo)

    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(100)
    await page.screenshot({
      path: testInfo.outputPath('blueprint-rollover-review.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await reviewButton.click()
    await expect(page).toHaveURL(/\/classrooms\/20000000-0000-4000-8000-000000000101\?tab=assignments$/)
  })

  test('recovers an expired session and returns to the interrupted route', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('chromium-desktop'), 'Desktop recovery themes are sufficient')

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not authenticated' }),
      })
    })
    await page.goto('/teacher/blueprints', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL((url) => (
      url.pathname === '/login' &&
      url.searchParams.get('next') === '/teacher/blueprints' &&
      url.searchParams.get('reason') === 'session-expired'
    ))
    await expect(page.getByRole('status')).toContainText('Your session expired')
    await expect(page.getByLabel('School Email')).toBeFocused()

    await page.unroute('**/api/auth/me')
    await page.getByLabel('School Email').fill('teacher@example.com')
    await page.getByLabel('Password').fill('test1234')
    await page.getByRole('button', { name: 'Login' }).click()

    await expect(page).toHaveURL(/\/teacher\/blueprints$/)
    await expect(page.getByRole('navigation', { name: 'Teacher tools' })).toBeVisible()
    await verifyProjectContract(page, testInfo)
  })

  test('blocks a stale page after the session changes to another teacher', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'One account-change pass is sufficient')

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'different-teacher', email: 'other@example.com', role: 'teacher' },
        }),
      })
    })
    await page.goto('/teacher/blueprints', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL((url) => (
      url.pathname === '/login' &&
      url.searchParams.get('next') === '/teacher/blueprints' &&
      url.searchParams.get('reason') === 'session-changed'
    ))
    await expect(page.getByRole('status')).toContainText('signed-in account changed')
    await expect(page.getByLabel('School Email')).toBeFocused()
  })

  test('rejects canonicalized external login return paths', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'One redirect-safety pass is sufficient')

    for (const unsafePath of ['/a/..//evil.example', '/%2e%2e//evil.example']) {
      await page.goto(`/login?next=${encodeURIComponent(unsafePath)}`)
      await page.getByLabel('School Email').fill('teacher@example.com')
      await page.getByLabel('Password').fill('test1234')
      await page.getByRole('button', { name: 'Login' }).click()
      await expect(page).toHaveURL('/classrooms')
    }

    await verifyProjectContract(page, testInfo)
  })

  test('keeps failed syllabus documents unavailable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'One real-browser failure pass is sufficient')

    const classroomId = await enterSeededClassroom(page, 'teacher')
    const originalResponse = await page.request.get(`/api/teacher/classrooms/${classroomId}`)
    expect(originalResponse.ok()).toBe(true)
    const original = (await originalResponse.json() as {
      classroom: { actual_site_slug: string | null; actual_site_published: boolean }
    }).classroom
    const slug = `e2e-syllabus-${classroomId}`
    let responseStatus = 404

    try {
      const publishResponse = await page.request.patch(`/api/teacher/classrooms/${classroomId}`, {
        data: { actualSiteSlug: slug, actualSitePublished: true },
      })
      expect(publishResponse.ok()).toBe(true)

      await page.goto(`/classrooms/${classroomId}?tab=resources`, { waitUntil: 'domcontentloaded' })
      const preview = page.getByTitle('Test Classroom syllabus preview')
      await expect(preview).toHaveAttribute('tabindex', '0')
      await page.getByRole('link', { name: 'Open syllabus' }).focus()
      await page.keyboard.press('Tab')
      await expect(preview).toBeFocused()

      await page.route(`**/actual/${slug}*`, async (route) => {
        await route.fulfill({
          status: responseStatus,
          contentType: 'text/html',
          body: `<html><body>Syllabus failure ${responseStatus}</body></html>`,
        })
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(preview).toHaveAttribute('tabindex', '-1')
      await expect(page.getByText('Syllabus unavailable')).toBeVisible({ timeout: 20_000 })

      responseStatus = 500
      await page.getByRole('button', { name: 'Retry' }).click()
      await expect(preview).toHaveAttribute('src', new RegExp(`^/actual/${slug}\\?previewAttempt=1$`))
      await expect(preview).toHaveAttribute('tabindex', '-1')
      await expect(page.getByText('Syllabus unavailable')).toBeVisible({ timeout: 20_000 })
    } finally {
      const restoreResponse = await page.request.patch(`/api/teacher/classrooms/${classroomId}`, {
        data: {
          actualSitePublished: original.actual_site_published,
          actualSiteSlug: original.actual_site_slug,
        },
      })
      expect(restoreResponse.ok()).toBe(true)
    }
  })

  test('publishes and unpublishes the planned course through the Blueprint editor', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'One publication lifecycle pass is sufficient')

    await page.goto('/teacher/blueprints', { waitUntil: 'domcontentloaded' })
    await page.locator('aside').getByRole('button', { name: /Computer Science 11/ }).click()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()

    const publishCheckbox = page.getByRole('checkbox', {
      name: 'Publish this planned course site',
    })
    const saveButton = page.getByRole('button', { name: 'Save Planned Site' })
    await expect(publishCheckbox).toBeChecked()

    try {
      await publishCheckbox.uncheck()
      await saveButton.click()
      await expect(saveButton).toBeEnabled()
      await expect.poll(async () => (
        await page.request.get(`/planned/${PLANNED_COURSE_FIXTURE.publicSlug}`)
      ).status()).toBe(404)

      await publishCheckbox.check()
      await saveButton.click()
      await expect(saveButton).toBeEnabled()
      await expect.poll(async () => (
        await page.request.get(`/planned/${PLANNED_COURSE_FIXTURE.publicSlug}`)
      ).status()).toBe(200)
    } finally {
      const restore = await page.request.patch(
        `/api/teacher/course-blueprints/${PLANNED_COURSE_FIXTURE.blueprintId}`,
        {
          data: {
            planned_site_slug: PLANNED_COURSE_FIXTURE.publicSlug,
            planned_site_published: true,
            planned_site_config: {
              overview: true,
              outline: true,
              resources: true,
              assignments: true,
              tests: true,
              lesson_plans: true,
            },
          },
        },
      )
      expect(restore.ok()).toBe(true)
    }
  })
})

test.describe('student experience matrix', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test.beforeEach(async ({ page }, testInfo) => {
    await applyProjectTheme(page, testInfo)
  })

  test('opens the classroom daily workspace', async ({ page }, testInfo) => {
    await enterSeededClassroom(page, 'student')

    await expect(page.getByRole('heading', { name: 'Past logs' })).toBeVisible()
    await verifyActiveClassroomTab(page, testInfo, 'Today')
    await verifyProjectContract(page, testInfo)
  })

  test('opens the shared student utility shell', async ({ page }, testInfo) => {
    await page.goto('/student/history', { waitUntil: 'domcontentloaded' })

    const navigation = page.getByRole('navigation', { name: 'Student tools' })
    await expect(navigation.getByRole('link', { name: 'Attendance' })).toHaveAttribute('aria-current', 'page')
    await verifyProjectContract(page, testInfo)
  })

  test('keeps mobile attendance prompts classroom-scoped and confirms an idempotent scan', async ({ page }, testInfo) => {
    const classroomsResponse = await page.request.get('/api/student/classrooms')
    expect(classroomsResponse.ok()).toBe(true)
    const classroomsPayload = await classroomsResponse.json() as {
      classrooms?: Array<{ id: string; title: string }>
    }
    const classroom = classroomsPayload.classrooms?.find((item) => item.title === 'Test Classroom')
    if (!classroom) throw new Error('Student browser fixture is missing Test Classroom')

    const otherClassroomId = '20000000-0000-4000-8000-000000000099'
    let attendanceState: 'isolated' | 'open' | 'closed' | 'confirmed' = 'isolated'
    await page.route('**/api/student/attendance/status', async (route) => {
      const common = { opensAt: null, closesAt: null }
      const classrooms = attendanceState === 'isolated'
        ? [
            { classroomId: classroom.id, state: 'unavailable', ...common },
            { classroomId: otherClassroomId, state: 'open', ...common },
          ]
        : attendanceState === 'open'
          ? [{
              classroomId: classroom.id,
              state: 'open',
              opensAt: '2026-08-23T13:00:00.000Z',
              closesAt: '2099-08-23T14:00:00.000Z',
            }]
          : attendanceState === 'confirmed'
            ? [{
                classroomId: classroom.id,
                state: 'confirmed',
                ...common,
                attendanceStatus: 'present',
                confirmedAt: '2026-08-23T13:01:00.000Z',
              }]
            : [{ classroomId: classroom.id, state: 'closed', ...common }]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ classrooms, nextRefreshAt: null }),
      })
    })

    await page.goto(`/classrooms/${classroom.id}?tab=today`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('student-attendance-status')).toHaveCount(0)

    attendanceState = 'open'
    await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('status', { name: 'Attendance check-in is open' })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('student-attendance-index-open.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.goto(`/classrooms/${classroom.id}?tab=today`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Attendance check-in is open')).toBeVisible()
    await expect(page.getByText('Scan the QR shown by your teacher.')).toBeVisible()
    await verifyProjectContract(page, testInfo)
    await page.screenshot({
      path: testInfo.outputPath('student-attendance-open.png'),
      fullPage: true,
      animations: 'disabled',
    })

    attendanceState = 'closed'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('student-attendance-status')).toHaveCount(0)

    await page.route('**/api/student/attendance/check-in', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'already_checked_in',
          title: 'You are already checked in',
          description: 'No additional attendance record was created.',
          attendanceStatus: 'present',
          recordedAt: '2026-08-23T13:01:00.000Z',
          classroomId: classroom.id,
        }),
      })
    })
    await page.goto(`/attendance/check-in/${'A'.repeat(100)}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'You are already checked in' })).toBeVisible()

    attendanceState = 'confirmed'
    await page.getByRole('link', { name: 'Back to classroom' }).click()
    await expect(page.getByText('Checked in — Present')).toBeVisible()
    await expect(page.getByText(/Confirmed at 9:01/)).toBeVisible()
    await verifyProjectContract(page, testInfo)
    await page.screenshot({
      path: testInfo.outputPath('student-attendance-confirmed.png'),
      fullPage: true,
      animations: 'disabled',
    })
  })
})

test.describe('public planned course experience matrix', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await applyProjectTheme(page, testInfo)
  })

  test('shows only publishable course-plan content', async ({ page }, testInfo) => {
    const response = await page.goto(`/planned/${PLANNED_COURSE_FIXTURE.publicSlug}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(response?.status()).toBe(200)

    await expect(page.getByRole('heading', { level: 1, name: 'Computer Science 11' })).toBeVisible()
    for (const heading of ['Overview', 'Outline', 'Resources', 'Assignments', 'Tests', 'Lesson Sequence']) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
    }
    await expect(page.getByRole('heading', { level: 3, name: 'Algorithm Design Brief' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Programming Foundations Test' })).toBeVisible()
    await expect(page.getByText('1 question', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Tracing and Debugging' })).toBeVisible()

    const pageSource = `${await response!.text()}\n${await page.content()}`
    for (const privateValue of [
      PLANNED_COURSE_FIXTURE.blueprintId,
      PLANNED_COURSE_FIXTURE.assignmentId,
      PLANNED_COURSE_FIXTURE.assessmentId,
      PLANNED_COURSE_FIXTURE.lessonTemplateId,
      PLANNED_COURSE_FIXTURE.privateQuestion,
      PLANNED_COURSE_FIXTURE.privateAnswer,
      PLANNED_COURSE_FIXTURE.privateDocumentTitle,
      PLANNED_COURSE_FIXTURE.privateDocumentUrl,
      PLANNED_COURSE_FIXTURE.questionId,
      PLANNED_COURSE_FIXTURE.documentId,
      PLANNED_COURSE_FIXTURE.assignmentArtifactId,
      PLANNED_COURSE_FIXTURE.assessmentArtifactId,
      PLANNED_COURSE_FIXTURE.lessonTemplateArtifactId,
    ]) {
      expect(pageSource).not.toContain(privateValue)
    }

    const resourceLink = page.getByRole('link', { name: 'Python documentation' })
    await expect(resourceLink).toHaveAttribute('href', 'https://docs.python.org/3/')
    await expect(resourceLink).toHaveAttribute('target', '_blank')
    await expect(resourceLink).toHaveAttribute('rel', /noopener/)

    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Outline', exact: true })).toBeFocused()

    await verifyProjectContract(page, testInfo)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: testInfo.outputPath('planned-course-public.png'),
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('uses the same private not-found boundary for unpublished sites', async ({ page }, testInfo) => {
    const response = await page.goto(`/planned/${PLANNED_COURSE_FIXTURE.privateSlug}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'Course site not found' })).toBeVisible()
    await expect(page.getByText('Private Course Plan')).toHaveCount(0)
    await expect(page.getByText(/unavailable or has not been published/i)).toBeVisible()

    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Return to Pika' })).toBeFocused()
    await verifyProjectContract(page, testInfo)

    if (testInfo.project.name === 'chromium-desktop') {
      const missingResponse = await page.goto('/planned/e2e-course-that-does-not-exist', {
        waitUntil: 'domcontentloaded',
      })
      expect(missingResponse?.status()).toBe(404)
      await expect(page.getByRole('heading', { level: 1, name: 'Course site not found' })).toBeVisible()
    }

    await page.screenshot({
      path: testInfo.outputPath('planned-course-not-found.png'),
      fullPage: true,
      animations: 'disabled',
    })
  })
})
