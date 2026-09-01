import {
  expect,
  test,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { PLANNED_COURSE_FIXTURE } from '../scripts/seed-planned-course-fixtures'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'
const BLUEPRINT_ID = '10000000-0000-4000-8000-000000000101'
const ATTENDANCE_FIXTURE_CLASSROOM_ID = '30000000-0000-4000-8000-000000000001'
const TEST_GRADING_FIXTURE_CLASSROOM_ID = '30000000-0000-4000-8000-000000000011'
const TEST_GRADING_FIXTURE_TEST_ID = '30000000-0000-4000-8000-000000000013'
const PUBLIC_ACTUAL_COURSE_SLUG = 'e2e-test-course-guide'

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

test('keeps the Attendance roster compact with inline status controls', async ({ page }, testInfo) => {
  const { viewport } = getExperienceMetadata(testInfo)
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await applyProjectTheme(page, testInfo)

  const attendanceStatuses = ['present', 'late', 'absent', 'unmarked'] as const
  let hasAttendanceWindow = true
  let attendanceSessionState: 'open' | 'closed' = 'open'
  let attendanceStudents = Array.from({ length: 45 }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0')
    const status = attendanceStatuses[index % attendanceStatuses.length]
    const source = index === 1 ? 'staff' : index % 3 === 0 ? 'student_qr' : index % 3 === 1 ? 'staff' : null
    const checkedInAt = source === 'student_qr' || index === 1
      ? `2026-08-17T12:${String(48 + (index % 12)).padStart(2, '0')}:00.000Z`
      : null
    return {
      studentId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      firstName: `Student ${ordinal}`,
      lastName: `Alpha${ordinal}`,
      status,
      source,
      checkedInAt,
      revision: status === 'unmarked' ? null : 1,
      hasQrCheckIn: Boolean(checkedInAt),
      hasManualOverride: source === 'staff',
      pendingCommand: false,
      commandFailed: false,
    }
  })

  await page.route('**/api/teacher/attendance/session?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classroomId: ATTENDANCE_FIXTURE_CLASSROOM_ID,
        classDate: '2026-08-17',
        integration: 'ready',
        session: {
          state: hasAttendanceWindow ? attendanceSessionState : 'not_scheduled',
          opensAt: hasAttendanceWindow ? '2026-08-17T04:45:00.000Z' : null,
          closesAt: hasAttendanceWindow ? '2026-08-18T02:34:00.000Z' : null,
          sessionStartsAt: hasAttendanceWindow ? '2026-08-17T12:55:00.000Z' : null,
          sessionEndsAt: hasAttendanceWindow ? '2026-08-17T13:25:00.000Z' : null,
          presentThroughAt: hasAttendanceWindow ? '2026-08-17T13:00:00.000Z' : null,
          absentAt: hasAttendanceWindow ? '2026-08-17T13:25:00.000Z' : null,
          revision: 1,
          commandFailed: false,
        },
        sync: { state: 'current', confirmedAt: '2026-08-17T12:45:00.000Z' },
        students: attendanceStudents,
      }),
    })
  })
  await page.route('**/api/teacher/attendance/marks', async (route) => {
    const body = route.request().postDataJSON() as {
      marks: Array<{ student_id: string; status: typeof attendanceStatuses[number] | 'automatic' }>
    }
    const statusByStudentId = new Map(body.marks.map((mark) => [mark.student_id, mark.status]))
    attendanceStudents = attendanceStudents.map((student) => {
      const status = statusByStudentId.get(student.studentId)
      return status === 'automatic'
        ? { ...student, source: student.checkedInAt ? 'student_qr' as const : null, hasManualOverride: false }
        : status
          ? { ...student, status, source: 'staff' as const, hasManualOverride: true, revision: (student.revision ?? 0) + 1 }
        : student
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ outcome: 'applied', appliedCount: body.marks.length }),
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
          sessionStartsLocal: '09:00',
          sessionEndsLocal: '10:00',
          sessionEndDayOffset: 0,
          entryOpensMinutesBefore: 10,
          presentGraceMinutes: 5,
          entryClosesMinutesBeforeEnd: 10,
          absentMinutesBeforeEnd: 0,
          enabled: true,
          revision: 1,
          updatedAt: '2026-08-17T12:00:00.000Z',
        },
      }),
    })
  })

  await page.goto('/e2e-fixtures/teacher-live-attendance', { waitUntil: 'domcontentloaded' })

  const contextBar = page.getByTestId('attendance-context-bar')
  const primaryControl = page.getByTestId('attendance-primary-control')
  const trailingActions = page.getByTestId('attendance-trailing-actions')
  const scrollPane = page.getByTestId('attendance-student-scroll-pane')
  const dateButton = primaryControl.getByRole('button', { name: 'Go to today' })
  const previousDayButton = primaryControl.getByRole('button', { name: 'Previous day' })
  const nextDayButton = primaryControl.getByRole('button', { name: 'Next day' })
  const attendanceHours = contextBar.getByRole('button', {
    name: 'Attendance hours, Open, 12:45 AM to 10:34 PM',
  })
  if (viewport === 'mobile') await expect(trailingActions).toBeHidden()
  else {
    await expect(attendanceHours).toHaveText('12:45 AM - 10:34 PM')
    await expect(attendanceHours).not.toContainText('Open')
    await expect(attendanceHours).toHaveClass(/bg-success-bg/)
    await expect(trailingActions).toBeVisible()
    await expect(primaryControl.getByRole('button', {
      name: 'Attendance hours, Open, 12:45 AM to 10:34 PM',
    })).toHaveCount(0)
    const [contextBox, attendanceHoursBox] = await Promise.all([
      contextBar.boundingBox(),
      attendanceHours.boundingBox(),
    ])
    expect(contextBox).not.toBeNull()
    expect(attendanceHoursBox).not.toBeNull()
    expect(attendanceHoursBox!.x - contextBox!.x).toBeLessThan(24)
    expect(attendanceHoursBox!.width).toBeLessThan(190)
  }
  await expect(page.getByRole('checkbox')).toHaveCount(46)
  await expect(primaryControl.getByRole('button', {
    name: 'Student actions (select students to enable)',
  })).toBeDisabled()
  await expect(dateButton.locator('svg')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sort Present first, 12 students' })).toBeVisible()
  const [firstStudentRowHeight, presentCountWidth] = await Promise.all([
    page.getByRole('row').nth(1).evaluate((element) => element.getBoundingClientRect().height),
    page.getByRole('button', { name: 'Sort Present first, 12 students' })
      .locator('span')
      .evaluate((element) => element.getBoundingClientRect().width),
  ])
  expect(firstStudentRowHeight).toBeLessThanOrEqual(46)
  expect(presentCountWidth).toBeCloseTo(28, 1)
  await expect(page.getByRole('group', { name: 'Sort attendance by status' }).locator('xpath=ancestor::th')).not.toContainText('Status')
  await expect.poll(() => scrollPane.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  expect(await page.evaluate(() => document.body.scrollHeight)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight + 1),
  )

  const [primaryBox, previousBox, dateBox, nextBox] = await Promise.all([
    primaryControl.boundingBox(),
    previousDayButton.boundingBox(),
    dateButton.boundingBox(),
    nextDayButton.boundingBox(),
  ])
  expect(primaryBox).not.toBeNull()
  expect(previousBox).not.toBeNull()
  expect(dateBox).not.toBeNull()
  expect(nextBox).not.toBeNull()
  expect(Math.abs((primaryBox!.x + primaryBox!.width / 2) - (page.viewportSize()!.width / 2))).toBeLessThan(3)
  expect(Math.abs((previousBox!.x + previousBox!.width) - dateBox!.x)).toBeLessThan(1)
  expect(Math.abs((dateBox!.x + dateBox!.width) - nextBox!.x)).toBeLessThan(1)
  await verifyProjectContract(page, testInfo)
  await page.screenshot({
    path: testInfo.outputPath(`attendance-${viewport}-default.png`),
    animations: 'disabled',
  })

  const checkedInStudentSelection = page.getByRole('checkbox', { name: 'Select Student 01 Alpha01' })
  await checkedInStudentSelection.click()
  await primaryControl.getByRole('button', { name: 'Student actions for 1 selected' }).click()
  await expect(page.getByRole('menuitem', { name: 'Remove QR check-in' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`attendance-${viewport}-selected-check-in.png`),
    fullPage: true,
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await checkedInStudentSelection.click()

  if (viewport === 'mobile') {
    await primaryControl.getByRole('button', { name: 'Attendance actions' }).click()
    const sessionActionsMenu = page.getByRole('menu', { name: 'Attendance actions' })
    await expect(sessionActionsMenu.getByRole('menuitem', { name: 'Show QR' })).toBeVisible()
    await expect(sessionActionsMenu.getByRole('menuitem', { name: 'Stop QR check-in' })).toBeVisible()
    await expect(sessionActionsMenu.getByRole('menuitem', { name: 'Attendance hours' })).toBeVisible()
    await expect(sessionActionsMenu.getByRole('menuitem', { name: 'Refresh attendance' })).toBeVisible()
    await page.keyboard.press('Escape')
  } else {
    await primaryControl.getByRole('button', { name: 'Show QR' }).hover()
    await expect(page.getByRole('tooltip', { name: 'Show QR' })).toBeVisible()
  }

  const firstStudentStatus = page.getByRole('group', {
    name: 'Attendance status for Student 01 Alpha01',
  })
  for (const [label, selected] of [['Present', true], ['Late', false], ['Absent', false]] as const) {
    const statusButton = firstStudentStatus.getByRole('button', { name: label })
    await expect(statusButton.locator('svg')).toHaveCount(0)
    const geometry = await statusButton.evaluate((element) => {
      const styles = window.getComputedStyle(element)
      const indicatorStyles = window.getComputedStyle(element, '::after')
      const bounds = element.getBoundingClientRect()
      return {
        width: bounds.width,
        height: bounds.height,
        radius: Number.parseFloat(styles.borderTopLeftRadius),
        indicatorWidth: Number.parseFloat(indicatorStyles.width),
        indicatorHeight: Number.parseFloat(indicatorStyles.height),
        indicatorOpacity: Number.parseFloat(indicatorStyles.opacity),
        indicatorShadow: indicatorStyles.boxShadow,
      }
    })
    expect(geometry.width).toBeCloseTo(44, 1)
    expect(geometry.height).toBeCloseTo(44, 1)
    expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(1)
    expect(geometry.radius).toBeGreaterThanOrEqual(geometry.width / 2)
    expect(geometry.indicatorWidth).toBe(20)
    expect(geometry.indicatorHeight).toBe(20)
    expect(geometry.indicatorWidth).toBeLessThan(geometry.width)
    expect(geometry.indicatorOpacity).toBe(selected ? 1 : 0.12)
    expect(geometry.indicatorShadow === 'none').toBe(!selected)
  }
  await expect(firstStudentStatus.getByRole('button', { name: 'Present' })).toHaveAttribute('aria-pressed', 'true')
  await firstStudentStatus.getByRole('button', { name: 'Late' }).click()
  const undoQrCorrection = page.getByRole('button', {
    name: 'Undo manual attendance change for Student 01 Alpha01',
  })
  await expect(undoQrCorrection).toBeVisible()
  const undoBounds = await undoQrCorrection.boundingBox()
  expect(undoBounds).not.toBeNull()
  expect(undoBounds!.width).toBeCloseTo(44, 1)
  expect(undoBounds!.height).toBeCloseTo(44, 1)
  await expect(page.getByTestId('app-message-overlay')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Select Student 01 Alpha01' }).click()
  const selectedActions = primaryControl.getByRole('button', { name: 'Student actions for 1 selected' })
  await expect(selectedActions).toBeEnabled()
  await page.screenshot({
    path: testInfo.outputPath(`attendance-${viewport}-manual-with-undo.png`),
    animations: 'disabled',
  })
  await selectedActions.click()
  const selectedActionsMenu = page.getByRole('menu', { name: 'Selected student attendance actions' })
  await expect(selectedActionsMenu.getByRole('menuitem', { name: 'Present' })).toBeVisible()
  await expect(selectedActionsMenu.getByRole('menuitem', { name: 'Late' })).toBeVisible()
  await expect(selectedActionsMenu.getByRole('menuitem', { name: 'Absent' })).toBeVisible()
  await expect(selectedActionsMenu.getByRole('menuitem', { name: 'Use automatic' })).toBeVisible()
  await expect(selectedActionsMenu.getByRole('menuitem', { name: 'Remove QR check-in' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`attendance-${viewport}-selected-menu.png`),
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')

  await scrollPane.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(scrollPane.locator('thead')).toBeVisible()
  await page.getByRole('button', { name: 'Sort Present first, 11 students' }).click()
  await expect(page.getByRole('button', { name: 'Sort Present first, 11 students' })).toHaveAttribute('aria-pressed', 'true')

  if (viewport === 'mobile') {
    const attendanceMenu = primaryControl.getByRole('button', { name: 'Attendance actions' })
    await expect(attendanceMenu).toBeVisible()
    await attendanceMenu.click()
    await expect(page.getByRole('menuitem', { name: 'Refresh attendance' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Attendance hours' }).click()
  } else {
    await expect(trailingActions.getByRole('button', { name: 'Refresh attendance' })).toBeVisible()
    await attendanceHours.click()
  }
  await expect(page.getByRole('dialog', { name: 'Attendance timing' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`attendance-${viewport}-hours-dialog.png`),
    animations: 'disabled',
  })
  if (viewport === 'mobile') {
    await page.getByRole('button', { name: 'Save timing' }).scrollIntoViewIfNeeded()
    await page.screenshot({
      path: testInfo.outputPath(`attendance-${viewport}-hours-dialog-actions.png`),
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  if (viewport === 'desktop') {
    attendanceSessionState = 'closed'
    await page.reload({ waitUntil: 'domcontentloaded' })
    const closedHours = page.getByTestId('attendance-context-bar').getByRole('button', {
      name: 'Attendance hours, Closed, 12:45 AM to 10:34 PM',
    })
    await expect(closedHours).toBeVisible()
    await expect(closedHours).not.toHaveClass(/bg-success-bg|bg-warning-bg/)
    await page.screenshot({
      path: testInfo.outputPath('attendance-desktop-closed.png'),
      animations: 'disabled',
    })

    hasAttendanceWindow = false
    await page.getByTestId('attendance-primary-control').getByRole('button', { name: 'Next day' }).click()
    await expect(contextBar.getByRole('button', { name: 'Set attendance hours' })).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('attendance-desktop-no-hours.png'),
      animations: 'disabled',
    })
  }
  expect(browserErrors).toEqual([])
})

test('combines Daily logs and entitled Attendance in one teacher work surface', async ({ page }, testInfo) => {
  const { viewport } = getExperienceMetadata(testInfo)
  await page.clock.install({ time: new Date('2026-08-29T14:15:00.000Z') })
  await applyProjectTheme(page, testInfo)
  // Keep the fixture's relative "Today" timestamp stable across calendar days.
  await page.clock.setFixedTime(new Date('2026-08-29T15:00:00.000Z'))
  let attendanceConfigured = true
  let attendanceSessionState: 'open' | 'closed' | 'scheduled' = 'open'

  const students = Array.from({ length: 18 }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0')
    const studentId = `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    const status = (['present', 'late', 'absent'] as const)[index % 3]
    return {
      studentId,
      firstName: `Student ${ordinal}`,
      lastName: `Alpha${ordinal}`,
      status,
      source: index % 2 === 0 ? 'student_qr' as const : 'staff' as const,
      checkedInAt: index % 2 === 0 ? `2026-08-29T13:${String(index).padStart(2, '0')}:00.000Z` : null,
      revision: 1,
      hasQrCheckIn: index % 2 === 0,
      hasManualOverride: index === 2 || index % 2 !== 0,
      pendingCommand: false,
      commandFailed: false,
    }
  })

  await page.route(`**/api/classrooms/${ATTENDANCE_FIXTURE_CLASSROOM_ID}/class-days`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        class_days: [{
          id: '50000000-0000-4000-8000-000000000001',
          classroom_id: ATTENDANCE_FIXTURE_CLASSROOM_ID,
          date: '2026-08-29',
          prompt_text: null,
          is_class_day: true,
        }],
      }),
    })
  })
  await page.route('**/api/teacher/logs?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        logs: students.map((student, index) => ({
          student_id: student.studentId,
          student_email: `student${String(index + 1).padStart(2, '0')}@example.com`,
          student_first_name: student.firstName,
          student_last_name: student.lastName,
          entry: index % 3 === 0 ? {
            id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            student_id: student.studentId,
            classroom_id: ATTENDANCE_FIXTURE_CLASSROOM_ID,
            date: '2026-08-29',
            text: `Completed a detailed reflection for ${student.firstName} with enough content to demonstrate the full Daily log tooltip.`,
            rich_content: null,
            version: 1,
            minutes_reported: null,
            mood: null,
            created_at: '2026-08-29T14:00:00.000Z',
            updated_at: '2026-08-29T14:00:00.000Z',
            on_time: true,
          } : null,
          history_preview: [],
        })),
      }),
    })
  })
  await page.route('**/api/teacher/log-summary?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary_status: 'ready',
        summary: {
          overview: 'Students reflected on their progress and next steps.',
          action_items: [{
            studentName: 'Student 02 Alpha02',
            text: 'Student 02 Alpha02 needs a follow-up conversation.',
          }],
          generated_at: '2026-08-29T14:10:00.000Z',
        },
      }),
    })
  })
  await page.route('**/api/teacher/attendance/policy?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ policy: attendanceConfigured ? {
        classroomId: ATTENDANCE_FIXTURE_CLASSROOM_ID,
        timezone: 'America/Toronto',
        sessionStartsLocal: '14:00', sessionEndsLocal: '15:00', sessionEndDayOffset: 0,
        entryOpensMinutesBefore: 10, presentGraceMinutes: 5,
        entryClosesMinutesBeforeEnd: 10, absentMinutesBeforeEnd: 0,
        enabled: true, revision: 1, updatedAt: '2026-08-29T12:00:00.000Z',
      } : null }),
    })
  })
  await page.route('**/api/teacher/attendance/session?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classroomId: ATTENDANCE_FIXTURE_CLASSROOM_ID,
        classDate: new URL(route.request().url()).searchParams.get('date'),
        integration: attendanceConfigured ? 'ready' : 'not_configured',
        session: {
          state: attendanceConfigured ? attendanceSessionState : 'not_scheduled',
          opensAt: attendanceConfigured ? '2026-08-29T12:45:00.000Z' : null,
          closesAt: attendanceConfigured ? '2026-08-29T14:00:00.000Z' : null,
          sessionStartsAt: attendanceConfigured ? '2026-08-29T13:00:00.000Z' : null,
          sessionEndsAt: attendanceConfigured ? '2026-08-29T14:00:00.000Z' : null,
          presentThroughAt: attendanceConfigured ? '2026-08-29T13:10:00.000Z' : null,
          absentAt: attendanceConfigured ? '2026-08-29T14:00:00.000Z' : null,
          revision: attendanceConfigured ? 1 : null,
          pendingCommand: false,
          commandFailed: false,
        },
        sync: attendanceConfigured
          ? { state: 'current', confirmedAt: '2026-08-29T13:20:00.000Z' }
          : { state: 'unavailable', confirmedAt: null },
        students,
      }),
    })
  })

  await page.goto('/e2e-fixtures/teacher-daily-attendance', { waitUntil: 'domcontentloaded' })

  const contextBar = page.getByTestId('daily-context-bar')
  const primaryControl = page.getByTestId('daily-primary-control')
  await expect(contextBar).toBeVisible()
  const dateButton = primaryControl.getByRole('button', { name: 'Select Daily date' })
  await expect(dateButton.getByText('Sat Aug 29', { exact: true })).toBeVisible()
  await expect(dateButton.getByText('Today', { exact: true })).toBeVisible()
  await primaryControl.getByRole('button', { name: 'Previous day' }).click()
  await expect(dateButton.getByText('Fri Aug 28', { exact: true })).toBeVisible()
  await page.clock.setFixedTime(new Date('2026-08-30T15:00:00.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dateButton.getByText('Fri Aug 28', { exact: true })).toBeVisible()
  await expect(dateButton.getByText('2 days ago', { exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(dateButton.getByText('Sun Aug 30', { exact: true })).toBeVisible()
  await expect(dateButton.getByText('Today', { exact: true })).toBeVisible()
  await page.clock.setFixedTime(new Date('2026-08-29T15:00:00.000Z'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(dateButton.getByText('Sat Aug 29', { exact: true })).toBeVisible()
  await expect(dateButton.getByText('Today', { exact: true })).toBeVisible()
  await contextBar.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Hide relative date' }).click()
  await expect(dateButton.getByText('Today', { exact: true })).toHaveCount(0)
  await contextBar.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Show relative date' }).click()
  await expect(dateButton.getByText('Today', { exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Check-in' })).toHaveCount(viewport === 'desktop' ? 1 : 0)
  await expect(page.getByRole('columnheader', { name: /^Log/ })).toBeVisible()
  if (viewport === 'desktop') {
    await expect(page.getByRole('button', { name: 'Show QR' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Attendance hours, 2:00 PM to 3:00 PM' })).toHaveText('2:00 PM - 3:00 PM')
  } else {
    await expect(primaryControl.getByRole('button', { name: 'Attendance actions' })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Refresh attendance' })).toHaveCount(0)
  const summary = page.getByRole('region', { name: 'Class Log Summary' })
  await expect(summary).toBeVisible()
  await expect(summary.getByText('Students reflected on their progress and next steps.')).toBeVisible()
  await expect(summary.getByText(/10:10 AM$/)).toBeVisible()
  await expect(summary.getByText(/student02/i)).toHaveCount(0)
  await expect(summary.getByText('Student 02 Alpha02')).toBeVisible()
  const longLog = page.getByText(/Completed a detailed reflection for Student 01/)
  await expect(longLog).toHaveAttribute('title', /Completed a detailed reflection/)
  const overrideUndo = page.getByRole('button', {
    name: 'Undo manual attendance change for Student 03 Alpha03',
  })
  await expect(overrideUndo).toBeVisible()
  const overrideCell = overrideUndo.locator('xpath=ancestor::td')
  await expect.poll(() => overrideCell.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

  await page.screenshot({
    path: testInfo.outputPath(`daily-attendance-${viewport}-default.png`),
    animations: 'disabled',
  })

  const scrollPane = page.getByTestId('daily-student-scroll-pane')
  await expect.poll(() => scrollPane.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await scrollPane.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const [scrollPaneBox, tableHeadBox] = await Promise.all([
    scrollPane.boundingBox(),
    scrollPane.locator('thead').boundingBox(),
  ])
  expect(scrollPaneBox).not.toBeNull()
  expect(tableHeadBox).not.toBeNull()
  expect(Math.abs(tableHeadBox!.y - scrollPaneBox!.y)).toBeLessThanOrEqual(1)

  await page.getByRole('checkbox', { name: 'Select Student 01 Alpha01' }).click()
  await expect(primaryControl.getByRole('button', { name: 'Student actions for 1 selected' })).toBeEnabled()

  await contextBar.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Hide ID column' }).click()
  await expect(page.getByRole('columnheader', { name: 'ID' })).toHaveCount(0)
  await expect(page.getByRole('separator', { name: 'Resize ID column' })).toHaveCount(0)

  await page.screenshot({
    path: testInfo.outputPath(`daily-attendance-${viewport}-selected-id-hidden.png`),
    animations: 'disabled',
  })
  await verifyProjectContract(page, testInfo)

  attendanceSessionState = 'closed'
  await page.evaluate(() => window.localStorage.setItem('teacher-daily:show-id', 'true'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('checkbox', { name: 'Select Student 01 Alpha01' })).toBeEnabled()
  await page.getByRole('checkbox', { name: 'Select Student 01 Alpha01' }).click()
  await expect(primaryControl.getByRole('button', {
    name: 'Student actions for 1 selected',
  })).toBeEnabled()
  await page.screenshot({
    path: testInfo.outputPath(`daily-attendance-${viewport}-closed.png`),
    animations: 'disabled',
  })

  attendanceSessionState = 'scheduled'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('group', {
    name: 'Attendance status for Student 01 Alpha01',
  })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Select Student/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Student actions/ })).toHaveCount(0)
  if (viewport === 'desktop') {
    await expect(page.getByRole('button', { name: 'Open QR check-in' })).toBeVisible()
  } else {
    await primaryControl.getByRole('button', { name: 'Attendance actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Open QR check-in' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await page.screenshot({
    path: testInfo.outputPath(`daily-attendance-${viewport}-scheduled.png`),
    animations: 'disabled',
  })

  attendanceConfigured = false
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Attendance hours are not configured.', { exact: false })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Select Student/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Student actions/ })).toHaveCount(0)
  if (viewport === 'desktop') {
    await expect(page.getByRole('button', { name: 'Set attendance hours' })).toBeVisible()
  } else {
    await primaryControl.getByRole('button', { name: 'Attendance actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Set attendance hours' })).toBeVisible()
  }
  await page.screenshot({
    path: testInfo.outputPath(`daily-attendance-${viewport}-unconfigured.png`),
    animations: 'disabled',
  })
  if (viewport === 'mobile') await page.keyboard.press('Escape')

  await page.goto('/e2e-fixtures/teacher-daily-attendance?attendance=off', { waitUntil: 'domcontentloaded' })

  const dailyOnlyContextBar = page.getByTestId('daily-context-bar')
  await expect(dailyOnlyContextBar).toBeVisible()
  const dailyOnlyDateButton = dailyOnlyContextBar.getByRole('button', { name: 'Select Daily date' })
  await expect(dailyOnlyDateButton.getByText('Sat Aug 29', { exact: true })).toBeVisible()
  await expect(dailyOnlyDateButton.getByText('Today', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Attendance actions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show QR' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Student actions/ })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Select Student/ })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Check-in' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Sort attendance by status' })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'ID' })).toBeVisible()

  await dailyOnlyContextBar.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem')).toHaveCount(2)
  await expect(page.getByRole('menuitem', { name: 'Hide ID column' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Hide relative date' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`daily-only-${viewport}-more-menu.png`),
    animations: 'disabled',
  })
  await verifyProjectContract(page, testInfo)
})

test('shows saved classroom hours across dates and delivery failures', async ({ page }, testInfo) => {
  const { viewport } = getExperienceMetadata(testInfo)
  await applyProjectTheme(page, testInfo)
  await page.clock.setFixedTime(new Date('2026-08-31T18:30:00Z'))
  let policyReadFails = false
  let finishSave!: () => void
  const saveGate = new Promise<void>((resolve) => { finishSave = resolve })
  let policy = {
    classroomId: ATTENDANCE_FIXTURE_CLASSROOM_ID, timezone: 'America/Toronto',
    sessionStartsLocal: '14:00', sessionEndsLocal: '15:00', sessionEndDayOffset: 0,
    entryOpensMinutesBefore: 10, presentGraceMinutes: 5,
    entryClosesMinutesBeforeEnd: 10, absentMinutesBeforeEnd: 0,
    enabled: true, revision: 1, updatedAt: '2026-08-31T18:00:00Z',
  }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let body: unknown
    let status = 200
    if (url.pathname.endsWith('/class-days')) {
      body = { class_days: [{ id: 'day-1', classroom_id: ATTENDANCE_FIXTURE_CLASSROOM_ID, date: '2026-08-31', prompt_text: null, is_class_day: true }] }
    } else if (url.pathname === '/api/teacher/attendance/policy') {
      if (route.request().method() === 'PUT') {
        await saveGate
        policy = { ...policy, revision: policy.revision + 1 }
      } else if (policyReadFails) status = 503
      body = status === 200 ? { policy } : { error: 'Attendance settings are temporarily unavailable' }
    } else if (url.pathname === '/api/teacher/attendance/sync') {
      status = 503
      body = { error: 'Attendance schedule is temporarily unavailable' }
    } else if (url.pathname === '/api/teacher/attendance/session') {
      body = {
        classroomId: ATTENDANCE_FIXTURE_CLASSROOM_ID, classDate: url.searchParams.get('date'), integration: 'ready',
        session: { state: 'not_scheduled', opensAt: null, closesAt: null, sessionStartsAt: null, sessionEndsAt: null,
          presentThroughAt: null, absentAt: null, revision: null, pendingCommand: false, commandFailed: false },
        sync: { state: 'current', confirmedAt: null }, students: [],
      }
    } else if (url.pathname === '/api/teacher/logs') body = { logs: [] }
    else if (url.pathname === '/api/teacher/log-summary') body = { summary_status: 'no_logs', summary: null }
    else { status = 404; body = { error: 'Fixture route unavailable' } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const capture = async (state: string) => {
    await verifyProjectContract(page, testInfo)
    await page.screenshot({ path: testInfo.outputPath(`saved-hours-${viewport}-${state}.png`), animations: 'disabled' })
  }
  const openHours = async (name: string) => {
    if (viewport === 'desktop') await page.getByRole('button', { name }).click()
    else {
      await page.getByRole('button', { name: 'Attendance actions' }).click()
      await page.getByRole('menuitem', { name: /Attendance hours/ }).click()
    }
  }
  await page.goto('/e2e-fixtures/teacher-daily-attendance', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Select Daily date' })).toContainText('Mon Aug 31')
  if (viewport === 'desktop') await expect(page.getByRole('button', { name: 'Attendance hours, 2:00 PM to 3:00 PM' })).toBeVisible()
  await capture('today-date')
  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(page.getByRole('button', { name: 'Select Daily date' })).toContainText('Tue Sep 1')
  await openHours('Attendance hours, 2:00 PM to 3:00 PM')
  await expect(page.getByLabel('Session starts*')).toHaveValue('14:00')
  await expect(page.getByLabel('Session ends*')).toHaveValue('15:00')
  await capture('future-date-dialog')
  await page.getByRole('button', { name: 'Save timing' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Attendance timing' })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click({ position: { x: 2, y: 2 } })
  await expect(page.getByRole('heading', { name: 'Attendance timing' })).toBeVisible()
  finishSave()
  await expect(page.getByRole('alert').filter({ hasText: 'last save did not confirm schedule delivery' })).toBeVisible()
  if (viewport === 'desktop') await expect(page.getByRole('button', { name: 'Attendance hours, 2:00 PM to 3:00 PM' })).toBeVisible()
  await capture('saved-delivery-unconfirmed')
  policyReadFails = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('alert').filter({ hasText: 'Attendance hours could not be loaded' })).toBeVisible()
  await capture('read-failure')
  await openHours('Attendance hours unavailable')
  await expect(page.getByRole('heading', { name: 'Attendance hours unavailable' })).toBeVisible()
  await capture('dialog-read-failure')
  policyReadFails = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByLabel('Session starts*')).toHaveValue('14:00')
  await page.keyboard.press('Escape')
  if (viewport === 'desktop') await expect(page.getByRole('button', { name: 'Attendance hours, 2:00 PM to 3:00 PM' })).toBeFocused()
  await expect(page.getByRole('alert').filter({ hasText: 'Attendance hours could not be loaded' })).toHaveCount(0)
})

test('shows student attendance states without exposing derived status labels', async ({ page }, testInfo) => {
  await applyProjectTheme(page, testInfo)
  await page.goto('/e2e-fixtures/student-attendance', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('Scan QR for Attendance')).toBeVisible()
  await expect(page.getByText('Checked in at 9:07 AM')).toBeVisible()
  await expect(page.getByText('Late', { exact: true })).toHaveCount(0)
  await verifyProjectContract(page, testInfo)
  await page.screenshot({
    path: testInfo.outputPath(`student-attendance-${getExperienceMetadata(testInfo).viewport}.png`),
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
  await expect(contextBar).not.toContainText(/Draft|Active|Closed/)
  await expect(primaryControl.getByRole('button', { name: 'Open All' })).toBeVisible()
  await expect(primaryControl.getByRole('button', { name: 'Close All' })).toBeVisible()
  await expect(primaryControl.getByRole('button', { name: 'Student actions (select students to enable)' })).toBeDisabled()
  await expect(trailingActions).toBeVisible()
  const moreActionsButton = trailingActions.getByRole('button', { name: 'More actions' })
  await expect(moreActionsButton).toBeVisible()
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
    await moreActionsButton.hover()
    await expect(page.getByRole('tooltip', { name: 'More actions' })).toBeVisible()
  }
  await moreActionsButton.click()
  const testActionsMenu = page.getByRole('menu', { name: 'Test actions' })
  await expect(testActionsMenu.getByRole('menuitem', { name: 'Edit Test' })).toBeVisible()
  await expect(testActionsMenu.getByRole('menuitem', { name: 'Delete Test' })).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath(`test-grading-${viewport}-test-actions.png`),
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await expect(testActionsMenu).toBeHidden()
  await expect(moreActionsButton).toBeFocused()

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

test('shows publication language only at the publish transition', async ({ page }, testInfo) => {
  const { viewport } = getExperienceMetadata(testInfo)
  await applyProjectTheme(page, testInfo)

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
            status: 'draft',
            grading_finalized_at: null,
          },
          questions: [{ id: 'question-1', question_type: 'multiple_choice' }],
          students: [],
          active_ai_grading_run: null,
        }),
      })
      return
    }

    if (url.pathname === `/api/teacher/tests/${TEST_GRADING_FIXTURE_TEST_ID}/draft`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          draft: {
            id: 'draft-1',
            version: 1,
            content: {
              title: 'Functions and Graphs Test',
              show_results: false,
              question_identity_version: 1,
              questions: [{
                id: '30000000-0000-4000-8000-000000000014',
                question_type: 'multiple_choice',
                question_text: 'Ready to publish?',
                options: ['Yes', 'No'],
                correct_option: 0,
                answer_key: null,
                sample_solution: null,
                points: 1,
                response_max_chars: 5000,
                response_monospace: false,
              }],
            },
          },
        }),
      })
      return
    }

    if (url.pathname === `/api/teacher/tests/${TEST_GRADING_FIXTURE_TEST_ID}`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          draft_version: 1,
          questions: [{
            id: 'question-1',
            question_type: 'multiple_choice',
            question_text: 'Ready to publish?',
            options: ['Yes', 'No'],
            correct_option: 0,
            points: 1,
          }],
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
            status: 'draft',
            show_results: false,
            position: 0,
            documents: [],
            created_at: '2026-08-27T12:00:00.000Z',
            updated_at: '2026-08-27T12:00:00.000Z',
            stats: {
              total_students: 0,
              responded: 0,
              submitted: 0,
              open_access: 0,
              closed_access: 0,
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
      body: JSON.stringify({ error: `Unhandled Test publication fixture route: ${url.pathname}` }),
    })
  })

  await page.goto('/e2e-fixtures/teacher-test-grading', { waitUntil: 'domcontentloaded' })

  const contextBar = page.getByTestId('test-grading-context-bar')
  await expect(contextBar).not.toContainText(/Draft|Active|Closed|Unpublished|Published/)
  await expect(page.getByRole('button', { name: 'Open All' })).toBeDisabled()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Edit Test' }).click()
  const authoringDialog = page.getByRole('dialog', { name: 'Edit test' })
  await expect(authoringDialog.getByRole('button', { name: 'Publish' })).toBeVisible()
  await expect(authoringDialog.getByText('Ready to publish?', { exact: true })).toBeVisible()
  await expect(authoringDialog.getByText(/Failed to load assessment draft|Unhandled Test publication fixture route/)).toHaveCount(0)
  await authoringDialog.getByRole('button', { name: 'Publish' }).click()

  const publishDialog = page.getByRole('dialog', { name: 'Publish test?' })
  await expect(publishDialog).toBeVisible()
  await expect(publishDialog).toContainText('Publishing is permanent. Students will see this test, but it will stay closed until you open access.')
  await expect(publishDialog.getByRole('button', { name: 'Publish' })).toBeVisible()
  await verifyProjectContract(page, testInfo)
  await page.screenshot({
    path: testInfo.outputPath(`test-publish-${viewport}-confirmation.png`),
    animations: 'disabled',
  })
})

test('shows published closed Tests to students without opening them', async ({ page }, testInfo) => {
  const { viewport } = getExperienceMetadata(testInfo)
  await applyProjectTheme(page, testInfo)

  await page.route('**/api/student/notifications**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hasTodayEntry: true,
        unviewedAssignmentsCount: 0,
        activeTestsCount: 1,
        unreadAnnouncementsCount: 0,
      }),
    })
  })
  await page.route('**/api/student/tests?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tests: [
          {
            id: '30000000-0000-4000-8000-000000000023',
            classroom_id: '30000000-0000-4000-8000-000000000021',
            title: 'Functions and Graphs Test',
            assessment_type: 'test',
            status: 'closed',
            show_results: false,
            position: 1,
            documents: [],
            student_status: 'not_started',
            access_state: null,
            effective_access: 'closed',
          },
          {
            id: '30000000-0000-4000-8000-000000000025',
            classroom_id: '30000000-0000-4000-8000-000000000021',
            title: 'Individually Closed Test',
            assessment_type: 'test',
            status: 'active',
            show_results: false,
            position: 0,
            documents: [],
            student_status: 'not_started',
            access_state: 'closed',
            effective_access: 'closed',
          },
          {
            id: '30000000-0000-4000-8000-000000000026',
            title: 'Submitted Closed Test',
            status: 'closed',
            student_status: 'responded',
            effective_access: 'closed',
          },
          {
            id: '30000000-0000-4000-8000-000000000027',
            title: 'Submitted Open Test',
            status: 'active',
            student_status: 'responded',
            effective_access: 'open',
          },
          {
            id: '30000000-0000-4000-8000-000000000028',
            title: 'Returned Test',
            status: 'closed',
            student_status: 'can_view_results',
            effective_access: 'closed',
          },
          {
            id: '30000000-0000-4000-8000-000000000024',
            classroom_id: '30000000-0000-4000-8000-000000000021',
            title: 'Practice Test',
            assessment_type: 'test',
            status: 'active',
            show_results: false,
            position: 0,
            documents: [],
            student_status: 'not_started',
            access_state: null,
            effective_access: 'open',
          },
        ],
      }),
    })
  })

  let detailRequests = 0
  await page.route('**/api/student/tests/30000000-0000-4000-8000-000000000026', async (route) => {
    detailRequests += 1
    await route.fulfill({
      status: detailRequests === 1 ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(detailRequests === 1 ? { error: 'Fixture read failure' } : {
        test: {
          id: '30000000-0000-4000-8000-000000000026',
          title: 'Submitted Closed Test', status: 'closed',
          student_status: 'responded', effective_access: 'closed',
        },
        questions: [], student_status: 'responded',
      }),
    })
  })

  await page.goto('/e2e-fixtures/student-test-list', { waitUntil: 'domcontentloaded' })

  const closedTest = page.getByRole('button', { name: /Functions and Graphs Test/ })
  await expect(closedTest).toBeVisible()
  await expect(closedTest).toBeDisabled()
  await expect(closedTest).toContainText('This test is closed')
  const individuallyClosedTest = page.getByRole('button', { name: /Individually Closed Test/ })
  await expect(individuallyClosedTest).toBeDisabled()
  await expect(individuallyClosedTest).toContainText('Closed')
  await expect(individuallyClosedTest).toContainText('This test is closed')
  await expect(page.getByRole('button', { name: /Practice Test/ })).toBeEnabled()
  await expect(page.getByText(/Unpublished|Published/, { exact: false })).toHaveCount(0)
  const submittedClosed = page.getByRole('button', { name: /Submitted Closed Test/ })
  await expect(submittedClosed).toBeEnabled()
  await expect(submittedClosed).toContainText('Submitted')
  await expect(submittedClosed).toContainText('Access closed')
  await expect(page.getByRole('button', { name: /Submitted Open Test/ })).toContainText('Awaiting results')
  await expect(page.getByRole('button', { name: /Returned Test/ })).toContainText('Returned')
  await expect(page.getByRole('button', { name: /Practice Test/ })).toContainText('Available')
  await verifyProjectContract(page, testInfo)
  await page.screenshot({
    path: testInfo.outputPath(`student-test-list-${viewport}-published-closed.png`),
    animations: 'disabled',
  })

  await submittedClosed.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Tests' }).getByRole('alert')).toContainText('Test unavailable')
  await expect(page.getByRole('button', { name: 'Start the Test' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Back to tests' })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath(`student-test-${viewport}-detail-error.png`), animations: 'disabled' })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText('Response Submitted', { exact: true })).toBeVisible()
  await expect(page.getByText('Results will be available after your teacher returns this test.')).toBeVisible()
  await verifyProjectContract(page, testInfo)
  const back = page.getByRole('button', { name: 'Back to tests' })
  const backBounds = await back.boundingBox()
  expect(backBounds?.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: testInfo.outputPath(`student-test-${viewport}-submitted.png`), animations: 'disabled' })
  await back.press('Enter')
  await expect(submittedClosed).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath(`student-test-${viewport}-return-focus.png`), animations: 'disabled' })

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
    await page.getByRole('button', { name: 'Create classroom', exact: true }).click()
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

    const editOverview = page.getByRole('button', {
      name: 'Edit curriculum overview and expectations',
    })
    await editOverview.focus()
    await expect(editOverview).toBeFocused()
    await page.keyboard.press('Enter')
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
    const publicSharingButton = page.getByRole('button', { name: 'Share guide publicly' })
    if (await publicSharingButton.getAttribute('aria-pressed') !== 'true') {
      await publicSharingButton.click()
    }
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
    await page.locator('aside').getByRole('button', { name: /Publication Lifecycle Fixture/ }).click()
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
        await page.request.get(`/planned/${PLANNED_COURSE_FIXTURE.publicationSlug}`)
      ).status()).toBe(404)

      await publishCheckbox.check()
      await saveButton.click()
      await expect(saveButton).toBeEnabled()
      await expect.poll(async () => (
        await page.request.get(`/planned/${PLANNED_COURSE_FIXTURE.publicationSlug}`)
      ).status()).toBe(200)
    } finally {
      const restore = await page.request.patch(
        `/api/teacher/course-blueprints/${PLANNED_COURSE_FIXTURE.publicationBlueprintId}`,
        {
          data: {
            planned_site_slug: PLANNED_COURSE_FIXTURE.publicationSlug,
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

    await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible()
    await expect(page.getByText('Add curriculum context and classroom expectations.')).toHaveCount(0)
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

test.describe('public Course Guide experience matrix', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }, testInfo) => {
    await applyProjectTheme(page, testInfo)
  })

  test('shows the published classroom guide without an authenticated shell or retired fields', async ({ page }, testInfo) => {
    const response = await page.goto(`/actual/${PUBLIC_ACTUAL_COURSE_SLUG}`, {
      waitUntil: 'domcontentloaded',
    })
    expect(response?.status()).toBe(200)

    await expect(page.getByRole('heading', { level: 1, name: 'Test Classroom' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Curriculum overview and expectations' })).toBeVisible()
    await expect(page.getByText(/practical problem-solving/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit guide' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Guide options' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Course outline' })).toHaveCount(0)
    await expect(page.locator('iframe')).toHaveCount(0)

    const apiResponse = await page.request.get(`/api/public/course-guides/${PUBLIC_ACTUAL_COURSE_SLUG}`)
    expect(apiResponse.status()).toBe(200)
    const payload = await apiResponse.json() as { guide: Record<string, unknown> }
    const serializedGuide = JSON.stringify(payload.guide)
    expect(serializedGuide).not.toContain('TEST01')
    for (const retiredField of ['termLabel', 'startDate', 'endDate', 'outlineMarkdown', '"date"']) {
      expect(serializedGuide).not.toContain(retiredField)
    }

    await verifyProjectContract(page, testInfo)
    await captureCourseGuideState(page, testInfo, 'public-read')
  })

  test('keeps missing or unpublished guides behind the same anonymous not-found boundary', async ({ page }, testInfo) => {
    const response = await page.goto('/actual/e2e-course-guide-not-published', {
      waitUntil: 'domcontentloaded',
    })
    expect(response?.status()).toBe(404)
    await expect(page.getByText('Test Classroom')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Edit guide' })).toHaveCount(0)
    await verifyProjectContract(page, testInfo)
    await captureCourseGuideState(page, testInfo, 'public-not-found')
  })
})
