import { validateLifecycleServicesReviewedMigrations } from './lifecycle-services-reviewed-migrations'
import { validateGradebookWorkflowReviewedMigration } from './gradebook-workflow-reviewed-migration'
/** Inert closed268 source. CPU receipts do not establish native acceptance. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { validateAssignmentListMigrationChain } from './contextual-assignment-list-proof-lifecycle'
import { validateSurveyWorkflowReviewedMigration } from './survey-workflow-reviewed-migration'
import { testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import type { DraftSaveDriver,DraftSaveTarget,DraftSaveSession } from './check-contextual-test-draft-save-db-contracts'
import { newClassroomHotLifecycleFixture,hotLifecycleDigest as hash,freezeHot as freeze,hotQuote as q,
  HOT_LIFECYCLE_CAPS as caps,hotLifecycleSetupSql,hotLifecycleSnapshotSql,hotGraphFunctions,
  assertHotLifecycleGraphChange,parseHotLifecycleGraph,type HotGraph } from './contextual-classroom-hot-lifecycle-proof-fixture'

const SOURCE='268_contextual_classroom_hot_lifecycle.sql'
const SOURCE_HASH='f7990de91330bb951fd7c63784f9a324b19c16ff946c094797d187af02a76254'
const CONTRACT_HASH='38856caf7c6e3a275d306f3a2e8a88e981792263cfcfb16a09148ca65a40f811'
const plans=new WeakSet<object>()
const checks=freeze(['owner-roles','restore-admission','full-row-content-revision','fences','strict-legacy','trigger-fault-rollback'] as const)
export function classroomHotLifecycleNativePlan(original:AssignmentListProofFixture,reviewedHead:string,repository:string) {
  assert.match(reviewedHead,/^[a-f0-9]{40}$/)
  const inventory=loadAssignmentListReviewedMigrations(repository);validateAssignmentListMigrationChain(inventory);assert([268,269,270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285].includes(inventory.length))
  const migrations=inventory.map(({name,sha256})=>({name,sha256}))
  assert.equal(hash(JSON.stringify(migrations.slice(0,267))),'9f08b2db28b413c6f00b3021597d5cd0271600b0d8039abf46f84b50c318b4bd')
  assert.equal(inventory[267].name,SOURCE);assert.equal(inventory[267].sha256,SOURCE_HASH);assert.equal(hash(inventory[267].sql),SOURCE_HASH)
  if (inventory.length >= 269) validateSurveyWorkflowReviewedMigration(inventory[268])
  if (inventory.length >= 270) validateGradebookWorkflowReviewedMigration(inventory[269])
  validateLifecycleServicesReviewedMigrations(inventory)
  const f=newClassroomHotLifecycleFixture(original),projectId=f.projectId
  const source=readFileSync(resolve(repository,'scripts/check-contextual-classroom-hot-lifecycle-database.sql'),'utf8');assert.equal(hash(source),CONTRACT_HASH)
  const terminal="select 'PASS hot lifecycle rollback-only owner policy, archive/restore admission, full-row/content/revision preservation and fault rollback';"
  assert.equal(source.split(terminal).length,2)
  assert(source.includes("set local statement_timeout = '45s';"))
  const contracts={checks,sql:source.replace("set local statement_timeout = '45s';","set local statement_timeout = '12s';")
    .replace(terminal,`select jsonb_build_object('checks',${q(JSON.stringify(checks))}::jsonb) as result;`)}
  const begin=`${hotGraphFunctions}begin;set local lock_timeout='8s';set local statement_timeout='12s';set local idle_in_transaction_session_timeout='180s';`
  const call=(actor:number,klass:number,archived:boolean)=>`public.set_classroom_hot_archive_for_owner_v1(${q(f.actors[actor].id)},${q(f.classes[klass].id)},${archived})`
  const mutate=(sql:string)=>`do $mutate$ begin perform ${sql};end;$mutate$;`
  const commitSql="commit;select jsonb_build_object('committed',true) as result;"
  function schedule(label:string,klass:number,archived:boolean,holder:string,contender:string,code:string,message:string) {
    return {label,classroomId:f.classes[klass].id,archived,code,message,
      holderSql:`${begin}${holder}select jsonb_build_object('label',${q(label)},'pid',pg_backend_pid(),'state',pg_temp.hot_graph()) as result;`,
      contenderSql:`${begin}do $contend$ declare code text;message text;begin begin perform ${contender};
        ${code==='00000'?'':"raise exception 'Hot lifecycle contender unexpectedly succeeded';"}
        exception when others then get stacked diagnostics code=returned_sqlstate,message=message_text;
        if code is distinct from ${q(code)} or message is distinct from ${q(message)} then raise exception 'Hot lifecycle contender denial differs';end if;end;end;$contend$;
        select jsonb_build_object('label',${q(label)},'code',${q(code)},'message',${q(message)},'state',pg_temp.hot_graph()) as result;commit;`,
      observeSql:`select jsonb_build_object('blocked',exists(select 1 from pg_stat_activity c join pg_stat_activity h on h.pid=any(pg_blocking_pids(c.pid))
        where c.application_name=${q(projectId+'_draft_contender')} and h.application_name=${q(projectId+'_draft_holder')} and c.datname='postgres' and h.datname='postgres' and c.usename='postgres' and h.usename='postgres'),
        'holder_pid',(select pid from pg_stat_activity where application_name=${q(projectId+'_draft_holder')} and datname='postgres' and usename='postgres'),
        'contender_pid',(select pid from pg_stat_activity where application_name=${q(projectId+'_draft_contender')} and datname='postgres' and usename='postgres')) as result;`,commitSql}
  }
  const create=`public.create_classroom_atomic_v1(${q(f.operation)},${q(f.actors[1].id)},${q(hash(f.operation))},'Synthetic capacity race',${q(f.tag+'_race')},null,'blue')`
  const committed={snapshot:hotLifecycleSnapshotSql(),schedules:[
    schedule('two-restores-one-slot',3,false,mutate(call(0,3,false)),call(0,4,false),'23514','classroom_creation_active_limit_reached'),
    schedule('restore-before-create',5,false,mutate(call(1,5,false)),create,'23514','classroom_creation_active_limit_reached'),
    schedule('transfer-before-old-owner-archive',0,false,`do $transfer$ begin perform public.lock_effective_feature_entitlement_v1(${q(f.actors[0].id)},'classrooms.create');update public.classrooms set teacher_id=${q(f.actors[3].id)} where id=${q(f.classes[0].id)};end;$transfer$;`,call(0,0,true),'PT403','classroom_hot_lifecycle_forbidden'),
    schedule('archive-before-restore',1,true,mutate(call(1,1,true)),call(1,1,false),'00000',''),
  ]}
  const plan=freeze({version:1,nativeVerified:false,reviewedHead,fixture:f,projectId,migrations,sourceSha256:SOURCE_HASH,
    migrationManifestSha256:hash(JSON.stringify(migrations)),guard:testOwnerGuardSql(projectId),setup:hotLifecycleSetupSql(f),snapshot:hotLifecycleSnapshotSql(),contracts,concurrency:{schedules:[]},committed})
  for(const sql of [plan.setup,plan.snapshot,plan.contracts.sql,...plan.committed.schedules.flatMap(s=>[s.holderSql,s.contenderSql,s.observeSql,s.commitSql])])assert(Buffer.byteLength(sql)<=caps.sqlBytes)
  plans.add(plan);return plan
}
export type ClassroomHotLifecycleNativePlan=ReturnType<typeof classroomHotLifecycleNativePlan>
export function validateClassroomHotLifecycleNativeSql(m:ClassroomHotLifecycleNativePlan,sql:string) {
  return plans.has(m)&&typeof sql==='string'&&Buffer.byteLength(sql)<=caps.sqlBytes&&[m.setup,m.snapshot,m.contracts.sql,
    ...m.committed.schedules.flatMap(s=>[s.holderSql,s.contenderSql,s.observeSql,s.commitSql])].includes(sql)
}
function bind(m:ClassroomHotLifecycleNativePlan,t:DraftSaveTarget,phase:'contracts'|'concurrency'|'committed') {
  assert(plans.has(m)&&Object.isFrozen(t)&&t.disposable);assert.equal(t.projectId,m.projectId);assert.equal(t.containerProjectLabel,m.projectId)
  assert.equal(t.apiUrl,'http://127.0.0.1:54331');assert.equal(t.databaseHost,'127.0.0.1');assert.equal(t.databasePort,54332)
  assert.match(t.containerId,/^[a-f0-9]{64}$/);assert.equal(t.reviewedHead,m.reviewedHead);assert.equal(t.reviewedSourceSha256,m.sourceSha256)
  assert.equal(t.migrationManifestSha256,m.migrationManifestSha256);assert.equal(t.acceptedManifestSha256,hash(JSON.stringify(m[phase])))
}
function result(rows:readonly {result?:unknown}[]):Record<string,unknown> {
  assert.equal(rows.length,1);const value=rows[0].result;assert(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>
}
export async function runClassroomHotLifecycleNativeContracts(m:ClassroomHotLifecycleNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  bind(m,t,'contracts');assert.deepEqual(await d.verifyTarget(),t);const s=await d.openSession(m.projectId+'_draft_contracts')
  try {const ack=result(await s.execute(m.contracts.sql,caps.requestMs));assert.deepEqual(ack,{checks:m.contracts.checks});return freeze({checks:m.contracts.checks})}
  finally {await s.rollbackAndClose(caps.closeMs)}
}
export async function runClassroomHotLifecycleRollbackRaces(m:ClassroomHotLifecycleNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  bind(m,t,'concurrency');assert.deepEqual(await d.verifyTarget(),t);return freeze({schedules:0,committedSchedulesSeparate:true})
}
const graph=parseHotLifecycleGraph
function transfer(before:HotGraph,after:HotGraph,id:string,owner:string) {
  const copy=structuredClone(before),old=(copy['public.classrooms'] as Record<string,unknown>[]).find(r=>r.id===id)!,fresh=(after['public.classrooms'] as Record<string,unknown>[]).find(r=>r.id===id)!
  assert(old&&fresh);assert.equal(fresh.teacher_id,owner);assert(typeof fresh.updated_at==='string'&&Number.isFinite(Date.parse(fresh.updated_at)))
  assert.deepEqual(fresh,{...old,teacher_id:owner,updated_at:fresh.updated_at});copy['public.classrooms']=(copy['public.classrooms'] as Record<string,unknown>[]).map(r=>r.id===id?fresh:r)
  const prev=(copy['public.classroom_archive_revisions'] as Record<string,unknown>[]).find(r=>r.classroom_id===id)!,next=(after['public.classroom_archive_revisions'] as Record<string,unknown>[]).find(r=>r.classroom_id===id)!
  assert(prev&&next);assert.deepEqual(next,{...prev,revision:Number(prev.revision)+1,updated_at:fresh.updated_at});copy['public.classroom_archive_revisions']=(copy['public.classroom_archive_revisions'] as Record<string,unknown>[]).map(r=>r.classroom_id===id?next:r)
  // Rows are ordered by SQL's full JSON value; normalize without mutating witnesses.
  const normalize=(g:HotGraph)=>Object.fromEntries(Object.entries(g).map(([k,v])=>[k,Array.isArray(v)?[...v].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v]))
  assert.deepEqual(normalize(after),normalize(copy))
}
export async function runClassroomHotLifecycleNativeRaces(m:ClassroomHotLifecycleNativePlan,t:DraftSaveTarget,d:DraftSaveDriver) {
  bind(m,t,'committed');const deadline=Date.now()+caps.totalMs,receipts=[]
  for(const s of m.committed.schedules) {
    assert(Date.now()<deadline);assert.deepEqual(await d.verifyTarget(),t)
    let holder:DraftSaveSession|undefined,contender:DraftSaveSession|undefined,pending:Promise<readonly {result?:unknown}[]>|undefined,settled=false
    try {
      holder=await d.openSession(m.projectId+'_draft_holder');contender=await d.openSession(m.projectId+'_draft_contender')
      const before=graph(result(await holder.execute(m.committed.snapshot,caps.requestMs)))
      const held=result(await holder.execute(s.holderSql,caps.requestMs));assert.deepEqual(Object.keys(held).sort(),['label','pid','state']);assert.equal(held.label,s.label);assert(Number.isSafeInteger(held.pid)&&Number(held.pid)>0)
      const heldGraph=graph(held.state)
      if(s.label==='transfer-before-old-owner-archive')transfer(before,heldGraph,s.classroomId,m.fixture.actors[3].id)
      else assertHotLifecycleGraphChange(before,heldGraph,s.classroomId,s.archived)
      pending=contender.execute(s.contenderSql,caps.requestMs);void pending.then(()=>{settled=true},()=>{settled=true})
      let observed=false
      for(let i=0;i<12&&!observed;i++) {
        assert(Date.now()<deadline&&!settled,'Contender finished before observed blocking')
        const ack=result(await holder.execute(s.observeSql,caps.requestMs))
        if(ack.blocked===true){assert.equal(ack.holder_pid,held.pid);assert(Number.isSafeInteger(ack.contender_pid)&&Number(ack.contender_pid)>0&&ack.contender_pid!==held.pid);observed=true}
      }
      assert(observed&&!settled,'Owned blocking relationship was not observed')
      assert.deepEqual(result(await holder.execute(s.commitSql,caps.requestMs)),{committed:true})
      const ack=result(await pending);assert.deepEqual(Object.keys(ack).sort(),['code','label','message','state']);assert.equal(ack.label,s.label);assert.equal(ack.code,s.code);assert.equal(ack.message,s.message)
      const final=graph(ack.state)
      if(s.code==='00000')assertHotLifecycleGraphChange(heldGraph,final,s.classroomId,false);else assert.deepEqual(final,heldGraph)
      const persisted=graph(result(await holder.execute(m.committed.snapshot,caps.requestMs)));assert.deepEqual(persisted,final)
      receipts.push({label:s.label,blockingObserved:true,code:s.code,wholeGraphVerified:true})
    } finally {
      const closed=await Promise.allSettled([holder?.rollbackAndClose(caps.closeMs),contender?.rollbackAndClose(caps.closeMs)])
      if(pending)await pending.catch(()=>{})
      assert(closed.every(r=>r.status==='fulfilled'),'Owned hot lifecycle session closure failed')
    }
  }
  return freeze({schedules:receipts,sourceSha256:m.sourceSha256})
}
/** Applied only to the existing CLI-produced private artifact, never a cast or hand-edited types file. */
export function validateHotLifecycleGeneratedTypes(source:string) {
  assert(Buffer.byteLength(source)<=caps.responseBytes)
  const file=ts.createSourceFile('generated.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),matches:ts.PropertySignature[]=[]
  const walk=(node:ts.Node)=>{if(ts.isPropertySignature(node)&&node.name.getText(file)==='set_classroom_hot_archive_for_owner_v1')matches.push(node);ts.forEachChild(node,walk)};walk(file)
  // A metadata fragment is accepted for CPU contract testing; native entrypoint additionally requires CLI artifact provenance.
  if(matches.length===0){const wrapped=ts.createSourceFile('fragment.ts',`type Fragment={${source}}`,ts.ScriptTarget.Latest,true);const members=(wrapped.statements[0] as ts.TypeAliasDeclaration).type as ts.TypeLiteralNode;matches.push(...members.members.filter(ts.isPropertySignature));}
  assert.equal(matches.length,1);const fn=matches[0];assert.equal(fn.name.getText(),'set_classroom_hot_archive_for_owner_v1');assert(fn.type&&ts.isTypeLiteralNode(fn.type))
  const members=fn.type.members;assert.deepEqual(members.map(x=>x.name?.getText()).sort(),['Args','Returns']);const args=members.find(x=>x.name?.getText()==='Args') as ts.PropertySignature,returns=members.find(x=>x.name?.getText()==='Returns') as ts.PropertySignature
  assert(args.type&&ts.isTypeLiteralNode(args.type));assert.deepEqual(args.type.members.map(x=>x.name?.getText()).sort(),['p_actor_id','p_archived','p_classroom_id'])
  for(const arg of args.type.members){assert(ts.isPropertySignature(arg)&&!arg.questionToken);assert.equal(arg.type?.kind,arg.name.getText()==='p_archived'?ts.SyntaxKind.BooleanKeyword:ts.SyntaxKind.StringKeyword)}
  assert.equal(returns.type?.getText(),'Json')
}
