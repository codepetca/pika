import { chromium, BrowserContext, Locator, Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync } from 'fs'
import { copyFile, rename } from 'fs/promises'
import { basename, resolve } from 'path'

type CapturePacingMode = 'normal' | 'slow'

type CapturePacingProfile = {
  typingDelayMs: number
  preClickPauseMs: number
  mouseMoveBaseMs: number
  mouseMoveMaxMs: number
  mouseMoveStepBase: number
  holdMs: number
  settleMs: number
  shortPauseMs: number
  mediumPauseMs: number
  longPauseMs: number
}

const WORKTREE = process.cwd()
const BASE_URL = process.env.CAPTURE_BASE_URL || 'http://localhost:3017'
const ENV_FILE = process.env.ENV_FILE || '.env.local'
const CLASS_CODE = process.env.CAPTURE_CLASS_CODE || 'MKT101'
const CLASSROOM_ID_OVERRIDE = process.env.CAPTURE_CLASSROOM_ID
const CAPTURE_TEACHER_EMAIL = process.env.CAPTURE_TEACHER_EMAIL || 'teacher.marketing@example.com'
const CLASSROOM_TITLE = process.env.CAPTURE_CLASSROOM_TITLE || 'Pika Demo - English 10'
const ASSIGNMENT_TITLE = process.env.CAPTURE_ASSIGNMENT_TITLE || 'Personal Narrative: A Moment That Changed Me'
const CAPTURE_PASSWORD = process.env.CAPTURE_PASSWORD || 'test1234'
const FORCE_LEFT_SIDEBAR_EXPANDED = process.env.CAPTURE_LEFT_SIDEBAR_EXPANDED === 'true'
const FORCE_DARK_MODE = process.env.CAPTURE_DARK_MODE === 'true'
const CAPTURE_ALLOW_LOCAL = process.env.CAPTURE_ALLOW_LOCAL_MARKETING === 'true'
const CAPTURE_PACING_MODE = (process.env.CAPTURE_PACING_MODE || 'normal').toLowerCase() as CapturePacingMode

const PACING_BY_MODE: Record<CapturePacingMode, CapturePacingProfile> = {
  normal: {
    typingDelayMs: 62,
    preClickPauseMs: 220,
    mouseMoveBaseMs: 350,
    mouseMoveMaxMs: 900,
    mouseMoveStepBase: 22,
    holdMs: 110,
    settleMs: 760,
    shortPauseMs: 820,
    mediumPauseMs: 1500,
    longPauseMs: 2600,
  },
  slow: {
    typingDelayMs: 86,
    preClickPauseMs: 360,
    mouseMoveBaseMs: 540,
    mouseMoveMaxMs: 1300,
    mouseMoveStepBase: 34,
    holdMs: 150,
    settleMs: 1100,
    shortPauseMs: 1100,
    mediumPauseMs: 2100,
    longPauseMs: 3400,
  },
}

const AUTH_DIR = resolve(WORKTREE, '.auth')
const TEACHER_STORAGE = resolve(AUTH_DIR, 'teacher.json')
const STUDENT_STORAGE = resolve(AUTH_DIR, 'student.json')
const OUT_DIR = resolve(WORKTREE, 'artifacts', 'marketing', 'video')
const RAW_DIR = resolve(OUT_DIR, 'raw')
const CURSOR_POSITION = new WeakMap<Page, { x: number; y: number }>()

config({ path: resolve(WORKTREE, ENV_FILE) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

const PACING = PACING_BY_MODE[CAPTURE_PACING_MODE] || PACING_BY_MODE.normal

mkdirSync(RAW_DIR, { recursive: true })

function assertNonLocalCaptureBaseUrl() {
  let parsed: URL
  try {
    parsed = new URL(BASE_URL)
  } catch {
    throw new Error(`Invalid CAPTURE_BASE_URL: "${BASE_URL}"`)
  }

  const hostname = parsed.hostname.toLowerCase()
  const localHosts = new Set(['localhost', '127.0.0.1', '::1'])

  if (localHosts.has(hostname) && !CAPTURE_ALLOW_LOCAL) {
    throw new Error(
      `Marketing capture is locked to non-local URLs. Current CAPTURE_BASE_URL="${BASE_URL}". ` +
        `Set CAPTURE_ALLOW_LOCAL_MARKETING=true only if you intentionally want local capture.`
    )
  }
}

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function withVariance(baseMs: number, varianceFraction = 0.12, minimumMs = 40) {
  const variance = baseMs * varianceFraction
  const randomized = baseMs + randomBetween(-variance, variance)
  return Math.max(minimumMs, Math.round(randomized))
}

async function humanPause(page: Page, baseMs: number, varianceFraction = 0.12) {
  await page.waitForTimeout(withVariance(baseMs, varianceFraction))
}

async function setCursorOverlayPosition(page: Page, x: number, y: number) {
  await page.evaluate(
    ([cursorX, cursorY]) => {
      ;(window as typeof window & { __marketingCursorMove?: (x: number, y: number) => void }).__marketingCursorMove?.(
        cursorX,
        cursorY
      )
    },
    [x, y] as const
  )
}

async function animateCursorTo(page: Page, targetX: number, targetY: number) {
  const start = CURSOR_POSITION.get(page) || { x: 80, y: 80 }
  const waypoints = [
    {
      x: start.x + (targetX - start.x) * 0.45 + randomBetween(-24, 24),
      y: start.y + (targetY - start.y) * 0.45 + randomBetween(-18, 18),
    },
    {
      x: targetX + randomBetween(-10, 10),
      y: targetY + randomBetween(-8, 8),
    },
    { x: targetX, y: targetY },
  ]

  let previous = start
  for (const waypoint of waypoints) {
    const distance = Math.hypot(waypoint.x - previous.x, waypoint.y - previous.y)
    const duration = Math.min(PACING.mouseMoveMaxMs, PACING.mouseMoveBaseMs + distance * 0.95)
    const steps = Math.max(10, Math.round(PACING.mouseMoveStepBase + distance / 80))

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      const eased = t * t * (3 - 2 * t)
      const jitterScale = (1 - t) * 0.9
      const x = previous.x + (waypoint.x - previous.x) * eased + randomBetween(-1.4, 1.4) * jitterScale
      const y = previous.y + (waypoint.y - previous.y) * eased + randomBetween(-1.4, 1.4) * jitterScale

      await page.mouse.move(x, y)
      await setCursorOverlayPosition(page, x, y)
      await page.waitForTimeout(Math.max(8, Math.round(duration / steps)))
    }

    previous = waypoint
  }

  CURSOR_POSITION.set(page, { x: targetX, y: targetY })
}

async function resolveClassroomId() {
  if (CLASSROOM_ID_OVERRIDE) return CLASSROOM_ID_OVERRIDE

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false },
  })

  const { data: teacher, error: teacherError } = await supabase
    .from('users')
    .select('id,email')
    .eq('email', CAPTURE_TEACHER_EMAIL)
    .single()

  if (teacherError || !teacher) {
    throw new Error(`Could not find teacher by email "${CAPTURE_TEACHER_EMAIL}"`)
  }

  const { data, error } = await supabase
    .from('classrooms')
    .select('id')
    .eq('class_code', CLASS_CODE)
    .eq('teacher_id', teacher.id)
    .single()

  if (error || !data) {
    throw new Error(`Could not find classroom by code "${CLASS_CODE}"`) 
  }

  return data.id
}

async function applyForcedVisualMode(context: BrowserContext) {
  if (FORCE_LEFT_SIDEBAR_EXPANDED) {
    await context.addCookies([
      {
        name: 'pika_left_sidebar',
        value: 'expanded',
        url: BASE_URL,
      },
    ])
  }

  if (FORCE_DARK_MODE) {
    await context.addInitScript(() => {
      localStorage.setItem('theme', 'dark')
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
      document.documentElement.style.backgroundColor = '#030712'
    })
  }
}

async function clickFirstIfPresent(page: Page, selectorName: string, action: () => Promise<void>) {
  try {
    await action()
  } catch {
    console.warn(`Skipping optional action: ${selectorName}`)
  }
}

async function typeSlowly(locator: Locator, text: string) {
  await locator.click({ timeout: 10_000 })
  await locator.fill('')
  await locator.type(text, { delay: PACING.typingDelayMs })
}

async function ensureCursorOverlay(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById('marketing-cursor')) return
    if (!document.body) return

    const style = document.createElement('style')
    style.id = 'marketing-cursor-style'
    style.innerHTML = `
      #marketing-cursor {
        position: fixed;
        width: 26px;
        height: 26px;
        border-radius: 9999px;
        border: 3px solid rgba(37, 99, 235, 0.98);
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.25), 0 4px 12px rgba(15, 23, 42, 0.35);
        z-index: 2147483647;
        pointer-events: none;
        transform: translate(-50%, -50%);
        transition: transform 120ms ease-out;
      }
      #marketing-cursor::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background: rgba(37, 99, 235, 0.95);
        transform: translate(-50%, -50%);
      }
      .marketing-click-ring {
        position: fixed;
        width: 44px;
        height: 44px;
        border-radius: 9999px;
        border: 3px solid rgba(37, 99, 235, 0.92);
        box-shadow: 0 0 0 2px rgba(147, 197, 253, 0.4);
        pointer-events: none;
        z-index: 2147483646;
        transform: translate(-50%, -50%) scale(0.35);
        animation: marketingClickPulse 650ms ease-out forwards;
      }
      @keyframes marketingClickPulse {
        to {
          opacity: 0;
          transform: translate(-50%, -50%) scale(2);
        }
      }
    `

    if (!document.getElementById('marketing-cursor-style')) {
      document.head.appendChild(style)
    }

    const cursor = document.createElement('div')
    cursor.id = 'marketing-cursor'
    cursor.style.left = '80px'
    cursor.style.top = '80px'
    document.body.appendChild(cursor)

    const w = window as { [key: string]: unknown }
    w.__marketingCursorMove = (x: number, y: number) => {
      cursor.style.left = `${x}px`
      cursor.style.top = `${y}px`
    }
    w.__marketingCursorClick = (x: number, y: number) => {
      const ring = document.createElement('div')
      ring.className = 'marketing-click-ring'
      ring.style.left = `${x}px`
      ring.style.top = `${y}px`
      document.body?.appendChild(ring)
      setTimeout(() => ring.remove(), 700)
    }
  })
  if (!CURSOR_POSITION.has(page)) {
    CURSOR_POSITION.set(page, { x: 80, y: 80 })
  }
}

async function clickWithMouse(
  page: Page,
  target: Locator,
  options?: { timeout?: number; holdMs?: number; settleMs?: number }
) {
  const timeout = options?.timeout ?? 20_000
  const holdMs = options?.holdMs ?? PACING.holdMs
  const settleMs = options?.settleMs ?? PACING.settleMs
  const locator = target.first()

  await locator.waitFor({ state: 'visible', timeout })
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Could not determine click target position')
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await animateCursorTo(page, x, y)
  await humanPause(page, PACING.preClickPauseMs)
  await page.evaluate(
    ([cursorX, cursorY]) => {
      ;(window as typeof window & { __marketingCursorClick?: (x: number, y: number) => void }).__marketingCursorClick?.(cursorX, cursorY)
    },
    [x, y] as const
  )
  await page.mouse.down()
  await humanPause(page, holdMs, 0.08)
  await page.mouse.up()
  await humanPause(page, settleMs, 0.1)
}

async function withRecordedContext(
  storagePath: string | undefined,
  outputFileName: string,
  action: (page: Page, classroomId: string) => Promise<void>,
  classroomId: string
) {
  const browser = await chromium.launch({ headless: true, slowMo: 140 })
  const context = await browser.newContext({
    ...(storagePath ? { storageState: storagePath } : {}),
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: RAW_DIR,
      size: { width: 1440, height: 900 },
    },
  })

  await applyForcedVisualMode(context)

  const page = await context.newPage()
  const video = page.video()

  await action(page, classroomId)
  await humanPause(page, PACING.shortPauseMs)

  await context.close()
  await browser.close()

  const sourcePath = await video?.path()
  if (!sourcePath) {
    throw new Error(`No recorded video generated for ${outputFileName}`)
  }

  const destination = resolve(RAW_DIR, outputFileName)
  try {
    await rename(sourcePath, destination)
  } catch {
    await copyFile(sourcePath, destination)
  }

  console.log(`Recorded: ${destination}`)
}

async function recordLoginFlow(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
  await ensureCursorOverlay(page)
  await page.waitForSelector('text=Login to Pika', { timeout: 45_000 })
  await humanPause(page, PACING.shortPauseMs)

  const emailInput = page.getByLabel(/School Email/i)
  const passwordInput = page.getByLabel(/Password/i)
  await emailInput.waitFor({ timeout: 15_000 })
  await typeSlowly(emailInput, CAPTURE_TEACHER_EMAIL)
  await humanPause(page, PACING.shortPauseMs * 0.35)
  await typeSlowly(passwordInput, CAPTURE_PASSWORD)
  await clickWithMouse(page, page.getByRole('button', { name: /^Login$/i }), {
    timeout: 15_000,
    settleMs: withVariance(PACING.mediumPauseMs * 0.7, 0.08),
  })
  await page.waitForURL(/\/classrooms/, { timeout: 45_000, waitUntil: 'domcontentloaded' })

  await page.waitForSelector('text=Classrooms', { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)
}

async function recordTeacherFlow(page: Page, classroomId: string) {
  await page.goto(`${BASE_URL}/classrooms`, { waitUntil: 'domcontentloaded' })
  await ensureCursorOverlay(page)
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickFirstIfPresent(page, 'teacher classroom card click', async () => {
    await clickWithMouse(page, page.getByText(CLASSROOM_TITLE), { timeout: 15_000, settleMs: 1200 })
  })

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=today`, { waitUntil: 'domcontentloaded' })
  await ensureCursorOverlay(page)
  await page.waitForSelector('text=Log Summary', { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs + 300)

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=assignments`, { waitUntil: 'domcontentloaded' })
  await ensureCursorOverlay(page)
  await page.waitForSelector(`text=${ASSIGNMENT_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickWithMouse(page, page.getByText(ASSIGNMENT_TITLE), { timeout: 45_000, settleMs: 1300 })
  await page.waitForSelector('text=First Name', { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickFirstIfPresent(page, 'select Ava row', async () => {
    await clickWithMouse(page, page.getByRole('cell', { name: 'Ava', exact: true }), { timeout: 20_000, settleMs: 1000 })
  })

  await clickFirstIfPresent(page, 'switch to Grading tab', async () => {
    await clickWithMouse(page, page.getByRole('tab', { name: /Grading/i }), { timeout: 10_000, settleMs: 1200 })
  })

  await page.waitForSelector('text=Completion', { timeout: 45_000 })
  await humanPause(page, PACING.longPauseMs)
}

async function recordStudentFlow(page: Page, classroomId: string) {
  await page.goto(`${BASE_URL}/classrooms`, { waitUntil: 'domcontentloaded' })
  await ensureCursorOverlay(page)
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickFirstIfPresent(page, 'student classroom card click', async () => {
    await clickWithMouse(page, page.getByText(CLASSROOM_TITLE), { timeout: 15_000, settleMs: 1000 })
  })

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=today`, { waitUntil: 'domcontentloaded' })
  await ensureCursorOverlay(page)
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=assignments`, { waitUntil: 'domcontentloaded' })
  await ensureCursorOverlay(page)
  await page.waitForSelector('text=Returned', { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickFirstIfPresent(page, 'student returned work click', async () => {
    await clickWithMouse(page, page.getByText(ASSIGNMENT_TITLE), { timeout: 30_000, settleMs: 2300 })
  })
}

async function run() {
  assertNonLocalCaptureBaseUrl()
  console.log(`Walkthrough capture base URL: ${BASE_URL}`)
  console.log(`Pacing mode: ${CAPTURE_PACING_MODE}`)

  const classroomId = await resolveClassroomId()

  await withRecordedContext(undefined, 'login-flow.webm', recordLoginFlow, classroomId)
  await withRecordedContext(TEACHER_STORAGE, 'teacher-flow.webm', recordTeacherFlow, classroomId)
  await withRecordedContext(STUDENT_STORAGE, 'student-flow.webm', recordStudentFlow, classroomId)

  console.log(`Walkthrough raw clips ready in ${RAW_DIR}`)
  console.log(`Next: render final outputs with scripts/marketing/render-video.sh`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
