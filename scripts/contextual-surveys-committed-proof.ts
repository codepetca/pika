/** Inert Survey263 remaining-only proposal. No executor, target, entropy, IO,
 * admission, deadline renewal or native acceptance is supplied by this module.
 * The owner must bind actual private NativeSession bootstrap identities and
 * validate every frame immediately before its guarded dispatch. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { contextualSurveysConcurrencyCases } from './contextual-surveys-concurrency-cases'
import { newSurveyNativeFixture, SURVEY_NATIVE_SOURCES, type SurveyNativeFixture } from './contextual-surveys-native-contracts'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const q = (s: string) => `'${s.replaceAll("'", "''")}'`
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const id = (tag: string, label: string) => { const h = hash(`${tag}:${label}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) }; return v }
export const SURVEY_COMMITTED_CAPS = Object.freeze({ actions: 200, controls: 4000, sessions: 2, workMs: 720000,
  cleanupMs: 180000, sqlBytes: 262144, responseBytes: 8388608, polls: 3, observationMs: 750, legacyLockMs: 1000 })
type Side = 'holder' | 'contender'
const FULL_TABLES = ['public.classrooms', 'public.classroom_archive_revisions', 'public.classroom_enrollments',
  'public.surveys', 'public.survey_questions', 'public.survey_responses', 'public.gradebook_categories', 'private.pal_membership_generations'] as const
const IDENTITY_FIELDS = ['id', 'artifact_id', 'generation_id'] as const
type FullTable = typeof FULL_TABLES[number]
type TableWitness = { count: number; sha256: string; identities: Record<typeof IDENTITY_FIELDS[number], string[]> }
type Graph = Record<string, Record<string, unknown>[] | TableWitness> & Record<FullTable, Record<string, unknown>[]>
type Lock = Readonly<{ kind: 'row' | 'advisory'; relation: string; targetColumn: 'id' | 'classroom_id'; targetId: string; key: string; mode: 'ExclusiveLock' | 'ShareLock' }>
type Cohort = Readonly<{ classroomId: string; foreignClassroomId: string; surveyId: string; foreignSurveyId: string;
  resultSurveyId: string; enrollmentId: string; readerEnrollmentId: string; scopeDigest: string; question: SurveyNativeFixture['question']; aggregateQuestion: SurveyNativeFixture['question']; aggregateResponseId: string }>
type Effects = Readonly<{ archive: number; blueprint: number; foreignArchive: number; responseWrites: number;
  responseCount: number; membershipRemoved: boolean; questionPatch: Readonly<Record<string, unknown>>; classroomPatch: Readonly<Record<string, unknown>>; surveyPatch: Readonly<Record<string, unknown>> }>
type Schedule = Readonly<{ label: string; index: number; direction: 'forward' | 'reverse'; mode: 'wait' | 'nowait';
  cohort: Cohort; lock: Lock; firstOperationSha256: string; secondOperationSha256: string; effects: Effects; retryCode: string | null; frames: Readonly<Record<'cache' | 'holder' | 'contender' | 'release' | 'settle' | 'retry' | 'terminal', string>> }>
const issued = new WeakSet<object>()
const seedGraphs = new WeakMap<object, Graph>()
const acceptedEffects = new WeakMap<object, Map<string, Readonly<{ before: Graph; after: Graph }>>>()

function fixture(f: SurveyNativeFixture) {
  assert(Object.isFrozen(f)); assert.match(f.tag, /^surveynative_[a-f0-9]{12}$/)
  assert.equal(f.projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  assert.equal(f.actors.length, 4)
  f.actors.forEach((a, i) => { assert(Object.isFrozen(a)); assert.equal(a.id, id(f.tag, `actor:${i}`)); assert.equal(a.role, ['student', 'teacher', 'student', 'student'][i]); assert.equal(a.email, `${f.tag}_${i}@example.invalid`) })
  f.classes.forEach((c, i) => { assert.equal(c.id, id(f.tag, `class:${i}`)); assert.equal(c.owner, f.actors[i].id) })
  assert.equal(f.question.id, id(f.tag, 'question')); assert.equal(f.question.artifact_id, id(f.tag, 'question-artifact'))
  assert.equal(f.question.survey_id, id(f.tag, 'survey:0'))
  assert.equal(new Set(f.allocatedIds).size, f.allocatedIds.length)
  const expected = newSurveyNativeFixture({ manifest: { syntheticTag: `assignmentlist_${f.tag.slice(-12)}` }, allocatedIds: [] } as unknown as AssignmentListProofFixture)
  assert(isDeepStrictEqual(f, expected), 'Survey actor/cohort source differs')
}
function guard(f: SurveyNativeFixture, side: Side, begin: boolean) {
  const prefix = "begin read only;set local lock_timeout='3s';set local statement_timeout='30s';"
  const terminal = "end;$guard$;select 'ok';rollback;"
  const original = testOwnerGuardSql(f.projectId)
  assert(original.startsWith(prefix) && original.endsWith(terminal))
  const identity = `current_setting('application_name')<>${q(f.projectId + '_fixture')}`
  assert.equal(original.split(identity).length, 2)
  const inherited = original.slice(prefix.length, -terminal.length).replace(identity, `current_setting('application_name')<>${q(f.projectId + '_draft_' + side)}`)
  return `${begin ? "begin;set local lock_timeout='1s';set local statement_timeout='8s';set local idle_in_transaction_session_timeout='180s';" : ''}${inherited}
 if current_database()<>'postgres' or current_user<>'postgres' or to_regprocedure('public.respond_to_survey_for_member_v1(uuid,uuid,uuid,jsonb,jsonb)') is null then raise exception 'Survey263 committed source differs';end if;end;$guard$;`
}
function graphFunctions() {
  return `create or replace function pg_temp.survey_committed_graph() returns jsonb language plpgsql as $graph$
 declare g jsonb:='{}'::jsonb;rows jsonb;t record;begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname loop
 execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',t.nspname,t.relname) into rows;
 g:=g||jsonb_build_object(t.nspname||'.'||t.relname,case when t.nspname||'.'||t.relname in (${FULL_TABLES.map(q).join(',')}) then rows
 else jsonb_build_object('count',jsonb_array_length(rows),'sha256',encode(sha256(convert_to(rows::text,'UTF8')),'hex'),
 'identities',jsonb_build_object(${IDENTITY_FIELDS.map(field => `${q(field)},(select coalesce(jsonb_agg(r.value->${q(field)} order by (r.value->>${q(field)}) collate "C"),'[]'::jsonb) from jsonb_array_elements(rows) r(value) where jsonb_typeof(r.value->${q(field)})='string')`).join(',')})) end);end loop;return g;end;$graph$;
 create temporary table if not exists survey_committed_cache(label text primary key,questions jsonb not null,graph jsonb not null) on commit preserve rows;`
}
function responseSql(c: Cohort, label: string, actor: string) {
  return `select public.respond_to_survey_for_member_v1(${q(actor)},${q(c.surveyId)},${q(c.classroomId)},
 (select questions from survey_committed_cache where label=${q(label)}),${q(JSON.stringify({ [c.question.id]: { question_type: 'short_text', response_text: 'Synthetic response' } }))}::jsonb);`
}
function operations(f: SurveyNativeFixture, c: Cohort, label: string) {
  const cases = contextualSurveysConcurrencyCases({ ownerId: f.actors[0].id, memberId: f.actors[1].id,
    resultReaderId: f.actors[3].id, resultSurveyId: c.resultSurveyId, classroomId: c.classroomId,
    surveyId: c.surveyId, questionId: c.question.id, foreignSurveyId: c.foreignSurveyId }, { expectedQuestions: [c.question], responses: {} })
  // Cache actual committed seed rows, including their genuine transaction timestamps.
  const respond = responseSql(c,label,f.actors[1].id)
  return cases.map(r => ({ ...r, first: r.first.includes('respond_to_survey') ? respond : r.first,
    second: r.second.includes('respond_to_survey') ? respond : r.second }))
}
function performed(sql: string) { return sql.startsWith('select ') ? `perform ${sql.slice(7)}` : sql }
function attempted(sql: string, expected: string | null, expectedMessage?: string) {
  const jsonRpc = sql.startsWith('select public.')
  return `create temporary table if not exists survey_committed_operation(result jsonb,started_at timestamptz not null,finished_at timestamptz not null,source_sha256 text not null) on commit preserve rows;delete from survey_committed_operation;
 do $operation$ declare code text;${expectedMessage ? 'message text;' : ''}r jsonb;n integer;started timestamptz:=clock_timestamp();begin begin ${jsonRpc ? `r:=${sql.slice(7).replace(/;$/, '')};` : performed(sql)}
 ${sql.startsWith('update ') || sql.startsWith('delete ') ? "get diagnostics n=row_count;if n<>1 then raise exception 'Exact legacy affected-row count differs';end if;" : ''}
 ${expected ? "raise exception 'Expected Survey denial missing';" : ''}
 exception when others then get stacked diagnostics code=returned_sqlstate${expectedMessage ? ',message=message_text' : ''};
 ${expected ? `if code is distinct from ${q(expected)} then raise exception 'Survey exact SQLSTATE differs';end if;${expectedMessage ? `if message is distinct from ${q(expectedMessage)} then raise exception 'Survey exact denial cause differs';end if;` : ''}` : 'raise;'} end;
 insert into survey_committed_operation values(jsonb_build_object('code',code,'result',r),started,clock_timestamp(),${q(hash(sql))});end;$operation$;`
}
function archiveReceiptSql(sql: string, label: string, c: Cohort) {
  if (!sql.includes('archived_at=clock_timestamp()')) return ''
  return `,'archiveReceipt',(select jsonb_build_object('label',${q(label)},'classroomId',${q(c.classroomId)},'archivedAt',r.archived_at,
 'transactionTimestamp',transaction_timestamp(),'operationStartedAt',o.started_at,'operationFinishedAt',o.finished_at)
 from public.classrooms r cross join survey_committed_operation o where r.id=${q(c.classroomId)})`
}
function heldWitnessSql() {
  return `jsonb_build_object('criterion','original-operation-and-owned-backend',
 'backend',(select jsonb_build_object('pid',pid,'started',backend_start,'name',application_name,'database',datname,'user',usename) from pg_stat_activity where pid=pg_backend_pid()),
 'transactionStartedAt',(select xact_start from pg_stat_activity where pid=pg_backend_pid()),
 'sourceSha256',(select source_sha256 from survey_committed_operation),
 'operationStartedAt',(select started_at from survey_committed_operation),'operationFinishedAt',(select finished_at from survey_committed_operation),
 'operation',(select result from survey_committed_operation))`
}
function effects(index: number, direction: 'forward' | 'reverse'): Effects {
  const questionPatch: Record<string, unknown> = {}, classroomPatch: Record<string, unknown> = {}, surveyPatch: Record<string, unknown> = {}
  let archive = 0, blueprint = 0, foreignArchive = 0, responseWrites = 0, responseCount = 0
  if ([0, 1, 8].includes(index)) Object.assign(questionPatch, { question_text: 'Concurrent question' })
  if (index === 9) Object.assign(questionPatch, { question_type: 'multiple_choice', options: ['A', 'B'] })
  if (index === 10) Object.assign(questionPatch, { question_type: 'multiple_choice', options: ['Changed A', 'Changed B'] })
  if (index === 11) questionPatch.response_max_chars = 1
  if (Object.keys(questionPatch).length) { archive = 2; blueprint = 1 }
  if (index === 7) { questionPatch.survey_id = '__foreign'; archive = 1; foreignArchive = 1 }
  if (index === 2) { classroomPatch.teacher_id = '__member'; archive = 1 }
  if (index === 3) { classroomPatch.archived_at = '__archive_receipt'; archive = 1 }
  if (index === 4) archive = 1
  if (index === 12) { surveyPatch.status = 'closed'; archive = 1 }
  if ((index >= 8 && index <= 12 && direction === 'reverse') || index >= 13) { responseWrites = 1; responseCount = 1; archive++ }
  // ON CONFLICT fires both BEFORE INSERT and BEFORE UPDATE archive triggers.
  if (index === 14) { responseWrites = 3; archive += 2 }
  return freeze({ archive, blueprint, foreignArchive, responseWrites, responseCount, membershipRemoved: index === 4,
    questionPatch, classroomPatch, surveyPatch })
}

export function surveyCommittedProofManifest(f: SurveyNativeFixture) {
  fixture(f)
  const allocatedIds: string[] = []
  const schedules: Schedule[] = []
  for (let index = 0; index < 15; index++) for (const direction of ['forward', 'reverse'] as const) {
    const namespace = `${f.tag}:committed:${index}:${direction}`
    const sourceId = (label: string) => { const value = id(namespace, label); allocatedIds.push(value); return value }
    const classroomId = sourceId('class'), foreignClassroomId = sourceId('foreign-class'), surveyId = sourceId('survey')
    const c: Cohort = freeze({ classroomId, foreignClassroomId, surveyId, foreignSurveyId: sourceId('foreign-survey'), resultSurveyId: sourceId('result-survey'),
      enrollmentId: sourceId('enrollment'), readerEnrollmentId: sourceId('reader-enrollment'),
      scopeDigest: hash(`pika-membership-scope-v1:${classroomId}:${f.actors[1].id}`),
      question: { ...f.question, id: sourceId('question'), artifact_id: sourceId('artifact'), survey_id: surveyId },
      aggregateQuestion: { ...f.question, id: sourceId('aggregate-question'), artifact_id: sourceId('aggregate-artifact'), survey_id: id(namespace, 'result-survey') },
      aggregateResponseId: sourceId('aggregate-response') })
    const provisional = operations(f, c, 'pending')[index]
    const label = `${provisional.name}:${direction}`, pair = operations(f, c, label)[index]
    const first = direction === 'forward' ? pair.first : pair.second, second = direction === 'forward' ? pair.second : pair.first
    const waitForward = [0, 2, 3, 4, 7].includes(index), waitReverse = [1, 5, 6, 8, 9, 10, 11, 12].includes(index)
    const mode = direction === 'forward' ? waitForward ? 'wait' : 'nowait' : waitReverse ? 'wait' : 'nowait'
    const enrollmentRow = index === 4 && direction === 'forward'
    const advisory = index === 4 && direction === 'reverse' || index === 5 || index === 6
    const key = index === 5 ? `pika-student-purge-subject:${f.actors[1].id}` : `pika-classroom-operation:${c.classroomId}`
    const classRow = index === 2 || index === 3
    const lock: Lock = freeze({ kind: advisory ? 'advisory' : 'row', relation: enrollmentRow ? 'public.classroom_enrollments' : classRow ? 'public.classrooms' : 'public.classroom_archive_revisions',
      targetColumn: enrollmentRow || classRow ? 'id' : 'classroom_id', targetId: enrollmentRow ? c.enrollmentId : c.classroomId, key: advisory ? key : enrollmentRow ? c.enrollmentId : c.classroomId, mode: 'ExclusiveLock' })
    const retryCode = [2, 3, 4].includes(index) && direction === 'reverse' ? 'PT403' : index >= 8 && index <= 11 && direction === 'forward' ? 'PT409'
      : index === 12 && direction === 'forward' || index === 13 ? 'PT400' : null
    const cache = `${guard(f, 'holder', true)}${graphFunctions()}insert into survey_committed_cache
 select ${q(label)},coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb),pg_temp.survey_committed_graph() from public.survey_questions r where survey_id=${q(c.surveyId)};commit;`
    const holder = `${guard(f, 'holder', true)}${attempted(first, null)}select jsonb_build_object('label',${q(label)},'writerTimestamp',transaction_timestamp(),'heldWitness',${heldWitnessSql()},'operation',(select result from survey_committed_operation),
 'responses',(select coalesce(jsonb_agg(to_jsonb(r) order by question_id),'[]'::jsonb) from public.survey_responses r where survey_id=${q(c.surveyId)} and student_id=${q(f.actors[1].id)})${archiveReceiptSql(first, label, c)}) as result;`
    // Blocking contender begins and executes BEFORE its holder releases; its
    // promise remains outstanding. No sleep is used to establish that state.
    const contender = `${guard(f, 'contender', true)}${attempted(second, mode === 'nowait' ? 'PT409' : null)}select jsonb_build_object('label',${q(label)},'operation',(select result from survey_committed_operation),'writerTimestamp',transaction_timestamp()${archiveReceiptSql(second, label, c)}) as result;`
    const retry = `${guard(f, 'contender', true)}${attempted(second, retryCode)}select jsonb_build_object('label',${q(label)},'operation',(select result from survey_committed_operation),'writerTimestamp',transaction_timestamp()${archiveReceiptSql(second, label, c)}) as result;commit;`
    const read = index === 5 ? `select public.get_survey_results_for_member_v1(${q(f.actors[3].id)},${q(c.resultSurveyId)});`
      : `select public.get_survey_for_${[0, 1, 2, 6, 7].includes(index) ? 'owner' : 'member'}_v1(${q(f.actors[[0, 1, 2, 6, 7].includes(index) ? 0 : 1].id)},${q(c.surveyId)});`
    const terminalCode = [2, 3, 4].includes(index) ? 'PT403' : null
    const probeCode = index >= 8 && index <= 11 ? 'PT409' : index === 12 || index === 13 ? 'PT400' : null
    // Reverse freshness races already committed A's static response. Probe the
    // existing unanswered member B so duplicate precedence cannot mask staleness.
    const freshness = index >= 8 && index <= 11
    const probeActor = f.actors[freshness && direction === 'reverse' ? 3 : 1].id
    const probeEnrollment = freshness && direction === 'reverse' ? c.readerEnrollmentId : c.enrollmentId
    const eligibility = freshness ? `do $probe_eligibility$ begin
 if not exists(select 1 from public.surveys s join public.classrooms c on c.id=s.classroom_id
 join public.classroom_enrollments e on e.classroom_id=c.id where s.id=${q(c.surveyId)} and c.id=${q(c.classroomId)}
 and c.teacher_id<>${q(probeActor)} and c.archived_at is null and s.status='active' and s.opens_at is null and not s.dynamic_responses
 and e.id=${q(probeEnrollment)} and e.student_id=${q(probeActor)})
 or exists(select 1 from public.survey_responses where survey_id=${q(c.surveyId)} and student_id=${q(probeActor)})
 or (select questions from survey_committed_cache where label=${q(label)}) is not distinct from
 (select coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb) from public.survey_questions r where survey_id=${q(c.surveyId)})
 then raise exception 'Survey stale probe eligibility differs';end if;end;$probe_eligibility$;` : ''
    const probeMessage = freshness ? 'survey_questions_changed' : index === 12 ? 'survey_not_open' : index === 13 ? 'survey_already_answered' : undefined
    const probe = probeCode ? `create temporary table survey_committed_fresh_read(result jsonb) on commit drop;insert into survey_committed_fresh_read select result from survey_committed_operation;
 ${eligibility}${attempted(responseSql(c,label,probeActor), probeCode, probeMessage)}` : ''
    const terminal = `${guard(f, 'holder', true)}${attempted(read, terminalCode)}${probe}
 select jsonb_build_object('label',${q(label)},'graph',pg_temp.survey_committed_graph(),
 'cached_questions',(select questions from survey_committed_cache where label=${q(label)}),
 'fresh_read',(select result from ${probeCode ? 'survey_committed_fresh_read' : 'survey_committed_operation'}),
 'cached_response_probe',${probeCode ? '(select result from survey_committed_operation)' : 'null'}) as result;commit;`
    schedules.push(freeze({ label, index, direction, mode, cohort: c, lock, firstOperationSha256: hash(first), secondOperationSha256: hash(second), effects: effects(index, direction), retryCode,
      frames: { cache, holder, contender, release: `${guard(f, 'holder', false)}commit;`, settle: `${guard(f, 'contender', false)}commit;`, retry, terminal } }))
  }
  assert.equal(new Set(allocatedIds).size, allocatedIds.length)
  assert(allocatedIds.every(value => !f.allocatedIds.includes(value)))
  const seed = `${guard(f, 'holder', true)}${graphFunctions()}
 create temporary table survey_committed_seed_before(graph jsonb) on commit drop;insert into survey_committed_seed_before values(pg_temp.survey_committed_graph());
 do $collision$ begin
 if exists(select 1 from public.classrooms where id in (${allocatedIds.map(q).join(',')}))
 or exists(select 1 from private.pal_membership_generations where generation_id in (${allocatedIds.map(q).join(',')})) then raise exception 'Committed cohort collision';end if;end;$collision$;
 ${schedules.map(({ index, cohort: c }) => `insert into public.classrooms(id,teacher_id,title,class_code) values (${q(c.classroomId)},${q(f.actors[0].id)},${q(f.tag)},${q(c.classroomId)}),(${q(c.foreignClassroomId)},${q(f.actors[1].id)},${q(f.tag)},${q(c.foreignClassroomId)});
 insert into public.classroom_enrollments(id,classroom_id,student_id) values (${q(c.enrollmentId)},${q(c.classroomId)},${q(f.actors[1].id)}),(${q(c.readerEnrollmentId)},${q(c.classroomId)},${q(f.actors[3].id)});
 insert into public.surveys(id,classroom_id,created_by,title,status,show_results,dynamic_responses,position) values
 (${q(c.surveyId)},${q(c.classroomId)},${q(f.actors[0].id)},${q(f.tag)},'active',true,${index === 14},0),
 (${q(c.foreignSurveyId)},${q(c.foreignClassroomId)},${q(f.actors[1].id)},${q(f.tag)},'active',true,false,0),
 (${q(c.resultSurveyId)},${q(c.classroomId)},${q(f.actors[0].id)},${q(f.tag)},'active',true,false,1);
 insert into public.survey_questions(id,artifact_id,survey_id,question_type,question_text,options,response_max_chars,position) values
 ${[c.question, c.aggregateQuestion].map(r => `(${q(r.id)},${q(r.artifact_id)},${q(r.survey_id)},'short_text',${q(r.question_text)},'[]',500,0)`).join(',')};
 insert into public.survey_responses(id,survey_id,question_id,student_id,response_text) values (${q(c.aggregateResponseId)},${q(c.resultSurveyId)},${q(c.aggregateQuestion.id)},${q(f.actors[1].id)},'Synthetic shared result');`).join('\n')}
 select jsonb_build_object('before',(select graph from survey_committed_seed_before),'after',pg_temp.survey_committed_graph(),'seedTimestamp',transaction_timestamp()) as result;commit;`
  const bootstrap = Object.fromEntries((['holder', 'contender'] as const).map(side => [side, `${guard(f, side, true)}${graphFunctions()}
 ${schedules.map(s => `insert into survey_committed_cache select ${q(s.label)},coalesce(jsonb_agg(to_jsonb(r) order by position,id),'[]'::jsonb),pg_temp.survey_committed_graph() from public.survey_questions r where survey_id=${q(s.cohort.surveyId)};`).join('\n')}commit;`])) as Record<Side, string>
  const nowait = schedules.filter(s => s.mode === 'nowait').length, wait = 30 - nowait
  // Held witness shares the holder execute. Each blocking observation is ONE
  // source-fixed frame containing 1..3 actual-state polls (never sleep-as-proof).
  // Per direction: holder, contender, release, settlement, terminal; NOWAIT
  // adds retry; blocking adds one observer dispatch. Two closes execute rollback.
  const minActions = 3 + 30 * 5 + nowait + wait + 2, maxActions = minActions
  const sqlFrames = [seed, ...Object.values(bootstrap), ...schedules.flatMap(s => Object.values(s.frames))]
  sqlFrames.forEach(sql => assert(Buffer.byteLength(sql) <= SURVEY_COMMITTED_CAPS.sqlBytes))
  const m = freeze({ version: 1, projectId: f.projectId, sourceSha256: SURVEY_NATIVE_SOURCES.migration.sha256,
    actors: f.actors, originalFixtureSha256: hash(JSON.stringify(f)), allocatedIds, seed, bootstrap, schedules,
    verificationCriterion: 'practical-original-operation-backend-edge-and-committed-effects' as const,
    exactTupleOwnershipClaimed: false as const,
    caps: SURVEY_COMMITTED_CAPS, inventory: { directions: 30, wait, nowait, sessions: 2, opens: 2, closes: 2,
      seedFrames: 1, bootstrapFrames: 2, holderWitnessFrames: 0, observerFrames: wait, minObserverPolls: wait, maxObserverPolls: wait * 3,
      minActions, maxActions, staticSqlBytes: sqlFrames.reduce((n, sql) => n + Buffer.byteLength(sql), 0),
      minimumRollbackReplayActions: 134, withRollbackReplayFits: minActions + 134 <= 200,
      remainingOnlyFits: minActions <= 200, controlCount: null,
      controlCountReason: 'Concrete private engine guard/bootstrap/settlement controls are not bound; no exact control count or executable admission is claimed.' },
    unresolved: ['Concrete private backend bootstrap binding, fresh source seals and guard dispatch inventory are not implemented.',
      'Actual sealed NativeSession dispatch/operation/observation carriers are not bound; matching public DTOs are not native provenance.',
      'Membership removal forward must demonstrate the exact enrollment row wait; immediate 40001 is not accepted as a waiter.',
      'Consolidated committed proposal uses185 actions; only15 remain for all other required actions. Complete remaining acceptance inventory is not sealed, so this module is not executable admission.'],
    executionEnabled: false as const, nativeVerified: false as const })
  issued.add(m); return m
}
export type SurveyCommittedProofManifest = ReturnType<typeof surveyCommittedProofManifest>
export function validateSurveyCommittedSource(m: SurveyCommittedProofManifest, source: { migration: string; races: string }) {
  assert(issued.has(m)); assert.equal(hash(source.migration), m.sourceSha256, 'Stale Survey migration SQL')
  assert.equal(hash(source.races), SURVEY_NATIVE_SOURCES.races.sha256, 'Stale Survey pair source')
  return true
}
function schedule(m: SurveyCommittedProofManifest, label: string) { assert(issued.has(m) && Object.isFrozen(m), 'Unsealed committed manifest'); const s = m.schedules.find(s => s.label === label); assert(s, 'Unknown committed direction'); return s }
export function validateSurveyCommittedSql(m: SurveyCommittedProofManifest, label: string, side: Side, frame: keyof Schedule['frames'], sql: string) {
  try { const s = schedule(m, label); const expectedSide = ['cache', 'holder', 'release', 'terminal'].includes(frame) ? 'holder' : 'contender';
    return side === expectedSide && typeof sql === 'string' && Buffer.byteLength(sql) <= m.caps.sqlBytes && sql === s.frames[frame] } catch { return false }
}

/** This DTO must come from actual NativeSession.owned bootstrap; names/queries
 * selected by callers are not provenance. The owner binds it privately. */
export type SurveyCommittedBootstrap = Readonly<Record<Side, Readonly<{ pid: number; started: string; name: string; database: 'postgres'; user: 'postgres' }>>>
function backend(m: SurveyCommittedProofManifest, b: SurveyCommittedBootstrap) {
  for (const side of ['holder', 'contender'] as const) { const r = b[side]; assert.deepEqual(Object.keys(r).sort(), ['database', 'name', 'pid', 'started', 'user']);
    assert(Number.isSafeInteger(r.pid) && r.pid > 0); assert(Number.isFinite(Date.parse(r.started))); assert.equal(r.name, `${m.projectId}_draft_${side}`); assert.equal(r.database, 'postgres'); assert.equal(r.user, 'postgres') }
  assert.notEqual(b.holder.pid, b.contender.pid)
}
export function surveyCommittedObservationSql(m: SurveyCommittedProofManifest, label: string, b: SurveyCommittedBootstrap) {
  const s = schedule(m, label); backend(m, b)
  const activity = (side: Side) => `(select jsonb_build_object('pid',pid,'started',backend_start,'name',application_name,'database',datname,'user',usename) from pg_stat_activity where pid=${b[side].pid})`
  const observation = `jsonb_build_object('label',${q(label)},'observedAt',clock_timestamp(),'holder',${activity('holder')},'contender',${activity('contender')},
 'held',${heldWitnessSql()},'blockers',to_jsonb(pg_blocking_pids(${b.contender.pid})),
 'waiter',(select jsonb_build_object('wait_event_type',wait_event_type,'wait_event',wait_event,'state',state) from pg_stat_activity where pid=${b.contender.pid} and wait_event_type='Lock'))`
  const sql = `${guard({ projectId: m.projectId } as SurveyNativeFixture, 'holder', false)}
 do $backend$ begin if pg_backend_pid()<>${b.holder.pid} or not exists(select 1 from pg_stat_activity where pid=pg_backend_pid()
 and backend_start=${q(b.holder.started)}::timestamptz and application_name=${q(b.holder.name)} and datname='postgres' and usename='postgres')
 then raise exception 'Actual committed holder bootstrap differs';end if;end;$backend$;
 create temporary table survey_committed_observation(result jsonb) on commit drop;
 do $observe$ declare r jsonb;poll integer;started timestamptz:=clock_timestamp();begin
 for poll in 1..${m.caps.polls} loop
 if clock_timestamp()-started>interval '750 milliseconds' then raise exception 'Survey finite observer deadline';end if;
 perform pg_stat_clear_snapshot();r:=${observation}||jsonb_build_object('poll',poll);
 exit when ${s.mode === 'nowait' ? 'true' : `r->'blockers'=jsonb_build_array(${b.holder.pid}) and r->'waiter'<>'null'::jsonb`};end loop;
 insert into survey_committed_observation values(r);end;$observe$;select result from survey_committed_observation;`
  assert(Buffer.byteLength(sql) <= m.caps.sqlBytes); return sql
}
export function validateSurveyCommittedObservationSql(m: SurveyCommittedProofManifest, label: string, b: SurveyCommittedBootstrap, sql: string) {
  try { return sql === surveyCommittedObservationSql(m, label, b) } catch { return false }
}
export type SurveyCommittedClock = Readonly<{ startedAt: number; workDeadline: number; dispatchedAt: number; observedAt: number; contenderPending: boolean; poll: number }>
export function verifySurveyCommittedWitness(m: SurveyCommittedProofManifest, label: string, b: SurveyCommittedBootstrap, raw: unknown, clock: SurveyCommittedClock) {
  const s = schedule(m, label); backend(m, b)
  assert(Object.values(clock).every(v => typeof v === 'boolean' || Number.isFinite(v)))
  assert(clock.startedAt <= clock.dispatchedAt && clock.dispatchedAt <= clock.observedAt && clock.observedAt < clock.workDeadline)
  assert(clock.workDeadline - clock.startedAt <= m.caps.workMs && clock.observedAt - clock.dispatchedAt <= m.caps.observationMs)
  assert(Number.isInteger(clock.poll) && clock.poll >= 1 && clock.poll <= m.caps.polls)
  const r = raw as Record<string, unknown>; assert(r && r.label === label); assert.equal(r.poll, clock.poll); assert.equal(Date.parse(String(r.observedAt)), clock.observedAt)
  const normalize = (v: unknown) => { const a = v as Record<string, unknown>; return { ...a, started: new Date(String(a.started)).toISOString() } }
  assert(isDeepStrictEqual(normalize(r.holder), normalize(b.holder))); assert(isDeepStrictEqual(normalize(r.contender), normalize(b.contender)))
  // Private engine carriers must join this actual observer DTO with the sealed
  // original contender dispatch receipt. These shape/source checks never bind
  // that provenance or claim exact tuple/child-XID ownership.
  const dispatch=r.contenderDispatch as Record<string,unknown>;assert(dispatch)
  assert.deepEqual(Object.keys(dispatch).sort(),['backend','operationSha256','sqlSha256'])
  assert(isDeepStrictEqual(normalize(dispatch.backend),normalize(b.contender)))
  assert.equal(dispatch.sqlSha256,hash(s.frames.contender));assert.equal(dispatch.operationSha256,s.secondOperationSha256)
  const held = r.held as Record<string, unknown>; assert(held)
  assert.deepEqual(Object.keys(held).sort(),['backend','criterion','operation','operationFinishedAt','operationStartedAt','sourceSha256','transactionStartedAt'])
  assert.equal(held.criterion,'original-operation-and-owned-backend');assert(isDeepStrictEqual(normalize(held.backend),normalize(b.holder)))
  assert.equal(held.sourceSha256,s.firstOperationSha256)
  const transaction=Date.parse(String(held.transactionStartedAt)),operationStart=Date.parse(String(held.operationStartedAt)),operationEnd=Date.parse(String(held.operationFinishedAt))
  assert([transaction,operationStart,operationEnd].every(Number.isFinite))
  assert(Date.parse(b.holder.started)<=transaction&&transaction<=operationStart&&clock.startedAt<=operationStart&&operationStart<=operationEnd&&operationEnd<=clock.dispatchedAt,'Original holder transaction/operation window differs')
  const before=acceptedEffects.get(m)?.get(label)?.before??seedGraphs.get(m);assert(before,'Missing authenticated committed baseline')
  const firstRead=s.index<=7&&([1,5,6].includes(s.index)?s.direction==='reverse':s.direction==='forward')
  const firstRespond=s.index>=13||s.index>=8&&s.direction==='reverse'
  const result=firstRead?(s.index===5?aggregate(before,s.cohort):detail(before,s.cohort,[3,4].includes(s.index),m.actors[1].id)):firstRespond?{success:true,updated:false}:null
  assert(isDeepStrictEqual(held.operation,{code:null,result}),'Original successful holder operation differs')
  if (s.mode === 'wait') { assert(clock.contenderPending); assert.deepEqual(r.blockers, [b.holder.pid]); const w = r.waiter as Record<string, unknown>;
    assert(w && w.wait_event_type === 'Lock' && w.state === 'active'); assert.equal(w.wait_event, s.lock.kind === 'advisory' ? 'advisory' : 'transactionid') }
  else { assert(!clock.contenderPending); assert.deepEqual(r.blockers, []); assert.equal(r.waiter, null); assert.equal(r.code, 'PT409'); assert(typeof r.immediateMs === 'number' && r.immediateMs >= 0 && r.immediateMs < m.caps.observationMs) }
  return freeze({ label, heldBackendVerified: true, holderOperationVerified: true, contenderSourceMatches: true,
    blockingEdgeVerified: s.mode === 'wait', exactTupleOwnershipClaimed: false as const, nativeVerified: false as const })
}

function row(g: Graph, table: string, column: string, value: string) { const source = g[table]; assert(Array.isArray(source)); const rows = source.filter(r => r[column] === value); assert.equal(rows.length, 1, 'Exact committed row differs'); return rows[0] }
function put(g: Graph, table: string, column: string, value: string, replacement: Record<string, unknown> | null) {
  const rows = g[table]; assert(Array.isArray(rows)); const next = rows.filter(r => r[column] !== value); if (replacement) next.push(replacement); g[table] = next
}
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Non-JSON committed object')
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalValue((value as Record<string, unknown>)[k])]))
  }
  assert(value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value), 'Non-JSON committed value')
  return value
}
/** Native graphs retain all eight inspected tables in full. Every other table
 * has a complete ordered-row digest/count and exact collision-check identities.
 * Historical full-row CPU graphs remain supported, but formats cannot be mixed.
 * A catalog key is never inferred or dropped: equality compares every key. */
export function parseSurveyCommittedGraph(value: unknown): Graph {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid committed graph')
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  assert(Buffer.byteLength(JSON.stringify(value)) <= SURVEY_COMMITTED_CAPS.responseBytes)
  const g = value as Graph
  for (const table of FULL_TABLES) assert(Array.isArray(g[table]), 'Missing complete committed table')
  let format: 'rows' | 'witness' | undefined
  for (const [table, entry] of Object.entries(g)) {
    assert(/^(public|private|storage)\.[^\u0000]+$/.test(table), 'Invalid committed table key')
    if (Array.isArray(entry)) {
      for (const r of entry) { assert(r && typeof r === 'object' && !Array.isArray(r)); canonicalValue(r) }
      if (!(FULL_TABLES as readonly string[]).includes(table)) { assert(format !== 'witness', 'Mixed committed graph formats'); format = 'rows' }
    } else {
      assert(!(FULL_TABLES as readonly string[]).includes(table) && entry && typeof entry === 'object')
      assert.deepEqual(Object.keys(entry).sort(), ['count', 'identities', 'sha256'])
      assert(Number.isSafeInteger(entry.count) && entry.count >= 0)
      assert(typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256))
      assert(entry.identities && typeof entry.identities === 'object' && !Array.isArray(entry.identities))
      assert.deepEqual(Object.keys(entry.identities).sort(), [...IDENTITY_FIELDS].sort())
      for (const field of IDENTITY_FIELDS) {
        const ids = entry.identities[field]
        assert(Array.isArray(ids) && ids.length <= entry.count && ids.every(id => typeof id === 'string'))
        assert(isDeepStrictEqual(ids, [...ids].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))))
      }
      canonicalValue(entry)
      assert(format !== 'rows', 'Mixed committed graph formats'); format = 'witness'
    }
  }
  return g
}
function identities(g: Graph, fields: readonly typeof IDENTITY_FIELDS[number][]) {
  return Object.values(g).flatMap(entry => Array.isArray(entry)
    ? entry.flatMap(r => fields.flatMap(field => typeof r[field] === 'string' ? [String(r[field])] : []))
    : fields.flatMap(field => entry.identities[field]))
}
function canonical(g: Graph) {
  parseSurveyCommittedGraph(g)
  return Object.fromEntries(Object.keys(g).sort().map(t => {
    const entry = g[t]
    return [t, Array.isArray(entry) ? entry.map(r => JSON.stringify(canonicalValue(r))).sort() : canonicalValue(entry)]
  }))
}
/** Independent fixed defaults from006/058/081/108/112/128/147/150/205/222.
 * Only generated artifact/category UUIDs and168 Pal references are observed;
 * every relationship/value/counter/timestamp is specified independently. */
function expectedSeed(m: SurveyCommittedProofManifest, actual: Graph, timestamp: string): Graph {
  const g: Graph = { 'public.classrooms': [], 'public.classroom_archive_revisions': [], 'public.classroom_enrollments': [],
    'public.surveys': [], 'public.survey_questions': [], 'public.survey_responses': [], 'public.gradebook_categories': [], 'private.pal_membership_generations': [] }
  for (const s of m.schedules) { const c = s.cohort
    for (const [cid, owner, blueprint, archive] of [[c.classroomId,m.actors[0].id,5,15],[c.foreignClassroomId,m.actors[1].id,2,6]] as const) {
      g['public.classrooms'].push({ id: cid, teacher_id: owner, title: `surveynative_${m.projectId.slice(-12)}`, class_code: cid,
        term_label: null, created_at: timestamp, updated_at: timestamp, start_date: null, end_date: null, archived_at: null,
        position: 0, allow_enrollment: true, join_policy: 'roster', lesson_plan_visibility: 'current_week', theme_color: 'blue',
        source_blueprint_id: null, source_blueprint_origin: null, source_blueprint_version_id: null, authoring_guidance_version_id: null,
        actual_site_slug: null, actual_site_published: false, actual_site_config: { overview: true, outline: true, resources: true,
          assignments: true, tests: true, lesson_plans: true, announcements: true, lesson_plan_scope: 'current_week' },
        course_overview_markdown: '', course_outline_markdown: '', blueprint_source_revision: blueprint,
        manual_attendance_source_mode: 'manual', manual_attendance_revision: 1, manual_attendance_session_starts_local: null, manual_attendance_session_ends_local: null,
        feature_visibility: { attendance: true, classwork: true, tests: true, gradebook: true, student_grades: false, calendar: true, syllabus: true, announcements: true, achievements: true } })
      g['public.classroom_archive_revisions'].push({ classroom_id: cid, revision: archive, updated_at: timestamp })
      for (const [name, percentage, position, is_default] of [['Attendance',10,0,false],['Term',65,1,true],['Final',25,2,false]] as const) {
        const rows = actual['public.gradebook_categories'].filter(r => r.classroom_id === cid && r.name === name); assert.equal(rows.length,1)
        g['public.gradebook_categories'].push({ id: rows[0].id, classroom_id: cid, name, percentage, position, is_default,
          default_assessment_weight: 10, created_at: timestamp, updated_at: timestamp })
      }
    }
    for (const [eid, actor] of [[c.enrollmentId,m.actors[1].id],[c.readerEnrollmentId,m.actors[3].id]]) {
      g['public.classroom_enrollments'].push({ id: eid, classroom_id: c.classroomId, student_id: actor, created_at: timestamp, manual_attendance_marks: {} })
      g['private.pal_membership_generations'].push({ generation_id: eid, scope_digest: hash(`pika-membership-scope-v1:${c.classroomId}:${actor}`),
        pal_reference: row(actual,'private.pal_membership_generations','generation_id',eid).pal_reference, state: 'active' })
    }
    for (const [sid,cid,owner,position,dynamic] of [[c.surveyId,c.classroomId,m.actors[0].id,0,s.index===14],
      [c.foreignSurveyId,c.foreignClassroomId,m.actors[1].id,0,false],[c.resultSurveyId,c.classroomId,m.actors[0].id,1,false]] as const) {
      g['public.surveys'].push({ id:sid,classroom_id:cid,created_by:owner,position,dynamic_responses:dynamic,title:`surveynative_${m.projectId.slice(-12)}`,
        artifact_id:row(actual,'public.surveys','id',sid).artifact_id,source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null,
        status:'active',show_results:true,opens_at:null,created_at:timestamp,updated_at:timestamp })
    }
    g['public.survey_questions'].push(...[c.question,c.aggregateQuestion].map(r=>({...r,created_at:timestamp,updated_at:timestamp})))
    g['public.survey_responses'].push({id:c.aggregateResponseId,survey_id:c.resultSurveyId,question_id:c.aggregateQuestion.id,student_id:m.actors[1].id,
      selected_option:null,response_text:'Synthetic shared result',submitted_at:timestamp,updated_at:timestamp})
  }
  return g
}
export function verifySurveyCommittedSeed(m: SurveyCommittedProofManifest, rawBefore: unknown, rawAfter: unknown, times: {startedAt:string;endedAt:string;seedTimestamp:string}) {
  const before = parseSurveyCommittedGraph(rawBefore), after = parseSurveyCommittedGraph(rawAfter)
  assert(issued.has(m)); assert(!seedGraphs.has(m), 'Captured committed seed already authenticated')
  const st=Date.parse(times.seedTimestamp);assert(Date.parse(times.startedAt)<=st&&st<=Date.parse(times.endedAt))
  assert(Date.parse(times.endedAt)-Date.parse(times.startedAt)<=m.caps.workMs)
  assert(isDeepStrictEqual(Object.keys(before).sort(),Object.keys(after).sort()))
  const additions=expectedSeed(m,after,times.seedTimestamp),expected=structuredClone(before),freshIds:string[]=[],freshReferences:string[]=[]
  const priorIds=new Set(identities(before, IDENTITY_FIELDS))
  const priorReferences=new Set((before['private.pal_membership_generations']??[]).map(r=>r.pal_reference))
  for(const [table,rows] of Object.entries(additions)) {
    assert(Array.isArray(before[table]) && Array.isArray(rows)); for(const r of rows) {
      for(const field of ['id','artifact_id','generation_id']) if(typeof r[field]==='string') { const value=String(r[field]);assert(uuid.test(value)&&!priorIds.has(value));freshIds.push(value) }
      if(table==='private.pal_membership_generations') {assert(typeof r.pal_reference==='string'&&/^pika-membership-v1-[a-f0-9]{32}$/.test(r.pal_reference)&&!priorReferences.has(r.pal_reference));freshReferences.push(String(r.pal_reference))}
    }
    const target = expected[table];assert(Array.isArray(target) && Array.isArray(rows));target.push(...rows)
  }
  // Enrollment UUID is legitimately repeated once as its generation primary key.
  const enrollmentIds=new Set(additions['public.classroom_enrollments'].map(r=>r.id))
  assert.equal(freshIds.length-new Set(freshIds).size,enrollmentIds.size)
  assert.equal(new Set(freshReferences).size,freshReferences.length)
  assert(isDeepStrictEqual(canonical(expected),canonical(after)),'Exact committed seed/full non-target graph differs')
  seedGraphs.set(m,structuredClone(after))
  acceptedEffects.set(m,new Map())
  return freeze({seededClasses:60,seededSurveys:90,seededQuestions:60,seededResponses:30,seededEnrollments:60,freshGenerations:60,
    defaultGradebookCategories:180,mainArchiveRevision:15,foreignArchiveRevision:6,mainBlueprintRevision:5,foreignBlueprintRevision:2,nativeVerified:false as const})
}
function assertBaseline(m:SurveyCommittedProofManifest,before:Graph) {
  const seed=seedGraphs.get(m);assert(seed,'Missing validated captured seed graph')
  assert(isDeepStrictEqual(canonical(seed),canonical(before)),'Authenticated full committed baseline differs')
}
type Operation = Readonly<{code:string|null;result:unknown}>
function detail(g:Graph,c:Cohort,member:boolean,actor:string) {
  const cl=row(g,'public.classrooms','id',c.classroomId),survey=row(g,'public.surveys','id',c.surveyId)
  return {classroom:{id:cl.id,teacher_id:cl.teacher_id,archived_at:cl.archived_at},survey,
    questions:g['public.survey_questions'].filter(r=>r.survey_id===c.surveyId).sort((a,b)=>Number(a.position)-Number(b.position)||String(a.id).localeCompare(String(b.id))),
    responses:member?g['public.survey_responses'].filter(r=>r.survey_id===c.surveyId&&r.student_id===actor).sort((a,b)=>String(a.question_id).localeCompare(String(b.question_id))):[]}
}
function aggregate(g:Graph,c:Cohort) {
  const cl=row(g,'public.classrooms','id',c.classroomId),survey=row(g,'public.surveys','id',c.resultSurveyId)
  const question=row(g,'public.survey_questions','id',c.aggregateQuestion.id),response=row(g,'public.survey_responses','id',c.aggregateResponseId)
  return {classroom:{id:cl.id,teacher_id:cl.teacher_id,archived_at:cl.archived_at},survey:Object.fromEntries(['id','title','status','show_results','dynamic_responses'].map(k=>[k,survey[k]])),
    results:[{question_id:question.id,question_type:question.question_type,question_text:question.question_text,options:[],counts:[],total_responses:1,
      responses:[Object.fromEntries(['response_text','submitted_at','updated_at'].map(k=>[k,response[k]]).concat([['response_id',response.id]]))]}]}
}
export function verifySurveyCommittedEnvelopes(m:SurveyCommittedProofManifest,label:string,rawBefore:unknown,rawAfter:unknown,raw:{holder:Operation;contender:Operation;retry?:Operation;cachedQuestions:unknown;freshRead:Operation;cachedResponseProbe:Operation|null}) {
  const before=parseSurveyCommittedGraph(rawBefore),after=parseSurveyCommittedGraph(rawAfter)
  const s=schedule(m,label),c=s.cohort,accepted=acceptedEffects.get(m)?.get(label)
  assert(accepted,'Missing authenticated committed effects')
  assert(isDeepStrictEqual(canonical(accepted.before),canonical(before))&&isDeepStrictEqual(canonical(accepted.after),canonical(after)),'Authenticated envelope graphs differ')
  const readMember=[3,4].includes(s.index),readOwner=[0,1,2,6,7].includes(s.index),read=s.index===5?'aggregate':readMember?'member':readOwner?'owner':null
  const firstRead=read&&((s.index===1||s.index===5||s.index===6)?s.direction==='reverse':s.direction==='forward')
  const envelope=(g:Graph)=>read==='aggregate'?aggregate(g,c):detail(g,c,read==='member',m.actors[1].id)
  const success=(result:unknown):Operation=>({code:null,result}),denied=(code:string):Operation=>({code,result:null})
  const holderRespond=s.index>=13||s.index>=8&&s.direction==='reverse'
  assert(isDeepStrictEqual(raw.holder,success(firstRead?envelope(before):holderRespond?{success:true,updated:false}:null)),'Holder operation envelope differs')
  const secondRead=Boolean(read)&&!firstRead
  const contenderRespond=s.index>=13||s.index>=8&&s.direction==='forward'
  assert(isDeepStrictEqual(raw.contender,s.mode==='nowait'?denied('PT409'):success(secondRead?envelope(after):contenderRespond?{success:true,updated:false}:null)),'Contender operation envelope differs')
  if(s.mode==='nowait')assert(isDeepStrictEqual(raw.retry,s.retryCode?denied(s.retryCode):success(secondRead?envelope(after):contenderRespond?{success:true,updated:s.index===14}:null)),'Retry envelope differs')
  else assert.equal(raw.retry,undefined)
  assert(isDeepStrictEqual(raw.cachedQuestions,[row(before,'public.survey_questions','id',c.question.id)]),'Cached committed question source differs')
  const fresh=[2,3,4].includes(s.index)?denied('PT403'):success(s.index===5?aggregate(after,c):detail(after,c,![0,1,2,6,7].includes(s.index),m.actors[1].id))
  assert(isDeepStrictEqual(raw.freshRead,fresh),'Fresh committed read envelope differs')
  const probe=s.index>=8&&s.index<=11?'PT409':s.index===12||s.index===13?'PT400':null
  if(s.index>=8&&s.index<=11){
    const actor=m.actors[s.direction==='reverse'?3:1].id,enrollment=s.direction==='reverse'?c.readerEnrollmentId:c.enrollmentId
    const classroom=row(after,'public.classrooms','id',c.classroomId),survey=row(after,'public.surveys','id',c.surveyId)
    assert.notEqual(classroom.teacher_id,actor);assert.equal(classroom.archived_at,null)
    assert.equal(survey.status,'active');assert.equal(survey.opens_at,null);assert.equal(survey.dynamic_responses,false)
    const member=row(after,'public.classroom_enrollments','id',enrollment)
    assert.equal(member.classroom_id,c.classroomId);assert.equal(member.student_id,actor)
    for(const g of [before,after])assert(!g['public.survey_responses'].some(r=>r.survey_id===c.surveyId&&r.student_id===actor),'Stale probe actor already answered')
    assert(!isDeepStrictEqual(raw.cachedQuestions,after['public.survey_questions'].filter(r=>r.survey_id===c.surveyId)),'Stale probe questions unchanged')
  }
  assert(isDeepStrictEqual(raw.cachedResponseProbe,probe?denied(probe):null),'Cached response freshness probe differs')
  return freeze({label,cachedSourceVerified:true,operationEnvelopesVerified:true,freshReadVerified:true,nativeVerified:false as const})
}
export type SurveyCommittedArchiveReceipt = Readonly<{ label: string; classroomId: string; archivedAt: string; transactionTimestamp: string; operationStartedAt: string; operationFinishedAt: string }>
export type SurveyCommittedTimes = Readonly<{ startedAt: string; endedAt: string; writerTimestamp: string; responseTimestamp?: string; responseId?: string; responseSubmittedAt?: string; firstResponse?: Readonly<Record<string, unknown>>; archiveReceipt?: SurveyCommittedArchiveReceipt }>
/** Exact independent effect ledger; all catalog tables/rows must match the
 * captured seed advanced only by previously authenticated direction effects.
 * Accepted before/after pairs remain private for later envelope validation. */
export function verifySurveyCommittedEffects(m: SurveyCommittedProofManifest, label: string, rawBefore: unknown, rawAfter: unknown, times: SurveyCommittedTimes) {
  const before = parseSurveyCommittedGraph(rawBefore), after = parseSurveyCommittedGraph(rawAfter)
  const s = schedule(m, label), c = s.cohort, e = s.effects
  assertBaseline(m,before)
  const accepted=acceptedEffects.get(m);assert(accepted&&!accepted.has(label),'Committed direction effects already authenticated')
  const started = Date.parse(times.startedAt), ended = Date.parse(times.endedAt), written = Date.parse(times.writerTimestamp)
  assert(Number.isFinite(started) && Number.isFinite(ended) && Number.isFinite(written)); assert(started <= written && written <= ended && ended - started <= m.caps.workMs)
  assert(Buffer.byteLength(JSON.stringify(before)) <= m.caps.responseBytes && Buffer.byteLength(JSON.stringify(after)) <= m.caps.responseBytes)
  assert(isDeepStrictEqual(Object.keys(before).sort(), Object.keys(after).sort()))
  const expected = structuredClone(before)
  const classroom = row(before, 'public.classrooms', 'id', c.classroomId), survey = row(before, 'public.surveys', 'id', c.surveyId)
  assert.equal(classroom.teacher_id, m.actors[0].id); assert.equal(classroom.archived_at, null); assert.equal(survey.classroom_id, c.classroomId)
  assert.equal(survey.status, 'active'); assert.equal(survey.dynamic_responses, s.index === 14)
  const enrollment = row(before, 'public.classroom_enrollments', 'id', c.enrollmentId)
  assert.equal(enrollment.classroom_id, c.classroomId); assert.equal(enrollment.student_id, m.actors[1].id)
  const generation = row(before, 'private.pal_membership_generations', 'generation_id', c.enrollmentId)
  assert.equal(generation.state, 'active'); assert.equal(generation.scope_digest, c.scopeDigest)
  assert(typeof generation.pal_reference === 'string' && /^pika-membership-v1-[a-f0-9]{32}$/.test(generation.pal_reference))
  const question = row(before, 'public.survey_questions', 'id', c.question.id)
  assert(isDeepStrictEqual({ ...question, created_at: c.question.created_at, updated_at: c.question.updated_at }, c.question))
  assert.equal(before['public.survey_responses'].filter(r => r.survey_id === c.surveyId).length, 0)
  const stamp = (previous: unknown, value: string) => { assert(typeof previous === 'string' && Date.parse(previous) <= Date.parse(value)); return value }
  const bump = (cid: string, amount: number) => { if (!amount) return; const r = row(expected, 'public.classroom_archive_revisions', 'classroom_id', cid);
    assert(Number.isSafeInteger(r.revision)); put(expected, 'public.classroom_archive_revisions', 'classroom_id', cid, { ...r, revision: Number(r.revision) + amount, updated_at: stamp(r.updated_at, times.writerTimestamp) }) }
  if (Object.keys(e.questionPatch).length) { const patch = { ...e.questionPatch }; if (patch.survey_id === '__foreign') patch.survey_id = c.foreignSurveyId;
    put(expected, 'public.survey_questions', 'id', c.question.id, { ...question, ...patch, updated_at: stamp(question.updated_at, times.writerTimestamp) }) }
  if (e.blueprint || Object.keys(e.classroomPatch).length) { const patch = { ...e.classroomPatch };
    if (patch.teacher_id === '__member') patch.teacher_id = m.actors[1].id
    if (patch.archived_at === '__archive_receipt') {
      const receipt=times.archiveReceipt;assert(receipt,'Missing actual archive writer receipt')
      assert.deepEqual(Object.keys(receipt).sort(),['archivedAt','classroomId','label','operationFinishedAt','operationStartedAt','transactionTimestamp'])
      assert.equal(receipt.label,label);assert.equal(receipt.classroomId,c.classroomId);assert.equal(receipt.transactionTimestamp,times.writerTimestamp)
      const archiveTime=Date.parse(receipt.archivedAt),operationStart=Date.parse(receipt.operationStartedAt),operationEnd=Date.parse(receipt.operationFinishedAt)
      assert([archiveTime,operationStart,operationEnd].every(Number.isFinite))
      assert(started<=operationStart&&operationStart<=archiveTime&&archiveTime<=operationEnd&&operationEnd<=ended,'Archive clock receipt outside actual operation window')
      patch.archived_at=receipt.archivedAt
    }
    assert(Number.isSafeInteger(classroom.blueprint_source_revision)); put(expected, 'public.classrooms', 'id', c.classroomId,
      { ...classroom, ...patch, blueprint_source_revision: Number(classroom.blueprint_source_revision) + e.blueprint, updated_at: stamp(classroom.updated_at, times.writerTimestamp) }) }
  if (Object.keys(e.surveyPatch).length) put(expected, 'public.surveys', 'id', c.surveyId, { ...survey, ...e.surveyPatch, updated_at: stamp(survey.updated_at, times.writerTimestamp) })
  if (e.membershipRemoved) { put(expected, 'public.classroom_enrollments', 'id', c.enrollmentId, null);
    put(expected, 'private.pal_membership_generations', 'generation_id', c.enrollmentId, { ...generation, state: 'removed' }) }
  if (e.responseCount) { assert(times.responseId && uuid.test(times.responseId) && !m.allocatedIds.includes(times.responseId));
    assert(!identities(before, ['id']).includes(times.responseId)); assert(times.responseTimestamp && times.responseSubmittedAt);
    const rt = Date.parse(times.responseTimestamp), st = Date.parse(times.responseSubmittedAt); assert(started <= st && st <= rt && rt <= ended);
    const response = row(after, 'public.survey_responses', 'id', times.responseId)
    assert(isDeepStrictEqual(response, { id: times.responseId, survey_id: c.surveyId, question_id: c.question.id, student_id: m.actors[1].id,
      selected_option: null, response_text: 'Synthetic response', submitted_at: times.responseSubmittedAt, updated_at: times.responseTimestamp }))
    if (s.index === 14) { const first = times.firstResponse; assert(first, 'Missing actual first committed response witness');
      assert(isDeepStrictEqual({ ...response, updated_at: first.updated_at }, first)); assert.equal(first.updated_at, first.submitted_at)
      assert(typeof first.updated_at === 'string' && Date.parse(first.updated_at) <= rt)
    }
    expected['public.survey_responses'].push(response)
  }
  bump(c.classroomId, e.archive); bump(c.foreignClassroomId, e.foreignArchive)
  assert(isDeepStrictEqual(canonical(expected), canonical(after)), 'Survey exact terminal graph differs')
  accepted.set(label,{before:structuredClone(before),after:structuredClone(after)})
  seedGraphs.set(m,structuredClone(after))
  return freeze({ label, archiveRevisionDelta: e.archive, blueprintRevisionDelta: e.blueprint,
    foreignArchiveRevisionDelta: e.foreignArchive, membershipGenerationRemoved: e.membershipRemoved, responseCount: e.responseCount,
    fullGraphVerified: true, nativeVerified: false as const })
}
