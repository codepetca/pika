import { expect, test } from '@playwright/test'

for (const role of ['teacher', 'student'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`${role} ${reducedMotion} retains server IDs through repeated hydration`, async ({ page }) => {
      const errors: string[] = []
      const writes: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          writes.push(`${request.method()} ${request.url()}`)
        }
      })
      await page.emulateMedia({ reducedMotion })

      for (let navigation = 0; navigation < 3; navigation += 1) {
        const response = await page.goto(`/pattern-lab?role=${role}`, { waitUntil: 'networkidle' })
        expect(response?.status()).toBe(200)
        const html = await response!.text()
        const serverIds = await page.evaluate((markup) => {
          const document = new DOMParser().parseFromString(markup, 'text/html')
          return Array.from(document.querySelectorAll('button[aria-label="User menu"]'))
            .map((trigger) => ({ trigger: trigger.id, menu: trigger.getAttribute('aria-controls') }))
        }, html)
        expect(serverIds).toHaveLength(2)
        expect(new Set(serverIds.map(({ trigger }) => trigger)).size).toBe(2)
        expect(serverIds.every(({ trigger, menu }) => Boolean(trigger && menu))).toBe(true)

        // Exercise a real handler before comparing IDs, so unhydrated HTML alone
        // cannot pass. The server's ARIA relationships must survive activation.
        const trigger = page.getByRole('button', { name: 'User menu', exact: true }).first()
        await trigger.click()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(page.getByRole('menu')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await expect(trigger).toBeFocused()
        const clientIds = await page.locator('button[aria-label="User menu"]').evaluateAll((triggers) => (
          triggers.map((trigger) => ({ trigger: trigger.id, menu: trigger.getAttribute('aria-controls') }))
        ))
        expect(clientIds).toEqual(serverIds)
        expect(await page.locator('button[aria-label="User menu"]').evaluateAll((triggers) => (
          triggers.every((trigger) => {
            const menuId = trigger.getAttribute('aria-controls')
            const menu = menuId ? document.getElementById(menuId) : null
            return menu?.getAttribute('aria-labelledby') === trigger.id
          })
        ))).toBe(true)
        expect(errors, 'Hydration and browser errors').toEqual([])
        expect(writes, 'Pattern Lab must not send write requests').toEqual([])
      }
    })
  }
}
