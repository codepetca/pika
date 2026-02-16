import { request } from '@playwright/test'
import { mkdirSync } from 'fs'
import { resolve } from 'path'

const WORKTREE = process.cwd()
const BASE_URL = process.env.CAPTURE_BASE_URL || 'http://localhost:3017'
const TEACHER_EMAIL = process.env.CAPTURE_TEACHER_EMAIL || 'teacher.marketing@example.com'
const STUDENT_EMAIL = process.env.CAPTURE_STUDENT_EMAIL || 'ava.chen@example.com'
const PASSWORD = process.env.CAPTURE_PASSWORD || 'test1234'
const AUTH_DIR = resolve(WORKTREE, '.auth')
const TEACHER_STORAGE = resolve(AUTH_DIR, 'teacher.json')
const STUDENT_STORAGE = resolve(AUTH_DIR, 'student.json')

mkdirSync(AUTH_DIR, { recursive: true })

async function loginAndStore(email: string, storagePath: string) {
  const apiContext = await request.newContext({ baseURL: BASE_URL })
  const response = await apiContext.post('/api/auth/login', {
    data: {
      email,
      password: PASSWORD,
    },
  })

  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed login for ${email}: ${response.status()} ${body}`)
  }

  const meResponse = await apiContext.get('/api/auth/me')
  if (!meResponse.ok()) {
    throw new Error(`Auth verification failed for ${email}: ${meResponse.status()}`)
  }

  await apiContext.storageState({ path: storagePath })
  await apiContext.dispose()
  console.log(`Auth saved: ${storagePath}`)
}

async function run() {
  await loginAndStore(TEACHER_EMAIL, TEACHER_STORAGE)
  await loginAndStore(STUDENT_EMAIL, STUDENT_STORAGE)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
