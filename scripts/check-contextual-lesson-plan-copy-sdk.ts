// Only the local synthetic harness invokes this while holding its fixture lock.
// No schema applications or successful content writes are performed here.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { copyContextualLessonPlan } from '../src/lib/server/contextual-lesson-plan-copy-mutation'

async function main() {
  const [owner, outsider, classroom, fromDate, toDate, conflictOnly] = process.argv.slice(2)
  for (const value of [owner, outsider, classroom]) assert.match(value, /^[a-f0-9-]{36}$/i)
  for (const value of [fromDate, toDate]) assert.match(value, /^\d{4}-\d{2}-\d{2}$/)
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  assert.equal(typeof status.ANON_KEY, 'string')
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.ANON_KEY
  process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY
  const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const fixture = await client.from('classrooms').select('id,teacher_id,title,class_code')
    .eq('id', classroom).eq('teacher_id', owner).maybeSingle()
  assert.equal(fixture.error, null)
  assert(fixture.data && /^lesson_copy_[a-f0-9]{8} student$/.test(fixture.data.title))
  const tag = fixture.data.title.slice(0, -' student'.length)
  assert.equal(fixture.data.class_code, `${tag}_s`)
  const identities = await client.from('users').select('id,email').in('id', [owner, outsider])
  assert.equal(identities.error, null)
  assert(identities.data?.some((user) => user.id === owner && user.email === `${tag}_student@example.invalid`))
  assert(identities.data?.some((user) => user.id === outsider && user.email === `${tag}_outsider@example.invalid`))
  const missingClassroom = randomUUID()
  const missing = await client.rpc('copy_lesson_plan_for_owner_v1', {
    p_actor_id: owner, p_classroom_id: missingClassroom, p_from_date: fromDate, p_to_date: toDate,
  })
  assert.equal(missing.data, null)
  assert.equal(missing.error?.code, 'P0002')
  assert.equal(missing.error?.details, null)
  assert.equal(missing.error?.hint, null)
  async function expectMapped(actorId: string, classroomId: string, expectedStatus: number, source = fromDate) {
    await assert.rejects(copyContextualLessonPlan({ actorId, classroomId, fromDate: source, toDate }),
      (error: unknown) => error instanceof ApiError && error.statusCode === expectedStatus)
  }
  if (conflictOnly !== 'conflict-only') {
    await expectMapped(owner, missingClassroom, 404)
    await expectMapped(outsider, classroom, 403)
  }
  await expectMapped(owner, classroom, 409)
  process.stdout.write(`PASS live copy SDK nullable error envelope and ${conflictOnly === 'conflict-only' ? '409' : '404, 403 and 409'} mappings\n`)
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
