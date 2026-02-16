import { chromium, BrowserContext, Locator, Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync } from 'fs'
import { copyFile, rename } from 'fs/promises'
import { basename, resolve } from 'path'

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

const AUTH_DIR = resolve(WORKTREE, '.auth')
const TEACHER_STORAGE = resolve(AUTH_DIR, 'teacher.json')
const STUDENT_STORAGE = resolve(AUTH_DIR, 'student.json')
const OUT_DIR = resolve(WORKTREE, 'artifacts', 'marketing', 'video')
const RAW_DIR = resolve(OUT_DIR, 'raw')

config({ path: resolve(WORKTREE, ENV_FILE) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

mkdirSync(RAW_DIR, { recursive: true })

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
  await locator.type(text, { delay: 60 })
}

async function installCursorOverlay(page: Page) {
  await page.addInitScript(() => {
    if (document.getElementById('marketing-cursor')) return

    const style = document.createElement('style')
    style.innerHTML = `
      #marketing-cursor {
        position: fixed;
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        border: 2px solid rgba(37, 99, 235, 0.95);
        background: rgba(255, 255, 255, 0.95);
        box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.3);
        z-index: 2147483647;
        pointer-events: none;
        transform: translate(-50%, -50%);
        transition: transform 80ms ease-out;
      }
      .marketing-click-ring {
        position: fixed;
        width: 28px;
        height: 28px;
        border-radius: 9999px;
        border: 2px solid rgba(37, 99, 235, 0.7);
        pointer-events: none;
        z-index: 2147483646;
        transform: translate(-50%, -50%) scale(0.3);
        animation: marketingClickPulse 360ms ease-out forwards;
      }
      @keyframes marketingClickPulse {
        to {
          opacity: 0;
          transform: translate(-50%, -50%) scale(1.25);
        }
      }
    `
    document.head.appendChild(style)

    const cursor = document.createElement('div')
    cursor.id = 'marketing-cursor'
    cursor.style.left = '-100px'
    cursor.style.top = '-100px'
    document.body.appendChild(cursor)

    document.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`
      cursor.style.top = `${event.clientY}px`
    })

    document.addEventListener('mousedown', (event) => {
      const ring = document.createElement('div')
      ring.className = 'marketing-click-ring'
      ring.style.left = `${event.clientX}px`
      ring.style.top = `${event.clientY}px`
      document.body.appendChild(ring)
      setTimeout(() => ring.remove(), 450)
    })
  })
}

async function clickWithMouse(
  page: Page,
  target: Locator,
  options?: { timeout?: number; holdMs?: number; settleMs?: number }
) {
  const timeout = options?.timeout ?? 20_000
  const holdMs = options?.holdMs ?? 70
  const settleMs = options?.settleMs ?? 500
  const locator = target.first()

  await locator.waitFor({ state: 'visible', timeout })
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Could not determine click target position')
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y, { steps: 22 })
  await page.waitForTimeout(180)
  await page.mouse.down()
  await page.waitForTimeout(holdMs)
  await page.mouse.up()
  await page.waitForTimeout(settleMs)
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
  await installCursorOverlay(page)
  const video = page.video()

  await action(page, classroomId)
  await page.waitForTimeout(1000)

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
  await page.waitForSelector('text=Login to Pika', { timeout: 45_000 })
  await page.waitForTimeout(700)

  let loggedIn = false
  try {
    await clickWithMouse(page, page.getByRole('button', { name: /^Teacher$/i }), {
      timeout: 20_000,
      settleMs: 1200,
    })
    await page.waitForURL(/\/classrooms/, { timeout: 12_000, waitUntil: 'domcontentloaded' })
    loggedIn = true
  } catch {
    console.warn('Quick login not available, falling back to typed login')
  }

  if (!loggedIn) {
    const emailInput = page.getByLabel(/School Email/i)
    const passwordInput = page.getByLabel(/Password/i)
    await emailInput.waitFor({ timeout: 15_000 })
    await typeSlowly(emailInput, CAPTURE_TEACHER_EMAIL)
    await typeSlowly(passwordInput, CAPTURE_PASSWORD)
    await clickWithMouse(page, page.getByRole('button', { name: /^Login$/i }), {
      timeout: 15_000,
      settleMs: 1400,
    })
    await page.waitForURL(/\/classrooms/, { timeout: 45_000, waitUntil: 'domcontentloaded' })
  }

  await page.waitForSelector('text=Classrooms', { timeout: 45_000 })
  await page.waitForTimeout(1800)
}

async function recordTeacherFlow(page: Page, classroomId: string) {
  await page.goto(`${BASE_URL}/classrooms`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await page.waitForTimeout(1600)

  await clickFirstIfPresent(page, 'teacher classroom card click', async () => {
    await clickWithMouse(page, page.getByText(CLASSROOM_TITLE), { timeout: 15_000, settleMs: 1200 })
  })

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=today`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Log Summary', { timeout: 45_000 })
  await page.waitForTimeout(1900)

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=assignments`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${ASSIGNMENT_TITLE}`, { timeout: 45_000 })
  await page.waitForTimeout(1600)

  await clickWithMouse(page, page.getByText(ASSIGNMENT_TITLE), { timeout: 45_000, settleMs: 1300 })
  await page.waitForSelector('text=First Name', { timeout: 45_000 })
  await page.waitForTimeout(1500)

  await clickFirstIfPresent(page, 'select Ava row', async () => {
    await clickWithMouse(page, page.getByRole('cell', { name: 'Ava', exact: true }), { timeout: 20_000, settleMs: 1000 })
  })

  await clickFirstIfPresent(page, 'switch to Grading tab', async () => {
    await clickWithMouse(page, page.getByRole('tab', { name: /Grading/i }), { timeout: 10_000, settleMs: 1200 })
  })

  await page.waitForSelector('text=Completion', { timeout: 45_000 })
  await page.waitForTimeout(3000)
}

async function recordStudentFlow(page: Page, classroomId: string) {
  await page.goto(`${BASE_URL}/classrooms`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await page.waitForTimeout(1500)

  await clickFirstIfPresent(page, 'student classroom card click', async () => {
    await clickWithMouse(page, page.getByText(CLASSROOM_TITLE), { timeout: 15_000, settleMs: 1000 })
  })

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=today`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${CLASSROOM_TITLE}`, { timeout: 45_000 })
  await page.waitForTimeout(1600)

  await page.goto(`${BASE_URL}/classrooms/${classroomId}?tab=assignments`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Returned', { timeout: 45_000 })
  await page.waitForTimeout(1600)

  await clickFirstIfPresent(page, 'student returned work click', async () => {
    await clickWithMouse(page, page.getByText(ASSIGNMENT_TITLE), { timeout: 30_000, settleMs: 2300 })
  })
}

async function run() {
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
