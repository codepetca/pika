/** Inert, finite disposable measurements. Never normal/type/CI acceptance. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { testOwnerDigest } from './contextual-test-owner-detail-proof-fixture'
import { TEST_OWNER_REORDER_SOURCE_SHA256, testOwnerReorderDbContractsManifest, type TestOwnerReorderDbContractsManifest } from './contextual-test-reorder-db-contracts'
import { assertIssuedTestOwnerReorderFixture } from './contextual-test-reorder-proof-fixture'
import type { DraftSaveDriver, DraftSaveTarget } from './check-contextual-test-draft-save-db-contracts'

const q = (s: string) => `'${s.replaceAll("'", "''")}'`
const issued = new WeakSet<object>()
const kind = 'test-owner-reorder-diagnostic-not-acceptance' as const
// Historical 10k diagnosis is retained below with its original source identity.
// It cannot run against the owner-approved 1k operating contract.
export const TEST_OWNER_REORDER_HISTORICAL_DIAGNOSTIC_SOURCE_SHA256 = '71ed984850fdcf7205ddf9245f4dfc89dc8102caf3dcee0772104eb0f0e94006' as const
export function assertTestOwnerReorderDiagnosticAvailable() {
  throw new Error('Historical 10000-Test reorder diagnostic retired after approval of the 1000-Test contract')
}
const codes = ['PT400', 'PT403', 'PT404', 'PT409', 'PT503', 'PRD01', 'PRD02', 'PRD03', 'PRD04', 'PRD05', 'PRD06', 'PRD07'] as const
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }
function once(source: string, marker: string, replacement: string) {
  assert.equal(source.split(marker).length, 2, 'Diagnostic source anchor differs')
  return source.replace(marker, replacement)
}
export function captureTestOwnerReorderTimings(enabled: boolean) {
  let line = '', invalid = false, step = 0
  const values: number[] = []
  function consume() {
    if (line.includes('PDT')) {
      const match = /^(?:psql:<stdin>:[1-9]\d{0,6}: )?INFO:[ \t]+PDT0([1-3]) (0|[1-9]\d{0,15})\r?$/.exec(line)
      const value = Number(match?.[2])
      if (!match || Number(match[1]) !== step + 1 || !Number.isSafeInteger(value)
        || (step > 0 && (value < values[step - 1] || value - values[0] > 35000000))) invalid = true
      else { values.push(value); step++ }
    }
    line = ''
  }
  return Object.freeze({ push(chunk: Buffer | string) {
    if (!enabled || invalid) return
    for (const c of chunk.toString()) {
      if (c === '\n') consume()
      else if (c.charCodeAt(0) > 127 || line.length >= 128) { invalid = true; line = ''; return }
      else line += c
    }
  }, snapshot() { return Object.freeze({ beforeWorkUs: values.length ? 0 : null,
    beforeUpdateUs: values.length > 1 ? values[1] - values[0] : null,
    afterUpdateUs: values.length > 2 ? values[2] - values[0] : null, valid: !invalid }) } })
}
export type TestOwnerReorderTimings = ReturnType<ReturnType<typeof captureTestOwnerReorderTimings>['snapshot']>

export function buildTestOwnerReorderDiagnosticManifest(normal: TestOwnerReorderDbContractsManifest, repository: string) {
  assertTestOwnerReorderDiagnosticAvailable()
  assert(Object.isFrozen(normal) && normal.sourceSha256 === TEST_OWNER_REORDER_SOURCE_SHA256)
  assertIssuedTestOwnerReorderFixture(normal.fixture)
  const expected = testOwnerReorderDbContractsManifest(normal.fixture, normal.projectId, repository)
  assert(isDeepStrictEqual(normal, expected), 'Diagnostic requires exact source-owned contracts')
  const source = readFileSync(resolve(repository, 'supabase/migrations/253_contextual_test_owner_reorder.sql'), 'utf8')
  assert.equal(testOwnerDigest(source), TEST_OWNER_REORDER_SOURCE_SHA256)
  const start = source.indexOf('declare\n'), end = source.indexOf('$function$;', start)
  assert(start > 0 && end > start)
  const originalBody = source.slice(start, end)
  const update = originalBody.match(/  update public\.tests test set position = desired\.position\n[\s\S]*?and test\.position is distinct from desired\.position;/)?.[0]
  assert(update && originalBody.split(update).length === 2)
  const observation = (n: number) => `  -- diagnostic observation\n  raise info using errcode='PDT0${n}',message='PDT0${n} '||(pg_catalog.trunc(extract(epoch from pg_catalog.clock_timestamp())*1000000)::bigint)::text;\n`
  let copyBody = once(originalBody, '\nbegin\n', '\nbegin\n' + observation(1))
  copyBody = once(copyBody, update, observation(2) + update)
  // Preserve the original ROW_COUNT capture before evaluating any additional
  // diagnostic expression. The third observation follows this scalar capture.
  const rowCount = '  get diagnostics v_affected_count = row_count;\n'
  copyBody = once(copyBody, rowCount, rowCount + observation(3))
  assert.equal(copyBody.replace(/^  -- diagnostic observation\n  raise info[^\n]*\n/gm, ''), originalBody)
  const copy = `create function pg_temp.reorder_tests_for_owner_diagnostic_v1(p_actor_id uuid,p_classroom_id uuid,p_test_ids uuid[],p_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $function$\n${copyBody}$function$;`
  const copyAcl = 'revoke all on function pg_temp.reorder_tests_for_owner_diagnostic_v1(uuid,uuid,uuid[],timestamptz) from public,anon,authenticated,service_role;'
  const bulk = normal.contracts.find(b => b.name === 'bulk-10000'); assert(bulk)
  const catalog = normal.contracts.find(b => b.name === 'catalog')?.sql.match(/do \$catalog\$[\s\S]*?\$catalog\$;/)?.[0]; assert(catalog)
  const c = normal.fixture.cases.find(c => c.label === 'bulk-10000'); assert(c)
  const ids = `(select array_agg(test.id order by test.position,test.id) from public.tests test where test.classroom_id=${q(c.classroomId)}::uuid)`
  const candidate = 'EXPLAIN (FORMAT JSON) ' + update.trim().replaceAll('p_test_ids', '$1').replaceAll('p_classroom_id', '$2').replaceAll('v_count', '$3')
  const prefix = bulk.sql.slice(0, bulk.sql.indexOf(' create temp table owner_reorder_checks'))
  const probe = bulk.sql.match(/do \$probe\$[\s\S]*?end;\$probe\$;/)?.[0]; assert(probe)
  const baseline = bulk.sql.slice(bulk.sql.indexOf(' create temp table owner_reorder_checks'), bulk.sql.indexOf(probe))
  const plan = `${prefix}\n${catalog}\n${baseline}\ndo $plan$ declare ids uuid[];p jsonb;begin ids:=${ids};
 if cardinality(ids)<>10000 then raise exception 'Diagnostic dense input differs';end if;
 execute ${q(candidate)} into p using ids,${q(c.classroomId)}::uuid,10000::bigint;
 if octet_length(p::text)>1048576 then raise exception 'Diagnostic plan exceeds cap';end if;
 raise info 'Diagnostic candidate plan captured';
 create temp table owner_reorder_candidate_plan(value jsonb) on commit drop;insert into owner_reorder_candidate_plan values(p);
 end;$plan$;
 do $equal$ begin if(select value from owner_reorder_baseline) is distinct from pg_temp.owner_reorder_graph() then raise exception 'Diagnostic plan graph differs';end if;end;$equal$;
 select jsonb_build_object('kind',${q(kind)},'plan',(select value from owner_reorder_candidate_plan));rollback;`
  // Reuse every normal bulk witness/effect/rollback assertion. Only the called
  // routine is the measured copy. Catch failure OUTSIDE the original probe's
  // subtransaction; failed copies must leave the complete baseline unchanged.
  // Capture only the RPC's fixed denial codes. P0001 witness/effect/rollback
  // assertions and unexpected errors must abort the diagnostic, not become a
  // successful failed-copy measurement after outer-subtransaction rollback.
  const diagnosticProbe = once(probe, 'r:=public.reorder_tests_for_owner_v1(', 'r:=pg_temp.reorder_tests_for_owner_diagnostic_v1(')
  let execution = once(bulk.sql, probe, `do $measure$ declare code text;begin begin ${diagnosticProbe}
 insert into owner_reorder_diagnostic_outcome values('returned','none');
 exception when ${codes.map(code => `sqlstate ${q(code)}`).join(' or ')} then get stacked diagnostics code=returned_sqlstate;
 insert into owner_reorder_diagnostic_outcome values('failed',code);
 end;end;$measure$;`)
  execution = once(execution, ' create temp table owner_reorder_checks', `\n${catalog}\n${copy}\n${copyAcl}\ncreate temp table owner_reorder_diagnostic_outcome(outcome text,code text) on commit drop;\n create temp table owner_reorder_checks`)
  // All 10k initial positions must change. This check is outside the measured
  // invocation and does not spend its SQL phase budget or mutate the fixture.
  const denseCheck = `do $dense$ begin if cardinality(${ids})<>10000 or(select count(*) from public.tests t join unnest(${ids}) with ordinality d(id,ordinality) on t.id=d.id
 where t.classroom_id=${q(c.classroomId)}::uuid and t.position is distinct from (10000-d.ordinality)::integer)<>10000
 then raise exception 'Diagnostic dense changes differ';end if;end;$dense$;\n`
  execution = once(execution, 'do $measure$ declare code text;', denseCheck + 'do $measure$ declare code text;')
  execution = once(execution, "if(select count(*) from pg_temp.owner_reorder_checks)<>1", "if(select count(*) from pg_temp.owner_reorder_checks)<>case when(select outcome from owner_reorder_diagnostic_outcome)='returned' then 1 else 0 end")
  const result = execution.match(/ select jsonb_build_object\('version',1,'batch','bulk-10000',[\s\S]*? as result;rollback;/)?.[0]; assert(result)
  execution = once(execution, result, ` select jsonb_build_object('kind',${q(kind)},'outcome',(select outcome from owner_reorder_diagnostic_outcome),
 'sqlstate',(select code from owner_reorder_diagnostic_outcome),'rolledBack',true,
 'checks',(select jsonb_agg(label order by label) from pg_temp.owner_reorder_checks));rollback;`)
  const frames = [{ name: 'candidate-plan', sql: plan }, { name: 'measured-copy', sql: execution }] as const
  frames.forEach(f => assert(Buffer.byteLength(f.sql) <= normal.caps.sqlBytes))
  const content = { kind, diagnosticOnly: true as const, sourceSha256: normal.sourceSha256, projectId: normal.projectId,
    originalBody, copyBody, frames, caps: normal.caps }
  const manifest = freeze({ ...content, manifestSha256: testOwnerDigest(JSON.stringify(content)) })
  issued.add(manifest); return manifest
}
export type TestOwnerReorderDiagnosticManifest = ReturnType<typeof buildTestOwnerReorderDiagnosticManifest>
export function validateTestOwnerReorderDiagnosticSql(m: TestOwnerReorderDiagnosticManifest, sql: string) {
  return issued.has(m) && m.frames.some(f => f.sql === sql) && Buffer.byteLength(sql) <= m.caps.sqlBytes
}
const nodeTypes = ['ModifyTable', 'Nested Loop', 'Hash Join', 'Merge Join', 'Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan',
  'Bitmap Index Scan', 'Function Scan', 'Hash', 'Sort', 'Materialize', 'Memoize', 'Result', 'Aggregate', 'Gather', 'Gather Merge'] as const
function summarizePlan(plan: unknown) {
  assert(Array.isArray(plan) && plan.length === 1 && plan[0] && typeof plan[0] === 'object')
  const counts: Partial<Record<typeof nodeTypes[number] | 'Other', number>> = {}; let seen = 0
  function visit(node: unknown, depth: number) {
    assert(depth <= 32 && ++seen <= 256 && node && typeof node === 'object' && !Array.isArray(node))
    const r = node as Record<string, unknown>; assert(typeof r['Node Type'] === 'string')
    const key = nodeTypes.find(n => n === r['Node Type']) ?? 'Other'; counts[key] = (counts[key] ?? 0) + 1
    if (r.Plans !== undefined) { assert(Array.isArray(r.Plans)); r.Plans.forEach(child => visit(child, depth + 1)) }
  }
  assert(Buffer.byteLength(JSON.stringify(plan)) <= 1048576); visit((plan[0] as Record<string, unknown>).Plan, 0)
  return { candidatePlanSha256: testOwnerDigest(JSON.stringify(plan)), fixedNodeCounts: freeze(counts) }
}
export type TestOwnerReorderDiagnosticMeasurement = Readonly<{ candidatePlanSha256: string;
  fixedNodeCounts: Readonly<Partial<Record<typeof nodeTypes[number] | 'Other', number>>>;
  outcome: 'returned' | 'failed'; sqlstate: string; timings: TestOwnerReorderTimings }>
export type TestOwnerReorderDiagnosticReceipt = Readonly<{ kind: typeof kind; diagnosticOnly: true;
  measurement: TestOwnerReorderDiagnosticMeasurement; fixtureUnchanged: true; manifestSha256: string;
  controls: number; actions: number; exchangeBytes: number; remainingSessions: 0 }>
function record(value: unknown, keys: string[]) {
  assert(value && typeof value === 'object' && !Array.isArray(value)); const r = value as Record<string, unknown>
  assert.deepEqual(Object.keys(r).sort(), [...keys].sort()); return r
}
function integer(value: unknown, maximum: number) { assert(Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum) }
export function validateTestOwnerReorderDiagnosticMeasurement(value: unknown): asserts value is TestOwnerReorderDiagnosticMeasurement {
  const r = record(value, ['candidatePlanSha256', 'fixedNodeCounts', 'outcome', 'sqlstate', 'timings'])
  assert(Object.isFrozen(value)); assert(typeof r.candidatePlanSha256 === 'string'); assert.match(r.candidatePlanSha256, /^[a-f0-9]{64}$/)
  assert(r.outcome === 'returned' || r.outcome === 'failed'); assert(typeof r.sqlstate === 'string')
  assert(r.outcome === 'returned' ? r.sqlstate === 'none' : r.sqlstate === 'unknown' || codes.some(c => c === r.sqlstate))
  assert(r.fixedNodeCounts && typeof r.fixedNodeCounts === 'object' && !Array.isArray(r.fixedNodeCounts) && Object.isFrozen(r.fixedNodeCounts))
  let total = 0
  for (const [key, n] of Object.entries(r.fixedNodeCounts)) {
    assert(key === 'Other' || nodeTypes.some(t => t === key)); integer(n, 256); assert(Number(n) > 0); total += Number(n)
  }
  assert(total > 0 && total <= 256)
  const t = record(r.timings, ['beforeWorkUs', 'beforeUpdateUs', 'afterUpdateUs', 'valid'])
  assert(Object.isFrozen(r.timings)); assert.equal(t.beforeWorkUs, 0); assert.equal(t.valid, true)
  for (const key of ['beforeUpdateUs', 'afterUpdateUs']) if (t[key] !== null) integer(t[key], 35000000)
  if (t.afterUpdateUs !== null) assert(t.beforeUpdateUs !== null && Number(t.afterUpdateUs) >= Number(t.beforeUpdateUs))
  if (r.outcome === 'returned') assert(t.beforeUpdateUs !== null && t.afterUpdateUs !== null)
}
export function validateTestOwnerReorderDiagnosticReceipt(value: unknown,
  nativeManifest: { capabilities: { actions: number; controlCalls: number; totalBytes: number } }): asserts value is TestOwnerReorderDiagnosticReceipt {
  assert(Object.isFrozen(nativeManifest)); assert.equal(nativeManifest.capabilities.actions, 200)
  assert.equal(nativeManifest.capabilities.controlCalls, 4000); assert.equal(nativeManifest.capabilities.totalBytes, 67108864)
  const r = record(value, ['kind', 'diagnosticOnly', 'measurement', 'fixtureUnchanged', 'manifestSha256', 'controls', 'actions', 'exchangeBytes', 'remainingSessions'])
  assert(Object.isFrozen(value)); assert.equal(r.kind, kind); assert.equal(r.diagnosticOnly, true); assert.equal(r.fixtureUnchanged, true)
  assert.equal(r.remainingSessions, 0); assert.equal(r.manifestSha256, testOwnerDigest(JSON.stringify(nativeManifest)))
  integer(r.controls, nativeManifest.capabilities.controlCalls); integer(r.actions, nativeManifest.capabilities.actions)
  integer(r.exchangeBytes, nativeManifest.capabilities.totalBytes); assert(Number(r.actions) >= 5)
  validateTestOwnerReorderDiagnosticMeasurement(r.measurement)
}
export async function runTestOwnerReorderDiagnostic(m: TestOwnerReorderDiagnosticManifest, target: DraftSaveTarget,
  driver: DraftSaveDriver, absoluteDeadline: number) {
  const remaining = () => { const n = absoluteDeadline - Date.now(); assert(Number.isSafeInteger(absoluteDeadline) && n > 0 && n <= 900000); return n }
  remaining(); assert(issued.has(m)); assert(Object.isFrozen(target)); assert.equal(target.projectId, m.projectId)
  assert.equal(target.containerProjectLabel, m.projectId); assert.equal(target.disposable, true)
  assert.equal(target.apiUrl, 'http://127.0.0.1:54331'); assert.equal(target.databaseHost, '127.0.0.1'); assert.equal(target.databasePort, 54332)
  assert.match(target.containerId, /^[a-f0-9]{64}$/); assert.match(target.reviewedHead, /^[a-f0-9]{40}$/)
  assert.match(target.migrationManifestSha256, /^[a-f0-9]{64}$/); assert.equal(target.reviewedSourceSha256, m.sourceSha256)
  assert.equal(target.acceptedManifestSha256, m.manifestSha256)
  assert.deepEqual(await driver.verifyTarget(), target); remaining()
  const session = await driver.openSession(m.projectId + '_draft_contracts')
  try {
    assert.equal(session.name, m.projectId + '_draft_contracts')
    const planRows = await session.execute(m.frames[0].sql, Math.min(m.caps.actionMs, remaining()))
    assert.equal(planRows.length, 1); const p = planRows[0].result as Record<string, unknown>
    assert(p && typeof p === 'object'); assert.deepEqual(Object.keys(p).sort(), ['kind', 'plan']); assert.equal(p.kind, kind)
    assert(Buffer.byteLength(JSON.stringify(planRows)) <= m.caps.responseBytes)
    const summary = summarizePlan(p.plan)
    assert.deepEqual(await driver.verifyTarget(), target); remaining()
    const rows = await session.execute(m.frames[1].sql, Math.min(m.caps.actionMs, remaining()))
    assert.equal(rows.length, 1); const r = rows[0].result as Record<string, unknown>
    assert(r && typeof r === 'object'); assert.deepEqual(Object.keys(r).sort(), ['checks', 'kind', 'outcome', 'rolledBack', 'sqlstate'])
    assert(Buffer.byteLength(JSON.stringify(rows)) <= m.caps.responseBytes)
    assert.equal(r.kind, kind); assert.equal(r.rolledBack, true)
    assert(r.outcome === 'returned' || r.outcome === 'failed')
    assert.deepEqual(r.checks, r.outcome === 'returned' ? ['bulk-10000', 'final-fixture-equality'] : ['final-fixture-equality'])
    assert(typeof r.sqlstate === 'string'); assert(r.outcome === 'returned' ? r.sqlstate === 'none' : r.sqlstate === 'unknown' || codes.some(c => c === r.sqlstate))
    remaining(); return freeze({ ...summary, outcome: r.outcome, sqlstate: r.sqlstate })
  } finally { await session.rollbackAndClose(m.caps.requestMs) }
}
