import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const STUDENT_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'
const STUDENT_EMAIL = 'student1@example.com'

const matrix = [
  { name: 'desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light' as const },
  { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' as const },
  { name: 'mobile-light', viewport: { width: 390, height: 844 }, theme: 'light' as const },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark' as const },
]

const impact = {
  classroom_title: 'Test Classroom',
  student_id: STUDENT_ID,
  student_email: STUDENT_EMAIL,
  source_revision: 8,
  storage_inventory_sha256: 'a'.repeat(64),
  relational_inventory_sha256: 'b'.repeat(64),
  relational_row_count: 47,
  managed_file_count: 6,
  managed_file_bytes: 2_489_962,
  archive_count: 1,
  gradex_extract_count: 1,
  resource_counts: { entries: 12, assignment_docs: 4, test_responses: 8 },
  storage_counts: { student_inline_image: 4, classroom_archive: 1, gradex_extract: 1 },
  conflicting_operation: null,
  deletion_available: true,
  unavailable_reason: null,
}

const operation = {
  operation_id: OPERATION_ID,
  status: 'deleting_objects',
  retryable: true,
  error_code: null,
  attempt_count: 2,
  resource_counts: impact.resource_counts,
  storage_object_counts: { deleted: 2, pending: 4 },
  completed_at: null,
}

async function newRolePage(
  browserContextFactory: () => Promise<BrowserContext>,
  theme: 'light' | 'dark',
) {
  const context = await browserContextFactory()
  const page = await context.newPage()
  await page.addInitScript((selectedTheme) => localStorage.setItem('theme', selectedTheme), theme)
  return { context, page }
}

async function mockTeacherStudentPurge(page: Page, classroomId: string) {
  const scopedImpact = { ...impact, classroom_id: classroomId }
  const scopedOperation = { ...operation, classroom_id: classroomId }

  await page.route(`**/api/teacher/classrooms/${classroomId}/roster`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        roster: [{
          id: '10000000-0000-4000-8000-000000000001',
          email: STUDENT_EMAIL,
          first_name: 'Student1',
          last_name: 'Test',
          student_number: 'S1001',
          counselor_email: null,
          join_source: 'manual',
          created_at: '2026-08-01T12:00:00.000Z',
          updated_at: '2026-08-01T12:00:00.000Z',
          joined: true,
          student_id: STUDENT_ID,
          joined_at: '2026-08-01T12:00:00.000Z',
        }],
        student_purge_enabled_ids: [STUDENT_ID],
      }),
    })
  })
  await page.route(
    `**/api/teacher/classrooms/${classroomId}/students/${STUDENT_ID}/purge`,
    async (route) => {
      await route.fulfill({
        status: route.request().method() === 'POST' ? 202 : 200,
        contentType: 'application/json',
        body: JSON.stringify(route.request().method() === 'POST'
          ? { operation: scopedOperation }
          : { impact: scopedImpact, operation: null }),
      })
    },
  )
  await page.route(
    `**/api/teacher/classrooms/${classroomId}/students/${STUDENT_ID}/purge/${OPERATION_ID}/tick`,
    async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ operation: scopedOperation, advanced: false }),
      })
    },
  )
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false)
}

for (const entry of matrix) {
  test(`captures individual-student purge and student boundary matrix (${entry.name})`, async ({ browser }, testInfo) => {
    const discoveryContext = await browser.newContext({ storageState: '.auth/teacher.json' })
    const discoveryPage = await discoveryContext.newPage()
    await discoveryPage.goto('/classrooms')
    await discoveryPage.locator('[data-testid="classroom-card"]').first().click()
    await discoveryPage.waitForURL(/\/classrooms\/[^/?]+/)
    const classroomId = new URL(discoveryPage.url()).pathname.split('/').at(-1)
    await discoveryContext.close()
    expect(classroomId).toBeTruthy()

    const { context, page } = await newRolePage(
      () => browser.newContext({ storageState: '.auth/teacher.json', viewport: entry.viewport }),
      entry.theme,
    )
    await mockTeacherStudentPurge(page, classroomId!)
    await page.goto(`/classrooms/${classroomId}?tab=roster`)
    await page.getByText('Student1', { exact: true }).click()
    await page.getByRole('button', { name: 'Roster actions' }).click()
    await page.getByRole('menuitem', { name: 'Purge classroom data' }).click()

    const dialog = page.getByRole('dialog', { name: 'Purge this student’s classroom data?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('This cannot be undone.')).toBeVisible()
    await expect(dialog).toContainText('user account and data in other classrooms are kept')
    await expectNoHorizontalOverflow(page)
    await page.screenshot({
      path: testInfo.outputPath(`dialog-${entry.name}.png`),
      fullPage: true,
      animations: 'disabled',
    })

    await dialog.getByRole('textbox').fill(STUDENT_EMAIL)
    await dialog.getByRole('button', { name: 'Purge classroom data' }).click()
    await expect(dialog.getByRole('alert')).toContainText('waiting safely')
    await expect(dialog).toContainText('Deleting files 2 of 6')
    await page.screenshot({
      path: testInfo.outputPath(`progress-${entry.name}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await context.close()

    const { context: studentContext, page: studentPage } = await newRolePage(
      () => browser.newContext({ storageState: '.auth/student.json', viewport: entry.viewport }),
      entry.theme,
    )
    let studentPurgeRequestCount = 0
    await studentPage.route('**/api/teacher/classrooms/*/students/*/purge**', async (route) => {
      studentPurgeRequestCount += 1
      await route.abort()
    })
    await studentPage.goto(`/classrooms/${classroomId}?tab=roster`)
    await studentPage.waitForURL((url) => url.searchParams.get('tab') === 'today')
    await expect(studentPage.getByRole('button', { name: 'Roster actions' })).toHaveCount(0)
    await expect(studentPage.getByText('Purge classroom data')).toHaveCount(0)
    expect(studentPurgeRequestCount).toBe(0)
    await expectNoHorizontalOverflow(studentPage)
    await studentPage.screenshot({
      path: testInfo.outputPath(`student-boundary-${entry.name}.png`),
      fullPage: true,
      animations: 'disabled',
    })
    await studentContext.close()
  })
}
