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

test.describe('student utility application navigation', () => {
  test.use({ storageState: '.auth/student.json' })

  for (const testCase of [
    { name: 'desktop light', viewport: { width: 1440, height: 900 }, theme: 'light' as const },
    { name: 'mobile dark', viewport: { width: 390, height: 844 }, theme: 'dark' as const },
  ]) {
    test(`${testCase.name} /student/history`, async ({ page }) => {
      await page.setViewportSize(testCase.viewport)
      await setTheme(page, testCase.theme)
      await page.goto('/student/history', { waitUntil: 'networkidle' })

      const navigation = page.getByRole('navigation', { name: 'Student tools' })
      await expect(navigation).toBeVisible()
      await expect(navigation.getByRole('link')).toHaveCount(2)
      await expect(navigation.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')

      const header = page.getByRole('banner')
      const home = header.getByRole('link', { name: 'Home' })
      const fullscreen = header.getByRole('button', { name: /fullscreen/i })
      const userMenu = header.getByRole('button', { name: 'User menu' })

      for (const control of [home, fullscreen, userMenu]) {
        const target = await control.boundingBox()
        expect(target?.height).toBeGreaterThanOrEqual(44)
        expect(target?.width).toBeGreaterThanOrEqual(44)
        await control.focus()
        await expect(control).toBeFocused()
      }

      await userMenu.press('Enter')
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      const menuItems = menu.getByRole('menuitem')
      await expect(menuItems).toHaveCount(3)
      for (let index = 0; index < 3; index += 1) {
        expect((await menuItems.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44)
      }
      await expect(menuItems.first()).toBeFocused()
      await menuItems.first().press('Escape')
      await expect(userMenu).toBeFocused()

      const classrooms = navigation.getByRole('link', { name: 'Classrooms' })
      expect((await classrooms.boundingBox())?.height).toBeGreaterThanOrEqual(44)
      await classrooms.focus()
      await expect(classrooms).toBeFocused()
      expect(await classrooms.evaluate((element) => getComputedStyle(element).boxShadow)).toContain('inset')

      const main = page.getByRole('main')
      await expect(main).toHaveCSS('padding-left', '16px')
      await expect(main).toHaveCSS('padding-right', '16px')
      await expect(main).toHaveCSS('padding-top', '32px')
      await expect(main).toHaveCSS('padding-bottom', '32px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    })
  }
})
