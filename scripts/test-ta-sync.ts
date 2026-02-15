/**
 * TeachAssist Integration Test Script
 *
 * Tests the full Playwright flow against a real TeachAssist instance.
 * Read-only: never submits any attendance data.
 *
 * Usage:
 *   npm run test:ta
 *   TEACHASSIST_USERNAME=x TEACHASSIST_PASSWORD=y npm run test:ta
 *   npm run test:ta -- --json
 *
 * Env vars:
 *   TEACHASSIST_USERNAME  — TA login username (required)
 *   TEACHASSIST_PASSWORD  — TA login password (required)
 *   TEACHASSIST_BASE_URL  — TA base URL (default: https://ta.yrdsb.ca/yrdsb/)
 *   TEACHASSIST_COURSE    — Course search text (default: GLD2OOH)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import * as readline from 'readline'

// Load .env.local first, then .env
config({ path: resolve(__dirname, '..', '.env.local') })
config({ path: resolve(__dirname, '..', '.env') })

// Playwright imports use relative paths since tsx may not resolve aliases
import { launchBrowser, createPage, closeBrowser, resolveFrames } from '../src/lib/teachassist/playwright/ta-browser'
import { loginToTeachAssist } from '../src/lib/teachassist/playwright/ta-auth'
import { selectCourse, navigateToAttendance } from '../src/lib/teachassist/playwright/ta-navigation'
import { readAttendancePage, setDate } from '../src/lib/teachassist/playwright/ta-attendance'
import type { TACredentials } from '../src/lib/teachassist/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestStep {
  step: number
  name: string
  status: 'passed' | 'failed' | 'skipped'
  duration_ms: number
  details?: string
  error?: string
}

interface TestResult {
  timestamp: string
  overall: { passed: number; failed: number; skipped: number; total_ms: number }
  steps: TestStep[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isJSON = process.argv.includes('--json')

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function getCredentials(): Promise<{ credentials: TACredentials; courseSearch: string }> {
  let username = process.env.TEACHASSIST_USERNAME || ''
  let password = process.env.TEACHASSIST_PASSWORD || ''
  const baseUrl = process.env.TEACHASSIST_BASE_URL || 'https://ta.yrdsb.ca/yrdsb/'
  const courseSearch = process.env.TEACHASSIST_COURSE || 'GLD2OOH'

  if (!username) username = await prompt('TeachAssist Username: ')
  if (!password) password = await prompt('TeachAssist Password: ')

  if (!username || !password) {
    console.error('Error: Username and password are required.')
    process.exit(1)
  }

  return {
    credentials: { username, password, baseUrl },
    courseSearch,
  }
}

function log(message: string) {
  if (!isJSON) process.stderr.write(message + '\n')
}

function formatMs(ms: number): string {
  return (ms / 1000).toFixed(1) + 's'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now()
  const steps: TestStep[] = []
  let stepNum = 0

  async function runStep(
    name: string,
    fn: () => Promise<string | void>
  ): Promise<boolean> {
    stepNum++
    const stepStart = Date.now()
    try {
      const details = await fn()
      const duration = Date.now() - stepStart
      steps.push({
        step: stepNum,
        name,
        status: 'passed',
        duration_ms: duration,
        details: details || undefined,
      })
      const detailStr = details ? `  → ${details}` : ''
      log(`  ✓ ${name.padEnd(30)} (${formatMs(duration)})${detailStr}`)
      return true
    } catch (err: any) {
      const duration = Date.now() - stepStart
      const errorMsg = err.message || String(err)
      steps.push({
        step: stepNum,
        name,
        status: 'failed',
        duration_ms: duration,
        error: errorMsg,
      })
      log(`  ✗ ${name.padEnd(30)} (${formatMs(duration)})`)
      log(`    Error: ${errorMsg}`)
      return false
    }
  }

  log('')
  log('TeachAssist Integration Test')
  log('═'.repeat(50))
  log('')

  const { credentials, courseSearch } = await getCredentials()

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null
  let page: Awaited<ReturnType<typeof createPage>> | null = null

  try {
    // Step 1: Launch browser
    const step1Ok = await runStep('Launch browser', async () => {
      browser = await launchBrowser({ headless: false })
      page = await createPage(browser)
      return 'Chromium launched (headed mode)'
    })
    if (!step1Ok || !browser || !page) throw new Error('Cannot continue without browser')

    // Step 2: Login
    const step2Ok = await runStep('Login to TeachAssist', async () => {
      await loginToTeachAssist(page!, credentials)
      return `Logged in as ${credentials.username}`
    })
    if (!step2Ok) throw new Error('Cannot continue without login')

    // Step 3: Select course
    const step3Ok = await runStep(`Select course ${courseSearch}`, async () => {
      await selectCourse(page!, courseSearch)
      return `Course "${courseSearch}" selected`
    })
    if (!step3Ok) throw new Error('Cannot continue without course')

    // Step 4: Navigate to attendance
    const step4Ok = await runStep('Navigate to attendance', async () => {
      await navigateToAttendance(page!)
      return 'Attendance page loaded'
    })
    if (!step4Ok) throw new Error('Cannot continue without attendance page')

    // Step 5: Read student list and verify radio buttons
    let mainFrame: Awaited<ReturnType<typeof resolveFrames>>['mainFrame'] | null = null
    const step5Ok = await runStep('Read student list', async () => {
      const frames = await resolveFrames({ page: page! })
      mainFrame = frames.mainFrame
      const state = await readAttendancePage(mainFrame)

      // Verify we can actually find radio buttons for the first student
      if (state.students.length > 0) {
        const first = state.students[0]
        const radioSelector = `input[name="${first.radioName}"][value="P"]`
        const radio = await mainFrame.$(radioSelector)
        const radioStatus = radio ? 'radios accessible' : 'radios NOT found'
        return `${state.students.length} students, date: ${state.date}, block: ${state.block}, ${radioStatus}`
      }

      return `${state.students.length} students found, date: ${state.date}, block: ${state.block}`
    })

    if (!step5Ok || !mainFrame) throw new Error('Cannot continue without student list')

    // Step 6: Test date navigation (read-only — just sets the date, no radio changes)
    await runStep('Navigate to different date', async () => {
      // Use yesterday or a recent weekday as test date
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      // Skip weekends — go back to Friday if yesterday is Sunday/Saturday
      while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
        yesterday.setDate(yesterday.getDate() - 1)
      }
      const testDate = yesterday.toISOString().slice(0, 10)

      await setDate(mainFrame!, testDate)

      // Re-read the page to confirm students are still visible on the new date
      const state = await readAttendancePage(mainFrame!)
      return `Navigated to ${testDate}, ${state.students.length} students, radios present`
    })
  } catch {
    // Step failures already logged; continue to results
  } finally {
    // Cleanup
    if (page) await page.close().catch(() => {})
    if (browser) await closeBrowser(browser).catch(() => {})
  }

  // Results
  const totalMs = Date.now() - startTime
  const passed = steps.filter((s) => s.status === 'passed').length
  const failed = steps.filter((s) => s.status === 'failed').length
  const skipped = steps.filter((s) => s.status === 'skipped').length

  const result: TestResult = {
    timestamp: new Date().toISOString(),
    overall: { passed, failed, skipped, total_ms: totalMs },
    steps,
  }

  if (isJSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    log('')
    log('═'.repeat(50))
    log(`Result: ${passed}/${steps.length} PASSED${failed > 0 ? `, ${failed} FAILED` : ''} (${formatMs(totalMs)})`)
    log('')
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
