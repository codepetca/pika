import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestMemberListFixture, testMemberListSetupSql, testMemberListSnapshotSql, testMemberListGuardSql,
  TEST_MEMBER_LIST_CAPS, validateTestMemberListSetupSnapshot, testMemberListExpectedResult } from '../../scripts/contextual-test-member-list-proof-fixture'
import { TEST_MEMBER_LIST_CANONICAL_TABLES_248 } from '../../scripts/contextual-test-member-list-proof-fixture'
import { createTestMemberListProofTransport, TEST_MEMBER_LIST_PROJECTIONS, testMemberListRequestManifest,
  testMemberListForcedReceipt, testMemberListCanonicalCatalog, validateTestMemberListCanonicalCheckpoint } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { testMemberListReviewedIsolatedCatalog, testMemberListLifecycleFailureDiagnostic, validateTestMemberListReviewedMigrations } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import type { Database } from '../../src/types/database'
import { readContextualStudentTestList } from '../../src/lib/server/contextual-student-test-list-read'

function fixture() {
  const original = newAssignmentListProofFixture(new Date('2026-10-08T12:00:00Z'))
  const f = newTestMemberListFixture(original), project = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
  const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
  const guard = vi.fn(async () => {}), fetcher = vi.fn<typeof fetch>(async () => new Response('[]'))
  const transport = createTestMemberListProofTransport(f, target, project, fetcher, guard)
  return { original, f, project, target, guard, fetcher, transport, headers: { apikey: key, authorization: `Bearer ${key}` } }
}
function snapshot(f: ReturnType<typeof newTestMemberListFixture>) {
  const categories = f.classes.flatMap((c, i) => ['Attendance', 'Term', 'Final'].map((name, p) => ({ id: `00000000-0000-4000-8000-${String(i * 3 + p + 1).padStart(12, '0')}`,
    classroom_id: c.id, name, percentage: [10, 65, 25][p], position: p, is_default: p === 1, default_assessment_weight: 10 })))
  return { 'public.users': f.actors, 'public.classrooms': f.classes.map((c, i) => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code,
    archived_at: c.archived_at, feature_visibility: c.feature_visibility, blueprint_source_revision: f.sideEffects[i].blueprintSourceRevision })),
  'public.tests': f.tests.map(t => ({ ...t, gradebook_category_id: categories.find(c => c.classroom_id === t.classroom_id && c.is_default)!.id })),
  'public.gradebook_categories': categories, 'public.test_questions': f.questions,
  'public.test_attempts': f.attempts, 'public.test_responses': f.responses, 'public.test_student_availability': f.availability,
  'public.classroom_enrollments': f.enrollments.filter(e => e !== f.removed).map(e => ({ id: e.id, classroom_id: e.classroomId, student_id: e.actorId })),
  'public.classroom_archive_revisions': f.sideEffects.map(e => ({ classroom_id: e.classroomId, revision: e.archiveRevision, updated_at: f.now })),
  ...Object.fromEntries(['public.assessment_drafts', 'public.classroom_roster', 'public.managed_storage_objects', 'public.managed_storage_json_references',
    'public.pal_event_outbox', 'private.pal_membership_outbox'].map(t => [t, []])),
  'private.pal_membership_generations': f.enrollments.map((e, i) => ({ generation_id: e.id, scope_digest: testOwnerDigest(`pika-membership-scope-v1:${e.classroomId}:${e.actorId}`),
    state: e === f.removed ? 'removed' : 'active', pal_reference: `pika-membership-v1-${String(i).padStart(32, '0')}` })),
  'private.pal_membership_settings': [{ singleton: true, enabled: false }], 'private.pal_classroom_signal_settings': [{ singleton: true, enabled: false }],
  'private.classroom_test_quota_settings': [{ singleton: true, enabled: false }],
  __all_fingerprints: [{ table: 'public.users', fingerprint: 'synthetic-only' }, { table: 'private.classroom_test_quota_settings', fingerprint: 'synthetic-only' }],
  }
}
/** Offline row simulation only; serialization uses the real installed SDK.
 * This is deliberately not described as native database/FK evidence. */
function sourceFetch(f: ReturnType<typeof newTestMemberListFixture>): typeof fetch {
  const rows = snapshot(f)
  return async resource => {
    const url = new URL(String(resource)), select = url.searchParams.get('select')
    const c = f.classes.find(c => `eq.${c.id}` === url.searchParams.get('id')); expect(c).toBeDefined()
    const base = { id: c!.id, teacher_id: c!.owner, archived_at: c!.archived_at }
    if (select === TEST_MEMBER_LIST_PROJECTIONS.preflight) return new Response(JSON.stringify([base]))
    const actor = url.searchParams.get('membership.student_id')?.slice(3)
    if (!f.enrollments.some(e => e !== f.removed && e.classroomId === c!.id && e.actorId === actor)) return new Response('[]')
    const root: Record<string, unknown> = { ...base, feature_visibility: c!.feature_visibility, membership: [{ classroom_id: c!.id, student_id: actor }] }
    const after = (key: string, id: string) => { const value = url.searchParams.get(key); return !value || id > value.slice(3) }
    const tests = rows['public.tests'].filter(t => t.classroom_id === c!.id && t.status !== 'draft').sort((a, b) => a.id.localeCompare(b.id))
    if (select === TEST_MEMBER_LIST_PROJECTIONS.tests) root.tests = tests.filter(t => after('tests.id', t.id))
      .map(t => Object.fromEntries('id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,gradebook_weight,created_by,created_at,updated_at'.split(',').map(k => [k, t[k as keyof typeof t]])))
    else if (select !== TEST_MEMBER_LIST_PROJECTIONS.root) {
      const kind = (['attempts', 'responses', 'availability'] as const).find(k => select === TEST_MEMBER_LIST_PROJECTIONS[k])
      root.tests = tests.map(t => ({ id: t.id, classroom_id: t.classroom_id, status: t.status, updated_at: t.updated_at,
        ...(kind ? { [kind]: f[kind].filter(r => r.test_id === t.id && r.student_id === actor && after(`tests.${kind}.id`, r.id))
          .sort((a, b) => a.id.localeCompare(b.id)).map(r => {
            const fields = kind === 'attempts' ? 'id,test_id,student_id,is_submitted,returned_at,closed_for_grading_at' : kind === 'responses' ? 'id,test_id,student_id,selected_option,response_text' : 'id,test_id,student_id,state'
            return Object.fromEntries(fields.split(',').map(k => [k, r[k as keyof typeof r]]))
          }) } : {}) }))
    }
    return new Response(JSON.stringify([root]))
  }
}
describe('finite member Test list fixture', () => {
  it('freezes the exact nine-case namespace, outside inherited IDs', () => {
    const { original, f } = fixture()
    for (const [key, n] of Object.entries({ actors: 5, classes: 5, tests: 8, questions: 4, attempts: 4, responses: 5, availability: 3, enrollments: 8, cases: 9 }))
      expect(f[key as keyof typeof f]).toHaveLength(n)
    expect(Object.isFrozen(f)).toBe(true); expect(Object.isFrozen(f.classes[0].feature_visibility)).toBe(true)
    expect(f.allocatedIds.every(id => !original.allocatedIds.includes(id))).toBe(true)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
  })
  it('retains existing finite caps and zero member Storage/RPC authority', () => {
    expect(TEST_MEMBER_LIST_CAPS).toMatchObject({ sqlBytes: 65536, networkRequests: 256, storageRequests: 0, rpcRequests: 0, requestMs: 15000,
      responseBytes: 8388608, totalBytes: 67108864, actions: 200, controls: 4000, totalMs: 900000 })
  })
  it('uses one exact removal and natural triggers without quota activation', () => {
    const { f, project } = fixture(), sql = testMemberListSetupSql(f, project)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(65536)
    expect(sql.match(/delete from /gi)).toHaveLength(1)
    expect(sql).toContain(`delete from public.classroom_enrollments where id='${f.removed.id}'`)
    expect(sql).not.toMatch(/disable trigger|truncate|update private\.|insert into public.managed_storage|maintenance_mode/i)
    expect(sql).toContain('Natural member list revision effects differ')
  })
  it('keeps option0 and repeated own responses, whitespace, foreign and removed noise', () => {
    const { f } = fixture()
    expect(f.responses[0].selected_option).toBe(0)
    expect(f.responses[0].test_id).toBe(f.responses[1].test_id)
    expect(f.responses[2].response_text).toBe('   ')
    expect(f.tests[4].blueprint_archived_at).toBe(f.now)
    expect(f.cases.filter(c => c.status === 200)).toHaveLength(3)
  })
  it('freezes exact native quota253 metadata alongside inherited guards', () => {
    const { project } = fixture(), guard = testMemberListGuardSql(project)
    for (const token of ['guard_pal_membership_evidence', 'guard_pal_signal_activation', 'test-documents', 'student_provider_cleanup_settings',
      'vault.secrets', 'cron.job', 'classroom_test_quota_settings', '8e21004e27de5796420497e475ab808b', 'tgenabled', 'tgfoid', 'tgtype', 'relrowsecurity', 'aclexplode',
      'proretset', 'pronargs', 'relforcerowsecurity', "contype='p'", "contype='c'", "attname='singleton'"]) expect(guard).toContain(token)
    expect(guard).toContain('not enabled'); expect(guard).not.toMatch(/update |alter |disable trigger/i)
  })
  it('snapshots entire Classes plus every public/private/Storage table, with no exemptions', () => {
    const { f } = fixture(), sql = testMemberListSnapshotSql(f)
    expect(sql).toContain('__all_fingerprints'); expect(sql).toContain("n.nspname in ('public','private','storage')")
    expect(sql).toContain(`classroom_id in ('${f.classes[0].id}'`)
    expect(sql).not.toContain('r.id not in'); expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(65536)
  })
  it('requires exact external catalog equality and fixture effects', () => {
    const { f } = fixture(), rows = snapshot(f), catalog = rows.__all_fingerprints.map(r => r.table)
    expect(() => validateTestMemberListSetupSnapshot(f, rows, catalog)).not.toThrow()
    expect(() => validateTestMemberListSetupSnapshot(f, rows, [...catalog, 'storage.objects'])).toThrow()
    const changed = structuredClone(rows); changed['public.classroom_archive_revisions'][0].revision++
    expect(() => validateTestMemberListSetupSnapshot(f, changed, catalog)).toThrow()
  })
  it.each(['quota', 'generation', 'extra-table', 'foreign-test', 'extra-class', 'archive-column'] as const)('rejects snapshot drift: %s', mode => {
    const { f } = fixture(), rows = structuredClone(snapshot(f)), catalog = rows.__all_fingerprints.map(r => r.table)
    if (mode === 'quota') rows['private.classroom_test_quota_settings'][0].enabled = true
    if (mode === 'generation') rows['private.pal_membership_generations'][3].state = 'active'
    if (mode === 'extra-table') rows.__all_fingerprints.push({ table: 'public.unexpected', fingerprint: 'extra' })
    if (mode === 'foreign-test') rows['public.tests'][0].classroom_id = f.actors[0].id
    if (mode === 'extra-class') rows['public.classrooms'].push(rows['public.classrooms'][0])
    if (mode === 'archive-column') Object.assign(rows['public.classroom_archive_revisions'][0], { extra: true })
    expect(() => validateTestMemberListSetupSnapshot(f, rows, catalog)).toThrow()
  })
  it('uses externally sealed253 addition rather than isolated self-adoption', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/253_classroom_test_tier_caps.sql', import.meta.url), 'utf8')
    const migrations = [{ name: '253_classroom_test_tier_caps.sql', sql, sha256: testOwnerDigest(sql) }]
    expect(classroomTestQuotaProofCatalog(['public.users'], migrations)).toEqual(['private.classroom_test_quota_settings', 'public.users'])
    expect(() => classroomTestQuotaProofCatalog(['public.users'], [{ ...migrations[0], sql: sql + '\n' }])).toThrow()
    expect(createHash('md5').update(sql.split('as $guard$')[1].split('$guard$;')[0]).digest('hex')).toBe('8e21004e27de5796420497e475ab808b')
  })
  it('preserves all five canonical fields and refuses baseline replacement', () => {
    const canonical = { rowDigests: JSON.stringify({ 'public.users': 'rows' }), guard168Metadata: '168', settings: 'settings', cronJobs: 'cron', resources: 'resources' }
    expect(testMemberListCanonicalCatalog(canonical)).toEqual(['public.users'])
    expect(() => validateTestMemberListCanonicalCheckpoint(canonical, canonical)).not.toThrow()
    for (const key of Object.keys(canonical)) expect(() => validateTestMemberListCanonicalCheckpoint({ ...canonical, [key]: 'changed' }, canonical)).toThrow()
    expect(() => validateTestMemberListCanonicalCheckpoint({ ...canonical, extra: 'extra' }, canonical)).toThrow()
  })
  it('builds independent legacy DTO expectations without answers or state leakage', () => {
    const { f } = fixture(), rows = snapshot(f), result = testMemberListExpectedResult(f, f.cases[0], rows)
    expect(result.tests).toHaveLength(6)
    expect(result.tests.some(t => t.id === f.tests[4].id)).toBe(true)
    expect(result.tests.find(t => t.id === f.tests[1].id)?.documents).toEqual([])
    expect(result.tests.find(t => t.id === f.tests[2].id)?.student_status).toBe('can_view_results')
    for (const row of result.tests) expect(Object.keys(row).sort()).toEqual('id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,gradebook_weight,created_by,created_at,updated_at,assessment_type,student_status,access_state,effective_access'.split(',').sort())
  })
})
describe('actual-source member migration profiles (offline)', () => {
  const current = loadAssignmentListReviewedMigrations(process.cwd())
  const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')
  it('reproduces the former exact257 rejection of the complete current258 chain', () => {
    expect(current).toHaveLength(258)
    expect(() => assert.equal(current.length, 257)).toThrow()
    expect(current[255]).toMatchObject({ name: '256_contextual_test_owner_workflow.sql',
      sha256: '33fece6f4d2bc64046888d93b88a5349f1028eb9f0851ec4895f81102de2d831' })
    expect(digest(current[255].sql)).toBe('33fece6f4d2bc64046888d93b88a5349f1028eb9f0851ec4895f81102de2d831')
    expect(current[256]).toMatchObject({ name: '257_contextual_test_learner_workflow.sql',
      sha256: 'd4f12d17b79e4800e5bdd6ea7db2c0fee7cf51d19a5dfde93084c243b22c1e2a' })
    expect(digest(current[256].sql)).toBe('d4f12d17b79e4800e5bdd6ea7db2c0fee7cf51d19a5dfde93084c243b22c1e2a')
    expect(current.at(-1)).toMatchObject({ name: '258_contextual_test_owner_grading.sql',
      sha256: '84dfe4fe883405d477da88e134d5c8f443736ba9118b97d6e8babf0708de614c' })
    expect(digest(current.at(-1)!.sql)).toBe('84dfe4fe883405d477da88e134d5c8f443736ba9118b97d6e8babf0708de614c')
  })
  it.each([253, 254, 255, 256, 257, 258])('accepts the complete actual-source %i profile with both unchanged catalogs', count => {
    const migrations = current.slice(0, count)
    expect(() => validateTestMemberListReviewedMigrations(migrations)).not.toThrow()
    const local = TEST_MEMBER_LIST_CANONICAL_TABLES_248, ci = [...local, 'private.classroom_test_quota_settings'].sort()
    expect(local).toHaveLength(183); expect(ci).toHaveLength(184)
    expect(testMemberListReviewedIsolatedCatalog(local, migrations)).toEqual(ci)
    expect(testMemberListReviewedIsolatedCatalog(ci, migrations)).toEqual(ci)
  })
  it.each(['future259', 'bad258name', 'bad258digest', 'bad258bytes', 'self-hashed258bytes', 'bad257name', 'bad257digest', 'bad257bytes', 'self-hashed257bytes', 'bad256name', 'bad256digest', 'bad256bytes', 'self-hashed256bytes', 'bad255name', 'bad255digest', 'bad255bytes', 'self-hashed255bytes', 'bad254name', 'bad254digest', 'bad254bytes', 'self-hashed254bytes', 'gap', 'counter-digest',
    'bad253name', 'self-hashed253bytes'] as const)('rejects unreviewed source profile: %s', defect => {
    const migrations = current.map(m => ({ ...m })), tail = migrations[253]
    if (defect === 'future259') migrations.push({ name: '259_unknown.sql', sql: 'select 1;', sha256: digest('select 1;') })
    const grading = migrations[257]
    if (defect === 'bad258name') grading.name = '258_unknown.sql'
    if (defect === 'bad258digest') grading.sha256 = 'f'.repeat(64)
    if (defect === 'bad258bytes' || defect === 'self-hashed258bytes') grading.sql += '\n'
    if (defect === 'self-hashed258bytes') grading.sha256 = digest(grading.sql)
    const learner = migrations[256]
    if (defect === 'bad257name') learner.name = '257_unknown.sql'
    if (defect === 'bad257digest') learner.sha256 = 'f'.repeat(64)
    if (defect === 'bad257bytes' || defect === 'self-hashed257bytes') learner.sql += '\n'
    if (defect === 'self-hashed257bytes') learner.sha256 = digest(learner.sql)
    const workflow = migrations[255]
    if (defect === 'bad256name') workflow.name = '256_unknown.sql'
    if (defect === 'bad256digest') workflow.sha256 = 'f'.repeat(64)
    if (defect === 'bad256bytes' || defect === 'self-hashed256bytes') workflow.sql += '\n'
    if (defect === 'self-hashed256bytes') workflow.sha256 = digest(workflow.sql)
    const addition = migrations[254]
    if (defect === 'bad255name') addition.name = '255_unknown.sql'
    if (defect === 'bad255digest') addition.sha256 = 'f'.repeat(64)
    if (defect === 'bad255bytes' || defect === 'self-hashed255bytes') addition.sql += '\n'
    if (defect === 'self-hashed255bytes') addition.sha256 = digest(addition.sql)
    if (defect === 'bad254name') tail.name = '254_unknown.sql'
    if (defect === 'bad254digest') tail.sha256 = 'f'.repeat(64)
    if (defect === 'bad254bytes' || defect === 'self-hashed254bytes') tail.sql += '\n'
    if (defect === 'self-hashed254bytes') tail.sha256 = digest(tail.sql)
    if (defect === 'gap') migrations.splice(100, 1)
    if (defect === 'counter-digest') migrations[100].sha256 = 'f'.repeat(64)
    if (defect === 'bad253name') migrations[252].name = '253_unknown.sql'
    if (defect === 'self-hashed253bytes') { migrations[252].sql += '\n'; migrations[252].sha256 = digest(migrations[252].sql) }
    expect(() => validateTestMemberListReviewedMigrations(migrations)).toThrow()
  })
  it('keeps full source manifest equality at the runtime guard and all five checkpoint comparisons', () => {
    const source = readFileSync('scripts/check-contextual-test-member-list-lifecycle.ts', 'utf8')
    expect(source).toContain('loadAssignmentListReviewedMigrations(repository); validateTestMemberListReviewedMigrations(migrations)')
    expect(source).toContain('assert.deepEqual(loadAssignmentListReviewedMigrations(repository).map(({ name, sha256 }) => ({ name, sha256 })), union.migrations)')
    const checkpoint = { rowDigests: 'rows', guard168Metadata: '168', settings: 'settings', cronJobs: 'cron', resources: 'resources' }
    for (const key of Object.keys(checkpoint))
      expect(() => validateTestMemberListCanonicalCheckpoint({ ...checkpoint, [key]: 'changed' }, checkpoint)).toThrow()
    const ci = [...TEST_MEMBER_LIST_CANONICAL_TABLES_248, 'private.classroom_test_quota_settings'].sort()
    for (const catalog of [ci.slice(1), [...ci, 'private.unreviewed'], [...ci, ci[0]]])
      expect(() => testMemberListReviewedIsolatedCatalog(catalog, current)).toThrow()
  })
})
describe('finite member SDK manifest', () => {
  it('accepts both complete reviewed local248 and CI253 catalog profiles without exclusions', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/253_classroom_test_tier_caps.sql', import.meta.url), 'utf8')
    const migrations = [{ name: '253_classroom_test_tier_caps.sql', sql, sha256: testOwnerDigest(sql) }]
    const local = TEST_MEMBER_LIST_CANONICAL_TABLES_248
    const ci = [...local, 'private.classroom_test_quota_settings'].sort()
    expect(local).toHaveLength(183); expect(ci).toHaveLength(184)
    expect(testMemberListReviewedIsolatedCatalog(local, migrations)).toEqual(ci)
    expect(testMemberListReviewedIsolatedCatalog(ci, migrations)).toEqual(ci)
    expect(ci).toContain('public.auth_sessions')
    for (const input of [local.slice(1), [...local, 'public.unexpected'], ['public.unexpected', ...local.slice(1)], [...ci, ci[0]]])
      expect(() => testMemberListReviewedIsolatedCatalog(input, migrations)).toThrow()
    expect(() => testMemberListReviewedIsolatedCatalog(ci, [{ ...migrations[0], sha256: 'invalid' }])).toThrow()
    expect(() => testMemberListReviewedIsolatedCatalog(ci, [{ ...migrations[0], sql: sql + '\n' }])).toThrow()
  })
  it('is frozen and contains only exact independent GET projections', () => {
    const { f } = fixture(), manifest = testMemberListRequestManifest(f)
    expect(Object.isFrozen(manifest)).toBe(true); expect(Object.isFrozen(manifest.projections)).toBe(true)
    expect(manifest.path).toBe('/rest/v1/classrooms'); expect(manifest.method).toBe('GET')
    expect(TEST_MEMBER_LIST_PROJECTIONS.preflight).toBe('id,teacher_id,archived_at')
    expect(TEST_MEMBER_LIST_PROJECTIONS.tests).not.toMatch(/answer|score|feedback|artifact|questions_locked/)
  })
  it('accepts real installed SDK serialization for exactly one metadata preflight', async () => {
    const { f, target, transport, fetcher } = fixture(); transport.readContext(f.cases[0].classroomId, f.cases[0].actorId)
    const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
    await client.from('classrooms').select(TEST_MEMBER_LIST_PROJECTIONS.preflight).eq('id', f.cases[0].classroomId).maybeSingle()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(transport.fetch(fetcher.mock.calls[0][0], fetcher.mock.calls[0][1])).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('serializes all nine fixed helper cases through the independent member manifest', async () => {
    const { f, target, project } = fixture(), guard = vi.fn(async () => {})
    const transport = createTestMemberListProofTransport(f, target, project, sourceFetch(f), guard)
    const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
    for (const c of f.cases) {
      transport.readContext(c.classroomId, c.actorId)
      const read = () => readContextualStudentTestList({ supabase: client, actorId: c.actorId, classroomId: c.classroomId })
      if (c.status === 403) await expect(read()).rejects.toMatchObject({ statusCode: 403 })
      else expect(await read()).toEqual(testMemberListExpectedResult(f, c, snapshot(f)))
    }
    for (const count of Object.values(transport.evidence)) expect(count).toBeGreaterThan(0)
    expect(transport.counts.network).toBeLessThanOrEqual(256); expect(guard).toHaveBeenCalledTimes(transport.counts.network)
  })
  it.each(['foreign-origin', 'rpc', 'post', 'answer-key', 'unbound-class', 'redirect', 'extra-header'] as const)('rejects dispatch substitution: %s', async mode => {
    const { f, transport, headers, fetcher } = fixture(); transport.readContext(f.cases[0].classroomId, f.cases[0].actorId)
    const url = new URL('http://127.0.0.1:54331/rest/v1/classrooms'); url.searchParams.set('select', TEST_MEMBER_LIST_PROJECTIONS.preflight); url.searchParams.set('id', `eq.${f.cases[0].classroomId}`)
    const init: RequestInit = { headers }
    if (mode === 'foreign-origin') url.hostname = 'example.invalid'
    if (mode === 'rpc') url.pathname = '/rest/v1/rpc/arbitrary'
    if (mode === 'post') init.method = 'POST'
    if (mode === 'answer-key') url.searchParams.set('select', 'id,answer_key')
    if (mode === 'unbound-class') url.searchParams.delete('id')
    if (mode === 'redirect') init.redirect = 'follow'
    if (mode === 'extra-header') init.headers = { ...headers, 'x-arbitrary': 'value' }
    await expect(transport.fetch(url.toString(), init)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled()
  })
  it('recognizes only completely set up forced lifecycle failures with clean teardown', () => {
    for (const mode of ['after-fixture', 'before-capture']) {
      const error = new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
      expect(testMemberListForcedReceipt(mode, error, true)).toMatchObject({ exitCode: 1 })
      expect(testMemberListForcedReceipt(mode, error, true)?.stdout).toBe('PASS isolated test-member-list exact teardown and unchanged canonical baseline.\n')
      expect(testMemberListForcedReceipt(mode, error, true)?.stderr).toBe(`FAIL forced isolated test-member-list lifecycle: ${mode}.\n`)
      expect(testMemberListForcedReceipt(mode, error, false)).toBeNull()
      expect(testMemberListForcedReceipt(mode, new AssignmentListLifecycleError(error.primary, [{ stage: 'cleanup', error: new Error() }]), true)).toBeNull()
    }
  })
  it('reports closed inherited failure stages without private error contents', () => {
    const privateValue = 'private-credential-row-sql'; const error = new AssignmentListLifecycleError({ stage: 'revocations', error: new Error(privateValue), transition: 'archive', boundary: 'terminal' }, [])
    const line = testMemberListLifecycleFailureDiagnostic(error, 900001)
    expect(line).toContain('stage=revocations'); expect(line).toContain('deadline=expired')
    expect(line).toContain('transition=archive boundary=terminal'); expect(line).not.toContain(privateValue)
    expect(testMemberListLifecycleFailureDiagnostic(new Error(privateValue), 1)).toContain('stage=unknown')
    expect(testMemberListLifecycleFailureDiagnostic(new AssignmentListLifecycleError({ stage: privateValue, error: new Error(privateValue) }, []), 1)).not.toContain(privateValue)
  })
  it('adopts the inherited work-only budget hook without gating its cleanup adapters', () => {
    const source = readFileSync(new URL('../../scripts/check-contextual-test-member-list-lifecycle.ts', import.meta.url), 'utf8')
    expect(source).toContain('checkWork: check')
    expect(source).not.toContain('testMemberListBoundedPhase')
    expect(source).toContain('const captured = await native.canonicalSnapshot(request)')
  })
  it('cancels a body when cumulative output accounting rejects it', async () => {
    const { f, target, project, headers } = fixture(), cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from('[]')) }, cancel })
    const transport = createTestMemberListProofTransport(f, target, project, async () => new Response(stream), async () => {}, () => { throw new Error('Cap') })
    transport.readContext(f.cases[0].classroomId, f.cases[0].actorId)
    const url = new URL('http://127.0.0.1:54331/rest/v1/classrooms'); url.searchParams.set('select', TEST_MEMBER_LIST_PROJECTIONS.preflight); url.searchParams.set('id', `eq.${f.cases[0].classroomId}`)
    await expect(transport.fetch(url.toString(), { headers })).rejects.toThrow()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
