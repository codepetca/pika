import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

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
  // Read the approved literal helper shape from the tracked candidate source.
  const source = ts.createSourceFile('page.tsx', readFileSync('src/app/join/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const helpers: string[] = []
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'p' &&
        node.openingElement.attributes.getText(source).includes('text-text-muted')) {
      expect(node.children).toHaveLength(1)
      expect(ts.isJsxText(node.children[0])).toBe(true)
      helpers.push(node.children[0].getText(source).replace(/\s+/g, ' ').trim())
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(helpers).toHaveLength(1)
  expect(helpers[0].length).toBeGreaterThan(0)
  await expect(helper).toHaveText(helpers[0])

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

})
