/** Inert SQL plans for the coordinator's governed, reviewed, owned ephemeral
 * driver. This module starts no database, reads no credentials and executes no
 * commands. The driver must prove real holder locks, run both sessions and
 * retain normal finally cleanup. A plan is not native acceptance evidence. */
import assert from 'node:assert/strict'
import type { Json } from '../src/types/database.generated'

const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: Json) => `${quoted(JSON.stringify(value))}::jsonb`
const bounded = (body: string) => `begin;set local lock_timeout='250ms';set local statement_timeout='8s';\n${body}\n`
export function repoLightNativeRacePlans(input: {
  actorId: string; assignmentId: string; studentId: string; runId: string;
  source: Json; connection: Json; request: Json;
  leaseToken: string; leaseGeneration: number; subjectBindingId: string; operationId: string;
}) {
  for (const value of [input.actorId,input.assignmentId,input.studentId,input.runId,input.operationId]) assert.match(value,/^f29[3-9][a-f0-9]{4}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,'Synthetic RepoLight fixture UUID required')
  // The binding UUID is allocated by PostgreSQL. The owning driver must prove it
  // belongs to the supplied synthetic run; it cannot carry the fixture prefix.
  assert.match(input.subjectBindingId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  assert.match(input.leaseToken,/^[a-f0-9-]{36}$/)
  assert(Number.isInteger(input.leaseGeneration)&&input.leaseGeneration>0)
  const actor=`${quoted(input.actorId)}::uuid`,assignment=`${quoted(input.assignmentId)}::uuid`,student=`${quoted(input.studentId)}::uuid`,run=`${quoted(input.runId)}::uuid`
  const create=`public.begin_assignment_repolight_run_v1(${actor},${assignment},${student},${run},${json(input.connection)},${json(input.request)},${json(input.source)})`
  const payload=json({leaseToken:input.leaseToken,leaseGeneration:input.leaseGeneration})
  const authorize=`public.advance_assignment_repolight_run_v1(${actor},${assignment},${student},${run},'authorize',${payload})`
  const ready=`select pg_catalog.jsonb_build_object('backend_pid',pg_backend_pid(),'transaction',exists(select 1 from pg_stat_activity where pid=pg_backend_pid() and xact_start is not null),'assignment_lock',exists(select 1 from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted)) as result;`
  const denial=(call:string,code:string)=>bounded(`do $deny$ declare actual text;begin begin perform ${call};raise exception 'Expected fenced contender rejection';exception when others then get stacked diagnostics actual=returned_sqlstate;if actual is distinct from ${quoted(code)} then raise exception 'Unexpected contention outcome';end if;end;end;$deny$;select jsonb_build_object('rejected',true,'code',${quoted(code)}) as result;rollback;`)
  return Object.freeze({
    // Run in separate synthetic fixture scopes; the source winner intentionally
    // changes its own rows. Never "restore" immutable memberships or controls.
    duplicateIntent: Object.freeze({
      holderSql:bounded(`select ${create};\n${ready}`),
      whileHeldSql:denial(create,'55P03'),
      holderFinishSql:'commit;',
      afterReleaseSql:bounded(`do $dedupe$ declare value jsonb;begin value:=${create};if value->>'id'<>${quoted(input.runId)} or (select count(*) from public.assignment_repolight_runs where id=${run})<>1 then raise exception 'Duplicate intent created another run';end if;end;$dedupe$;rollback;`),
    }),
    targetChangeWins: Object.freeze({
      holderSql:bounded(`select public.save_assignment_repo_target_for_owner_v1(${actor},${assignment},${student},'{"selected_repo_url":"https://github.com/example/changed","override_github_username":null,"repo_owner":"example","repo_name":"changed","selection_mode":"teacher_override","validation_status":"valid","validation_message":null}'::jsonb,clock_timestamp());\n${ready}`),
      whileHeldSql:denial(authorize,'55P03'),holderFinishSql:'commit;',
      afterReleaseSql:denial(authorize,'40001'),
    }),
    erasureWins: Object.freeze({
      holderSql:bounded(`select public.begin_repolight_subject_erasure_v1(${actor},${quoted(input.subjectBindingId)}::uuid,${quoted(input.operationId)}::uuid);\n${ready}`),
      whileHeldSql:denial(authorize,'55P03'),holderFinishSql:'commit;',
      afterReleaseSql:denial(authorize,'55000'),
    }),
  })
}
