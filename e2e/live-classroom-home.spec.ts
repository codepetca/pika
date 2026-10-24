import { test, expect } from '@playwright/test'

// Synthetic inputs exercise the production UI owner. Native SQL and API tests
// separately establish persistence and authorization; this spec must not claim it.
for (const role of ['teacher', 'student'] as const) {
  test(`${role} capability wizard source choice`, async ({ page }, testInfo) => {
    await page.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
      const user = { id: '11111111-1111-4111-8111-111111111111', role, email: `${role}@example.invalid` }
      return route.fulfill({ json: new URL(route.request().url()).pathname === '/api/auth/me' ? { user } : { blueprints: [] } })
    })
    await page.addInitScript(value => localStorage.setItem('theme', value), testInfo.project.metadata.theme as string)
    await page.goto(`/e2e-fixtures/classroom-home?role=${role}`)
    await page.getByRole('button', { name: 'Classroom actions' }).click()
    await page.getByRole('menuitem', { name: 'New Classroom' }).click()
    await page.getByRole('textbox', { name: 'Classroom Name' }).fill('New classroom')
    await page.getByRole('button', { name: 'Choose classroom creation path' }).click()
    await page.getByRole('menuitem', { name: 'From Course Blueprint' }).click()
    await expect(page.getByRole('combobox', { name: 'Course Blueprint' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Import course package...' })).toHaveCount(role === 'teacher' ? 1 : 0)
    await testInfo.attach(`${role}-blueprint-source`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
  })
  test(`${role} live home composition`, async ({ page }, testInfo) => {
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
      if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: '11111111-1111-4111-8111-111111111111', role, email: `${role}@example.invalid` } } })
      if (path === '/api/teacher/classrooms') return route.fulfill({ json: { classrooms: [], cold_archives: [] } })
      if (path === '/api/teacher/course-blueprints') return route.fulfill({ json: { blueprints: [] } })
      return route.fulfill({ json: {} })
    })
    const theme = testInfo.project.metadata.theme as string
    await page.addInitScript(value => localStorage.setItem('theme', value), theme)
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await testInfo.attach(`${role}-${name}`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    }
    const open = async (query = '') => page.goto(`/e2e-fixtures/classroom-home?role=${role}${query}`)
    await open()
    await expect(page.getByRole('region', { name: 'Teaching classrooms' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Joined classrooms' })).toBeVisible()
    await capture('active')
    const menu = page.getByRole('button', { name: 'Classroom actions' })
    await menu.click()
    await expect(page.getByRole('menuitem', { name: 'New Classroom' })).toBeFocused()
    await capture('menu')
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
    await menu.click()
    await page.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).click()
    await expect(page.getByRole('button', { name: 'Hide ICS4U — Computer Science' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Joined classrooms' }).getByRole('button', { name: /^Archive/ })).toHaveCount(0)
    await capture('editing')
    await page.getByRole('button', { name: 'Back to classrooms' }).click()
    await menu.click()
    await page.getByRole('menuitem', { name: 'New Classroom' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await capture('create')
    await page.keyboard.press('Escape')
    await open('&state=hidden')
    await menu.click()
    await page.getByRole('menuitem', { name: 'Show Archived' }).click()
    await expect(page.getByRole('region', { name: 'Hidden classrooms' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unhide ICS4U — Computer Science' })).toBeVisible()
    await capture('archived-hidden')
    await open('&state=empty&creation=disabled')
    await expect(page.getByRole('button', { name: 'Join classroom' })).toBeVisible()
    await capture('empty-free')
    await menu.click()
    await expect(page.getByRole('menuitem', { name: 'New Classroom' })).toHaveCount(0)
    await open('&state=error')
    await expect(page.getByRole('region', { name: 'Classrooms' }).getByRole('alert')).toBeVisible()
    await capture('read-error')
  })
}
