import fs from 'fs'
import path from 'path'
import type { VerificationCheck, VerificationResult, VerificationScript } from './types'

const PAGES = ['Gradebook', 'Calendar', 'Announcements', 'Roster'] as const
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const

export const patternLabPageMockups: VerificationScript = {
  name: 'pattern-lab-page-mockups',
  description: 'Capture and exercise the experimental classroom page mockups',
  role: 'unauthenticated',

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks: VerificationCheck[] = []
    const artifacts: string[] = []
    const artifactDir = path.join(process.cwd(), 'artifacts', 'pattern-lab-page-mockups')
    fs.mkdirSync(artifactDir, { recursive: true })

    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    await page.goto(`${baseUrl}/pattern-lab?role=teacher#page-mockups`)
    const section = page.locator('#page-mockups')
    await section.scrollIntoViewIfNeeded()

    for (const theme of ['light', 'dark'] as const) {
      const wantedButton = theme === 'dark' ? 'Use dark theme' : 'Use light theme'
      const themeButton = page.getByRole('button', { name: wantedButton })
      if (await themeButton.isVisible().catch(() => false)) await themeButton.click()

      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport)
        for (const pageName of PAGES) {
          await section.getByRole('tab', { name: pageName }).click()
          const targetId = await section.getByRole('tab', { name: pageName }).getAttribute('aria-controls')
          checks.push({
            name: `${viewportName} ${theme} ${pageName} tab target exists`,
            passed: Boolean(targetId && await page.locator(`#${targetId}`).count()),
          })
          checks.push({
            name: `${viewportName} ${theme} ${pageName} has no page overflow`,
            passed: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
          })
          const artifact = path.join(artifactDir, `${viewportName}-${theme}-${pageName.toLowerCase()}.png`)
          await section.screenshot({ path: artifact })
          artifacts.push(artifact)
        }
      }
    }

    await page.setViewportSize(VIEWPORTS.desktop)
    await section.getByRole('tab', { name: 'Gradebook' }).click()
    await section.getByRole('combobox', { name: 'Example state' }).selectOption('error')
    await section.getByRole('button', { name: 'Try loading gradebook again' }).click()
    checks.push({ name: 'Retry restores populated Gradebook fixture', passed: await section.getByRole('table').isVisible() })
    await section.getByRole('checkbox', { name: 'Select Maya Chen' }).click()
    await section.getByRole('button', { name: 'Selected students (1)' }).click()
    await section.getByRole('menuitem', { name: 'Email 1 selected' }).click()
    checks.push({ name: 'Prototype command gives explicit feedback', passed: await section.getByRole('status').getByText(/Example only/).isVisible() })

    await page.goto(`${baseUrl}/pattern-lab?role=student`)
    checks.push({ name: 'Student gallery excludes teacher page mockups', passed: await page.locator('#page-mockups').count() === 0 })

    return {
      scenario: 'pattern-lab-page-mockups',
      passed: checks.every((check) => check.passed),
      checks,
      artifacts,
    }
  },
}
