import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const BLUEPRINT_ID = '10000000-0000-4000-8000-000000000101'

const blueprint = {
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

const matrix = [
  { name: 'desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light' as const },
  { name: 'desktop-dark', viewport: { width: 1440, height: 900 }, theme: 'dark' as const },
  { name: 'mobile-light', viewport: { width: 390, height: 844 }, theme: 'light' as const },
  { name: 'mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark' as const },
]

async function newTeacherPage(
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

async function mockBlueprintRollover(page: Page) {
  await page.route('**/api/teacher/course-blueprints', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ blueprints: [blueprint] }),
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

test('captures the teacher blueprint rollover review handoff', async ({ browser }) => {
  for (const entry of matrix) {
    const { context, page } = await newTeacherPage(
      () => browser.newContext({
        storageState: '.auth/teacher.json',
        viewport: entry.viewport,
      }),
      entry.theme,
    )
    await mockBlueprintRollover(page)
    await page.goto('/classrooms')
    await page.getByRole('button', { name: 'Organize classrooms' }).click()
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByRole('textbox', { name: 'Classroom Name' }).fill('Computer Science 11 - Period 2')
    await page.getByRole('button', { name: 'Choose classroom creation path' }).click()
    await page.getByRole('menuitem', { name: 'From Course Blueprint' }).click()
    await page.getByRole('combobox', { name: 'Course Blueprint' }).selectOption(BLUEPRINT_ID)
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByRole('heading', { name: 'Classroom Created' })).toBeVisible()
    await expect(page.getByText(/assignments and tests are unpublished/i)).toBeVisible()
    await expect(page.getByText('Final project workshop')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue to Classroom' })).toBeVisible()
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )).toBe(false)

    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(100)
    await page.screenshot({
      path: `/tmp/pika-blueprint-rollover-review-${entry.name}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    await context.close()
  }
})
