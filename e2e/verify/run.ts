/**
 * Verification script runner
 *
 * Usage:
 *   pnpm e2e:verify <scenario>
 *   pnpm e2e:verify --help
 *
 * Outputs JSON result to stdout with exit code 0 (pass) or 1 (fail)
 */
import { chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'

import type { VerificationResult, VerificationScript } from './types'

// Import scenarios
import { addStudentsModal } from './add-students-modal'
import { createClassroomWizard } from './create-classroom-wizard'

const scenarios: Record<string, VerificationScript> = {
  'add-students-modal': addStudentsModal,
  'create-classroom-wizard': createClassroomWizard,
}

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const AUTH_DIR = path.join(process.cwd(), '.auth')

async function main() {
  const scenarioName = process.argv[2]

  if (!scenarioName || scenarioName === '--help' || scenarioName === '-h') {
    console.log('Usage: pnpm e2e:verify <scenario>')
    console.log('')
    console.log('Available scenarios:')
    Object.entries(scenarios).forEach(([name, script]) => {
      console.log(`  ${name.padEnd(25)} ${script.description}`)
    })
    console.log('')
    console.log('Options:')
    console.log('  --help, -h              Show this help message')
    process.exit(0)
  }

  const script = scenarios[scenarioName]
  if (!script) {
    console.error(`Unknown scenario: ${scenarioName}`)
    console.error('Run "pnpm e2e:verify --help" for available scenarios.')
    process.exit(1)
  }

  // Determine auth state
  let storageState: string | undefined
  if (script.role !== 'unauthenticated') {
    const authFile = path.join(AUTH_DIR, `${script.role}.json`)
    if (!fs.existsSync(authFile)) {
      console.error(`Auth state not found: ${authFile}`)
      console.error('Run "pnpm e2e:auth" first to generate auth states.')
      process.exit(1)
    }
    storageState = authFile
  }

  // Launch browser
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState,
  })
  const page = await context.newPage()

  let result: VerificationResult

  try {
    result = await script.run(page, BASE_URL)
  } catch (error) {
    result = {
      scenario: scenarioName,
      passed: false,
      checks: [],
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await browser.close()
  }

  // Output JSON result
  console.log(JSON.stringify(result, null, 2))

  // Exit with appropriate code
  process.exit(result.passed ? 0 : 1)
}

main()
