import { expect, test, type Page, type TestInfo } from '@playwright/test'

test.setTimeout(90_000)

for (const role of ['teacher', 'student'] as const) {
  test(`${role} previews the Owned Joined home without live writes`, async ({ page }, testInfo) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await openPatternLab(page, testInfo, role)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const capture = async (name: string, target = page.getByTestId('owned-joined-home-screen')) => {
      await target.scrollIntoViewIfNeeded()
      await testInfo.attach(name, {
        body: await target.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled', style: '[aria-label="Pattern Lab sections"] { visibility: hidden; }' }),
        contentType: 'image/png',
      })
    }
    const jump = page.getByRole('combobox', { name: 'Find a pattern', exact: true })
    if (role === 'teacher') {
      await jump.selectOption('mockup-classrooms-panel')
      await capture('reference-pr1179-classrooms', page.getByTestId('classrooms-mockup'))
    }
    await jump.selectOption('owned-joined-home')
    const prototype = page.getByTestId('owned-joined-home-prototype')
    const home = page.getByTestId('owned-joined-home-screen')
    const actionTarget = await home.getByRole('button', { name: 'Classroom actions' }).boundingBox()
    expect(actionTarget!.width).toBeGreaterThanOrEqual(44)
    expect(actionTarget!.height).toBeGreaterThanOrEqual(44)
    const expectTopRightActions = async () => {
      const trigger = await home.getByRole('button', { name: 'Classroom actions' }).boundingBox()
      const list = await home.getByTestId('home-classroom-list').boundingBox()
      expect(trigger!.y + trigger!.height).toBeLessThanOrEqual(list!.y)
      expect(Math.abs(trigger!.x + trigger!.width - list!.x - list!.width)).toBeLessThanOrEqual(1)
    }
    await expectTopRightActions()
    const writes: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
    })
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toBeVisible()
    await capture(`${role}-default`)
    await prototype.getByRole('combobox', { name: 'Account example' }).selectOption('mixed')
    await expect(home.getByRole('button', { name: 'Open Grade 10 Science' })).toBeVisible()
    await capture('mixed-all')
    await expect(home.getByRole('group', { name: 'Classroom relationship' })).toHaveCount(0)
    await expect(home.getByRole('region', { name: 'Teaching classrooms' })).toBeVisible()
    await expect(home.getByRole('region', { name: 'Joined classrooms' })).toBeVisible()
    await home.getByRole('button', { name: 'Open Learning Design' }).click()
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Today' })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Roster' })).toHaveCount(0)
    await capture('joined-navigation', page.getByRole('dialog'))
    await page.keyboard.press('Escape')
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toBeFocused()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await capture('home-menu', page.getByRole('menu', { name: 'Home classroom actions' }))
    const trigger = await home.getByRole('button', { name: 'Classroom actions' }).boundingBox()
    const menu = await page.getByRole('menu', { name: 'Home classroom actions' }).boundingBox()
    expect(menu!.y).toBeGreaterThanOrEqual(trigger!.y + trigger!.height)
    await capture('home-menu-placement')
    await page.getByRole('menuitem', { name: 'Join classroom' }).click()
    await page.getByRole('textbox', { name: 'Class code' }).fill('invalid')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Use the demo code')
    await capture('join-validation', page.getByRole('dialog'))
    await page.getByRole('textbox', { name: 'Class code' }).fill('DEMO26')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Creative Computing')
    await capture('join-confirmation', page.getByRole('dialog'))
    await page.getByRole('button', { name: 'Join example classroom' }).click()
    await expect(home.getByRole('button', { name: 'Open Creative Computing' })).toBeVisible()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).click()
    await expectTopRightActions()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Edit classrooms' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeVisible()
    await expect(home.getByRole('button', { name: 'Archive Learning Design' })).toHaveCount(0)
    await expect(home.getByRole('button', { name: 'Hide Grade 10 Science' })).toHaveCount(0)
    await capture('edit-owned-and-joined')
    await home.getByRole('button', { name: 'Hide Learning Design' }).click()
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toHaveCount(0)
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeFocused()
    await home.getByRole('button', { name: 'Move Grade 11 Biology up' }).click()
    await expect(home.getByRole('button', { name: /^Open / }).first()).toHaveAccessibleName('Open Grade 11 Biology')
    await capture('editing')
    await home.getByRole('button', { name: 'Archive Grade 10 Science' }).click()
    await page.keyboard.press('Escape')
    await expect(home.getByRole('button', { name: 'Archive Grade 10 Science' })).toBeFocused()
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeVisible()
    await home.getByRole('button', { name: 'Archive Grade 10 Science' }).click()
    await page.getByRole('button', { name: 'Archive example', exact: true }).click()
    await expect(home.getByRole('button', { name: 'Open Grade 10 Science' })).toHaveCount(0)
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeFocused()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'Show Archived' }).click()
    await expectTopRightActions()
    const archives = home.getByRole('region', { name: 'Archived classrooms' })
    const hidden = home.getByRole('region', { name: 'Hidden classrooms' })
    const archiveBounds = (await archives.boundingBox())!
    const hiddenBounds = (await hidden.boundingBox())!
    expect(hiddenBounds.y).toBeGreaterThanOrEqual(archiveBounds.y + archiveBounds.height)
    await expect(hidden.getByRole('button', { name: 'Unhide Learning Design' })).toBeVisible()
    await expect(hidden.getByRole('button', { name: /^Restore / })).toHaveCount(0)
    await capture('archived')
    await hidden.getByRole('button', { name: 'Open Learning Design' }).click()
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Today' })).toBeVisible()
    await expect(page.getByRole('dialog')).not.toContainText('participation is unavailable')
    await page.keyboard.press('Escape')
    await hidden.getByRole('button', { name: 'Unhide Learning Design' }).click()
    await expect(hidden.getByText('No hidden classrooms')).toBeVisible()
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeFocused()
    await home.getByRole('button', { name: 'Settings for Grade 10 Science' }).click()
    const archivedReuse = page.getByRole('menuitem', { name: 'Reuse' })
    const archivedUnarchive = page.getByRole('menuitem', { name: 'Unarchive' })
    const archivedDelete = page.getByRole('menuitem', { name: 'Delete' })
    await expect(archivedReuse).toHaveAttribute('tabindex', '0')
    await expect(archivedUnarchive).toHaveAttribute('tabindex', '-1')
    await expect(archivedDelete).toHaveAttribute('tabindex', '-1')
    await capture('archived-settings-menu')
    await page.keyboard.press('ArrowDown')
    await expect(archivedUnarchive).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(archivedReuse).toBeFocused()
    await page.keyboard.press('End')
    await expect(archivedUnarchive).toBeFocused()
    await page.keyboard.press('Home')
    await expect(archivedReuse).toBeFocused()
    await page.keyboard.press('Escape')
    const archivedSettings = home.getByRole('button', { name: 'Settings for Grade 10 Science' })
    await expect(archivedSettings).toBeFocused()
    await archivedSettings.click()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('menuitem', { name: 'Reuse' })).toHaveCount(0)
    await archivedSettings.click()
    await page.getByRole('menuitem', { name: 'Unarchive' }).click()
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeFocused()
    await home.getByRole('button', { name: 'Back to classrooms' }).click()
    await expect(home.getByRole('heading', { name: 'Active classrooms' })).toBeFocused()
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toBeVisible()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).click()
    await page.keyboard.press('Escape')
    await expect(home.getByRole('heading', { name: 'Active classrooms' })).toBeFocused()
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toHaveCount(0)
    await prototype.getByRole('combobox', { name: 'Creation access' }).selectOption('allowed')
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'New Classroom' }).click()
    await page.getByRole('textbox', { name: 'Classroom name' }).fill('Robotics')
    await capture('create-dialog', page.getByRole('dialog'))
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(home.getByRole('button', { name: 'Open Robotics' })).toHaveCount(0)
    await prototype.getByRole('combobox', { name: 'Home state' }).selectOption('loading')
    await capture('loading')
    await prototype.getByRole('combobox', { name: 'Home state' }).selectOption('error')
    await capture('error')
    await home.getByRole('button', { name: 'Try again' }).click()
    await prototype.getByRole('combobox', { name: 'Account example' }).selectOption('new')
    await prototype.getByRole('combobox', { name: 'Creation access' }).selectOption('unavailable')
    await capture('new-account')
    await expect(home.getByRole('button', { name: 'New Classroom', exact: true })).toHaveCount(0)
    await expect(home.getByRole('button', { name: 'Join classroom', exact: true })).toBeVisible()
    await prototype.getByRole('combobox', { name: 'Account example' }).selectOption('joined')
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).click()
    await home.getByRole('button', { name: 'Hide Learning Design' }).click()
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeFocused()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'Show Archived' }).click()
    await expect(home.getByText('No archived classrooms')).toBeVisible()
    await expect(home.getByRole('button', { name: 'Unhide Learning Design' })).toBeVisible()
    await capture('hidden-only')
    await home.getByRole('button', { name: 'Unhide Learning Design' }).click()
    await expect(home.getByText('No hidden classrooms')).toBeVisible()
    await capture('archived-hidden-empty')
    await home.getByRole('button', { name: 'Back to classrooms' }).click()
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(writes).toEqual([])
    await testInfo.attach('page-errors', { body: JSON.stringify(pageErrors), contentType: 'application/json' })
    expect(pageErrors).toEqual([])
  })
}

async function openPatternLab(page: Page, testInfo: TestInfo, role: 'teacher' | 'student') {
  await page.goto(`/pattern-lab?role=${role}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)

  const expectedTheme = testInfo.project.metadata.theme
  await expect(page.getByRole('heading', { name: 'Pattern Lab' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(expectedTheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
}

for (const role of ['teacher', 'student'] as const) {
  test(`${role} visualizes the minimal student Grades visibility contract`, async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, role)
    const example = page.getByTestId('student-grades-pattern')
    await example.scrollIntoViewIfNeeded()

    const visibility = example.getByRole('switch', { name: 'Student grades visibility' })
    const target = (await visibility.boundingBox())!
    expect(target.width).toBeGreaterThanOrEqual(44)
    expect(target.height).toBeGreaterThanOrEqual(44)
    await expect(visibility).toHaveAttribute('aria-checked', 'false')
    await expect(example.getByTestId('student-grades-view')).toHaveCount(0)
    await expect(example.getByText('Grades is hidden from student navigation.')).toBeVisible()
    await expect(example.getByText('Returned feedback remains available in Classwork and Tests.')).toBeVisible()
    const standalone = example.getByTestId('standalone-returned-marks-preview')
    await expect(standalone.getByText('Not counted')).toBeVisible()
    await expect(standalone.getByRole('link')).toHaveCount(0)
    await testInfo.attach('student-grades-hidden', {
      body: await example.screenshot({
        path: testInfo.outputPath('student-grades-hidden.png'),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })

    await visibility.focus()
    await expect(visibility).toBeFocused()
    await page.keyboard.press('Space')
    await expect(visibility).toHaveAttribute('aria-checked', 'true')
    await expect(
      example.getByTestId('student-grades-view').getByText('Current grade', { exact: true })
    ).toBeVisible()
    await expect(example.getByText('84%')).toBeVisible()
    await expect(
      example.getByTestId('student-grades-view').getByText('Not counted')
    ).toBeVisible()
    const feedbackLinks = example.getByRole('link')
    await expect(feedbackLinks).toHaveCount(3)
    await testInfo.attach('student-grades-visible', {
      body: await example.screenshot({
        path: testInfo.outputPath('student-grades-visible.png'),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })

    await feedbackLinks.first().focus()
    await expect(feedbackLinks.first()).toBeFocused()
    await testInfo.attach('student-grades-feedback-focus', {
      body: await example.screenshot({
        path: testInfo.outputPath('student-grades-feedback-focus.png'),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })

    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })

  test(`${role} demonstrates colored number-only attendance chips`, async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, role)
    const examples = page.getByTestId('status-pattern-examples')
    const chips = page.getByRole('group', { name: 'Sort sample attendance by status' })
    await examples.scrollIntoViewIfNeeded()
    await testInfo.attach('status-colors-default', {
      body: await examples.screenshot({ path: testInfo.outputPath('status-colors-default.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await expect(chips.locator('svg')).toHaveCount(0)
    const absent = chips.getByRole('button', { name: 'Sort Absent first, 1 student' })
    const bounds = (await absent.boundingBox())!
    expect(bounds.width).toBeGreaterThanOrEqual(44)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
    await absent.focus()
    await expect(page.getByRole('tooltip')).toContainText('1 student absent')
    await page.keyboard.press('Enter')
    await expect(absent).toHaveAttribute('aria-pressed', 'true')
    const rows = page.getByRole('table', { name: 'Sample attendance' }).getByRole('row')
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(1)).toContainText('Casey')
    await testInfo.attach('status-colors-sorted', {
      body: await page.getByTestId('attendance-chip-example').screenshot({ path: testInfo.outputPath('status-colors-sorted.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.getByRole('group', { name: 'Attendance status for Blair' }).getByRole('button', { name: 'Present', exact: true }).click()
    await expect(chips.getByRole('button', { name: 'Sort Late first, 0 students' })).toHaveText('0')
    await expect(chips.getByRole('button', { name: 'Sort Present first, 3 students' })).toHaveText('3')
    await page.getByRole('button', { name: 'Reset example' }).click()
    await expect(chips.getByRole('button', { name: 'Sort Late first, 1 student' })).toHaveText('1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })

  test(`${role} keeps creation centered and More actions at the right edge`, async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, role)
    const example = page.getByTestId('page-action-icons-example')
    const create = example.getByRole('button', { name: 'Create assignment' })
    const more = example.getByRole('button', { name: 'More actions' })
    await example.scrollIntoViewIfNeeded()
    const frame = (await example.boundingBox())!
    const control = (await create.boundingBox())!
    const menu = (await more.boundingBox())!
    expect(Math.abs(control.x + control.width / 2 - frame.x - frame.width / 2)).toBeLessThan(1)
    expect(control.width).toBeGreaterThanOrEqual(44)
    expect(control.height).toBeGreaterThanOrEqual(44)
    expect(menu.x).toBeGreaterThan(control.x + control.width)
    expect(frame.x + frame.width - menu.x - menu.width).toBeLessThan(48)

    await testInfo.attach('centered-page-actions', {
      body: await example.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    })

    await create.focus()
    await expect(page.getByRole('tooltip')).toHaveText('Create assignment')
    await more.click()
    await expect(page.getByRole('menuitem', { name: 'Archive selected' })).toBeDisabled()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Export assignments' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(more).toBeFocused()
    await expect(page.getByRole('menu')).toBeHidden()
  })
}

test.describe('teacher Pattern Lab', () => {
  test('uses split creation panes while keeping assignment actions in the details pane', async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-08-31T16:00:00Z'))
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
    })
    await openPatternLab(page, testInfo, 'teacher')
    await expect(page.getByRole('button', { name: 'Open creation dialog' })).toHaveCount(0)
    const opener = page.getByRole('button', { name: 'Open assignment example' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'New Assignment', exact: true })
    const heading = dialog.getByRole('heading', { name: 'New Assignment' })
    const status = dialog.locator('[role="status"][aria-live="polite"]')
    const close = dialog.getByRole('button', { name: 'Close assignment example' })
    const detailsPane = dialog.getByTestId('assignment-editor-details-pane')
    const contentPane = dialog.getByTestId('assignment-editor-content-pane')
    const primaryActions = detailsPane.getByTestId('assignment-editor-primary-actions')
    await expect(heading).toHaveClass(/sr-only/)
    const titleField = detailsPane.getByRole('textbox', { name: 'Title' })
    await expect(titleField).toHaveValue('Field observations')
    await expect(titleField).toHaveAttribute('placeholder', 'Title')
    await expect(detailsPane.locator('label').filter({ hasText: /^Title/ })).not.toHaveClass(/sr-only/)
    const attachments = dialog.getByRole('group', { name: 'Submission Requirement' })
    await expect(attachments.getByText('Submission Requirement', { exact: true })).toBeVisible()
    const addRequirement = attachments.getByRole('button', { name: 'Add submission requirement' })
    await expect(addRequirement).toHaveText('')
    const addBounds = (await addRequirement.boundingBox())!
    expect(addBounds.width).toBeGreaterThanOrEqual(44)
    expect(addBounds.height).toBeGreaterThanOrEqual(44)
    await addRequirement.focus()
    await expect(page.getByRole('tooltip')).toHaveText('Add submission requirement')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Link', exact: true })).toBeFocused()
    await expect(page.getByRole('menuitem', { name: 'Repo', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Image', exact: true })).toBeVisible()
    await testInfo.attach('submission-requirement-menu', {
      body: await dialog.screenshot({ path: testInfo.outputPath('submission-requirement-menu.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(addRequirement).toBeFocused()
    const linkLabel = attachments.getByRole('textbox', { name: 'Link label', exact: true })
    await expect(linkLabel).toHaveValue('Link')
    await expect(dialog.getByRole('textbox', { name: 'Repo link label', exact: true })).toHaveValue('Repo link')
    const imageLabel = dialog.getByRole('textbox', { name: 'Image label', exact: true })
    await expect(imageLabel).toHaveValue('Image')
    await expect(imageLabel).toHaveAccessibleDescription('PNG, JPG, GIF, WebP · maximum 10 MB')
    const attachmentsBounds = (await attachments.boundingBox())!
    const dragBounds = (await attachments.getByRole('button', { name: 'Drag to reorder Link' }).boundingBox())!
    const typeBounds = (await attachments.getByLabel('Link attachment type', { exact: true }).boundingBox())!
    const inputBounds = (await linkLabel.boundingBox())!
    const removeBounds = (await attachments.getByRole('button', { name: 'Remove attachment' }).first().boundingBox())!
    const rowCenters = [dragBounds, typeBounds, inputBounds, removeBounds]
      .map((bounds) => bounds.y + bounds.height / 2)
    expect(attachmentsBounds.height).toBeLessThanOrEqual(220)
    expect(Math.max(...rowCenters) - Math.min(...rowCenters)).toBeLessThan(1)
    await expect(dialog.getByText('Required', { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel('Check', { exact: true })).toHaveCount(0)
    const editor = contentPane.getByRole('textbox', { name: 'Instructions' })
    await expect(dialog.locator('label').filter({ hasText: /^Instructions$/ })).toHaveClass(/sr-only/)
    await expect(editor).toContainText('Read the field guide before our next class.')
    const dueDate = dialog.getByRole('button', { name: 'Tue Sep 1' })
    await expect(dueDate).toBeVisible()
    await expect(dueDate).toHaveAccessibleDescription('Tomorrow')
    await expect(dueDate.getByText('Tomorrow')).toBeVisible()
    await expect(dialog.getByText('Due tomorrow')).toHaveCount(0)
    const preview = dialog.getByRole('button', { name: 'Preview', exact: true })
    await expect(preview).toHaveText('Preview')
    const previewBounds = (await preview.boundingBox())!
    expect(previewBounds.width).toBeGreaterThanOrEqual(44)
    expect(previewBounds.height).toBeGreaterThanOrEqual(44)
    await expect(status).toHaveText('Saved')
    const frame = (await dialog.boundingBox())!
    const detailsBounds = (await detailsPane.boundingBox())!
    const contentBounds = (await contentPane.boundingBox())!
    const save = (await status.boundingBox())!
    const dismiss = (await close.boundingBox())!
    expect(Math.abs(detailsBounds.y - frame.y)).toBeLessThanOrEqual(2)
    expect(dismiss.x).toBeGreaterThanOrEqual(save.x + save.width)
    expect(dismiss.width).toBeGreaterThanOrEqual(44)
    expect(dismiss.height).toBeGreaterThanOrEqual(44)
    if (testInfo.project.metadata.viewport === 'desktop') {
      expect(contentBounds.x).toBeGreaterThanOrEqual(detailsBounds.x + detailsBounds.width - 1)
      expect(Math.abs(contentBounds.y - detailsBounds.y)).toBeLessThan(1)
      expect(contentBounds.width).toBeGreaterThan(detailsBounds.width)
      const actionsBounds = (await primaryActions.boundingBox())!
      const detailsPaddingBottom = await detailsPane.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))
      expect(Math.abs(actionsBounds.y + actionsBounds.height - (detailsBounds.y + detailsBounds.height - detailsPaddingBottom))).toBeLessThanOrEqual(2)
      const dueBounds = (await primaryActions.getByRole('button', { name: 'Tue Sep 1' }).boundingBox())!
      const postBounds = (await primaryActions.getByRole('button', { name: 'Post', exact: true }).locator('..').boundingBox())!
      expect(Math.abs(dueBounds.width - postBounds.width)).toBeLessThanOrEqual(2)
    } else {
      expect(contentBounds.y).toBeGreaterThanOrEqual(detailsBounds.y + detailsBounds.height - 1)
    }
    await expect(dialog.getByText('Students see this before they begin.')).toHaveCount(0)
    await titleField.focus()
    await testInfo.attach('creation-modal-heading', {
      body: await dialog.screenshot({ path: testInfo.outputPath('creation-modal-heading.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    const post = (await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!
    await editor.fill(Array.from({ length: 40 }, (_, i) => `Observation ${i + 1}: bring a question for our discussion.`).join('\n'))
    await expect(status).toHaveText('Unsaved')
    if (testInfo.project.metadata.viewport === 'desktop') {
      expect((await status.boundingBox())!.y).toBe(save.y)
      expect((await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!.y).toBe(post.y)
    }
    await expect(close).toBeVisible()

    await preview.click()
    const reading = page.getByRole('dialog', { name: 'Instructions', exact: true })
    await expect(reading).toContainText('Observation 40: bring a question for our discussion.')
    await testInfo.attach('assignment-preview', {
      body: await reading.screenshot({ path: testInfo.outputPath('assignment-preview.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(reading).toBeHidden()
    await expect(preview).toBeFocused()

    const actions = dialog.getByRole('button', { name: 'Choose assignment action' })
    await actions.click()
    await page.getByRole('menuitem', { name: 'Schedule', exact: true }).click()
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
    const schedule = page.getByRole('dialog', { name: 'Schedule Release', exact: true })
    await expect(schedule.getByLabel('Date', { exact: true })).toHaveValue('2026-09-01')
    await testInfo.attach('assignment-schedule', {
      body: await schedule.screenshot({ path: testInfo.outputPath('assignment-schedule.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(schedule).toBeHidden()
    await actions.click()
    await page.getByRole('menuitem', { name: 'Draft', exact: true }).click()
    await dialog.getByRole('button', { name: 'Draft', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Draft selected. Example only—nothing was saved or posted.')).toBeVisible()
    await opener.click()
    await expect(editor).toContainText('Read the field guide before our next class.')
    await expect(status).toHaveText('Saved')
    const emptyTitleField = dialog.getByRole('textbox', { name: 'Title' })
    const emptyInstructionsEditor = dialog.getByRole('textbox', { name: 'Instructions' })
    await emptyTitleField.fill('')
    await emptyInstructionsEditor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await expect(emptyTitleField).toHaveAttribute('placeholder', 'Title')
    await expect(emptyInstructionsEditor.locator('[data-placeholder="Instructions"]')).toBeVisible()
    await testInfo.attach('assignment-empty-placeholders', {
      body: await dialog.screenshot({ path: testInfo.outputPath('assignment-empty-placeholders.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    expect(writes).toEqual([])
  })

  test('prototypes assignment editing as split desktop panes and a stacked mobile flow', async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-08-31T16:00:00Z'))
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
    })

    await openPatternLab(page, testInfo, 'teacher')
    await page.getByRole('button', { name: 'Open assignment edit prototype' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Assignment', exact: true })
    const detailsPane = dialog.getByTestId('assignment-editor-details-pane')
    const contentPane = dialog.getByTestId('assignment-editor-content-pane')
    const primaryActions = detailsPane.getByTestId('assignment-editor-primary-actions')
    const toolbar = contentPane.getByRole('toolbar', { name: 'Formatting options' })
    const editor = contentPane.getByRole('textbox', { name: 'Instructions' })
    const close = detailsPane.getByRole('button', { name: 'Close assignment edit prototype' })

    await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Field observations')
    await expect(detailsPane.locator('[role="status"][aria-live="polite"]')).toHaveText('Saved')
    await expect(close).toBeVisible()
    expect(Math.abs((await detailsPane.boundingBox())!.y - (await dialog.boundingBox())!.y)).toBeLessThanOrEqual(2)
    await expect(detailsPane.getByRole('button', { name: 'Preview', exact: true })).toBeVisible()
    await expect(detailsPane.getByRole('button', { name: 'Tue Sep 1' })).toBeVisible()
    await expect(detailsPane.getByRole('button', { name: 'Post', exact: true })).toBeVisible()
    await expect(detailsPane.getByRole('group', { name: 'Submission Requirement' })).toBeVisible()
    await expect(toolbar).toBeVisible()
    await expect(editor).toContainText('Read the field guide before our next class.')

    const detailsBounds = (await detailsPane.boundingBox())!
    const contentBounds = (await contentPane.boundingBox())!
    const toolbarBounds = (await toolbar.boundingBox())!
    if (testInfo.project.metadata.viewport === 'desktop') {
      expect((await close.boundingBox())!.x + (await close.boundingBox())!.width).toBeLessThanOrEqual(contentBounds.x)
      expect(contentBounds.x).toBeGreaterThanOrEqual(detailsBounds.x + detailsBounds.width - 1)
      expect(Math.abs(contentBounds.y - detailsBounds.y)).toBeLessThan(1)
      expect(contentBounds.width).toBeGreaterThan(detailsBounds.width)
      expect(toolbarBounds.x).toBeGreaterThanOrEqual(contentBounds.x)
      expect(toolbarBounds.y).toBeGreaterThanOrEqual(contentBounds.y)
      expect(await detailsPane.evaluate((element) => getComputedStyle(element).borderRightWidth)).toBe('0px')
    } else {
      expect(contentBounds.y).toBeGreaterThanOrEqual(detailsBounds.y + detailsBounds.height - 1)
      expect(Math.abs(contentBounds.x - detailsBounds.x)).toBeLessThan(1)
    }

    await testInfo.attach('assignment-edit-split-prototype', {
      body: await dialog.screenshot({ path: testInfo.outputPath('assignment-edit-split-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })

    await editor.fill('Updated assignment instructions.')
    await expect(dialog.locator('[role="status"][aria-live="polite"]')).toHaveText('Unsaved')
    if (testInfo.project.metadata.viewport === 'mobile') {
      const mobileClose = (await close.boundingBox())!
      const post = (await detailsPane.getByRole('button', { name: 'Post', exact: true }).boundingBox())!
      expect(mobileClose.y + mobileClose.height <= post.y || mobileClose.y >= post.y + post.height).toBe(true)
    }
    await detailsPane.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(dialog.locator('[role="status"][aria-live="polite"]')).toHaveText('Saved')

    const preview = detailsPane.getByRole('button', { name: 'Preview', exact: true })
    const previewBounds = (await preview.boundingBox())!
    const detailsBoundsAfterLayout = (await detailsPane.boundingBox())!
    const detailsPaddingBottom = await detailsPane.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))
    const primaryActionBounds = (await primaryActions.boundingBox())!
    expect(Math.abs(primaryActionBounds.y + primaryActionBounds.height - (detailsBoundsAfterLayout.y + detailsBoundsAfterLayout.height - detailsPaddingBottom))).toBeLessThanOrEqual(2)
    expect(Math.abs(previewBounds.x - primaryActionBounds.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(previewBounds.width - primaryActionBounds.width)).toBeLessThanOrEqual(1)
    const dateBounds = (await primaryActions.getByRole('button', { name: 'Tue Sep 1' }).boundingBox())!
    const postControlBounds = (await primaryActions.getByRole('button', { name: 'Post', exact: true }).locator('..').boundingBox())!
    expect(Math.abs(dateBounds.width - postControlBounds.width)).toBeLessThanOrEqual(2)
    expect(Math.abs(postControlBounds.x + postControlBounds.width - (primaryActionBounds.x + primaryActionBounds.width))).toBeLessThanOrEqual(1)
    await preview.click()
    const reading = page.getByRole('dialog', { name: 'Instructions', exact: true })
    await expect(reading).toContainText('Updated assignment instructions.')
    await page.keyboard.press('Escape')
    await expect(preview).toBeFocused()
    expect(writes).toEqual([])
  })

  test('prototypes test editing as split desktop panes and a stacked mobile flow', async ({ page }, testInfo) => {
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
    })

    await openPatternLab(page, testInfo, 'teacher')
    await page.getByRole('button', { name: 'Open test edit prototype' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Test', exact: true })
    const detailsPane = dialog.getByTestId('test-editor-details-pane')
    const contentPane = dialog.getByTestId('test-editor-content-pane')
    const actionbar = contentPane.getByTestId('test-question-actionbar')
    const questionNavigation = contentPane.getByRole('group', { name: 'Question navigation' })
    const toolbar = contentPane.getByRole('toolbar', { name: 'Formatting options' })
    const editor = contentPane.getByRole('textbox', { name: 'Question 1 prompt' })
    const close = dialog.getByRole('button', { name: 'Close test edit prototype' })
    const status = detailsPane.getByRole('status')

    await expect(close).toBeVisible()
    await expect(status).toHaveText('Saved')
    const dialogTop = (await dialog.boundingBox())!.y
    const detailsTop = (await detailsPane.boundingBox())!.y
    expect(Math.abs(detailsTop - dialogTop)).toBeLessThanOrEqual(2)
    const closeBounds = (await close.boundingBox())!
    const settingsBounds = (await detailsPane.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!
    expect(closeBounds.x >= settingsBounds.x + settingsBounds.width || settingsBounds.x >= closeBounds.x + closeBounds.width).toBe(true)

    await testInfo.attach('test-edit-details-prototype', {
      body: await dialog.screenshot({ path: testInfo.outputPath('test-edit-details-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })

    await expect(detailsPane.getByRole('textbox', { name: 'Title' })).toHaveValue('Wetland field study')
    await expect(detailsPane.getByRole('button', { name: 'Preview', exact: true })).toBeVisible()
    const settings = detailsPane.getByRole('button', { name: 'Settings', exact: true })
    await settings.click()
    await expect(page.getByRole('menuitemradio', { name: 'Show results after return' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('menuitemradio', { name: 'Keep results hidden' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(settings).toBeFocused()
    const references = detailsPane.getByRole('group', { name: 'Reference Docs' })
    await expect(references.getByRole('textbox', { name: 'pdf reference label' })).toHaveValue('Wetland reference sheet.pdf')
    const addReference = references.getByRole('button', { name: 'Add reference' })
    await addReference.click()
    await expect(page.getByRole('menuitem', { name: 'Link' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'PDF' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Text' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Link' }).click()
    await expect(references.getByRole('textbox', { name: 'link reference label' })).toHaveValue('Link reference 2')
    await expect(references.getByRole('button', { name: 'Remove Link reference 2' })).toBeVisible()
    await expect(detailsPane.getByText('8 total · 22 points')).toBeVisible()
    const questionActions = actionbar.getByRole('button', { name: 'Question actions' })
    await questionActions.click()
    await expect(page.getByRole('menuitem', { name: 'Add multiple-choice question' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Add open-response question' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Duplicate question' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete question' })).toBeVisible()
    await expect(actionbar.getByRole('button', { name: 'Add question' })).toHaveCount(0)
    await expect(actionbar.getByRole('button', { name: 'Question options' })).toHaveCount(0)
    await testInfo.attach('test-edit-question-menu-prototype', {
      body: await page.screenshot({ path: testInfo.outputPath('test-edit-question-menu-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(questionActions).toBeFocused()
    await expect(detailsPane.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
    await expect(toolbar).toBeVisible()
    await expect(editor).toContainText('Which observation best supports')
    await expect(contentPane.getByRole('spinbutton', { name: 'Points' })).toHaveValue('1')
    const questionNumber = contentPane.getByRole('spinbutton', { name: 'Question number' })
    await expect(questionNumber).toHaveValue('1')
    await expect(contentPane.getByRole('button', { name: 'Previous question' })).toBeDisabled()
    await expect(contentPane.getByRole('button', { name: 'Next question' })).toBeEnabled()
    await expect(questionActions).toBeVisible()
    await questionActions.click()
    await expect(page.getByRole('menuitem', { name: 'Duplicate question' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Delete question' })).toBeVisible()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Code response' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(questionActions).toBeFocused()
    await expect(contentPane.getByRole('button', { name: /Move question \d+ (earlier|later)/ })).toHaveCount(0)
    await expect(contentPane.getByText('Questions', { exact: true })).toHaveCount(0)
    await expect(actionbar.getByRole('spinbutton', { name: 'Points' })).toBeVisible()
    await expect(actionbar.getByRole('button', { name: 'Question actions' })).toHaveCount(1)
    const navigationBounds = (await questionNavigation.boundingBox())!
    const initialContentBounds = (await contentPane.boundingBox())!
    expect(Math.abs(navigationBounds.x + navigationBounds.width / 2 - (initialContentBounds.x + initialContentBounds.width / 2))).toBeLessThanOrEqual(2)
    const actionbarBounds = (await actionbar.boundingBox())!
    expect(navigationBounds.y).toBeGreaterThanOrEqual(actionbarBounds.y)
    expect(navigationBounds.y + navigationBounds.height).toBeLessThanOrEqual(actionbarBounds.y + actionbarBounds.height + 1)
    await expect(contentPane.getByRole('button', { name: 'Delete option D' })).toBeVisible()
    await expect(contentPane.getByRole('button', { name: 'Drag option A to reorder' })).toBeVisible()
    const emptyOption = contentPane.getByRole('textbox', { name: 'Question 1 option E' })
    await expect(emptyOption).toHaveValue('')
    await expect(contentPane.getByRole('button', { name: 'Delete option E' })).toHaveCount(0)

    await questionNumber.fill('2')
    await questionNumber.press('Enter')
    await expect(contentPane.getByRole('textbox', { name: 'Question 2 prompt' })).toContainText('Explain how two organisms')
    await questionNumber.fill('1')
    await questionNumber.press('Enter')

    await emptyOption.fill('Seasonal water levels remain stable.')
    await expect(contentPane.getByRole('button', { name: 'Delete option E' })).toBeVisible()
    await expect(contentPane.getByRole('textbox', { name: 'Question 1 option F' })).toHaveValue('')
    await contentPane.getByRole('button', { name: 'Delete option E' }).click()
    await expect(contentPane.getByRole('textbox', { name: 'Question 1 option E' })).toHaveValue('')
    await expect(contentPane.getByRole('textbox', { name: 'Question 1 option F' })).toHaveCount(0)
    await contentPane.getByRole('textbox', { name: 'Question 1 option A' }).fill('Updated multiple-choice option.')
    await questionNumber.fill('4')
    await questionNumber.press('Enter')
    await expect(contentPane.getByRole('textbox', { name: 'Question 4 option A' })).toHaveValue('Several native species use the same habitat.')
    await questionNumber.fill('1')
    await questionNumber.press('Enter')

    const detailsBounds = (await detailsPane.boundingBox())!
    const contentBounds = (await contentPane.boundingBox())!
    const toolbarBounds = (await toolbar.boundingBox())!
    if (testInfo.project.metadata.viewport === 'desktop') {
      expect(contentBounds.x).toBeGreaterThanOrEqual(detailsBounds.x + detailsBounds.width - 1)
      expect(Math.abs(contentBounds.y - detailsBounds.y)).toBeLessThan(1)
      expect(contentBounds.width).toBeGreaterThan(detailsBounds.width)
      expect(toolbarBounds.x).toBeGreaterThanOrEqual(contentBounds.x)
      expect(await detailsPane.evaluate((element) => getComputedStyle(element).borderRightWidth)).toBe('0px')
      const publishBounds = (await detailsPane.getByRole('button', { name: 'Publish', exact: true }).boundingBox())!
      const previewBounds = (await detailsPane.getByRole('button', { name: 'Preview', exact: true }).boundingBox())!
      const detailsPaddingBottom = await detailsPane.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom))
      expect(Math.abs(publishBounds.y + publishBounds.height - (detailsBounds.y + detailsBounds.height - detailsPaddingBottom))).toBeLessThanOrEqual(2)
      expect(Math.abs(previewBounds.y - publishBounds.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(previewBounds.width - publishBounds.width)).toBeLessThanOrEqual(2)
    } else {
      expect(contentBounds.y).toBeGreaterThanOrEqual(detailsBounds.y + detailsBounds.height - 1)
      expect(Math.abs(contentBounds.x - detailsBounds.x)).toBeLessThan(1)
    }

    await testInfo.attach('test-edit-split-prototype', {
      body: await dialog.screenshot({ path: testInfo.outputPath('test-edit-split-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })

    await contentPane.getByRole('button', { name: 'Next question' }).click()
    await expect(contentPane.getByRole('textbox', { name: 'Question 2 prompt' })).toContainText('Explain how two organisms')
    await expect(contentPane.getByRole('spinbutton', { name: 'Points' })).toHaveValue('5')
    await questionActions.click()
    const codeResponse = page.getByRole('menuitemcheckbox', { name: 'Code response' })
    await expect(codeResponse).toHaveAttribute('aria-checked', 'false')
    await testInfo.attach('test-edit-open-question-menu-prototype', {
      body: await page.screenshot({ path: testInfo.outputPath('test-edit-open-question-menu-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await codeResponse.click()
    await questionActions.click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Code response' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(contentPane.getByRole('textbox', { name: 'Answer key' })).toBeVisible()
    await expect(contentPane.getByRole('textbox', { name: 'Sample solution' })).toBeVisible()
    if (testInfo.project.metadata.viewport === 'mobile') {
      const scrolledClose = (await close.boundingBox())!
      const publish = (await detailsPane.getByRole('button', { name: 'Publish', exact: true }).boundingBox())!
      expect(scrolledClose.y + scrolledClose.height <= publish.y || scrolledClose.y >= publish.y + publish.height).toBe(true)
    }
    await testInfo.attach('test-edit-open-response-prototype', {
      body: await dialog.screenshot({ path: testInfo.outputPath('test-edit-open-response-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await questionNumber.fill('1')
    await questionNumber.press('Enter')

    await questionActions.click()
    await page.getByRole('menuitem', { name: 'Duplicate question' }).click()
    await expect(detailsPane.getByText('9 total · 23 points')).toBeVisible()
    await expect(questionNumber).toHaveValue('2')
    await expect(contentPane.getByText('Multiple choice', { exact: true })).toBeVisible()
    await expect(contentPane.getByRole('textbox', { name: 'Question 2 prompt' })).toContainText('(copy)')
    await questionActions.click()
    await page.getByRole('menuitem', { name: 'Delete question' }).click()
    await expect(detailsPane.getByText('8 total · 22 points')).toBeVisible()
    await questionNumber.fill('1')
    await questionNumber.press('Enter')

    const codeMode = detailsPane.getByRole('button', { name: 'Markdown', exact: true })
    await codeMode.click()
    const markdownEditor = contentPane.getByRole('textbox', { name: 'Test markdown editor' })
    await expect(markdownEditor).toContainText('## Questions')
    await expect(contentPane.getByRole('button', { name: 'Apply Markdown' })).toBeDisabled()
    await testInfo.attach('test-edit-code-prototype', {
      body: await dialog.screenshot({ path: testInfo.outputPath('test-edit-code-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await markdownEditor.press('End')
    await markdownEditor.pressSequentially('\n# Teacher note')
    await expect(contentPane.getByRole('button', { name: 'Apply Markdown' })).toBeEnabled()
    await contentPane.getByRole('button', { name: 'Undo' }).click()
    await expect(contentPane.getByRole('button', { name: 'Apply Markdown' })).toBeDisabled()
    const originalMarkdown = await markdownEditor.inputValue()
    await markdownEditor.fill(originalMarkdown.replace('Title: Wetland field study', 'Title: Wetland field study revised'))
    await contentPane.getByRole('button', { name: 'Apply Markdown' }).click()
    await expect(detailsPane.getByRole('textbox', { name: 'Title' })).toHaveValue('Wetland field study revised')
    await markdownEditor.fill(originalMarkdown)
    await contentPane.getByRole('button', { name: 'Apply Markdown' }).click()
    await expect(detailsPane.getByRole('textbox', { name: 'Title' })).toHaveValue('Wetland field study')
    await codeMode.click()

    await editor.fill('Updated wetland question.')
    await expect(dialog.locator('[role="status"][aria-live="polite"]')).toHaveText('Unsaved')
    await detailsPane.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(dialog.locator('[role="status"][aria-live="polite"]')).toHaveText('Saved')

    const preview = detailsPane.getByRole('button', { name: 'Preview', exact: true })
    await preview.click()
    const studentPreview = page.getByRole('region', { name: 'Teacher test preview' })
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true)
    await expect(studentPreview.getByText('Preview Mode')).toBeVisible()
    await expect(studentPreview.getByRole('heading', { name: 'Wetland field study' })).toBeVisible()
    await expect(studentPreview).toContainText('Updated wetland question.')
    await expect(studentPreview).toContainText('Describe one follow-up observation that would strengthen the study.')
    await expect(studentPreview.locator('[data-question-id="00000000-0000-4000-8000-000000000001"]')).toContainText('Updated multiple-choice option.')
    await expect(studentPreview.locator('[data-question-id="00000000-0000-4000-8000-000000000004"]')).toContainText('Several native species use the same habitat.')
    await expect(studentPreview.getByRole('textbox', { name: 'Response for question 3' })).toHaveClass(/font-mono/)
    await expect(studentPreview.getByRole('button', { name: 'Wetland reference sheet.pdf' })).toBeVisible()
    await testInfo.attach('test-edit-full-preview-prototype', {
      body: await page.screenshot({ path: testInfo.outputPath('test-edit-full-preview-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await studentPreview.getByRole('button', { name: 'Close Preview' }).click()
    await expect(preview).toBeFocused()

    await questionActions.click()
    await page.getByRole('menuitem', { name: 'Add open-response question' }).click()
    await expect(detailsPane.getByText('9 total · 27 points')).toBeVisible()
    await expect(questionNumber).toHaveValue('9')
    await expect(contentPane.getByText('Open response', { exact: true })).toBeVisible()
    await questionActions.click()
    await page.getByRole('menuitem', { name: 'Delete question' }).click()
    await expect(detailsPane.getByText('8 total · 22 points')).toBeVisible()

    const titleInput = detailsPane.getByRole('textbox', { name: 'Title' })
    await titleInput.fill('')
    await expect(detailsPane.getByText('Add a title before publishing.')).toBeVisible()
    await expect(detailsPane.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    expect(writes).toEqual([])
  })

  test('authors a Markdown text reference and carries it into the full Test preview', async ({ page }, testInfo) => {
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
    })
    await openPatternLab(page, testInfo, 'teacher')
    await page.getByRole('button', { name: 'Open test edit prototype' }).click()
    const testDialog = page.getByRole('dialog', { name: 'Edit Test', exact: true })
    const details = testDialog.getByTestId('test-editor-details-pane')
    const references = details.getByRole('group', { name: 'Reference Docs' })
    await references.getByRole('button', { name: 'Add reference' }).click()
    await page.getByRole('menuitem', { name: 'Text' }).click()
    const documentDialog = page.getByRole('dialog', { name: 'Add Document' })
    await expect(documentDialog.getByRole('textbox', { name: 'Document title' })).toBeFocused()
    await documentDialog.getByRole('button', { name: 'Add text' }).click()
    await expect(documentDialog.getByRole('alert')).toHaveText('Document title is required')
    await documentDialog.getByRole('textbox', { name: 'Document title' }).fill('Wetland notes')
    await documentDialog.getByRole('button', { name: 'Add text' }).click()
    await expect(documentDialog.getByRole('alert')).toHaveText('Document text is required')
    await documentDialog.getByRole('textbox', { name: 'Document text' }).fill('## Field notes\n- Count native species\n- Record water depth')
    await expect(documentDialog).toContainText(/\d+\/20000 characters/)
    await testInfo.attach('test-text-reference-editor', {
      body: await documentDialog.screenshot({ path: testInfo.outputPath('test-text-reference-editor.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await documentDialog.getByRole('button', { name: 'Add text' }).click()
    await expect(documentDialog).toBeHidden()
    const editReference = references.getByRole('button', { name: 'Edit Wetland notes' })
    await expect(editReference).toContainText('Count native species')
    await editReference.click()
    const editDialog = page.getByRole('dialog', { name: 'Edit document' })
    await expect(editDialog.getByRole('textbox', { name: 'Document title' })).toHaveValue('Wetland notes')
    await expect(editDialog.getByRole('textbox', { name: 'Document text' })).toContainText('Count native species')
    await editDialog.getByRole('textbox', { name: 'Document text' }).fill('## Field notes\n- Count native species\n- Record water temperature')
    await editDialog.getByRole('button', { name: 'Cancel' }).click()
    await editReference.click()
    await expect(editDialog.getByRole('textbox', { name: 'Document text' })).toContainText('Record water depth')
    await editDialog.getByRole('textbox', { name: 'Document text' }).fill('## Field notes\n- Count native species\n- Record water temperature')
    await editDialog.getByRole('button', { name: 'Save' }).click()
    await expect(editReference).toContainText('Record water temperature')
    await testInfo.attach('test-text-reference-list', {
      body: await testDialog.screenshot({ path: testInfo.outputPath('test-text-reference-list.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await details.getByRole('button', { name: 'Markdown', exact: true }).click()
    const markdown = testDialog.getByRole('textbox', { name: 'Test markdown editor' })
    await expect(markdown).toContainText('Record water temperature')
    await details.getByRole('button', { name: 'Markdown', exact: true }).click()
    await details.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByRole('region', { name: 'Teacher test preview' })
    await preview.getByRole('button', { name: 'Wetland notes' }).click()
    await expect(preview.getByRole('heading', { name: 'Field notes' })).toBeVisible()
    await expect(preview.getByText('Record water temperature')).toBeVisible()
    await testInfo.attach('test-text-reference-preview', {
      body: await page.screenshot({ path: testInfo.outputPath('test-text-reference-preview.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    expect(writes).toEqual([])
  })

  test('previews material with a pinned creation bar and explicit draft action', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'teacher')
    const open = page.getByRole('button', { name: 'Open material example' })
    await open.click()
    const dialog = page.getByRole('dialog', { name: 'New Material', exact: true })
    const preview = dialog.getByRole('button', { name: 'Preview', exact: true })
    await expect(dialog.getByRole('heading', { name: 'New Material' })).toBeVisible()
    await expect(dialog.getByText('Ungraded classwork')).toHaveCount(0)
    await expect(preview).toHaveText('')
    const control = (await preview.boundingBox())!
    expect(control.width).toBeGreaterThanOrEqual(44)
    expect(control.height).toBeGreaterThanOrEqual(44)
    const close = (await dialog.getByRole('button', { name: 'Close material modal' }).boundingBox())!
    const post = (await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!
    expect(close.y + close.height).toBeLessThanOrEqual(post.y)
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused()
    await testInfo.attach('material-editor', {
      body: await dialog.screenshot({ path: testInfo.outputPath('material-editor.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await preview.focus()
    await expect(page.getByRole('tooltip')).toHaveText('Preview')
    await page.keyboard.press('Enter')
    const reading = page.getByRole('dialog', { name: 'Material preview' })
    await expect(reading.getByText('Read the field guide before our next class.')).toBeVisible()
    await testInfo.attach('material-preview', {
      body: await reading.screenshot({ path: testInfo.outputPath('material-preview.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(reading).toBeHidden()
    await expect(preview).toBeFocused()
    await dialog.getByRole('textbox', { name: 'Content', exact: true }).fill(Array.from({ length: 40 }, (_, i) => `Reading note ${i + 1}: record a question for the next discussion.`).join('\n'))
    await expect(preview).toBeVisible()
    expect((await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!.y).toBe(post.y)
    await dialog.getByRole('button', { name: 'Choose material action' }).click()
    await expect(page.getByRole('menuitem', { name: 'Save draft' })).toBeFocused()
    await testInfo.attach('material-actions', {
      body: await dialog.screenshot({ path: testInfo.outputPath('material-actions.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Title' }).fill('')
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Title is required')
    await testInfo.attach('material-validation', {
      body: await dialog.screenshot({ path: testInfo.outputPath('material-validation.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Updated field guide')
    await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(open).toBeFocused()
    await expect(page.getByText('Save draft selected. Example only—nothing was saved or posted.')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })

  test('demonstrates merged teacher date context and both workspace frames', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'teacher')
    const examples = page.getByTestId('teacher-pattern-examples')
    await examples.scrollIntoViewIfNeeded()
    await testInfo.attach('teacher-family-default', {
      body: await examples.screenshot({ path: testInfo.outputPath('teacher-family-default.png'), animations: 'disabled' }), contentType: 'image/png',
    })

    const date = page.getByRole('button', { name: 'Go to reference today' })
    await expect(date).toHaveAccessibleDescription('2 days ago')
    const dateHeightWithSubtitle = (await date.boundingBox())!.height
    await page.getByRole('button', { name: 'Relative date' }).click()
    await expect(date).not.toHaveAttribute('aria-describedby')
    await expect(date).not.toHaveClass(/flex-col/)
    expect((await date.boundingBox())!.height).toBe(dateHeightWithSubtitle)
    await testInfo.attach('teacher-family-hidden-subtitle', {
      body: await examples.screenshot({ path: testInfo.outputPath('teacher-family-hidden-subtitle.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.getByRole('button', { name: 'Relative date' }).click()
    await date.click()
    await expect(date).toHaveAccessibleDescription('Today')
    await page.getByRole('button', { name: 'Next example day' }).click()
    await expect(date).toContainText('Mon Aug 31')
    await expect(date).not.toHaveAttribute('aria-describedby')
    expect((await date.boundingBox())!.height).toBe(dateHeightWithSubtitle)

    await page.getByRole('tab', { name: 'Overview', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Work details' })).toBeFocused()
    await expect(page.getByRole('tabpanel', { name: 'Work details' })).toBeVisible()
    await testInfo.attach('teacher-family-future-and-selected', {
      body: await examples.screenshot({ path: testInfo.outputPath('teacher-family-future-and-selected.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })

  test('renders the component, icon, status, and page-state contracts', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'teacher')
    await expect(page.getByText('teacher reference')).toBeVisible()
    await page.getByRole('navigation', { name: 'Pattern Lab sections' }).evaluate((navigation) => {
      navigation.style.position = 'static'
    })
    // Exclude Next.js developer chrome, whose issue badge varies between runs.
    await page.addStyleTag({ content: 'nextjs-portal { visibility: hidden !important; }' })
    await expect(page.getByTestId('pattern-lab-contracts')).toHaveScreenshot('teacher-pattern-contracts.png')
    await testInfo.attach('teacher-history-preview', {
      body: await page.getByTestId('history-preview-gallery').screenshot({ path: testInfo.outputPath('teacher-history-preview.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
  })

  test('keeps the canonical dialog interaction visible and dismissible', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pattern-lab-desktop-light', 'One interaction snapshot is sufficient')
    await openPatternLab(page, testInfo, 'teacher')

    await page.getByRole('button', { name: 'Open alert dialog' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Pattern confirmed' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveScreenshot('teacher-pattern-dialog.png')
    await page.getByRole('button', { name: 'Close example' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('student assignment attachments', () => {
  test('shows one confirmation for all missing attachments', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'student')
    const example = page.locator('#student-assignment-attachments')
    await example.scrollIntoViewIfNeeded()
    await expect(example.getByText('1 of 3 added')).toBeVisible()
    await expect(example.getByText('Required', { exact: true })).toHaveCount(0)
    await testInfo.attach('student-attachments', {
      body: await example.screenshot({ path: testInfo.outputPath('student-attachments.png'), animations: 'disabled' }), contentType: 'image/png',
    })

    await example.getByRole('button', { name: 'Submit' }).click()
    const dialog = page.getByRole('dialog', { name: 'Submit without attachments?' })
    await expect(dialog).toContainText('Repo link and Image are missing. Submit anyway?')
    await expect(dialog.getByRole('button', { name: 'Go back' })).toBeFocused()
    await testInfo.attach('student-missing-confirmation', {
      body: await dialog.screenshot({ path: testInfo.outputPath('student-missing-confirmation.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(example.getByRole('button', { name: 'Submit' })).toBeFocused()
  })
})

test.describe('student Pattern Lab', () => {
  test('renders role-specific references without changing the shared contracts', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'student')
    await expect(page.getByText('student reference')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Student history' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Snapshot gallery' })).toHaveCount(0)
    await expect(page.getByTestId('teacher-pattern-examples')).toHaveCount(0)
    await expect(page.getByTestId('pattern-lab-header')).toHaveScreenshot('student-pattern-header.png')
    await testInfo.attach('student-history-preview', {
      body: await page.getByTestId('history-preview-gallery').screenshot({ path: testInfo.outputPath('student-history-preview.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
  })
})
