import { expect, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { PLANNED_COURSE_FIXTURE } from '../../scripts/seed-planned-course-fixtures'

const sections = [
  ['overview', 'Overview'],
  ['outline', 'Outline'],
  ['resources', 'Resources'],
  ['assignments', 'Assignments'],
  ['tests', 'Tests'],
  ['lesson-sequence', 'Lesson sequence'],
] as const

export async function verifyPublicCourseSectionTargets(page: Page, testInfo: TestInfo, motion: 'no-preference' | 'reduce') {
  const theme = testInfo.project.metadata.theme as 'light' | 'dark'
  const viewport = testInfo.project.metadata.viewport as 'desktop' | 'mobile'
  const unexpectedWrites: string[] = []
  page.on('request', request => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) unexpectedWrites.push(`${request.method()} ${new URL(request.url()).pathname}`)
  })
  await page.addInitScript(value => localStorage.setItem('theme', value), theme)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion })
  const response = await page.goto(`/planned/${PLANNED_COURSE_FIXTURE.publicSlug}`, { waitUntil: 'domcontentloaded' })
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Computer Science 11' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Python documentation', exact: true })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(page.viewportSize()).toEqual(viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 })
  expect(await page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(theme === 'dark')
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(motion === 'reduce')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  const source = `${await response!.text()}\n${await page.content()}`
  for (const value of [
    PLANNED_COURSE_FIXTURE.blueprintId, PLANNED_COURSE_FIXTURE.assignmentId,
    PLANNED_COURSE_FIXTURE.assessmentId, PLANNED_COURSE_FIXTURE.lessonTemplateId,
    PLANNED_COURSE_FIXTURE.privateQuestion, PLANNED_COURSE_FIXTURE.privateAnswer,
    PLANNED_COURSE_FIXTURE.privateDocumentTitle, PLANNED_COURSE_FIXTURE.privateDocumentUrl,
    PLANNED_COURSE_FIXTURE.questionId, PLANNED_COURSE_FIXTURE.documentId,
    PLANNED_COURSE_FIXTURE.assignmentArtifactId, PLANNED_COURSE_FIXTURE.assessmentArtifactId,
    PLANNED_COURSE_FIXTURE.lessonTemplateArtifactId,
  ]) expect(source).not.toContain(value)
  const resource = page.getByRole('link', { name: 'Python documentation', exact: true })
  await expect(resource).toHaveAttribute('href', 'https://docs.python.org/3/')
  await expect(resource).toHaveAttribute('target', '_blank')
  await expect(resource).toHaveAttribute('rel', /noopener/)
  await expect(page.getByText(/questions?/i)).toHaveCount(0)

  const navigation = page.getByRole('navigation', { name: 'Course sections' })
  await expect(navigation.getByRole('link')).toHaveCount(6)
  const measurements = await navigation.getByRole('link').evaluateAll(links => links.map(link => {
    const rect = link.getBoundingClientRect()
    return {
      label: link.textContent, href: link.getAttribute('href'), x: rect.x, y: rect.y,
      width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom,
      centerHit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === link,
    }
  }))
  const gaps: Array<{ first: string | null; second: string | null; horizontal: number; vertical: number; overlap: boolean }> = []
  const focus: Array<{ id: string; focusVisible: boolean; shadow: string; outlineStyle: string; outlineWidth: string }> = []
  const destinations: Array<{ id: string; hash: string; heading: string | null; top: number; bottom: number; scrollY: number }> = []
  try {
    for (const target of measurements) {
      expect(target.width).toBeGreaterThanOrEqual(44)
      expect(target.height).toBeGreaterThanOrEqual(44)
      expect(target.centerHit).toBe(true)
    }
    for (let first = 0; first < measurements.length; first++) {
      for (let second = first + 1; second < measurements.length; second++) {
        const a = measurements[first], b = measurements[second]
        const overlap = Math.min(a.right, b.right) > Math.max(a.x, b.x) && Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y)
        gaps.push({ first: a.href, second: b.href, horizontal: Math.max(b.x - a.right, a.x - b.right, 0), vertical: Math.max(b.y - a.bottom, a.y - b.bottom, 0), overlap })
        expect(overlap).toBe(false)
      }
    }
    for (const [id, label] of sections) {
      const link = navigation.getByRole('link', { name: label, exact: true })
      await expect(link).toHaveAttribute('href', `#${id}`)
      await page.keyboard.press('Tab')
      await expect(link).toBeFocused()
      const state = await link.evaluate(element => {
        const style = getComputedStyle(element)
        return { focusVisible: element.matches(':focus-visible'), shadow: style.boxShadow, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
      })
      focus.push({ id, ...state })
      expect(state.focusVisible).toBe(true)
      expect(state.shadow !== 'none' || (state.outlineStyle !== 'none' && parseFloat(state.outlineWidth) > 0)).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath('navigation-focused.png'), animations: 'allow' })
    await navigation.getByRole('link', { name: 'Overview', exact: true }).hover()
    await page.screenshot({ path: testInfo.outputPath('navigation-hover.png'), animations: 'allow' })
    for (let index = 0; index < sections.length; index++) {
      const [id] = sections[index]
      expect((await page.goto(`/planned/${PLANNED_COURSE_FIXTURE.publicSlug}`, { waitUntil: 'domcontentloaded' }))?.status()).toBe(200)
      await expect(resource).toBeVisible()
      for (let stop = 0; stop <= index; stop++) await page.keyboard.press('Tab')
      await expect(navigation.getByRole('link', { name: sections[index][1], exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect.poll(() => new URL(page.url()).hash).toBe(`#${id}`)
      const destination = await page.locator(`#${id} > h2`).evaluate(heading => {
        const rect = heading.getBoundingClientRect()
        return { heading: heading.textContent, top: rect.top, bottom: rect.bottom, scrollY, viewportHeight: innerHeight }
      })
      destinations.push({ id, hash: new URL(page.url()).hash, ...destination })
      expect(destination.heading?.toLowerCase()).toBe(sections[index][1].toLowerCase())
      expect(destination.top).toBeGreaterThanOrEqual(0)
      expect(destination.bottom).toBeLessThanOrEqual(destination.viewportHeight)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath('activated-section.png'), animations: 'allow' })
    const privateResponse = await page.goto(`/planned/${PLANNED_COURSE_FIXTURE.privateSlug}`, { waitUntil: 'domcontentloaded' })
    expect(privateResponse?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Course site not found', exact: true })).toBeVisible()
    await expect(page.getByText('Private Course Plan')).toHaveCount(0)
    await expect(page.getByText(/unavailable or has not been published/i)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(unexpectedWrites).toEqual([])
  } finally {
    await writeFile(testInfo.outputPath('receipt.json'), JSON.stringify({ theme, viewport, motion, measurements, gaps, focus, destinations, unexpectedWrites, publicStatus: response?.status(), naturalRendering: true }, null, 2))
  }
}
