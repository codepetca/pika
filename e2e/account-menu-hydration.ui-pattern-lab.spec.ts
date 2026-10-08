import { expect, test } from '@playwright/test'
import { mockTableShellReads } from './helpers/teacher-student-tables'

for (const role of ['teacher', 'student'] as const) {
  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`${role} account menu attaches unique hydrated relationships and keyboard focus (${motion})`, async ({ page }, info) => {
      await page.addInitScript(theme => localStorage.setItem('theme', theme), info.project.metadata.theme as string)
      await page.emulateMedia({ reducedMotion: motion })
      await mockTableShellReads(page, role)
      await page.route('**/api/student/classrooms/*/gradebook-items', route => route.fulfill({ json: { items: [] } }))
      const errors: string[] = []
      const consoleErrors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      const response = await page.goto(`/e2e-fixtures/teacher-student-tables?role=${role}&tab=assignments`, { waitUntil: 'networkidle' })
      expect(response?.status()).toBe(200)
      const serverId = (await response!.text()).match(/<button[^>]*id="([^"]+)"[^>]*aria-label="User menu"/)?.[1]
      expect(serverId).toBeUndefined()
      const trigger = page.getByRole('button', { name: 'User menu', exact: true })
      await expect(trigger).toHaveAttribute('id', /.+-trigger$/)
      const triggerId = await trigger.getAttribute('id')
      const menuId = await trigger.getAttribute('aria-controls')
      await expect(page.locator(`[id="${menuId}"]`)).toHaveAttribute('aria-labelledby', triggerId!)
      await expect(page.getByRole('menu')).toHaveCount(0)
      await trigger.focus()
      await page.keyboard.press('ArrowDown')
      const menu = page.getByRole('menu')
      await expect(menu).toBeVisible()
      await expect(menu.getByRole('menuitem').first()).toBeFocused()
      await expect(menu).toHaveCSS('opacity', '1')
      await page.screenshot({ path: info.outputPath('account-menu-open.png') })
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
      await expect(trigger).toHaveAttribute('id', triggerId!)
      await expect(page.getByRole('menu')).toHaveCount(0)
      expect(await page.locator('[id]').evaluateAll(nodes => new Set(nodes.map(node => node.id)).size === nodes.length)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      expect(errors).toEqual([])
      expect(consoleErrors).toEqual([])
    })
  }
}
