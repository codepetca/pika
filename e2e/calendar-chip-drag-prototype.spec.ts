import { expect, test } from '@playwright/test'

test('teacher can evaluate calendar chip movement without live writes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.metadata.viewport !== 'desktop' || testInfo.project.metadata.theme !== 'light')
  const writes: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(request.url())
    }
  })

  await page.goto('/pattern-lab?role=teacher', { waitUntil: 'networkidle' })
  if (page.url().includes('/login')) {
    await page.getByRole('button', { name: 'Teacher', exact: true }).click()
    await page.getByRole('button', { name: 'Login', exact: true }).click()
    await page.waitForURL(/\/pattern-lab/)
  }
  await page.getByRole('combobox', { name: 'Find a pattern' }).selectOption('mockup-calendar-panel')
  const prototype = page.getByTestId('calendar-chip-drag-prototype')
  writes.length = 0

  const fieldNotes = prototype.getByRole('button', { name: 'Move Assignment Field notes' })
  await fieldNotes.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(100)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  await page.keyboard.press('Space')
  await expect(prototype.getByRole('group', { name: 'Thursday, September 17, 2026' })).toContainText('Field notes')
  await expect(prototype.getByTestId('calendar-prototype-save-status')).toHaveText('Saved')

  const labGroups = prototype.getByRole('button', { name: 'Move Announcement Lab groups' })
  await labGroups.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(100)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  await expect(prototype.getByRole('group', { name: 'Tuesday, September 15, 2026' })).toContainText('Lab groups')

  await prototype.getByRole('button', { name: 'Fail next move' }).click()
  await labGroups.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(100)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(100)
  await page.keyboard.press('Space')
  await expect(prototype.getByTestId('calendar-prototype-save-status')).toHaveText('Saving…')
  await expect(fieldNotes).toBeDisabled()
  await expect(prototype.getByTestId('calendar-prototype-save-status')).toHaveText('Move failed — restored')
  await expect(prototype.getByRole('group', { name: 'Tuesday, September 15, 2026' })).toContainText('Lab groups')

  const locked = prototype.getByRole('button', { name: /Trip reminder, locked: Published announcements/ })
  await locked.focus()
  await expect(locked).toBeFocused()
  await expect(page.getByRole('tooltip')).toContainText('Published announcements keep their original posted date')

  const reflection = prototype.getByRole('button', { name: 'Move Assignment Lab reflection' })
  const saturday = prototype.getByRole('group', { name: 'Saturday, September 19, 2026' })
  const sourceBox = (await reflection.boundingBox())!
  const targetBox = (await saturday.boundingBox())!
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(saturday).toContainText('Lab reflection')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(prototype).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(writes).toEqual([])
})
