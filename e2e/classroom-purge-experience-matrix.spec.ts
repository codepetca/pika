import { expect, test, type Page, type TestInfo } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000099'

type MatrixMetadata = {
  theme: 'light' | 'dark'
  viewport: 'desktop' | 'mobile'
}

function metadata(testInfo: TestInfo): MatrixMetadata {
  const { theme, viewport } = testInfo.project.metadata
  if (
    (theme !== 'light' && theme !== 'dark')
    || (viewport !== 'desktop' && viewport !== 'mobile')
  ) {
    throw new Error('Classroom purge verification requires matrix metadata')
  }
  return { theme, viewport }
}

async function applyTheme(page: Page, testInfo: TestInfo) {
  const { theme } = metadata(testInfo)
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false)
}

test.describe('classroom purge teacher experience matrix', () => {
  test.use({ storageState: TEACHER_STORAGE })

  test('shows the irreversible impact and typed confirmation boundary', async ({ page }, testInfo) => {
    await applyTheme(page, testInfo)
    await page.route('**/api/teacher/classrooms?archived=true', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classrooms: [{
            id: CLASSROOM_ID,
            teacher_id: '10000000-0000-4000-8000-000000000001',
            title: 'Archived Biology',
            class_code: 'BIO101',
            theme_color: 'teal',
            term_label: 'Winter 2026',
            allow_enrollment: false,
            start_date: null,
            end_date: null,
            lesson_plan_visibility: 'current_week',
            archived_at: '2026-06-30T12:00:00.000Z',
            created_at: '2026-01-01T12:00:00.000Z',
            updated_at: '2026-06-30T12:00:00.000Z',
          }],
          cold_archives: [],
          cold_archive_restore_enabled: false,
        }),
      })
    })
    await page.route(`**/api/teacher/classrooms/${CLASSROOM_ID}/purge`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          impact: {
            classroom_id: CLASSROOM_ID,
            classroom_title: 'Archived Biology',
            source_revision: 7,
            storage_inventory_version: 11,
            storage_inventory_sha256: 'a'.repeat(64),
            relational_row_count: 286,
            student_count: 24,
            managed_file_count: 37,
            managed_file_bytes: 12_845_056,
            missing_file_count: 0,
            archive_count: 2,
            gradex_extract_count: 1,
            interrupted_upload_count: 2,
            resource_counts: { classrooms: 1, classroom_roster: 24 },
            storage_counts: {
              'assignment-artifacts': 30,
              'submission-images': 4,
              'classroom-archives': 2,
              'gradex-analytics-extracts': 1,
            },
            conflicting_operation: null,
            ownership_coverage_status: 'verified',
            deletion_available: true,
            unavailable_reason: null,
          },
          operation: null,
        }),
      })
    })

    await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('load')
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: 'Organize classrooms' }).click()
    await expect(page.getByRole('button', { name: 'Archived' })).toBeVisible()
    await page.getByRole('button', { name: 'Archived' }).click()
    await expect(page.getByRole('button', { name: 'Reuse' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible()
    const purgeOpener = page.getByRole('button', { name: 'Delete permanently' })
    await expect(purgeOpener).toBeVisible()
    await expect(purgeOpener.locator('svg.lucide-trash-2')).toBeVisible()

    const { theme, viewport } = metadata(testInfo)
    await page.screenshot({
      path: `/tmp/pika-archive-actions-teacher-${theme}-${viewport}.png`,
      animations: 'disabled',
    })

    await purgeOpener.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('This cannot be undone.')).toBeVisible()
    await expect(dialog.getByText(/all student work, submissions, tests, grades/)).toBeVisible()
    await expect(dialog.getByText(/Course Blueprint and user accounts are kept/)).toBeVisible()
    await expect(dialog.getByText(/2 interrupted uploads/)).toBeVisible()
    const deleteButton = dialog.getByRole('button', { name: 'Delete permanently' })
    await expect(deleteButton).toBeDisabled()
    await dialog.getByRole('textbox').fill('Archived Biology')
    await expect(deleteButton).toBeEnabled()
    await expectNoHorizontalOverflow(page)

    await page.screenshot({
      path: `/tmp/pika-purge-teacher-${theme}-${viewport}.png`,
      animations: 'disabled',
    })
  })
})

test.describe('classroom purge student boundary matrix', () => {
  test.use({ storageState: STUDENT_STORAGE })

  test('never exposes teacher permanent-deletion controls', async ({ page }, testInfo) => {
    await applyTheme(page, testInfo)
    await page.goto('/classrooms', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0)
    await expect(page.getByText('Delete classroom permanently?')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    const { theme, viewport } = metadata(testInfo)
    await page.screenshot({
      path: `/tmp/pika-purge-student-${theme}-${viewport}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
})
