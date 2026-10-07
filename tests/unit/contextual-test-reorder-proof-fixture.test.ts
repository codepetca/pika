import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture, assertIssuedTestOwnerReorderFixture, TEST_OWNER_REORDER_CAPS, TEST_OWNER_REORDER_SNAPSHOT_TABLES,
  testOwnerReorderBulkTest, testOwnerReorderRequest, testOwnerReorderSetupSql, testOwnerReorderSnapshotSql,
  testOwnerReorderBulkOrderSql, testOwnerReorderTableCatalogFromCanonical, validateTestOwnerReorderSetupSnapshot,
  registerTestOwnerReorderWitness, verifyTestOwnerReorderEffects, type TestOwnerReorderWitness } from '../../scripts/contextual-test-reorder-proof-fixture'

const original = newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z'))
const f = newTestOwnerReorderFixture(original)
type Row = Record<string, unknown>
const stamp = '2026-10-07T04:00:00.123456Z'
const window = { startMs: Date.parse(stamp) - 1000, deadlineMs: Date.parse(stamp) + 1000 }
const tableNames = [...TEST_OWNER_REORDER_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets', 'public.unrelated_future_table']
const catalog = testOwnerReorderTableCatalogFromCanonical({ rowDigests: JSON.stringify(Object.fromEntries(tableNames.map(t => [t, { count: 0, digest: 'a'.repeat(32) }]))),
  guard168Metadata: '{}', settings: '{}', cronJobs: '[]', resources: '[]' })
export function reorderBaseline() {
  const s: Record<string, Row[]> = Object.fromEntries(TEST_OWNER_REORDER_SNAPSHOT_TABLES.map(t => [t, []]))
  s['public.users'] = f.actors.map(r => ({ ...r, preserved: true }))
  s['public.classrooms'] = f.classes.map(c => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code,
    archived_at: c.archived ? f.now : null, blueprint_source_revision: 203, updated_at: f.now, untouched: 'keep' }))
  s['public.classroom_archive_revisions'] = f.classes.map(c => ({ classroom_id: c.id, revision: 411, updated_at: f.now }))
  s['public.gradebook_categories'] = f.classes.flatMap((c, ci) => [0, 1, 2].map(i => ({ id: `99999999-9999-4999-8999-${String(ci * 3 + i).padStart(12, '0')}`,
    classroom_id: c.id, position: i, is_default: i === 0 })))
  s['public.tests'] = f.tests.map(t => ({ ...structuredClone(t), gradebook_category_id: s['public.gradebook_categories'].find(c => c.classroom_id === t.classroom_id)!.id }))
  s.__bulk_tests = f.bulkClasses.flatMap(b => Array.from({ length: b.count }, (_, i) => {
    const t = testOwnerReorderBulkTest(f, b.label, i)
    return { id: t.id, classroom_id: t.classroom_id, position: t.position, updated_at: t.updated_at,
      immutable_sha256: createHash('sha256').update(JSON.stringify(t)).digest('hex') }
  }))
  s.__bulk_setup = f.bulkClasses.map(b => ({ classroom_id: b.classroomId, count: b.count, immutable_valid: true }))
  for (const [t, rows] of [['public.test_questions', f.questions], ['public.assessment_drafts', f.drafts],
    ['public.classroom_enrollments', f.enrollments], ['public.test_attempts', f.attempts], ['public.test_responses', f.responses],
    ['public.test_student_availability', f.availability], ['public.test_focus_events', f.focusEvents],
    ['public.test_attempt_history', f.attemptHistory], ['public.classroom_guided_draft_provenance', f.provenance]] as const) s[t] = rows.map(r => structuredClone(r))
  s['public.managed_storage_settings'] = [{ singleton: true, active_version: 0, updated_at: f.now }]
  for (const t of ['private.pal_membership_settings', 'private.pal_classroom_signal_settings', 'private.student_provider_cleanup_settings',
    'private.classroom_creation_entitlement_settings']) s[t] = [{ singleton: true, enabled: false }]
  s.__nontarget_fingerprints = tableNames.map(table => ({ table, fingerprint: 'unchanged' }))
  validateTestOwnerReorderSetupSnapshot(f, s, catalog)
  return s
}
export function reorderPostimage(before: ReturnType<typeof reorderBaseline>, label: string) {
  const c = f.cases.find(c => c.label === label)!
  const input = testOwnerReorderRequest(f, label)
  const positions = input.test_ids.map((_, i) => input.test_ids.length - 1 - i)
  const index = new Map(input.test_ids.map((id, i) => [id, i]))
  const after = structuredClone(before)
  let changed = 0
  for (const table of ['public.tests', '__bulk_tests']) after[table] = after[table].map(r => {
    const i = index.get(String(r.id))
    if (i === undefined || r.position === positions[i]) return r
    changed++; return { ...r, position: positions[i], updated_at: stamp }
  })
  for (const [table, key, revision, delta] of [['public.classrooms', 'id', 'blueprint_source_revision', changed],
    ['public.classroom_archive_revisions', 'classroom_id', 'revision', 2 * changed]] as const) {
    after[table] = after[table].map(r => r[key] === c.classroomId && delta ? { ...r, [revision]: Number(r[revision]) + delta, updated_at: stamp } : r)
  }
  return { after, envelope: { version: 1, actor_id: c.actorId, classroom_id: c.classroomId, test_ids: input.test_ids, positions,
    count: input.test_ids.length, changed_count: changed }, publicResult: { success: true } }
}

describe('inert finite reorder fixture', () => {
  it('admits only an issued frozen fixture, not a structurally equal clone or forged object', () => {
    expect(() => assertIssuedTestOwnerReorderFixture(f)).not.toThrow()
    for (const value of [null, undefined, {}, { ...f }, Object.freeze(structuredClone(f))])
      expect(() => assertIssuedTestOwnerReorderFixture(value)).toThrow('Unissued Test reorder fixture')
  })
  it('is deterministic, deep frozen, bounded, disjoint and includes real preserved children', () => {
    expect(newTestOwnerReorderFixture(original)).toEqual(f)
    expect(Object.isFrozen(f.questions[0])).toBe(true)
    expect(f.nativeVerified).toBe(false)
    expect(f.inventory.tests).toBe(21014)
    expect(f.bulkClasses.map(b => b.count)).toEqual([1001, 10000, 10001])
    expect(f.tests.filter(t => t.questions_locked_at)).toHaveLength(3)
    expect(f.provenance).toHaveLength(3)
    expect(f.responses).toHaveLength(3)
    expect(f.allocatedIds.some(id => original.allocatedIds.includes(id))).toBe(false)
  })
  it('generates compact guarded SQL without changing global platform caps or disabling triggers', () => {
    const sql = testOwnerReorderSetupSql(f, `pika_assignment_list_${f.tag.slice(-12)}`)
    expect(Buffer.byteLength(sql)).toBeLessThan(TEST_OWNER_REORDER_CAPS.sqlBytes)
    expect(sql).toContain('generate_series(0,10000)')
    expect(sql).not.toMatch(/disable trigger|session_replication_role|truncate|delete from|set blueprint_source_revision|set revision/i)
    expect(() => testOwnerReorderSetupSql(f, 'production')).toThrow()
    expect(testOwnerReorderBulkOrderSql(f, 'bulk-10000')).toContain('order by position asc,id asc')
    expect(testOwnerReorderSnapshotSql(f)).toContain("n.nspname in ('public','private','storage')")
    expect(Buffer.byteLength(JSON.stringify(testOwnerReorderRequest(f, 'bulk-10000')))).toBeLessThan(TEST_OWNER_REORDER_CAPS.bodyBytes)
  })
  it('binds to source-derived canonical table catalog including future tables', () => {
    const s = reorderBaseline()
    expect(() => validateTestOwnerReorderSetupSnapshot(f, s, [...catalog])).toThrow(/catalog/i)
    const missing = structuredClone(s); missing.__nontarget_fingerprints.pop()
    expect(() => validateTestOwnerReorderSetupSnapshot(f, missing, catalog)).toThrow()
    expect(() => testOwnerReorderTableCatalogFromCanonical({ rowDigests: '{}'})).toThrow()
    const wrong = structuredClone(s); wrong['public.tests'][0].extra = true
    expect(() => validateTestOwnerReorderSetupSnapshot(f, wrong, catalog)).toThrow()
  })
  it('bounds the actual compact snapshot and complete 10,001-source request', () => {
    const s = reorderBaseline()
    expect(Buffer.byteLength(JSON.stringify(s))).toBeLessThan(TEST_OWNER_REORDER_CAPS.snapshotBytes)
    expect(testOwnerReorderRequest(f, 'bulk-10001').test_ids).toHaveLength(10000)
    expect(f.cases.find(c => c.label === 'bulk-10001')).toMatchObject({ expectedHTTP: 503, expectedRPCs: 1 })
  })
})

describe('strict complete reorder effect sink', () => {
  it.each(['teacher-owner', 'student-owner', 'empty-owner', 'bulk-1001', 'bulk-10000'])('verifies the complete %s request/effect', label => {
    const before = reorderBaseline(); const { after, envelope, publicResult } = reorderPostimage(before, label)
    const pending = registerTestOwnerReorderWitness(f, [], label, envelope, window)
    expect(pending[0].state).toBe('provisional')
    expect(verifyTestOwnerReorderEffects(f, before, after, label, pending, publicResult, stamp)[0].state).toBe('verified')
  })
  it.each(['position', 'title', 'documents', 'classroom_id', 'questions_locked_at', 'created_by', 'updated_at'])('rejects unexplained Test %s drift', key => {
    const before = reorderBaseline(); const p = reorderPostimage(before, 'teacher-owner')
    p.after['public.tests'][0][key] = key === 'position' ? 200 : key.endsWith('_at') ? '2026-10-07T04:00:00.123457Z' : 'corrupt'
    const pending = registerTestOwnerReorderWitness(f, [], 'teacher-owner', p.envelope, window)
    expect(() => verifyTestOwnerReorderEffects(f, before, p.after, 'teacher-owner', pending, p.publicResult, stamp)).toThrow()
  })
  it.each(['public.test_questions', 'public.assessment_drafts', 'public.test_attempts', 'public.test_responses',
    'public.test_student_availability', 'public.test_focus_events', 'public.test_attempt_history', 'public.classroom_guided_draft_provenance',
    'public.managed_storage_settings', '__nontarget_fingerprints'])('rejects any preserved %s row write', table => {
    const before = reorderBaseline(); const p = reorderPostimage(before, 'teacher-owner'); p.after[table][0].drift = true
    const pending = registerTestOwnerReorderWitness(f, [], 'teacher-owner', p.envelope, window)
    expect(() => verifyTestOwnerReorderEffects(f, before, p.after, 'teacher-owner', pending, p.publicResult, stamp)).toThrow()
  })
  it.each(['count', 'changed_count', 'positions', 'test_ids', 'actor_id', 'classroom_id', 'extra'])('rejects an unbound acknowledgement %s', key => {
    const before = reorderBaseline(); const p = reorderPostimage(before, 'teacher-owner'); const bad: Row = { ...p.envelope, [key]: 123 }
    expect(() => registerTestOwnerReorderWitness(f, [], 'teacher-owner', bad, window)).toThrow()
  })
  it('pins complete no-op/denial snapshots and rejects forged, cloned, reordered or cross-fixture ledgers', () => {
    const before = reorderBaseline(); const p = reorderPostimage(before, 'teacher-owner')
    const pending = registerTestOwnerReorderWitness(f, [], 'teacher-owner', p.envelope, window)
    expect(() => verifyTestOwnerReorderEffects(f, before, p.after, 'teacher-owner', structuredClone(pending), p.publicResult, stamp)).toThrow()
    const verified = verifyTestOwnerReorderEffects(f, before, p.after, 'teacher-owner', pending, p.publicResult, stamp)
    const noOp = reorderPostimage(p.after, 'teacher-noop'); expect(noOp.envelope.changed_count).toBe(0)
    const next = registerTestOwnerReorderWitness(f, verified, 'teacher-noop', noOp.envelope, window)
    const done = verifyTestOwnerReorderEffects(f, p.after, noOp.after, 'teacher-noop', next, noOp.publicResult)
    expect(done.every(w => w.state === 'verified')).toBe(true)
    const forged: TestOwnerReorderWitness[] = done.map(w => ({ ...w, state: 'verified' }))
    expect(() => verifyTestOwnerReorderEffects(f, noOp.after, noOp.after, 'member-denied', forged)).toThrow()
    expect(() => verifyTestOwnerReorderEffects(f, before, before, 'member-denied', done)).toThrow()
    const drift = structuredClone(noOp.after); drift['public.users'][0].preserved = false
    expect(() => verifyTestOwnerReorderEffects(f, noOp.after, drift, 'member-denied', done)).toThrow()
  })
  it('rejects revision drift, unchanged-row timestamps, incomplete membership and response leakage', () => {
    const before = reorderBaseline(); const p = reorderPostimage(before, 'teacher-owner')
    const pending = registerTestOwnerReorderWitness(f, [], 'teacher-owner', p.envelope, window)
    const rev = structuredClone(p.after); rev['public.classroom_archive_revisions'][0].revision = Number(rev['public.classroom_archive_revisions'][0].revision) + 1
    expect(() => verifyTestOwnerReorderEffects(f, before, rev, 'teacher-owner', pending, p.publicResult, stamp)).toThrow()
    const missing = structuredClone(p.after); missing['public.tests'].pop()
    expect(() => verifyTestOwnerReorderEffects(f, before, missing, 'teacher-owner', pending, p.publicResult, stamp)).toThrow()
    expect(() => verifyTestOwnerReorderEffects(f, before, p.after, 'teacher-owner', pending, { success: true, count: 4 }, stamp)).toThrow()
    expect(() => verifyTestOwnerReorderEffects(f, before, p.after, 'teacher-owner', pending, p.publicResult, '2026-10-07T04:00:00.123457Z')).toThrow()
  })
  it('verifies complete bulk immutable digests and the unchanged middle-row timestamp', () => {
    const before = reorderBaseline(); const p = reorderPostimage(before, 'bulk-1001')
    const pending = registerTestOwnerReorderWitness(f, [], 'bulk-1001', p.envelope, window)
    const digestDrift = structuredClone(p.after); digestDrift.__bulk_tests[0].immutable_sha256 = 'f'.repeat(64)
    expect(() => verifyTestOwnerReorderEffects(f, before, digestDrift, 'bulk-1001', pending, p.publicResult, stamp)).toThrow()
    const middle = testOwnerReorderBulkTest(f, 'bulk-1001', 500)
    const timeDrift = structuredClone(p.after); timeDrift.__bulk_tests.find(r => r.id === middle.id)!.updated_at = stamp
    expect(() => verifyTestOwnerReorderEffects(f, before, timeDrift, 'bulk-1001', pending, p.publicResult, stamp)).toThrow()
    const changedCount = { ...p.envelope, changed_count: 999 }
    const wrong = registerTestOwnerReorderWitness(f, [], 'bulk-1001', changedCount, window)
    expect(() => verifyTestOwnerReorderEffects(f, before, p.after, 'bulk-1001', wrong, p.publicResult, stamp)).toThrow()
  })
  it('rejects a transaction timestamp beyond the absolute request deadline at microsecond precision', () => {
    const before = reorderBaseline(); const p = reorderPostimage(before, 'teacher-owner')
    const deadlineMs = Date.parse(stamp)
    const pending = registerTestOwnerReorderWitness(f, [], 'teacher-owner', p.envelope, { startMs: deadlineMs - 1, deadlineMs })
    expect(() => verifyTestOwnerReorderEffects(f, before, p.after, 'teacher-owner', pending, p.publicResult, stamp)).toThrow(/timestamp/i)
  })
})
