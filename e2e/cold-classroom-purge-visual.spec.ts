import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const CLASSROOM_ID = '10000000-0000-4000-8000-000000000001'
const ARCHIVE_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'

const coldArchive = {
  classroom_id: CLASSROOM_ID,
  archive_id: ARCHIVE_ID,
  title: 'Stored Biology · Spring 2026',
  archived_at: '2026-06-30T16:00:00.000Z',
  compacted_at: '2026-07-15T16:00:00.000Z',
}

const impact = {
  classroom_id: CLASSROOM_ID,
  archive_id: ARCHIVE_ID,
  classroom_title: coldArchive.title,
  source_revision: 8,
  storage_inventory_sha256: 'a'.repeat(64),
  cold_resource_inventory_sha256: 'b'.repeat(64),
  cold_resource_count: 20_184,
  student_count: 28,
  managed_file_count: 20,
  managed_file_bytes: 2_489_962,
  missing_file_count: 0,
  non_ready_file_count: 0,
  unmanaged_reference_count: 0,
  archive_count: 1,
  gradex_extract_count: 1,
  storage_counts: { 'classroom-archives': 1 },
  resource_counts: { classroom_cold_tombstones: 1 },
  retention: { mode: 'scheduled', delete_after: '2026-09-01T04:00:00.000Z' },
  conflicting_operation: null,
  deletion_available: true,
  unavailable_reason: null,
}

const operation = {
  operation_id: OPERATION_ID,
  classroom_id: CLASSROOM_ID,
  status: 'deleting_objects',
  retryable: null,
  error_code: null,
  attempt_count: 1,
  resource_counts: { classroom_cold_tombstones: 1 },
  storage_object_counts: { deleted: 7, pending: 13 },
  completed_at: null,
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem('theme', selectedTheme)
  }, theme)
}

async function mockTeacherColdArchive(page: Page) {
  await page.route('**/api/teacher/classrooms?archived=true', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classrooms: [],
        cold_archives: [coldArchive],
        cold_archive_restore_enabled: true,
        hot_classroom_purge_enabled_ids: [],
        cold_classroom_purge_enabled_ids: [CLASSROOM_ID],
      }),
    })
  })
  await page.route(
    `**/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/purge`,
    async (route) => {
      await route.fulfill({
        status: route.request().method() === 'POST' ? 202 : 200,
        contentType: 'application/json',
        body: JSON.stringify(route.request().method() === 'POST'
          ? { operation }
          : { impact, operation: null }),
      })
    },
  )
  await page.route(
    `**/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/purge/${OPERATION_ID}/tick`,
    async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ operation, advanced: false }),
      })
    },
  )
}

async function newRoleContext(
  browserContextFactory: () => Promise<BrowserContext>,
  theme: 'light' | 'dark',
) {
  const context = await browserContextFactory()
  const page = await context.newPage()
  await setTheme(page, theme)
  return { context, page }
}

test('captures cold Classroom deletion and the student boundary matrix', async ({ browser }) => {
  const teacherMatrix = [
    { name: 'desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light' as const },
    { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' as const },
    { name: 'mobile-light', viewport: { width: 390, height: 844 }, theme: 'light' as const },
    { name: 'mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark' as const },
  ]

  for (const entry of teacherMatrix) {
    const { context, page } = await newRoleContext(
      () => browser.newContext({
        storageState: '.auth/teacher.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await mockTeacherColdArchive(page)
    await page.goto('/classrooms')
    await page.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'Show Archived' }).click()
    await expect(page.getByText(coldArchive.title)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeVisible()
    await page.screenshot({
      path: `/tmp/pika-cold-purge-row-${entry.name}.png`,
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Delete permanently' }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Delete stored classroom permanently?',
    })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('This cannot be undone.')).toBeVisible()
    await page.screenshot({
      path: `/tmp/pika-cold-purge-dialog-${entry.name}.png`,
      fullPage: true,
    })

    await dialog.getByRole('textbox').fill('DELETE STORED ARCHIVE')
    await dialog.getByRole('button', { name: 'Delete permanently' }).click()
    await expect(dialog.getByRole('alert')).toContainText('waiting safely')
    await expect(dialog.getByText(/recovery archive is deleted last/i)).toBeVisible()
    await page.screenshot({
      path: `/tmp/pika-cold-purge-progress-${entry.name}.png`,
      fullPage: true,
    })
    await context.close()
  }

  for (const entry of teacherMatrix) {
    const { context, page } = await newRoleContext(
      () => browser.newContext({
        storageState: '.auth/student.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await page.goto('/classrooms')
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0)
    await page.screenshot({
      path: `/tmp/pika-cold-purge-student-boundary-${entry.name}.png`,
      fullPage: true,
    })
    await context.close()
  }
})
