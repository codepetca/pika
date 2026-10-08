import { expect, type Page, type TestInfo } from '@playwright/test'

export const BLUEPRINT_RECOVERY_LIST = [
  { id: 'b-1', title: 'Blueprint One', subject: '', grade_level: '', course_code: '' },
  { id: 'b-2', title: 'Blueprint Two', subject: 'Computer Science', grade_level: 'Grade 11', course_code: 'ICS3U' },
]

export function blueprintRecoveryDetail(id: string) {
  return {
    ...BLUEPRINT_RECOVERY_LIST.find((item) => item.id === id),
    teacher_id: 'teacher-1', authority_mode: 'pika', term_template: '',
    overview_markdown: 'Overview', outline_markdown: 'Outline', resources_markdown: 'Resources',
    gradebook_use_weights: true, gradebook_assignments_weight: 65, gradebook_tests_weight: 35,
    planned_site_slug: null, planned_site_published: false,
    planned_site_config: { overview: true, outline: true, resources: true, assignments: true, tests: true, lesson_plans: true },
    assignments: [], assessments: [], lesson_templates: [], materials: [], surveys: [], linked_classrooms: [],
  }
}

/** Actual client owner in a gated development fixture; no server/auth failure is simulated. */
export async function verifyBlueprintRecovery(
  page: Page,
  testInfo: TestInfo,
  failure: 'list' | 'detail',
  reducedMotion: 'no-preference' | 'reduce',
) {
  const theme = testInfo.project.metadata.theme
  if (theme !== 'light' && theme !== 'dark') throw new Error('Missing experience theme')
  await page.emulateMedia({ reducedMotion })
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
  let targetReads = 0
  const mutationMethods: string[] = []
  let releaseRetry!: () => void
  const retryResponse = new Promise<void>((resolve) => { releaseRetry = resolve })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      mutationMethods.push(request.method())
      await route.abort()
      return
    }
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/auth/me') {
      await route.fulfill({ json: { user: { id: 'teacher-1', role: 'teacher', email: 'teacher@example.invalid' } } })
      return
    }
    const isList = pathname === '/api/teacher/course-blueprints'
    const isDetail = pathname === '/api/teacher/course-blueprints/b-1'
    if ((failure === 'list' && isList) || (failure === 'detail' && isDetail)) {
      targetReads += 1
      if (targetReads === 1) {
        await route.fulfill({ status: 503, json: { error: 'Synthetic internal read failure' } })
        return
      }
      await retryResponse
    }
    if (isList) await route.fulfill({ json: { blueprints: BLUEPRINT_RECOVERY_LIST } })
    else if (isDetail) await route.fulfill({ json: { blueprint: blueprintRecoveryDetail('b-1') } })
    else await route.fulfill({ json: { proposals: [], history: [], classrooms: [] } })
  })

  await page.goto('/e2e-fixtures/teacher-blueprints', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: 'nextjs-portal { visibility: hidden !important; }' })
  const region = page.getByRole('region', { name: failure === 'list' ? 'Course blueprint list' : 'Selected course blueprint', exact: true })
  const errorTitle = failure === 'list' ? 'Could not load course blueprints' : 'Could not load course blueprint'
  const loadingTitle = failure === 'list' ? 'Loading course blueprints' : 'Loading course blueprint'
  const retry = region.getByRole('button', { name: failure === 'list' ? 'Retry course blueprint list' : 'Retry selected course blueprint', exact: true })
  const capture = async (state: string) => {
    const path = testInfo.outputPath(`blueprint-${failure}-${reducedMotion}-${state}.png`)
    await page.screenshot({ path, fullPage: true })
    await testInfo.attach(`blueprint-${failure}-${state}`, { path, contentType: 'image/png' })
  }
  await expect(region.getByRole('heading', { name: errorTitle, exact: true })).toBeVisible()
  await expect(page.getByText('Synthetic internal read failure', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No course blueprints yet.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Select a course blueprint to edit its course package.', { exact: true })).toHaveCount(0)
  await capture('failed')
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(region).toBeFocused()
  await expect(region.getByRole('heading', { name: loadingTitle, exact: true })).toBeVisible()
  await expect(region.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  await expect(retry).toHaveCount(0)
  await expect.poll(() => targetReads).toBe(2)
  const animation = await region.locator('svg.animate-spin').evaluate((element) => getComputedStyle(element).animationName)
  expect(animation).toBe(reducedMotion === 'reduce' ? 'none' : 'spin')
  await capture('pending')
  releaseRetry()
  const selected = page.getByRole('region', { name: 'Selected course blueprint', exact: true })
  await expect(selected.getByRole('heading', { name: 'Blueprint One', exact: true })).toBeVisible()
  await expect(region).toBeFocused()
  await expect(page.getByRole('button', { name: 'Blueprint One No metadata yet', exact: true })).toBeVisible()
  await expect(region.getByRole('heading', { name: errorTitle, exact: true })).toHaveCount(0)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(targetReads).toBe(2)
  expect(mutationMethods).toEqual([])
  await capture('recovered')
}
