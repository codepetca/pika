import fs from 'fs'
import path from 'path'
import type { VerificationCheck, VerificationResult, VerificationScript } from './types'

const PAGES = ['Classrooms', 'Gradebook', 'Calendar', 'Announcements', 'Roster', 'Settings', 'Workspaces'] as const
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
    await page.goto(`${baseUrl}/pattern-lab?role=teacher`)
    const navigator = page.getByRole('navigation', { name: 'Pattern Lab sections' })
    const jumpSelect = navigator.getByRole('combobox', { name: 'Find a pattern' })
    const section = page.locator('#page-mockups')
    await jumpSelect.selectOption('page-mockups')
    await page.waitForTimeout(100)
    checks.push({
      name: 'Navigator jumps directly to the page mockups',
      passed: await page.evaluate(() => window.location.hash === '#page-mockups'),
    })
    checks.push({
      name: 'Navigator remains visible after a deep-page jump',
      passed: await navigator.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top >= 0 && bounds.top < 24 && bounds.bottom <= window.innerHeight
      }),
    })

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
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    await page.evaluate(() => localStorage.setItem('theme', 'light'))
    await page.reload()
    await page.locator('html:not(.dark)').waitFor()
    await jumpSelect.selectOption('page-actions')
    await page.waitForTimeout(100)
    const desktopNavigatorArtifact = path.join(artifactDir, 'navigator-desktop-light.png')
    await page.screenshot({ path: desktopNavigatorArtifact })
    artifacts.push(desktopNavigatorArtifact)
    checks.push({
      name: 'Desktop navigator exposes quick links',
      passed: await navigator.getByRole('link', { name: 'Page mockups' }).isVisible(),
    })
    await jumpSelect.selectOption('status-colors')
    await page.waitForTimeout(100)
    checks.push({
      name: 'Nested status-color destination clears the sticky navigator',
      passed: await page.evaluate(() => {
        const navigation = document.querySelector<HTMLElement>('nav[aria-label="Pattern Lab sections"]')
        const target = document.getElementById('status-colors')
        return Boolean(navigation && target && target.getBoundingClientRect().top >= navigation.getBoundingClientRect().bottom)
      }),
    })

    await page.setViewportSize(VIEWPORTS.mobile)
    const darkButton = page.getByRole('button', { name: 'Use dark theme' })
    if (await darkButton.isVisible().catch(() => false)) await darkButton.click()
    await jumpSelect.selectOption('assignment-creation')
    await page.waitForTimeout(100)
    const mobileNavigatorArtifact = path.join(artifactDir, 'navigator-mobile-dark.png')
    await page.screenshot({ path: mobileNavigatorArtifact })
    artifacts.push(mobileNavigatorArtifact)
    checks.push({
      name: 'Mobile navigator stays visible without page overflow',
      passed: await navigator.isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    await page.setViewportSize(VIEWPORTS.desktop)
    await page.evaluate(() => localStorage.setItem('theme', 'light'))
    await page.reload()
    await page.locator('html:not(.dark)').waitFor()
    await jumpSelect.selectOption('mockup-classrooms-panel')
    await page.waitForTimeout(100)
    checks.push({
      name: 'Navigator opens the Classrooms mockup directly',
      passed: await section.getByRole('tab', { name: 'Classrooms' }).getAttribute('aria-selected') === 'true'
        && await section.getByRole('tabpanel', { name: 'Classrooms' }).isVisible()
        && await page.evaluate(() => window.location.hash === '#mockup-classrooms-panel'),
    })
    await jumpSelect.selectOption('mockup-settings-panel')
    await page.waitForTimeout(100)
    checks.push({
      name: 'Navigator opens the Settings mockup directly',
      passed: await section.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected') === 'true'
        && await section.getByRole('tabpanel', { name: 'Settings' }).isVisible()
        && await page.evaluate(() => window.location.hash === '#mockup-settings-panel'),
    })
    await jumpSelect.selectOption('mockup-workspaces-panel')
    await page.waitForTimeout(100)
    checks.push({
      name: 'Navigator opens the Classwork and Tests workspace mockup directly',
      passed: await section.getByRole('tab', { name: 'Workspaces' }).getAttribute('aria-selected') === 'true'
        && await section.getByRole('tabpanel', { name: 'Workspaces' }).isVisible()
        && await page.evaluate(() => window.location.hash === '#mockup-workspaces-panel'),
    })
    await navigator.evaluate((element) => { element.style.position = 'static' })
    await jumpSelect.selectOption('page-mockups')
    await section.getByRole('tab', { name: 'Classrooms' }).click()
    const classrooms = section.getByTestId('classrooms-mockup')
    await classrooms.getByRole('button', { name: 'Classroom actions' }).click()
    checks.push({
      name: 'Classroom bottom menu contains create, edit, Active, and Archived actions',
      passed: await classrooms.getByRole('menuitem', { name: 'Create classroom' }).isVisible()
        && await classrooms.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).isVisible()
        && await classrooms.getByRole('menuitemradio', { name: 'Active' }).isVisible()
        && await classrooms.getByRole('menuitemradio', { name: 'Archived' }).isVisible(),
    })
    const classroomMenuArtifact = path.join(artifactDir, 'desktop-light-classrooms-menu.png')
    await section.screenshot({ path: classroomMenuArtifact })
    artifacts.push(classroomMenuArtifact)
    await classrooms.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).click()
    const classroomEditArtifact = path.join(artifactDir, 'desktop-light-classrooms-edit.png')
    await section.screenshot({ path: classroomEditArtifact })
    artifacts.push(classroomEditArtifact)
    await classrooms.getByRole('button', { name: 'Classroom actions' }).click()
    await classrooms.getByRole('menuitemradio', { name: 'Archived' }).click()
    checks.push({
      name: 'Archived Classroom scope leaves edit mode',
      passed: await classrooms.getByText('Archived classrooms').isVisible()
        && await classrooms.getByText('Editing').count() === 0,
    })
    const classroomArchivedArtifact = path.join(artifactDir, 'desktop-light-classrooms-archived.png')
    await section.screenshot({ path: classroomArchivedArtifact })
    artifacts.push(classroomArchivedArtifact)
    await page.keyboard.press('Escape')
    checks.push({
      name: 'Escape returns Classrooms to the active list outside edit mode',
      passed: await classrooms.getByText('Active classrooms').isVisible()
        && await classrooms.getByText('Editing').count() === 0
        && await classrooms.getByRole('button', { name: 'Archive Grade 10 Science' }).count() === 0,
    })
    await page.setViewportSize(VIEWPORTS.mobile)
    await classrooms.getByRole('button', { name: 'Classroom actions' }).click()
    checks.push({
      name: 'Mobile Classroom menu stays contained without page overflow',
      passed: await classrooms.getByRole('menu', { name: 'Classroom actions' }).isVisible()
        && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    const classroomMobileMenuArtifact = path.join(artifactDir, 'mobile-light-classrooms-menu.png')
    await section.screenshot({ path: classroomMobileMenuArtifact })
    artifacts.push(classroomMobileMenuArtifact)
    await page.keyboard.press('Escape')
    await page.setViewportSize(VIEWPORTS.desktop)
    await section.getByRole('tab', { name: 'Calendar' }).click()
    const calendar = section.getByRole('tabpanel', { name: 'Calendar' })
    await calendar.getByRole('button', { name: 'More actions' }).click()
    const termView = calendar.getByRole('menuitemradio', { name: 'Term' })
    checks.push({
      name: 'Calendar More actions offers Week, Month, and Term without All or Year',
      passed: await termView.isVisible()
        && await calendar.getByRole('menuitemradio', { name: 'Week' }).isVisible()
        && await calendar.getByRole('menuitemradio', { name: 'Month' }).isVisible()
        && await calendar.getByRole('menuitemradio', { name: 'All' }).count() === 0
        && await calendar.getByRole('menuitemradio', { name: 'Year' }).count() === 0,
    })
    await termView.click()
    checks.push({
      name: 'Calendar Term renders the full Semester 1 fixture through January',
      passed: await calendar.getByText('Semester 1', { exact: true }).isVisible()
        && await calendar.getByText('January', { exact: true }).isVisible()
        && await calendar.getByText('Semester ecosystem reflection.').isVisible(),
    })
    await calendar.getByRole('button', { name: 'More actions' }).click()
    const calendarMenuArtifact = path.join(artifactDir, 'desktop-light-calendar-view-menu.png')
    await section.screenshot({ path: calendarMenuArtifact })
    artifacts.push(calendarMenuArtifact)
    await page.keyboard.press('Escape')
    await section.getByRole('tab', { name: 'Gradebook' }).click()
    await section.getByRole('combobox', { name: 'Example state' }).selectOption('error')
    await section.getByRole('button', { name: 'Try loading gradebook again' }).click()
    checks.push({ name: 'Retry restores populated Gradebook fixture', passed: await section.getByRole('table').isVisible() })
    await section.getByRole('checkbox', { name: 'Select Maya Chen' }).click()
    await section.getByRole('button', { name: 'Selected students (1)' }).click()
    await section.getByRole('menuitem', { name: 'Email 1 selected' }).click()
    checks.push({ name: 'Prototype command gives explicit feedback', passed: await section.getByRole('status').getByText(/Example only/).isVisible() })

    await section.getByRole('tab', { name: 'Settings' }).click()
    const settings = section.getByTestId('settings-mockup')
    await settings.getByRole('button', { name: 'Green' }).click()
    checks.push({
      name: 'Settings classroom-color selection updates semantic and visible state',
      passed: await settings.getByRole('button', { name: 'Green Selected' }).getAttribute('aria-pressed') === 'true'
        && await settings.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed') === 'false',
    })
    const settingsColorArtifact = path.join(artifactDir, 'desktop-light-settings-color.png')
    await settings.screenshot({ path: settingsColorArtifact })
    artifacts.push(settingsColorArtifact)
    await settings.getByRole('button', { name: 'Access' }).click()
    await settings.getByRole('button', { name: 'Generate new join code and link' }).click()
    const regenerateDialog = page.getByRole('dialog', { name: 'Generate new join code and link?' })
    checks.push({ name: 'Settings protects join-code regeneration with confirmation', passed: await regenerateDialog.isVisible() })
    const settingsDialogArtifact = path.join(artifactDir, 'desktop-light-settings-confirmation.png')
    await page.screenshot({ path: settingsDialogArtifact })
    artifacts.push(settingsDialogArtifact)
    await regenerateDialog.getByRole('button', { name: 'Cancel' }).click()

    await section.getByRole('tab', { name: 'Workspaces' }).click()
    const workspace = section.getByTestId('work-surface-mockup')
    await workspace.getByRole('button', { name: /^Field observations/ }).click()
    await workspace.getByRole('tab', { name: 'Students' }).click()
    await workspace.getByRole('button', { name: 'Maya Chen' }).click()
    checks.push({ name: 'Selected student activates the work inspector', passed: await workspace.getByText('Student work', { exact: true }).isVisible() })
    checks.push({ name: 'Workspace exposes a keyboard-resizable divider', passed: await workspace.getByRole('separator', { name: 'Resize student list and work preview' }).isVisible() })
    const workspaceInspectorArtifact = path.join(artifactDir, 'desktop-light-workspace-inspector.png')
    await workspace.screenshot({ path: workspaceInspectorArtifact })
    artifacts.push(workspaceInspectorArtifact)
    await workspace.getByRole('button', { name: 'Back to item list' }).click()
    await workspace.getByRole('button', { name: 'More actions' }).click()
    checks.push({ name: 'Work summary More actions includes Markdown editing', passed: await workspace.getByRole('menuitem', { name: 'Edit all classwork in Markdown' }).isVisible() })
    await page.keyboard.press('Escape')

    await page.setViewportSize(VIEWPORTS.mobile)
    await workspace.getByRole('button', { name: /^Field observations/ }).click()
    await workspace.getByRole('tab', { name: 'Students' }).click()
    await workspace.getByRole('button', { name: 'Maya Chen' }).click()
    checks.push({ name: 'Mobile workspace inspector has no page overflow', passed: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth) })
    const mobileWorkspaceArtifact = path.join(artifactDir, 'mobile-light-workspace-inspector.png')
    await workspace.screenshot({ path: mobileWorkspaceArtifact })
    artifacts.push(mobileWorkspaceArtifact)

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
