import fs from 'fs'
import path from 'path'
import { expect } from '@playwright/test'
import type { VerificationCheck, VerificationScript } from './types'

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

const archivedClassroom = {
  id: '20000000-0000-4000-8000-000000000099',
  teacher_id: '10000000-0000-4000-8000-000000000001',
  title: 'Archived Biology', class_code: 'BIO101', theme_color: 'teal',
  term_label: 'Winter 2026', allow_enrollment: false, join_policy: 'roster',
  start_date: '2025-09-02', end_date: '2026-01-30',
  lesson_plan_visibility: 'current_week', blueprint_source_revision: 0,
  archived_at: '2026-06-30T12:00:00.000Z',
  created_at: '2026-01-01T12:00:00.000Z', updated_at: '2026-06-30T12:00:00.000Z',
}

export const classroomsLivePattern: VerificationScript = {
  name: 'classrooms-live-pattern',
  description: 'Verify live classroom navigation against the accepted Pattern Lab menu',
  role: 'teacher',
  async run(initialPage, baseUrl) {
    const checks: VerificationCheck[] = []
    const artifacts: string[] = []
    const artifactDir = path.join(process.cwd(), 'output/playwright/classrooms-live-pattern')
    fs.mkdirSync(artifactDir, { recursive: true })
    const browser = initialPage.context().browser()!

    for (const role of ['teacher', 'student'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        for (const [size, viewport] of Object.entries(VIEWPORTS)) {
          const context = await browser.newContext({
            storageState: `.auth/${role}.json`, viewport, reducedMotion: 'reduce', colorScheme: theme,
          })
          try {
            const page = await context.newPage()
            await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
            const prefix = `${role}-${size}-${theme}`
            const capture = async (state: string) => {
              await page.evaluate(() => document.fonts.ready)
              expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
              const file = path.join(artifactDir, `${prefix}-${state}.png`)
              await page.screenshot({ path: file, animations: 'disabled' })
              artifacts.push(file)
              checks.push({ name: `${prefix} ${state}: rendered without horizontal overflow`, passed: true })
            }
            // Never issue real classroom mutations while capturing acceptance evidence.
            await page.route('**/api/teacher/**', async (route) => {
              if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
              return route.fallback()
            })
            let archiveState: 'populated' | 'empty' | 'error' | 'loading' = 'populated'
            let finishArchiveLoad: (() => void) | undefined
            await page.route('**/api/teacher/classrooms?archived=true', async (route) => {
              if (archiveState === 'loading') await new Promise<void>((resolve) => { finishArchiveLoad = resolve })
              await route.fulfill({
                status: archiveState === 'error' ? 503 : 200,
                contentType: 'application/json',
                body: JSON.stringify(archiveState === 'error' ? { error: 'Archive service unavailable' } : {
                  classrooms: archiveState === 'empty' ? [] : [archivedClassroom],
                  cold_archives: [], cold_archive_restore_enabled: false,
                  hot_classroom_purge_enabled_ids: [], cold_classroom_purge_enabled_ids: [],
                  hot_archive_recovery: [], hot_archive_recovery_status_available: true,
                }),
              })
            })
            await page.goto(`${baseUrl}/classrooms`)
            await expect(page).toHaveURL(/\/classrooms$/)
            if (role === 'student') {
              await expect(page.getByRole('button', { name: 'Classroom actions' })).toHaveCount(0)
              await capture('unchanged-list')
              continue
            }

            const heading = page.getByRole('heading', { name: 'Active classrooms' })
            const trigger = page.getByRole('button', { name: 'Classroom actions' })
            await expect(heading).toBeVisible()
            await expect(page.getByTestId('classroom-card').first()).toBeVisible()
            const triggerBounds = await trigger.boundingBox()
            const firstCardBounds = await page.getByTestId('classroom-card').first().boundingBox()
            expect(triggerBounds).not.toBeNull()
            expect(firstCardBounds).not.toBeNull()
            expect(triggerBounds!.y + triggerBounds!.height).toBeLessThanOrEqual(firstCardBounds!.y)
            expect(Math.abs(triggerBounds!.x + triggerBounds!.width - firstCardBounds!.x - firstCardBounds!.width)).toBeLessThanOrEqual(1)
            await capture('active')
            await trigger.click()
            await expect(page.getByRole('menuitem', { name: 'New Classroom' })).toBeFocused()
            await page.keyboard.press('End')
            await expect(page.getByRole('menuitem', { name: 'Show Archived' })).toBeFocused()
            await page.keyboard.press('Home')
            await capture('menu')
            await page.keyboard.press('Escape')
            await expect(trigger).toBeFocused()
            await trigger.click()
            await page.getByRole('menuitem', { name: 'New Classroom' }).click()
            await expect(page.getByRole('dialog')).toBeVisible()
            await capture('create-dialog')
            await page.keyboard.press('Escape')
            await expect(page.getByRole('dialog')).toHaveCount(0)
            await expect(trigger).toBeFocused()

            await trigger.click()
            await page.getByRole('menuitemcheckbox', { name: 'Edit classrooms' }).click()
            await expect(page.getByText('Editing', { exact: true })).toBeVisible()
            await capture('editing')
            await trigger.click()
            await expect(page.getByRole('menuitemcheckbox', { name: 'Edit classrooms' })).toBeChecked()
            await page.keyboard.press('Escape')
            await expect(page.getByText('Editing', { exact: true })).toBeVisible()
            await page.getByRole('button', { name: /^Archive / }).first().click()
            await expect(page.getByRole('dialog')).toBeVisible()
            await page.keyboard.press('Escape')
            await expect(page.getByRole('dialog')).toHaveCount(0)
            await expect(page.getByText('Editing', { exact: true })).toBeVisible()
            // A second Escape, with focus back in the list, leaves edit mode.
            await page.keyboard.press('Escape')
            await expect(heading).toBeFocused()
            await expect(page.getByText('Editing', { exact: true })).toHaveCount(0)

            for (const state of ['populated', 'empty', 'error', 'loading'] as const) {
              archiveState = state
              // A fresh document clears the cached archive response between fixtures.
              await page.reload()
              await trigger.click()
              await page.getByRole('menuitem', { name: 'Show Archived' }).click()
              await expect(page.getByRole('heading', { name: 'Archived classrooms' })).toBeVisible()
              if (state === 'populated') await expect(page.getByRole('button', { name: /^Archived Biology/ })).toBeVisible()
              if (state === 'empty') await expect(page.getByText('No archived classrooms')).toBeVisible()
              if (state === 'error') await expect(page.getByRole('alert').filter({ hasText: 'Archive service unavailable' })).toBeVisible()
              if (state === 'loading') await expect.poll(() => Boolean(finishArchiveLoad)).toBe(true)
              await capture(`archived-${state}`)
              if (state === 'error') {
                await expect(page.getByText('No archived classrooms')).toHaveCount(0)
                archiveState = 'empty'
                await page.getByRole('button', { name: 'Try loading archived classrooms again' }).click()
                await expect(page.getByText('No archived classrooms')).toBeVisible()
              }
              if (state === 'loading') { finishArchiveLoad?.(); finishArchiveLoad = undefined }
              await trigger.click()
              await expect(page.getByRole('menuitem', { name: 'Show Active' })).toBeVisible()
              await expect(page.getByRole('menuitem', { name: 'Show Archived' })).toHaveCount(0)
              await page.keyboard.press('Escape')
              await page.getByRole('button', { name: 'Back to classrooms' }).click()
              await expect(heading).toBeFocused()
            }
            checks.push({ name: `${prefix}: menu keys, checked edit state, nested Escape, creation, Back focus and archive states`, passed: true })

            await page.goto(`${baseUrl}/pattern-lab?role=teacher`)
            const nav = page.getByRole('navigation', { name: 'Pattern Lab sections' })
            await nav.getByRole('combobox', { name: 'Find a pattern' }).selectOption('mockup-classrooms-panel')
            const reference = page.getByTestId('classrooms-mockup')
            await expect(reference).toBeVisible()
            await nav.evaluate((element) => { element.style.position = 'static' })
            await reference.scrollIntoViewIfNeeded()
            const referenceFile = path.join(artifactDir, `${prefix}-reference.png`)
            await reference.screenshot({ path: referenceFile, animations: 'disabled' })
            artifacts.push(referenceFile)
            await reference.getByRole('button', { name: 'Classroom actions' }).click()
            const referenceMenuFile = path.join(artifactDir, `${prefix}-reference-menu.png`)
            await reference.screenshot({ path: referenceMenuFile, animations: 'disabled' })
            artifacts.push(referenceMenuFile)
          } catch (error) {
            return { scenario: 'classrooms-live-pattern', passed: false, checks, artifacts, error: error instanceof Error ? error.message : String(error) }
          } finally {
            await context.close()
          }
        }
      }
    }
    return { scenario: 'classrooms-live-pattern', passed: checks.every((check) => check.passed), checks, artifacts }
  },
}
