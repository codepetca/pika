import fs from 'fs'
import path from 'path'
import { expect } from '@playwright/test'
import type { VerificationScript } from './types'

export const patternLabGradebook: VerificationScript = {
  name: 'pattern-lab-gradebook',
  description: 'Verify Gradebook prototype weights, category editing, keyboard drag, and mobile actions',
  role: 'teacher',
  async run(page, baseUrl) {
    const artifacts: string[] = []
    const artifactDir = path.join(process.cwd(), 'output/playwright/gradebook-editors')
    fs.mkdirSync(artifactDir, { recursive: true })
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    await page.goto(`${baseUrl}/pattern-lab?role=teacher#page-mockups`)
    const section = page.locator('#page-mockups')
    await section.getByRole('tab', { name: 'Gradebook' }).click()
    await page.getByRole('navigation', { name: 'Pattern Lab sections' }).evaluate((element) => { element.style.position = 'static' })
    const capture = async (name: string, dialog = false) => {
      const file = path.join(artifactDir, `${name}.png`)
      if (dialog) await page.screenshot({ path: file })
      else await section.screenshot({ path: file })
      artifacts.push(file)
    }
    const setTheme = async (theme: 'light' | 'dark') => {
      const button = page.getByRole('button', { name: `Use ${theme} theme` })
      if (await button.isVisible()) await button.click()
      await page.waitForTimeout(400)
    }

    await section.getByRole('button', { name: 'Show weights' }).click()
    const weight = section.getByRole('spinbutton', { name: 'Category weight for Ecosystems' })
    const courseWeight = section.getByLabel('Course weight for Ecosystems')
    await expect(courseWeight).toHaveText('5.42%')
    for (const invalid of ['0', '-3', '1000', '2.5', '']) {
      await weight.fill(invalid)
      await expect(weight).toHaveAttribute('aria-invalid', 'true')
      await expect(courseWeight).toHaveText('5.42%')
      await weight.blur()
      await expect(weight).toHaveValue('10')
    }
    await weight.fill('20')
    await weight.blur()
    await expect(courseWeight).toHaveText('10%')
    await weight.fill('10')
    await weight.blur()

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(theme)
      for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
        await page.setViewportSize(viewport)
        await capture(`${size}-${theme}-weights`)
        const frame = section.getByTestId('gradebook-scroll-frame')
        await frame.evaluate((element) => { element.scrollLeft = 180; element.scrollTop = 20 })
        await capture(`${size}-${theme}-weights-scrolled`)
        await frame.evaluate((element) => { element.scrollLeft = 0; element.scrollTop = 0 })
        await section.getByRole('checkbox', { name: 'Select Maya Chen' }).check()
        const trigger = section.getByRole('button', { name: '1 selected' })
        await trigger.click()
        const menu = section.getByRole('menu', { name: 'Student actions' })
        await expect(menu.getByRole('menuitem', { name: 'Copy emails', exact: true })).toBeVisible()
        await expect(menu.getByRole('menuitem', { name: 'Copy secondary emails' })).toBeVisible()
        const menuIsUnclipped = await menu.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return rect.x >= 0 && rect.right <= window.innerWidth && element.contains(hit)
        })
        await capture(`${size}-${theme}-selection-menu`)
        expect(menuIsUnclipped, `${size} ${theme} selection menu must be inside the viewport and unobscured`).toBe(true)
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
        await section.getByRole('checkbox', { name: 'Select Maya Chen' }).uncheck()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
          message: `${size} ${theme} page stays contained after closing Student actions`,
        }).toBe(true)
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await setTheme('light')
    await section.getByRole('combobox', { name: 'Example state' }).selectOption('empty-categories')
    const categories = page.getByRole('dialog', { name: 'Edit categories' })
    await expect(categories.getByRole('button', { name: 'Save categories' })).toBeDisabled()
    await expect(categories.getByRole('textbox')).toHaveCount(0)
    await capture('desktop-light-empty-categories', true)
    for (const [index, name] of ['Term', 'Final', 'Attendance'].entries()) {
      await categories.getByRole('button', { name: 'Add category' }).click()
      await categories.getByRole('textbox', { name: `Category name for Category ${index + 1}` }).fill(name)
    }
    await categories.getByRole('spinbutton', { name: 'Course percentage for Final' }).fill('25')
    await categories.getByRole('spinbutton', { name: 'Course percentage for Attendance' }).fill('10')
    await expect(categories.getByRole('spinbutton', { name: 'Course percentage for Term' })).toHaveValue('65')
    const handle = categories.getByRole('button', { name: 'Drag to reorder Attendance' })
    await handle.focus()
    await page.keyboard.press('Space')
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    // DnD Kit attaches its document keyboard listener on the next timer tick.
    await page.waitForTimeout(50)
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => handle.locator('xpath=ancestor::tr').evaluate((row) => new DOMMatrix(getComputedStyle(row).transform).m42)).toBeLessThan(0)
    await page.keyboard.press('Space')
    await expect(handle).not.toHaveAttribute('aria-pressed', 'true')
    await expect(categories.getByRole('textbox')).toHaveCount(3)
    expect(await categories.getByRole('textbox').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(['Term', 'Attendance', 'Final'])
    await categories.getByRole('button', { name: 'Lock Final course percentage' }).click()
    await expect(categories.getByRole('spinbutton', { name: 'Course percentage for Final' })).toBeDisabled()
    await categories.getByRole('spinbutton', { name: 'Course percentage for Attendance' }).fill('10.5')
    await expect(categories.getByRole('spinbutton', { name: 'Course percentage for Term' })).toHaveValue('64.5')
    await categories.getByRole('spinbutton', { name: 'Course percentage for Attendance' }).fill('10.2')
    await expect(categories.getByRole('button', { name: 'Save categories' })).toBeDisabled()
    await categories.getByRole('spinbutton', { name: 'Course percentage for Attendance' }).blur()
    await expect(categories.getByRole('spinbutton', { name: 'Course percentage for Attendance' })).toHaveValue('10.5')
    for (const theme of ['light', 'dark'] as const) {
      // Theme control is outside the focus-trapped dialog; capture its inherited theme after reopening.
      await capture(`desktop-${theme}-categories-locked`, true)
      await page.setViewportSize({ width: 390, height: 844 })
      await capture(`mobile-${theme}-categories-locked`, true)
      await page.setViewportSize({ width: 1440, height: 900 })
      if (theme === 'light') {
        await categories.getByRole('button', { name: 'Save categories' }).click()
        await setTheme('dark')
        await section.getByRole('button', { name: 'More actions' }).click()
        await section.getByRole('menuitem', { name: 'Edit categories' }).click()
        await categories.getByRole('button', { name: 'Lock Final course percentage' }).click()
      }
    }
    await categories.getByRole('button', { name: 'Delete Attendance' }).click()
    await categories.getByRole('button', { name: 'Save categories' }).click()
    await section.getByRole('button', { name: 'More actions' }).click()
    await section.getByRole('menuitem', { name: 'Edit categories' }).click()
    await categories.getByRole('button', { name: 'Add category' }).click()
    await categories.getByRole('textbox', { name: 'Category name for Category 3' }).fill('Participation')
    await categories.getByRole('button', { name: 'Save categories' }).click()

    await section.getByRole('button', { name: 'Ecosystems', exact: true }).click()
    const assessment = page.getByRole('dialog', { name: 'Edit assessment' })
    await expect(assessment.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue('')
    await assessment.getByRole('spinbutton', { name: 'Category weight' }).fill('20')
    await assessment.getByRole('combobox', { name: 'Category', exact: true }).selectOption({ label: 'Term' })
    await expect(assessment.getByRole('spinbutton', { name: 'Category weight' })).toHaveValue('20')
    await expect(assessment.getByRole('textbox', { name: 'Course weight' })).toHaveAttribute('readonly', '')
    await assessment.getByRole('textbox', { name: 'Assessment title' }).fill('Ecosystems revised')
    await capture('desktop-dark-assessment', true)
    await page.setViewportSize({ width: 390, height: 844 })
    await capture('mobile-dark-assessment', true)
    await assessment.getByRole('button', { name: 'Save assessment' }).click()
    await page.setViewportSize({ width: 1440, height: 900 })
    await setTheme('light')
    await section.getByRole('button', { name: 'Ecosystems revised', exact: true }).click()
    await capture('desktop-light-assessment', true)
    await page.setViewportSize({ width: 390, height: 844 })
    await capture('mobile-light-assessment', true)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 900 })
    await section.getByRole('button', { name: 'More actions' }).click()
    await section.getByRole('menuitem', { name: 'Edit categories' }).click()
    await categories.getByRole('button', { name: 'Delete Term' }).click()
    await categories.getByRole('button', { name: 'Save categories' }).click()
    await section.getByRole('button', { name: 'Ecosystems revised', exact: true }).click()
    await expect(assessment.getByRole('combobox', { name: 'Category', exact: true })).toHaveValue('')
    await expect(assessment.getByRole('textbox', { name: 'Course weight' })).toHaveValue('Not counted')
    await page.keyboard.press('Escape')

    return {
      scenario: 'pattern-lab-gradebook',
      passed: true,
      checks: [
        { name: 'Inline weight validation preserves valid calculations', passed: true },
        { name: 'Mobile selection menus are accessible and unclipped in both themes', passed: true },
        { name: 'Empty setup, half-point balancing, locks, keyboard drag, delete/reopen/add', passed: true },
        { name: 'Assessment title, category, weight, and deleted-category fallback', passed: true },
      ],
      artifacts,
    }
  },
}
