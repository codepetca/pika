import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerListFixture, testOwnerListSetupSql, testOwnerListSnapshotSql, TEST_OWNER_LIST_CAPS } from '../../scripts/contextual-test-owner-list-proof-fixture'
import { createTestOwnerListProofTransport, TEST_OWNER_LIST_PROJECTIONS, testOwnerListForcedReceipt, validateTestOwnerListSetupSnapshot,
  testOwnerListLifecycleMain, testOwnerListFailureDiagnostic, testOwnerListReadDiagnostic, testOwnerListRequestManifest } from '../../scripts/check-contextual-test-owner-list-lifecycle'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { readContextualTestList } from '../../src/lib/server/contextual-test-list-read'
import type { Database } from '../../src/types/database'
import { execFileSync } from 'node:child_process'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import * as lifecycle from '../../scripts/contextual-assignment-list-proof-lifecycle'
import * as originalFixture from '../../scripts/contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from '../../scripts/contextual-test-owner-list-proof-fixture'
import { ApiError } from '../../src/lib/api-error'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFileSync: vi.fn() }))

function fixture() {
  const original = newAssignmentListProofFixture(new Date('2026-10-04T12:00:00Z'))
  const f = newTestOwnerListFixture(original)
  const projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
  const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
  const guard = vi.fn(async () => {})
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'))
  const transport = createTestOwnerListProofTransport(f, target, projectId, fetcher, guard)
  return { original, f, projectId, target, guard, fetcher, transport, headers: { apikey: key, authorization: `Bearer ${key}` } }
}

/** Offline sources only. SDK query serialization is real; these are not DB rows. */
function sourceSnapshot(f: ReturnType<typeof newTestOwnerListFixture>) {
  const categories = f.classes.flatMap((c, ci) => [['Attendance', 10, false], ['Term', 65, true], ['Final', 25, false]].map(([name, percentage, is_default], i) => ({
    id: `00000000-0000-4000-8000-${String(ci * 3 + i + 1).padStart(12, '0')}`, classroom_id: c.id, name, percentage, is_default, position: i, default_assessment_weight: 10 })))
  return {
    'public.users': f.actors, 'public.classrooms': f.classes.map((c, i) => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code, blueprint_source_revision: [10, 2, 1][i] })),
    'public.tests': f.tests.map(t => ({ ...t, gradebook_category_id: categories.find(c => c.classroom_id === t.classroom_id && c.name === 'Term')!.id })),
    'public.gradebook_categories': categories, 'public.test_questions': f.questions, 'public.assessment_drafts': f.drafts.map(d => ({ id: d.id, assessment_id: d.assessment_id, classroom_id: d.classroom_id, assessment_type: 'test', version: d.version, content: d.content, created_by: d.owner, updated_by: d.owner })),
    'public.test_attempts': f.attempts, 'public.test_responses': f.responses, 'public.test_student_availability': f.availability,
    'public.classroom_enrollments': f.enrollments.filter(e => e !== f.enrollments[3]).map(e => ({ id: e.id, classroom_id: e.classroomId, student_id: e.actorId })),
    'public.classroom_roster': [], 'public.classroom_archive_revisions': f.classes.map((c, i) => ({ classroom_id: c.id, revision: [41, 7, 4][i], updated_at: f.now })), 'public.managed_storage_objects': [], 'public.managed_storage_json_references': [],
    'public.pal_event_outbox': [], 'private.pal_membership_outbox': [],
    'private.pal_membership_generations': f.enrollments.map((e, i) => ({ generation_id: e.id, scope_digest: testOwnerDigest(`pika-membership-scope-v1:${e.classroomId}:${e.actorId}`),
      state: i === 3 ? 'removed' : 'active', pal_reference: `pika-membership-v1-${String(i).padStart(32, '0')}` })),
    'private.pal_membership_settings': [{ singleton: true, enabled: false }], 'private.pal_classroom_signal_settings': [{ singleton: true, enabled: false }],
  }
}
function sourceFetch(f: ReturnType<typeof newTestOwnerListFixture>): typeof fetch {
  const snapshot = sourceSnapshot(f)
  return async resource => {
    const url = new URL(String(resource)); const select = url.searchParams.get('select'); const c = f.classes.find(c => `eq.${c.id}` === url.searchParams.get('id'))!
    const row: Record<string, unknown> = { id: c.id, teacher_id: c.owner, archived_at: null }
    const after = (key: string, id: string) => { const cursor = url.searchParams.getAll(key).find(value => value.startsWith('gt.')); return !cursor || id > cursor.slice(3) }
    const ownTests = snapshot['public.tests'].filter(t => t.classroom_id === c.id).sort((a, b) => a.id.localeCompare(b.id))
    const roster = snapshot['public.classroom_enrollments'].filter(e => e.classroom_id === c.id && e.student_id !== c.owner).sort((a, b) => a.student_id.localeCompare(b.student_id))
    if (select === TEST_OWNER_LIST_PROJECTIONS.tests) row.tests = ownTests.filter(t => after('tests.id', t.id))
    else if (select === TEST_OWNER_LIST_PROJECTIONS.roster) row.enrollments = roster.filter(e => after('enrollments.student_id', e.student_id)).map(e => ({ classroom_id: e.classroom_id, student_id: e.student_id }))
    else if (select !== TEST_OWNER_LIST_PROJECTIONS.root) {
      const kind = (['questions', 'attempts', 'responses', 'availability'] as const).find(k => select === TEST_OWNER_LIST_PROJECTIONS[k])
      row.tests = ownTests.map(t => {
        const control = { id: t.id, classroom_id: t.classroom_id, status: t.status, updated_at: t.updated_at }
        if (!kind) return control
        const planned = f[kind].filter(child => child.test_id === t.id && after(`tests.${kind}.id`, child.id)).sort((a, b) => a.id.localeCompare(b.id))
        const children = planned.flatMap(child => {
          if (!('student_id' in child)) return [{ id: child.id, test_id: child.test_id }]
          const enrollment = roster.find(e => e.student_id === child.student_id)
          if (!enrollment) return []
          const base = { id: child.id, test_id: child.test_id, student_id: child.student_id, participant: { id: child.student_id, enrollment: [{ classroom_id: c.id, student_id: child.student_id }] } }
          if ('is_submitted' in child) return [{ ...base, is_submitted: child.is_submitted }]
          if ('selected_option' in child) return [{ ...base, selected_option: child.selected_option, response_text: child.response_text }]
          if ('state' in child) return [{ ...base, state: child.state }]
          return []
        })
        return { ...control, [kind]: children }
      })
      if (select === TEST_OWNER_LIST_PROJECTIONS.drafts) row.drafts = snapshot['public.assessment_drafts'].filter(d => d.classroom_id === c.id && after('drafts.id', d.id)).sort((a, b) => a.id.localeCompare(b.id)).map(d => ({ id: d.id, assessment_id: d.assessment_id, classroom_id: d.classroom_id, assessment_type: d.assessment_type, version: d.version, content: d.content }))
    }
    return new Response(JSON.stringify([row]), { headers: { 'content-type': 'application/json' } })
  }
}

describe('finite owner Test list fixture', () => {
  it('freezes exactly the accepted synthetic inventory and eight cases', () => {
    const { original, f } = fixture()
    for (const [key, count] of Object.entries({ actors: 5, classes: 3, tests: 4, questions: 4, drafts: 2, attempts: 4, responses: 5, availability: 5, enrollments: 5, cases: 8 }))
      expect(f[key as keyof typeof f]).toHaveLength(count)
    expect(Object.isFrozen(f)).toBe(true); expect(Object.isFrozen(f.responses[0])).toBe(true)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.allocatedIds.every(id => !original.allocatedIds.includes(id))).toBe(true)
  })
  it('bounds separate SQL and permits only the one exact new enrollment deletion', () => {
    const { f, projectId } = fixture(); const sql = testOwnerListSetupSql(f, projectId)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(TEST_OWNER_LIST_CAPS.sqlBytes)
    expect(sql.match(/delete from /gi)).toHaveLength(1)
    expect(sql).toContain(`delete from public.classroom_enrollments where id='${f.enrollments[3].id}'`)
    expect(sql).toContain("state='removed'"); expect(sql).toContain("state='active'")
    expect(sql).not.toMatch(/disable trigger|truncate|update private\.|reconcile_|insert into public.managed_storage/i)
    const snapshot = testOwnerListSnapshotSql(f)
    for (const table of ['test_attempts', 'test_responses', 'test_student_availability', 'pal_membership_generations', 'pal_membership_settings', 'pal_classroom_signal_settings', 'pal_membership_outbox']) expect(snapshot).toContain(table)
  })
  it('retains legal option zero, repeated responses, whitespace and portable draft identities', () => {
    const { f } = fixture()
    expect(f.responses[0].selected_option).toBe(0)
    expect(f.responses[0].student_id).toBe(f.responses[1].student_id)
    expect(f.responses[3].response_text).toBe('   ')
    expect(f.responses.every(r => (r.selected_option === null) !== (r.response_text === null))).toBe(true)
    expect(f.drafts[0].content.questions).toHaveLength(2); expect(f.drafts[1].content.questions).toHaveLength(0)
    expect(f.questions.every(q => q.id !== q.artifact_id)).toBe(true)
  })
  it('keeps persisted answer keys null for multiple-choice questions per migration 044', () => {
    const { f, projectId } = fixture(); const sql = testOwnerListSetupSql(f, projectId)
    const insert = sql.split('insert into public.test_questions(')[1].split(';')[0]
    for (const question of f.questions) {
      const tuple = insert.split(`('${question.id}',`)[1].split('),')[0]
      const key = question.question_type === 'multiple_choice' ? 'null' : "'Synthetic answer'"
      expect(tuple).toContain(`,${question.correct_option === null ? 'null' : question.correct_option},${key},null,1,5000,false,${question.position}`)
    }
  })
  it('validates nine exact owned trigger-created categories and retained generations', () => {
    const { f } = fixture(); const snapshot = sourceSnapshot(f)
    expect(() => validateTestOwnerListSetupSnapshot(f, snapshot)).not.toThrow()
    const changed = structuredClone(snapshot); changed['public.gradebook_categories'][0].classroom_id = f.actors[0].id
    expect(() => validateTestOwnerListSetupSnapshot(f, changed)).toThrow()
    const removed = structuredClone(snapshot); removed['private.pal_membership_generations'][3].state = 'active'
    expect(() => validateTestOwnerListSetupSnapshot(f, removed)).toThrow()
    const content = structuredClone(snapshot); content['public.tests'][1].title = 'substituted'
    expect(() => validateTestOwnerListSetupSnapshot(f, content)).toThrow()
  })
  it('accepts exact natural archive/blueprint revision side effects without changing Test controls', () => {
    const { f } = fixture(); const rows = structuredClone(sourceSnapshot(f))
    rows['public.classrooms'] = rows['public.classrooms'].map((c, i) => ({ ...c, blueprint_source_revision: [10, 2, 1][i] }))
    Object.assign(rows, { 'public.classroom_archive_revisions': f.classes.map((c, i) => ({ classroom_id: c.id, revision: [41, 7, 4][i], updated_at: f.now })) })
    expect(() => validateTestOwnerListSetupSnapshot(f, rows)).not.toThrow()
    expect(rows['public.tests'].every(t => t.questions_locked_at === null && t.updated_at === f.now)).toBe(true)
  })
  it.each(['missing', 'extra', 'foreign-class', 'duplicate-class', 'revision', 'blueprint', 'extra-column', 'timestamp'] as const)('rejects archive effect mismatch %s', kind => {
    const { f } = fixture(); const rows = structuredClone(sourceSnapshot(f))
    if (kind === 'missing') rows['public.classroom_archive_revisions'].pop()
    if (kind === 'extra') rows['public.classroom_archive_revisions'].push({ ...rows['public.classroom_archive_revisions'][0] })
    if (kind === 'foreign-class') rows['public.classroom_archive_revisions'][0].classroom_id = f.actors[0].id
    if (kind === 'duplicate-class') rows['public.classroom_archive_revisions'][1].classroom_id = f.classes[0].id
    if (kind === 'revision') rows['public.classroom_archive_revisions'][0].revision++
    if (kind === 'blueprint') rows['public.classrooms'][0].blueprint_source_revision++
    if (kind === 'extra-column') Object.assign(rows['public.classroom_archive_revisions'][0], { substituted: true })
    if (kind === 'timestamp') rows['public.classroom_archive_revisions'][0].updated_at = 'invalid'
    expect(() => validateTestOwnerListSetupSnapshot(f, rows)).toThrow()
  })
  it('reports only the exact closed validation checkpoint, never input labels', () => {
    const { f } = fixture(); const rows = structuredClone(sourceSnapshot(f)); rows['public.classroom_archive_revisions'].pop()
    let checkpoint = ''
    expect(() => validateTestOwnerListSetupSnapshot(f, rows, value => { checkpoint = value })).toThrow()
    expect(checkpoint).toBe('counts-archive-revisions')
    expect(testOwnerListFailureDiagnostic(new Error('PRIVATE'), 'setup-validate', checkpoint)).toContain('step=setup-validate checkpoint=counts-archive-revisions')
    expect(testOwnerListFailureDiagnostic(new Error('PRIVATE'), 'PRIVATE', 'PRIVATE')).not.toContain('PRIVATE')
  })
  it('freezes the complete finite request manifest and retains the original read-only guard', () => {
    const { f, projectId } = fixture(); const manifest = testOwnerListRequestManifest(f)
    expect(Object.isFrozen(manifest)).toBe(true); expect(Object.isFrozen(manifest.projections)).toBe(true); expect(Object.isFrozen(manifest.fixture.drafts[0].content.questions)).toBe(true)
    expect(manifest.caps).toMatchObject({ sqlBytes: 65536, networkRequests: 256, storageRequests: 0, rpcRequests: 0, requestMs: 15000, responseBytes: 8388608 })
    const guard = testOwnerGuardSql(projectId)
    for (const name of ['guard_pal_membership_evidence', 'guard_pal_signal_activation', 'pal_membership_settings', 'pal_classroom_signal_settings', 'student_provider_cleanup_settings',
      'removed_student_academic_settings', 'classroom_creation_entitlement_settings', 'test_ai_grading_runs', 'test_ai_grading_run_items', 'vault.secrets',
      'submission-images', 'assignment-artifacts', 'test-documents', 'pika-removed-student-cleanup-watchdog', 'pika-test-ai-grading-watchdog']) expect(guard).toContain(name)
    expect(guard.match(/begin read only/g)).toHaveLength(1); expect(guard).not.toMatch(/update |alter |disable trigger/i)
  })
})

describe('finite owner Test list transport', () => {
  it.each(['matrix-before', 'matrix-denial', 'matrix-request-count', 'matrix-owner', 'matrix-expected', 'matrix-after-read', 'matrix-equality', 'matrix-evidence'])('keeps closed matrix checkpoints %s', step => {
    const error = new AssignmentListLifecycleError({ stage: 'cases', error: new Error('PRIVATE') }, [])
    expect(testOwnerListFailureDiagnostic(error, step, 'complete')).toContain(`step=${step} checkpoint=complete`)
    expect(testOwnerListFailureDiagnostic(error, 'PRIVATE', 'PRIVATE')).not.toContain('PRIVATE')
  })
  it.each([400, 403, 404, 503])('keeps closed read outcome status %s without messages or identities', status => {
    expect(testOwnerListReadDiagnostic(new ApiError(status, 'PRIVATE identity URL body'))).toBe(`DIAG test-owner-list read kind=api-error status=${status}.\n`)
  })
  it('keeps closed read outcome class distinctions without relaxing ApiError assertions', () => {
    const other = Object.assign(new Error('PRIVATE'), { statusCode: 403 })
    expect(testOwnerListReadDiagnostic(other)).toBe('DIAG test-owner-list read kind=other-error status=403.\n')
    expect(testOwnerListReadDiagnostic(new ApiError(418, 'PRIVATE'))).toBe('DIAG test-owner-list read kind=api-error status=0.\n')
    expect(testOwnerListReadDiagnostic({ statusCode: 403, private: 'PRIVATE' })).toBe('DIAG test-owner-list read kind=unknown status=0.\n')
    const getter = new Error('PRIVATE'); Object.defineProperty(getter, 'statusCode', { get: () => { throw new Error('PRIVATE getter') } })
    expect(testOwnerListReadDiagnostic(getter)).toBe('DIAG test-owner-list read kind=other-error status=0.\n')
  })
  it('accepts installed SDK preflight with exactly one fresh guard and bounded redirect policy', async () => {
    const x = fixture(); x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
    const client = createClient(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: x.transport.fetch } })
    await client.from('classrooms').select(TEST_OWNER_LIST_PROJECTIONS.root).eq('id', x.f.classes[0].id).maybeSingle()
    expect(x.guard).toHaveBeenCalledOnce(); expect(x.fetcher).toHaveBeenCalledOnce()
    expect(x.fetcher.mock.calls[0][1]?.redirect).toBe('error'); expect(x.fetcher.mock.calls[0][1]?.signal).toBeTruthy()
  })
  it.each(['http://127.0.0.1:54321/rest/v1/classrooms', 'https://example.invalid/rest/v1/classrooms', 'http://127.0.0.1:54331/auth/v1/user', 'http://127.0.0.1:54331/storage/v1/bucket/test-documents', 'http://127.0.0.1:54331/rest/v1/rpc/unknown'])('rejects origin/path %s before dispatch', async url => {
    const x = fixture(); await expect(x.transport.fetch(url, { headers: x.headers })).rejects.toThrow('private details withheld')
    expect(x.guard).not.toHaveBeenCalled(); expect(x.fetcher).not.toHaveBeenCalled()
  })
  it.each(['after-fixture', 'before-capture'])('requires complete setup and exact clean forced marker %s', mode => {
    const error = new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
    const receipt = testOwnerListForcedReceipt(mode, error, true)
    expect(receipt?.exitCode).toBe(1); expect(`${receipt?.stdout}${receipt?.stderr}`.trim().split('\n')).toHaveLength(2)
    expect(testOwnerListForcedReceipt(mode, error, false)).toBeNull()
    expect(testOwnerListForcedReceipt(mode, new AssignmentListLifecycleError(error.primary, [{ stage: 'cleanup', error: new Error('secret') }]), true)).toBeNull()
    expect(testOwnerListForcedReceipt(mode, new AssignmentListLifecycleError({ stage: 'fixture', error: new Error('Forced isolated lifecycle failure') }, []), true)).toBeNull()
    expect(testOwnerListForcedReceipt(mode, new AssignmentListLifecycleError({ stage: mode, error: new Error('substituted') }, []), true)).toBeNull()
  })
  it.each(Array.from({ length: 8 }, (_, i) => i))('runs the real helper and installed SDK through finite offline sources, case %s', async i => {
    const x = fixture(); const item = x.f.cases[i]; const fetcher = vi.fn(sourceFetch(x.f))
    const transport = createTestOwnerListProofTransport(x.f, x.target, x.projectId, fetcher, x.guard)
    const client = createClient<Database>(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
    transport.readContext(item.classroomId, item.actorId)
    const read = readContextualTestList({ supabase: client, actorId: item.actorId, classroomId: item.classroomId })
    if (item.status === 403) { await expect(read).rejects.toMatchObject({ statusCode: 403 }); expect(fetcher).toHaveBeenCalledOnce() }
    else {
      const body = await read; const expected = x.f.tests.filter(t => t.classroom_id === item.classroomId).sort((a, b) => b.position - a.position || Date.parse(b.created_at) - Date.parse(a.created_at))
      expect(body.tests.map(t => t.id)).toEqual(expected.map(t => t.id))
      for (const t of body.tests) {
        const n = x.f.tests.findIndex(row => row.id === t.id)
        expect(t.stats).toEqual(x.f.stats[n]); expect(t.artifact_id).toBe(x.f.tests[n].artifact_id)
        expect(t.title).toBe(n === 0 ? x.f.drafts[0].content.title : x.f.tests[n].title)
        expect(t.show_results).toBe(n === 0)
        expect(t.documents).toEqual(n === 1 ? [{ id: x.f.tests[1].documents[0].id, title: 'Instructions', source: 'text', content: 'Synthetic instructions.' }] : [])
      }
      expect(transport.evidence.testsEmpty).toBeGreaterThan(0); expect(transport.evidence.rosterEmpty).toBeGreaterThan(0); expect(transport.evidence.final).toBeGreaterThan(0)
      if (i < 2) for (const kind of ['questions', 'attempts', 'responses', 'availability', 'drafts'] as const) expect(transport.evidence[`${kind}Empty`]).toBeGreaterThan(0)
    }
    expect(x.guard.mock.calls.length).toBe(fetcher.mock.calls.length); expect(transport.counts.storage).toBe(0); expect(transport.counts.rpc).toBe(0)
  })
  it('rejects unknown filters, methods, headers, redirect/control options and SDK drift before guard', async () => {
    const x = fixture(); const url = `${x.target.API_URL}/rest/v1/classrooms?select=${TEST_OWNER_LIST_PROJECTIONS.root}&id=eq.${x.f.classes[0].id}`
    for (const [resource, init] of [[`${url}&limit=1`, { headers: x.headers }], [url, { method: 'POST', headers: x.headers }], [url, { body: '{}', headers: x.headers }],
      [url, { redirect: 'follow', headers: x.headers }], [url, { cache: 'force-cache', headers: x.headers }], [url, { headers: { ...x.headers, 'x-unknown': 'true' } }],
      [url, { headers: { ...x.headers, 'x-client-info': 'supabase-js-node/0.0.0' } }]] as Array<[string, RequestInit]>) {
      x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
      await expect(x.transport.fetch(resource, init)).rejects.toThrow('private details withheld')
    }
    expect(x.guard).not.toHaveBeenCalled(); expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('rejects changed owner/Class/OR control or child filters against real SDK templates', async () => {
    const x = fixture(); const real = sourceFetch(x.f); const observed: string[] = []
    const source: typeof fetch = async (resource, init) => { observed.push(String(resource)); return real(resource, init) }
    const transport = createTestOwnerListProofTransport(x.f, x.target, x.projectId, source, x.guard)
    const client = createClient<Database>(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
    transport.readContext(x.f.classes[0].id, x.f.actors[0].id); await readContextualTestList({ supabase: client, actorId: x.f.actors[0].id, classroomId: x.f.classes[0].id })
    const urls = observed.map(u => new URL(u)); const attempt = urls.find(u => u.searchParams.get('select') === TEST_OWNER_LIST_PROJECTIONS.attempts)!
    for (const [key, value] of [['tests.classroom_id', `eq.${x.f.classes[1].id}`], ['teacher_id', `eq.${x.f.actors[1].id}`], ['tests.or', '(id.eq.substituted)'],
      ['tests.attempts.student_id', `eq.${x.f.actors[0].id}`], ['tests.attempts.participant.enrollment.classroom_id', `eq.${x.f.classes[1].id}`], ['tests.attempts.limit', '101']]) {
      const changed = new URL(attempt); changed.searchParams.set(key, value); const calls = x.guard.mock.calls.length
      await expect(transport.fetch(changed.toString(), { headers: x.headers })).rejects.toThrow(); expect(x.guard.mock.calls.length).toBe(calls)
    }
  })
  it('enforces response/network bounds and refuses redirect responses without escape', async () => {
    const x = fixture(); const preflight = `${x.target.API_URL}/rest/v1/classrooms?select=${TEST_OWNER_LIST_PROJECTIONS.root}&id=eq.${x.f.classes[0].id}`
    x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
    x.fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.invalid' } }))
    await expect(x.transport.fetch(preflight, { headers: x.headers })).rejects.toThrow()
    x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
    x.fetcher.mockResolvedValueOnce(new Response(new Uint8Array(TEST_OWNER_LIST_CAPS.responseBytes + 1)))
    await expect(x.transport.fetch(preflight, { headers: x.headers })).rejects.toThrow()
    const final = `${preflight}&teacher_id=eq.${x.f.actors[0].id}`
    for (let n = 2; n < TEST_OWNER_LIST_CAPS.networkRequests; n++) await x.transport.fetch(final, { headers: x.headers })
    await expect(x.transport.fetch(final, { headers: x.headers })).rejects.toThrow()
    expect(x.guard).toHaveBeenCalledTimes(TEST_OWNER_LIST_CAPS.networkRequests); expect(x.fetcher).toHaveBeenCalledTimes(TEST_OWNER_LIST_CAPS.networkRequests)
  })
  it('uses the fixed 15-second transport timeout and combines caller abort', async () => {
    const x = fixture(); const controller = new AbortController(); const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
      await x.transport.fetch(`${x.target.API_URL}/rest/v1/classrooms?select=${TEST_OWNER_LIST_PROJECTIONS.root}&id=eq.${x.f.classes[0].id}`, { headers: x.headers, signal: controller.signal })
      expect(timeout).toHaveBeenCalledWith(15000); const combined = x.fetcher.mock.calls[0][1]!.signal!
      expect(combined).not.toBe(controller.signal); controller.abort(); expect(combined.aborted).toBe(true)
    } finally { timeout.mockRestore() }
  })
  it('never leaks private source errors or identities in closed diagnostics', async () => {
    const x = fixture(); x.guard.mockRejectedValueOnce(new Error('PRIVATE cause'))
    x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/classrooms?select=${TEST_OWNER_LIST_PROJECTIONS.root}&id=eq.${x.f.classes[0].id}`, { headers: x.headers })).rejects.toThrow('private details withheld')
    expect(x.transport.diagnostic()).not.toContain('PRIVATE'); expect(x.transport.diagnostic()).not.toContain(x.f.classes[0].id)
    expect(testOwnerListFailureDiagnostic(new AssignmentListLifecycleError({ stage: 'PRIVATE', error: new Error('PRIVATE') }, []), 'PRIVATE')).not.toContain('PRIVATE')
    expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('distinguishes caller abort after guard work using bounded closed diagnostics', async () => {
    const x = fixture(); const controller = new AbortController(); let now = 1000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      x.guard.mockImplementationOnce(async () => { now += 21000; controller.abort('PRIVATE reason') })
      x.fetcher.mockRejectedValueOnce(new DOMException('PRIVATE failure', 'AbortError'))
      x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
      await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/classrooms?select=${TEST_OWNER_LIST_PROJECTIONS.root}&id=eq.${x.f.classes[0].id}`, { headers: x.headers, signal: controller.signal })).rejects.toThrow('private details withheld')
      expect(x.transport.diagnostic()).toContain('case=0 projection=root contextMs=21000 guardMs=21000 callerAborted=true failure=aborted http=0')
      expect(x.transport.diagnostic()).not.toMatch(/PRIVATE|example\.invalid|https?:/)
      now += 100000
      expect(x.transport.diagnostic()).toContain('contextMs=60000')
      x.transport.readContext(x.f.classes[1].id, x.f.actors[1].id)
      expect(x.transport.diagnostic()).toContain('case=1 projection=unknown contextMs=0 guardMs=0 callerAborted=false failure=none http=0')
    } finally { clock.mockRestore() }
  })
  it('freezes in-flight guard timing at read rejection rather than after lifecycle cleanup', async () => {
    const x = fixture(); let now = 1000; let finishGuard!: () => void
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      x.guard.mockImplementationOnce(() => new Promise<void>(resolve => { finishGuard = resolve }))
      x.transport.readContext(x.f.classes[0].id, x.f.actors[0].id)
      const pending = x.transport.fetch(`${x.target.API_URL}/rest/v1/classrooms?select=${TEST_OWNER_LIST_PROJECTIONS.root}&id=eq.${x.f.classes[0].id}`, { headers: x.headers })
      now += 20000; x.transport.freezeDiagnostic()
      const frozen = x.transport.diagnostic()
      expect(frozen).toContain('phase=guard')
      expect(frozen).toContain('contextMs=20000 guardMs=20000')
      now += 40000; finishGuard(); await pending
      x.transport.freezeDiagnostic(); expect(x.transport.diagnostic()).toBe(frozen)
      x.transport.readContext(x.f.classes[1].id, x.f.actors[1].id)
      expect(x.transport.diagnostic()).toContain('case=1 projection=unknown contextMs=0 guardMs=0')
    } finally { clock.mockRestore() }
  })
  it('rejects foreign Test/draft/child cursors and any additional repeated predicate', async () => {
    const x = fixture(); const requests: string[] = []; const real = sourceFetch(x.f)
    const transport = createTestOwnerListProofTransport(x.f, x.target, x.projectId, async (resource, init) => { requests.push(String(resource)); return real(resource, init) }, x.guard)
    const client = createClient<Database>(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
    transport.readContext(x.f.classes[0].id, x.f.actors[0].id); await readContextualTestList({ supabase: client, actorId: x.f.actors[0].id, classroomId: x.f.classes[0].id })
    for (const [projection, key] of [[TEST_OWNER_LIST_PROJECTIONS.tests, 'tests.id'], [TEST_OWNER_LIST_PROJECTIONS.drafts, 'drafts.id'], [TEST_OWNER_LIST_PROJECTIONS.questions, 'tests.questions.id']]) {
      const url = new URL(requests.find(r => new URL(r).searchParams.get('select') === projection)!); url.searchParams.set(key, `gt.${x.f.actors[0].id}`)
      const guards = x.guard.mock.calls.length; await expect(transport.fetch(url.toString(), { headers: x.headers })).rejects.toThrow(); expect(x.guard.mock.calls.length).toBe(guards)
    }
    const roster = new URL(requests.find(r => new URL(r).searchParams.get('select') === TEST_OWNER_LIST_PROJECTIONS.roster)!); roster.searchParams.append('enrollments.student_id', `neq.${x.f.actors[1].id}`)
    await expect(transport.fetch(roster.toString(), { headers: x.headers })).rejects.toThrow()
  })
})

describe('offline sealed lifecycle composition', () => {
  it.each(['normal', 'after-fixture', 'before-capture', 'snapshot-drift', 'bad-generation', 'bad-resource', 'bad-archive-revision', 'setup-sql-failure', 'snapshot-read-failure'] as const)('finishes full fixture before original checkpoint, %s', async scenario => {
    const x = fixture(); const head = 'a'.repeat(40); const mode = scenario === 'after-fixture' || scenario === 'before-capture' ? scenario : 'normal'
    const exit = process.exitCode; const pal = process.env.PAL_ENABLED; const events: string[] = []
    const resources = platform.assignmentListExpectedResources(x.projectId).map((r, n) => ({ ...r, id: String(n + 1).padStart(64, '0'), createdAt: 'synthetic',
      labels: { 'com.supabase.cli.project': x.projectId, 'com.docker.compose.project': x.projectId }, ports: r.name === `supabase_db_${x.projectId}` ? [54332] : [], attachedIds: [] }))
    const session = { projectId: x.projectId, containerId: resources.find(r => r.name === `supabase_db_${x.projectId}`)!.id, dbPort: 54332 as const, applicationName: `${x.projectId}_fixture` }
    const native = { executeSql: vi.fn(async () => { events.push('sql') }), runCase: vi.fn(async () => { events.push('original-case') }), command: vi.fn(async () => x.target),
      canonicalSnapshot: vi.fn(), teardown: vi.fn(), inventory: vi.fn(), prepare: vi.fn(), verifyEphemeral: vi.fn(), runRevocation: vi.fn(), verifyRestoration: vi.fn(), removeWorkdir: vi.fn() }
    if (scenario === 'setup-sql-failure') native.executeSql.mockImplementation(async () => { events.push('sql'); if (events.length === 2) throw new Error('PRIVATE SQL cause') })
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true); const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.spyOn(originalFixture, 'newAssignmentListProofFixture').mockReturnValue(x.original)
    vi.spyOn(platform, 'createAssignmentListNativeAdapters').mockReturnValue(native as unknown as ReturnType<typeof platform.createAssignmentListNativeAdapters>)
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue([])
    vi.spyOn(platform, 'assignmentListDockerInventory').mockResolvedValue(scenario === 'bad-resource' ? resources.slice(1) : resources)
    let snapshots = 0
    vi.mocked(execFileSync).mockImplementation((file, args, options) => {
      if (file === 'git') return args?.[0] === 'status' ? '' : args?.[1] === 'HEAD' ? head : process.cwd()
      const sql = (options as { input: string }).input
      if (sql === testOwnerGuardSql(x.projectId)) return 'ok\n'
      expect(sql).toBe(testOwnerListSnapshotSql(x.f)); snapshots++
      if (scenario === 'snapshot-read-failure') throw new Error('PRIVATE snapshot cause')
      const rows = sourceSnapshot(x.f)
      if (scenario === 'bad-generation') rows['private.pal_membership_generations'][3].state = 'active'
      if (scenario === 'snapshot-drift' && snapshots === 3) rows['public.tests'][0].title = 'PRIVATE source drift'
      if (scenario === 'bad-archive-revision') rows['public.classroom_archive_revisions'][0].revision++
      return JSON.stringify(rows) + '\n'
    })
    vi.stubGlobal('fetch', vi.fn(sourceFetch(x.f)))
    const sealed = vi.spyOn(lifecycle, 'runAssignmentListEphemeralLifecycle').mockImplementation(async (input, adapters) => {
      expect(input.fixture).toBe(x.original); expect(input.mode).toBe(mode); expect(input.fixture.manifest.cases).toHaveLength(9); expect(input.restorationPolicies).toHaveLength(14)
      for (const name of ['canonicalSnapshot', 'teardown', 'inventory', 'prepare', 'verifyEphemeral', 'runRevocation', 'verifyRestoration', 'removeWorkdir'] as const) expect(adapters[name]).toBe(native[name])
      await adapters.command({ args: ['status'], workdir: input.workdir, timeoutMs: 1 })
      await adapters.executeSql({ ...session, sql: originalFixture.assignmentListFixtureSetupSql(x.original, x.projectId) })
      expect(native.executeSql).toHaveBeenCalledTimes(2)
      expect(native.executeSql.mock.calls[1]).toEqual([{ ...session, sql: testOwnerListSetupSql(x.f, x.projectId) }])
      expect(snapshots).toBe(1); events.push('checkpoint')
      if (mode !== 'normal') throw new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
      await adapters.runCase({} as Parameters<typeof adapters.runCase>[0])
    })
    try {
      const running = testOwnerListLifecycleMain(['--reviewed-head', head, '--mode', mode])
      if (['snapshot-drift', 'bad-generation', 'bad-resource', 'bad-archive-revision', 'setup-sql-failure', 'snapshot-read-failure'].includes(scenario)) {
        await expect(running).rejects.toThrow('private details withheld'); expect(stdout).not.toHaveBeenCalled()
        expect(stderr.mock.calls.flat().join('')).not.toContain('PRIVATE'); expect(stderr.mock.calls.flat().join('')).not.toContain(x.f.classes[0].id)
        if (scenario !== 'snapshot-drift') expect(events).not.toContain('checkpoint')
        const diagnostic = stderr.mock.calls.flat().join('')
        if (scenario === 'bad-archive-revision') expect(diagnostic).toContain('step=setup-validate checkpoint=revisions')
        if (scenario === 'setup-sql-failure') expect(diagnostic).toContain('step=setup-sql checkpoint=unknown')
        if (scenario === 'snapshot-read-failure') expect(diagnostic).toContain('step=setup-snapshot checkpoint=unknown')
        if (scenario === 'bad-resource') expect(diagnostic).toContain('step=setup-guard checkpoint=unknown')
      } else {
        await running; expect(sealed).toHaveBeenCalledOnce(); expect(native.executeSql).toHaveBeenCalledTimes(2)
        if (mode === 'normal') { expect(native.runCase).toHaveBeenCalledOnce(); expect(snapshots).toBe(17); expect(stderr).not.toHaveBeenCalled(); expect(stdout.mock.calls.flat().join('')).toContain('eight actual SDK cases') }
        else { expect(native.runCase).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1)
          expect(stdout.mock.calls.flat().join('')).toBe('PASS isolated test-owner-list exact teardown and unchanged canonical baseline.\n')
          expect(stderr.mock.calls.flat().join('')).toBe(`FAIL forced isolated test-owner-list lifecycle: ${mode}.\n`) }
      }
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = exit; if (pal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = pal }
  })
  it('rejects malformed CLI before shell dispatch', async () => {
    vi.mocked(execFileSync).mockClear(); await expect(testOwnerListLifecycleMain(['--reviewed-head', 'bad', '--mode', 'normal'])).rejects.toThrow(); expect(execFileSync).not.toHaveBeenCalled()
  })
  it.each(['head', 'dirty'])('rejects %s before native platform construction', async state => {
    const native = vi.spyOn(platform, 'createAssignmentListNativeAdapters')
    vi.mocked(execFileSync).mockImplementation((_file, args) => args?.[0] === 'status' ? ' M synthetic' : 'b'.repeat(40))
    try { await expect(testOwnerListLifecycleMain(['--reviewed-head', state === 'head' ? 'a'.repeat(40) : 'b'.repeat(40), '--mode', 'normal'])).rejects.toThrow(); expect(native).not.toHaveBeenCalled() }
    finally { native.mockRestore() }
  })
})
