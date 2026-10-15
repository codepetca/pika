import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import type { VerificationScript } from './types'

/** Deterministic production toolbar, table, inspector and student list owners. */
export const gradebookZeroWeightFilters: VerificationScript = {
  name: 'gradebook-zero-weight-filters',
  description: 'Verify shared default-on compact zero-weight assessments, visible scores and themes',
  role: 'unauthenticated',
  async run(page, baseUrl) {
    const artifactDir = path.join(process.cwd(), 'output/playwright/gradebook-compact-zero-weight')
    fs.mkdirSync(artifactDir, { recursive: true })
    const artifacts: string[] = []
    const section = page.locator('#gradebook-compact')
    const student = section.getByTestId('student-grades-view')
    const returned = section.getByTestId('gradebook-compact-returned-marks')
    const panel = section.getByTestId('gradebook-compact-student-panel')
    const teacherColumn = section.getByRole('button', { name: 'Edit A2: Research assignment 2', exact: true })
    const studentTitle = student.getByText('Research assignment 2', { exact: true })
    const studentRow = studentTitle.locator('xpath=ancestor::li')
    const returnedRow = returned.getByText('Practice journal', { exact: true }).locator('xpath=ancestor::li')
    const trigger = section.getByRole('button', { name: 'Gradebook more actions' })
    const toggle = () => page.getByRole('menuitemcheckbox', { name: 'Compact 0-weight assessments', exact: true })
    const open = async () => {
      await section.evaluate(element => element.scrollIntoView({ block: 'start' }))
      await trigger.click()
    }
    const capture = async (name: string, target = student) => {
      const file = path.join(artifactDir, `${name}.png`)
      await target.screenshot({ path: file })
      artifacts.push(file)
    }
    await page.addInitScript(() => {
      const selected = new URL(window.location.href).searchParams.get('verifyTheme')
      if (selected === 'light' || selected === 'dark') window.localStorage.setItem('theme', selected)
    })
    for (const theme of ['light', 'dark'] as const) {
      for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme })
        await page.goto(`${baseUrl}/pattern-lab?role=teacher&verification=${size}-${theme}&verifyTheme=${theme}#gradebook-compact`)
        await expect(page.getByRole('button', { name: `Use ${theme === 'dark' ? 'light' : 'dark'} theme` })).toBeVisible()
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
        else await expect(page.locator('html')).not.toHaveClass(/dark/)
        await page.getByRole('navigation', { name: 'Pattern Lab sections' }).evaluate(element => { element.style.position = 'static' })
        await expect(teacherColumn).toHaveCount(1)
        await expect(studentTitle).toHaveCount(1)
        if (size === 'mobile') {
          // Production mobile uses the inspector. Unfreeze this desktop-table
          // fixture to additionally inspect its horizontally scrolled zero column.
          await open()
          await page.getByRole('menuitemcheckbox', { name: 'Keep key columns visible' }).click()
          await expect(section.getByRole('columnheader', { name: 'First', exact: true })).not.toHaveClass(/sticky/)
          await teacherColumn.scrollIntoViewIfNeeded()
        }
        const currentGrade = await student.locator('p.text-3xl').textContent()
        const compactWidth = (await teacherColumn.boundingBox())!.width
        const compactHeight = (await studentRow.boundingBox())!.height
        const compactReturnedHeight = (await returnedRow.boundingBox())!.height
        await expect(studentTitle).toHaveClass(/text-text-muted/)
        await expect(returnedRow).toContainText('0 weight')
        await expect(returnedRow).toContainText('0%')
        await expect(panel.locator('[data-compact-zero-weight]')).toHaveCount(1)
        await capture(`${size}-${theme}-teacher-compact`, section.getByTestId('gradebook-student-scroll-pane'))
        await capture(`${size}-${theme}-student-compact`)
        await capture(`${size}-${theme}-returned-compact`, returned)
        await capture(`${size}-${theme}-inspector-compact`, panel)
        await open()
        await expect(toggle()).toHaveAttribute('aria-checked', 'true')
        await expect(page.getByRole('menuitemcheckbox', { name: /Hide 0-weight/ })).toHaveCount(0)
        await capture(`${size}-${theme}-menu-on`, section.getByRole('button', { name: 'Gradebook more actions' }).locator('xpath=ancestor::*[@data-testid="gradebook-compact-pattern"]'))
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
        await open()
        await toggle().focus()
        await page.keyboard.press('Enter')
        await expect(toggle()).toHaveCount(0)
        await expect(teacherColumn).toHaveCount(1)
        await expect(studentTitle).toHaveCount(1)
        await expect(studentTitle).toHaveClass(/text-text-default/)
        await expect(student.locator('p.text-3xl')).toHaveText(currentGrade ?? '')
        expect((await teacherColumn.boundingBox())!.width).toBeGreaterThan(compactWidth)
        expect((await studentRow.boundingBox())!.height).toBeGreaterThan(compactHeight)
        expect((await returnedRow.boundingBox())!.height).toBeGreaterThan(compactReturnedHeight)
        await expect(panel.locator('[data-compact-zero-weight]')).toHaveCount(0)
        await capture(`${size}-${theme}-teacher-expanded`, section.getByTestId('gradebook-student-scroll-pane'))
        await capture(`${size}-${theme}-student-expanded`)
        await capture(`${size}-${theme}-returned-expanded`, returned)
        await capture(`${size}-${theme}-inspector-expanded`, panel)
        await open()
        await expect(toggle()).toHaveAttribute('aria-checked', 'false')
        await toggle().click()
        await expect(studentTitle).toHaveClass(/text-text-muted/)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        expect(compactWidth).toBeGreaterThanOrEqual(44)
        expect(compactHeight).toBeGreaterThanOrEqual(44)
      }
    }
    return { scenario: 'gradebook-zero-weight-filters', passed: true,
      checks: [{ name: 'Default on; no items hidden; narrower columns and shorter rows; unchanged grade; keyboard/focus; desktop/mobile light/dark', passed: true }], artifacts }
  },
}
