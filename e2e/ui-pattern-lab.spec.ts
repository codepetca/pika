import { expect, test, type Page, type TestInfo, type Locator } from '@playwright/test'
import { verifyTabSelectionVisibility } from './helpers/tab-selection-visibility'
import { mockTableShellReads, TABLE_CLASSROOM_ID } from './helpers/teacher-student-tables'

test.setTimeout(90_000)
test.use({ video: process.env.MOTION_RECORD_VIDEO === 'true' ? 'on' : 'off' })

for (const role of ['teacher', 'student'] as const) {
  test(`modal corner close stays consistent for ${role}`, async ({ page }, info) => {
    await openPatternLab(page, info, role)
    await page.getByRole('combobox', { name: 'Find a pattern', exact: true }).selectOption('modal-close')
    const fixture = page.getByTestId('modal-close-pattern')
    await fixture.scrollIntoViewIfNeeded()
    for (const kind of ['content', 'panel', 'creation', 'confirm', 'alert']) {
      const opener = fixture.getByRole('button', { name: `Open ${kind} close example`, exact: true })
      await opener.click()
      const dialog = page.getByRole(kind === 'alert' ? 'alertdialog' : 'dialog')
      const close = dialog.locator('[data-dialog-close]').getByRole('button')
      await expect(close).toBeVisible()
      await expect(dialog.locator('[data-dialog-close]')).toHaveCount(1)
      const assertCorner = async () => {
        const panel = (await dialog.boundingBox())!, button = (await close.boundingBox())!
        expect(button.width).toBeGreaterThanOrEqual(44)
        expect(button.height).toBeGreaterThanOrEqual(44)
        expect(Math.abs(panel.x + panel.width - button.x - button.width - 12)).toBeLessThanOrEqual(1)
        expect(Math.abs(button.y - panel.y - 12)).toBeLessThanOrEqual(1)
      }
      await assertCorner()
      if (['content', 'panel', 'creation'].includes(kind)) {
        await dialog.getByRole('button', { name: 'Toggle busy state' }).click()
        await expect(close).toBeDisabled()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Toggle busy state' }).click()
        await dialog.getByText('Reading paragraph 12.', { exact: false }).scrollIntoViewIfNeeded()
        await assertCorner()
      }
      await info.attach(`${role}-${kind}-corner-close`, { body: await dialog.screenshot({ path: info.outputPath(`${role}-${kind}-corner-close.png`), animations: 'disabled' }), contentType: 'image/png' })
      await close.click()
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
    }
  })
}

for (const role of ['teacher', 'student'] as const) {
  test(`Markdown authoring preserves ${role} Course Guide and assignment content`, async ({ page }, info) => {
    const theme = info.project.metadata.theme === 'dark' ? 'dark' : 'light'
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
    await mockTableShellReads(page, role)
    const source = '# Field observations\n\nExplain **why**.\n\n- First observation\n- Second observation\n\n> Keep your notes.\n'
    const guide = { classroom: { title: 'Field observations course' },
      visibility: { overview: true, resources: false, assignments: false, tests: false },
      overviewMarkdown: source, resourcesContent: null, assignments: [], tests: [] }
    await page.route('**/api/classrooms/*/course-guide', route => route.fulfill({ json: { guide } }))
    const saves: unknown[] = []
    await page.route(`**/api/teacher/classrooms/${TABLE_CLASSROOM_ID}`, async route => {
      saves.push(route.request().postDataJSON())
      await route.fulfill({ json: {} })
    })
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' }), contentType: 'image/png' })
    }
    await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=resources&guideContinuity=true`)
    await expect(page.getByRole('heading', { name: 'Field observations course', exact: true })).toBeVisible()
    if (role === 'student') {
      await expect(page.getByRole('heading', { name: 'Field observations', exact: true })).toBeVisible()
      await expect(page.getByRole('group', { name: 'Course guide editing mode' })).toHaveCount(0)
      await capture('student-course-guide-reading')
      await openPatternLab(page, info, 'student')
      await page.getByRole('combobox', { name: 'Find a pattern', exact: true }).selectOption('markdown-authoring')
      await page.locator('#markdown-authoring').scrollIntoViewIfNeeded()
      await expect(page.locator('#markdown-authoring').getByRole('heading', { name: 'Field observations', exact: true })).toBeInViewport()
      await capture('student-assignment-instructions-reading')
      return
    }
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    const modes = page.getByRole('group', { name: 'Course guide editing mode' })
    await expect(modes.getByRole('button', { name: 'Write' })).toHaveAttribute('aria-pressed', 'true')
    await modes.getByRole('button', { name: 'Markdown' }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await page.getByRole('textbox', { name: 'Course guide Markdown', exact: true }).fill(source)
    await capture('teacher-course-guide-markdown')
    await modes.getByRole('button', { name: 'Write' }).click()
    const toolbar = page.getByRole('toolbar', { name: 'Formatting options' })
    await expect(toolbar.getByRole('button')).toHaveCount(5)
    await expect(page.getByRole('textbox', { name: 'Course guide', exact: true })).toContainText('First observation')
    await modes.getByRole('button', { name: 'Write' }).focus()
    await page.keyboard.press('Tab')
    await expect(toolbar).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('textbox', { name: 'Course guide', exact: true })).toBeFocused()
    await toolbar.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(modes.getByRole('button', { name: 'Write' })).toBeFocused()
    await capture('teacher-course-guide-write')
    const format = toolbar.getByRole('button', { name: 'Format', exact: true })
    await format.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Heading 2', exact: true })).toBeVisible()
    await capture('teacher-course-guide-format')
    await page.keyboard.press('Escape')
    await expect(format).toBeFocused()
    for (const button of await toolbar.getByRole('button').all()) {
      const box = (await button.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
    await modes.getByRole('button', { name: 'Markdown' }).click()
    await expect(page.getByRole('textbox', { name: 'Course guide Markdown', exact: true })).toHaveValue(source)
    expect(saves).toEqual([])
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => saves).toEqual([{ courseOverviewMarkdown: source }])
    await expect(page.getByRole('heading', { name: 'Field observations', exact: true })).toBeVisible()

    await openPatternLab(page, info, 'teacher')
    await page.getByRole('combobox', { name: 'Find a pattern', exact: true }).selectOption('assignment-edit-split')
    await page.getByRole('button', { name: 'Open assignment edit prototype' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit Assignment', exact: true })
    const cornerClose = dialog.getByRole('button', { name: 'Close assignment edit prototype' })
    const dialogBounds = (await dialog.boundingBox())!, closeBounds = (await cornerClose.boundingBox())!
    const inset = info.project.metadata.viewport === 'desktop' ? 16 : 12
    expect(Math.abs(closeBounds.y - dialogBounds.y - inset)).toBeLessThanOrEqual(1)
    expect(Math.abs(dialogBounds.x + dialogBounds.width - closeBounds.x - closeBounds.width - inset)).toBeLessThanOrEqual(1)
    const assignmentModes = dialog.getByRole('group', { name: 'Instructions editing mode' })
    if (info.project.metadata.viewport === 'desktop') {
      const modes = (await assignmentModes.boundingBox())!
      expect(Math.abs(modes.y + modes.height / 2 - closeBounds.y - closeBounds.height / 2)).toBeLessThanOrEqual(2)
    }
    await assignmentModes.getByRole('button', { name: 'Markdown' }).click()
    await dialog.getByRole('textbox', { name: 'Instructions Markdown', exact: true }).fill(source)
    await capture('teacher-assignment-markdown')
    await assignmentModes.getByRole('button', { name: 'Write' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Instructions', exact: true })).toContainText('First observation')
    await expect(dialog.getByRole('toolbar').getByRole('button')).toHaveCount(5)
    await capture('teacher-assignment-write')
    await assignmentModes.getByRole('button', { name: 'Markdown' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Instructions Markdown', exact: true })).toHaveValue(source)

    await cornerClose.click()
    let finishSave!: () => void
    let saveStarted = false
    const saveGate = new Promise<void>(resolve => { finishSave = resolve })
    await page.route('**/api/teacher/assignments/assignment-controller-A', async route => {
      if (route.request().method() !== 'PATCH') return route.fulfill({ json: {} })
      saveStarted = true
      await saveGate
      await route.fulfill({ json: { assignment: {
        id: 'assignment-controller-A', classroom_id: 'classroom-controller',
        title: 'Updated field observations', description: 'Original instructions',
        instructions_markdown: 'Original instructions', rich_instructions: null,
        due_at: '2030-10-21T03:59:59.999Z', position: 0, is_draft: true,
        released_at: null, track_authenticity: true, created_by: 'teacher-controller',
        submission_requirements: [], created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-22T12:00:00Z', ...route.request().postDataJSON(),
      } } })
    })
    await page.goto('/pattern-lab?role=teacher&fixture=assignment-controller', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-pattern-lab-ready=true]')).toBeVisible()
    await page.getByRole('button', { name: 'Open controlled assignment' }).click()
    const controlled = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close assignment modal' }) })
    const controlledTitle = controlled.getByRole('textbox', { name: 'Title', exact: true })
    const saveIndicator = controlled.getByRole('status').filter({ hasText: /^(Saved|Saving…|Unsaved)$/ })
    await controlledTitle.fill('')
    await expect(controlledTitle).toHaveAttribute('placeholder', 'Title')
    await expect(controlledTitle).toHaveValue('')
    await controlledTitle.fill('Updated field observations')
    await controlledTitle.press('Tab')
    try {
      await expect.poll(() => saveStarted).toBe(true)
      await expect(saveIndicator).toHaveText('Saving…')
      await expect(saveIndicator.locator('svg')).toBeVisible()
      await expect(saveIndicator.getByText('Saving…', { exact: true })).toHaveClass(/sr-only/)
      await info.attach('assignment-saving-circle', { body: await controlled.screenshot({ path: info.outputPath('assignment-saving-circle.png'), animations: 'disabled' }), contentType: 'image/png' })
    } finally { finishSave() }
    await expect(saveIndicator).toHaveText('Saved')
    await expect(saveIndicator.locator('svg')).toHaveCount(0)
  })
}

for (const role of ['teacher', 'student'] as const) {
  test(`${role} browser tab follows classroom identity and theme`, async ({ page }, testInfo) => {
    const theme = testInfo.project.metadata.theme === 'dark' ? 'dark' : 'light'
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' })
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
    await page.goto(`/e2e-fixtures/browser-tab-branding?userRole=${role}`)
    await expect(page).toHaveTitle('PPZ3C — Health for Life')
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1)
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', `/pika-icon-${theme}.svg`)
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1)
    await expect(page.locator('#pika-tab-color')).toHaveAttribute('content', theme === 'dark' ? '#fb7185' : '#f43f5e')
    await testInfo.attach('classroom-tab-branding', { body: await page.screenshot(), contentType: 'image/png' })
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', `/pika-icon-${theme === 'dark' ? 'light' : 'dark'}.svg`)
    await expect(page).toHaveTitle('PPZ3C — Health for Life')
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', `/pika-icon-${theme}.svg`)

    const longTitle = 'ICS4U — Introduction to Computer Science: Algorithms, Data Structures, and Software Design'
    await page.getByRole('button', { name: 'Long classroom name', exact: true }).click()
    const title = page.getByRole('banner').getByTitle(longTitle, { exact: true })
    await expect(title).toHaveText(longTitle)
    await expect(page).toHaveTitle(longTitle)
    await expect(title).toHaveCSS('text-overflow', 'clip')
    if (testInfo.project.metadata.viewport === 'desktop') {
      await expect(title).toHaveCSS('mask-image', 'none')
      expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect((await title.boundingBox())!.width).toBeGreaterThan(320)
    } else {
      await expect.poll(() => title.evaluate((element) => getComputedStyle(element).maskImage)).toContain('linear-gradient')
    }
    await testInfo.attach('classroom-title-available-width', { body: await page.screenshot(), contentType: 'image/png' })

    await page.getByRole('button', { name: 'Overflowing classroom name', exact: true }).click()
    const overflowingTitle = page.getByRole('banner').locator('[title^="ICS4U"]')
    await expect.poll(() => overflowingTitle.evaluate((element) => getComputedStyle(element).maskImage)).toContain('linear-gradient')
    expect(await overflowingTitle.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    const fullscreen = page.getByRole('button', { name: 'Enter fullscreen', exact: true })
    const control = await fullscreen.isVisible() ? fullscreen : page.getByRole('button', { name: 'User menu', exact: true })
    const titleBox = (await overflowingTitle.boundingBox())!
    const controlBox = (await control.boundingBox())!
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(controlBox.x)
    expect(titleBox.x + titleBox.width).toBeGreaterThan(controlBox.x - 16)
    expect(controlBox.width).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await testInfo.attach('classroom-title-fade-at-controls', { body: await page.screenshot(), contentType: 'image/png' })
    if (testInfo.project.metadata.viewport === 'desktop') {
      await fullscreen.click()
      await expect(page.getByTestId('header-date-time')).toBeVisible()
      const firstControl = (await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).boundingBox())!
      const narrowedTitle = (await overflowingTitle.boundingBox())!
      expect(narrowedTitle.x + narrowedTitle.width).toBeLessThanOrEqual(firstControl.x)
      expect(narrowedTitle.width).toBeLessThan(titleBox.width)
      await testInfo.attach('classroom-title-fullscreen-controls', { body: await page.screenshot(), contentType: 'image/png' })
      await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
    }

    // An unchanged name must be remeasured when the available header width changes.
    await page.getByRole('button', { name: 'Short classroom name', exact: true }).click()
    const shortTitle = page.getByRole('banner').getByTitle('ICS4U', { exact: true })
    await expect(shortTitle).toHaveCSS('mask-image', 'none')
    const wideViewport = page.viewportSize()!
    const narrowViewport = { width: 280, height: wideViewport.height }
    await page.setViewportSize(narrowViewport)
    await page.getByRole('button', { name: 'Classroom 1', exact: true }).click()
    const mediumTitle = page.getByRole('banner').getByTitle('PPZ3C — Health for Life', { exact: true })
    await expect.poll(() => mediumTitle.evaluate((element) => getComputedStyle(element).maskImage)).toContain('linear-gradient')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(mediumTitle).toHaveCSS('mask-image', 'none')
    await page.setViewportSize(wideViewport)

    await page.getByRole('link', { name: 'Switch role route', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`userRole=${role === 'teacher' ? 'student' : 'teacher'}$`))
    await expect(page).toHaveTitle('PPZ3C — Health for Life')
    await page.getByRole('button', { name: 'Classroom 2', exact: true }).click()
    await expect(page).toHaveTitle('ICS4U — Computer Science')
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', `/pika-icon-${theme}.svg`)
    await page.getByRole('button', { name: 'Edit classroom', exact: true }).click()
    await expect(page).toHaveTitle('Renamed classroom')
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', `/pika-icon-${theme}.svg`)

    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await expect(page).toHaveTitle('Pika')
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', `/pika-icon-${theme}.svg`)
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click()
    const toggledIcon = `/pika-icon-${theme === 'dark' ? 'light' : 'dark'}.svg`
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', toggledIcon)
    await page.getByRole('button', { name: 'Classroom 1', exact: true }).click()
    await expect(page).toHaveTitle('PPZ3C — Health for Life')
    await page.getByRole('link', { name: 'Leave classroom', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page).toHaveTitle('Pika')
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1)
    await expect(page.locator('#pika-tab-icon')).toHaveAttribute('href', toggledIcon)
  })
}

test.describe('selected tab visibility', () => {
  for (const role of ['teacher', 'student'] as const) {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`${role} keeps selection visible with ${reducedMotion} motion`, async ({ page }, testInfo) => {
        await verifyTabSelectionVisibility(page, testInfo, role, reducedMotion)
      })
    }
  }
})

test('prototypes survey editing with accessible split panes and local authoring actions', async ({ page }, testInfo) => {
  const writes: string[] = []
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
  })
  await openPatternLab(page, testInfo, 'teacher')
  await page.getByRole('combobox', { name: 'Find a pattern', exact: true }).selectOption('survey-edit-split')
  await page.getByRole('button', { name: 'Open survey edit prototype' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Survey', exact: true })
  await expectEditorContext(dialog, 'Survey', testInfo)
  const details = dialog.getByTestId('survey-editor-details-pane')
  const content = dialog.getByTestId('survey-editor-content-pane')
  const number = content.getByRole('spinbutton', { name: 'Question number' })
  const actions = content.getByRole('button', { name: 'Question actions', exact: true })
  const settings = details.getByRole('button', { name: 'Settings', exact: true })
  const capture = async (name: string, wholePage = false) => {
    await testInfo.attach(name, {
      body: wholePage
        ? await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' })
        : await page.getByRole('dialog').screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' }),
      contentType: 'image/png',
    })
  }
  const expectNoOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }

  await expect(content.getByRole('textbox', { name: 'Question 1 prompt' })).toContainText('wetland ecosystem')
  await expect(details.getByText('3 total', { exact: true })).toBeVisible()
  const detailsBounds = (await details.boundingBox())!
  const contentBounds = (await content.boundingBox())!
  if (testInfo.project.metadata.viewport === 'desktop') {
    expect(contentBounds.x).toBeGreaterThanOrEqual(detailsBounds.x + detailsBounds.width - 1)
    expect(Math.abs(contentBounds.y - detailsBounds.y)).toBeLessThanOrEqual(1)
    const corner = (await dialog.getByRole('button', { name: 'Close survey edit prototype' }).boundingBox())!
    const questionActions = (await actions.boundingBox())!
    expect(Math.abs(corner.y + corner.height / 2 - questionActions.y - questionActions.height / 2)).toBeLessThanOrEqual(2)
  } else {
    expect(contentBounds.y).toBeGreaterThanOrEqual(detailsBounds.y + detailsBounds.height - 1)
    expect(Math.abs(contentBounds.x - detailsBounds.x)).toBeLessThanOrEqual(1)
  }
  await content.getByRole('button', { name: /Reorder option A;/ }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(content.getByRole('textbox', { name: 'Question 1 option A' })).toHaveValue('The group discussion')
  await expect(content.getByRole('button', { name: /Reorder option B;/ })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(content.getByRole('textbox', { name: 'Question 1 option A' })).toHaveValue('The field observations')
  await content.getByRole('textbox', { name: 'Question 1 option A' }).fill('Updated field observations')
  await content.getByRole('textbox', { name: 'Question 1 option E' }).fill('The reflection journal')
  await expect(content.getByRole('textbox', { name: 'Question 1 option F' })).toHaveValue('')
  await content.getByRole('button', { name: 'Delete option E', exact: true }).click()
  await expect(content.getByRole('textbox', { name: 'Question 1 option E' })).toHaveValue('')
  await expectNoOverflow()
  if (testInfo.project.metadata.viewport === 'mobile') {
    const panel = (await dialog.boundingBox())!, context = (await details.locator('.modal-context-row').boundingBox())!
    expect(context.y).toBeGreaterThanOrEqual(panel.y)
    const corner = (await dialog.getByRole('button', { name: 'Close survey edit prototype' }).boundingBox())!
    const classroom = (await details.locator('.modal-context-row [title]').boundingBox())!
    expect(classroom.x + classroom.width).toBeLessThanOrEqual(corner.x - 4)
  }
  await capture('survey-edit-multiple-choice')

  await content.getByRole('button', { name: 'Next question' }).click()
  await expect(number).toHaveValue('2')
  await content.getByRole('textbox', { name: 'Question 2 prompt' }).fill('What would you investigate next?')
  await content.getByRole('spinbutton', { name: 'Response character limit' }).fill('1200')
  await expect(content.getByText('Students answer in their own words.')).toBeVisible()
  await expect(content.getByRole('textbox', { name: /option A/ })).toHaveCount(0)
  await capture('survey-edit-open-response')

  await settings.focus()
  await settings.press('Enter')
  const resultsSetting = page.getByRole('menuitemcheckbox', { name: 'Show class results to students' })
  await expect(resultsSetting).toHaveAttribute('aria-checked', 'false')
  await expect(resultsSetting).toBeFocused()
  await page.keyboard.press('Space')
  await settings.click()
  await expect(resultsSetting).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowDown')
  const responsesSetting = page.getByRole('menuitemcheckbox', { name: 'Allow students to update responses' })
  await expect(responsesSetting).toBeFocused()
  await page.keyboard.press('Enter')
  await settings.click()
  await expect(responsesSetting).toHaveAttribute('aria-checked', 'true')
  await capture('survey-edit-settings', true)
  await page.keyboard.press('Escape')
  await expect(settings).toBeFocused()

  await actions.click()
  await page.getByRole('menuitem', { name: 'Add multiple-choice question' }).click()
  await expect(number).toHaveValue('4')
  await content.getByRole('textbox', { name: 'Question 4 prompt' }).fill('Would you repeat the activity?')
  await content.getByRole('textbox', { name: 'Question 4 option A' }).fill('Yes')
  await content.getByRole('textbox', { name: 'Question 4 option B' }).fill('No')
  await actions.click()
  await page.getByRole('menuitem', { name: 'Add open-response question' }).click()
  await expect(number).toHaveValue('5')
  await content.getByRole('textbox', { name: 'Question 5 prompt' }).fill('Share a suggestion.')
  await actions.click()
  await page.getByRole('menuitem', { name: 'Duplicate question' }).click()
  await expect(number).toHaveValue('6')
  await expect(content.getByRole('textbox', { name: 'Question 6 prompt' })).toContainText('Share a suggestion.')
  await expect(details.getByText('6 total', { exact: true })).toBeVisible()
  for (let remaining = 5; remaining >= 1; remaining -= 1) {
    await actions.click()
    await page.getByRole('menuitem', { name: 'Delete question' }).click()
    await expect(details.getByText(`${remaining} total`, { exact: true })).toBeVisible()
  }
  await actions.click()
  await expect(page.getByRole('menuitem', { name: 'Delete question' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(actions).toBeFocused()

  await details.getByRole('button', { name: 'Markdown', exact: true }).click()
  await expect(details.getByRole('textbox', { name: 'Title' })).toBeDisabled()
  await expect(settings).toBeDisabled()
  const markdown = content.getByRole('textbox', { name: 'Survey markdown editor' })
  const originalMarkdown = await markdown.inputValue()
  expect(originalMarkdown).toContain('Show Results: true')
  expect(originalMarkdown).toContain('Dynamic Responses: true')
  await markdown.fill(originalMarkdown.replace('Type: multiple_choice', 'Type: unsupported'))
  await content.getByRole('button', { name: 'Apply Markdown' }).click()
  await expect(content.getByRole('alert')).toBeVisible()
  await expect(markdown).toBeVisible()
  await markdown.fill(originalMarkdown.replace('Title: Wetland field study feedback', 'Title: Updated field study feedback').replace('Which activity helped you understand the wetland ecosystem best?', 'Which activity would you recommend?'))
  await capture('survey-edit-markdown')
  await content.getByRole('button', { name: 'Apply Markdown' }).click()
  await expect(details.getByRole('textbox', { name: 'Title' })).toHaveValue('Updated field study feedback')
  await expect(content.getByRole('textbox', { name: 'Question 1 prompt' })).toContainText('Which activity would you recommend?')
  await expect(content.getByRole('alert')).toHaveCount(0)

  await details.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Survey preview', exact: true })
  await expect(preview.getByRole('heading', { name: 'Updated field study feedback' })).toBeVisible()
  await expect(preview.getByText('Which activity would you recommend?')).toBeVisible()
  await preview.getByRole('radio', { name: 'Updated field observations' }).check()
  await expect(preview.getByRole('radio', { name: 'Updated field observations' })).toBeChecked()
  await expectNoOverflow()
  await capture('survey-edit-preview')
  await preview.getByRole('button', { name: 'Back to editor', exact: true }).click()
  await expect(details.getByRole('button', { name: 'Preview', exact: true })).toBeFocused()
  await expect(content.getByRole('textbox', { name: 'Question 1 prompt' })).toContainText('Which activity would you recommend?')
  await details.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(details.getByRole('status').filter({ hasText: 'Published in this prototype only.' })).toBeVisible()
  await expectNoOverflow()
  await dialog.getByRole('button', { name: 'Close survey edit prototype' }).click()
  await expect(dialog).toHaveCount(0)
  expect(writes).toEqual([])
  expect(pageErrors).toEqual([])

  await mockTableShellReads(page, 'teacher')
  let surveyRecord = {
    id: 'survey-preview-source', classroom_id: TABLE_CLASSROOM_ID, title: 'Preview saving feedback',
    status: 'draft', opens_at: null, show_results: true, dynamic_responses: true, position: 0,
    created_by: '30000000-0000-4000-8000-000000000012',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    stats: { total_students: 0, responded: 0, questions_count: 1 },
  }
  const previewQuestions = [{ id: 'preview-question', survey_id: surveyRecord.id, question_type: 'multiple_choice',
    question_text: 'Which activity helped?', options: ['Discussion', 'Fieldwork'], response_max_chars: 1200,
    position: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }]
  let releasePreviewSave!: () => void
  let previewSaveStarted = false
  const previewSaveGate = new Promise<void>(resolve => { releasePreviewSave = resolve })
  await page.route('**/api/teacher/surveys**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'PATCH' && path === `/api/teacher/surveys/${surveyRecord.id}`) {
      previewSaveStarted = true
      await previewSaveGate
      surveyRecord = { ...surveyRecord, ...route.request().postDataJSON() }
      return route.fulfill({ json: { survey: surveyRecord } })
    }
    if (route.request().method() !== 'GET') return route.abort()
    return route.fulfill({ json: path === '/api/teacher/surveys' ? { surveys: [surveyRecord] }
      : path.endsWith('/results') ? { results: [], stats: surveyRecord.stats }
      : { survey: surveyRecord, questions: previewQuestions } })
  })
  await page.goto(`/e2e-fixtures/teacher-student-tables?role=teacher&tab=assignments&surveyId=${surveyRecord.id}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'More survey actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit survey', exact: true }).click()
  const workspace = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close survey editor' }) })
  await workspace.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect(workspace.getByText('Student preview', { exact: true })).toBeVisible()
  const previewTitle = workspace.getByRole('textbox', { name: 'Title', exact: true })
  await previewTitle.fill('Updated preview title')
  await previewTitle.press('Tab')
  const previewSave = workspace.getByRole('status').filter({ hasText: /^(Saved|Saving…|Unsaved)$/ })
  try {
    await expect.poll(() => previewSaveStarted).toBe(true)
    await expect(previewSave).toHaveText('Saving…')
    await expect(previewSave.locator('svg')).toBeVisible()
    await testInfo.attach('survey-preview-saving-circle', { body: await workspace.screenshot({ path: testInfo.outputPath('survey-preview-saving-circle.png'), animations: 'disabled' }), contentType: 'image/png' })
  } finally { releasePreviewSave() }
  await expect(previewSave).toHaveText('Saved')
  await expect(workspace.getByRole('heading', { name: 'Updated preview title', exact: true })).toBeVisible()
  expect(writes.map(url => new URL(url).pathname)).toEqual([`/api/teacher/surveys/${surveyRecord.id}`])
  expect(pageErrors).toEqual([])
})
for (const role of ['teacher', 'student'] as const) {
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`${role} shared interaction continuity with ${motion} motion`, async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: motion })
      await openPatternLab(page, testInfo, role)
      const saving = page.getByRole('button', { name: 'Saving', exact: true })
      await expect(saving).toHaveAttribute('aria-busy', 'true')
      await expect(saving).toBeDisabled()
      expect(await saving.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
        motion === 'reduce' ? '0s' : '0.15s',
      )
      expect(await saving.locator('svg').evaluate((element) => getComputedStyle(element).animationName)).toBe(
        motion === 'reduce' ? 'none' : 'spin',
      )
      const draft = page.getByTestId('tab-entry-extension').getByRole('textbox', { name: 'Example draft', exact: true })
      await draft.fill('Unsaved example')
      const node = await draft.elementHandle()
      await page.getByRole('tab', { name: 'Activity', exact: true }).click()
      await expect(page.locator('#fluid-draft-panel').locator('..')).toHaveAttribute('inert', '')
      await expect(draft).toBeHidden()
      await page.getByRole('tab', { name: 'Draft', exact: true }).click()
      expect(await draft.evaluate((element, original) => element === original, node)).toBe(true)
      await expect(draft).toHaveValue('Unsaved example')
      const animation = await page.locator('#fluid-draft-panel').locator('..').evaluate((element) => ({
        name: getComputedStyle(element).animationName,
        duration: getComputedStyle(element).animationDuration,
      }))
      expect(animation.name).toBe('workspace-entry')
      expect(animation.duration).toBe(motion === 'reduce' ? '0s' : '0.2s')

      const trigger = page.getByRole('button', { name: 'User menu', exact: true }).first()
      await trigger.focus()
      await page.keyboard.press('ArrowDown')
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      expect(await menu.getByRole('menuitem').evaluateAll((elements) => elements.map((element) => (element as HTMLElement).tabIndex))).toEqual([0, -1, -1])
      await page.keyboard.press('End')
      await expect(page.getByRole('menuitem', { name: 'Logout', exact: true })).toBeFocused()
      await page.getByRole('menuitem', { name: 'Send Feedback', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await expect(page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`)).toHaveAttribute('inert', '')
      await expect(page.getByRole('menu')).toHaveCount(0)
    })
  }
}

test('teacher continuous inspector keeps controls and details usable in the bounded reference', async ({ page }, testInfo) => {
  await openPatternLab(page, testInfo, 'teacher')
  const example = page.getByTestId('continuous-inspector-example')
  await example.scrollIntoViewIfNeeded()
  const alex = example.getByRole('button', { name: 'Alex Chen', exact: true })
  const sam = example.getByRole('button', { name: 'Sam Patel', exact: true })
  const inspector = example.locator('[data-workspace-inspector]')
  await expect(inspector).toHaveAttribute('inert', '')
  await alex.focus()
  await page.keyboard.press('Enter')
  await expect(alex).toHaveAttribute('aria-pressed', 'true')
  await expect(inspector.getByText('Alex Chen', { exact: true })).toBeVisible()
  await sam.click()
  await expect(inspector.getByText('Sam Patel', { exact: true })).toBeVisible()
  // Visible text precedes the mobile flex transition settling. Sample both
  // rectangles together until the original usable, bounded geometry is present.
  await expect.poll(async () => {
    const [bounds, details] = await Promise.all([example.boundingBox(), inspector.boundingBox()])
    return Boolean(bounds && details && details.height > 100 && details.y >= bounds.y &&
      details.y + details.height <= bounds.y + bounds.height + 1)
  }).toBe(true)
  await testInfo.attach('continuous-inspector', {
    body: await example.screenshot({ path: testInfo.outputPath('continuous-inspector.png'), animations: 'disabled' }),
    contentType: 'image/png',
  })
  await inspector.getByRole('button', { name: 'Close details' }).click()
  await expect(inspector).toHaveAttribute('inert', '')
  await expect(sam).toBeFocused()
  await expect(sam).toHaveAttribute('aria-pressed', 'false')
})

test('teacher WorkSurfaceMockup keeps the selected table and inspector usable', async ({ page }, testInfo) => {
  await openPatternLab(page, testInfo, 'teacher')
  await page.getByRole('tab', { name: 'Workspaces', exact: true }).click()
  const example = page.getByTestId('work-surface-shell-example')
  await example.getByRole('button', { name: /^Field observations/ }).click()
  await expect(example.locator('#work-pattern-students-panel')).toBeHidden()
  await example.getByRole('tab', { name: 'Students', exact: true }).click()
  await example.getByRole('button', { name: 'Maya Chen', exact: true }).click()
  await example.scrollIntoViewIfNeeded()

  const table = example.locator('table')
  const tableFrame = table.locator('..')
  const inspector = example.getByText('Student work', { exact: true }).locator('..')
  const canvasBounds = (await example.boundingBox())!
  for (const pane of [tableFrame, inspector]) {
    const bounds = (await pane.boundingBox())!
    // The compact reference canvas must leave room for two student rows or inspector text.
    expect(bounds.height).toBeGreaterThanOrEqual(100)
    expect(bounds.y).toBeGreaterThanOrEqual(canvasBounds.y)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(canvasBounds.y + canvasBounds.height)
  }
  await testInfo.attach('selected-workspace-panes-top', {
    body: await example.screenshot({ path: testInfo.outputPath('selected-workspace-panes-top.png'), animations: 'disabled' }),
    contentType: 'image/png',
  })
  await tableFrame.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(table.getByRole('button', { name: 'Sana Patel' })).toBeInViewport()
  const response = inspector.getByText('Selected response or document appears here only after the teacher chooses a student.')
  await response.scrollIntoViewIfNeeded()
  await expect(response).toBeInViewport()
  await expect(table.getByRole('button', { name: 'Sana Patel' })).toBeInViewport()
  await testInfo.attach('selected-workspace-panes', {
    body: await example.screenshot({ path: testInfo.outputPath('selected-workspace-panes.png'), animations: 'disabled' }),
    contentType: 'image/png',
  })
})

for (const role of ['teacher', 'student'] as const) {
  test(`${role} renders guided assignment Markdown code references`, async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, role)
    const reference = page.getByTestId('guided-assignment-markdown-reference')
    await reference.scrollIntoViewIfNeeded()
    await expect(reference.getByRole('heading', { level: 3, name: 'Task' })).toBeVisible()
    await expect(reference.getByRole('heading', { level: 3, name: 'Instructions' })).toBeVisible()
    const code = reference.locator('pre code')
    await expect(code).toHaveCount(2)
    expect(await code.nth(0).textContent()).toBe('## code heading\n```\n---')
    expect(await code.nth(1).textContent()).toBe('## tilde example\n---')
    expect(await code.first().evaluate((element) => getComputedStyle(element).color)).toBe('rgb(255, 255, 255)')
    await expect(reference.getByText('After the backtick example.')).toBeVisible()
    await expect(reference.getByText('After the tilde example.')).toBeVisible()
    await testInfo.attach(`${role}-guided-assignment-markdown`, {
      body: await reference.screenshot({
        path: testInfo.outputPath(`${role}-guided-assignment-markdown.png`),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })
  })

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

async function expectEditorContext(dialog: Locator, itemType: string, testInfo: TestInfo) {
  const context = dialog.locator('.modal-context-row')
  await expect(context.getByText(itemType, { exact: true })).toBeVisible()
  const classroom = context.locator('[title]')
  await expect(classroom).toHaveAttribute('title', 'Health for Life · Period 2 · Community, wellbeing and lifelong learning')
  await expect(classroom).toHaveText('Health for Life · Period 2 · Community, wellbeing and lifelong learning')
  expect(await classroom.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  expect(await classroom.evaluate(element => getComputedStyle(element).maskImage)).toContain('linear-gradient')
  const contextBounds = (await context.boundingBox())!
  const titleBounds = (await dialog.getByRole('textbox', { name: 'Title', exact: true }).boundingBox())!
  expect(titleBounds.y).toBeGreaterThanOrEqual(contextBounds.y + contextBounds.height + 10)
  const closeBounds = (await dialog.locator('[data-dialog-close]').boundingBox())!
  const panelBounds = (await dialog.boundingBox())!
  expect(closeBounds.y - panelBounds.y).toBeLessThanOrEqual(17)
  if (testInfo.project.metadata.viewport === 'desktop' && ['Assignment', 'Material'].includes(itemType)) {
    const controls = (await dialog.locator('.modal-controls-row').first().boundingBox())!
    expect(Math.abs(closeBounds.y + closeBounds.height / 2 - controls.y - controls.height / 2)).toBeLessThanOrEqual(2)
  }
  if (testInfo.project.metadata.viewport === 'mobile') {
    const classroomBounds = (await classroom.boundingBox())!
    // The classroom fade leaves visual space while its box ends at the close slot.
    expect(classroomBounds.x + classroomBounds.width).toBeLessThanOrEqual(closeBounds.x)
    // The second-row input can use the full details width below the corner X.
    expect(titleBounds.y).toBeGreaterThan(closeBounds.y + closeBounds.height)
  }
}

async function openPatternLab(page: Page, testInfo: TestInfo, role: 'teacher' | 'student') {
  await page.goto(`/pattern-lab?role=${role}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-pattern-lab-ready=true]')).toBeVisible()
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
    await expect(example.getByRole('heading', { name: 'Gradebook marks', exact: true })).toBeVisible()
    await expect(example.getByTestId('student-grades-view').getByText('Based on returned work and Gradebook marks')).toBeVisible()
    const itemTrigger = example.getByRole('button', { name: 'Edit standalone item', exact: true })
    await itemTrigger.click()
    const itemDialog = page.getByRole('dialog', { name: 'Edit item', exact: true })
    await expect(itemDialog.getByText('Marks are visible to students as soon as you save them.')).toBeVisible()
    await expect(itemDialog.getByRole('button', { name: 'Return marks', exact: true })).toHaveCount(0)
    await itemDialog.getByRole('textbox', { name: 'Assessment title' }).fill('External exam')
    await testInfo.attach('standalone-item-editor', {
      body: await itemDialog.screenshot({ path: testInfo.outputPath('standalone-item-editor.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await itemDialog.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(itemDialog).toBeHidden()
    await expect(itemTrigger).toBeFocused()
    const markTrigger = example.getByRole('button', { name: 'Enter standalone mark', exact: true })
    await markTrigger.click()
    const markDialog = page.getByRole('dialog', { name: 'Edit mark', exact: true })
    await expect(markDialog.getByText('Marks are visible to students as soon as you save them.')).toBeVisible()
    await markDialog.getByRole('spinbutton', { name: 'Mark earned', exact: true }).fill('0')
    await testInfo.attach('standalone-mark-editor', {
      body: await markDialog.screenshot({ path: testInfo.outputPath('standalone-mark-editor.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await markDialog.getByRole('button', { name: 'Save mark', exact: true }).click()
    await expect(markDialog).toBeHidden()
    await expect(markTrigger).toBeFocused()
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
    await absent.scrollIntoViewIfNeeded()
    await absent.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(absent).toBeFocused()
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
    await expectEditorContext(dialog, 'Assignment', testInfo)
    const detailsPane = dialog.getByTestId('assignment-editor-details-pane')
    const contentPane = dialog.getByTestId('assignment-editor-content-pane')
    const primaryActions = detailsPane.getByTestId('assignment-editor-primary-actions')
    await expect(heading).toHaveClass(/sr-only/)
    const titleField = detailsPane.getByRole('textbox', { name: 'Title' })
    await expect(titleField).toHaveValue('Field observations')
    await expect(titleField).toHaveAttribute('placeholder', 'Title')
    await expect(detailsPane.locator('label').filter({ hasText: /^Title/ })).toHaveClass(/sr-only/)
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
    const detailsBounds = (await detailsPane.boundingBox())!
    const contentBounds = (await contentPane.boundingBox())!
    const save = (await status.boundingBox())!
    const dismiss = (await close.boundingBox())!
    const contextBounds = (await dialog.locator('.modal-context-row').boundingBox())!
    expect(Math.abs(detailsBounds.y - contextBounds.y - contextBounds.height)).toBeLessThanOrEqual(1)
    expect(dismiss.y + dismiss.height <= save.y || dismiss.x >= save.x + save.width).toBe(true)
    expect(dismiss.width).toBeGreaterThanOrEqual(44)
    expect(dismiss.height).toBeGreaterThanOrEqual(44)
    if (testInfo.project.metadata.viewport === 'desktop') {
      expect(contentBounds.x).toBeGreaterThanOrEqual(detailsBounds.x + detailsBounds.width - 1)
      const contextBounds = (await dialog.locator('.modal-context-row').boundingBox())!
      expect(Math.abs(contentBounds.y - contextBounds.y)).toBeLessThanOrEqual(1)
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
    await expectEditorContext(dialog, 'Assignment', testInfo)
    const detailsPane = dialog.getByTestId('assignment-editor-details-pane')
    const contentPane = dialog.getByTestId('assignment-editor-content-pane')
    const primaryActions = detailsPane.getByTestId('assignment-editor-primary-actions')
    const toolbar = contentPane.getByRole('toolbar', { name: 'Formatting options' })
    const editor = contentPane.getByRole('textbox', { name: 'Instructions' })
    const close = dialog.getByRole('button', { name: 'Close assignment edit prototype' })

    const modalFrame = (await dialog.boundingBox())!, xBounds = (await close.boundingBox())!
    if (testInfo.project.metadata.viewport === 'desktop') {
      const modeBounds = (await contentPane.getByRole('group', { name: 'Instructions editing mode' }).boundingBox())!
      expect(Math.abs(xBounds.y + xBounds.height / 2 - modeBounds.y - modeBounds.height / 2)).toBeLessThanOrEqual(2)
      const contextBounds = (await dialog.locator('.modal-context-row').boundingBox())!
      expect(Math.abs(contextBounds.y + contextBounds.height / 2 - modeBounds.y - modeBounds.height / 2)).toBeLessThanOrEqual(2)
      expect(modeBounds.x + modeBounds.width).toBeLessThanOrEqual(xBounds.x - 4)
    } else {
      const classroomBounds = (await dialog.locator('.modal-context-row [title]').boundingBox())!
      expect(classroomBounds.x + classroomBounds.width).toBeLessThanOrEqual(xBounds.x)
    }
    expect(xBounds.y - modalFrame.y).toBeLessThanOrEqual(17)
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Field observations')
    await expect(contentPane.locator('[role="status"][aria-live="polite"]')).toHaveText('Saved')
    await expect(close).toBeVisible()
    const contextHeaderBounds = (await dialog.locator('.modal-context-row').boundingBox())!
    expect(Math.abs((await detailsPane.boundingBox())!.y - contextHeaderBounds.y - contextHeaderBounds.height)).toBeLessThanOrEqual(1)
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
      expect(contentBounds.x).toBeGreaterThanOrEqual(detailsBounds.x + detailsBounds.width - 1)
      const contextBounds = (await dialog.locator('.modal-context-row').boundingBox())!
      expect(Math.abs(contentBounds.y - contextBounds.y)).toBeLessThanOrEqual(1)
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
    await expectEditorContext(dialog, 'Test', testInfo)
    const detailsPane = dialog.getByTestId('test-editor-details-pane')
    const contentPane = dialog.getByTestId('test-editor-content-pane')
    const actionbar = contentPane.getByTestId('test-question-actionbar')
    const questionNavigation = contentPane.getByRole('group', { name: 'Question navigation' })
    const toolbar = contentPane.getByRole('toolbar', { name: 'Formatting options' })
    const editor = contentPane.getByRole('textbox', { name: 'Question 1 prompt' })
    const close = dialog.getByRole('button', { name: 'Close test edit prototype' })
    const status = contentPane.getByRole('status')

    await expect(close).toBeVisible()
    await expect(status).toHaveText('Saved')
    const detailsTop = (await detailsPane.boundingBox())!.y
    const closeBounds = (await close.boundingBox())!
    expect(detailsTop - (await dialog.boundingBox())!.y).toBeLessThanOrEqual(2)
    const settingsBounds = (await detailsPane.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!
    expect(closeBounds.y + closeBounds.height <= settingsBounds.y || closeBounds.x >= settingsBounds.x + settingsBounds.width || settingsBounds.x >= closeBounds.x + closeBounds.width).toBe(true)

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
    await expect(references.getByRole('button', { name: 'Edit Wetland field notes' })).toBeVisible()
    const addReference = references.getByRole('button', { name: 'Add reference' })
    await addReference.click()
    await expect(page.getByRole('menuitem', { name: 'Link' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'PDF' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Text' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Link' }).click()
    await expect(references.getByRole('textbox', { name: 'link reference label' })).toHaveValue('Link reference 2')
    await expect(references.getByRole('button', { name: 'Remove Link reference 2' })).toBeVisible()
    const referenceHandle = references.getByRole('button', { name: /Reorder Wetland field notes/ })
    await referenceHandle.focus()
    await referenceHandle.press('ArrowDown')
    await expect(references.locator('[draggable]').first().getByRole('textbox', { name: 'link reference label' })).toBeVisible()
    await expect(referenceHandle).toBeFocused()
    await referenceHandle.press('ArrowUp')
    await expect(references.locator('[draggable]').first().getByRole('button', { name: 'Edit Wetland field notes' })).toBeVisible()
    await addReference.click()
    await page.getByRole('menuitem', { name: 'PDF' }).click()
    await expect(references.getByText('Link and PDF rows are placeholders in Pattern Lab; they appear in Preview only after attachment in Pika.')).toBeVisible()
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
    const optionHandle = contentPane.getByRole('button', { name: /Reorder option A/ })
    await optionHandle.focus()
    await optionHandle.press('ArrowDown')
    await expect(contentPane.getByRole('textbox', { name: 'Question 1 option A' })).toHaveValue('The water is deeper near the boardwalk.')
    await expect(contentPane.getByRole('button', { name: /Reorder option B/ })).toBeFocused()
    await contentPane.getByRole('button', { name: /Reorder option B/ }).press('ArrowUp')
    await expect(contentPane.getByRole('textbox', { name: 'Question 1 option A' })).toHaveValue('Several native species use the same habitat.')
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
      const contextBounds = (await detailsPane.locator('.modal-context-row').boundingBox())!
      expect(contextBounds.y).toBeGreaterThanOrEqual((await dialog.boundingBox())!.y)
      const classroomBounds = (await detailsPane.locator('.modal-context-row [title]').boundingBox())!
      expect(classroomBounds.x + classroomBounds.width).toBeLessThanOrEqual((await close.boundingBox())!.x - 4)
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
    await studentPreview.getByRole('button', { name: 'Wetland field notes' }).click()
    await expect(studentPreview.getByRole('heading', { name: 'Field notes', exact: true })).toBeVisible()
    await expect(studentPreview.getByText('Count native species')).toBeVisible()
    await expect(studentPreview.getByRole('button', { name: 'Link reference 2' })).toHaveCount(0)
    await expect(studentPreview.getByRole('button', { name: 'PDF reference 3' })).toHaveCount(0)
    await testInfo.attach('test-edit-full-preview-prototype', {
      body: await page.screenshot({ path: testInfo.outputPath('test-edit-full-preview-prototype.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await studentPreview.getByRole('button', { name: 'Close Preview' }).click()
    await expect(preview).toBeFocused()
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)

    // Closing the full preview remounts the editor. Clear through normal editing
    // keys so TipTap processes the deletion before checking parent validation.
    await expect(editor).toContainText('Updated wetland question.')
    await editor.click()
    await editor.press('ControlOrMeta+A')
    await editor.press('Backspace')
    await expect(editor).toHaveText('')
    await expect(detailsPane.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    await expect(detailsPane.getByText('Check question 1.')).toBeVisible()
    await questionNumber.fill('2')
    await questionNumber.press('Enter')
    await expect(questionNumber).toHaveValue('2')
    await expect(detailsPane.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    await expect(detailsPane.getByText('Check question 1.')).toBeVisible()
    await questionNumber.fill('1')
    await questionNumber.press('Enter')
    await editor.fill('Updated wetland question.')
    await expect(detailsPane.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()

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
    await editDialog.getByRole('textbox', { name: 'Document text' }).fill('## Field notes\n### Document 2\n- Count native species\n- Record water temperature')
    await editDialog.getByRole('button', { name: 'Cancel' }).click()
    await editReference.click()
    await expect(editDialog.getByRole('textbox', { name: 'Document text' })).toContainText('Record water depth')
    await editDialog.getByRole('textbox', { name: 'Document text' }).fill('## Field notes\n### Document 2\n- Count native species\n- Record water temperature')
    await editDialog.getByRole('button', { name: 'Save' }).click()
    await expect(editReference).toContainText('Record water temperature')
    await testInfo.attach('test-text-reference-list', {
      body: await testDialog.screenshot({ path: testInfo.outputPath('test-text-reference-list.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await details.getByRole('button', { name: 'Markdown', exact: true }).click()
    const markdown = testDialog.getByRole('textbox', { name: 'Test markdown editor' })
    await expect(markdown).toContainText('Record water temperature')
    await markdown.fill((await markdown.inputValue()).replace('Title: Wetland field study', 'Title: Wetland field study revised'))
    await testDialog.getByRole('button', { name: 'Apply Markdown' }).click()
    await expect(details.getByRole('textbox', { name: 'Title' })).toHaveValue('Wetland field study revised')
    await details.getByRole('button', { name: 'Markdown', exact: true }).click()
    await details.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByRole('region', { name: 'Teacher test preview' })
    const documentsPane = preview.getByRole('region', { name: 'Test documents' })
    const questionsPane = preview.getByRole('region', { name: 'Test questions' })
    const separator = preview.getByRole('separator', { name: 'Resize documents and questions panes' })
    if (testInfo.project.name.includes('desktop')) {
      await separator.focus()
      await separator.press('ArrowRight')
      await separator.press('ArrowRight')
      await expect(separator).toHaveAttribute('aria-valuenow', '40')
    }
    const bounds = async () => [await documentsPane.boundingBox(), await questionsPane.boundingBox()]
    // Finish any resize animation before comparing actual pane geometry.
    await page.waitForTimeout(350)
    const before = await bounds()
    await testInfo.attach('reference-list', { body: await preview.screenshot(), contentType: 'image/png' })
    await preview.getByRole('button', { name: 'Wetland notes' }).click()
    await page.waitForTimeout(350)
    expect(await bounds()).toEqual(before)

    await expect(preview.getByRole('heading', { name: 'Field notes' })).toBeVisible()
    await expect(preview.getByRole('heading', { name: 'Document 2' })).toBeVisible()
    await expect(preview.getByText('Record water temperature')).toBeVisible()
    await testInfo.attach('test-text-reference-preview', {
      body: await page.screenshot({ path: testInfo.outputPath('test-text-reference-preview.png'), animations: 'disabled' }),
      contentType: 'image/png',
    })
    await preview.getByRole('button', { name: 'Back to documents list' }).click()
    await page.waitForTimeout(350)
    expect(await bounds()).toEqual(before)
    await testInfo.attach('reference-back', { body: await preview.screenshot(), contentType: 'image/png' })
    expect(writes).toEqual([])
  })

  test('releases fullscreen after the Test preview maximize retry', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pattern-lab-desktop-light', 'One fullscreen retry check is sufficient')
    await page.addInitScript(() => {
      const requestFullscreen = Element.prototype.requestFullscreen
      let requests = 0
      Element.prototype.requestFullscreen = function (options?: FullscreenOptions) {
        requests += 1
        if (requests === 1) return Promise.reject(new Error('First request blocked for the prototype test'))
        return requestFullscreen.call(this, options)
      }
    })

    await openPatternLab(page, testInfo, 'teacher')
    await page.getByRole('button', { name: 'Open test edit prototype' }).click()
    const previewButton = page.getByRole('dialog', { name: 'Edit Test' }).getByRole('button', { name: 'Preview', exact: true })
    await previewButton.click()
    const preview = page.getByRole('region', { name: 'Teacher test preview' })
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
    await page.getByRole('button', { name: 'Maximize Window' }).click()
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true)
    await preview.getByRole('button', { name: 'Close Preview' }).click()
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
    await expect(previewButton).toBeFocused()
  })

  test('previews material in assignment-style panes with an explicit draft action', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'teacher')
    const open = page.getByRole('button', { name: 'Open material example' })
    await open.click()
    const dialog = page.getByRole('dialog', { name: 'New Material', exact: true })
    await expectEditorContext(dialog, 'Material', testInfo)
    const preview = dialog.getByRole('button', { name: 'Preview', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'Material details' })).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'Material editor' })).toBeVisible()
    const modes = dialog.getByRole('group', { name: 'Material content editing mode' })
    await expect(modes.getByRole('button', { name: 'Write', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(modes.getByRole('button', { name: 'Markdown', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^(Visual|Apply Markdown|Discard Markdown)$/ })).toHaveCount(0)
    await expect(dialog.locator('[data-toolbar-preset="markdown-authoring"]')).toBeVisible()
    await expect(dialog.getByText('Ungraded classwork')).toHaveCount(0)
    await expect(preview).toHaveText('Preview')
    const control = (await preview.boundingBox())!
    expect(control.width).toBeGreaterThanOrEqual(44)
    expect(control.height).toBeGreaterThanOrEqual(44)
    const close = (await dialog.getByRole('button', { name: 'Close material modal' }).boundingBox())!
    const post = (await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!
    const detailsY = (await dialog.getByRole('region', { name: 'Material details' }).boundingBox())!.y
    expect(close.y + close.height).toBeLessThanOrEqual(post.y)
    await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused()
    await testInfo.attach('material-editor', {
      body: await dialog.screenshot({ path: testInfo.outputPath('material-editor.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await preview.focus()
    await page.keyboard.press('Enter')
    const reading = page.getByRole('dialog', { name: 'Material preview' })
    await expect(reading.getByText('Read the field guide before our next class.')).toBeVisible()
    await testInfo.attach('material-preview', {
      body: await reading.screenshot({ path: testInfo.outputPath('material-preview.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(reading).toBeHidden()
    await expect(preview).toBeFocused()
    await dialog.getByRole('textbox', { name: 'Material content', exact: true }).fill(Array.from({ length: 40 }, (_, i) => `Reading note ${i + 1}: record a question for the next discussion.`).join('\n'))
    await expect(preview).toBeVisible()
    // Content focus can scroll the stacked mobile dialog; actions retain their layout position.
    const afterPost = (await dialog.getByRole('button', { name: 'Post', exact: true }).boundingBox())!
    const afterDetailsY = (await dialog.getByRole('region', { name: 'Material details' }).boundingBox())!.y
    expect(afterPost.y - afterDetailsY).toBe(post.y - detailsY)
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

  test('changes a posted material calendar date on explicit Save', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'teacher')
    await page.getByRole('button', { name: 'Edit posted material example' }).click()
    const dialog = page.getByRole('dialog', { name: 'Material', exact: true })
    const date = dialog.getByLabel('Calendar date (Toronto)')
    await expect(date).toHaveValue('2026-01-22')
    await date.fill('2026-01-21')
    await date.focus()
    const box = (await date.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await testInfo.attach('material-post-date', {
      body: await dialog.screenshot({ path: testInfo.outputPath('material-post-date.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await date.fill('')
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect(dialog.getByText('Choose a valid date.')).toBeVisible()
    await testInfo.attach('material-post-date-validation', {
      body: await dialog.screenshot({ path: testInfo.outputPath('material-post-date-validation.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await date.fill('2026-01-21')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('#material-creation').getByRole('status')).toHaveText('Post date 2026-01-21 selected. Example only—nothing was saved or posted.')
    await page.getByRole('button', { name: 'Edit posted material example' }).click()
    await date.fill('2099-01-01')
    await date.focus()
    await expect(dialog.getByText(/Post makes it available now; Schedule delays release/)).toBeVisible()
    await testInfo.attach('material-future-post-date', {
      body: await dialog.screenshot({ path: testInfo.outputPath('material-future-post-date.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('#material-creation').getByRole('status')).toHaveText('Post date 2099-01-01 selected. Example only—nothing was saved or posted.')
    await page.getByRole('button', { name: 'Open material example', exact: true }).click()
    const newDialog = page.getByRole('dialog', { name: 'New Material', exact: true })
    await expect(newDialog.getByLabel('Calendar date (Toronto)')).toBeVisible()
    await expect(newDialog.getByRole('button', { name: 'Post', exact: true })).toBeVisible()
    await newDialog.screenshot({ path: testInfo.outputPath('material-new-calendar-date.png'), animations: 'disabled' })
    await newDialog.getByRole('button', { name: 'Close material modal' }).click()
    await mockTableShellReads(page, 'teacher')
    const scheduledMaterial = { id: '30000000-0000-4000-8000-000000000054', classroom_id: TABLE_CLASSROOM_ID,
      title: 'Scheduled reading', content: { type: 'doc', content: [] }, is_draft: false,
      released_at: '2099-07-10T11:00:00Z', posted_on: '2099-07-12', position: 0,
      created_by: 'teacher', created_at: '2026-01-22T17:00:00Z', updated_at: '2026-01-22T17:00:00Z' }
    await page.route('**/api/teacher/classrooms/*/materials', route => route.fulfill({ json: { materials: [scheduledMaterial] } }))
    await page.goto(`/e2e-fixtures/teacher-student-tables?role=teacher&tab=assignments&materialId=${scheduledMaterial.id}`)
    await expect(dialog.getByLabel('Calendar date (Toronto)')).toHaveValue('2099-07-12')
    await expect(dialog.getByText(/Scheduled for/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await dialog.screenshot({ path: testInfo.outputPath('material-scheduled-calendar-date.png'), animations: 'disabled' })
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

    const workspace = examples.getByTestId('attached-shell-example')
    await workspace.getByRole('tab', { name: 'Overview', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(workspace.getByRole('tab', { name: 'Work details' })).toBeFocused()
    await expect(workspace.getByRole('tabpanel', { name: 'Work details' })).toBeVisible()
    await testInfo.attach('teacher-family-future-and-selected', {
      body: await examples.screenshot({ path: testInfo.outputPath('teacher-family-future-and-selected.png'), animations: 'disabled' }), contentType: 'image/png',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })

  test('keeps artifact help after first keyboard focus reveals the table cell', async ({ page }, testInfo) => {
    await openPatternLab(page, testInfo, 'teacher')
    const example = page.locator('#ui-consistency')
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion })
      for (const row of ['One', 'Two'] as const) {
        const before = example.getByRole('checkbox', { name: `Select Example ${row}`, exact: true })
        const trigger = row === 'One'
          ? example.getByRole('button', { name: /^View work items; required submission artifact 1 is Demo/ })
          : example.getByRole('link', { name: /^Open required submission artifact 1: Demo/ })
        await before.scrollIntoViewIfNeeded()
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await before.press('Tab')
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await expect(trigger).toBeFocused()
        await expect(trigger).toHaveAttribute('aria-describedby', /.+/)
        await expect(page.getByRole('tooltip')).toContainText('example.invalid/demo')
        if (row === 'One') await testInfo.attach(`artifact-first-focus-${reducedMotion}`, {
          body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
        })

        if (row === 'One' && testInfo.project.metadata.viewport === 'mobile') {
          const scroll = await trigger.evaluate(element => {
            for (let owner = element.parentElement; owner; owner = owner.parentElement) {
              if (owner.scrollWidth > owner.clientWidth && getComputedStyle(owner).overflowX === 'auto') {
                owner.setAttribute('data-artifact-focus-scroller', '')
                return { left: owner.scrollLeft, x: owner.getBoundingClientRect().x, y: owner.getBoundingClientRect().y }
              }
            }
            throw new Error('Missing mobile table scroller')
          })
          expect(scroll.left).toBeGreaterThan(0)
          await page.mouse.move(scroll.x + 12, scroll.y + 12)
          await page.mouse.wheel(-60, 0)
          await expect.poll(() => page.locator('[data-artifact-focus-scroller]').evaluate(owner => owner.scrollLeft)).not.toBe(scroll.left)
        } else {
          await page.keyboard.press('Escape')
        }
        await expect(trigger).not.toHaveAttribute('aria-describedby')
        await expect(page.getByRole('tooltip')).toHaveCount(0)
      }
    }
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


test('changes a published announcement post date on explicit Save', async ({ page }, testInfo) => {
  await openPatternLab(page, testInfo, 'teacher')
  await page.getByRole('button', { name: 'Edit posted material example' }).click()
  await page.getByLabel('Calendar date (Toronto)').focus()
  await page.getByRole('dialog', { name: 'Material', exact: true }).screenshot({ path: testInfo.outputPath('material-reference.png') })

  await mockTableShellReads(page, 'teacher')
  let announcement: { id: string; classroom_id: string; title: string; content: string; created_by: string; is_draft: boolean;
    published_at: string | null; scheduled_for: string | null; created_at: string; updated_at: string; posted_on?: string | null } = { id: '30000000-0000-4000-8000-000000000041', classroom_id: TABLE_CLASSROOM_ID,
    title: 'Calendar date update', content: 'A published announcement with an editable post date.',
    created_by: '30000000-0000-4000-8000-000000000012', is_draft: false,
    published_at: '2026-01-22T17:00:00Z', scheduled_for: null,
    created_at: '2026-01-22T17:00:00Z', updated_at: '2026-01-22T17:00:00Z' }
  const patches: unknown[] = []
  await page.route('**/api/teacher/classrooms/*/announcements', route => route.fulfill({ json: { announcements: [announcement] } }))
  const mockAnnouncementPatch = () => page.route('**/api/teacher/classrooms/*/announcements/*', async route => {
    const patch = route.request().postDataJSON()
    patches.push(patch)
    announcement = { ...announcement, posted_on: patch.posted_on ?? announcement.posted_on }
    await route.fulfill({ json: { announcement } })
  })
  await mockAnnouncementPatch()
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=announcements')
  await page.getByText(announcement.title, { exact: true }).click()
  const date = page.getByLabel('Calendar date (Toronto)', { exact: true })
  await expect(date).toHaveValue('2026-01-22')
  await date.fill('2026-01-21')
  await date.focus()
  expect(patches).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('teacher-post-date-focused.png') })
  await date.fill('')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(page.getByText('Choose a valid date.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('teacher-post-date-invalid.png') })
  await date.fill('2026-01-21')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(date).toHaveCount(0)
  expect(patches).toEqual([{ posted_on: '2026-01-21' }])
  await expect(page.getByText(/Thu Jan 22/)).toBeVisible()

  await mockTableShellReads(page, 'student')
  await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/student/classrooms/*/announcements', route => route.fulfill({ json: route.request().method() === 'GET'
    ? { announcements: [announcement] } : { success: true, marked: 1 } }))
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=announcements')
  await expect(page.getByText(announcement.title, { exact: true })).toBeVisible()
  await expect(page.getByText(/Thu Jan 22/)).toBeVisible()
  await expect(page.getByLabel('Calendar date (Toronto)', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('student-backdated-announcement.png') })

  await mockTableShellReads(page, 'teacher')
  await page.route('**/api/teacher/classrooms/*/announcements', route => route.fulfill({ json: { announcements: [announcement] } }))
  await mockAnnouncementPatch()
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=announcements')
  await page.getByText(announcement.title, { exact: true }).click()
  await date.fill('2099-01-01')
  await date.focus()
  await expect(page.getByText(/Post makes it available now; Schedule delays release/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('teacher-future-post-date.png') })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(date).toHaveCount(0)
  expect(patches).toEqual([{ posted_on: '2026-01-21' }, { posted_on: '2099-01-01' }])
  expect(announcement.published_at).toBe('2026-01-22T17:00:00Z')
  expect(announcement.scheduled_for).toBeNull()
  await expect(page.getByText(/Scheduled for/)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('teacher-future-announcement-saved.png') })

  await mockTableShellReads(page, 'student')
  await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
  await page.route('**/api/student/classrooms/*/announcements', route => route.fulfill({ json: route.request().method() === 'GET' ? { announcements: [announcement] } : { success: true, marked: 1 } }))
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=announcements')
  await expect(page.getByText(announcement.title, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('student-future-calendar-announcement-visible.png') })

  await mockTableShellReads(page, 'teacher')
  await page.route('**/api/teacher/classrooms/*/announcements', route => route.fulfill({ json: { announcements: [announcement] } }))
  await page.goto('/e2e-fixtures/teacher-student-tables?role=teacher&tab=announcements')
  await page.getByRole('button', { name: 'Create announcement', exact: true }).click()
  await expect(page.getByLabel('Calendar date (Toronto)')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('announcement-new-calendar-date.png'), animations: 'disabled' })
  for (const state of ['draft', 'scheduled'] as const) {
    announcement = { ...announcement, is_draft: state === 'draft',
      published_at: state === 'draft' ? null : '2099-07-10T11:00:00Z',
      scheduled_for: state === 'draft' ? null : '2099-07-10T11:00:00Z' }
    await page.reload()
    await page.getByText(announcement.title, { exact: true }).click()
    await expect(page.getByLabel('Calendar date (Toronto)')).toHaveValue('2099-01-01')
    if (state === 'scheduled') await expect(page.getByRole('button', { name: /Releases/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`announcement-${state}-calendar-date.png`), animations: 'disabled' })
  }
})

test('student calendar distinguishes future placement, release and advance visibility', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-20T16:00:00Z') })
  await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme === 'dark' ? 'dark' : 'light')
  await mockTableShellReads(page, 'student')
  const stamp = '2026-10-19T16:00:00Z'
  let maxDate: string | null = '2026-10-24'
  const announcements = [
    { id: 'announcement-within', title: 'Within-window announcement', posted_on: '2026-10-22' },
    { id: 'announcement-beyond', title: 'Beyond-window announcement', posted_on: '2026-10-29' },
  ].map(row => ({ ...row, classroom_id: TABLE_CLASSROOM_ID, content: row.title, is_draft: false,
    created_by: 'teacher', published_at: stamp, scheduled_for: null, created_at: stamp, updated_at: stamp }))
  const materials = [
    { id: 'material-within', title: 'Within-window material', posted_on: '2026-10-22' },
    { id: 'material-beyond', title: 'Beyond-window material', posted_on: '2026-10-29' },
  ].map((row, position) => ({ ...row, classroom_id: TABLE_CLASSROOM_ID, content: { type: 'doc', content: [] },
    is_draft: false, released_at: stamp, position, created_by: 'teacher', created_at: stamp, updated_at: stamp }))
  await page.route('**/api/student/classrooms/*/lesson-plans?**', route => route.fulfill({ json: { lesson_plans: [], max_date: maxDate } }))
  await page.route('**/api/student/classrooms/*/announcements', route => route.fulfill({ json: route.request().method() === 'GET' ? { announcements } : { success: true, marked: 2 } }))
  await page.route('**/api/student/classrooms/*/materials', route => route.fulfill({ json: { materials: [...materials,
    { ...materials[0], id: 'scheduled-material', title: 'Scheduled material', released_at: '2099-01-01T12:00:00Z' }] } }))
  await page.route('**/api/student/classrooms/*/class-days', route => route.fulfill({ json: { class_days: Array.from({ length: 12 }, (_, i) => ({
    id: `day-${i}`, classroom_id: TABLE_CLASSROOM_ID, date: `2026-10-${19 + i}`, is_class_day: true,
  })) } }))
  await page.goto('/e2e-fixtures/teacher-student-tables?role=student&tab=calendar')
  const within = page.getByRole('button', { name: /Within-window material/ }).first()
  await expect(within).toBeVisible()
  await expect(page.getByRole('button', { name: /Within-window announcement/ }).first()).toBeVisible()
  for (const view of ['Week', 'Month', 'All']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await expect(within).toBeVisible()
    await expect(page.getByText('Beyond-window material', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Beyond-window announcement', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Scheduled material', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`student-${view.toLowerCase()}-calendar-window.png`), animations: 'disabled' })
  }
  maxDate = null
  await page.reload()
  await expect(page.getByRole('button', { name: /Beyond-window material/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Beyond-window announcement/ }).first()).toBeVisible()
  await expect(page.getByText('Scheduled material', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('student-unrestricted-future-calendar.png'), animations: 'disabled' })
})
