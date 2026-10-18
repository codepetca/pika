/** Inert Survey cancellation SQL proposal. No IO, executor, admission, callback,
 * request dispatch, deadline renewal or native provenance is supplied here. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { newSurveyNativeFixture, SURVEY_NATIVE_SOURCES, type SurveyNativeFixture } from './contextual-surveys-native-contracts'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { surveyCommittedProofManifest } from './contextual-surveys-committed-proof'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
const issued = new WeakSet<object>()
export const SURVEY_CANCELLATION_CAPS = Object.freeze({ sqlBytes: 262144, responseBytes: 8388608,
  requestBytes: 4096, sleepSeconds: 9, minimumElapsedMs: 7500, maximumElapsedMs: 12000,
  observerPolls: 3, observationMs: 750, nativeActions: 200, nativeControls: 4000,
  nativeSessions: 2, totalBytes: 67108864, sdkRequests: 16, workMs: 720000, cleanupMs: 180000 })
/** New human-approved remaining269 allowance, inert until full inventory/review.
 * Existing cancellation/component/legacy execution profiles are not widened. */
export const SURVEY_269_REMAINING_CANDIDATE_CAPS = Object.freeze({ ...SURVEY_CANCELLATION_CAPS,
  nativeControls:6000,sdkMs:60000,observerFrames:14,cleanupReserve:218 })

function fixture(f: SurveyNativeFixture) {
  assert(Object.isFrozen(f)); assert.match(f.tag, /^surveynative_[a-f0-9]{12}$/)
  const original = { manifest: { syntheticTag: `assignmentlist_${f.tag.slice(-12)}` }, allocatedIds: [] } as unknown as AssignmentListProofFixture
  assert(isDeepStrictEqual(f, newSurveyNativeFixture(original)), 'Survey cancellation fixture differs')
}
function guard(f: SurveyNativeFixture) {
  const source = testOwnerGuardSql(f.projectId)
  const prefix = "begin read only;set local lock_timeout='3s';set local statement_timeout='30s';"
  const terminal = "end;$guard$;select 'ok';rollback;"
  assert(source.startsWith(prefix) && source.endsWith(terminal))
  // Future fixed frames use the existing fixture identity; no selector is added.
  return source.slice(prefix.length, -terminal.length) + 'end;$guard$;'
}

export function surveyCancellationProofDescriptor(f: SurveyNativeFixture) {
  fixture(f)
  const name = `${f.tag}_cancel`, fn = `private.${name}`, baseline = `private.${name}_baseline`
  const marker = `survey_cancel_${f.tag.slice(-12)}_${hash(f.question.id).slice(0, 12)}`
  assert(marker.length < 64 && name.length < 64 && `${name}_baseline`.length < 64)
  const request = freeze({ origin: 'http://127.0.0.1:54331', path: '/rest/v1/rpc/respond_to_survey_for_member_v1', method: 'POST' as const,
    body: { p_actor_id: f.actors[1].id, p_survey_id: f.surveys[0].id, p_classroom_id: f.classes[0].id,
      p_expected_questions: [f.question], p_responses: { [f.question.id]: { question_type: 'short_text', response_text: 'Synthetic cancellation response' } } } })
  const body = `begin
 if tg_op<>'INSERT' or tg_table_schema<>'public' or tg_table_name<>'survey_responses' then raise exception 'Survey cancellation trigger context differs';end if;
 if new.survey_id is distinct from ${q(f.surveys[0].id)}::uuid or new.question_id is distinct from ${q(f.question.id)}::uuid
 or new.student_id is distinct from ${q(f.actors[1].id)}::uuid then return new;end if;
 if session_user<>'authenticator' then raise exception 'Survey cancellation session user differs';end if;
 perform pg_catalog.set_config('application_name',${q(marker)},true);
 perform pg_catalog.pg_sleep(9);return new;end;`
  const binding = freeze({ version: 1, projectId: f.projectId, fixtureSha256: hash(JSON.stringify(f)),
    migrationSha256: SURVEY_NATIVE_SOURCES.migration.sha256, functionBodySha256: hash(body),
    requestSha256: hash(JSON.stringify(request)), marker, postgrestSessionUser: 'authenticator' as const })
  const descriptorSha256 = hash(JSON.stringify(binding))
  const checkGuard = guard(f)
  const begin = `begin;set local timezone='UTC';set local lock_timeout='1s';set local statement_timeout='8s';${checkGuard}`
  // Only our exact instrumentation is excluded while it exists. Other tables,
  // overloads, triggers and all full-row values remain in the complete baseline.
  const stateFunction = `create or replace function pg_temp.survey_cancel_state() returns jsonb language plpgsql as $state$
 declare relation_row record;row_values jsonb;graph jsonb:='{}'::jsonb;catalog jsonb;begin
 for relation_row in select n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','private','storage') and c.oid is distinct from to_regclass(${q(baseline)})
 order by n.nspname,c.relname loop
 execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from %I.%I r',relation_row.nspname,relation_row.relname) into row_values;
 graph:=graph||jsonb_build_object(relation_row.nspname||'.'||relation_row.relname,row_values);end loop;
 select jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_functiondef(p.oid),p.proowner,p.proacl) order by p.oid),'[]'::jsonb)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','storage') and p.prokind in ('f','p') and p.oid is distinct from to_regprocedure(${q(fn + '()')})),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(pg_get_triggerdef(tr.oid),tr.tgenabled) order by tr.oid),'[]'::jsonb)
 from pg_trigger tr join pg_class c on c.oid=tr.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage')
 and not (tr.tgname=${q(name)} and tr.tgrelid='public.survey_responses'::regclass and tr.tgfoid=coalesce(to_regprocedure(${q(fn + '()')})::oid,0))),
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.oid),'[]'::jsonb)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','p','v','m','f','S') and c.oid is distinct from to_regclass(${q(baseline)})),
 'columns',(select coalesce(jsonb_agg(jsonb_build_array(c.oid,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(ad.adbin,ad.adrelid)) order by c.oid,a.attnum),'[]'::jsonb)
 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum
 where n.nspname in ('public','private','storage') and c.relkind in ('r','p','v','m','f','S') and a.attnum>0 and not a.attisdropped and c.oid is distinct from to_regclass(${q(baseline)})),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(con.oid,con.conname,pg_get_constraintdef(con.oid),con.convalidated) order by con.oid),'[]'::jsonb)
 from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.oid is distinct from to_regclass(${q(baseline)})),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) order by i.indexrelid),'[]'::jsonb)
 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.oid is distinct from to_regclass(${q(baseline)})),
 'policies',(select coalesce(jsonb_agg(to_jsonb(pol) order by pol.oid),'[]'::jsonb) from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','private','storage') and c.oid is distinct from to_regclass(${q(baseline)})),
 'roleSettings',(select coalesce(jsonb_agg(to_jsonb(s) order by s.setdatabase,s.setrole),'[]'::jsonb) from pg_db_role_setting s),
 'cron',(select coalesce(jsonb_agg(to_jsonb(j) order by j.jobid),'[]'::jsonb) from cron.job j)) into catalog;
 return jsonb_build_object('rows',graph,'catalog',catalog);end;$state$;`
  const installed = `do $installed$ declare function_row pg_proc;trigger_row pg_trigger;begin
 select p.* into strict function_row from pg_proc p where p.oid=${q(fn + '()')}::regprocedure;
 if function_row.proowner<>'postgres'::regrole or function_row.prosecdef or function_row.prosrc is distinct from ${q(body)}
 or function_row.prorettype<>'trigger'::regtype or function_row.prolang<>(select oid from pg_language where lanname='plpgsql')
 or function_row.proconfig is distinct from array['search_path=""']::text[] or function_row.provolatile<>'v' or function_row.pronargs<>0
 or (select count(*) from aclexplode(function_row.proacl))<>1 or exists(select 1 from aclexplode(function_row.proacl) a where a.grantee<>'postgres'::regrole or a.grantor<>'postgres'::regrole or a.privilege_type<>'EXECUTE' or a.is_grantable)
 then raise exception 'Survey cancellation function differs';end if;
 select tr.* into strict trigger_row from pg_trigger tr where tr.tgrelid='public.survey_responses'::regclass and tr.tgname=${q(name)};
 if trigger_row.tgfoid<>function_row.oid or trigger_row.tgtype<>7 or trigger_row.tgenabled<>'O' or trigger_row.tgisinternal
 or trigger_row.tgqual is not null or trigger_row.tgnargs<>0 or trigger_row.tgargs<>''::bytea or trigger_row.tgattr<>''::int2vector
 or trigger_row.tgconstraint<>0 or trigger_row.tgdeferrable or trigger_row.tginitdeferred or trigger_row.tgparentid<>0
 then raise exception 'Survey cancellation trigger differs';end if;end;$installed$;`
  const tableCheck = `if (select count(*) from ${baseline})<>1 or not exists(select 1 from ${baseline} where singleton and descriptor_sha256=${q(descriptorSha256)})
 or not exists(select 1 from pg_class where oid=${q(baseline)}::regclass and relowner='postgres'::regrole and relkind='r' and not relrowsecurity and not relforcerowsecurity)
 or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid=${q(baseline)}::regclass and a.grantee<>'postgres'::regrole)
 then raise exception 'Survey cancellation baseline differs';end if;`
  const absent = `if to_regclass(${q(baseline)}) is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=${q(name)})
 or exists(select 1 from pg_trigger tr where tr.tgname=${q(name)})
 or exists(select 1 from pg_stat_activity where application_name=${q(marker)}) then raise exception 'Survey cancellation namespace occupied';end if;`
  const prepare = `${begin}${stateFunction}
 do $absent$ begin ${absent}
 if not exists(select 1 from public.surveys where id=${q(f.surveys[0].id)} and classroom_id=${q(f.classes[0].id)} and status='active' and (opens_at is null or opens_at<=clock_timestamp()))
 or not exists(select 1 from public.classrooms where id=${q(f.classes[0].id)} and teacher_id=${q(f.actors[0].id)} and archived_at is null)
 or not exists(select 1 from public.classroom_enrollments where id=${q(f.enrollments[1].id)} and classroom_id=${q(f.classes[0].id)} and student_id=${q(f.actors[1].id)})
 or (select jsonb_agg(to_jsonb(r) order by position,id) from public.survey_questions r where survey_id=${q(f.surveys[0].id)}) is distinct from ${q(JSON.stringify([f.question]))}::jsonb
 or exists(select 1 from public.survey_responses where survey_id=${q(f.surveys[0].id)} and student_id=${q(f.actors[1].id)}) then raise exception 'Survey cancellation primary fixture differs';end if;end;$absent$;
 create temporary table survey_cancel_prepare(state jsonb not null) on commit drop;
 insert into survey_cancel_prepare values(pg_temp.survey_cancel_state());
 create table ${baseline}(singleton boolean primary key check(singleton),descriptor_sha256 text not null,state jsonb not null,installed jsonb not null,prepared_at timestamptz not null,pending jsonb);
 revoke all on table ${baseline} from public,anon,authenticated,service_role;
 create function ${fn}() returns trigger language plpgsql security invoker set search_path='' as $fault$${body}$fault$;
 revoke all on function ${fn}() from public,anon,authenticated,service_role;
 -- Exact row restriction lives in the independently checked body; all other
 -- rows return NEW immediately, without a marker, delay or data alteration.
 create trigger ${name} before insert on public.survey_responses for each row execute function ${fn}();
 ${installed}
 insert into ${baseline} select true,${q(descriptorSha256)},state,
 jsonb_build_object('functionOid',${q(fn + '()')}::regprocedure::oid,'triggerOid',(select oid from pg_trigger where tgrelid='public.survey_responses'::regclass and tgname=${q(name)}),
 'functionDefinition',pg_get_functiondef(${q(fn + '()')}::regprocedure),'functionAcl',(select proacl from pg_proc where oid=${q(fn + '()')}::regprocedure),
 'triggerDefinition',(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.survey_responses'::regclass and tgname=${q(name)})),clock_timestamp(),null from survey_cancel_prepare;
 do $baseline$ begin ${tableCheck}
 if pg_temp.survey_cancel_state() is distinct from (select state from ${baseline}) then raise exception 'Survey cancellation installation changed baseline';end if;end;$baseline$;
 commit;
 select jsonb_build_object('stage','prepared','descriptorSha256',descriptor_sha256,'stateSha256',encode(sha256(convert_to(state::text,'UTF8')),'hex'),
 'catalogSha256',encode(sha256(convert_to((state->'catalog')::text,'UTF8')),'hex'),'preparedAt',prepared_at,'nativeVerified',false) as result from ${baseline};`
  const observer = `${begin}
 do $observe$ declare observed jsonb;matches integer;poll integer;started timestamptz:=clock_timestamp();begin ${tableCheck}
 if (select pending is not null from ${baseline}) then raise exception 'Survey cancellation observation already stored';end if;
 for poll in 1..3 loop
 if clock_timestamp()-started>interval '750 milliseconds' then raise exception 'Survey cancellation observation deadline';end if;
 perform pg_stat_clear_snapshot();
 select count(*),jsonb_agg(jsonb_build_object('pid',a.pid,'started',a.backend_start,'database',a.datname,'sessionUser',a.usename,'name',a.application_name,
 'state',a.state,'waitType',a.wait_event_type,'waitEvent',a.wait_event,'transactionStartedAt',a.xact_start,'queryStartedAt',a.query_start,'observedAt',clock_timestamp(),'poll',poll))->0
 into matches,observed from pg_stat_activity a where a.application_name=${q(marker)} and a.backend_type='client backend';
 exit when matches=1 and observed->>'database'='postgres' and observed->>'sessionUser'='authenticator' and observed->>'state'='active'
 and observed->>'waitType'='Timeout' and observed->>'waitEvent'='PgSleep';end loop;
 if matches<>1 or observed->>'database' is distinct from 'postgres' or observed->>'sessionUser' is distinct from 'authenticator' or observed->>'state' is distinct from 'active'
 or observed->>'waitType' is distinct from 'Timeout' or observed->>'waitEvent' is distinct from 'PgSleep'
 or observed->>'started' is null or observed->>'transactionStartedAt' is null or observed->>'queryStartedAt' is null or observed->>'observedAt' is null
 or (observed->>'started')::timestamptz>(observed->>'transactionStartedAt')::timestamptz
 or (observed->>'transactionStartedAt')::timestamptz<(select prepared_at from ${baseline})
 or (observed->>'queryStartedAt')::timestamptz<(observed->>'transactionStartedAt')::timestamptz
 or (observed->>'observedAt')::timestamptz<(observed->>'queryStartedAt')::timestamptz
 then raise exception 'Survey cancellation original backend not observed';end if;
 if clock_timestamp()-started>interval '750 milliseconds' then raise exception 'Survey cancellation observation deadline';end if;
 update ${baseline} set pending=observed where singleton and pending is null;
 end;$observe$;commit;
 select jsonb_build_object('stage','pending','descriptorSha256',descriptor_sha256,'backend',pending,'nativeVerified',false) as result from ${baseline};`
  const restore = (dispatched: boolean) => `${begin}${stateFunction}
 create temporary table survey_cancel_restored(result jsonb not null) on commit preserve rows;
 do $restore$ declare captured jsonb;pending_backend jsonb;saved_installed jsonb;begin
 if to_regclass(${q(baseline)}) is null then
 if to_regprocedure(${q(fn + '()')}) is not null or exists(select 1 from pg_trigger where tgname=${q(name)}) or exists(select 1 from pg_stat_activity where application_name=${q(marker)}) then raise exception 'Survey cancellation orphan instrumentation';end if;
 insert into survey_cancel_restored values(jsonb_build_object('stage','absent-unverified','descriptorSha256',${q(descriptorSha256)},'nativeVerified',false));return;end if;
 ${tableCheck}
 select state,pending,installed into strict captured,pending_backend,saved_installed from ${baseline};
 ${dispatched ? `if pending_backend is null then raise exception 'Survey cancellation dispatched backend ownership absent';end if;
 perform pg_stat_clear_snapshot();
 if exists(select 1 from pg_stat_activity where pid=(pending_backend->>'pid')::integer and backend_start=(pending_backend->>'started')::timestamptz
 and (datname is distinct from 'postgres' or usename is distinct from 'authenticator' or state is distinct from 'idle' or xact_start is not null or wait_event_type='Timeout' and wait_event='PgSleep'))
 then raise exception 'Survey cancellation owned backend not settled';end if;` : `if pending_backend is not null then raise exception 'Survey cancellation before-dispatch state differs';end if;`}
 if exists(select 1 from pg_stat_activity where application_name=${q(marker)}) then raise exception 'Survey cancellation tagged backend remains';end if;
 ${installed}
 if saved_installed is distinct from jsonb_build_object('functionOid',${q(fn + '()')}::regprocedure::oid,'triggerOid',(select oid from pg_trigger where tgrelid='public.survey_responses'::regclass and tgname=${q(name)}),
 'functionDefinition',pg_get_functiondef(${q(fn + '()')}::regprocedure),'functionAcl',(select proacl from pg_proc where oid=${q(fn + '()')}::regprocedure),
 'triggerDefinition',(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.survey_responses'::regclass and tgname=${q(name)})) then raise exception 'Survey cancellation installed identity changed';end if;
 drop trigger ${name} on public.survey_responses;drop function ${fn}();
 if pg_temp.survey_cancel_state() is distinct from captured then raise exception 'Survey cancellation full rows/catalog changed';end if;
 drop table ${baseline};
 if pg_temp.survey_cancel_state() is distinct from captured then raise exception 'Survey cancellation final state differs';end if;
 insert into survey_cancel_restored values(jsonb_build_object('stage','restored','descriptorSha256',${q(descriptorSha256)},'stateSha256',encode(sha256(convert_to(captured::text,'UTF8')),'hex'),
 'catalogSha256',encode(sha256(convert_to((captured->'catalog')::text,'UTF8')),'hex'),'backendObserved',${dispatched},'nativeVerified',false));end;$restore$;
 commit;select result from survey_cancel_restored;`
  const frames = freeze({ prepare, observer, restoreAfterDispatch: restore(true), restoreBeforeDispatch: restore(false) })
  Object.values(frames).forEach(sql => assert(Buffer.byteLength(sql) <= SURVEY_CANCELLATION_CAPS.sqlBytes))
  assert(Buffer.byteLength(JSON.stringify(request.body)) <= SURVEY_CANCELLATION_CAPS.requestBytes)
  const descriptor = freeze({ kind: 'survey-cancellation-source-only' as const, binding, descriptorSha256, request,
    functionName: fn, triggerName: name, baselineTable: baseline, frames, caps: SURVEY_CANCELLATION_CAPS,
    inventory: { successSqlDispatches: 3, addedObserverFrames: 1, totalObserverFrames: 14, addedHttpRequests: 1,
      ordinaryPlusCancellationRequests: 15, withApprovedWireOverflowRequests: 16,
      ifAllFramesUseSingle: { actions: 6, sessionSpawns: 3, identityBootstraps: 3, sessionCloses: 3, knownTotalActions: 199 },
      completeControls: null, completeExchangeBytes: null, inventoryComplete: false as const },
    integrationRequirements: ['Arm exact finally restoration before prepare write/ambiguous COMMIT.',
      'Only privately proved never-dispatched state may select restoreBeforeDispatch.',
      'Retain actual original HTTP dispatch/promise/body and prove it pending at observer dispatch/completion.',
      'Join the original HTTP and verify genuine 57014 plus7500..12000ms before normal restoration; AbortError is not cancellation evidence.',
      'Bind SQL-stored backend to private actual observer carrier; pure DTO validation is not provenance.',
      'Verify pinned PostgREST session_user=authenticator and actual hoisted8s cancellation at runtime; no request.method/path GUC is assumed.',
      'Absent-unverified is cleanup information only, never baseline equality or native acceptance.',
      'An unobserved dispatched backend or unjoined child remains failed/poisoned; no acceptance or secondary work.',
      'Keep the original work/cleanup clocks; after failure use existing owned restoration admission, not new work admission.',
      'Count every helper/guard/close/HTTP byte, reserve wire fixture and membership restoration, and seal full inventory before admission.'],
    requestContextGucsUsed: false as const, inventoryComplete: false as const, executionEnabled: false as const, nativeVerified: false as const })
  issued.add(descriptor); return descriptor
}
export type SurveyCancellationProofDescriptor = ReturnType<typeof surveyCancellationProofDescriptor>
/** One closed reuse of the reviewed full-state SQL for the wire fixture. The
 * temporary JSONB function cannot be a trigger function or public/private row,
 * so its OID excludes no public/private/storage function/trigger from catalog. */
export function surveyWirePrivateStateSql(f: SurveyNativeFixture) {
  const d=surveyCancellationProofDescriptor(f),start='create or replace function pg_temp.survey_cancel_state()',end='end;$state$;'
  const offset=d.frames.prepare.indexOf(start),last=d.frames.prepare.indexOf(end,offset)
  assert(offset>=0&&last>offset&&d.frames.prepare.indexOf(start,offset+1)===-1)
  const sql=d.frames.prepare.slice(offset,last+end.length)
  assert(sql.includes(q(d.baselineTable))&&sql.includes(q(d.functionName+'()')))
  return sql.replaceAll(q(d.baselineTable),q(`private.${f.tag}_wire_baseline`))
    .replaceAll(q(d.functionName+'()'),q('pg_temp.survey_cancel_state()'))
}
/** Inert arithmetic for one fixed proposed remaining schedule, NOT a workload,
 * executor, complete inventory or an allowance to dispatch missing frames.
 * Counts describe the existing v3 predicates after fixed Git batching. Resource
 * counts are statistics only; they cannot grant native target/provenance. */
export function surveyRemainingScheduleLowerBound(f: SurveyNativeFixture, counts: Readonly<{containers:number;volumes:number;networks:number}>) {
  fixture(f)
  assert(counts && Object.getPrototypeOf(counts)===Object.prototype)
  assert.deepEqual(Object.keys(counts).sort(),['containers','networks','volumes'])
  assert(Object.values(Object.getOwnPropertyDescriptors(counts)).every(row=>'value' in row))
  const outputBytes=8388608
  // CLI ID lines require64 ASCII bytes plus a separator; volume names require
  // at least one ASCII byte. These are loose physical stdout upper bounds,
  // not a claim that all such unique inventories are realizable/admissible.
  const listCountUpperBounds={containers:Math.floor((outputBytes+1)/65),volumes:Math.floor((outputBytes+1)/2),networks:Math.floor((outputBytes+1)/65)}
  for(const key of ['containers','volumes','networks'] as const)assert(Number.isSafeInteger(counts[key])&&counts[key]>=0&&counts[key]<=listCountUpperBounds[key])
  const batches=(values:typeof counts)=>Object.values(values).reduce((n,value)=>n+Math.ceil(value/128),0)
  const inspectBatches=batches(counts),guardCommands=12+inspectBatches
  // Every guard: initial batched Git/status/context3 + dual-root Git/status4,
  // three fresh global lists + all128-item inspections + final context/SQL2.
  const m=surveyCommittedProofManifest(f),c=surveyCancellationProofDescriptor(f)
  assert.equal(m.inventory.minActions,185)
  const committedGuards=m.inventory.minActions+4+2 // actions, two opens/initializations, two destruction guards
  const auxiliaryGuards=4*5 // setup, contract, two SDK snapshots; open/init/execute/close/terminate
  const sdkGuards=14*3,rollbackTargetGuards=1
  const baseGuards=committedGuards+auxiliaryGuards+sdkGuards+rollbackTargetGuards
  const baseControls=baseGuards*guardCommands+6+6 // positive termination commands and native process spawns
  const typeControls=2*guardCommands+4+2*(3+inspectBatches)+2+1 // two guards, source Git, inventories, contexts, genuine CLI
  const rootGitControls=28 // seven Git children/root ×two roots ×before/after
  // Candidate reuses the existing pair before its final closes. Cancellation
  // prepare/observe/restore3, wire fixture prepare/restore2. The primary was
  // never removed: no fabricated primary restore/INSERT is scheduled.
  // The two extra original HTTP probes retain pre/post guards (four in total).
  // This is a stated candidate choice, not a lower bound on every possible
  // semantics-preserving future integration or an implemented dispatch path.
  const proposedSqlActions=3+2,probeGuards=2*2
  const candidateControlLowerBound=baseControls+(proposedSqlActions+probeGuards)*guardCommands+2+typeControls+rootGitControls // two fixed restoration command children
  return freeze({kind:'survey269-remaining-candidate-accounting-only' as const,caps:SURVEY_269_REMAINING_CANDIDATE_CAPS,guardCommands,inspectBatches,baseGuards,baseControls,typeControls,rootGitControls,
    proposedActions:m.inventory.minActions+8+proposedSqlActions,proposedRequests:14+2,proposedObservers:13+1,
    candidateControlLowerBound,controlDeficit:Math.max(0,candidateControlLowerBound-SURVEY_269_REMAINING_CANDIDATE_CAPS.nativeControls),
    partialControlHeadroom:Math.max(0,SURVEY_269_REMAINING_CANDIDATE_CAPS.nativeControls-candidateControlLowerBound),
    cleanupReserve:218,listCountUpperBounds,maximumListBatches:batches(listCountUpperBounds),maximumGuardCommands:12+batches(listCountUpperBounds),
    frames:{cancellation:Object.fromEntries(Object.entries(c.frames).map(([key,sql])=>[key,{sha256:hash(sql),bytes:Buffer.byteLength(sql)}])),
      wire:{implemented:false as const,sqlBytes:null},membership:{source:'verifySurveyPrimaryMembership',bound:true as const,sqlBytes:0}},
    failureCases:['ambiguous-cancellation-prepare','pending-observation','unjoined-original-http','cancellation-restore','wire-prepare','wire-overflow','wire-restore','primary-membership-drift','type-command','final-preservation']
      .map(stage=>({stage,completeControls:null,completeActions:null})),
    completeControls:null,completeFailureControls:null,completeExchangeBytes:null,
    unresolved:['This historical arithmetic does not certify the new runtime wire/probe path or its output bytes.',
      'Primary equality and both retired cohort generations replace the impossible primary restoration.',
      'Other platform/canonical/global/helper/finally command counts and outputs are not sealed.',
      'Failure-specific restoration/positive-close maxima must include the complete outer inventory;218 is not standalone proof of fit.',
      candidateControlLowerBound>SURVEY_269_REMAINING_CANDIDATE_CAPS.nativeControls
        ? 'This candidate exceeds6000 before omitted outer controls; no complete success/failure or byte fit is claimed.'
        : 'This partial lower bound is not a complete success/failure, resource-validity or byte-fit certificate.'],
    sdkMs:SURVEY_269_REMAINING_CANDIDATE_CAPS.sdkMs,inventoryComplete:false as const,executionEnabled:false as const,nativeVerified:false as const})
}
export function validateSurveyCancellationSql(descriptor: SurveyCancellationProofDescriptor, frame: keyof SurveyCancellationProofDescriptor['frames'], sql: string) {
  return issued.has(descriptor) && Object.isFrozen(descriptor) && Object.hasOwn(descriptor.frames, frame)
    && typeof sql === 'string' && Buffer.byteLength(sql) <= descriptor.caps.sqlBytes && descriptor.frames[frame] === sql
}

/** Strict shape checks only. Caller-supplied objects cannot certify an original
 * HTTP request, NativeSession carrier, backend ownership or native acceptance. */
export function inspectSurveyCancellationPendingShape(descriptor: SurveyCancellationProofDescriptor, raw: unknown) {
  assert(issued.has(descriptor));assert(raw && typeof raw === 'object' && !Array.isArray(raw))
  assert(Object.getPrototypeOf(raw)===Object.prototype || Object.getPrototypeOf(raw)===null)
  assert(Buffer.byteLength(JSON.stringify(raw))<=descriptor.caps.responseBytes)
  const r = raw as Record<string, unknown>
  assert.deepEqual(Object.keys(r).sort(), ['backend','descriptorSha256','nativeVerified','stage'])
  assert.equal(r.stage,'pending');assert.equal(r.descriptorSha256,descriptor.descriptorSha256);assert.equal(r.nativeVerified,false)
  const b = r.backend as Record<string, unknown>;assert(b && typeof b === 'object' && !Array.isArray(b))
  assert(Object.getPrototypeOf(b)===Object.prototype || Object.getPrototypeOf(b)===null)
  assert.deepEqual(Object.keys(b).sort(), ['database','name','observedAt','pid','poll','queryStartedAt','sessionUser','started','state','transactionStartedAt','waitEvent','waitType'])
  assert(Number.isSafeInteger(b.pid) && Number(b.pid)>0);assert(Number.isInteger(b.poll) && Number(b.poll)>=1 && Number(b.poll)<=3)
  assert.equal(b.database,'postgres');assert.equal(b.sessionUser,'authenticator');assert.equal(b.name,descriptor.binding.marker)
  assert.equal(b.state,'active');assert.equal(b.waitType,'Timeout');assert.equal(b.waitEvent,'PgSleep')
  const times = ['started','transactionStartedAt','queryStartedAt','observedAt'].map(key => {
    const stamp=b[key];assert(typeof stamp==='string' && stamp.length<=64 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp))
    const value=Date.parse(stamp);assert(Number.isFinite(value));return value
  })
  assert(times.every((time,index)=>index===0 || time>=times[index-1]))
  return freeze({ sourceShapeMatches: true, backendOwnershipVerified: false as const, nativeVerified: false as const })
}
