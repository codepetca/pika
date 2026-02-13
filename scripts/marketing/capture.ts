import { chromium, Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const BASE_URL = process.env.CAPTURE_BASE_URL || 'http://localhost:3017'
const WORKTREE = process.cwd()
const OUT_DIR = resolve(WORKTREE, 'artifacts', 'marketing', 'screens')
const teacherStorage = resolve(WORKTREE, '.auth', 'teacher.json')
const studentStorage = resolve(WORKTREE, '.auth', 'student.json')
const CLASS_CODE = process.env.CAPTURE_CLASS_CODE || 'MKT101'
const CLASSROOM_ID_OVERRIDE = process.env.CAPTURE_CLASSROOM_ID
const CAPTURE_TEACHER_EMAIL = process.env.CAPTURE_TEACHER_EMAIL || 'teacher.marketing@example.com'
const FORCE_LEFT_SIDEBAR_EXPANDED = process.env.CAPTURE_LEFT_SIDEBAR_EXPANDED === 'true'
const FORCE_DARK_MODE = process.env.CAPTURE_DARK_MODE === 'true'
const ENV_FILE = process.env.ENV_FILE || '.env.local'
config({ path: resolve(WORKTREE, ENV_FILE) })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

mkdirSync(OUT_DIR, { recursive: true })

type CaptureSpec = {
  name: string
  storagePath: string
  url: (classroomId: string) => string
  readyText: string
  readyTimeoutMs?: number
  action?: (page: Page) => Promise<void>
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
    .select('id,title,class_code,teacher_id')
    .eq('class_code', CLASS_CODE)
    .eq('teacher_id', teacher.id)
    .single()

  if (error || !data) {
    throw new Error(`Could not find classroom by code "${CLASS_CODE}"`)
  }

  return data.id
}

async function capture(spec: CaptureSpec, classroomId: string) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    storageState: spec.storagePath,
    viewport: { width: 1440, height: 900 },
  })

  if (FORCE_LEFT_SIDEBAR_EXPANDED) {
    await context.addCookies([
      {
        name: 'pika_left_sidebar',
        value: 'expanded',
        domain: 'localhost',
        path: '/',
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

  const page = await context.newPage()

  await page.goto(spec.url(classroomId), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(`text=${spec.readyText}`, { timeout: spec.readyTimeoutMs ?? 30_000 })
  await page.waitForTimeout(1200)

  if (FORCE_DARK_MODE) {
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
      document.documentElement.style.backgroundColor = '#030712'
    })
  }

  if (spec.action) {
    await spec.action(page)
    await page.waitForTimeout(1000)
  }

  const outputPath = resolve(OUT_DIR, `${spec.name}.png`)
  await page.screenshot({ path: outputPath, fullPage: false })
  await browser.close()
  console.log(`Captured: ${outputPath}`)
}

async function run() {
  const classroomId = await resolveClassroomId()
  const specs: CaptureSpec[] = [
    {
      name: 'teacher-classrooms-overview',
      storagePath: teacherStorage,
      url: () => `${BASE_URL}/classrooms`,
      readyText: 'Pika Demo - English 10',
    },
    {
      name: 'student-classrooms-overview',
      storagePath: studentStorage,
      url: () => `${BASE_URL}/classrooms`,
      readyText: 'Pika Demo - English 10',
    },
    {
      name: 'teacher-assignments-markdown',
      storagePath: teacherStorage,
      url: (id) => `${BASE_URL}/classrooms/${id}?tab=assignments`,
      readyText: 'Personal Narrative: A Moment That Changed Me',
    },
    {
      name: 'student-assignments-list',
      storagePath: studentStorage,
      url: (id) => `${BASE_URL}/classrooms/${id}?tab=assignments`,
      readyText: 'Returned',
    },
    {
      name: 'teacher-student-work-table',
      storagePath: teacherStorage,
      url: (id) => `${BASE_URL}/classrooms/${id}?tab=assignments`,
      readyText: 'Personal Narrative: A Moment That Changed Me',
      action: async (page) => {
        await page.getByText('Personal Narrative: A Moment That Changed Me').first().click()
        await page.waitForSelector('text=First Name', { timeout: 45_000 })
      },
    },
    {
      name: 'teacher-grading-pane',
      storagePath: teacherStorage,
      url: (id) => `${BASE_URL}/classrooms/${id}?tab=assignments`,
      readyText: 'Personal Narrative: A Moment That Changed Me',
      action: async (page) => {
        await page.getByText('Personal Narrative: A Moment That Changed Me').first().click()
        await page.waitForSelector('text=First Name', { timeout: 45_000 })
        await page.getByRole('cell', { name: 'Ava', exact: true }).click({ timeout: 45_000 })
        await page.waitForSelector('text=History', { timeout: 45_000 })
        const tabCount = await page.getByRole('tab', { name: /Grading/i }).count()
        if (tabCount > 0) {
          await page.getByRole('tab', { name: /Grading/i }).first().click({ timeout: 10_000 }).catch(() => undefined)
        }
        await page.waitForSelector('text=Completion', { timeout: 45_000 })
      },
    },
    {
      name: 'student-returned-work-detail',
      storagePath: studentStorage,
      url: (id) => `${BASE_URL}/classrooms/${id}?tab=assignments`,
      readyText: 'Returned',
      action: async (page) => {
        await page.getByText('Personal Narrative: A Moment That Changed Me').first().click()
        await page.waitForTimeout(1200)
      },
    },
    {
      name: 'teacher-attendance-overview',
      storagePath: teacherStorage,
      url: (id) => `${BASE_URL}/classrooms/${id}?tab=today`,
      readyText: 'Log Summary',
    },
    {
      name: 'student-today-checkin',
      storagePath: studentStorage,
      url: (id) => `${BASE_URL}/classrooms/${id}?tab=today`,
      readyText: 'Pika Demo - English 10',
    },
  ]

  for (const spec of specs) {
    await capture(spec, classroomId)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
