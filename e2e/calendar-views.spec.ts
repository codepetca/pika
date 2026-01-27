import { test, expect } from '@playwright/test'

test.use({ storageState: '.auth/teacher.json' })

test('capture calendar views', async ({ page }) => {
  // Go to classrooms
  await page.goto('/classrooms')
  await page.waitForTimeout(1000)

  // Click on first classroom
  await page.click('text=GLD2O Test Class')
  await page.waitForTimeout(1000)

  // Click on Calendar tab
  await page.click('text=Calendar')
  await page.waitForTimeout(1500)

  // Capture week view
  await page.screenshot({ path: '/tmp/calendar-week.png' })

  // Click Month button
  await page.click('button:has-text("month")')
  await page.waitForTimeout(500)
  await page.screenshot({ path: '/tmp/calendar-month.png' })

  // Click All button
  await page.click('button:has-text("all")')
  await page.waitForTimeout(500)
  await page.screenshot({ path: '/tmp/calendar-all.png' })

  // Verify persistence - reload and check view is still "all"
  await page.reload()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/tmp/calendar-all-after-reload.png' })

  // Check that "all" button has the active class
  const allButton = page.locator('button:has-text("all")')
  await expect(allButton).toHaveClass(/font-medium/)
})
