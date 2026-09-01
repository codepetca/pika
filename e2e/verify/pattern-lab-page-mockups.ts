import fs from 'fs'
import path from 'path'
import type { VerificationCheck, VerificationResult, VerificationScript } from './types'

const TEACHER_PAGES = ['Daily', 'Classrooms', 'Gradebook', 'Calendar', 'Announcements', 'Roster', 'Settings', 'Workspaces'] as const
const STUDENT_PAGES = ['Today', 'Classwork', 'Tests', 'Calendar', 'Announcements', 'Resources'] as const
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
    await navigator.evaluate((element) => { element.style.position = 'static' })

    for (const theme of ['light', 'dark'] as const) {
      const wantedButton = theme === 'dark' ? 'Use dark theme' : 'Use light theme'
      const themeButton = page.getByRole('button', { name: wantedButton })
      if (await themeButton.isVisible().catch(() => false)) await themeButton.click()

      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport)
        for (const pageName of TEACHER_PAGES) {
          await section.getByRole('tab', { name: pageName }).click()
          const workspace = pageName === 'Workspaces' ? section.getByTestId('work-surface-mockup') : null
          if (workspace) await workspace.getByRole('button', { name: 'Classwork', exact: true }).click()
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
          if (pageName === 'Daily') {
            const daily = section.getByTestId('daily-mockup')
            await daily.getByRole('button', { name: 'Edit attendance time, attendance open, 9:00 - 10:00 AM' }).click()
            const timeDialog = page.getByRole('dialog', { name: 'Attendance time' })
            checks.push({
              name: `${viewportName} ${theme} Daily timing defaults stay visible and contained`,
              passed: await timeDialog.getByRole('button', { name: 'Advanced' }).count() === 0
                && await timeDialog.getByLabel('QR opens before start (min)').inputValue() === '10'
                && await timeDialog.getByLabel('QR opens before start (min)').getAttribute('max') === '120'
                && await timeDialog.getByLabel('Grace period before late (min)').inputValue() === '5'
                && await timeDialog.getByLabel('Grace period before late (min)').getAttribute('max') === '60'
                && await timeDialog.getByLabel('QR closes before end (min)').inputValue() === '0'
                && await timeDialog.getByLabel('QR closes before end (min)').getAttribute('max') === '60'
                && await timeDialog.getByLabel('Absent before end (min)').inputValue() === '0'
                && await timeDialog.getByLabel('Absent before end (min)').getAttribute('max') === '60'
                && await timeDialog.getByRole('button', { name: 'Same class day' }).getAttribute('aria-pressed') === 'true'
                && await timeDialog.getByRole('checkbox', { name: 'Open and close QR attendance automatically' }).isChecked()
                && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
            })
            const timingArtifact = path.join(artifactDir, `${viewportName}-${theme}-daily-time-rules.png`)
            await page.screenshot({ path: timingArtifact })
            artifacts.push(timingArtifact)
            await page.keyboard.press('Escape')
          }
          if (pageName === 'Daily' && theme === 'dark') {
            const daily = section.getByTestId('daily-mockup')
            await daily.getByRole('button', { name: 'More actions' }).click()
            const darkMenuArtifact = path.join(artifactDir, `${viewportName}-dark-daily-more.png`)
            await daily.screenshot({ path: darkMenuArtifact })
            artifacts.push(darkMenuArtifact)
            await daily.getByRole('menuitem', { name: /Edit attendance/ }).click()
            const darkDialogArtifact = path.join(artifactDir, `${viewportName}-dark-daily-batch-dialog.png`)
            await page.screenshot({ path: darkDialogArtifact })
            artifacts.push(darkDialogArtifact)
            await page.keyboard.press('Escape')
          }
          if (pageName === 'Daily') {
            await section.getByRole('combobox', { name: 'Attendance mode' }).selectOption('manual')
            const manualDaily = section.getByTestId('daily-mockup')
            const manualTime = manualDaily.getByRole('button', { name: 'Edit attendance time, manual attendance, 9:00 - 10:00 AM' })
            const manualPresentCell = manualDaily.getByRole('button', { name: 'Mark Maya Chen present' }).locator('xpath=ancestor::td')
            checks.push({
              name: `${viewportName} ${theme} Manual Daily removes QR evidence and keeps time passive`,
              passed: await manualDaily.getByRole('button', { name: 'Show QR' }).count() === 0
                && await manualDaily.getByRole('columnheader', { name: 'Time of scan' }).count() === 0
                && (await manualTime.getAttribute('class'))?.includes('bg-surface') === true
                && (await manualTime.getAttribute('class'))?.includes('bg-success-bg') === false
                && (await manualPresentCell.getAttribute('class'))?.includes('sticky') === true
                && await manualDaily.getByRole('button', { name: 'Undo manual change for Noah Williams' }).isVisible(),
            })
            const manualArtifact = path.join(artifactDir, `${viewportName}-${theme}-daily-manual.png`)
            await section.screenshot({ path: manualArtifact })
            artifacts.push(manualArtifact)
            await manualTime.click()
            const manualTimeDialog = page.getByRole('dialog', { name: 'Attendance time' })
            checks.push({
              name: `${viewportName} ${theme} Manual Daily keeps the time editor simple`,
              passed: await manualTimeDialog.getByRole('button', { name: 'Advanced' }).count() === 0
                && await manualTimeDialog.getByText('Timing rules').count() === 0
                && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
            })
            const manualTimeArtifact = path.join(artifactDir, `${viewportName}-${theme}-daily-manual-time.png`)
            await page.screenshot({ path: manualTimeArtifact })
            artifacts.push(manualTimeArtifact)
            await page.keyboard.press('Escape')
            await section.getByRole('combobox', { name: 'Attendance mode' }).selectOption('qr')
          }
          if (workspace) {
            await workspace.getByRole('button', { name: 'More actions' }).click()
            const classworkMoreArtifact = path.join(artifactDir, `${viewportName}-${theme}-workspaces-classwork-more.png`)
            await section.screenshot({ path: classworkMoreArtifact })
            artifacts.push(classworkMoreArtifact)
            await page.keyboard.press('Escape')

            await workspace.getByRole('button', { name: 'Tests' }).click()
            const testsArtifact = path.join(artifactDir, `${viewportName}-${theme}-workspaces-tests.png`)
            await section.screenshot({ path: testsArtifact })
            artifacts.push(testsArtifact)
            await workspace.getByRole('button', { name: 'More actions' }).click()
            const testsMoreArtifact = path.join(artifactDir, `${viewportName}-${theme}-workspaces-tests-more.png`)
            await section.screenshot({ path: testsMoreArtifact })
            artifacts.push(testsMoreArtifact)
            await page.keyboard.press('Escape')
          }
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
    await jumpSelect.selectOption('mockup-daily-panel')
    await page.waitForTimeout(100)
    checks.push({
      name: 'Navigator opens the Daily mockup directly',
      passed: await section.getByRole('tab', { name: 'Daily' }).getAttribute('aria-selected') === 'true'
        && await section.getByRole('tabpanel', { name: 'Daily' }).isVisible()
        && await page.evaluate(() => window.location.hash === '#mockup-daily-panel'),
    })
    const daily = section.getByTestId('daily-mockup')
    const dateControlHeight = await daily.getByRole('button', { name: 'Return to reference Daily date' }).evaluate((element) => (
      element.parentElement?.getBoundingClientRect().height ?? 0
    ))
    const attendanceControlHeight = await daily.getByRole('group', { name: 'Attendance time and QR check-in' }).evaluate((element) => (
      element.getBoundingClientRect().height
    ))
    checks.push({
      name: 'Daily joins attendance time and QR beside the date without row selection',
      passed: await daily.getByRole('group', { name: 'Attendance time and QR check-in' }).isVisible()
        && await daily.getByRole('button', { name: 'Show QR' }).isVisible()
        && Math.abs(dateControlHeight - attendanceControlHeight) <= 1
        && await daily.getByRole('checkbox').count() === 0
        && await daily.getByRole('button', { name: /Student actions/ }).count() === 0,
    })
    checks.push({
      name: 'Daily shows undo only for rows with manual attendance changes',
      passed: await daily.getByRole('button', { name: 'Undo manual change for Noah Williams' }).isVisible()
        && await daily.getByRole('button', { name: 'Undo manual change for Maya Chen' }).count() === 0,
    })
    const presentSort = daily.getByRole('button', { name: 'Sort Present first, 2 students' })
    await presentSort.hover()
    const presentTooltip = page.getByRole('tooltip').getByText('2 Present', { exact: true })
    await presentTooltip.waitFor()
    checks.push({
      name: 'Daily attendance count tooltip uses the compact status label',
      passed: await presentTooltip.isVisible(),
    })
    await page.mouse.move(0, 0)
    await presentSort.click()
    checks.push({
      name: 'Daily active attendance sort shows a chevron without widening its column',
      passed: await presentSort.getAttribute('aria-pressed') === 'true'
        && await presentSort.locator('svg').evaluate((element) => getComputedStyle(element).opacity === '1')
        && await presentSort.locator('xpath=ancestor::th').evaluate((element) => element.getBoundingClientRect().width <= 45),
    })
    const dailyStatusSortArtifact = path.join(artifactDir, 'desktop-light-daily-status-sort.png')
    await daily.screenshot({ path: dailyStatusSortArtifact })
    artifacts.push(dailyStatusSortArtifact)
    const noahUndo = daily.getByRole('button', { name: 'Undo manual change for Noah Williams' })
    await noahUndo.hover()
    const undoTooltip = page.getByRole('tooltip').getByText('Undo manual change', { exact: true })
    await undoTooltip.waitFor()
    checks.push({
      name: 'Daily row revert tooltip stays concise',
      passed: await undoTooltip.isVisible(),
    })
    const dailyUndoTooltipArtifact = path.join(artifactDir, 'desktop-light-daily-undo-tooltip.png')
    await daily.screenshot({ path: dailyUndoTooltipArtifact })
    artifacts.push(dailyUndoTooltipArtifact)
    await page.mouse.move(0, 0)
    await daily.getByRole('button', { name: 'Show QR' }).hover()
    const qrTooltip = page.getByRole('tooltip').getByText('Show QR', { exact: true })
    await qrTooltip.waitFor()
    checks.push({
      name: 'Daily QR icon explains its action on hover',
      passed: await qrTooltip.isVisible(),
    })
    const dailyQrTooltipArtifact = path.join(artifactDir, 'desktop-light-daily-qr-tooltip.png')
    await daily.screenshot({ path: dailyQrTooltipArtifact })
    artifacts.push(dailyQrTooltipArtifact)
    await page.mouse.move(0, 0)
    await daily.getByRole('button', { name: 'Edit attendance time, attendance open, 9:00 - 10:00 AM' }).click()
    const timeDialog = page.getByRole('dialog', { name: 'Attendance time' })
    checks.push({
      name: 'Daily time control opens the local attendance-time editor',
      passed: await timeDialog.getByLabel('Starts').inputValue() === '09:00'
        && await timeDialog.getByLabel('Ends').inputValue() === '10:00',
    })
    const dailyTimeDialogArtifact = path.join(artifactDir, 'desktop-light-daily-time-dialog.png')
    await page.screenshot({ path: dailyTimeDialogArtifact })
    artifacts.push(dailyTimeDialogArtifact)
    checks.push({
      name: 'Daily time editor exposes automatic timing rules and end-day toggle',
      passed: await timeDialog.getByText('Timing rules').isVisible()
        && await timeDialog.getByText(/A scan at the Present cutoff/).count() === 0
        && await timeDialog.getByRole('button', { name: 'Same class day' }).getAttribute('aria-pressed') === 'true'
        && await timeDialog.getByRole('button', { name: 'Next day' }).getAttribute('aria-pressed') === 'false'
        && await timeDialog.getByRole('checkbox', { name: 'Open and close QR attendance automatically' }).isChecked(),
    })
    const dailyTimingRulesArtifact = path.join(artifactDir, 'desktop-light-daily-time-rules.png')
    await page.screenshot({ path: dailyTimingRulesArtifact })
    artifacts.push(dailyTimingRulesArtifact)
    await timeDialog.getByRole('button', { name: 'Same class day' }).hover()
    const sameDayTooltip = page.getByRole('tooltip').getByText('Class end on the same day', { exact: true })
    await sameDayTooltip.waitFor()
    checks.push({
      name: 'Daily same-day option explains its boundary',
      passed: await sameDayTooltip.isVisible(),
    })
    const sameDayTooltipArtifact = path.join(artifactDir, 'desktop-light-daily-same-day-tooltip.png')
    await page.screenshot({ path: sameDayTooltipArtifact })
    artifacts.push(sameDayTooltipArtifact)
    await page.mouse.move(0, 0)
    await timeDialog.getByRole('button', { name: 'Next day' }).hover()
    const nextDayTooltip = page.getByRole('tooltip').getByText('Class ends the next day after midnight', { exact: true })
    await nextDayTooltip.waitFor()
    checks.push({
      name: 'Daily next-day option explains its midnight boundary',
      passed: await nextDayTooltip.isVisible(),
    })
    const nextDayTooltipArtifact = path.join(artifactDir, 'desktop-light-daily-next-day-tooltip.png')
    await page.screenshot({ path: nextDayTooltipArtifact })
    artifacts.push(nextDayTooltipArtifact)
    await page.mouse.move(0, 0)
    await timeDialog.getByLabel('QR opens before start (min)').fill('999')
    await timeDialog.getByLabel('Grace period before late (min)').fill('999')
    await timeDialog.getByLabel('QR closes before end (min)').fill('999')
    await timeDialog.getByLabel('Absent before end (min)').fill('-5')
    checks.push({
      name: 'Daily timing rules hard-clamp typed values',
      passed: await timeDialog.getByLabel('QR opens before start (min)').inputValue() === '120'
        && await timeDialog.getByLabel('Grace period before late (min)').inputValue() === '60'
        && await timeDialog.getByLabel('QR closes before end (min)').inputValue() === '60'
        && await timeDialog.getByLabel('Absent before end (min)').inputValue() === '0',
    })
    await timeDialog.getByRole('button', { name: 'Next day' }).click()
    await timeDialog.getByRole('checkbox', { name: 'Open and close QR attendance automatically' }).click()
    checks.push({
      name: 'Daily end-day and automatic-hours controls are interactive',
      passed: await timeDialog.getByRole('button', { name: 'Next day' }).getAttribute('aria-pressed') === 'true'
        && !await timeDialog.getByRole('checkbox', { name: 'Open and close QR attendance automatically' }).isChecked(),
    })
    await timeDialog.getByRole('button', { name: 'Clear time' }).click()
    checks.push({
      name: 'Daily no-time state keeps only the clock action',
      passed: await daily.getByRole('button', { name: 'Set attendance time, attendance open' }).isVisible()
        && await daily.getByText('9:00 - 10:00 AM').count() === 0,
    })
    const dailyNoTimeArtifact = path.join(artifactDir, 'desktop-light-daily-no-time.png')
    await daily.screenshot({ path: dailyNoTimeArtifact })
    artifacts.push(dailyNoTimeArtifact)
    await daily.getByRole('button', { name: 'Set attendance time, attendance open' }).click()
    await page.getByRole('dialog', { name: 'Attendance time' }).getByRole('button', { name: 'Save time' }).click()
    await daily.getByRole('button', { name: 'More actions' }).click()
    checks.push({
      name: 'Daily More actions owns session and class-wide attendance commands',
      passed: await daily.getByRole('menuitemcheckbox', { name: /Close attendance/ }).isVisible()
        && await daily.getByRole('menuitem', { name: 'Edit time' }).isVisible()
        && await daily.getByRole('menuitem', { name: /Edit attendance/ }).isVisible(),
    })
    const dailyMenuArtifact = path.join(artifactDir, 'desktop-light-daily-more.png')
    await daily.screenshot({ path: dailyMenuArtifact })
    artifacts.push(dailyMenuArtifact)
    await daily.getByRole('menuitem', { name: 'Edit time' }).click()
    checks.push({
      name: 'Daily More actions opens the same attendance-time editor',
      passed: await page.getByRole('dialog', { name: 'Attendance time' }).isVisible(),
    })
    await page.keyboard.press('Escape')
    await daily.getByRole('button', { name: 'More actions' }).click()
    await daily.getByRole('menuitemcheckbox', { name: /Close attendance/ }).click()
    checks.push({
      name: 'Closing attendance disables QR and updates the time state',
      passed: await daily.getByRole('button', { name: 'Show QR' }).isDisabled()
        && await daily.getByRole('button', { name: 'Edit attendance time, attendance closed, 9:00 - 10:00 AM' }).isVisible(),
    })
    const dailyClosedArtifact = path.join(artifactDir, 'desktop-light-daily-closed.png')
    await daily.screenshot({ path: dailyClosedArtifact })
    artifacts.push(dailyClosedArtifact)
    await daily.getByRole('button', { name: 'More actions' }).click()
    await daily.getByRole('menuitem', { name: /Edit attendance/ }).click()
    const attendanceDialog = page.getByRole('dialog', { name: 'Edit attendance' })
    checks.push({
      name: 'Daily batch dialog exposes mark, revert, and QR reset commands',
      passed: await attendanceDialog.getByRole('button', { name: 'Mark all present' }).isVisible()
        && await attendanceDialog.getByRole('button', { name: 'Mark all late' }).isVisible()
        && await attendanceDialog.getByRole('button', { name: 'Mark all absent' }).isVisible()
        && await attendanceDialog.getByRole('button', { name: 'Revert manual changes' }).isVisible()
        && await attendanceDialog.getByRole('button', { name: 'Clear QR check-ins' }).isVisible(),
    })
    const dailyDialogArtifact = path.join(artifactDir, 'desktop-light-daily-batch-dialog.png')
    await page.screenshot({ path: dailyDialogArtifact })
    artifacts.push(dailyDialogArtifact)
    await attendanceDialog.getByRole('button', { name: 'Mark all present' }).click()
    checks.push({
      name: 'Daily batch marking reveals per-row undo controls',
      passed: await daily.getByRole('button', { name: 'Mark Sana Patel present' }).getAttribute('aria-pressed') === 'true'
        && await daily.getByRole('button', { name: 'Undo manual change for Maya Chen' }).isVisible(),
    })
    const dailyManualArtifact = path.join(artifactDir, 'desktop-light-daily-manual-undo.png')
    await daily.screenshot({ path: dailyManualArtifact })
    artifacts.push(dailyManualArtifact)
    await page.setViewportSize(VIEWPORTS.mobile)
    await daily.getByRole('button', { name: 'More actions' }).click()
    const dailyMobileMenuArtifact = path.join(artifactDir, 'mobile-light-daily-more.png')
    await daily.screenshot({ path: dailyMobileMenuArtifact })
    artifacts.push(dailyMobileMenuArtifact)
    checks.push({
      name: 'Mobile Daily menu stays contained without page overflow',
      passed: await daily.getByRole('menu', { name: 'Daily more actions' }).isVisible()
        && await daily.getByRole('button', { name: 'More actions' }).evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.left >= 0 && bounds.right <= window.innerWidth
        })
        && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    await daily.getByRole('menuitem', { name: /Edit attendance/ }).click()
    const dailyMobileDialogArtifact = path.join(artifactDir, 'mobile-light-daily-batch-dialog.png')
    await page.screenshot({ path: dailyMobileDialogArtifact })
    artifacts.push(dailyMobileDialogArtifact)
    checks.push({
      name: 'Mobile Daily batch dialog stays contained without page overflow',
      passed: await page.getByRole('dialog', { name: 'Edit attendance' }).isVisible()
        && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    await page.keyboard.press('Escape')
    await page.setViewportSize(VIEWPORTS.desktop)
    await section.getByRole('combobox', { name: 'Attendance mode' }).selectOption('manual')
    const manualDaily = section.getByTestId('daily-mockup')
    await manualDaily.getByRole('button', { name: 'More actions' }).click()
    checks.push({
      name: 'Manual Daily More actions keeps time and marking but removes QR session commands',
      passed: await manualDaily.getByRole('menuitem', { name: 'Edit time' }).isVisible()
        && await manualDaily.getByRole('menuitem', { name: /Edit attendance/ }).isVisible()
        && await manualDaily.getByRole('menuitemcheckbox', { name: /Attendance from log/ }).getAttribute('aria-checked') === 'false'
        && await manualDaily.getByText('Manual marking').count() === 0,
    })
    const manualModeMenuArtifact = path.join(artifactDir, 'desktop-light-daily-manual-more.png')
    await manualDaily.screenshot({ path: manualModeMenuArtifact })
    artifacts.push(manualModeMenuArtifact)
    await manualDaily.getByRole('menuitemcheckbox', { name: /Attendance from log/ }).click()
    checks.push({
      name: 'Attendance from log supplies the completed-log baseline when checked',
      passed: await manualDaily.getByRole('button', { name: 'Undo manual change for Noah Williams' }).isVisible()
        && await manualDaily.getByRole('button', { name: 'Undo manual change for Sana Patel' }).isVisible(),
    })
    await manualDaily.getByRole('button', { name: 'More actions' }).click()
    await manualDaily.getByRole('menuitemcheckbox', { name: /Attendance from log/ }).click()
    checks.push({
      name: 'Unchecked Attendance from log restores the manual baseline',
      passed: await manualDaily.getByRole('button', { name: 'Undo manual change for Maya Chen' }).isVisible(),
    })
    await manualDaily.getByRole('button', { name: 'More actions' }).click()
    await manualDaily.getByRole('menuitem', { name: /Edit attendance/ }).click()
    checks.push({
      name: 'Manual Daily attendance editor omits QR reset',
      passed: await page.getByRole('dialog', { name: 'Edit attendance' }).getByRole('button', { name: 'Clear QR check-ins' }).count() === 0,
    })
    await page.keyboard.press('Escape')
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
      name: 'Classroom bottom menu contains New Classroom, edit, and Show Archived actions',
      passed: await classrooms.getByRole('menuitem', { name: 'New Classroom' }).isVisible()
        && await classrooms.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).isVisible()
        && await classrooms.getByRole('menuitem', { name: 'Show Archived' }).isVisible(),
    })
    const classroomMenuArtifact = path.join(artifactDir, 'desktop-light-classrooms-menu.png')
    await section.screenshot({ path: classroomMenuArtifact })
    artifacts.push(classroomMenuArtifact)
    await classrooms.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).click()
    const classroomEditArtifact = path.join(artifactDir, 'desktop-light-classrooms-edit.png')
    await section.screenshot({ path: classroomEditArtifact })
    artifacts.push(classroomEditArtifact)
    await classrooms.getByRole('button', { name: 'Classroom actions' }).click()
    await classrooms.getByRole('menuitem', { name: 'Show Archived' }).click()
    checks.push({
      name: 'Archived Classroom scope leaves edit mode',
      passed: await classrooms.getByText('Archived classrooms').isVisible()
        && await classrooms.getByText('Editing').count() === 0
        && await classrooms.getByRole('button', { name: 'Back to classrooms' }).isVisible(),
    })
    const classroomArchivedArtifact = path.join(artifactDir, 'desktop-light-classrooms-archived.png')
    await section.screenshot({ path: classroomArchivedArtifact })
    artifacts.push(classroomArchivedArtifact)
    await classrooms.getByRole('button', { name: 'Classroom actions' }).click()
    checks.push({
      name: 'Archived Classroom menu offers Show Active toggle',
      passed: await classrooms.getByRole('menuitem', { name: 'Show Active' }).isVisible(),
    })
    await page.keyboard.press('Escape')
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
    checks.push({
      name: 'Gradebook keeps context quiet and removes row previews',
      passed: await section.getByText('Semester 1 · 4 students').count() === 0
        && await section.getByRole('columnheader', { name: 'Preview' }).count() === 0,
    })
    checks.push({
      name: 'Student Actions is the persistent disabled selection owner',
      passed: await section.getByRole('button', { name: 'Student Actions' }).isDisabled(),
    })
    const populatedAssessmentBounds = await section.getByRole('columnheader', { name: 'Ecosystems' }).boundingBox()
    checks.push({
      name: 'Populated Gradebook uses compact assessment columns',
      passed: (populatedAssessmentBounds?.width ?? 0) >= 84
        && (populatedAssessmentBounds?.width ?? 0) <= 92
        && await section.getByRole('columnheader', { name: 'Space' }).isVisible(),
    })
    const gradebookScrollFrame = section.getByTestId('gradebook-scroll-frame')
    const gradebookSummaryFooter = section.getByTestId('gradebook-summary-footer')
    await gradebookScrollFrame.evaluate((frame) => { frame.scrollTop = 120 })
    const [summaryFrameBounds, summaryFooterBounds, summaryFooterPosition] = await Promise.all([
      gradebookScrollFrame.boundingBox(),
      gradebookSummaryFooter.boundingBox(),
      gradebookSummaryFooter.evaluate((footer) => getComputedStyle(footer).position),
    ])
    const classAverageRow = gradebookSummaryFooter.getByRole('row', { name: 'Class average' })
    checks.push({
      name: 'Gradebook class summary stays pinned to the visible table bottom',
      passed: await gradebookScrollFrame.evaluate((frame) => frame.scrollTop > 0)
        && summaryFooterPosition === 'sticky'
        && ((summaryFrameBounds?.y ?? 0) + (summaryFrameBounds?.height ?? 0))
          - ((summaryFooterBounds?.y ?? 0) + (summaryFooterBounds?.height ?? 0)) >= 0
        && ((summaryFrameBounds?.y ?? 0) + (summaryFrameBounds?.height ?? 0))
          - ((summaryFooterBounds?.y ?? 0) + (summaryFooterBounds?.height ?? 0)) <= 28
        && await classAverageRow.isVisible()
        && await gradebookSummaryFooter.getByRole('row', { name: 'Class median' }).count() === 0,
    })
    checks.push({
      name: 'Gradebook class summary includes every displayed student',
      passed: await classAverageRow.getByRole('cell').nth(3).textContent() === '85%',
    })
    const stickySummaryDesktopLightArtifact = path.join(artifactDir, 'desktop-light-gradebook-sticky-summary.png')
    await section.screenshot({ path: stickySummaryDesktopLightArtifact })
    artifacts.push(stickySummaryDesktopLightArtifact)
    await section.getByRole('button', { name: 'More actions' }).click()
    const scoreModeToggle = section.getByRole('menuitem', { name: 'Show raw scores' })
    const summaryKindToggle = section.getByRole('menuitem', { name: 'Show median' })
    const nameOrderToggle = section.getByRole('menuitem', { name: 'Show last name first' })
    const studentIds = section.getByRole('menuitemcheckbox', { name: 'Show student IDs' })
    const keepKeyColumnsVisible = section.getByRole('menuitemcheckbox', { name: 'Keep key columns visible' })
    checks.push({
      name: 'Gradebook More actions owns one score display toggle',
      passed: await scoreModeToggle.isVisible()
        && await summaryKindToggle.isVisible()
        && await nameOrderToggle.isVisible()
        && await section.getByRole('menuitemradio').count() === 0
        && await studentIds.getAttribute('aria-checked') === 'false'
        && await keepKeyColumnsVisible.getAttribute('aria-checked') === 'true',
    })
    const gradebookMenuArtifact = path.join(artifactDir, 'desktop-light-gradebook-more-actions.png')
    await section.screenshot({ path: gradebookMenuArtifact })
    artifacts.push(gradebookMenuArtifact)
    await summaryKindToggle.click()
    checks.push({
      name: 'Gradebook shows only the selected Average or Median summary',
      passed: await gradebookSummaryFooter.getByRole('row', { name: 'Class median' }).isVisible()
        && await gradebookSummaryFooter.getByRole('row', { name: 'Class average' }).count() === 0,
    })
    await section.getByRole('button', { name: 'More actions' }).click()
    const showAverage = section.getByRole('menuitem', { name: 'Show average' })
    checks.push({ name: 'Gradebook summary command reverses to Show average', passed: await showAverage.isVisible() })
    await showAverage.click()
    await section.getByRole('button', { name: 'More actions' }).click()
    await nameOrderToggle.click()
    checks.push({
      name: 'Gradebook can put Last name before First name',
      passed: await section.getByRole('columnheader', { name: 'Last' }).evaluate((cell) => (cell as HTMLTableCellElement).cellIndex === 1)
        && await section.getByRole('columnheader', { name: 'First' }).evaluate((cell) => (cell as HTMLTableCellElement).cellIndex === 2),
    })
    await section.getByRole('button', { name: 'More actions' }).click()
    checks.push({
      name: 'Gradebook name-order command reverses to Show first name first',
      passed: await section.getByRole('menuitem', { name: 'Show first name first' }).isVisible(),
    })
    await page.keyboard.press('Escape')
    const gradebookTable = section.getByRole('table')
    await gradebookScrollFrame.evaluate((frame) => { frame.scrollLeft = 96 })
    const [frozenFrameBounds, frozenSelectionBounds, frozenLastBounds, frozenFinalBounds] = await Promise.all([
      gradebookScrollFrame.boundingBox(),
      section.getByRole('checkbox', { name: 'Select all gradebook students' }).locator('..').boundingBox(),
      section.getByRole('columnheader', { name: 'Last' }).boundingBox(),
      section.getByRole('columnheader', { name: 'Final' }).boundingBox(),
    ])
    checks.push({
      name: 'Frozen Gradebook columns anchor the leading name field during horizontal scroll',
      passed: await gradebookScrollFrame.evaluate((frame) => frame.scrollLeft > 0)
        && Math.abs((frozenSelectionBounds?.x ?? 0) - (frozenFrameBounds?.x ?? 0)) <= 2
        && Math.abs((frozenLastBounds?.x ?? 0) - ((frozenFrameBounds?.x ?? 0) + (frozenSelectionBounds?.width ?? 0))) <= 2
        && Math.abs(
          ((frozenFinalBounds?.x ?? 0) + (frozenFinalBounds?.width ?? 0))
          - ((frozenFrameBounds?.x ?? 0) + (frozenFrameBounds?.width ?? 0)),
        ) <= 2,
    })
    const frozenColumnsDesktopLightArtifact = path.join(artifactDir, 'desktop-light-gradebook-frozen-columns.png')
    await section.screenshot({ path: frozenColumnsDesktopLightArtifact })
    artifacts.push(frozenColumnsDesktopLightArtifact)
    await page.setViewportSize(VIEWPORTS.mobile)
    await gradebookScrollFrame.evaluate((frame) => { frame.scrollLeft = 448 })
    checks.push({
      name: 'Frozen Gradebook columns remain contained on mobile',
      passed: await gradebookScrollFrame.evaluate((frame) => frame.scrollLeft > 0)
        && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    const frozenColumnsMobileLightArtifact = path.join(artifactDir, 'mobile-light-gradebook-frozen-columns.png')
    await section.screenshot({ path: frozenColumnsMobileLightArtifact })
    artifacts.push(frozenColumnsMobileLightArtifact)
    await page.getByRole('button', { name: 'Use dark theme' }).click()
    const frozenColumnsMobileDarkArtifact = path.join(artifactDir, 'mobile-dark-gradebook-frozen-columns.png')
    await section.screenshot({ path: frozenColumnsMobileDarkArtifact })
    artifacts.push(frozenColumnsMobileDarkArtifact)
    await page.setViewportSize(VIEWPORTS.desktop)
    await gradebookScrollFrame.evaluate((frame) => { frame.scrollLeft = 96 })
    const frozenColumnsDesktopDarkArtifact = path.join(artifactDir, 'desktop-dark-gradebook-frozen-columns.png')
    await section.screenshot({ path: frozenColumnsDesktopDarkArtifact })
    artifacts.push(frozenColumnsDesktopDarkArtifact)
    await page.getByRole('button', { name: 'Use light theme' }).click()
    await gradebookScrollFrame.evaluate((frame) => { frame.scrollLeft = 0 })
    await section.getByRole('button', { name: 'More actions' }).click()
    checks.push({
      name: 'Gradebook exposes frozen-column checked state',
      passed: await keepKeyColumnsVisible.getAttribute('aria-checked') === 'true',
    })
    await keepKeyColumnsVisible.click()
    await section.getByRole('button', { name: 'More actions' }).click()
    await studentIds.click()
    checks.push({
      name: 'Gradebook More actions toggles the Student ID column',
      passed: await section.getByRole('columnheader', { name: 'ID' }).isVisible()
        && await section.getByRole('cell', { name: '1004832' }).isVisible(),
    })
    await section.getByRole('button', { name: 'More actions' }).click()
    await scoreModeToggle.click()
    await section.getByRole('button', { name: 'More actions' }).click()
    checks.push({
      name: 'Raw score mode updates visible assignment columns',
      passed: await section.getByRole('row', { name: /Maya Chen/ }).getByRole('cell', { name: '18/20' }).isVisible()
        && await section.getByRole('row', { name: /Maya Chen/ }).getByRole('cell', { name: '42/50' }).isVisible()
        && await section.getByRole('menuitem', { name: 'Show %' }).isVisible(),
    })
    await page.keyboard.press('Escape')
    await section.getByRole('button', { name: 'More actions' }).click()
    await studentIds.click()
    await section.getByRole('combobox', { name: 'Example state' }).selectOption('empty')
    const emptyGradebookTable = section.getByRole('table')
    const [checkboxBounds, firstBounds, lastBounds, assessmentBounds, finalBounds] = await Promise.all([
      section.getByRole('checkbox', { name: 'Select all gradebook students' }).locator('..').boundingBox(),
      section.getByRole('columnheader', { name: 'First' }).boundingBox(),
      section.getByRole('columnheader', { name: 'Last' }).boundingBox(),
      section.getByRole('columnheader', { name: 'Assessments' }).boundingBox(),
      section.getByRole('columnheader', { name: 'Final' }).boundingBox(),
    ])
    const emptyColumnWidths = {
      checkbox: checkboxBounds?.width ?? 0,
      first: firstBounds?.width ?? 0,
      last: lastBounds?.width ?? 0,
      assessments: assessmentBounds?.width ?? 0,
      final: finalBounds?.width ?? 0,
    }
    checks.push({
      name: 'Empty Gradebook lets Assessments span the remaining table width',
      passed: await section.getByRole('row', { name: /Maya Chen/ }).isVisible()
        && await section.getByRole('columnheader', { name: 'Assessments' }).isVisible()
        && await section.getByRole('columnheader', { name: 'Ecosystems' }).count() === 0
        && emptyColumnWidths.checkbox <= 48
        && Math.abs(emptyColumnWidths.first - emptyColumnWidths.last) < 1
        && emptyColumnWidths.first >= 90
        && emptyColumnWidths.first <= 104
        && emptyColumnWidths.final <= 88
        && emptyColumnWidths.assessments > emptyColumnWidths.first * 4,
    })
    await section.getByRole('separator', { name: 'Resize Last column' }).press('Home')
    const longNameOverflow = await section.getByRole('cell', { name: 'Williams-Montgomery', exact: true }).evaluate((cell) => ({
      clientWidth: cell.clientWidth,
      scrollWidth: cell.scrollWidth,
      overflow: getComputedStyle(cell).overflow,
      textOverflow: getComputedStyle(cell).textOverflow,
      whiteSpace: getComputedStyle(cell).whiteSpace,
    }))
    checks.push({
      name: 'Narrow Gradebook names stay on one line and ellipsize',
      passed: longNameOverflow.scrollWidth > longNameOverflow.clientWidth
        && longNameOverflow.overflow === 'hidden'
        && longNameOverflow.textOverflow === 'ellipsis'
        && longNameOverflow.whiteSpace === 'nowrap',
    })
    const emptyGradebookDesktopLightArtifact = path.join(artifactDir, 'desktop-light-gradebook-empty.png')
    await section.screenshot({ path: emptyGradebookDesktopLightArtifact })
    artifacts.push(emptyGradebookDesktopLightArtifact)
    await page.setViewportSize(VIEWPORTS.mobile)
    checks.push({
      name: 'Empty Gradebook keeps natural columns inside its mobile scroll frame',
      passed: await emptyGradebookTable.isVisible()
        && await emptyGradebookTable.evaluate((table) => table.scrollWidth >= 380)
        && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    const emptyGradebookMobileLightArtifact = path.join(artifactDir, 'mobile-light-gradebook-empty.png')
    await section.screenshot({ path: emptyGradebookMobileLightArtifact })
    artifacts.push(emptyGradebookMobileLightArtifact)
    await page.getByRole('button', { name: 'Use dark theme' }).click()
    const emptyGradebookMobileDarkArtifact = path.join(artifactDir, 'mobile-dark-gradebook-empty.png')
    await section.screenshot({ path: emptyGradebookMobileDarkArtifact })
    artifacts.push(emptyGradebookMobileDarkArtifact)
    await page.setViewportSize(VIEWPORTS.desktop)
    const emptyGradebookDesktopDarkArtifact = path.join(artifactDir, 'desktop-dark-gradebook-empty.png')
    await section.screenshot({ path: emptyGradebookDesktopDarkArtifact })
    artifacts.push(emptyGradebookDesktopDarkArtifact)
    await page.getByRole('button', { name: 'Use light theme' }).click()
    const lastColumnResizeHandle = section.getByRole('separator', { name: 'Resize Last column' })
    await lastColumnResizeHandle.press('ArrowRight')
    await lastColumnResizeHandle.press('ArrowRight')
    await lastColumnResizeHandle.press('ArrowRight')
    await section.getByRole('combobox', { name: 'Example state' }).selectOption('few-assessments')
    const fewAssessmentsTable = section.getByRole('table')
    const fewAssessmentBounds = await Promise.all([
      section.getByRole('columnheader', { name: 'Ecosystems' }).boundingBox(),
      section.getByRole('columnheader', { name: 'Cells' }).boundingBox(),
      section.getByRole('columnheader', { name: 'Genetics' }).boundingBox(),
    ])
    const [fewAssessmentsTableBounds, fewAssessmentSpacerBounds, fewFinalBounds] = await Promise.all([
      fewAssessmentsTable.boundingBox(),
      section.getByRole('columnheader', { name: 'Unused assessment space' }).boundingBox(),
      section.getByRole('columnheader', { name: 'Final' }).boundingBox(),
    ])
    checks.push({
      name: 'Few-assessments Gradebook keeps compact assessments and anchors Final right',
      passed: fewAssessmentBounds.every((bounds) => (bounds?.width ?? 0) >= 84 && (bounds?.width ?? 0) <= 92)
        && (fewAssessmentSpacerBounds?.width ?? 0) > 96
        && Math.abs(
          ((fewFinalBounds?.x ?? 0) + (fewFinalBounds?.width ?? 0))
          - ((fewAssessmentsTableBounds?.x ?? 0) + (fewAssessmentsTableBounds?.width ?? 0)),
        ) <= 2
        && await section.getByRole('columnheader', { name: 'Reactions' }).count() === 0,
    })
    const fewAssessmentsDesktopLightArtifact = path.join(artifactDir, 'desktop-light-gradebook-few-assessments.png')
    await section.screenshot({ path: fewAssessmentsDesktopLightArtifact })
    artifacts.push(fewAssessmentsDesktopLightArtifact)
    await page.setViewportSize(VIEWPORTS.mobile)
    checks.push({
      name: 'Few-assessments Gradebook scrolls internally on mobile',
      passed: await fewAssessmentsTable.evaluate((table) => table.scrollWidth >= 668)
        && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    })
    const fewAssessmentsMobileLightArtifact = path.join(artifactDir, 'mobile-light-gradebook-few-assessments.png')
    await section.screenshot({ path: fewAssessmentsMobileLightArtifact })
    artifacts.push(fewAssessmentsMobileLightArtifact)
    await page.getByRole('button', { name: 'Use dark theme' }).click()
    const fewAssessmentsMobileDarkArtifact = path.join(artifactDir, 'mobile-dark-gradebook-few-assessments.png')
    await section.screenshot({ path: fewAssessmentsMobileDarkArtifact })
    artifacts.push(fewAssessmentsMobileDarkArtifact)
    await page.setViewportSize(VIEWPORTS.desktop)
    const fewAssessmentsDesktopDarkArtifact = path.join(artifactDir, 'desktop-dark-gradebook-few-assessments.png')
    await section.screenshot({ path: fewAssessmentsDesktopDarkArtifact })
    artifacts.push(fewAssessmentsDesktopDarkArtifact)
    await page.getByRole('button', { name: 'Use light theme' }).click()
    await section.getByRole('combobox', { name: 'Example state' }).selectOption('populated')
    await section.getByRole('checkbox', { name: 'Select Maya Chen' }).click()
    await section.getByRole('button', { name: '1 selected' }).click()
    const selectedActionsArtifact = path.join(artifactDir, 'desktop-light-gradebook-student-actions.png')
    await section.screenshot({ path: selectedActionsArtifact })
    artifacts.push(selectedActionsArtifact)
    await section.getByRole('menuitem', { name: 'Email selected students' }).click()
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
    checks.push({ name: 'Classwork summary keeps Organize out of the center cluster', passed: await workspace.getByRole('button', { name: 'Organize classwork' }).count() === 0 })
    await workspace.getByRole('button', { name: 'More actions' }).click()
    checks.push({ name: 'Classwork More actions includes Markdown editing and Organize', passed: await workspace.getByRole('menuitem', { name: 'Edit all classwork in Markdown' }).isVisible() && await workspace.getByRole('menuitem', { name: 'Organize classwork' }).isVisible() })
    await page.keyboard.press('Escape')
    await workspace.getByRole('button', { name: 'Tests' }).click()
    checks.push({ name: 'Tests summary keeps Organize out of the center cluster', passed: await workspace.getByRole('button', { name: 'Organize tests' }).count() === 0 })
    await workspace.getByRole('button', { name: 'More actions' }).click()
    checks.push({ name: 'Tests More actions retains Organize', passed: await workspace.getByRole('menuitem', { name: 'Organize tests' }).isVisible() })
    await page.keyboard.press('Escape')
    await workspace.getByRole('button', { name: 'Classwork', exact: true }).click()

    await page.setViewportSize(VIEWPORTS.mobile)
    await workspace.getByRole('button', { name: /^Field observations/ }).click()
    await workspace.getByRole('tab', { name: 'Students' }).click()
    await workspace.getByRole('button', { name: 'Maya Chen' }).click()
    checks.push({ name: 'Mobile workspace inspector has no page overflow', passed: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth) })
    const mobileWorkspaceArtifact = path.join(artifactDir, 'mobile-light-workspace-inspector.png')
    await workspace.screenshot({ path: mobileWorkspaceArtifact })
    artifacts.push(mobileWorkspaceArtifact)

    await page.goto(`${baseUrl}/pattern-lab?role=teacher#page-mockups`)
    await page.getByRole('group', { name: 'Pattern Lab role' }).getByRole('button', { name: 'Student' }).click()
    await page.waitForURL(`${baseUrl}/pattern-lab?role=student#page-mockups`)
    checks.push({
      name: 'Sticky navigator switches from teacher to student page patterns',
      passed: await page.getByRole('group', { name: 'Pattern Lab role' }).getByRole('button', { name: 'Student', exact: true }).getAttribute('aria-pressed') === 'true'
        && await section.getByRole('tablist', { name: 'Student classroom page mockups' }).isVisible(),
    })
    await navigator.evaluate((element) => { element.style.position = 'static' })
    await page.setViewportSize(VIEWPORTS.desktop)
    const studentNavigatorDesktopArtifact = path.join(artifactDir, 'navigator-student-desktop-light.png')
    await navigator.screenshot({ path: studentNavigatorDesktopArtifact })
    artifacts.push(studentNavigatorDesktopArtifact)

    for (const theme of ['light', 'dark'] as const) {
      const wantedButton = theme === 'dark' ? 'Use dark theme' : 'Use light theme'
      const themeButton = page.getByRole('button', { name: wantedButton })
      if (await themeButton.isVisible().catch(() => false)) await themeButton.click()

      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport)
        for (const pageName of STUDENT_PAGES) {
          await section.getByRole('tab', { name: pageName }).click()
          const targetId = await section.getByRole('tab', { name: pageName }).getAttribute('aria-controls')
          checks.push({
            name: `student ${viewportName} ${theme} ${pageName} tab target exists`,
            passed: Boolean(targetId && await page.locator(`#${targetId}`).count()),
          })
          checks.push({
            name: `student ${viewportName} ${theme} ${pageName} has no page overflow`,
            passed: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
          })
          const artifact = path.join(artifactDir, `student-${viewportName}-${theme}-${pageName.toLowerCase()}.png`)
          await section.screenshot({ path: artifact })
          artifacts.push(artifact)
        }
      }
    }

    const studentNavigatorMobileArtifact = path.join(artifactDir, 'navigator-student-mobile-dark.png')
    await navigator.screenshot({ path: studentNavigatorMobileArtifact })
    artifacts.push(studentNavigatorMobileArtifact)

    await page.setViewportSize(VIEWPORTS.desktop)
    await jumpSelect.selectOption('mockup-student-tests-panel')
    await page.waitForTimeout(100)
    checks.push({
      name: 'Student navigator opens the Tests mockup directly',
      passed: await section.getByRole('tab', { name: 'Tests' }).getAttribute('aria-selected') === 'true'
        && await section.getByRole('tabpanel', { name: 'Tests' }).isVisible()
        && await page.evaluate(() => window.location.hash === '#mockup-student-tests-panel'),
    })
    await page.getByRole('group', { name: 'Pattern Lab role' }).getByRole('button', { name: 'Teacher' }).click()
    await page.waitForURL(`${baseUrl}/pattern-lab?role=teacher#page-mockups`)
    checks.push({
      name: 'Sticky navigator switches back to teacher page patterns',
      passed: await page.getByRole('group', { name: 'Pattern Lab role' }).getByRole('button', { name: 'Teacher', exact: true }).getAttribute('aria-pressed') === 'true'
        && await section.getByRole('tablist', { name: 'Teacher classroom page mockups' }).isVisible(),
    })

    return {
      scenario: 'pattern-lab-page-mockups',
      passed: checks.every((check) => check.passed),
      checks,
      artifacts,
    }
  },
}
