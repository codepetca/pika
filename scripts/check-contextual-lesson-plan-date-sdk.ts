// Invoked only by the local synthetic concurrency harness while its row lock is held.
// It performs denial checks against that synthetic classroom; it creates no rows.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { saveContextualLessonPlan } from '../src/lib/server/contextual-lesson-plan-mutation'

async function main() {
const [owner, outsider, classroom, date] = process.argv.slice(2)
for (const value of [owner, outsider, classroom]) assert.match(value, /^[a-f0-9-]{36}$/i)
assert.match(date, /^\d{4}-\d{2}-\d{2}$/)

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
assert.equal(status.API_URL, 'http://127.0.0.1:54321')
assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
assert.equal(typeof status.ANON_KEY, 'string')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.ANON_KEY
process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY

const content = { type: 'doc' as const, content: [] }
const missingClassroom = randomUUID()
const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
// Refuse arbitrary local classrooms: this probe deliberately attempts a save
// that the harness's row lock must deny, so its target must be our fixture.
const fixture = await client.from('classrooms').select('id,teacher_id,title,class_code')
  .eq('id', classroom).eq('teacher_id', owner).maybeSingle()
assert.equal(fixture.error, null)
assert(fixture.data && /^lesson_date_[a-f0-9]{8} student$/.test(fixture.data.title),
  'Expected a synthetic lesson-date classroom')
const fixtureTag = fixture.data.title.slice(0, -' student'.length)
assert.equal(fixture.data.class_code, `${fixtureTag}_s`)
const identities = await client.from('users').select('id,email').in('id', [owner, outsider])
assert.equal(identities.error, null)
assert(identities.data?.some(user => user.id === owner && user.email === `${fixtureTag}_student@example.invalid`),
  'Expected the synthetic owner')
assert(identities.data?.some(user => user.id === outsider && user.email === `${fixtureTag}_outsider@example.invalid`),
  'Expected the synthetic outsider')
const realEnvelope = await client.rpc('save_lesson_plan_for_owner_v1', {
  p_actor_id: owner,
  p_classroom_id: missingClassroom,
  p_date: date,
  p_content_markdown: 'Denied',
  p_content: content,
  p_delete: false,
})
assert.equal(realEnvelope.data, null)
assert.equal(realEnvelope.error?.code, 'P0002')
assert.equal(realEnvelope.error?.details, null)
assert.equal(realEnvelope.error?.hint, null)

async function expectMapped(actorId: string, classroomId: string, expectedStatus: number) {
  await assert.rejects(
    saveContextualLessonPlan({
      actorId, classroomId, date, markdown: 'Denied', content,
      shouldDelete: false,
    }),
    (error: unknown) => error instanceof ApiError && error.statusCode === expectedStatus,
  )
}

await expectMapped(owner, missingClassroom, 404)
await expectMapped(outsider, classroom, 403)
await expectMapped(owner, classroom, 409)
process.stdout.write('PASS live SDK nullable error envelope maps 404, 403 and 409 through server adapter\n')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
