import fs from 'fs'
import path from 'path'
import type { Page } from '@playwright/test'
import type { VerificationCheck, VerificationResult, VerificationScript } from './types'

const ARTIFACT_DIR = path.join(process.cwd(), 'artifacts', 'course-guide-curriculum-import')
const CLASSROOM_ID = '30000000-0000-4000-8000-000000000021'

const guide = {
  classroom: { title: 'Computer Studies 11' },
  visibility: {
    overview: true,
    resources: true,
    assignments: true,
    tests: true,
  },
  overviewMarkdown: 'Teacher-authored course purpose and local classroom context.',
  resourcesContent: null,
  assignments: [{ key: 'assignment:0', title: 'Design portfolio' }],
  tests: [{ key: 'test:0', title: 'Programming concepts test' }],
}

const draft = {
  sourceTitle: 'The Ontario Curriculum, Grades 10 to 12: Computer Studies',
  sourceUrl: 'https://example.ca/ontario-computer-studies.pdf',
  sourceFilename: null,
  sourceLabel: '[The Ontario Curriculum](https://example.ca/ontario-computer-studies.pdf)',
  overviewMarkdown: 'Students develop computational thinking and software design skills.',
  expectationsMarkdown: '- A1. Use project management skills.\n- B1. Design algorithms to solve problems.',
  sourceLinks: [
    { title: 'Ontario curriculum landing page', url: 'https://example.ca/curriculum' },
  ],
  draftMarkdown: [
    '## Curriculum overview',
    'Students develop computational thinking and software design skills.',
    '## Expectations',
    '- A1. Use project management skills.\n- B1. Design algorithms to solve problems.',
    '## Source links',
    '- [Ontario curriculum landing page](https://example.ca/curriculum)',
  ].join('\n\n'),
  citationMarkdown: 'Source: The Ontario Curriculum, Grades 10 to 12: Computer Studies — https://example.ca/ontario-computer-studies.pdf',
}

async function configureThemeAndViewport(
  page: Page,
  theme: 'light' | 'dark',
  viewport: 'desktop' | 'mobile',
) {
  await page.setViewportSize(viewport === 'mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: theme })
  await page.evaluate((nextTheme) => {
    localStorage.setItem('theme', nextTheme)
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  }, theme)
}

async function openOptions(page: Page, baseUrl: string) {
  await page.goto(`${baseUrl}/e2e-fixtures/course-guide-import`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Course guide', exact: true }).waitFor()
  const moreButton = page.getByRole('button', { name: 'More actions' })
  if (await moreButton.getAttribute('aria-expanded') !== 'true') await moreButton.click()
  await page.getByRole('menuitem', { name: 'Guide options' }).click()
}

async function openImport(page: Page) {
  await page.getByRole('button', { name: 'Import curriculum' }).click()
  await page.getByRole('dialog', { name: 'Import curriculum' }).waitFor()
}

async function capture(page: Page, filename: string) {
  const artifact = path.join(ARTIFACT_DIR, filename)
  await page.screenshot({ path: artifact, fullPage: true, animations: 'disabled' })
  return artifact
}

export const courseGuideCurriculumImport: VerificationScript = {
  name: 'course-guide-curriculum-import',
  description: 'Verify the teacher curriculum import review flow and student isolation',
  role: 'unauthenticated',

  async run(page, baseUrl): Promise<VerificationResult> {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
    const checks: VerificationCheck[] = []
    const artifacts: string[] = []
    let draftShouldFail = false

    await page.route(`**/api/classrooms/${CLASSROOM_ID}/course-guide`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ guide }),
      })
    })
    await page.route(`**/api/teacher/classrooms/${CLASSROOM_ID}/curriculum-import/draft`, async (route) => {
      await route.fulfill({
        status: draftShouldFail ? 422 : 200,
        contentType: 'application/json',
        body: JSON.stringify(draftShouldFail
          ? { error: 'Pika could not extract this curriculum source. Try another PDF or link.' }
          : { draft, provenanceToken: 'p'.repeat(80) }),
      })
    })

    await page.goto(`${baseUrl}/e2e-fixtures/course-guide-import`, { waitUntil: 'domcontentloaded' })
    await configureThemeAndViewport(page, 'light', 'desktop')
    await page.getByRole('heading', { name: 'Course guide', exact: true }).waitFor()
    checks.push({
      name: 'Teacher Course Guide uses a right-aligned More actions trigger',
      passed: await page.getByRole('button', { name: 'More actions' }).isVisible(),
    })
    artifacts.push(await capture(page, 'teacher-desktop-light-guide.png'))
    await page.getByRole('button', { name: 'More actions' }).click()
    checks.push({
      name: 'Teacher More menu exposes Edit, Markdown, and guide options',
      passed: await page.getByRole('menuitem', { name: 'Edit', exact: true }).isVisible()
        && await page.getByRole('menuitem', { name: 'Edit with Markdown' }).isVisible()
        && await page.getByRole('menuitem', { name: 'Guide options' }).isVisible(),
    })
    artifacts.push(await capture(page, 'teacher-desktop-light-actions.png'))
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    checks.push({
      name: 'Teacher Edit opens the visual document editor directly in the page',
      passed: await page.getByRole('textbox', { name: 'Course guide' }).isVisible()
        && await page.getByRole('heading', { name: 'Resources' }).count() === 0,
    })
    artifacts.push(await capture(page, 'teacher-desktop-light-visual-editor.png'))

    await openOptions(page, baseUrl)
    await configureThemeAndViewport(page, 'light', 'desktop')
    checks.push({
      name: 'Teacher options keep the guide focused on orientation sections',
      passed: await page.getByText(/compact title lists/i).isVisible()
        && await page.getByRole('button', { name: /Resources/ }).count() === 0
        && await page.getByRole('button', { name: /Lesson sequence/ }).count() === 0
        && await page.getByRole('button', { name: /Announcements/ }).count() === 0,
    })
    artifacts.push(await capture(page, 'teacher-desktop-light-options.png'))

    await openImport(page)
    checks.push({
      name: 'Teacher source step is visible on desktop',
      passed: await page.getByText(/one-time draft/i).isVisible(),
    })
    artifacts.push(await capture(page, 'teacher-desktop-light-source.png'))

    await page.getByRole('button', { name: 'Public URL' }).click()
    await page.getByLabel('Public document URL').fill('https://example.ca/ontario-computer-studies.pdf')
    await page.getByRole('button', { name: 'Create draft' }).click()
    await page.getByLabel('Imported curriculum draft').waitFor()
    await configureThemeAndViewport(page, 'dark', 'desktop')
    checks.push({
      name: 'Teacher review shows an editable cited draft',
      passed: await page.getByText(/Citation added on confirmation/).isVisible()
        && await page.getByText(/Nothing has been added/).isVisible(),
    })
    artifacts.push(await capture(page, 'teacher-desktop-dark-review.png'))

    await page.getByRole('button', { name: 'Continue to confirmation' }).click()
    await configureThemeAndViewport(page, 'light', 'mobile')
    checks.push({
      name: 'Mobile confirmation preserves existing teacher content',
      passed: await page.getByText(/existing teacher content will remain unchanged/i).isVisible(),
    })
    checks.push({
      name: 'No horizontal overflow in the mobile dialog',
      passed: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    artifacts.push(await capture(page, 'teacher-mobile-light-confirm.png'))

    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await configureThemeAndViewport(page, 'dark', 'mobile')
    checks.push({
      name: 'Mobile dark source chooser remains legible',
      passed: await page.getByRole('button', { name: 'Upload PDF' }).isVisible(),
    })
    artifacts.push(await capture(page, 'teacher-mobile-dark-source.png'))

    draftShouldFail = true
    await page.getByRole('button', { name: 'Create draft' }).click()
    await page.getByRole('alert').waitFor()
    checks.push({
      name: 'Extraction failure stays in the source step with safe retry copy',
      passed: await page.getByRole('alert').getByText(/could not extract/i).isVisible()
        && await page.getByRole('button', { name: 'Add reviewed draft' }).count() === 0,
    })
    artifacts.push(await capture(page, 'teacher-mobile-dark-error.png'))

    await page.goto(`${baseUrl}/e2e-fixtures/course-guide-import`, { waitUntil: 'domcontentloaded' })
    await configureThemeAndViewport(page, 'dark', 'mobile')
    await page.getByRole('heading', { name: 'Course guide', exact: true }).waitFor()
    await page.getByRole('button', { name: 'More actions' }).click()
    checks.push({
      name: 'Teacher mobile More menu exposes both direct editing modes',
      passed: await page.getByRole('menuitem', { name: 'Edit', exact: true }).isVisible()
        && await page.getByRole('menuitem', { name: 'Edit with Markdown' }).isVisible(),
    })
    artifacts.push(await capture(page, 'teacher-mobile-dark-actions.png'))
    await page.getByRole('menuitem', { name: 'Edit with Markdown' }).click()
    checks.push({
      name: 'Teacher Markdown action opens the source editor directly in the page',
      passed: await page.getByRole('textbox', { name: 'Course guide Markdown' }).isVisible()
        && await page.getByRole('heading', { name: 'Resources' }).count() === 0,
    })
    checks.push({
      name: 'No horizontal overflow in the mobile Course Guide editor',
      passed: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    artifacts.push(await capture(page, 'teacher-mobile-dark-markdown-editor.png'))

    await page.goto(`${baseUrl}/e2e-fixtures/course-guide-import?role=student`, {
      waitUntil: 'domcontentloaded',
    })
    await configureThemeAndViewport(page, 'light', 'desktop')
    await page.getByRole('heading', { name: 'Assignments', exact: true }).waitFor()
    checks.push({
      name: 'Student guide has no teacher import controls',
      passed: await page.getByRole('button', { name: 'Import curriculum' }).count() === 0
        && await page.getByRole('button', { name: 'More actions' }).count() === 0,
    })
    checks.push({
      name: 'Student guide shows the compact assignment title',
      passed: await page.locator('li:visible').filter({ hasText: 'Design portfolio' }).count() > 0,
    })
    checks.push({
      name: 'Student guide shows the compact test title',
      passed: await page.locator('li:visible').filter({ hasText: 'Programming concepts test' }).count() > 0,
    })
    checks.push({
      name: 'Student guide omits Lesson sequence and Announcements',
      passed: await page.getByRole('heading', { name: 'Lesson sequence', exact: true }).count() === 0
        && await page.getByRole('heading', { name: 'Announcements', exact: true }).count() === 0
        && await page.getByRole('heading', { name: 'Resources', exact: true }).count() === 0,
    })
    artifacts.push(await capture(page, 'student-desktop-light-guide.png'))

    await configureThemeAndViewport(page, 'dark', 'mobile')
    checks.push({
      name: 'Student mobile guide remains free of import controls',
      passed: await page.getByRole('button', { name: 'Import curriculum' }).count() === 0,
    })
    artifacts.push(await capture(page, 'student-mobile-dark-guide.png'))

    await page.goto(`${baseUrl}/e2e-fixtures/course-guide-import?role=public`, {
      waitUntil: 'domcontentloaded',
    })
    await configureThemeAndViewport(page, 'light', 'desktop')
    checks.push({
      name: 'Public guide uses the same title-only orientation presentation',
      passed: await page.getByText('Design portfolio').isVisible()
        && await page.getByText('Programming concepts test').isVisible()
        && await page.getByRole('heading', { name: 'Lesson sequence' }).count() === 0
        && await page.getByRole('heading', { name: 'Announcements' }).count() === 0,
    })
    artifacts.push(await capture(page, 'public-desktop-light-guide.png'))

    return {
      scenario: 'course-guide-curriculum-import',
      passed: checks.every((check) => check.passed),
      checks,
      artifacts,
    }
  },
}
