// Invoked only by the random-fixture local concurrency harness.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { createContextualAnnouncement, updateContextualAnnouncement, deleteContextualAnnouncement } from '../src/lib/server/contextual-announcement-mutation'

async function main() {
  const [owner, outsider, classroom, announcementId, mode] = process.argv.slice(2)
  for (const value of [owner, outsider, classroom, announcementId]) assert.match(value, /^[a-f0-9-]{36}$/i)
  assert.equal(execFileSync('docker', ['inspect', 'supabase_db_pika', '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', 'supabase_db_pika', '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.ANON_KEY
  process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const fixture = await service.from('classrooms').select('id,teacher_id,title,class_code').eq('id', classroom).single()
  assert.equal(fixture.error, null)
  assert.equal(fixture.data.teacher_id, owner)
  assert.match(fixture.data.title, /^ann_write_[a-f0-9]{8} (owner|teacher)$/)
  const tag = fixture.data.title.split(' ')[0]
  const identities = await service.from('users').select('id,email').in('id', [owner, outsider])
  assert.equal(identities.error, null)
  for (const identity of identities.data ?? []) assert.match(identity.email, new RegExp(`^${tag}_(owner|teacher|outsider)@example\\.invalid$`))
  assert.equal(identities.data?.length, 2)
  const expected = (code: number) => (error: unknown) => error instanceof ApiError && error.statusCode === code
  if (mode === 'conflict') {
    await assert.rejects(createContextualAnnouncement({ actorId: owner, classroomId: classroom, body: { content: 'Conflict', is_draft: false } }), expected(409))
    await assert.rejects(updateContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId, body: { content: 'Conflict' } }), expected(409))
    await assert.rejects(deleteContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId }), expected(409))
    process.stdout.write('PASS live announcement SDK strict envelopes and 409 mapping\n')
    return
  }
  await assert.rejects(createContextualAnnouncement({ actorId: outsider, classroomId: classroom, body: { content: 'Denied', is_draft: false } }), expected(403))
  await assert.rejects(createContextualAnnouncement({ actorId: owner, classroomId: randomUUID(), body: { content: 'Missing', is_draft: false } }), expected(404))
  await assert.rejects(updateContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId: randomUUID(), body: { title: 'Missing' } }), expected(404))
  const created = await createContextualAnnouncement({ actorId: owner, classroomId: classroom, body: { content: 'SDK draft', is_draft: true, title: null } })
  assert.equal(created.announcement.created_by, owner)
  const id = created.announcement.id
  const published = await updateContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId: id, body: { is_draft: false } })
  assert.equal(published.announcement.is_draft, false)
  const noop = await updateContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId: id, body: { is_draft: false } })
  assert.deepEqual(noop, published)
  const schedule = new Date(Date.now() + 86_400_000).toISOString()
  const scheduled = await updateContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId: id, body: { scheduled_for: schedule, title: 'Scheduled' } })
  assert.equal(Date.parse(scheduled.announcement.scheduled_for!), Date.parse(schedule))
  const drafted = await updateContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId: id, body: { is_draft: true } })
  assert.equal(drafted.announcement.published_at, null)
  assert.deepEqual(await deleteContextualAnnouncement({ actorId: owner, classroomId: classroom, announcementId: id }), { success: true })
  process.stdout.write('PASS live announcement SDK create/update/delete, publication and 403/404 mappings\n')
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Announcement SDK check failed'); process.exitCode = 1 })
