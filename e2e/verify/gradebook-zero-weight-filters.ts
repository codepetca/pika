import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import type { VerificationScript } from './types'

/** Deterministic production toolbar, teacher table and student Grades owners. */
export const gradebookZeroWeightFilters: VerificationScript = {
  name: 'gradebook-zero-weight-filters',
  description: 'Verify independent teacher/student zero-weight visibility, menu semantics and themes',
  role: 'teacher',
  async run(page, baseUrl) {
    const artifactDir = path.join(process.cwd(), 'output/playwright/gradebook-zero-weight')
    fs.mkdirSync(artifactDir, { recursive: true })
    const artifacts: string[] = []
    const section = page.locator('#gradebook-compact')
    const student = section.getByTestId('student-grades-view')
    const teacherColumn = section.getByRole('button', { name: 'Edit A2: Research assignment 2', exact: true })
    const studentRow = student.getByText('Research assignment 2', { exact: true })
    const trigger = section.getByRole('button', { name: 'Gradebook more actions' })
    const open = async () => {
      await section.evaluate(element => element.scrollIntoView({ block: 'start' }))
      await trigger.click()
    }
    const toggle = (role: 'teacher' | 'student') => page.getByRole('menuitemcheckbox', { name: `Hide 0-weight ${role}`, exact: true })
    const capture = async (name: string, studentOnly = false) => {
      const file = path.join(artifactDir, `${name}.png`)
      if (studentOnly) await student.screenshot({ path: file })
      else await page.screenshot({ path: file })
      artifacts.push(file)
    }
    for (const theme of ['light', 'dark'] as const) {
      for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
        await page.setViewportSize(viewport)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`${baseUrl}/pattern-lab?role=teacher#gradebook-compact`)
        const themeButton = page.getByRole('button', { name: `Use ${theme} theme` })
        if (await themeButton.isVisible()) await themeButton.click()
        await page.getByRole('navigation', { name: 'Pattern Lab sections' }).evaluate(element => { element.style.position = 'static' })
        await expect(teacherColumn).toHaveCount(1)
        await expect(studentRow).toHaveCount(1)
        const currentGrade = await student.locator('p.text-3xl').textContent()
        await open()
        await expect(toggle('teacher')).toHaveAttribute('aria-checked', 'false')
        await expect(toggle('student')).toHaveAttribute('aria-checked', 'false')
        await expect(toggle('student')).toBeVisible()
        await capture(`${size}-${theme}-menu-off`)
        await page.keyboard.press('Escape')
        await expect(trigger).toBeFocused()
        await open()
        await toggle('teacher').click()
        await expect(teacherColumn).toHaveCount(0)
        await expect(studentRow).toHaveCount(1)
        await capture(`${size}-${theme}-student-teacher-only`, true)
        await open()
        await expect(toggle('teacher')).toHaveAttribute('aria-checked', 'true')
        await expect(toggle('student')).toHaveAttribute('aria-checked', 'false')
        await toggle('student').click()
        await expect(studentRow).toHaveCount(0)
        await expect(teacherColumn).toHaveCount(0)
        await expect(student.locator('p.text-3xl')).toHaveText(currentGrade ?? '')
        await capture(`${size}-${theme}-student-hidden`, true)
        await open()
        await expect(toggle('student')).toHaveAttribute('aria-checked', 'true')
        await capture(`${size}-${theme}-menu-on`)
        await toggle('teacher').click()
        await expect(teacherColumn).toHaveCount(1)
        await expect(studentRow).toHaveCount(0)
        await open()
        await toggle('student').click()
        await expect(studentRow).toHaveCount(1)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      }
    }
    return { scenario: 'gradebook-zero-weight-filters', passed: true,
      checks: [{ name: 'Both defaults off; four independent combinations; unchanged grade; Escape focus; desktop/mobile light/dark', passed: true }], artifacts }
  },
}
