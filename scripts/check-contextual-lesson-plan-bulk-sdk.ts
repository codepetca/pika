// Invoked only by the synthetic bulk harness while its fixture row lock is held.
// It verifies live SDK envelope mapping and creates no rows.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { saveContextualLessonPlanBulk } from '../src/lib/server/contextual-lesson-plan-bulk-mutation'

async function main() {
  const [owner, outsider, classroom, date, nonce, conflictOnly] = process.argv.slice(2)
  for (const value of [owner, outsider, classroom, nonce]) assert.match(value, /^[a-f0-9-]{36}$/i)
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

  const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const fixture = await client.from('classrooms').select('id,teacher_id,title,class_code')
    .eq('id', classroom).eq('teacher_id', owner).maybeSingle()
  assert.equal(fixture.error, null)
  assert(fixture.data && /^lesson_bulk_[a-f0-9]{8} student$/.test(fixture.data.title),
    'Expected a synthetic lesson-bulk classroom')
  const fixtureTag = fixture.data.title.slice(0, -' student'.length)
  assert.equal(fixture.data.class_code, `${fixtureTag}_s`)
  const identities = await client.from('users').select('id,email').in('id', [owner, outsider])
  assert.equal(identities.error, null)
  assert(identities.data?.some((user) => user.id === owner && user.email === `${fixtureTag}_student@example.invalid`))
  assert(identities.data?.some((user) => user.id === outsider && user.email === `${fixtureTag}_outsider@example.invalid`))

  const missingClassroom = randomUUID()
  const content = { type: 'doc' as const, content: [] }
  const missing = await client.rpc('save_lesson_plans_for_owner_v1', {
    p_actor_id: owner, p_classroom_id: missingClassroom,
    p_plans: [{ date, content_markdown: 'Denied', content }], p_cleared_dates: [],
  })
  assert.equal(missing.data, null)
  assert.equal(missing.error?.code, 'P0002')
  assert.equal(missing.error?.details, null)
  assert.equal(missing.error?.hint, null)

  async function expectMapped(actorId: string, classroomId: string, expectedStatus: number) {
    await assert.rejects(
      saveContextualLessonPlanBulk({
        actorId, classroomId,
        plans: [{ date, content_markdown: 'Denied', content }], clearedDates: [],
        mutation: { client_id: nonce, sequence: 12 },
      }),
      (error: unknown) => error instanceof ApiError && error.statusCode === expectedStatus,
    )
  }
  if (conflictOnly !== 'conflict-only') {
    await expectMapped(owner, missingClassroom, 404)
    await expectMapped(outsider, classroom, 403)
  }
  await expectMapped(owner, classroom, 409)
  process.stdout.write('PASS live bulk SDK nullable error envelope maps 404, 403 and 409\n')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
