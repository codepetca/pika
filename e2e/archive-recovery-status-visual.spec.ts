import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const CLASSROOM_ID = '20000000-0000-4000-8000-000000000099'
const ARCHIVE_ID = '30000000-0000-4000-8000-000000000099'

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

async function mockArchiveState(page: Page, state: 'unavailable' | 'available' | 'verified') {
  await page.route('**/api/teacher/classrooms?archived=true', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classrooms: [archivedClassroom],
        cold_archives: [],
        cold_archive_restore_enabled: false,
        hot_classroom_purge_enabled_ids: [],
        cold_classroom_purge_enabled_ids: [],
        hot_archive_recovery: [{
          classroom_id: CLASSROOM_ID,
          export_available: state !== 'unavailable',
          latest_archive: state === 'verified'
            ? {
                archive_id: ARCHIVE_ID,
                created_at: '2026-08-19T14:00:00.000Z',
                verified_at: '2026-08-19T14:01:00.000Z',
                compressed_byte_size: 2_489_962,
                retention: { mode: 'teacher_managed', delete_after: null },
              }
            : null,
          latest_operation: null,
        }],
      }),
    })
  })
}

async function openArchivedView(page: Page) {
  await page.goto('/classrooms')
  await page.getByRole('button', { name: 'Organize classrooms' }).click()
  await page.getByRole('button', { name: 'Archived' }).click()
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false)
}

test('captures hot archive recovery availability, confirmation, and verification', async ({ browser }) => {
  for (const entry of matrix) {
    const unavailable = await newRolePage(
      () => browser.newContext({
        storageState: '.auth/teacher.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await mockArchiveState(unavailable.page, 'unavailable')
    await openArchivedView(unavailable.page)
    await expect(unavailable.page.getByText(/Recovery copy unavailable/)).toBeVisible()
    await expect(unavailable.page.getByRole('button', { name: 'Create recovery copy' })).toHaveCount(0)
    await expectNoHorizontalOverflow(unavailable.page)
    await unavailable.page.screenshot({
      path: `/tmp/pika-archive-recovery-unavailable-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await unavailable.context.close()

    const available = await newRolePage(
      () => browser.newContext({
        storageState: '.auth/teacher.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await mockArchiveState(available.page, 'available')
    await openArchivedView(available.page)
    await expect(available.page.getByText('Database archive only')).toBeVisible()
    await expectNoHorizontalOverflow(available.page)
    await available.page.screenshot({
      path: `/tmp/pika-archive-recovery-available-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })

    await available.page.getByRole('button', { name: 'Create recovery copy' }).click()
    const dialog = available.page.getByRole('dialog', {
      name: 'Create a recovery copy of Archived Biology?',
    })
    await expect(dialog).toContainText('private, verified recovery copy')
    await expect(dialog).toContainText('no classroom data is removed')
    await available.page.screenshot({
      path: `/tmp/pika-archive-recovery-confirm-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await available.context.close()

    const verified = await newRolePage(
      () => browser.newContext({
        storageState: '.auth/teacher.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await mockArchiveState(verified.page, 'verified')
    await openArchivedView(verified.page)
    await expect(verified.page.getByText('Recovery copy verified')).toBeVisible()
    await expect(verified.page.getByText(/2\.4 MB/)).toBeVisible()
    await expect(verified.page.getByText('Kept until you delete it')).toBeVisible()
    await expect(verified.page.getByRole('button', { name: 'Create recovery copy' })).toHaveCount(0)
    await expectNoHorizontalOverflow(verified.page)
    await verified.page.screenshot({
      path: `/tmp/pika-archive-recovery-verified-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await verified.context.close()
  }
})

test('keeps archive recovery controls absent from the student classroom index', async ({ browser }) => {
  for (const entry of matrix) {
    const { context, page } = await newRolePage(
      () => browser.newContext({
        storageState: '.auth/student.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await page.goto('/classrooms')
    await expect(page.getByRole('button', { name: 'Create recovery copy' })).toHaveCount(0)
    await expect(page.getByText('Recovery copy verified')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    await context.close()
  }
})
