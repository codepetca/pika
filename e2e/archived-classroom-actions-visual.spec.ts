import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const CLASSROOM_ID = '20000000-0000-4000-8000-000000000099'

const archivedClassroom = {
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
  await page.route('**/api/teacher/classrooms?archived=true', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classrooms: [archivedClassroom],
        cold_archives: [],
        cold_archive_restore_enabled: false,
        hot_classroom_purge_enabled_ids: [CLASSROOM_ID],
        cold_classroom_purge_enabled_ids: [],
      }),
    })
  })
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
    await mockTeacherArchive(page)
    await page.goto('/classrooms')
    await page.getByRole('button', { name: 'Organize classrooms' }).click()
    await page.getByRole('button', { name: 'Archived' }).click()

    await expect(page.getByRole('button', { name: 'Reuse' })).toBeVisible()
    const unarchiveButton = page.getByRole('button', { name: 'Unarchive' })
    await expect(unarchiveButton).toBeVisible()
    const deleteButton = page.getByRole('button', { name: 'Delete permanently' })
    await expect(deleteButton).toBeVisible()
    await expect(deleteButton.locator('svg.lucide-trash-2')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(100)
    await page.screenshot({
      path: `/tmp/pika-archive-actions-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })

    await unarchiveButton.click()
    const dialog = page.getByRole('dialog', { name: 'Unarchive Archived Biology?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Unarchive' })).toBeVisible()
    await page.screenshot({
      path: `/tmp/pika-unarchive-dialog-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
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
    await expect(page.getByRole('button', { name: 'Reuse' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Unarchive' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({
      path: `/tmp/pika-archive-actions-student-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await context.close()
  }
})
