import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPublicationFixture, TEST_OWNER_PUBLICATION_CAPS,
  TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, testOwnerPublicationSetupSql, testOwnerPublicationSnapshotSql,
  validateTestOwnerPublicationSetupSnapshot, registerTestOwnerPublicationWitness, verifyTestOwnerPublicationEffects,
  verifyTestOwnerPublicationTransitionEffects, type TestOwnerPublicationWitness } from '../../scripts/contextual-test-publication-proof-fixture'
import { validateTestDraftContent } from '../../src/lib/validations/assessment-drafts'
import { normalizeTestDocuments } from '../../src/lib/test-documents'
import { hashCanonicalJson } from '../../src/lib/server/course-blueprint-versions'

const original = newAssignmentListProofFixture(new Date('2026-10-06T03:00:00Z'))
export const publicationFixture = newTestOwnerPublicationFixture(original)
type Row = Record<string, unknown>
export function publicationBaseline() {
  const f = publicationFixture
  const s: Record<string, Row[]> = Object.fromEntries(TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES.map(t => [t, []]))
  s['public.users'] = f.actors.map(r => ({ ...r, preserved: true }))
  s['public.classrooms'] = f.classes.map(c => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code,
    archived_at: c.archived ? f.now : null, blueprint_source_revision: 203, updated_at: f.now, untouched: 'keep' }))
  s['public.classroom_archive_revisions'] = f.classes.map(c => ({ classroom_id: c.id, revision: 411, updated_at: f.now }))
  s['public.gradebook_categories'] = f.classes.flatMap((c, ci) => [0, 1, 2].map(i => ({ id: `99999999-9999-4999-8999-${String(ci * 3 + i).padStart(12, '0')}`,
    classroom_id: c.id, position: i, is_default: i === 0, default_assessment_weight: 10 })))
  s['public.tests'] = f.tests.map(t => ({ ...structuredClone(t), gradebook_category_id: s['public.gradebook_categories'].find(c => c.classroom_id === t.classroom_id)!.id }))
  s['public.test_questions'] = f.questions.map(r => structuredClone(r))
  s['public.assessment_drafts'] = f.drafts.map(r => structuredClone(r))
  s['public.classroom_enrollments'] = f.enrollments.map(r => ({ ...r, created_at: f.now }))
  s['public.course_blueprints'] = [{ ...f.blueprint, unchanged: true }]
  s['public.course_blueprint_versions'] = [structuredClone(f.blueprintVersion)]
  s['public.managed_storage_settings'] = [{ singleton: true, active_version: 0, updated_at: f.now }]
  s.__nontarget_fingerprints = [...TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'].map(table => ({ table, fingerprint: 'unchanged' }))
  return s
}
const stamp = '2026-10-06T04:00:00.123456Z'
const sha = 'a'.repeat(64)
const window = { startMs: Date.parse(stamp) - 1000, deadlineMs: Date.parse(stamp) + 1000 }
export function publicationPostimage(before: ReturnType<typeof publicationBaseline>, label: string, tx = stamp) {
  const f = publicationFixture; const c = [...f.cases, ...f.transitions].find(c => c.label === label)!
  const after = structuredClone(before); const draft = after['public.assessment_drafts'].find(d => d.assessment_id === c.testId)!
  const content = draft.content as { title: string; show_results: boolean; questions: Row[] }
  const test = after['public.tests'].find(t => t.id === c.testId)!; test.title = content.title; test.show_results = content.show_results; test.status = 'closed'; test.updated_at = tx
  const existing = before['public.test_questions'].filter(q => q.test_id === c.testId)
  const candidate = content.questions.map((q, position) => {
    const old = existing.find(r => (r.source_artifact_id ?? r.artifact_id) === q.id)
    const authored = { question_type: q.question_type, question_text: q.question_text, options: structuredClone(q.options), correct_option: q.correct_option,
      answer_key: q.answer_key, sample_solution: q.sample_solution, points: q.points, response_max_chars: q.response_max_chars,
      response_monospace: q.response_monospace, position }
    if (old) {
      const changed = Object.entries(authored).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(old[k]))
      return { ...old, ...authored, updated_at: changed ? tx : old.updated_at }
    }
    return { id: '88888888-8888-4888-8888-888888888888', test_id: c.testId, artifact_id: q.id, source_artifact_id: null,
      source_blueprint_version_id: null, ...authored, created_at: tx, updated_at: tx, ai_reference_cache_key: null,
      ai_reference_cache_answers: null, ai_reference_cache_model: null, ai_reference_cache_generated_at: null }
  })
  after['public.test_questions'] = [...after['public.test_questions'].filter(q => q.test_id !== c.testId), ...candidate]
  const classroom = after['public.classrooms'].find(r => r.id === test.classroom_id)!; const archive = after['public.classroom_archive_revisions'].find(r => r.classroom_id === test.classroom_id)!
  classroom.blueprint_source_revision = Number(classroom.blueprint_source_revision) + c.Q + c.T
  if (c.Q + c.T > 0) classroom.updated_at = tx
  archive.revision = Number(archive.revision) + 2 + c.T + 2 * c.Q; archive.updated_at = tx
  const envelope = { version: 1, actor_id: c.actorId, classroom_id: test.classroom_id, test_id: c.testId, source_sha256: sha, draft_version: draft.version, test: { ...test } }
  return { after, envelope, publicResult: { test: { ...test, documents: normalizeTestDocuments(test.documents), assessment_type: 'test' } } }
}

describe('finite publication fixture source', () => {
  it('freezes ten SDK cases, four distinct capabilities and five committed transitions without old ID overlap', () => {
    const f = newTestOwnerPublicationFixture(original)
    expect(f.cases).toHaveLength(10)
    expect(f.cases.reduce((n, c) => n + c.expectedRPCs, 0)).toBe(13)
    expect(f.privilegeProbes).toHaveLength(4)
    expect(f.privilegeProbes.reduce((n, c) => n + c.expectedRPCs, 0)).toBe(7)
    expect(f.transitions).toHaveLength(5)
    expect(f.questions.filter(q => q.test_id === f.cases[2].testId)).toHaveLength(1001)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.allocatedIds.some(id => original.allocatedIds.includes(id))).toBe(false)
    expect(Object.isFrozen(f.cases[0].input)).toBe(true)
    expect(newTestOwnerPublicationFixture(original)).toEqual(f)
  })
  it('authors only exact fixture SQL with a real immutable lineage parent and full catalog capture', () => {
    const f = newTestOwnerPublicationFixture(original)
    const sql = testOwnerPublicationSetupSql(f, `pika_assignment_list_${f.tag.slice(-12)}`)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(TEST_OWNER_PUBLICATION_CAPS.sqlBytes)
    expect(sql).toContain('insert into public.course_blueprints')
    expect(sql).toContain('insert into public.course_blueprint_versions')
    expect(sql).not.toMatch(/disable trigger|set_config|session_replication_role|truncate|delete from|set blueprint_source_revision|set revision/i)
    expect(() => testOwnerPublicationSetupSql(f, 'production')).toThrow()
    const snapshot = testOwnerPublicationSnapshotSql(f)
    expect(snapshot).toContain("n.nspname in ('public','private','storage')")
    expect(snapshot).toContain('or classroom_id in (')
    expect(snapshot).toContain('public.course_blueprint_versions')
  })
  it('starts every success/probe/transition with byte-canonical content and immutable retained lineage/cache', () => {
    const f = publicationFixture
    for (const draft of f.drafts.filter(d => d.assessment_id !== f.cases[9].testId)) {
      const validated = validateTestDraftContent(draft.content, { requirePortableQuestionIdentity: true })
      expect(validated.valid).toBe(true)
      if (validated.valid) expect(validated.value).toEqual(draft.content)
    }
    const retained = f.questions.find(q => q.source_blueprint_version_id !== null)!
    expect(retained.source_blueprint_version_id).toBe(f.blueprintVersion.id)
    expect(retained.source_artifact_id).not.toBe(retained.artifact_id)
    expect(retained.ai_reference_cache_answers).toEqual(['Synthetic reference'])
    expect(f.blueprintVersion.snapshot_schema_version).toBe(3)
    expect(f.blueprintVersion.snapshot_sha256).toBe(hashCanonicalJson(f.blueprintVersion.snapshot_json))
    expect(f.blueprintVersion.snapshot_json).toHaveProperty('assessments')
    const mc = f.questions.find(q => q.question_type === 'multiple_choice')
    expect(mc).toBeDefined(); expect(mc?.answer_key).toBeNull(); expect(mc?.ai_reference_cache_key).toBeNull()
  })
  it('checks full21/21/10 source rows and the complete external catalog', () => {
    const before = publicationBaseline(); const tables = before.__nontarget_fingerprints.map(r => String(r.table))
    expect(validateTestOwnerPublicationSetupSnapshot(publicationFixture, before, tables)).toEqual(before)
    expect(() => validateTestOwnerPublicationSetupSnapshot(publicationFixture, before, tables.slice(1))).toThrow()
    for (const table of ['public.tests', 'public.test_questions', 'public.assessment_drafts', 'public.course_blueprint_versions']) {
      const bad = structuredClone(before); bad[table][0].unrecognized = true
      expect(() => validateTestOwnerPublicationSetupSnapshot(publicationFixture, bad, tables)).toThrow()
    }
    const unknown = structuredClone(before); unknown['public.tests'].push({ ...unknown['public.tests'][0], id: '77777777-7777-4777-8777-777777777777' })
    expect(() => validateTestOwnerPublicationSetupSnapshot(publicationFixture, unknown, tables)).toThrow()
  })
})

describe('issued full publication effect sink', () => {
  it.each(['teacher-owner', 'student-owner-mixed', 'bulk-1001'])('accepts exact %s complete effects with unchanged drafts/caches/lineage', label => {
    const before = publicationBaseline(); const { after, envelope, publicResult } = publicationPostimage(before, label)
    const pending = registerTestOwnerPublicationWitness(publicationFixture, [], label, envelope, window, sha)
    expect(pending[0].state).toBe('provisional')
    const verified = verifyTestOwnerPublicationEffects(publicationFixture, before, after, label, pending, publicResult, stamp)
    expect(verified[0].state).toBe('verified'); expect(Object.isFrozen(verified[0])).toBe(true)
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, before, after, label, verified, publicResult, stamp)).toThrow()
  })
  it.each(['draft', 'retained-cache', 'retained-lineage', 'new-default', 'omitted-row', 'Class-metadata', 'Class-revision', 'archive', 'sibling', 'queue', 'catalog'])('rejects %s drift after mixed publication', drift => {
    const before = publicationBaseline(); const c = publicationFixture.cases[1]; const { after, envelope, publicResult } = publicationPostimage(before, c.label)
    const pending = registerTestOwnerPublicationWitness(publicationFixture, [], c.label, envelope, window, sha)
    if (drift === 'draft') after['public.assessment_drafts'][0].updated_by = publicationFixture.actors[2].id
    if (drift === 'retained-cache') after['public.test_questions'].find(r => r.test_id === c.testId)!.ai_reference_cache_key = null
    if (drift === 'retained-lineage') after['public.test_questions'].find(r => r.test_id === c.testId)!.source_blueprint_version_id = null
    if (drift === 'new-default') after['public.test_questions'].find(r => r.id === '88888888-8888-4888-8888-888888888888')!.ai_reference_cache_model = 'bad'
    if (drift === 'omitted-row') after['public.test_questions'].push(before['public.test_questions'].filter(r => r.test_id === c.testId)[3])
    if (drift === 'Class-metadata') after['public.classrooms'][1].untouched = 'changed'
    if (drift === 'Class-revision') after['public.classrooms'][1].blueprint_source_revision = 999
    if (drift === 'archive') after['public.classroom_archive_revisions'][1].revision = 999
    if (drift === 'sibling') after['public.tests'][0].gradebook_score_scale = 1
    if (drift === 'queue') after['public.test_document_snapshot_storage_cleanup'].push({ id: publicationFixture.reservedIds.focusEventId })
    if (drift === 'catalog') after.__nontarget_fingerprints[0].fingerprint = 'drift'
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, before, after, c.label, pending, publicResult, stamp)).toThrow()
  })
  it.each([...publicationFixture.cases.filter(c => c.expectedHTTP !== 200), ...publicationFixture.privilegeProbes])('requires every complete row unchanged for $label', c => {
    const before = publicationBaseline()
    expect(verifyTestOwnerPublicationEffects(publicationFixture, before, before, c.label, [])).toEqual([])
    const bad = structuredClone(before); bad['public.managed_storage_settings'][0].active_version = 1
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, before, bad, c.label, [])).toThrow()
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, before, before, c.label, [], { test: {} })).toThrow()
  })
  it('binds full private acknowledgement/SHA and refuses cloned/promoted ledgers', () => {
    const before = publicationBaseline(); const { after, envelope, publicResult } = publicationPostimage(before, 'teacher-owner')
    for (const bad of [{ ...envelope, extra: true }, { ...envelope, actor_id: publicationFixture.actors[2].id }, { ...envelope, draft_version: 9 }])
      expect(() => registerTestOwnerPublicationWitness(publicationFixture, [], 'teacher-owner', bad, window, sha)).toThrow()
    expect(() => registerTestOwnerPublicationWitness(publicationFixture, [], 'teacher-owner', envelope, window, 'b'.repeat(64))).toThrow()
    expect(() => registerTestOwnerPublicationWitness(publicationFixture, [], 'teacher-owner', envelope, window)).toThrow()
    const pending = registerTestOwnerPublicationWitness(publicationFixture, [], 'teacher-owner', envelope, window, sha)
    const promoted: TestOwnerPublicationWitness[] = structuredClone(pending).map(w => ({ ...w, state: 'verified' }))
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, before, after, 'teacher-owner', promoted, publicResult, stamp)).toThrow()
  })
  it('refuses a generated row identity borrowed from the inherited reserved namespace', () => {
    const before = publicationBaseline(); const c = publicationFixture.cases[1]
    const { after, envelope, publicResult } = publicationPostimage(before, c.label)
    after['public.test_questions'].find(r => r.id === '88888888-8888-4888-8888-888888888888')!.id = original.allocatedIds[0]
    const pending = registerTestOwnerPublicationWitness(publicationFixture, [], c.label, envelope, window, sha)
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, before, after, c.label, pending, publicResult, stamp)).toThrow()
  })
  it('permits equivalent timestamp offsets but rejects one microsecond changed immutable preimage', () => {
    const before = publicationBaseline(); before['public.tests'][0].created_at = '2026-10-05T23:00:00.000000-04:00'
    expect(() => validateTestOwnerPublicationSetupSnapshot(publicationFixture, before, before.__nontarget_fingerprints.map(r => String(r.table)))).not.toThrow()
    before['public.tests'][0].created_at = '2026-10-06T03:00:00.000001Z'
    expect(() => validateTestOwnerPublicationSetupSnapshot(publicationFixture, before, before.__nontarget_fingerprints.map(r => String(r.table)))).toThrow()
  })
  it('pins even denial-only whole snapshots', () => {
    const before = publicationBaseline()
    const entries = verifyTestOwnerPublicationEffects(publicationFixture, before, before, publicationFixture.privilegeProbes[0].label, [])
    const drift = structuredClone(before); drift['public.users'][0].preserved = false
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, drift, drift, publicationFixture.privilegeProbes[1].label, entries)).toThrow()
  })
  describe.sequential('one shared issued ledger across all three real publication shapes', () => {
    let before = publicationBaseline()
    let entries: TestOwnerPublicationWitness[] = []
    it.each(publicationFixture.cases.filter(c => c.expectedHTTP === 200))('advances complete $label state without resetting the ledger', c => {
      const { after, envelope, publicResult } = publicationPostimage(before, c.label)
      entries = registerTestOwnerPublicationWitness(publicationFixture, entries, c.label, envelope, window, sha)
      entries = verifyTestOwnerPublicationEffects(publicationFixture, before, after, c.label, entries, publicResult, stamp)
      before = after
      expect(entries.every(w => w.state === 'verified')).toBe(true)
    })
    it('rejects the old baseline after the shared complete chain', () => {
      expect(entries).toHaveLength(3)
      const stale = publicationBaseline()
      expect(() => verifyTestOwnerPublicationEffects(publicationFixture, stale, stale, 'missing-draft', entries)).toThrow()
    })
  })
})

function committedWriter(before: ReturnType<typeof publicationBaseline>, label: string) {
  const c = publicationFixture.transitions.find(c => c.label === label)!
  const writer = structuredClone(before)
  if (label === 'publication-start') return writer
  const test = writer['public.tests'].find(r => r.id === c.testId)!
  const question = writer['public.test_questions'].find(r => r.id === c.questionId)!
  const classroom = writer['public.classrooms'].find(r => r.id === c.classroomId)!
  const archive = writer['public.classroom_archive_revisions'].find(r => r.classroom_id === c.classroomId)!
  let blue = 0; let rev = 0
  if (label === 'stale-draft') {
    const draft = writer['public.assessment_drafts'].find(r => r.assessment_id === c.testId)!
    draft.content = { ...(draft.content as Row), title: c.authoredTitle }; draft.version = Number(draft.version) + 1; draft.updated_at = stamp
    blue = 1; rev = 2
  } else if (label === 'stale-authoring') { question.question_text = c.authoredText; question.updated_at = stamp; blue = 1; rev = 2 }
  else if (label === 'metadata-preserved') {
    test.documents = structuredClone(c.documents); test.updated_at = stamp
    question.ai_reference_cache_key = c.cacheKey; question.ai_reference_cache_answers = [...c.cacheAnswers]
    question.ai_reference_cache_model = c.cacheModel; question.ai_reference_cache_generated_at = stamp; question.updated_at = stamp
    blue = 1; rev = 3
  } else { classroom.teacher_id = c.nextOwnerId; rev = 1 }
  classroom.blueprint_source_revision = Number(classroom.blueprint_source_revision) + blue; classroom.updated_at = stamp
  archive.revision = Number(archive.revision) + rev; archive.updated_at = stamp
  return writer
}
describe('source-sealed genuinely committed transition sink', () => {
  it.each(publicationFixture.transitions)('accepts only the complete $label writer and final effects', c => {
    const before = publicationBaseline(); const writer = committedWriter(before, c.label)
    const pubStamp = '2026-10-06T04:00:00.223456Z'
    const published = c.expectedHTTP === 200 ? publicationPostimage(writer, c.label, pubStamp) : undefined
    const after = published?.after ?? structuredClone(writer)
    const evidence = c.expectedHTTP === 200 ? { ...(c.label === 'publication-start' ? {} : { writerTimestamp: stamp }),
      publicationTimestamp: pubStamp, sourceSha256: sha, envelope: published!.envelope }
      : { writerTimestamp: stamp, code: (c.expectedHTTP === 403 ? 'PT403' : 'PT409') as 'PT403' | 'PT409' }
    const verified = verifyTestOwnerPublicationTransitionEffects(publicationFixture, before, writer, after, c.label, [], evidence)
    expect(verified).toHaveLength(1); expect(verified[0].kind).toBe('transition'); expect(verified[0].state).toBe('verified')
    const bad = structuredClone(after); bad['public.course_blueprint_versions'][0].snapshot_sha256 = 'b'.repeat(64)
    expect(() => verifyTestOwnerPublicationTransitionEffects(publicationFixture, before, writer, bad, c.label, [], evidence)).toThrow()
    const wrongWriter = structuredClone(writer); wrongWriter['public.users'][0].preserved = false
    expect(() => verifyTestOwnerPublicationTransitionEffects(publicationFixture, before, wrongWriter, after, c.label, [], evidence)).toThrow()
    expect(() => verifyTestOwnerPublicationTransitionEffects(publicationFixture, before, writer, after, c.label, [], { ...evidence, unexpected: true })).toThrow()
  })
  it('retains source-excluded committed document/cache changes through successful publication and later SDK cases', () => {
    const label = 'metadata-preserved'; const c = publicationFixture.transitions.find(c => c.label === label)!
    const before = publicationBaseline(); const writer = committedWriter(before, label); const pubStamp = '2026-10-06T04:00:00.223456Z'
    const { after, envelope } = publicationPostimage(writer, label, pubStamp)
    const entries = verifyTestOwnerPublicationTransitionEffects(publicationFixture, before, writer, after, label, [], {
      writerTimestamp: stamp, publicationTimestamp: pubStamp, sourceSha256: sha, envelope })
    const q = after['public.test_questions'].find(r => r.id === c.questionId)!
    expect(q.ai_reference_cache_key).toBe(c.cacheKey); expect(q.updated_at).toBe(stamp)
    const next = publicationPostimage(after, 'teacher-owner')
    const pending = registerTestOwnerPublicationWitness(publicationFixture, entries, 'teacher-owner', next.envelope, window, sha)
    expect(verifyTestOwnerPublicationEffects(publicationFixture, after, next.after, 'teacher-owner', pending, next.publicResult, stamp)).toHaveLength(2)
    const lostCache = structuredClone(next.after); lostCache['public.test_questions'].find(r => r.id === c.questionId)!.ai_reference_cache_key = null
    expect(() => verifyTestOwnerPublicationEffects(publicationFixture, after, lostCache, 'teacher-owner', pending, next.publicResult, stamp)).toThrow()
  })
})
