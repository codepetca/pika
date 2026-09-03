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
      await capture('reference-pr1139-classrooms', page.getByTestId('classrooms-mockup'))
    }
    await jump.selectOption('owned-joined-home')
    const prototype = page.getByTestId('owned-joined-home-prototype')
    const home = page.getByTestId('owned-joined-home-screen')
    const writes: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
    })
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toBeVisible()
    await capture(`${role}-default`)
    await prototype.getByRole('combobox', { name: 'Account example' }).selectOption('mixed')
    await expect(home.getByRole('button', { name: 'Open Grade 10 Science' })).toBeVisible()
    await capture('mixed-all')
    const filters = home.getByRole('group', { name: 'Classroom relationship' })
    await filters.getByRole('button', { name: 'All', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(filters.getByRole('button', { name: 'Teaching', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toHaveCount(0)
    await capture('teaching-focus')
    await page.keyboard.press('End')
    await expect(filters.getByRole('button', { name: 'Joined', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await capture('joined')
    await home.getByRole('button', { name: 'Open Learning Design' }).click()
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Today' })).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Roster' })).toHaveCount(0)
    await capture('joined-navigation', page.getByRole('dialog'))
    await page.keyboard.press('Escape')
    await expect(home.getByRole('button', { name: 'Open Learning Design' })).toBeFocused()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await capture('home-menu', page.getByRole('menu', { name: 'Home classroom actions' }))
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
    await home.getByRole('button', { name: 'Move Grade 11 Biology up' }).click()
    await expect(home.getByRole('button', { name: /^Open / }).first()).toHaveAccessibleName('Open Grade 11 Biology')
    await capture('editing')
    await home.getByRole('button', { name: 'Archive Grade 10 Science' }).click()
    await page.getByRole('button', { name: 'Archive example', exact: true }).click()
    await expect(home.getByRole('button', { name: 'Open Grade 10 Science' })).toHaveCount(0)
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeFocused()
    await home.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'Show Archived' }).click()
    await capture('archived')
    await home.getByRole('button', { name: 'Restore Grade 10 Science' }).click()
    await expect(home.getByRole('button', { name: 'Back to classrooms' })).toBeFocused()
    await home.getByRole('button', { name: 'Back to classrooms' }).click()
    await expect(filters.getByRole('button', { name: 'All', exact: true })).toBeFocused()
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

    const visibility = example.getByRole('switch', { name: 'Show grades to students' })
    const target = (await visibility.boundingBox())!
    expect(target.width).toBeGreaterThanOrEqual(44)
    expect(target.height).toBeGreaterThanOrEqual(44)
    await expect(visibility).toHaveAttribute('aria-checked', 'true')
    await expect(
      example.getByTestId('student-grades-visible-preview').getByText('Current grade', { exact: true })
    ).toBeVisible()
    await expect(example.getByText('84%')).toBeVisible()
    await expect(example.getByText('Not counted')).toBeVisible()
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

    await visibility.focus()
    await expect(visibility).toBeFocused()
    await page.keyboard.press('Space')
    await expect(visibility).toHaveAttribute('aria-checked', 'false')
    await expect(example.getByText('Grades is hidden from student navigation.')).toBeVisible()
    await expect(example.getByText('Returned feedback remains available in Classwork and Tests.')).toBeVisible()
    await testInfo.attach('student-grades-hidden', {
      body: await example.screenshot({
        path: testInfo.outputPath('student-grades-hidden.png'),
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
  test('centers save status beside the visible modal heading while content scrolls', async ({ page }, testInfo) => {
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
    await expect(heading).toBeVisible()
    const titleField = dialog.getByRole('textbox', { name: 'Title' })
    await expect(titleField).toHaveValue('Field observations')
    await expect(titleField).toHaveAttribute('placeholder', 'Title')
    await expect(dialog.locator('label').filter({ hasText: /^Title/ })).toHaveClass(/sr-only/)
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
    const editor = dialog.getByRole('textbox', { name: 'Instructions' })
    await expect(dialog.locator('label').filter({ hasText: /^Instructions$/ })).toHaveClass(/sr-only/)
    await expect(editor).toContainText('Read the field guide before our next class.')
    const dueDate = dialog.getByRole('button', { name: 'Tue Sep 1' })
    await expect(dueDate).toBeVisible()
    await expect(dueDate).toHaveAccessibleDescription('Tomorrow')
    await expect(dueDate.getByText('Tomorrow')).toBeVisible()
    await expect(dialog.getByText('Due tomorrow')).toHaveCount(0)
    const preview = dialog.getByRole('button', { name: 'Preview', exact: true })
    await expect(preview).toHaveText('')
    const previewBounds = (await preview.boundingBox())!
    expect(previewBounds.width).toBeGreaterThanOrEqual(44)
    expect(previewBounds.height).toBeGreaterThanOrEqual(44)
    await expect(status).toHaveText('Saved')
    const frame = (await dialog.boundingBox())!
    const title = (await heading.boundingBox())!
    const titleFieldBounds = (await titleField.boundingBox())!
    const save = (await status.boundingBox())!
    const dismiss = (await close.boundingBox())!
    expect(Math.abs(save.x + save.width / 2 - frame.x - frame.width / 2)).toBeLessThan(1)
    expect(Math.abs(save.y + save.height / 2 - title.y - title.height / 2)).toBeLessThan(1)
    expect(Math.abs(save.y + save.height / 2 - dismiss.y - dismiss.height / 2)).toBeLessThan(1)
    expect(dismiss.width).toBeGreaterThanOrEqual(44)
    expect(dismiss.height).toBeGreaterThanOrEqual(44)
    expect(title.x + title.width).toBeLessThan(save.x)
    expect(save.x + save.width).toBeLessThan(dismiss.x)
    expect(titleFieldBounds.y - title.y - title.height).toBeLessThanOrEqual(24)
    await expect(dialog.getByText('Students see this before they begin.')).toHaveCount(0)
    await titleField.focus()
    await testInfo.attach('creation-modal-heading', {
      body: await dialog.screenshot({ path: testInfo.outputPath('creation-modal-heading.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    const post = (await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!
    await editor.fill(Array.from({ length: 40 }, (_, i) => `Observation ${i + 1}: bring a question for our discussion.`).join('\n'))
    await expect(status).toHaveText('Unsaved')
    expect((await status.boundingBox())!.y).toBe(save.y)
    expect((await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!.y).toBe(post.y)
    await expect(close).toBeVisible()

    await preview.focus()
    await expect(page.getByRole('tooltip')).toHaveText('Preview')
    await page.keyboard.press('Enter')
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
