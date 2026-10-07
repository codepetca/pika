/** Inert finite source: no import-time IO/SQL, native acceptance or cleanup authority.
 * Compact bulk projections attest complete immutable rows; root must independently
 * review/run their SQL and the 13 installed Test triggers in the isolated project. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES } from './contextual-test-publication-proof-fixture'
import { contextualTestListTestSchema } from '../src/lib/validations/contextual-test-list-read'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'

// No parent/native platform cap changes. The sole >10,000-row array is the fixed
// 21,002 lightweight bulk projections, not application rows or a public response.
export const TEST_OWNER_REORDER_CAPS = Object.freeze({ sqlBytes: 524288, networkRequests: 24, rpcRequests: 24,
  storageRequests: 0, requestMs: 20000, bodyBytes: 524288, requestBytes: 524288, resultBytes: 524288,
  envelopeBytes: 1048576, operationBytes: 1048576, rowBytes: 2097152, snapshotBytes: 8388608,
  // New-feature proof-only aggregate for the reviewed <=24 contexts/48 captures;
  // SDK exchanges, native engine and each capture retain their original caps.
  totalBytes: 67108864, snapshotTotalBytes: 268435456, snapshotRows: 100000, rowsPerTable: 10000, bulkProjectionRows: 21002,
  fingerprintTables: 1024, witnessIds: 24, maxTestIds: 10000 })
export const TEST_OWNER_REORDER_SNAPSHOT_TABLES = TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES
const q = (s: string) => `'${s.replaceAll("'", "''")}'`
const uuid = z.string().uuid().refine(s => s === s.toLowerCase())
const timestamp = z.string().datetime({ offset: true }).refine(s => Number.isFinite(Date.parse(s)))
const issuedFixtures = new WeakSet<object>()
type Row = Record<string, unknown>
export type TestOwnerReorderSnapshot = Record<string, Row[]>
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
function uuidFromHash(h: string) { return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
function bulkId(tag: string, count: number, ordinal: number, artifact = false) {
  return uuidFromHash(createHash('md5').update(`${tag}:bulk-${artifact ? 'artifact' : 'test'}:${count}:${ordinal}`).digest('hex'))
}
const bulkIdSql = (tag: string, count: number, artifact = false) => {
  const digest = `md5(${q(`${tag}:bulk-${artifact ? 'artifact' : 'test'}:${count}:`)}||ordinal::text)`
  return `(substr(${digest},1,8)||'-'||substr(${digest},9,4)||'-4'||substr(${digest},14,3)||'-8'||substr(${digest},18,3)||'-'||substr(${digest},21,12))::uuid`
}
export function newTestOwnerReorderFixture(original: AssignmentListProofFixture) {
  assert.match(original.manifest.syntheticTag, /^assignmentlist_[a-f0-9]{12}$/)
  assert(Number.isFinite(Date.parse(original.manifest.now))); assert(original.allocatedIds.length <= 20000)
  const tag = `testownerreorder_${original.manifest.syntheticTag.slice(-12)}`; const now = original.manifest.now
  const id = (label: string) => uuidFromHash(testOwnerDigest(`${tag}:${label}`))
  const actors = (['teacher', 'student', 'student', 'teacher', 'teacher'] as const).map((role, i) => ({ id: id(`actor${i}`), role, email: `${tag}_${i}@example.invalid` }))
  const classLabels = ['teacher-owner', 'student-owner', 'archived-owner', 'empty-owner', 'bulk-1001', 'bulk-10000', 'bulk-10001'] as const
  const classes = classLabels.map((label, i) => ({ id: id(`class:${label}`), label, owner: actors[i === 1 ? 1 : 0].id,
    title: `${tag} ${label}`, code: `${tag}_${i}`, archived: i === 2 }))
  const bulkClasses = [1001, 10000, 10001].map((count, i) => ({ label: classes[i + 4].label, classroomId: classes[i + 4].id, count }))
  const tests = classes.slice(0, 3).flatMap(c => ['live', 'retired', 'started', 'closed'].map((label, i) => ({
    id: id(`test:${c.label}:${label}`), artifact_id: id(`artifact:${c.label}:${label}`), classroom_id: c.id,
    created_by: actors[4].id, title: `${tag} ${c.label} ${label}`, status: label === 'started' ? 'active' as const : label === 'closed' ? 'closed' as const : 'draft' as const,
    show_results: label === 'closed', documents: [{ id: id(`document:${c.label}:${label}`), source: 'link', title: 'Synthetic source', url: 'https://example.invalid/source' }],
    position: i, points_possible: 17, include_in_final: false, created_at: now, updated_at: now,
    source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: label === 'retired' ? now : null,
    questions_locked_at: label === 'started' ? now : null, gradebook_category_id: null, gradebook_weight: 23,
    gradebook_maximum_override: 19, gradebook_score_scale: 1.25 })))
  const questions = tests.flatMap(t => [0, 1].map(position => ({ id: id(`question:${t.id}:${position}`), test_id: t.id,
    artifact_id: id(`question-artifact:${t.id}:${position}`), source_artifact_id: position === 0 ? id(`historical-question:${t.id}`) : null,
    source_blueprint_version_id: null, question_type: position === 0 ? 'open_response' : 'multiple_choice',
    question_text: `Synthetic question ${position}`, options: position === 0 ? [] : ['One', 'Two'], correct_option: position === 0 ? null : 1,
    answer_key: position === 0 ? 'Synthetic answer' : null, sample_solution: null, points: 1, response_max_chars: 500,
    response_monospace: false, position, created_at: now, updated_at: now, ai_reference_cache_key: position === 0 ? 'synthetic-cache' : null,
    ai_reference_cache_answers: position === 0 ? ['Synthetic reference'] : null, ai_reference_cache_model: position === 0 ? 'SyntheticModel' : null,
    ai_reference_cache_generated_at: position === 0 ? now : null })))
  const drafts = tests.map(t => ({ id: id(`draft:${t.id}`), assessment_type: 'test', assessment_id: t.id, classroom_id: t.classroom_id,
    version: 7, content: { title: `${t.title} overlay`, show_results: false, question_identity_version: 1,
      questions: questions.filter(r => r.test_id === t.id).map(r => ({ id: r.source_artifact_id ?? r.artifact_id,
        question_type: r.question_type, question_text: r.question_text, options: r.options, correct_option: r.correct_option,
        answer_key: r.answer_key, sample_solution: r.sample_solution, points: r.points, response_max_chars: r.response_max_chars, response_monospace: r.response_monospace })) },
    created_by: actors[4].id, updated_by: actors[4].id, created_at: now, updated_at: now }))
  const enrollments = classes.slice(0, 3).flatMap(c => [2, 3].map(ai => ({ id: id(`enrollment:${c.id}:${ai}`), classroom_id: c.id, student_id: actors[ai].id,
    created_at: now })))
  const started = tests.filter(t => t.questions_locked_at !== null)
  const attempts = started.map(t => ({ id: id(`attempt:${t.id}`), test_id: t.id, student_id: actors[2].id,
    responses: { [questions.find(r => r.test_id === t.id)!.artifact_id]: 'Synthetic in-progress answer' }, is_submitted: false,
    created_at: now, updated_at: now }))
  const responses = started.map(t => ({ id: id(`response:${t.id}`), test_id: t.id, question_id: questions.find(r => r.test_id === t.id)!.id,
    student_id: actors[2].id, selected_option: null, response_text: 'Synthetic submitted answer', score: 1, feedback: 'Synthetic feedback',
    graded_at: now, graded_by: actors[4].id, submitted_at: now }))
  const availability = started.map(t => ({ id: id(`availability:${t.id}`), test_id: t.id, student_id: actors[2].id,
    state: 'open', updated_by: actors[0].id, created_at: now, updated_at: now }))
  const focusEvents = started.map(t => ({ id: id(`focus:${t.id}`), test_id: t.id, student_id: actors[2].id,
    session_id: `${tag}_session`, event_type: 'away_start', occurred_at: now, metadata: { synthetic: true }, created_at: now }))
  const attemptHistory = attempts.map(a => ({ id: id(`history:${a.id}`), test_attempt_id: a.id, patch: null, snapshot: a.responses,
    word_count: 3, char_count: 36, paste_word_count: 0, keystroke_count: 36, trigger: 'baseline', created_at: now }))
  //221 deliberately retains Version identities after the Blueprint is removed.
  const provenance = classes.slice(0, 3).map(c => ({ id: id(`provenance:${c.id}`), draft_id: drafts.find(d => d.classroom_id === c.id)!.id,
    classroom_id: c.id, assignment_id: null, test_id: tests.find(t => t.classroom_id === c.id)!.id,
    source_blueprint_version_id: id(`historical-version:${c.id}`), source_blueprint_version_number: 1, source_draft_revision: 1,
    unit_exception_id: null, unit_label: null, rules_markdown: 'Synthetic frozen guidance', seed_sha256: testOwnerDigest('synthetic seed'),
    created_content_sha256: testOwnerDigest('synthetic content'), created_by: actors[4].id, created_at: now }))
  const missingClassroomId = id('missing-classroom'); const foreignTestId = tests.find(t => t.classroom_id === classes[1].id)!.id
  const makeCase = (label: string, ai: number, ci: number, expectedHTTP: number, mode: string, bulkClassLabel?: string) => ({
    label, actorId: actors[ai].id, classroomId: ci < 0 ? missingClassroomId : classes[ci].id, expectedHTTP, expectedRPCs: 1 as const, mode, bulkClassLabel })
  const cases = [makeCase('teacher-owner', 0, 0, 200, 'ascending'), makeCase('student-owner', 1, 1, 200, 'ascending'),
    makeCase('teacher-noop', 0, 0, 200, 'ascending'), makeCase('empty-owner', 0, 3, 200, 'ascending'),
    ...bulkClasses.map((b, i) => makeCase(b.label, 0, i + 4, b.count > 10000 ? 503 : 200, b.count > 10000 ? 'source-limit' : 'ascending', b.label)),
    makeCase('member-denied', 2, 0, 403, 'ascending'), makeCase('teacher-member-denied', 3, 0, 403, 'ascending'),
    makeCase('historical-creator-denied', 4, 0, 403, 'ascending'), makeCase('unrelated-owner-denied', 1, 0, 403, 'ascending'),
    makeCase('archived-owner-denied', 0, 2, 403, 'ascending'), makeCase('missing-classroom', 0, -1, 404, 'ascending'),
    makeCase('partial-membership', 0, 0, 409, 'partial'), makeCase('foreign-membership', 0, 0, 409, 'foreign'),
    makeCase('superset-membership', 0, 0, 409, 'superset')]
  const privilegeProbes = [{ ...makeCase('raw-42501-253', 0, 0, 503, 'ascending'), context: '253' as const, expectedCode: '42501' as const }]
  const allocatedIds = [...actors.map(a => a.id), ...classes.map(c => c.id), ...tests.flatMap(t => [t.id, t.artifact_id, String(t.documents[0].id)]),
    ...questions.flatMap(r => [r.id, r.artifact_id, ...(r.source_artifact_id ? [r.source_artifact_id] : [])]), ...drafts.map(d => d.id),
    ...enrollments.map(r => r.id), ...attempts.map(r => r.id), ...responses.map(r => r.id), ...availability.map(r => r.id),
    ...focusEvents.map(r => r.id), ...attemptHistory.map(r => r.id), ...provenance.flatMap(r => [r.id, r.source_blueprint_version_id]), missingClassroomId]
  const all = new Set(allocatedIds); assert.equal(all.size, allocatedIds.length)
  for (const b of bulkClasses) for (let i = 0; i < b.count; i++) for (const value of [bulkId(tag, b.count, i), bulkId(tag, b.count, i, true)]) {
    assert(!all.has(value)); all.add(value)
  }
  assert(original.allocatedIds.every(value => !all.has(value))); assert(cases.length + privilegeProbes.length <= TEST_OWNER_REORDER_CAPS.witnessIds)
  const fixture = freeze({ version: 1 as const, tag, now, actors, classes, bulkClasses, tests, questions, drafts, enrollments, attempts, responses,
    availability, focusEvents, attemptHistory, provenance, cases, privilegeProbes, missingClassroomId, foreignTestId, allocatedIds,
    inventory: { actors: 5, classes: 7, tests: 21014, smallTests: 12, bulkTests: 21002, questions: 24, drafts: 12, enrollments: 6,
      attempts: 3, responses: 3, availability: 3, focusEvents: 3, attemptHistory: 3, provenance: 3, triggerCategories: 21, archiveRevisionRows: 7,
      cases: cases.length, privilegeProbes: 1, testTriggers: 13 }, nativeVerified: false as const,
    caveats: ['Bulk manifests use finite deterministic series, not full-row arrays or widened platform limits',
      'Started Test lock UPDATE naturally stamps updated_at; never suppress triggers or overwrite revisions',
      'Whole-project table catalog must come from the original canonical receipt',
      'Writer sequence consumption is nontransactional; root separately attests zero operation-caused advancement',
      'Legacy cached MAX may insert a duplicate position after commit; no closed-race or order-CAS claim',
      'Lost acknowledgement requires failure/disposal, never retry, discovery or compensation'] })
  issuedFixtures.add(fixture)
  return fixture
}
export type TestOwnerReorderFixture = ReturnType<typeof newTestOwnerReorderFixture>
/** Supplemental capability admission, not a replacement for the native owner's
 * full fixture-to-original comparison and exact-project/source guards. */
export function assertIssuedTestOwnerReorderFixture(value: unknown): asserts value is TestOwnerReorderFixture {
  assert(value && typeof value === 'object' && issuedFixtures.has(value) && Object.isFrozen(value), 'Unissued Test reorder fixture')
}
export function testOwnerReorderBulkTest(f: TestOwnerReorderFixture, label: string, ordinal: number) {
  const b = f.bulkClasses.find(b => b.label === label); assert(b && Number.isInteger(ordinal) && ordinal >= 0 && ordinal < b.count)
  return { id: bulkId(f.tag, b.count, ordinal), artifact_id: bulkId(f.tag, b.count, ordinal, true), classroom_id: b.classroomId,
    created_by: f.actors[4].id, title: `${f.tag} ${label} ${ordinal}`, status: 'draft' as const, show_results: false, documents: [], position: ordinal,
    points_possible: 17, include_in_final: false, created_at: f.now, updated_at: f.now, source_artifact_id: null,
    source_blueprint_version_id: null, blueprint_archived_at: null, questions_locked_at: null, gradebook_category_id: null,
    gradebook_weight: 23, gradebook_maximum_override: 19, gradebook_score_scale: 1.25 }
}
export function testOwnerReorderRequest(f: TestOwnerReorderFixture, label: string): { classroom_id: string; test_ids: string[] } {
  const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === label); assert(c)
  const b = f.bulkClasses.find(b => b.classroomId === c.classroomId)
  let ids = b ? Array.from({ length: b.count }, (_, i) => bulkId(f.tag, b.count, i)) : f.tests.filter(t => t.classroom_id === c.classroomId).map(t => t.id)
  if (c.mode === 'source-limit') ids = ids.slice(0, TEST_OWNER_REORDER_CAPS.maxTestIds)
  if (c.mode === 'partial') ids = ids.slice(1)
  if (c.mode === 'foreign') ids = [...ids.slice(1), f.foreignTestId]
  if (c.mode === 'superset') ids = [...ids, f.foreignTestId]
  return { classroom_id: c.classroomId, test_ids: ids }
}
function boundedSql(sql: string) { assert(Buffer.byteLength(sql) <= TEST_OWNER_REORDER_CAPS.sqlBytes); return sql }
function valueSql(v: unknown): string { return v === null ? 'null' : typeof v === 'string' ? q(v) : typeof v === 'object' ? `${q(JSON.stringify(v))}::jsonb` : String(v) }
function insertSql(table: string, rows: readonly Row[], omit: readonly string[] = []) {
  assert(rows.length); const keys = Object.keys(rows[0]).filter(k => !omit.includes(k))
  return `insert into ${table}(${keys.join(',')}) values ${rows.map(r => `(${keys.map(k => valueSql(r[k])).join(',')})`).join(',')};`
}
export function testOwnerReorderSetupSql(f: TestOwnerReorderFixture, projectId: string) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const bulkIdentity = f.bulkClasses.map(b => `select ${bulkIdSql(f.tag, b.count)} as id,${bulkIdSql(f.tag, b.count, true)} as artifact_id from generate_series(0,${b.count - 1}) ordinal`).join(' union all ')
  const bulk = f.bulkClasses.map(b => {
    const r = testOwnerReorderBulkTest(f, b.label, 0); const keys = Object.keys(r).filter(k => k !== 'gradebook_category_id')
    return `insert into public.tests(${keys.join(',')}) select ${keys.map(k => k === 'id' ? bulkIdSql(f.tag, b.count) : k === 'artifact_id' ? bulkIdSql(f.tag, b.count, true) : k === 'position' ? 'ordinal' : k === 'title' ? `${q(`${f.tag} ${b.label} `)}||ordinal::text` : valueSql(r[k as keyof typeof r])).join(',')} from generate_series(0,${b.count - 1}) ordinal;`
  }).join('\n')
  return boundedSql(`${testOwnerGuardSql(projectId)}
begin;set local lock_timeout='3s';set local statement_timeout='60s';
do $collision$ declare owned uuid[]:=array[${f.allocatedIds.map(q).join(',')}]::uuid[];begin
 if ${['users', 'classrooms', 'tests', 'test_questions', 'assessment_drafts', 'classroom_enrollments', 'test_attempts', 'test_responses', 'test_student_availability', 'test_focus_events', 'test_attempt_history', 'classroom_guided_draft_provenance', 'managed_storage_objects'].map(t => `exists(select 1 from public.${t} where id=any(owned))`).join(' or ')}
 or exists(select 1 from (${bulkIdentity}) b join public.tests t on t.id=b.id or t.artifact_id=b.id or t.source_artifact_id=b.id or t.id=b.artifact_id or t.artifact_id=b.artifact_id or t.source_artifact_id=b.artifact_id)
 or exists(select 1 from public.users where email like ${q(f.tag + '%')})
 or exists(select 1 from public.classrooms where class_code like ${q(f.tag + '%')})
 or exists(select 1 from public.tests where classroom_id=any(owned) or artifact_id=any(owned) or source_artifact_id=any(owned))
 or exists(select 1 from public.assessment_drafts where classroom_id=any(owned) or assessment_id=any(owned))
 or exists(select 1 from public.gradebook_categories where classroom_id=any(owned))
 or exists(select 1 from public.classroom_enrollments where classroom_id=any(owned) or student_id=any(owned))
 or exists(select 1 from public.managed_storage_objects where classroom_id=any(owned) or resource_id=any(owned))
 or exists(select 1 from public.managed_storage_json_references where test_id=any(owned) or managed_object_id=any(owned))
 or exists(select 1 from public.classroom_guided_draft_provenance where classroom_id=any(owned) or test_id=any(owned) or draft_id=any(owned))
 or exists(select 1 from private.pal_membership_generations where generation_id=any(owned))
 then raise exception 'Reorder namespace collision';end if;end;$collision$;
${insertSql('public.users', f.actors)}
insert into public.classrooms(id,teacher_id,title,class_code,feature_visibility) values ${f.classes.map(c => `(${q(c.id)},${q(c.owner)},${q(c.title)},${q(c.code)},'{"classwork":false}'::jsonb)`).join(',')};
${insertSql('public.classroom_enrollments', f.enrollments)}
${insertSql('public.tests', f.tests.map(t => ({ ...t, questions_locked_at: null })), ['gradebook_category_id'])}
${bulk}
${insertSql('public.test_questions', f.questions)}
${insertSql('public.assessment_drafts', f.drafts)}
${insertSql('public.test_attempts', f.attempts)}
${insertSql('public.test_responses', f.responses)}
${insertSql('public.test_student_availability', f.availability)}
${insertSql('public.test_focus_events', f.focusEvents)}
${insertSql('public.test_attempt_history', f.attemptHistory)}
${insertSql('public.classroom_guided_draft_provenance', f.provenance)}
do $locks$ declare affected integer;begin
 update public.tests set questions_locked_at=${q(f.now)} where id in (${f.tests.filter(t => t.questions_locked_at).map(t => q(t.id)).join(',')}) and classroom_id in (${f.classes.slice(0, 3).map(c => q(c.id)).join(',')}) and status='active' and questions_locked_at is null;
 get diagnostics affected=row_count;if affected<>3 then raise exception 'Reorder question-lock setup differs';end if;
 update public.classrooms set archived_at=${q(f.now)} where id=${q(f.classes[2].id)} and teacher_id=${q(f.classes[2].owner)} and archived_at is null;
 get diagnostics affected=row_count;if affected<>1 then raise exception 'Reorder archive setup differs';end if;end;$locks$;
commit;`)
}
export function testOwnerReorderBulkOrderSql(f: TestOwnerReorderFixture, label: string) {
  const b = f.bulkClasses.find(b => b.label === label); assert(b)
  return boundedSql(`begin read only;set local lock_timeout='3s';set local statement_timeout='20s';select coalesce(jsonb_agg(id order by position asc,id asc),'[]'::jsonb) from public.tests where classroom_id=${q(b.classroomId)};rollback;`)
}
/** A single scalar SQL expression for nested rollback-only native probes. */
export function testOwnerReorderSnapshotExpressionSql(f: TestOwnerReorderFixture) {
  const classes = f.classes.map(c => q(c.id)).join(','); const actors = f.actors.map(a => q(a.id)).join(',')
  const fixed = f.tests.map(t => q(t.id)).join(','); const bulkClasses = f.bulkClasses.map(b => q(b.classroomId)).join(',')
  const source = 'select id from source_test_ids'; const test = `test_id in (${fixed}) or test_id in (${source})`
  const scopes: Array<[string, string]> = [
    ['public.users', `id in (${actors})`], ['public.classrooms', `id in (${classes})`],
    ['public.tests', `(id in (${fixed}) or classroom_id in (${classes})) and classroom_id not in (${bulkClasses})`],
    ['public.gradebook_categories', `classroom_id in (${classes})`], ['public.test_questions', test],
    ['public.assessment_drafts', `classroom_id in (${classes}) or assessment_id in (${fixed}) or assessment_id in (${source})`],
    ...['test_attempts', 'test_responses', 'test_student_availability'].map(t => [`public.${t}`, test] as [string, string]),
    ['public.classroom_enrollments', `classroom_id in (${classes})`], ['public.classroom_roster', `classroom_id in (${classes})`],
    ['public.classroom_archive_revisions', `classroom_id in (${classes})`],
    ['public.managed_storage_objects', `classroom_id in (${classes}) or resource_id in (${fixed}) or resource_id in (${source})`],
    ['public.managed_storage_json_references', test], ['public.test_document_snapshot_storage_cleanup', 'true'],
    ['public.pal_event_outbox', `student_id in (${actors})`], ['private.pal_membership_outbox', `classroom_id in (${classes}) or student_id in (${actors})`],
    ['private.pal_membership_generations', `generation_id in (${f.enrollments.map(r => q(r.id)).join(',')}) or scope_digest in (${f.classes.flatMap(c => f.actors.map(a => `private.pal_membership_scope(${q(c.id)}::uuid,${q(a.id)}::uuid)`)).join(',')})`],
    ...['pal_membership_settings', 'pal_classroom_signal_settings', 'student_provider_cleanup_settings', 'classroom_creation_entitlement_settings'].map(t => [`private.${t}`, 'true'] as [string, string]),
    ...['test_focus_events', 'test_ai_grading_runs', 'test_ai_grading_run_items'].map(t => [`public.${t}`, test] as [string, string]),
    ['public.test_attempt_history', `test_attempt_id in (select id from public.test_attempts where ${test})`],
    ['public.classroom_guided_draft_provenance', `${test} or classroom_id in (${classes})`],
    ['public.gradebook_score_overrides', `classroom_id in (${classes}) or (assessment_type='test' and assessment_id in (${fixed}) or assessment_type='test' and assessment_id in (${source}))`],
    ['public.course_blueprints', 'false'], ['public.course_blueprint_versions', 'false'], ['public.managed_storage_settings', 'true'],
  ]
  assert.deepEqual(scopes.map(([t]) => t), TEST_OWNER_REORDER_SNAPSHOT_TABLES)
  const excludes: Record<string, string> = { 'public.classrooms': `where r.id not in (${classes})`,
    'public.classroom_archive_revisions': `where r.classroom_id not in (${classes})`,
    'public.tests': `where not (r.id in (${fixed}) or r.classroom_id in (${classes}))` }
  const fingerprints = `(select coalesce(jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'fingerprint',query_to_xml(format('select count(*) as count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) as digest from %I.%I r %s',n.nspname,c.relname,case ${Object.entries(excludes).map(([t, p]) => `when n.nspname||'.'||c.relname=${q(t)} then ${q(p)}`).join(' ')} else '' end),true,false,'')::text) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage'))`
  const immutable = `(to_jsonb(r)-'position'-'updated_at')`
  const projections = `(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'classroom_id',r.classroom_id,'position',r.position,'updated_at',r.updated_at,'immutable_sha256',encode(extensions.digest(${immutable}::text,'sha256'),'hex')) order by r.classroom_id,r.id),'[]'::jsonb) from public.tests r where r.classroom_id in (${bulkClasses}))`
  const bulkSetup = f.bulkClasses.map(b => {
    const expected = testOwnerReorderBulkTest(f, b.label, 0)
    const values = Object.entries(expected).filter(([k]) => !['position', 'updated_at'].includes(k)).flatMap(([k, v]) => [q(k),
      k === 'id' ? bulkIdSql(f.tag, b.count) : k === 'artifact_id' ? bulkIdSql(f.tag, b.count, true) : k === 'title' ? `${q(`${f.tag} ${b.label} `)}||ordinal::text`
        : k === 'gradebook_category_id' ? `(select id from public.gradebook_categories where classroom_id=${q(b.classroomId)} order by is_default desc,position asc,id asc limit 1)`
          : k === 'created_at' ? `${q(f.now)}::timestamptz` : valueSql(v)])
    return `select jsonb_build_object('classroom_id',${q(b.classroomId)},'count',(select count(*) from public.tests where classroom_id=${q(b.classroomId)}),'immutable_valid',not exists(select 1 from generate_series(0,${b.count - 1}) ordinal left join public.tests r on r.id=${bulkIdSql(f.tag, b.count)} and r.classroom_id=${q(b.classroomId)} where r.id is null or ${immutable} is distinct from jsonb_build_object(${values.join(',')}))) as row`
  }).join(' union all ')
  return boundedSql(`(with source_test_ids as (select id from public.tests where id in (${fixed}) or classroom_id in (${classes})) select jsonb_build_object(${scopes.map(([t, p]) => `${q(t)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from ${t} r where ${p})`).join(',')},'__bulk_tests',${projections},'__bulk_setup',(select jsonb_agg(row) from (${bulkSetup}) b),'__nontarget_fingerprints',${fingerprints}))`)
}
export function testOwnerReorderSnapshotSql(f: TestOwnerReorderFixture) {
  return boundedSql(`begin isolation level repeatable read read only;set local lock_timeout='3s';set local statement_timeout='30s';select ${testOwnerReorderSnapshotExpressionSql(f)};rollback;`)
}

const acceptedCatalogs = new WeakSet<object>(); const fixtureCatalogs = new WeakMap<object, readonly string[]>()
const setupSnapshots = new WeakMap<object, string>()
/** Input is the original canonical all-five-field receipt, never a guessed global list. */
export function testOwnerReorderTableCatalogFromCanonical(value: unknown): readonly string[] {
  assert(boundedAssignmentListJson(value, TEST_OWNER_REORDER_CAPS.snapshotBytes))
  const receipt = z.object({ rowDigests: z.string().min(1), guard168Metadata: z.string().min(1), settings: z.string().min(1),
    cronJobs: z.string().min(1), resources: z.string().min(1) }).strict().parse(value)
  const rows = z.record(z.string().regex(/^(public|private|storage)\.[a-z_0-9]+$/),
    z.object({ count: z.number().int().nonnegative().safe(), digest: z.string().regex(/^[a-f0-9]{32}$/) }).strict()).parse(JSON.parse(receipt.rowDigests))
  const tables = Object.keys(rows).sort(); assert(tables.length > 0 && tables.length <= TEST_OWNER_REORDER_CAPS.fingerprintTables)
  for (const t of [...TEST_OWNER_REORDER_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets']) assert(tables.includes(t), 'Incomplete canonical catalog')
  const result = freeze(tables); acceptedCatalogs.add(result); return result
}
function instant(v: unknown) {
  const s = timestamp.parse(v); const fraction = /(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/.exec(s)?.[1] ?? ''
  return `${Math.floor(Date.parse(s) / 1000)}:${fraction.replace(/0+$/, '')}`
}
function micros(v: unknown) {
  const [seconds, fraction] = instant(v).split(':'); assert(fraction.length <= 6, 'Non-PostgreSQL timestamp precision')
  return BigInt(seconds) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0') || '0')
}
function normalized(v: unknown, key = ''): unknown {
  if (typeof v === 'string' && key.endsWith('_at')) return instant(v)
  if (Array.isArray(v)) return v.map(x => normalized(x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalized(x, k)]))
  return v
}
const canonical = (v: unknown) => JSON.stringify(normalized(v))
function equal(a: unknown, b: unknown) { assert.equal(canonical(a), canonical(b), 'Complete row differs') }
function sameRows(a: readonly Row[], b: readonly Row[]) { assert.deepEqual(a.map(canonical).sort(), b.map(canonical).sort(), 'Complete table rows differ') }
function signature(s: TestOwnerReorderSnapshot) { return testOwnerDigest(canonical(Object.fromEntries(Object.entries(s).map(([t, rows]) => [t, rows.map(canonical).sort()])))) }
function indexed(rows: readonly Row[], key = 'id') {
  const pairs = rows.map(r => [uuid.parse(r[key]), r] as const); assert.equal(new Set(pairs.map(([id]) => id)).size, pairs.length)
  return new Map(pairs)
}
const bulkProjectionSchema = z.object({ id: uuid, classroom_id: uuid, position: z.number().int(), updated_at: timestamp,
  immutable_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
function snapshot(f: TestOwnerReorderFixture, value: unknown): TestOwnerReorderSnapshot {
  assert(boundedAssignmentListJson(value, TEST_OWNER_REORDER_CAPS.snapshotBytes), 'Non-JSON/oversize full snapshot')
  const s = z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(TEST_OWNER_REORDER_CAPS.bulkProjectionRows)).parse(value)
  assert.deepEqual(Object.keys(s).sort(), [...TEST_OWNER_REORDER_SNAPSHOT_TABLES, '__bulk_tests', '__bulk_setup', '__nontarget_fingerprints'].sort())
  assert(Object.values(s).reduce((n, rows) => n + rows.length, 0) <= TEST_OWNER_REORDER_CAPS.snapshotRows)
  for (const t of TEST_OWNER_REORDER_SNAPSHOT_TABLES) assert(s[t].length <= TEST_OWNER_REORDER_CAPS.rowsPerTable)
  const catalog = fixtureCatalogs.get(f); assert(catalog, 'No source-accepted canonical catalog')
  const fingerprints = z.array(z.object({ table: z.string().regex(/^(public|private|storage)\.[a-z_0-9]+$/), fingerprint: z.string().min(1).max(4096) }).strict())
    .min(1).max(TEST_OWNER_REORDER_CAPS.fingerprintTables).parse(s.__nontarget_fingerprints)
  assert.equal(new Set(fingerprints.map(r => r.table)).size, fingerprints.length)
  assert.deepEqual(fingerprints.map(r => r.table).sort(), [...catalog], 'Complete external catalog differs')
  s['public.tests'].forEach(r => { assert(boundedAssignmentListJson(r, TEST_OWNER_REORDER_CAPS.rowBytes)); contextualTestListTestSchema.parse(r) })
  s.__bulk_tests.forEach(r => bulkProjectionSchema.parse(r)); indexed(s.__bulk_tests)
  const bulkSetup = z.array(z.object({ classroom_id: uuid, count: z.number().int().nonnegative(), immutable_valid: z.literal(true) }).strict()).length(3).parse(s.__bulk_setup)
  for (const b of f.bulkClasses) {
    const r = bulkSetup.find(r => r.classroom_id === b.classroomId); assert(r && r.count === b.count)
    assert.equal(s.__bulk_tests.filter(r => r.classroom_id === b.classroomId).length, b.count)
  }
  assert.equal(s.__bulk_tests.length, f.inventory.bulkTests)
  return s
}
function plannedRows(actual: Row[], expected: readonly Row[], key = 'id', full = false) {
  const a = indexed(actual, key); assert.equal(a.size, expected.length)
  for (const r of expected) { const found = a.get(String(r[key])); assert(found); if (full) equal(found, r)
    else for (const [k, v] of Object.entries(r)) equal({ [k]: found[k] }, { [k]: v }) }
}
function setupBaseline(f: TestOwnerReorderFixture, s: TestOwnerReorderSnapshot) {
  const categories = s['public.gradebook_categories']; assert.equal(indexed(categories).size, f.inventory.triggerCategories)
  for (const c of f.classes) assert.equal(categories.filter(r => r.classroom_id === c.id).length, 3)
  const expectedTests = f.tests.map(t => {
    const category = categories.filter(r => r.classroom_id === t.classroom_id).sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(a.position) - Number(b.position) || String(a.id).localeCompare(String(b.id)))[0]
    const actual = s['public.tests'].find(r => r.id === t.id); assert(actual)
    return { ...t, gradebook_category_id: category.id, updated_at: t.questions_locked_at ? timestamp.parse(actual.updated_at) : t.updated_at }
  })
  plannedRows(s['public.tests'], expectedTests, 'id', true)
  const bulk = indexed(s.__bulk_tests)
  for (const b of f.bulkClasses) for (let i = 0; i < b.count; i++) {
    const r = bulk.get(bulkId(f.tag, b.count, i)); assert(r && r.classroom_id === b.classroomId && r.position === i)
    equal({ updated_at: r.updated_at }, { updated_at: f.now })
  }
  plannedRows(s['public.test_questions'], f.questions, 'id', true); plannedRows(s['public.assessment_drafts'], f.drafts, 'id', true)
  for (const [t, rows] of [['public.users', f.actors], ['public.classroom_enrollments', f.enrollments], ['public.test_attempts', f.attempts],
    ['public.test_responses', f.responses], ['public.test_student_availability', f.availability], ['public.test_focus_events', f.focusEvents],
    ['public.test_attempt_history', f.attemptHistory], ['public.classroom_guided_draft_provenance', f.provenance]] as const) plannedRows(s[t], rows)
  const classes = indexed(s['public.classrooms']); const revisions = indexed(s['public.classroom_archive_revisions'], 'classroom_id')
  assert.equal(classes.size, f.classes.length); assert.equal(revisions.size, f.classes.length)
  for (const c of f.classes) {
    const r = classes.get(c.id); const revision = revisions.get(c.id); assert(r && revision)
    assert.equal(r.teacher_id, c.owner); assert.equal(r.title, c.title); assert.equal(r.class_code, c.code)
    equal({ archived_at: r.archived_at }, { archived_at: c.archived ? f.now : null })
    assert(Number.isSafeInteger(r.blueprint_source_revision) && Number(r.blueprint_source_revision) >= 0); instant(r.updated_at)
    assert(Number.isSafeInteger(revision.revision) && Number(revision.revision) >= 0); instant(revision.updated_at)
  }
  assert.equal(s['public.managed_storage_settings'].length, 1); assert.equal(s['public.managed_storage_settings'][0].singleton, true)
  for (const t of ['public.managed_storage_objects', 'public.managed_storage_json_references', 'public.gradebook_score_overrides',
    'public.test_ai_grading_runs', 'public.test_ai_grading_run_items', 'public.course_blueprints', 'public.course_blueprint_versions']) assert.equal(s[t].length, 0)
}
export function validateTestOwnerReorderSetupSnapshot(f: TestOwnerReorderFixture, value: unknown, expectedTables: readonly string[]) {
  assert(acceptedCatalogs.has(expectedTables), 'Unissued canonical table catalog')
  const previous = fixtureCatalogs.get(f); if (previous) assert.deepEqual(previous, expectedTables, 'Fixture canonical catalog changed')
  fixtureCatalogs.set(f, expectedTables); const s = snapshot(f, value); setupBaseline(f, s)
  const digest = signature(s); const accepted = setupSnapshots.get(f)
  if (accepted) assert.equal(digest, accepted, 'Previously accepted setup snapshot differs')
  else setupSnapshots.set(f, digest)
  return s
}
const acknowledgementSchema = z.object({ version: z.literal(1), actor_id: uuid, classroom_id: uuid,
  test_ids: z.array(uuid).max(TEST_OWNER_REORDER_CAPS.maxTestIds), positions: z.array(z.number().int().nonnegative()).max(TEST_OWNER_REORDER_CAPS.maxTestIds),
  count: z.number().int().min(0).max(TEST_OWNER_REORDER_CAPS.maxTestIds), changed_count: z.number().int().min(0).max(TEST_OWNER_REORDER_CAPS.maxTestIds) }).strict()
type Envelope = z.infer<typeof acknowledgementSchema>
type Window = Readonly<{ startMs: number; deadlineMs: number }>
export type TestOwnerReorderWitness = Readonly<{ kind: 'reorder' | 'denial'; caseLabel: string; state: 'provisional' | 'verified'; envelope: Envelope | null; requestWindow: Window | null }>
const issued = new WeakSet<object>(); const snapshots = new WeakMap<object, string>(); const fixtureBindings = new WeakMap<object, string>()
function ledger(f: TestOwnerReorderFixture, entries: readonly TestOwnerReorderWitness[]) {
  assert(Array.isArray(entries) && entries.length <= TEST_OWNER_REORDER_CAPS.witnessIds)
  assert(entries.length === 0 || issued.has(entries), 'Unissued/cloned ledger')
  if (issued.has(entries)) assert.equal(fixtureBindings.get(entries), testOwnerDigest(JSON.stringify(f)), 'Ledger fixture differs')
}
function issue(f: TestOwnerReorderFixture, entries: TestOwnerReorderWitness[], after?: TestOwnerReorderSnapshot) {
  assert(entries.length <= TEST_OWNER_REORDER_CAPS.witnessIds); const result = freeze(entries); issued.add(result)
  fixtureBindings.set(result, testOwnerDigest(JSON.stringify(f))); if (after) snapshots.set(result, signature(after)); return result
}
export function registerTestOwnerReorderWitness(f: TestOwnerReorderFixture, prior: TestOwnerReorderWitness[], caseLabel: string, value: unknown, rawWindow?: Window) {
  ledger(f, prior); assert(prior.every(w => w.state === 'verified')); assert(!prior.some(w => w.caseLabel === caseLabel))
  const c = f.cases.find(c => c.label === caseLabel); assert(c && c.expectedHTTP === 200)
  assert(boundedAssignmentListJson(value, TEST_OWNER_REORDER_CAPS.resultBytes)); const envelope = acknowledgementSchema.parse(value)
  const input = testOwnerReorderRequest(f, caseLabel); assert.equal(envelope.actor_id, c.actorId); assert.equal(envelope.classroom_id, input.classroom_id)
  assert.deepEqual(envelope.test_ids, input.test_ids); assert.equal(envelope.count, input.test_ids.length)
  assert.deepEqual(envelope.positions, input.test_ids.map((_, i) => input.test_ids.length - 1 - i)); assert(envelope.changed_count <= envelope.count)
  if (caseLabel === 'teacher-noop') { assert(prior.some(w => w.caseLabel === 'teacher-owner' && w.state === 'verified')); assert.equal(envelope.changed_count, 0) }
  const startMs = Date.now(); const requestWindow = rawWindow ?? { startMs, deadlineMs: startMs + TEST_OWNER_REORDER_CAPS.requestMs }
  assert(Number.isSafeInteger(requestWindow.startMs) && Number.isSafeInteger(requestWindow.deadlineMs) && requestWindow.deadlineMs > requestWindow.startMs && requestWindow.deadlineMs - requestWindow.startMs <= TEST_OWNER_REORDER_CAPS.requestMs)
  const result = issue(f, [...prior, { kind: 'reorder', caseLabel, state: 'provisional', envelope, requestWindow: { ...requestWindow } }])
  const previous = snapshots.get(prior); if (previous) snapshots.set(result, previous); return result
}
/** Only this complete-effect sink can issue verified witnesses. */
export function verifyTestOwnerReorderEffects(f: TestOwnerReorderFixture, beforeValue: unknown, afterValue: unknown, caseLabel: string,
  entries: TestOwnerReorderWitness[], publicResult?: unknown, transactionTimestamp?: string) {
  ledger(f, entries); const before = snapshot(f, beforeValue); const after = snapshot(f, afterValue)
  const previous = snapshots.get(entries) ?? setupSnapshots.get(f); assert(previous, 'No verified setup snapshot')
  assert.equal(signature(before), previous, 'Previous verified whole snapshot differs')
  const c = [...f.cases, ...f.privilegeProbes].find(c => c.label === caseLabel); assert(c)
  const witness = entries.find(w => w.caseLabel === caseLabel)
  if (c.expectedHTTP !== 200) {
    assert(!witness && entries.every(w => w.state === 'verified')); assert.equal(publicResult, undefined)
    for (const t of Object.keys(before)) sameRows(before[t], after[t])
    return issue(f, [...entries, { kind: 'denial', caseLabel, state: 'verified', envelope: null, requestWindow: null }], after)
  }
  assert(witness && witness.state === 'provisional' && witness.kind === 'reorder' && witness.envelope && witness.requestWindow && entries.at(-1) === witness)
  assert(entries.slice(0, -1).every(w => w.state === 'verified'))
  equal(publicResult, { success: true })
  const e = witness.envelope; const positions = new Map(e.test_ids.map((id, i) => [id, e.positions[i]]))
  const members = [...before['public.tests'], ...before.__bulk_tests].filter(r => r.classroom_id === e.classroom_id)
  assert.deepEqual(members.map(r => r.id).sort(), [...e.test_ids].sort(), 'Complete membership differs')
  const changed = members.filter(r => r.position !== positions.get(String(r.id))); assert.equal(changed.length, e.changed_count)
  const classroom = before['public.classrooms'].find(r => r.id === e.classroom_id); assert(classroom && classroom.teacher_id === e.actor_id && classroom.archived_at === null)
  let stamp: string | undefined
  if (changed.length) {
    const first = [...after['public.tests'], ...after.__bulk_tests].find(r => r.id === changed[0].id); assert(first)
    stamp = timestamp.parse(first.updated_at); if (transactionTimestamp !== undefined) assert.equal(instant(stamp), instant(transactionTimestamp))
    assert(micros(stamp) >= BigInt(witness.requestWindow.startMs) * BigInt(1000) && micros(stamp) <= BigInt(witness.requestWindow.deadlineMs) * BigInt(1000), 'Transaction timestamp outside rooted request')
  }
  for (const table of ['public.tests', '__bulk_tests']) sameRows(after[table], before[table].map(r =>
    r.classroom_id === e.classroom_id && r.position !== positions.get(String(r.id)) ? { ...r, position: positions.get(String(r.id)), updated_at: stamp } : r))
  for (const [table, key, revision, delta] of [['public.classrooms', 'id', 'blueprint_source_revision', changed.length],
    ['public.classroom_archive_revisions', 'classroom_id', 'revision', 2 * changed.length]] as const) sameRows(after[table], before[table].map(r => {
    if (r[key] !== e.classroom_id || !delta) return r
    assert(Number.isSafeInteger(r[revision]) && Number(r[revision]) <= Number.MAX_SAFE_INTEGER - delta)
    return { ...r, [revision]: Number(r[revision]) + delta, updated_at: stamp }
  }))
  for (const t of Object.keys(before)) if (!['public.tests', '__bulk_tests', 'public.classrooms', 'public.classroom_archive_revisions'].includes(t)) sameRows(before[t], after[t])
  return issue(f, entries.map(w => w === witness ? { ...w, state: 'verified' } : w), after)
}
