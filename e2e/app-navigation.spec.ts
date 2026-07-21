import { expect, test, type Page } from '@playwright/test'

type RouteCase = {
  path: string
  currentLabel?: 'Blueprints' | 'Calendar'
}

const routes: RouteCase[] = [
  { path: '/teacher/dashboard' },
  { path: '/teacher/blueprints', currentLabel: 'Blueprints' },
  { path: '/teacher/calendar', currentLabel: 'Calendar' },
]

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((nextTheme) => {
    localStorage.setItem('theme', nextTheme)
  }, theme)
}

async function verifyNavigation(page: Page, route: RouteCase) {
  await page.goto(route.path, { waitUntil: 'networkidle' })

  const navigation = page.getByRole('navigation', { name: 'Teacher tools' })
  await expect(navigation).toBeVisible()
  await expect(navigation.getByRole('link')).toHaveCount(3)

  if (route.currentLabel) {
    await expect(navigation.getByRole('link', { name: route.currentLabel })).toHaveAttribute('aria-current', 'page')
  } else {
    await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(0)
  }

  const classrooms = navigation.getByRole('link', { name: 'Classrooms' })
  const target = await classrooms.boundingBox()
  expect(target?.height).toBeGreaterThanOrEqual(44)

  await classrooms.focus()
  await expect(classrooms).toBeFocused()
  const focusedStyle = await classrooms.evaluate((element) => getComputedStyle(element).boxShadow)
  expect(focusedStyle).toContain('inset')

  const main = page.getByRole('main')
  await expect(main).toHaveCSS('padding-left', '16px')
  await expect(main).toHaveCSS('padding-right', '16px')
  await expect(main).toHaveCSS('padding-bottom', '32px')

  const shellHasOverflow = await page.evaluate(() => {
    const mainElement = document.querySelector('main')
    if (!(mainElement instanceof HTMLElement)) return true
    const previousDisplay = mainElement.style.display
    mainElement.style.display = 'none'
    const hasOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth
    mainElement.style.display = previousDisplay
    return hasOverflow
  })
  expect(shellHasOverflow).toBe(false)
}

test.describe('teacher utility application navigation', () => {
  test.use({ storageState: '.auth/teacher.json' })

  for (const route of routes) {
    test(`desktop light ${route.path}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await setTheme(page, 'light')
      await verifyNavigation(page, route)
    })

    test(`mobile dark ${route.path}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await setTheme(page, 'dark')
      await verifyNavigation(page, route)
    })
  }
})
