import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const TEACHER_EMAIL = process.env.E2E_TEACHER_EMAIL || 'teacher@yrdsb.ca'
const STUDENT_EMAIL = process.env.E2E_STUDENT_EMAIL || 'student1@student.yrdsb.ca'
const PASSWORD = process.env.E2E_PASSWORD || 'test1234'
const SNAPSHOT_DIR = process.env.E2E_SNAPSHOT_DIR || 'artifacts/ui-snapshots'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('School Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL('**/classrooms**', { timeout: 30_000 })
}

async function snap(page: Page, name: string) {
  await page.waitForLoadState('networkidle')
  const path = `${SNAPSHOT_DIR}/${name}.png`
  mkdirSync(dirname(path), { recursive: true })
  await page.screenshot({ path, fullPage: true })
}

test.describe.configure({ mode: 'serial' })

test('logged-out screens', async ({ page }) => {
  await page.goto('/login')
  await snap(page, 'auth/login')

  await page.goto('/signup')
  await snap(page, 'auth/signup')

  await page.goto('/forgot-password')
  await snap(page, 'auth/forgot-password')
})

test('teacher screens', async ({ page }) => {
  await login(page, TEACHER_EMAIL)

  await page.goto('/__ui')
  await snap(page, 'teacher/ui-gallery')

  await page.goto('/classrooms')
  await snap(page, 'teacher/classrooms-index')

  const openLink = page.getByRole('link', { name: 'Open' }).first()
  await expect(openLink).toBeVisible({ timeout: 15_000 })
  await openLink.click()
  await page.waitForURL('**/classrooms/**', { timeout: 15_000 })
  await snap(page, 'teacher/classroom/attendance')

  await page.getByRole('button', { name: 'Logs' }).click()
  await snap(page, 'teacher/classroom/logs-collapsed')

  const expandAll = page.getByRole('button', { name: 'Expand all' })
  if (await expandAll.isVisible()) {
    await expandAll.click()
  }
  await snap(page, 'teacher/classroom/logs-expanded')

  await page.getByRole('button', { name: 'Roster' }).click()
  await snap(page, 'teacher/classroom/roster')

  await page.getByRole('button', { name: 'Calendar' }).click()
  await snap(page, 'teacher/classroom/calendar')

  await page.getByRole('button', { name: 'Settings' }).click()
  await snap(page, 'teacher/classroom/settings')

  await page.getByRole('button', { name: 'Assignments' }).click()
  await snap(page, 'teacher/classroom/assignments')

  const assignmentLink = page.locator('a[href*="/assignments/"]').first()
  if ((await assignmentLink.count()) > 0) {
    await assignmentLink.click()
    await page.waitForURL('**/assignments/**', { timeout: 15_000 })
    await snap(page, 'teacher/assignment/detail')
  }
})

test('student screens', async ({ page }) => {
  await login(page, STUDENT_EMAIL)

  await page.goto('/__ui')
  await snap(page, 'student/ui-gallery')

  // Student is auto-routed into their most recent classroom from /classrooms
  await page.goto('/classrooms')
  await page.waitForURL('**/classrooms/**', { timeout: 15_000 })
  await snap(page, 'student/classroom/today')

  await page.getByRole('button', { name: 'History' }).click()
  await snap(page, 'student/classroom/history')

  await page.getByRole('button', { name: 'Assignments' }).click()
  await snap(page, 'student/classroom/assignments')

  const assignmentLink = page.locator('a[href*="/assignments/"]').first()
  if ((await assignmentLink.count()) > 0) {
    await assignmentLink.click()
    await page.waitForURL('**/assignments/**', { timeout: 15_000 })
    await snap(page, 'student/assignment/editor')
  }

  await page.goto('/join')
  await snap(page, 'student/join')
})

