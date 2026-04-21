/**
 * Verification: Assessment UX parity capture
 *
 * Captures assignment reference screens and assessment target screens for both
 * teacher and student roles using a shared classroom. This is a screenshot
 * collection harness for rubric-driven review, not a visual diff test.
 */
import fs from 'fs'
import path from 'path'

import type { Page } from '@playwright/test'

import type { VerificationCheck, VerificationResult, VerificationScript } from './types'

type ClassroomRecord = {
  id: string
  title?: string
}

type CaptureRoute = {
  role: 'teacher' | 'student'
  name: string
  tab: 'assignments' | 'tests' | 'quizzes'
  readyTexts: readonly string[]
  readyButtons?: readonly string[]
  readySelectors?: readonly string[]
  readySelector?: string
}

const ARTIFACT_DIR = path.join(process.cwd(), 'artifacts', 'assessment-ux-parity')

const ROUTES: readonly CaptureRoute[] = [
  {
    role: 'teacher' as const,
    name: 'teacher-assignments-reference',
    tab: 'assignments',
    readyTexts: ['No assignments yet', 'Due:', 'Draft', 'Scheduled'],
    readyButtons: ['New'],
    readySelectors: ['main h3'],
  },
  {
    role: 'teacher' as const,
    name: 'teacher-tests-target',
    tab: 'tests',
    readyTexts: ['No tests yet'],
    readyButtons: ['New Test', 'Authoring', 'Grading'],
    readySelectors: ['main h3'],
  },
  {
    role: 'teacher' as const,
    name: 'teacher-quizzes-target',
    tab: 'quizzes',
    readyTexts: ['No quizzes yet'],
    readyButtons: ['New Quiz'],
    readySelectors: ['main h3'],
  },
  {
    role: 'student' as const,
    name: 'student-assignments-reference',
    tab: 'assignments',
    readyTexts: ['No assignments yet', 'When your teacher posts work', 'Unsubmit', 'Returned', 'Graded'],
    readySelectors: ['[data-testid="assignment-card"]'],
    readySelector: '[data-testid=\"assignment-card\"]',
  },
  {
    role: 'student' as const,
    name: 'student-tests-target',
    tab: 'tests',
    readyTexts: ['Select a test from the list to view and complete it.', 'No tests available.', 'This test is closed', 'Returned'],
    readyButtons: ['Start the Test'],
    readySelectors: ['[data-testid="student-test-split-container"]', 'main button h3'],
  },
  {
    role: 'student' as const,
    name: 'student-quizzes-target',
    tab: 'quizzes',
    readyTexts: ['No quizzes available.', 'View Results', 'Submitted'],
    readySelectors: ['main button h3'],
  },
] as const

async function loadClassrooms(page: Page, apiPath: string): Promise<ClassroomRecord[]> {
  return page.evaluate(async (pathName) => {
    const response = await fetch(pathName)
    if (!response.ok) {
      throw new Error(`Failed to load ${pathName}: ${response.status}`)
    }
    const data = await response.json()
    return Array.isArray(data.classrooms) ? data.classrooms : []
  }, apiPath)
}

function chooseSharedClassroom(
  teacherClassrooms: ClassroomRecord[],
  studentClassrooms: ClassroomRecord[],
): ClassroomRecord | null {
  const studentIds = new Set(studentClassrooms.map((classroom) => classroom.id))
  const shared = teacherClassrooms.filter((classroom) => studentIds.has(classroom.id))

  if (shared.length === 0) return null

  const preferred = shared.find((classroom) => classroom.title?.toLowerCase().includes('test classroom'))
  return preferred || shared[0]
}

async function waitForReadyState(
  page: Page,
  opts: {
    readyTexts: readonly string[]
    readyButtons?: readonly string[]
    readySelectors?: readonly string[]
  },
) {
  const { readyTexts, readyButtons = [], readySelectors = [] } = opts

  await page.waitForFunction(
    ({ texts, buttons, selectors }) => {
      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector))
        for (const element of elements) {
          if (!(element instanceof HTMLElement)) continue
          const style = window.getComputedStyle(element)
          if (style.visibility === 'hidden' || style.display === 'none') continue
          if (element.getClientRects().length > 0) {
            return true
          }
        }
      }

      const buttonsOnPage = Array.from(document.querySelectorAll('button'))
      for (const label of buttons) {
        for (const button of buttonsOnPage) {
          if (!(button instanceof HTMLElement)) continue
          const style = window.getComputedStyle(button)
          if (style.visibility === 'hidden' || style.display === 'none') continue
          if (button.getClientRects().length === 0) continue
          const text = button.textContent?.trim() || ''
          if (text.includes(label)) {
            return true
          }
        }
      }

      const bodyText = document.body?.innerText || ''
      return texts.some((text) => bodyText.includes(text))
    },
    {
      texts: readyTexts,
      buttons: readyButtons,
      selectors: readySelectors,
    },
    { timeout: 30_000 },
  )
}

async function captureScreen(opts: {
  page: Page
  baseUrl: string
  classroomId: string
  tab: string
  readyTexts: readonly string[]
  readyButtons?: readonly string[]
  readySelectors?: readonly string[]
  readySelector?: string
  outputPath: string
}) {
  const {
    page,
    baseUrl,
    classroomId,
    tab,
    readyTexts,
    readyButtons,
    readySelectors,
    readySelector,
    outputPath,
  } = opts

  await page.goto(`${baseUrl}/classrooms/${classroomId}?tab=${tab}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(2500)
  if (readySelector) {
    const selectorVisible = await page.locator(readySelector).first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    if (!selectorVisible) {
      await waitForReadyState(page, opts)
    }
  } else {
    await waitForReadyState(page, { readyTexts, readyButtons, readySelectors })
  }
  await page.screenshot({ path: outputPath, fullPage: true })
}

export const assessmentUxParity: VerificationScript = {
  name: 'assessment-ux-parity',
  description: 'Capture assignment references and assessment targets for teacher/student parity review',
  role: 'teacher',

  async run(page, baseUrl): Promise<VerificationResult> {
    const checks: VerificationCheck[] = []
    const artifacts: string[] = []

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

    await page.goto(`${baseUrl}/classrooms`, { waitUntil: 'domcontentloaded' })
    const browser = page.context().browser()
    if (!browser) {
      return {
        scenario: 'assessment-ux-parity',
        passed: false,
        checks,
        error: 'Browser instance unavailable from verification context.',
      }
    }

    const studentAuthPath = path.join(process.cwd(), '.auth', 'student.json')
    if (!fs.existsSync(studentAuthPath)) {
      return {
        scenario: 'assessment-ux-parity',
        passed: false,
        checks,
        error: `Auth state not found: ${studentAuthPath}. Run "pnpm e2e:auth" first.`,
      }
    }
    const studentContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: studentAuthPath,
    })
    const studentPage = await studentContext.newPage()

    try {
      await studentPage.goto(`${baseUrl}/classrooms`, { waitUntil: 'domcontentloaded' })

      const [teacherClassrooms, studentClassrooms] = await Promise.all([
        loadClassrooms(page, '/api/teacher/classrooms'),
        loadClassrooms(studentPage, '/api/student/classrooms'),
      ])

      const sharedClassroom = chooseSharedClassroom(teacherClassrooms, studentClassrooms)

      if (!sharedClassroom) {
        checks.push({
          name: 'Shared classroom available',
          passed: false,
          message: 'No classroom is visible to both teacher and student. Seed a shared classroom before running parity capture.',
        })
        return {
          scenario: 'assessment-ux-parity',
          passed: false,
          checks,
          artifacts,
        }
      }

      checks.push({
        name: 'Shared classroom available',
        passed: true,
        message: `${sharedClassroom.title || 'Shared classroom'} (${sharedClassroom.id})`,
      })

      for (const route of ROUTES) {
        const outputPath = path.join(ARTIFACT_DIR, `${route.name}.png`)
        const targetPage = route.role === 'teacher' ? page : studentPage

        try {
          await captureScreen({
            page: targetPage,
            baseUrl,
            classroomId: sharedClassroom.id,
            tab: route.tab,
            readyTexts: route.readyTexts,
            readyButtons: route.readyButtons,
            readySelectors: route.readySelectors,
            readySelector: route.readySelector,
            outputPath,
          })
        } catch (error) {
          checks.push({
            name: `Capture ${route.name}`,
            passed: false,
            message: error instanceof Error ? error.message : String(error),
          })
          return {
            scenario: 'assessment-ux-parity',
            passed: false,
            checks,
            artifacts,
            error: `Failed while capturing ${route.name}.`,
          }
        }

        artifacts.push(outputPath)
        checks.push({
          name: `Capture ${route.name}`,
          passed: true,
          message: outputPath,
        })
      }

      return {
        scenario: 'assessment-ux-parity',
        passed: checks.every((check) => check.passed),
        checks,
        artifacts,
      }
    } finally {
      await studentContext.close()
    }
  },
}
