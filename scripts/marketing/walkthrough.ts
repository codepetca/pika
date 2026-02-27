import { chromium, BrowserContext, Locator, Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync, readFileSync } from 'fs'
import { copyFile, rename } from 'fs/promises'
import { basename, resolve } from 'path'

type CapturePacingMode = 'normal' | 'slow'
type CursorVariant = 'auto' | 'light' | 'dark'
type OutputVariant = 'light' | 'dark'

type CapturePacingProfile = {
  typingDelayMs: number
  preActionPauseMs: number
  preClickPauseMs: number
  postActionPauseMs: number
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
const CAPTURE_CURSOR_VARIANT = (process.env.CAPTURE_CURSOR_VARIANT || 'auto').toLowerCase() as CursorVariant
const CAPTURE_OUTPUT_SUFFIX = process.env.CAPTURE_OUTPUT_SUFFIX

const PACING_BY_MODE: Record<CapturePacingMode, CapturePacingProfile> = {
  normal: {
    typingDelayMs: 56,
    preActionPauseMs: 280,
    preClickPauseMs: 340,
    postActionPauseMs: 220,
    mouseMoveBaseMs: 165,
    mouseMoveMaxMs: 520,
    mouseMoveStepBase: 9,
    holdMs: 110,
    settleMs: 760,
    shortPauseMs: 820,
    mediumPauseMs: 1500,
    longPauseMs: 2600,
  },
  slow: {
    typingDelayMs: 74,
    preActionPauseMs: 420,
    preClickPauseMs: 520,
    postActionPauseMs: 340,
    mouseMoveBaseMs: 230,
    mouseMoveMaxMs: 700,
    mouseMoveStepBase: 12,
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
const CURSOR_LIGHT_SVG_ASSET_PATH = resolve(WORKTREE, 'scripts', 'marketing', 'assets', 'macos-like-pointer.svg')
const CURSOR_DARK_SVG_ASSET_PATH = resolve(WORKTREE, 'scripts', 'marketing', 'assets', 'macos-like-pointer-on-dark.svg')
const CURSOR_POSITION = new WeakMap<Page, { x: number; y: number }>()

config({ path: resolve(WORKTREE, ENV_FILE) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

const PACING = PACING_BY_MODE[CAPTURE_PACING_MODE] || PACING_BY_MODE.normal

mkdirSync(RAW_DIR, { recursive: true })

function normalizeOutputSuffix(value: string | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.startsWith('-') ? trimmed : `-${trimmed}`
}

function resolveOutputSuffix() {
  const explicit = normalizeOutputSuffix(CAPTURE_OUTPUT_SUFFIX)
  if (explicit) return explicit
  const variant: OutputVariant = FORCE_DARK_MODE ? 'dark' : 'light'
  return `-${variant}`
}

const OUTPUT_SUFFIX = resolveOutputSuffix()

function resolveCursorSvgMarkup() {
  const effectiveVariant: Exclude<CursorVariant, 'auto'> =
    CAPTURE_CURSOR_VARIANT === 'auto' ? (FORCE_DARK_MODE ? 'dark' : 'light') : CAPTURE_CURSOR_VARIANT
  const preferredPath = effectiveVariant === 'dark' ? CURSOR_DARK_SVG_ASSET_PATH : CURSOR_LIGHT_SVG_ASSET_PATH
  const fallbackPath = effectiveVariant === 'dark' ? CURSOR_LIGHT_SVG_ASSET_PATH : CURSOR_DARK_SVG_ASSET_PATH
  try {
    return readFileSync(preferredPath, 'utf8')
  } catch {
    try {
      return readFileSync(fallbackPath, 'utf8')
    } catch {
      return ''
    }
  }
}

const CURSOR_SVG_MARKUP = resolveCursorSvgMarkup()

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
  const snappedX = Math.round(x)
  const snappedY = Math.round(y)
  await page.evaluate(
    ([cursorX, cursorY]) => {
      ;(window as typeof window & { __marketingCursorMove?: (x: number, y: number) => void }).__marketingCursorMove?.(
        cursorX,
        cursorY
      )
    },
    [snappedX, snappedY] as const
  )
}

async function animateCursorTo(page: Page, targetX: number, targetY: number) {
  const start = CURSOR_POSITION.get(page) || { x: 80, y: 80 }
  const dx = targetX - start.x
  const dy = targetY - start.y
  const distance = Math.hypot(dx, dy)
  const nx = distance > 0 ? -dy / distance : 0
  const ny = distance > 0 ? dx / distance : 0
  const curve = Math.min(14, Math.max(4, distance * 0.045)) * (Math.random() > 0.5 ? 1 : -1)
  const control = {
    x: start.x + dx * 0.5 + nx * curve,
    y: start.y + dy * 0.5 + ny * curve,
  }
  const duration = Math.min(PACING.mouseMoveMaxMs, PACING.mouseMoveBaseMs + distance * 0.5)
  const steps = Math.max(18, Math.round(PACING.mouseMoveStepBase + distance / 14))

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps
    const eased = t * t * (3 - 2 * t)
    const inv = 1 - eased
    const jitterScale = 1 - eased
    const x = inv * inv * start.x + 2 * inv * eased * control.x + eased * eased * targetX + randomBetween(-0.45, 0.45) * jitterScale
    const y = inv * inv * start.y + 2 * inv * eased * control.y + eased * eased * targetY + randomBetween(-0.45, 0.45) * jitterScale

    await page.mouse.move(x, y)
    await setCursorOverlayPosition(page, x, y)
    await page.waitForTimeout(Math.max(10, Math.round(duration / steps)))
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

async function typeSlowly(page: Page, locator: Locator, text: string) {
  await humanPause(locator.page(), PACING.preActionPauseMs, 0.1)
  await clickWithMouse(page, locator, { timeout: 10_000, settleMs: withVariance(PACING.postActionPauseMs, 0.08, 70) })
  await locator.fill('')
  await locator.type(text, { delay: PACING.typingDelayMs })
  await humanPause(locator.page(), PACING.postActionPauseMs, 0.1)
}

async function ensureCursorOverlay(page: Page) {
  await page.evaluate((cursorSvgMarkup: string) => {
    if (document.getElementById('marketing-cursor')) return
    if (!document.body) return

    const style = document.createElement('style')
    style.id = 'marketing-cursor-style'
    style.innerHTML = `
      #marketing-cursor {
        position: fixed;
        width: 42px;
        height: 54px;
        z-index: 2147483647;
        pointer-events: none;
        transform: translate(-1px, -1px);
        transition: transform 120ms ease-out;
      }
      #marketing-cursor svg { width: 100%; height: 100%; display: block; }
      .marketing-click-ring {
        position: fixed;
        width: 56px;
        height: 56px;
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
    if (cursorSvgMarkup) {
      cursor.innerHTML = cursorSvgMarkup
    } else {
      cursor.innerHTML = `
        <svg viewBox="0 0 30 42" aria-hidden="true">
          <path d="M2 1.5L2 35.5L10.4 27L15.7 40L21.1 37.7L15.8 24.8H28L2 1.5Z" fill="#ffffff" stroke="#0f172a" stroke-width="2" stroke-linejoin="round" />
        </svg>
      `
    }
    cursor.style.left = '80px'
    cursor.style.top = '80px'
    document.body.appendChild(cursor)

    const w = window as { [key: string]: unknown }
    w.__marketingCursorMove = (x: number, y: number) => {
      cursor.style.left = `${Math.round(x)}px`
      cursor.style.top = `${Math.round(y)}px`
    }
    w.__marketingCursorClick = (x: number, y: number) => {
      const ring = document.createElement('div')
      ring.className = 'marketing-click-ring'
      ring.style.left = `${x}px`
      ring.style.top = `${y}px`
      document.body?.appendChild(ring)
      setTimeout(() => ring.remove(), 700)
    }
  }, CURSOR_SVG_MARKUP)
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

  await humanPause(page, PACING.preActionPauseMs, 0.1)
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

async function navigateWithHumanPause(page: Page, url: string) {
  await humanPause(page, PACING.preActionPauseMs, 0.1)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await humanPause(page, PACING.postActionPauseMs, 0.12)
}

async function clickByAccessibleName(page: Page, label: string, options?: { timeout?: number; settleMs?: number }) {
  const exactName = new RegExp(`^${label}$`, 'i')
  const looseName = new RegExp(label, 'i')
  const normalized = label.trim().toLowerCase()
  const structuralCandidates: Locator[] = []

  if (normalized === 'attendance') {
    structuralCandidates.push(page.locator('a[href*="tab=attendance"]').first(), page.locator('[data-tab="attendance"]').first())
  }
  if (normalized === 'assignments') {
    structuralCandidates.push(page.locator('a[href*="tab=assignments"]').first(), page.locator('[data-tab="assignments"]').first())
  }
  if (normalized === 'grading') {
    structuralCandidates.push(page.locator('button:has-text("Grading")').first(), page.locator('[role="tab"]:has-text("Grading")').first())
  }

  const candidates: Locator[] = [
    page.getByRole('button', { name: exactName }).first(),
    page.getByRole('link', { name: exactName }).first(),
    page.getByRole('button', { name: looseName }).first(),
    page.getByRole('link', { name: looseName }).first(),
    page.locator(`[aria-label*="${label}"]`).first(),
    page.locator(`[title*="${label}"]`).first(),
    page.getByText(exactName).first(),
    ...structuralCandidates,
  ]

  for (const candidate of candidates) {
    if ((await candidate.count()) > 0) {
      try {
        await clickWithMouse(page, candidate, { timeout: options?.timeout ?? 8_000, settleMs: options?.settleMs })
        return
      } catch {
        continue
      }
    }
  }

  throw new Error(`Could not click UI control "${label}"`)
}

async function clickTextInLeftPane(
  page: Page,
  text: string | RegExp,
  options?: { timeout?: number; settleMs?: number }
) {
  const matches = typeof text === 'string' ? page.getByText(text) : page.getByText(text)
  const count = await matches.count()
  const viewport = page.viewportSize()
  const leftBoundary = viewport ? viewport.width * 0.5 : 720

  for (let i = 0; i < count; i += 1) {
    const candidate = matches.nth(i)
    const box = await candidate.boundingBox()
    if (!box) continue
    const centerX = box.x + box.width / 2
    if (centerX > leftBoundary) continue
    await clickWithMouse(page, candidate, { timeout: options?.timeout ?? 12_000, settleMs: options?.settleMs })
    return
  }

  throw new Error(`Could not click left-pane text target "${String(text)}"`)
}

async function waitForVisibleAny(page: Page, selectors: string[], timeoutMs = 45_000) {
  const startedAt = Date.now()
  const pollMs = 180
  while (Date.now() - startedAt < timeoutMs) {
    for (const selector of selectors) {
      const node = page.locator(selector).first()
      if ((await node.count()) === 0) continue
      if (await node.isVisible().catch(() => false)) return selector
    }
    await page.waitForTimeout(pollMs)
  }
  throw new Error(`Timed out waiting for any of: ${selectors.join(', ')}`)
}

async function findVisibleLeftPaneTableRow(page: Page, timeoutMs = 45_000) {
  const startedAt = Date.now()
  const viewport = page.viewportSize()
  const leftBoundary = viewport ? viewport.width * 0.5 : 720

  while (Date.now() - startedAt < timeoutMs) {
    const rows = page.locator('table tbody tr')
    const count = await rows.count()
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i)
      const box = await row.boundingBox()
      if (!box) continue
      const centerX = box.x + box.width / 2
      if (centerX > leftBoundary) continue
      if (box.height < 8 || box.width < 80) continue
      return row
    }
    await page.waitForTimeout(180)
  }

  throw new Error('No visible left-pane table row was found before timeout')
}

async function waitForTeacherAttendanceList(page: Page) {
  await findVisibleLeftPaneTableRow(page, 45_000)
}

async function withRecordedContext(
  storagePath: string | undefined,
  outputFileName: string,
  action: (page: Page, classroomId: string) => Promise<void>,
  classroomId: string
) {
  const browser = await chromium.launch({ headless: true, slowMo: 0 })
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
  await navigateWithHumanPause(page, `${BASE_URL}/login`)
  await ensureCursorOverlay(page)
  await page.waitForSelector('text=Login to Pika', { timeout: 45_000 })
  await humanPause(page, PACING.shortPauseMs)

  const emailInput = page.getByLabel(/School Email/i)
  const passwordInput = page.getByLabel(/Password/i)
  await emailInput.waitFor({ timeout: 15_000 })
  await typeSlowly(page, emailInput, CAPTURE_TEACHER_EMAIL)
  await humanPause(page, PACING.shortPauseMs * 0.35)
  await typeSlowly(page, passwordInput, CAPTURE_PASSWORD)
  await clickWithMouse(page, page.getByRole('button', { name: /^Login$/i }), {
    timeout: 15_000,
    settleMs: withVariance(PACING.mediumPauseMs * 0.7, 0.08),
  })
  try {
    await page.waitForURL(/\/classrooms/, { timeout: 90_000, waitUntil: 'domcontentloaded' })
  } catch {
    await waitForVisibleAny(page, ['text=Classrooms', `text=${CLASSROOM_TITLE}`], 45_000)
  }

  await waitForVisibleAny(page, ['text=Classrooms', `text=${CLASSROOM_TITLE}`], 90_000)
  await humanPause(page, PACING.mediumPauseMs)
}

async function recordTeacherFlow(page: Page, classroomId: string) {
  await navigateWithHumanPause(page, `${BASE_URL}/classrooms`)
  await ensureCursorOverlay(page)
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickTextInLeftPane(page, CLASSROOM_TITLE, { timeout: 15_000, settleMs: 1200 })

  await page.waitForURL(new RegExp(`/classrooms/${classroomId}`), { timeout: 45_000, waitUntil: 'domcontentloaded' })
  await clickFirstIfPresent(page, 'Attendance', async () => {
    await clickByAccessibleName(page, 'Attendance', { timeout: 12_000, settleMs: 1100 })
  })
  await waitForTeacherAttendanceList(page)
  await humanPause(page, PACING.mediumPauseMs + 450)

  const attendanceRow = await findVisibleLeftPaneTableRow(page, 20_000)
  await clickWithMouse(page, attendanceRow, { timeout: 12_000, settleMs: 900 })

  await clickFirstIfPresent(page, 'Assignments', async () => {
    await clickByAccessibleName(page, 'Assignments', { timeout: 12_000, settleMs: 1100 })
  })
  if (!/tab=assignments/.test(page.url())) {
    await navigateWithHumanPause(page, `${BASE_URL}/classrooms/${classroomId}?tab=assignments`)
  }
  await page.waitForURL(/tab=assignments/, { timeout: 45_000, waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${ASSIGNMENT_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickTextInLeftPane(page, ASSIGNMENT_TITLE, { timeout: 45_000, settleMs: 1300 })
  await findVisibleLeftPaneTableRow(page, 45_000)
  const studentWorkRow = await findVisibleLeftPaneTableRow(page, 20_000)
  await clickWithMouse(page, studentWorkRow, { timeout: 20_000, settleMs: 1000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickByAccessibleName(page, 'Grading', { timeout: 12_000, settleMs: 1200 })

  await page.waitForSelector('text=Completion', { timeout: 45_000 })
  await humanPause(page, PACING.longPauseMs)
}

async function recordStudentFlow(page: Page, classroomId: string) {
  await navigateWithHumanPause(page, `${BASE_URL}/classrooms`)
  await ensureCursorOverlay(page)
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickTextInLeftPane(page, CLASSROOM_TITLE, { timeout: 15_000, settleMs: 1000 })

  await page.waitForURL(new RegExp(`/classrooms/${classroomId}`), { timeout: 45_000, waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickFirstIfPresent(page, 'Assignments', async () => {
    await clickByAccessibleName(page, 'Assignments', { timeout: 12_000, settleMs: 1200 })
  })
  if (!/tab=assignments/.test(page.url())) {
    await navigateWithHumanPause(page, `${BASE_URL}/classrooms/${classroomId}?tab=assignments`)
  }
  await page.waitForURL(/tab=assignments/, { timeout: 45_000, waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Returned', { timeout: 45_000 })
  await humanPause(page, PACING.mediumPauseMs)

  await clickTextInLeftPane(page, ASSIGNMENT_TITLE, { timeout: 30_000, settleMs: 2300 })
}

async function run() {
  assertNonLocalCaptureBaseUrl()
  console.log(`Walkthrough capture base URL: ${BASE_URL}`)
  console.log(`Pacing mode: ${CAPTURE_PACING_MODE}`)
  console.log(`Output suffix: ${OUTPUT_SUFFIX}`)

  const classroomId = await resolveClassroomId()

  await withRecordedContext(undefined, `login-flow${OUTPUT_SUFFIX}.webm`, recordLoginFlow, classroomId)
  await withRecordedContext(TEACHER_STORAGE, `teacher-flow${OUTPUT_SUFFIX}.webm`, recordTeacherFlow, classroomId)
  await withRecordedContext(STUDENT_STORAGE, `student-flow${OUTPUT_SUFFIX}.webm`, recordStudentFlow, classroomId)

  console.log(`Walkthrough raw clips ready in ${RAW_DIR}`)
  console.log(`Next: render final outputs with scripts/marketing/render-video.sh`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
