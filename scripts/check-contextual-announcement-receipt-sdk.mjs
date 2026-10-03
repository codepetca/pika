#!/usr/bin/env node
// Invoked only with exact random fixtures by the local receipt concurrency harness.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const [actor, classroom, announcement, mode = 'success'] = process.argv.slice(2)
for (const id of [actor, classroom, announcement]) assert.match(id ?? '', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
assert.ok(['success', 'conflict'].includes(mode))
const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
assert.equal(status.API_URL, 'http://127.0.0.1:54321')
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const fixture = await service.from('classrooms').select('id,title,class_code').eq('id', classroom).single()
assert.equal(fixture.error, null)
assert.match(fixture.data.title, /^ann_receipt_[a-f0-9]{8} primary$/)
assert.equal(fixture.data.class_code, `${fixture.data.title.split(' ')[0]}_p`)
const actorRow = await service.from('users').select('id,email').eq('id', actor).single()
assert.equal(actorRow.error, null)
assert.equal(actorRow.data.email, `${fixture.data.title.split(' ')[0]}_member@example.invalid`)
const annRow = await service.from('announcements').select('id,classroom_id').eq('id', announcement).single()
assert.equal(annRow.error, null)
assert.equal(annRow.data.classroom_id, classroom)
const args = { p_actor_id: actor, p_classroom_id: classroom, p_cutoff: new Date().toISOString() }
const denied = await anon.rpc('mark_announcements_read_for_member_v1', args)
assert.ok(denied.error, 'Browser-role direct execution must be denied')
if (mode === 'conflict') {
  const busy = await service.rpc('mark_announcements_read_for_member_v1', args)
  assert.equal(busy.error?.code, 'PT409')
  assert.equal(busy.data, null)
  process.stdout.write('PASS live receipt SDK browser ACL and 409 mapping\n')
} else {
  const result = await service.rpc('mark_announcements_read_for_member_v1', args)
  assert.equal(result.error, null)
  assert.deepEqual(result.data, { actor_id: actor, classroom_id: classroom, marked: 1, inserted: 1 })
  const repeat = await service.rpc('mark_announcements_read_for_member_v1', args)
  assert.equal(repeat.error, null)
  assert.deepEqual(repeat.data, { actor_id: actor, classroom_id: classroom, marked: 1, inserted: 0 })
  const receipts = await service.from('announcement_reads').select('announcement_id,user_id').eq('announcement_id', announcement).eq('user_id', actor)
  assert.equal(receipts.error, null)
  assert.deepEqual(receipts.data, [{ announcement_id: announcement, user_id: actor }])
  process.stdout.write('PASS live receipt SDK binding, counts, duplicate and browser ACL\n')
}
