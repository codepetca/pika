import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { PLANNED_COURSE_FIXTURE } from '../scripts/seed-planned-course-fixtures'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'
const BLUEPRINT_ID = '10000000-0000-4000-8000-000000000101'
const ATTENDANCE_FIXTURE_CLASSROOM_ID = '30000000-0000-4000-8000-000000000001'
const TEST_GRADING_FIXTURE_CLASSROOM_ID = '30000000-0000-4000-8000-000000000011'
const TEST_GRADING_FIXTURE_TEST_ID = '30000000-0000-4000-8000-000000000013'

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

async function captureCourseGuideState(page: Page, testInfo: TestInfo, state: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: `/tmp/pika-course-guide-${testInfo.project.name}-${state}.png`,
    fullPage: true,
    animations: 'disabled',
  })
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

test('keeps Attendance hours reachable across the responsive context bar', async ({ page }, testInfo) => {
  const { viewport } = getExperienceMetadata(testInfo)
  await applyProjectTheme(page, testInfo)

  await page.route('**/api/teacher/attendance/session?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classroomId: ATTENDANCE_FIXTURE_CLASSROOM_ID,
        classDate: '2026-08-17',
        integration: 'ready',
        session: {
          state: 'open',
          opensAt: '2026-08-17T12:45:00.000Z',
          closesAt: '2026-08-17T13:15:00.000Z',
          revision: 1,
          commandFailed: false,
        },
        sync: { state: 'current', confirmedAt: '2026-08-17T12:45:00.000Z' },
        students: [
          {
            studentId: '40000000-0000-4000-8000-000000000001',
            firstName: 'Ada',
            lastName: 'Lovelace',
            status: 'present',
            source: 'student_qr',
            revision: 1,
            pendingCommand: false,
            commandFailed: false,
          },
        ],
      }),
    })
  })
  await page.route('**/api/teacher/attendance/policy?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        policy: {
          classroomId: ATTENDANCE_FIXTURE_CLASSROOM_ID,
          timezone: 'America/Toronto',
          opensLocal: '08:45',
          closesLocal: '15:15',
          closeDayOffset: 0,
          enabled: true,
          revision: 1,
          updatedAt: '2026-08-17T12:00:00.000Z',
        },
      }),
    })
  })

  await page.goto('/e2e-fixtures/teacher-live-attendance', { waitUntil: 'domcontentloaded' })

  const trailingActions = page.getByTestId('attendance-trailing-actions')
  await expect(trailingActions).toBeVisible()
  await verifyProjectContract(page, testInfo)
  await page.screenshot({
    path: testInfo.outputPath(`attendance-${viewport}-context-bar.png`),
    fullPage: true,
    animations: 'disabled',
  })

  if (viewport === 'mobile') {
    const attendanceMenu = trailingActions.getByRole('button', { name: 'Attendance actions' })
    await expect(attendanceMenu).toBeVisible()
    await attendanceMenu.click()
    await expect(page.getByRole('menuitem', { name: 'Refresh attendance' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Attendance hours' }).click()
  } else {
    await expect(trailingActions.getByRole('button', { name: 'Refresh attendance' })).toBeVisible()
    await trailingActions.getByRole('button', { name: 'Attendance hours' }).click()
  }
  await expect(page.getByRole('dialog', { name: 'Attendance hours' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`attendance-${viewport}-hours-dialog.png`),
    fullPage: true,
    animations: 'disabled',
  })
})

test('keeps the selected Test grading roster compact and selection-driven', async ({ page }, testInfo) => {
  const { viewport } = getExperienceMetadata(testInfo)
  await applyProjectTheme(page, testInfo)

  const statuses = ['not_started', 'in_progress', 'closed', 'submitted', 'returned'] as const
  const students = Array.from({ length: 45 }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0')
    const status = statuses[index % statuses.length]
    const accessClosed = status === 'closed' || status === 'submitted' || status === 'returned'
    return {
      student_id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Student ${ordinal} Alpha${ordinal}`,
      first_name: `Student ${ordinal}`,
      last_name: `Alpha${ordinal}`,
      email: `student${ordinal}@example.com`,
      status,
      submitted_at: status === 'submitted' || status === 'returned' ? '2026-08-27T14:00:00.000Z' : null,
      returned_at: status === 'returned' ? '2026-08-27T15:00:00.000Z' : null,
      last_activity_at: status === 'not_started' ? null : '2026-08-27T14:15:00.000Z',
      points_earned: status === 'not_started' ? 0 : index % 10,
      points_possible: 10,
      percent: status === 'not_started' ? null : (index % 10) * 10,
      graded_open_responses: status === 'returned' ? 1 : 0,
      ungraded_open_responses: status === 'submitted' ? 1 : 0,
      access_state: accessClosed ? 'closed' : null,
      effective_access: accessClosed ? 'closed' : 'open',
      access_source: accessClosed ? 'student' : 'test',
      focus_summary: {
        away_count: index % 3,
        away_total_seconds: (index % 4) * 35,
        route_exit_attempts: index % 2,
        window_unmaximize_attempts: 0,
      },
    }
  })

  await page.route('**/api/teacher/tests**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === `/api/teacher/tests/${TEST_GRADING_FIXTURE_TEST_ID}/results`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          test: {
            id: TEST_GRADING_FIXTURE_TEST_ID,
            title: 'Functions and Graphs Test',
            status: 'active',
            grading_finalized_at: null,
          },
          questions: [{ id: 'question-1', question_type: 'open_response', response_monospace: false }],
          students,
          active_ai_grading_run: null,
        }),
      })
      return
    }

    if (
      url.pathname === '/api/teacher/tests' &&
      url.searchParams.get('classroom_id') === TEST_GRADING_FIXTURE_CLASSROOM_ID
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tests: [{
            id: TEST_GRADING_FIXTURE_TEST_ID,
            classroom_id: TEST_GRADING_FIXTURE_CLASSROOM_ID,
            title: 'Functions and Graphs Test',
            description: null,
            instructions: null,
            status: 'active',
            show_results: false,
            position: 0,
            documents: [],
            created_at: '2026-08-27T12:00:00.000Z',
            updated_at: '2026-08-27T12:00:00.000Z',
            stats: {
              total_students: students.length,
              responded: students.filter((student) => student.status !== 'not_started').length,
              submitted: students.filter((student) => student.status === 'submitted').length,
              open_access: students.filter((student) => student.effective_access === 'open').length,
              closed_access: students.filter((student) => student.effective_access === 'closed').length,
              questions_count: 1,
            },
          }],
        }),
      })
      return
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `Unhandled Test grading fixture route: ${url.pathname}` }),
    })
  })

  await page.goto('/e2e-fixtures/teacher-test-grading', { waitUntil: 'domcontentloaded' })

  const contextBar = page.getByTestId('test-grading-context-bar')
  const primaryControl = page.getByTestId('test-workspace-actionbar-center')
  const trailingActions = page.getByTestId('test-workspace-trailing-actions')
  const scrollPane = page.getByTestId('test-grading-student-scroll-pane')
  const selectAllCheckbox = page.getByRole('checkbox', { name: 'Select all students' })
  const firstStudentCheckbox = page.getByRole('checkbox', { name: 'Select Student 01 Alpha01' })
  await expect(contextBar).toContainText('Active')
  await expect(primaryControl.getByRole('button', { name: 'Open All' })).toBeVisible()
  await expect(primaryControl.getByRole('button', { name: 'Close All' })).toBeVisible()
  await expect(primaryControl.getByRole('button', { name: 'Student actions (select students to enable)' })).toBeDisabled()
  await expect(trailingActions).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sort Submitted first, 9 students' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Test grading actions' })).toBeVisible()
  await expect.poll(() => scrollPane.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expect(await page.evaluate(() => document.body.scrollHeight)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight + 1),
  )

  const primaryBox = await primaryControl.boundingBox()
  expect(primaryBox).not.toBeNull()
  expect(Math.abs((primaryBox!.x + primaryBox!.width / 2) - (page.viewportSize()!.width / 2))).toBeLessThan(3)
  expect(await primaryControl.locator('..').evaluate((element) => getComputedStyle(element).paddingTop)).toBe('0px')

  const [contextBox, scrollPaneBox, selectAllBox, firstStudentBox] = await Promise.all([
    contextBar.boundingBox(),
    scrollPane.boundingBox(),
    selectAllCheckbox.boundingBox(),
    firstStudentCheckbox.boundingBox(),
  ])
  expect(contextBox).not.toBeNull()
  expect(scrollPaneBox).not.toBeNull()
  expect(selectAllBox).not.toBeNull()
  expect(firstStudentBox).not.toBeNull()
  expect(scrollPaneBox!.y - (contextBox!.y + contextBox!.height)).toBeLessThanOrEqual(4)
  expect(Math.abs(
    (selectAllBox!.x + selectAllBox!.width / 2) -
    (firstStudentBox!.x + firstStudentBox!.width / 2),
  )).toBeLessThan(1)

  if (viewport === 'desktop') {
    await primaryControl.getByRole('button', { name: 'Open All' }).hover()
    await expect(page.getByRole('tooltip', { name: 'Open access for all students' })).toBeVisible()
  }
  await primaryControl.getByRole('button', { name: 'Close All' }).click()
  await expect(page.getByRole('dialog')).toContainText(`Close access for ${students.length} student(s)?`)
  await page.screenshot({
    path: testInfo.outputPath(`test-grading-${viewport}-close-all-confirm.png`),
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.screenshot({
    path: testInfo.outputPath(`test-grading-${viewport}-default.png`),
    animations: 'disabled',
  })

  await scrollPane.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(scrollPane.locator('thead')).toBeVisible()
  await page.getByRole('button', { name: 'Sort Submitted first, 9 students' }).click()
  await expect(page.getByRole('button', { name: 'Sort Submitted first, 9 students' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('checkbox', { name: 'Select Student 01 Alpha01' }).click()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  const gradingToolbar = page.getByRole('toolbar', { name: 'Test grading actions' })
  const studentActionsButton = gradingToolbar.getByRole('button', { name: 'Student actions for 1 selected' })
  await expect(studentActionsButton).toContainText('1 selected')
  await expect(gradingToolbar.getByRole('button', { name: 'Open All' })).toBeVisible()
  await expect(gradingToolbar.getByRole('button', { name: 'Close All' })).toBeVisible()
  const selectionBarBox = await gradingToolbar.boundingBox()
  const selectedScrollPaneBox = await scrollPane.boundingBox()
  expect(selectionBarBox).not.toBeNull()
  expect(selectedScrollPaneBox).not.toBeNull()
  expect(selectionBarBox!.y + selectionBarBox!.height).toBeLessThan(selectedScrollPaneBox!.y)
  await studentActionsButton.click()
  const studentActionsMenu = page.getByRole('menu', { name: 'Selected student actions' })
  for (const action of ['AI Grade', 'Unsubmit', 'Return', 'Delete Work']) {
    await expect(studentActionsMenu.getByRole('menuitem', { name: action })).toBeVisible()
  }
  await expect(studentActionsMenu.getByRole('menuitem', { name: /Open selected/i })).toHaveCount(0)
  await expect(studentActionsMenu.getByRole('menuitem', { name: /Clear selection/i })).toHaveCount(0)
  const menuBox = await studentActionsMenu.boundingBox()
  const tableHeadBox = await scrollPane.locator('thead').boundingBox()
  expect(menuBox).not.toBeNull()
  expect(tableHeadBox).not.toBeNull()
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(await studentActionsMenu.evaluate((element) => document.elementFromPoint(
    element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
    element.getBoundingClientRect().bottom - 2,
  ) === element || element.contains(document.elementFromPoint(
    element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
    element.getBoundingClientRect().bottom - 2,
  )))).toBe(true)
  expect(menuBox!.y).toBeLessThan(tableHeadBox!.y + tableHeadBox!.height)
  await page.screenshot({
    path: testInfo.outputPath(`test-grading-${viewport}-menu.png`),
    animations: 'disabled',
  })
  await studentActionsMenu.getByRole('menuitem', { name: 'AI Grade' }).click()
  await expect(page.getByRole('dialog')).toContainText('AI Grade selected students')
  await expect(page.getByRole('button', { name: 'Only ungraded' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Regrade all' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`test-grading-${viewport}-ai-grade-scope.png`),
    animations: 'disabled',
  })
  await page.getByRole('button', { name: 'Cancel' }).click()

  await verifyProjectContract(page, testInfo)
  await page.screenshot({
    path: testInfo.outputPath(`test-grading-${viewport}-selected.png`),
    animations: 'disabled',
  })
})

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

  test('shows retryable Course Guide API failures without an iframe', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'One real-browser failure pass is sufficient')

    const classroomId = await enterSeededClassroom(page, 'teacher')
    let responseStatus = 404

    await page.route(`**/api/classrooms/${classroomId}/course-guide`, async (route) => {
      await route.fulfill({
        status: responseStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Course Guide failure ${responseStatus}` }),
      })
    })

    await page.goto(`/classrooms/${classroomId}?tab=resources`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Course guide unavailable')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('iframe')).toHaveCount(0)

    responseStatus = 500
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Course guide unavailable')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('iframe')).toHaveCount(0)
  })

  test('authors the Course Guide inside its own pane', async ({ page }, testInfo) => {
    const classroomId = await enterSeededClassroom(page, 'teacher')
    await page.goto(`/classrooms/${classroomId}?tab=resources`, { waitUntil: 'domcontentloaded' })

    const editGuide = page.getByRole('button', { name: 'Edit guide' })
    await expect(editGuide).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Course Guide' })).toHaveCount(0)
    await captureCourseGuideState(page, testInfo, 'teacher-read')

    await editGuide.click()
    await expect(page.getByRole('button', {
      name: 'Edit curriculum overview and expectations',
    })).toHaveAttribute('aria-pressed', 'false')
    await captureCourseGuideState(page, testInfo, 'teacher-edit')

    await page.getByRole('button', { name: 'Edit resources' }).click()
    const resourcesEditor = page.getByRole('textbox', {
      name: 'Rules, links, and reference material',
    })
    await expect(resourcesEditor).toBeVisible()
    await page.waitForTimeout(350)
    await expect(resourcesEditor).toBeVisible()
    await captureCourseGuideState(page, testInfo, 'teacher-resources-editor')

    await page.getByRole('button', {
      name: 'Edit curriculum overview and expectations',
    }).click()
    const overviewEditor = page.getByRole('textbox', {
      name: 'Curriculum overview and expectations',
    })
    await expect(overviewEditor).toBeVisible()
    await captureCourseGuideState(page, testInfo, 'teacher-overview-editor')

    const optionsButton = page.getByRole('button', { name: 'Guide options' })
    await optionsButton.click()
    await expect(page.getByRole('dialog', { name: 'Guide options' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await captureCourseGuideState(page, testInfo, 'teacher-options')
    await page.getByRole('button', { name: 'Share guide publicly' }).click()
    await expect(page.getByLabel('Public page address')).toBeVisible()
    await captureCourseGuideState(page, testInfo, 'teacher-options-public')
    await page.keyboard.press('Escape')
    await expect(optionsButton).toBeFocused()

    if (testInfo.project.name === 'chromium-desktop') {
      let releaseSave: (() => void) | undefined
      const saveMayFinish = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      await page.route(`**/api/teacher/classrooms/${classroomId}`, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        await saveMayFinish
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Course Guide save unavailable' }),
        })
      })
      await overviewEditor.fill(`${await overviewEditor.textContent()} Temporary visual check`)
      await page.getByRole('button', { name: 'Save overview' }).click()
      await expect(page.getByRole('button', { name: 'Saving...' })).toBeDisabled()
      await captureCourseGuideState(page, testInfo, 'teacher-saving')
      releaseSave?.()
      await expect(page.getByText('Course Guide save unavailable', { exact: true })).toBeVisible()
      await captureCourseGuideState(page, testInfo, 'teacher-save-error')
    }

    await verifyProjectContract(page, testInfo)
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

  test('reads the Course Guide as a clean in-Pika document', async ({ page }, testInfo) => {
    const classroomId = await enterSeededClassroom(page, 'student')
    await page.goto(`/classrooms/${classroomId}?tab=resources`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', {
      name: 'Curriculum overview and expectations',
    })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit guide' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Guide options' })).toHaveCount(0)
    await expect(page.locator('iframe')).toHaveCount(0)
    await captureCourseGuideState(page, testInfo, 'student-read')
    await verifyProjectContract(page, testInfo)
  })

  test('opens the shared student utility shell', async ({ page }, testInfo) => {
    await page.goto('/student/history', { waitUntil: 'domcontentloaded' })

    const navigation = page.getByRole('navigation', { name: 'Student tools' })
    await expect(navigation.getByRole('link', { name: 'Attendance' })).toHaveAttribute('aria-current', 'page')
    await verifyProjectContract(page, testInfo)
  })

  test('keeps mobile attendance prompts classroom-scoped and confirms an idempotent scan', async ({ page }, testInfo) => {
    const authResponse = await page.request.get('/api/auth/me')
    expect(authResponse.ok()).toBe(true)
    const authPayload = await authResponse.json() as { user: { id: string } }
    const classroomsResponse = await page.request.get('/api/student/classrooms')
    expect(classroomsResponse.ok()).toBe(true)
    const classroomsPayload = await classroomsResponse.json() as {
      classrooms?: Array<{ id: string; title: string }>
    }
    const classroom = classroomsPayload.classrooms?.find((item) => item.title === 'Test Classroom')
    if (!classroom) throw new Error('Student browser fixture is missing Test Classroom')

    const otherClassroomId = '20000000-0000-4000-8000-000000000099'
    const occurrenceBinding = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
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
              occurrenceBinding,
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
        headers: { 'X-Pika-Student-Id': authPayload.user.id },
        body: JSON.stringify({
          studentId: authPayload.user.id,
          classrooms,
          nextRefreshAt: null,
          serverNow: '2026-08-23T13:30:00.000Z',
        }),
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
    await expect(page.getByText('Scan QR for Attendance').filter({ visible: true })).toBeVisible()
    await expect(page.getByText('Attendance check-in is open')).toHaveCount(0)
    await verifyProjectContract(page, testInfo)
    await page.screenshot({
      path: testInfo.outputPath('student-attendance-open.png'),
      fullPage: true,
      animations: 'disabled',
    })

    attendanceState = 'closed'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('student-attendance-status')).toHaveCount(0)

    attendanceState = 'open'
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
          studentId: authPayload.user.id,
          occurrenceBinding,
        }),
      })
    })
    await page.goto(`/attendance/check-in/${'A'.repeat(100)}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'You are already checked in' })).toBeVisible()

    await page.getByRole('link', { name: 'Back to classroom' }).click()
    await expect(page.getByText('Checked in at 9:01 AM').filter({ visible: true })).toBeVisible()
    await expect(page.getByText('Checked in — Present')).toHaveCount(0)
    await expect(page.getByText(/Confirmed at 9:01/)).toHaveCount(0)
    await verifyProjectContract(page, testInfo)
    await page.screenshot({
      path: testInfo.outputPath('student-attendance-confirmed.png'),
      fullPage: true,
      animations: 'disabled',
    })

    attendanceState = 'closed'
    await expect(page.getByTestId('student-attendance-status')).toHaveCount(0, {
      timeout: 10_000,
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
