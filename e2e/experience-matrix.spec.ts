import { expect, test, type Page, type TestInfo } from '@playwright/test'

const TEACHER_STORAGE = '.auth/teacher.json'
const STUDENT_STORAGE = '.auth/student.json'

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

  const tab = role === 'teacher' ? 'attendance' : 'today'
  await page.goto(`/classrooms/${seededClassroom.id}?tab=${tab}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })

  return seededClassroom.id
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
    await expect(navigation.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    await verifyProjectContract(page, testInfo)
  })
})
