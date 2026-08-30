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

test.describe('teacher Pattern Lab', () => {
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
