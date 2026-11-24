import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test('join helper copy is visible and contained', async ({ page }, testInfo) => {
  await page.route('**/api/**', async route => {
    await route.abort()
    throw new Error(`Unexpected API request: ${route.request().method()} ${route.request().url()}`)
  })
  expect((await page.goto('/join', { waitUntil: 'networkidle' }))?.status()).toBe(200)
  await page.evaluate(() => document.fonts.ready)
  expect(await page.locator('html').evaluate(element => element.classList.contains('dark')))
    .toBe(testInfo.project.metadata.theme === 'dark')
  const heading = page.getByRole('heading', { level: 1, name: 'Join a classroom', exact: true })
  const helper = heading.locator('xpath=following-sibling::p[1]')
  await expect(helper).toHaveCount(1)
  await expect(helper).toBeVisible()
  const expected = process.env.PIKA_APPEARANCE_JOIN_COPY
  if (expected !== undefined) await expect(helper).toHaveText(expected)
  else expect((await helper.innerText()).trim().length).toBeGreaterThan(0)

  // Measure the rendered text and every clipping ancestor, as well as document overflow.
  const measure = () => helper.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const text = range.getBoundingClientRect()
    let contained = text.width > 0 && text.height > 0
    for (let current: Element | null = element; current; current = current.parentElement) {
      const box = current.getBoundingClientRect()
      const style = getComputedStyle(current)
      if (current === element || ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) {
        contained &&= text.left >= box.left - 1 && text.right <= box.right + 1
      }
      if (current === element || ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) {
        contained &&= text.top >= box.top - 1 && text.bottom <= box.bottom + 1
      }
    }
    return { contained, noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth }
  })
  expect(await measure()).toEqual({ contained: true, noPageOverflow: true })
  await page.screenshot({ path: testInfo.outputPath('join-copy.png'), animations: 'disabled' })

  // Prove that the same measurement rejects clipped copy after capturing the real page.
  await helper.evaluate(element => {
    element.style.height = '1px'
    element.style.overflow = 'hidden'
  })
  expect((await measure()).contained).toBe(false)
})
