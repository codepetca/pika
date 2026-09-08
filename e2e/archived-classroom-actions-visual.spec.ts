import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test.setTimeout(120_000)

const CLASSROOM_ID = '20000000-0000-4000-8000-000000000099'

const archivedClassroom = {
  id: CLASSROOM_ID,
  teacher_id: '10000000-0000-4000-8000-000000000001',
  title: 'Archived Biology',
  class_code: 'BIO101',
  theme_color: 'teal',
  term_label: 'Winter 2026',
  allow_enrollment: false,
  start_date: '2025-09-02',
  end_date: '2026-01-30',
  lesson_plan_visibility: 'current_week',
  archived_at: '2026-06-30T12:00:00.000Z',
  created_at: '2026-01-01T12:00:00.000Z',
  updated_at: '2026-06-30T12:00:00.000Z',
}

const matrix = [
  { name: 'desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light' as const },
  { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' as const },
  { name: 'mobile-light', viewport: { width: 390, height: 844 }, theme: 'light' as const },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark' as const },
]

async function newRolePage(
  browserContextFactory: () => Promise<BrowserContext>,
  theme: 'light' | 'dark',
) {
  const context = await browserContextFactory()
  const page = await context.newPage()
  await page.addInitScript((selectedTheme) => {
    localStorage.setItem('theme', selectedTheme)
  }, theme)
  return { context, page }
}

async function mockTeacherArchive(page: Page) {
  let attendanceState: 'none' | 'fenced' | 'completed' = 'none'
  await page.route('**/api/teacher/classrooms?archived=true', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classrooms: [archivedClassroom, { ...archivedClassroom, id: '20000000-0000-4000-8000-000000000098', title: 'Archived Chemistry', term_label: 'Fall 2025', theme_color: 'blue', start_date: null, end_date: null }],
        cold_archives: [],
        cold_archive_restore_enabled: false,
        hot_classroom_purge_enabled_ids: [CLASSROOM_ID],
        cold_classroom_purge_enabled_ids: [],
      }),
    })
  })
  await page.route(`**/api/teacher/classrooms/${CLASSROOM_ID}/purge`, async (route) => {
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        impact: {
          classroom_id: CLASSROOM_ID,
          classroom_title: archivedClassroom.title,
          source_revision: 7,
          storage_inventory_sha256: 'a'.repeat(64),
          operational_inventory_sha256: 'b'.repeat(64),
          relational_row_count: 428,
          student_count: 31,
          managed_file_count: 18,
          managed_file_bytes: 6_291_456,
          missing_file_count: 0,
          archive_count: 1,
          gradex_extract_count: 0,
          interrupted_upload_count: 0,
          resource_counts: { classrooms: 1 },
          storage_counts: { 'submission-images': 18 },
          conflicting_operation: null,
          deletion_available: true,
          unavailable_reason: null,
        },
        operation: null,
      }),
    })
  })
  await page.route(
    `**/api/teacher/classrooms/${CLASSROOM_ID}/attendance-decommission/*`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
      await route.fulfill({
        status: attendanceState === 'none' ? 404 : 200,
        contentType: 'application/json',
        body: JSON.stringify(attendanceState !== 'none' ? {
          operation: {
            operation_id: '30000000-0000-5000-8000-000000000001',
            state: attendanceState === 'completed' ? 'local_deleted' : 'fenced',
            deleted_count: 127,
            attendance_removed: attendanceState === 'completed',
            classroom_deleted: false,
          },
        } : { error: 'Not found' }),
      })
    },
  )
  return { setAttendanceState: (state: 'fenced' | 'completed') => { attendanceState = state } }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false)
}

test('captures archived Classroom actions and student boundaries', async ({ browser }) => {
  for (const entry of matrix) {
    const { context, page } = await newRolePage(
      () => browser.newContext({
        storageState: '.auth/teacher.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    const deletionFixture = await mockTeacherArchive(page)
    await page.goto('/classrooms')
    await page.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'Show Archived' }).click()

    const settings = page.getByRole('button', { name: 'Settings for Archived Biology' })
    await expect(settings).toBeVisible()
    await expect(settings).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('Sept 2025 - Jan 2026')).toBeVisible()
    await expect(page.getByText(archivedClassroom.class_code)).toHaveCount(0)
    const bounds = (await settings.boundingBox())!
    expect(bounds.width).toBeGreaterThanOrEqual(44)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
    await settings.hover()
    await expect(page.getByRole('tooltip')).toHaveText('Settings')
    await page.screenshot({ path: `/tmp/pika-archive-actions-closed-${entry.name}.png`, fullPage: true, animations: 'disabled' })
    await settings.click()
    const menu = page.getByRole('menu', { name: 'Settings for Archived Biology' })
    const reuse = menu.getByRole('menuitem', { name: 'Reuse' })
    const unarchive = menu.getByRole('menuitem', { name: 'Unarchive' })
    const remove = menu.getByRole('menuitem', { name: 'Delete', exact: true })
    await expect(reuse).toBeFocused()
    await expect(settings).toHaveAttribute('aria-expanded', 'true')
    await expect(unarchive).toBeVisible()
    await expect(remove).toBeEnabled()
    await expectNoHorizontalOverflow(page)
    await page.keyboard.press('End')
    await expect(remove).toBeFocused()
    await remove.click({ trial: true })
    await page.screenshot({ path: `/tmp/pika-archive-actions-${entry.name}.png`, fullPage: true, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(settings).toBeFocused()
    await expect(page.getByRole('heading', { name: 'Archived classrooms' })).toBeVisible()
    await expect(menu).toBeHidden()

    await settings.click()
    await remove.click()
    const deleteDialog = page.getByRole('dialog', { name: 'Delete classroom permanently?' })
    await expect(deleteDialog.getByText('This cannot be undone.')).toBeVisible()
    await expect(deleteDialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled()
    const deleteDialogBody = deleteDialog.locator('.overflow-y-auto')
    expect(await deleteDialogBody.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    )).toBe(false)
    await page.screenshot({
      path: `/tmp/pika-coordinated-delete-confirm-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click()

    deletionFixture.setAttendanceState('fenced')
    await settings.click()
    await remove.click()
    const progressDialog = page.getByRole('dialog', { name: 'Delete classroom permanently?' })
    await expect(progressDialog.getByText('Removing linked attendance…')).toBeVisible()
    await expect(progressDialog.getByRole('button', { name: 'Continue deletion' })).toBeEnabled()
    const closeProgressButton = progressDialog.getByRole('button', { name: 'Close', exact: true }).last()
    await expect(closeProgressButton).toBeEnabled()
    await page.screenshot({
      path: `/tmp/pika-coordinated-delete-progress-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await closeProgressButton.click()

    deletionFixture.setAttendanceState('completed')
    await settings.click()
    await remove.click()
    const finalConfirmationDialog = page.getByRole('dialog', { name: 'Delete classroom permanently?' })
    await expect(finalConfirmationDialog.getByText('Linked attendance removed')).toBeVisible()
    await expect(finalConfirmationDialog.getByRole('textbox')).toBeVisible()
    const finalContinueButton = finalConfirmationDialog.getByRole('button', { name: 'Continue deletion' })
    await expect(finalContinueButton).toBeDisabled()
    await page.screenshot({
      path: `/tmp/pika-coordinated-delete-final-confirm-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await finalContinueButton.scrollIntoViewIfNeeded()
    await expect(finalContinueButton).toBeVisible()
    await page.screenshot({
      path: `/tmp/pika-coordinated-delete-final-actions-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await finalConfirmationDialog.getByRole('button', { name: 'Close', exact: true }).last().click()

    await page.getByRole('link', { name: 'Home' }).click()
    await expect(page.getByRole('heading', { name: 'Active classrooms' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Archived Biology' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({
      path: `/tmp/pika-logo-home-active-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })

    await page.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'Show Archived' }).click()
    await settings.click()
    await unarchive.click()
    const dialog = page.getByRole('dialog', { name: 'Unarchive Archived Biology?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Unarchive' })).toBeVisible()
    await page.screenshot({
      path: `/tmp/pika-unarchive-dialog-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(settings).toBeFocused()
    await context.close()
  }

  for (const entry of matrix) {
    const { context, page } = await newRolePage(
      () => browser.newContext({
        storageState: '.auth/student.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await page.goto('/classrooms')
    await expect(page.getByRole('button', { name: /^Settings for / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Unarchive' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(100)
    await page.screenshot({
      path: `/tmp/pika-archive-actions-student-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await context.close()
  }
})
