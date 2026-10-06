import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerCreateFixture, testOwnerCreateSetupSql, testOwnerCreateSnapshotSql, registerTestOwnerCreateWitness,
  verifyTestOwnerCreateEffects, validateTestOwnerCreateSetupSnapshot, TEST_OWNER_CREATE_SNAPSHOT_TABLES, TEST_OWNER_CREATE_CAPS } from '../../scripts/contextual-test-owner-create-proof-fixture'

const original = newAssignmentListProofFixture(new Date('2026-10-06T03:30:00Z'))
const f = newTestOwnerCreateFixture(original)
const project = `pika_assignment_list_${f.tag.slice(-12)}`
const stamp = '2026-10-06T04:00:00.000Z'
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
const success = f.cases[0]
function envelope() {
  const test = { id: ids[0], artifact_id: ids[1], classroom_id: success.classroomId, created_by: success.actorId,
    title: success.input.title!, show_results: false, status: 'draft', documents: [], position: 0, points_possible: 100, include_in_final: true,
    created_at: stamp, updated_at: stamp, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null, questions_locked_at: null,
    gradebook_category_id: null as string | null, gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 10 }
  return { version: 1, actor_id: success.actorId, classroom_id: success.classroomId, test_id: test.id, test,
    draft: { id: ids[2], assessment_type: 'test', assessment_id: test.id, classroom_id: success.classroomId, version: 1,
      content: { title: test.title, show_results: false, question_identity_version: 1, questions: [], source_format: 'markdown' },
      created_by: success.actorId, updated_by: success.actorId, created_at: stamp, updated_at: stamp } }
}
function snapshots() {
  const before: Record<string, Record<string, unknown>[]> = Object.fromEntries(TEST_OWNER_CREATE_SNAPSHOT_TABLES.map(t => [t, []]))
  before['public.classrooms'] = f.classes.map(c => ({ id: c.id, teacher_id: c.owner, archived_at: c.archived ? f.now : null,
    blueprint_source_revision: 9, updated_at: f.now, title: c.title, extra_preserved: true }))
  before['public.classroom_archive_revisions'] = f.classes.map(c => ({ classroom_id: c.id, revision: 15, updated_at: f.now }))
  before['public.tests'] = f.tests.map(t => ({ ...envelope().test, ...t, created_at: f.now, updated_at: f.now }))
  before['public.gradebook_categories'] = f.classes.flatMap((c, ci) => [0, 1, 2].map(i => ({
    id: `99999999-9999-4999-8999-${String(ci * 3 + i).padStart(12, '0')}`, classroom_id: c.id, is_default: i === 1,
    position: i, default_assessment_weight: i === 1 ? 27 : 10, name: `Category ${i}`, created_at: f.now, updated_at: f.now })))
  before['public.users'] = f.actors.map(a => ({ ...a, account_id: null, untouched: true }))
  before['public.classroom_enrollments'] = f.enrollments.map(e => ({ ...e, created_at: f.now }))
  before['__nontarget_fingerprints'] = [...TEST_OWNER_CREATE_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'].map(table => ({ table, fingerprint: 'unchanged' }))
  const after = structuredClone(before); const e = envelope()
  e.test.gradebook_category_id = before['public.gradebook_categories'][1].id as string
  e.test.gradebook_weight = 27
  after['public.tests'].push(e.test); after['public.assessment_drafts'] = [e.draft]
  const classroom = after['public.classrooms'].find(r => (r as {id:string}).id === success.classroomId) as Record<string,unknown>
  classroom.blueprint_source_revision = 11; classroom.updated_at = stamp
  const archive = after['public.classroom_archive_revisions'].find(r => (r as {classroom_id:string}).classroom_id === success.classroomId) as Record<string,unknown>
  archive.revision = 19; archive.updated_at = stamp
  return { before, after, e, publicResult: { test: { ...e.test, assessment_type: 'test' } } }
}
describe('ordinary owner CREATE finite source fixture', () => {
  it('is deterministic, deeply frozen and disjoint with reserved missing identity', () => {
    expect(newTestOwnerCreateFixture(original)).toEqual(f)
    expect(Object.isFrozen(f.cases[0].input)).toBe(true)
    expect(f.allocatedIds).toContain(f.missingClassroomId)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.allocatedIds.some(id => new Set<string>(original.allocatedIds).has(id))).toBe(false)
    expect(f.actors.map(a => a.role)).toEqual(['student', 'teacher', 'student', 'teacher'])
    expect(f.classes).toHaveLength(4)
    expect(f.enrollments.some(e => e.classroom_id === f.classes[0].id && e.student_id === f.actors[0].id)).toBe(true)
    expect(f.tests).toHaveLength(1001)
    expect(f.tests.at(-1)).toMatchObject({ position: 1000, blueprint_archived_at: f.now })
    expect(f.cases).toHaveLength(14)
    expect(f.cases.filter(c => c.expectedHTTP === 201)).toHaveLength(8)
    expect(f.privilegeProbe.expectedCode).toBe('42501')
    expect(f.cases.some(c => c.label.includes('privilege-probe'))).toBe(false)
    expect(f.cases.find(c => c.label === 'omitted-title')!.input).not.toHaveProperty('title')
    expect(f.cases.find(c => c.label === 'null-title')!.input.title).toBeNull()
    expect(f.cases.find(c => c.label === 'former-owner-style-denied')!.assertions).toContain('No synthetic ownership transfer claimed')
  })
  it('produces guarded bounded insert-only setup with exactly1001 rows and natural counters', () => {
    const sql = testOwnerCreateSetupSql(f, project)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(TEST_OWNER_CREATE_CAPS.sqlBytes)
    expect(sql).toContain('insert into public.tests(id,artifact_id,classroom_id,created_by,title,position,blueprint_archived_at)')
    for (const t of f.tests) expect(sql).toContain(t.id)
    expect(sql).not.toMatch(/insert into public\.(test_questions|assessment_drafts)/)
    expect(sql).not.toMatch(/set (blueprint_source_revision|revision)\s*=/)
    expect(sql).not.toMatch(/delete from|truncate /i)
    expect(() => testOwnerCreateSetupSql(f, 'production')).toThrow()
  })
  it('snapshots complete owned-Class rows, not fixed Test IDs, and every other table globally', () => {
    const sql = testOwnerCreateSnapshotSql(f)
    expect(sql).toContain('repeatable read read only')
    expect(sql).toContain('from public.tests t where classroom_id in')
    expect(sql).toContain('select id from public.tests where classroom_id in')
    expect(sql).toContain("n.nspname in ('public','private','storage')")
    expect(sql).toContain('to_jsonb(t)')
    expect(sql).toContain('__nontarget_fingerprints')
    expect(sql).not.toMatch(/delete from|insert into|update public/i)
  })
  it('attests the entire externally sealed table-name set and complete initial fixture', () => {
    const { before } = snapshots()
    const tables = before.__nontarget_fingerprints.map(r => String(r.table))
    expect(validateTestOwnerCreateSetupSnapshot(f, before, tables)).toEqual(before)
    expect(() => validateTestOwnerCreateSetupSnapshot(f, before, [...tables, 'private.omitted_table'])).toThrow()
    expect(() => validateTestOwnerCreateSetupSnapshot(f, before, tables.slice(1))).toThrow()
    expect(() => validateTestOwnerCreateSetupSnapshot(f, before, [...tables, tables[0]])).toThrow()
    const incomplete = structuredClone(before); incomplete['public.tests'].pop()
    expect(() => validateTestOwnerCreateSetupSnapshot(f, incomplete, tables)).toThrow()
  })
})
describe('strict dynamic CREATE witnesses', () => {
  it('registers only a named success with actual canonical title and finite generated IDs', () => {
    const ledger = registerTestOwnerCreateWitness(f, [], success.label, envelope(), success.input.title!)
    expect(ledger[0].ids).toEqual(ids)
    expect(Object.isFrozen(ledger[0].envelope.test)).toBe(true)
    expect(() => registerTestOwnerCreateWitness(f, ledger, success.label, envelope(), success.input.title!)).toThrow()
    expect(() => registerTestOwnerCreateWitness(f, [], 'student-member-denied', envelope(), success.input.title!)).toThrow()
    expect(() => registerTestOwnerCreateWitness(f, [], success.label, envelope(), 'Different title')).toThrow()
    expect(() => registerTestOwnerCreateWitness(f, [], success.label, { ...envelope(), extra: true }, success.input.title!)).toThrow()
  })
  it.each(['actor_id', 'classroom_id', 'test_id'] as const)('rejects unbound %s', field => {
    expect(() => registerTestOwnerCreateWitness(f, [], success.label, { ...envelope(), [field]: ids[2] }, success.input.title!)).toThrow()
  })
  it.each(['id', 'artifact_id'] as const)('rejects forged generated Test %s', field => {
    const e = envelope(); e.test[field] = f.actors[0].id
    expect(() => registerTestOwnerCreateWitness(f, [], success.label, e, success.input.title!)).toThrow()
  })
  it('rejects duplicate IDs, wrong draft identity/default/stamp and oversize material', () => {
    for (const change of [(e:ReturnType<typeof envelope>) => { e.draft.id = e.test.id },
      (e:ReturnType<typeof envelope>) => { e.draft.assessment_id = ids[1] },
      (e:ReturnType<typeof envelope>) => { e.draft.updated_at = f.now },
      (e:ReturnType<typeof envelope>) => { e.test.gradebook_weight = 1000 }]) {
      const e = envelope(); change(e); expect(() => registerTestOwnerCreateWitness(f, [], success.label, e, success.input.title!)).toThrow()
    }
    expect(() => registerTestOwnerCreateWitness(f, [], success.label, { garbage: 'x'.repeat(17000) }, 'title')).toThrow()
  })
  it('validates all eight incremental successes with24IDs, actual fallback title, and no extra witness', () => {
    let ledger: ReturnType<typeof registerTestOwnerCreateWitness> = []
    const s = snapshots(); let before = s.before
    for (const [i,c] of f.cases.filter(c => c.expectedHTTP === 201).entries()) {
      const e = envelope(); const generated = (n:number) => `abcdefab-cdef-4abc-8def-${String(i * 3 + n).padStart(12, '0')}`
      e.actor_id = c.actorId; e.classroom_id = c.classroomId; e.test_id = generated(0); e.test.id = generated(0); e.test.artifact_id = generated(1)
      e.test.classroom_id = c.classroomId; e.test.created_by = c.actorId; e.test.title = c.input.title?.trim() || 'Untitled 2026-10-06 00:01:00'
      const prior = before['public.tests'].filter(t => t.classroom_id === c.classroomId)
      e.test.position = prior.length ? Math.max(...prior.map(t => Number(t.position))) + 1 : 0
      e.test.gradebook_category_id = before['public.gradebook_categories'].find(t => t.classroom_id === c.classroomId && t.is_default)?.id as string
      e.test.gradebook_weight = 27
      e.draft.id = generated(2); e.draft.assessment_id = e.test.id; e.draft.classroom_id = c.classroomId
      e.draft.created_by = c.actorId; e.draft.updated_by = c.actorId; e.draft.content.title = e.test.title
      ledger = registerTestOwnerCreateWitness(f, ledger, c.label, e, e.test.title)
      const after = structuredClone(before); after['public.tests'].push(e.test); after['public.assessment_drafts'].push(e.draft)
      const classroom = after['public.classrooms'].find(t => t.id === c.classroomId)!
      classroom.blueprint_source_revision = Number(classroom.blueprint_source_revision) + 2; classroom.updated_at = stamp
      const archive = after['public.classroom_archive_revisions'].find(t => t.classroom_id === c.classroomId)!
      archive.revision = Number(archive.revision) + 4; archive.updated_at = stamp
      ledger = verifyTestOwnerCreateEffects(f, before, after, c.label, ledger, {test:{...e.test, assessment_type:'test'}})
      before = after
    }
    expect(ledger.flatMap(w => w.ids)).toHaveLength(24)
    expect(() => registerTestOwnerCreateWitness(f, ledger, success.label, envelope(), success.input.title!)).toThrow()
    expect(() => verifyTestOwnerCreateEffects(f, before, before, 'raw-privilege-probe', ledger)).not.toThrow()
  })
  it.each(['title', 'show_results', 'question_identity_version', 'questions', 'source_format'])('rejects noncanonical draft content %s', field => {
    const e = envelope(); const value = { ...e, draft: { ...e.draft, content: { ...e.draft.content, [field]: 'wrong' } } }
    expect(() => registerTestOwnerCreateWitness(f, [], success.label, value, success.input.title!)).toThrow()
  })
  it('rejects invalid/lowercase drift and forged ledgerIDs or cross-case repeated UUIDs', () => {
    const e = envelope(); e.test.id = e.test_id = 'not-a-uuid'
    expect(() => registerTestOwnerCreateWitness(f, [], success.label, e, success.input.title!)).toThrow()
    const ledger = registerTestOwnerCreateWitness(f, [], success.label, envelope(), success.input.title!)
    const forged = structuredClone(ledger); forged[0].ids[0] = f.missingClassroomId
    expect(() => registerTestOwnerCreateWitness(f, forged, 'omitted-title', envelope(), 'Untitled 2026-10-06 00:01:00')).toThrow()
    const same = envelope(); same.test.title = same.draft.content.title = 'Untitled 2026-10-06 00:01:00'
    expect(() => registerTestOwnerCreateWitness(f, ledger, 'omitted-title', same, same.test.title)).toThrow()
  })
  it('only promotes after full effects succeed; pending or failed witnesses cannot become prior pairs', () => {
    const s = snapshots(); const pending = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!)
    expect(pending[0].state).toBe('provisional')
    expect(() => registerTestOwnerCreateWitness(f, pending, 'omitted-title', envelope(), 'Untitled 2026-10-06 00:01:00')).toThrow()
    const rejected = structuredClone(s.after); rejected['public.tests'].pop()
    expect(() => verifyTestOwnerCreateEffects(f, s.before, rejected, success.label, pending, s.publicResult)).toThrow()
    expect(pending[0].state).toBe('provisional')
    const accepted = verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, pending, s.publicResult)
    expect(accepted[0].state).toBe('verified')
    expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, accepted, s.publicResult)).toThrow()
    expect(Object.isFrozen(accepted[0])).toBe(true)
  })
})
describe('complete CREATE effects verification', () => {
  it('binds public result, whole stored pair, prior rows and exact +2/+4 effects', () => {
    const s = snapshots(); const ledger = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!)
    expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, ledger, s.publicResult)).not.toThrow()
  })
  it('uses custom category weight including zero, not assumed10', () => {
    const s = snapshots()
    for (const rows of [s.before['public.gradebook_categories'], s.after['public.gradebook_categories']]) rows[1].default_assessment_weight = 0
    s.e.test.gradebook_weight = 0; s.publicResult.test.gradebook_weight = 0
    const ledger = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!)
    expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, ledger, s.publicResult)).not.toThrow()
  })
  it('includes all1001 source rows and the retired highest position', () => {
    const s = snapshots(); const c = f.cases.find(c => c.label === 'bulk-1001-source')!
    const e = envelope(); e.actor_id = c.actorId; e.classroom_id = c.classroomId; e.test.classroom_id = c.classroomId; e.test.title = c.input.title!; e.test.position = 1001
    e.test.gradebook_category_id = s.before['public.gradebook_categories'][10].id as string; e.test.gradebook_weight = 27
    e.draft.classroom_id = c.classroomId; e.draft.content.title = e.test.title
    const after = structuredClone(s.before); after['public.tests'].push(e.test); after['public.assessment_drafts'].push(e.draft)
    after['public.classrooms'][3].blueprint_source_revision = 11; after['public.classrooms'][3].updated_at = stamp
    after['public.classroom_archive_revisions'][3].revision = 19; after['public.classroom_archive_revisions'][3].updated_at = stamp
    const ledger = registerTestOwnerCreateWitness(f, [], c.label, e, c.input.title!)
    const result = { test: { ...e.test, assessment_type: 'test' } }
    expect(() => verifyTestOwnerCreateEffects(f, s.before, after, c.label, ledger, result)).not.toThrow()
    e.test.position = 1000; result.test.position = 1000
    const badLedger = registerTestOwnerCreateWitness(f, [], c.label, e, c.input.title!)
    expect(() => verifyTestOwnerCreateEffects(f, s.before, after, c.label, badLedger, result)).toThrow()
  })
  it('does not clamp a negative legacy MAX to zero (pure alternate-source arithmetic only)', () => {
    const alternate = structuredClone(f); alternate.tests.forEach(t => { t.position -= 1005 })
    const s = snapshots(); s.before['public.tests'].forEach(t => { t.position = Number(t.position) - 1005 })
    const c = alternate.cases.find(c => c.label === 'bulk-1001-source')!
    const e = envelope(); e.classroom_id = e.test.classroom_id = e.draft.classroom_id = c.classroomId
    e.test.title = e.draft.content.title = c.input.title!; e.test.position = -4
    e.test.gradebook_category_id = s.before['public.gradebook_categories'][10].id as string; e.test.gradebook_weight = 27
    const after = structuredClone(s.before); after['public.tests'].push(e.test); after['public.assessment_drafts'].push(e.draft)
    after['public.classrooms'][3].blueprint_source_revision = 11; after['public.classrooms'][3].updated_at = stamp
    after['public.classroom_archive_revisions'][3].revision = 19; after['public.classroom_archive_revisions'][3].updated_at = stamp
    const pending = registerTestOwnerCreateWitness(alternate, [], c.label, e, c.input.title!)
    expect(() => verifyTestOwnerCreateEffects(alternate, s.before, after, c.label, pending, {test:{...e.test,assessment_type:'test'}})).not.toThrow()
  })
  it('rejects truncated baseline, unwitnessed prior rows and source modifications even if repeated after', () => {
    for (const change of [(s:ReturnType<typeof snapshots>) => { s.before['public.tests'].pop(); s.after['public.tests'].splice(1000, 1) },
      (s:ReturnType<typeof snapshots>) => { const extra = { ...s.e.test, id: ids[1] }; s.before['public.tests'].push(extra); s.after['public.tests'].push(extra) },
      (s:ReturnType<typeof snapshots>) => { (s.before['public.tests'][0] as Record<string,unknown>).position = 77; (s.after['public.tests'][0] as Record<string,unknown>).position = 77 }]) {
      const s = snapshots(); const ledger = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!); change(s)
      expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, ledger, s.publicResult)).toThrow()
    }
  })
  it.each(['public.test_questions', 'public.users', 'public.classroom_enrollments', 'public.managed_storage_objects', '__nontarget_fingerprints'])('rejects changed %s', table => {
    const s = snapshots(); const ledger = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!)
    s.after[table].push({ id: ids[2], unauthorized: true })
    expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, ledger, s.publicResult)).toThrow()
  })
  it('rejects missing, duplicate and surplus rows, changed old content, public mismatch or wrong counters', () => {
    for (const change of [(s:ReturnType<typeof snapshots>) => { s.after['public.tests'].push({ ...s.e.test, id: ids[1] }) },
      (s:ReturnType<typeof snapshots>) => { s.after['public.assessment_drafts'] = [] },
      (s:ReturnType<typeof snapshots>) => { s.publicResult.test.title = 'forged' },
      (s:ReturnType<typeof snapshots>) => { (s.after['public.classrooms'][0] as Record<string,unknown>).title = 'forged' },
      (s:ReturnType<typeof snapshots>) => { (s.after['public.classroom_archive_revisions'][0] as Record<string,unknown>).revision = 18 },
      (s:ReturnType<typeof snapshots>) => { s.after['public.classrooms'].push(s.after['public.classrooms'][0]) },
      (s:ReturnType<typeof snapshots>) => { delete s.after['public.users'] }]) {
      const s = snapshots(); const ledger = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!); change(s)
      expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, ledger, s.publicResult)).toThrow()
    }
  })
  it.each(['public.gradebook_categories', 'public.pal_event_outbox', 'private.pal_membership_generations',
    'private.student_provider_cleanup_settings', 'private.classroom_creation_entitlement_settings', 'public.test_document_snapshot_storage_cleanup'])('rejects extra %s effect', table => {
    const s = snapshots(); const ledger = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!)
    s.after[table].push({ id: ids[2], unauthorized: true })
    expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, ledger, s.publicResult)).toThrow()
  })
  it('rejects absent, duplicate, malformed, oversize fingerprints and non-JSON/cyclic snapshots', () => {
    for (const change of [(s:ReturnType<typeof snapshots>) => { s.after.__nontarget_fingerprints = [] },
      (s:ReturnType<typeof snapshots>) => { s.after.__nontarget_fingerprints.push(s.after.__nontarget_fingerprints[0]) },
      (s:ReturnType<typeof snapshots>) => { s.after.__nontarget_fingerprints[0] = {table:'foreign.users',fingerprint:'x'} },
      (s:ReturnType<typeof snapshots>) => { s.after.__nontarget_fingerprints[0].fingerprint = 'x'.repeat(4097) },
      (s:ReturnType<typeof snapshots>) => { s.after['public.users'][0].cyclic = s.after },
      (s:ReturnType<typeof snapshots>) => { s.after['public.users'][0].huge = 'x'.repeat(TEST_OWNER_CREATE_CAPS.snapshotBytes) }]) {
      const s = snapshots(); const ledger = registerTestOwnerCreateWitness(f, [], success.label, s.e, success.input.title!); change(s)
      expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, success.label, ledger, s.publicResult)).toThrow()
    }
  })
  it('all seven denial/probe cases require exact entire snapshot equality and no public result', () => {
    const s = snapshots()
    for (const c of [...f.cases.filter(c => c.expectedHTTP !== 201), f.privilegeProbe]) {
      expect(() => verifyTestOwnerCreateEffects(f, s.before, structuredClone(s.before), c.label, [])).not.toThrow()
      expect(() => verifyTestOwnerCreateEffects(f, s.before, s.after, c.label, [])).toThrow()
      expect(() => verifyTestOwnerCreateEffects(f, s.before, s.before, c.label, [], s.publicResult)).toThrow()
    }
  })
})
