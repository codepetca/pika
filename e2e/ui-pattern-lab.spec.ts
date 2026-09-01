import { expect, test, type Page, type TestInfo } from '@playwright/test'

test.setTimeout(90_000)

async function openPatternLab(page: Page, testInfo: TestInfo, role: 'teacher' | 'student') {
  await page.goto(`/pattern-lab?role=${role}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)

  const expectedTheme = testInfo.project.metadata.theme
  await expect(page.getByRole('heading', { name: 'Pattern Lab' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(expectedTheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
}

for (const role of ['teacher', 'student'] as const) {
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
    const status = dialog.getByRole('status')
    const close = dialog.getByRole('button', { name: 'Close assignment example' })
    await expect(heading).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Field observations')
    await expect(dialog.getByText('Required submissions', { exact: true })).toBeVisible()
    const editor = dialog.getByRole('textbox', { name: 'Instructions' })
    await expect(editor).toContainText('Read the field guide before our next class.')
    await expect(dialog.getByRole('button', { name: 'Tue Sep 1' })).toBeVisible()
    const preview = dialog.getByRole('button', { name: 'Preview', exact: true })
    await expect(preview).toHaveText('')
    const previewBounds = (await preview.boundingBox())!
    expect(previewBounds.width).toBeGreaterThanOrEqual(44)
    expect(previewBounds.height).toBeGreaterThanOrEqual(44)
    await expect(status).toHaveText('Saved')
    const frame = (await dialog.boundingBox())!
    const title = (await heading.boundingBox())!
    const save = (await status.boundingBox())!
    const dismiss = (await close.boundingBox())!
    expect(Math.abs(save.x + save.width / 2 - frame.x - frame.width / 2)).toBeLessThan(1)
    expect(Math.abs(save.y + save.height / 2 - title.y - title.height / 2)).toBeLessThan(1)
    expect(Math.abs(save.y + save.height / 2 - dismiss.y - dismiss.height / 2)).toBeLessThan(1)
    expect(dismiss.width).toBeGreaterThanOrEqual(44)
    expect(dismiss.height).toBeGreaterThanOrEqual(44)
    expect(title.x + title.width).toBeLessThan(save.x)
    expect(save.x + save.width).toBeLessThan(dismiss.x)
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
    await page.getByRole('button', { name: 'Relative date' }).click()
    await expect(date).not.toHaveAttribute('aria-describedby')
    await testInfo.attach('teacher-family-hidden-subtitle', {
      body: await examples.screenshot({ path: testInfo.outputPath('teacher-family-hidden-subtitle.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.getByRole('button', { name: 'Relative date' }).click()
    await date.click()
    await expect(date).toHaveAccessibleDescription('Today')
    await page.getByRole('button', { name: 'Next example day' }).click()
    await expect(date).toContainText('Mon Aug 31')
    await expect(date).not.toHaveAttribute('aria-describedby')

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
