import { REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION } from '../../scripts/repolight-report-service-reviewed-migration'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerUnpublicationFixture,testOwnerUnpublicationSetupSql } from '../../scripts/contextual-test-owner-unpublication-proof-fixture'
import { testOwnerPublicationSetupSql } from '../../scripts/contextual-test-publication-proof-fixture'
import * as publicationFixture from '../../scripts/contextual-test-publication-proof-fixture'
import { testOwnerUnpublicationNativePlan, validateTestOwnerUnpublicationNativePlanSql,runTestOwnerUnpublicationNativeContracts,runTestOwnerUnpublicationNativeRaces } from '../../scripts/contextual-test-owner-unpublication-native-contracts'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { buildTestOwnerUnpublicationNativeContractsManifest } from '../../scripts/contextual-test-draft-save-native-contracts'
import type { DraftSaveDriver,DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { validateTestDraftContent } from '../../src/lib/validations/assessment-drafts'
import { TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION, validateTestOwnerUnpublicationReviewedMigration } from '../../scripts/test-owner-unpublication-reviewed-migration'
import { CLASSROOM_HOME_VISIBILITY_REVIEWED_MIGRATION } from '../../scripts/classroom-home-visibility-reviewed-migration'

vi.mock('node:fs',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs')>()
  return {...actual,readFileSync:vi.fn(actual.readFileSync)}
})

const original = newAssignmentListProofFixture(new Date('2026-10-11T12:00:00Z'))
const plan=()=>testOwnerUnpublicationNativePlan(original,'b'.repeat(40),process.cwd())
const digest=(v:string)=>createHash('sha256').update(v).digest('hex')
const target=(m:ReturnType<typeof plan>,phase:'contracts'|'concurrency'):DraftSaveTarget=>Object.freeze({
  projectId:m.projectId,containerProjectLabel:m.projectId,apiUrl:'http://127.0.0.1:54331',databaseHost:'127.0.0.1',databasePort:54332,
  containerId:'a'.repeat(64),disposable:true,reviewedHead:m.reviewedHead,migrationManifestSha256:m.migrationManifestSha256,
  reviewedSourceSha256:m.sourceSha256,acceptedManifestSha256:digest(JSON.stringify(m[phase])),
})
describe('inert unpublication source proof', () => {
  it('uses closed unlocked publication fixtures without observed attempts', () => {
    const f = newTestOwnerUnpublicationFixture(original)
    expect(Object.isFrozen(f)).toBe(true)
    expect(f.tests.every(t => t.status === 'closed' && t.questions_locked_at === null)).toBe(true)
    expect(f).not.toHaveProperty('observedAttempts')
    expect(f.allocatedIds.length).toBe(new Set(f.allocatedIds).size)
  })
  it('fits the actual fixed256KiB preparation input boundary without removing bulk rows',()=>{
    const f=newTestOwnerUnpublicationFixture(original),sql=testOwnerUnpublicationSetupSql(f,`pika_assignment_list_${f.tag.slice(-12)}`)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(256*1024)
    expect(f.questions.filter(q=>q.test_id===f.publicationBase.cases[2].testId)).toHaveLength(1001)
    expect(sql).toContain('with ordinality as b(row_id,artifact_id,ordinal)')
    expect(sql).toContain('Publication namespace collision')
    expect(sql).toContain("set local lock_timeout='3s';set local statement_timeout='30s'")
    expect(sql.match(/\bcommit;/g)).toHaveLength(1)
  })
  it('changes only the one repeated bulk content expression and matches its complete row oracle',()=>{
    const f=newTestOwnerUnpublicationFixture(original),project=`pika_assignment_list_${f.tag.slice(-12)}`
    const sql=testOwnerUnpublicationSetupSql(f,project),bulkTest=f.publicationBase.tests[2]
    const draft=f.publicationBase.drafts.find(d=>d.assessment_id===bulkTest.id)!
    const expression=/\/\* unpublication-bulk-draft \*\/([\s\S]*?)\/\* end-unpublication-bulk-draft \*\//.exec(sql)
    expect(expression).not.toBeNull()
    const content={title:draft.content.title,show_results:draft.content.show_results,question_identity_version:1,
      questions:f.questions.filter(q=>q.test_id===bulkTest.id).sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).map(q=>({
        id:q.source_artifact_id??q.artifact_id??q.id,question_type:q.question_type,question_text:q.question_text,
        options:[...q.options],correct_option:q.correct_option,answer_key:q.answer_key,sample_solution:q.sample_solution,
        points:q.points,response_max_chars:q.response_max_chars,response_monospace:q.response_monospace,
      }))}
    expect({...draft,content}).toEqual(draft)
    const q=(s:string)=>`'${s.replaceAll("'","''")}'`
    const originalSql=testOwnerPublicationSetupSql(f.publicationBase,project).replaceAll("'draft'","'closed'")
    const expected=`${originalSql.slice(0,-'commit;'.length)}\ninsert into public.classroom_enrollments(id,classroom_id,student_id) values(${q(f.selfEnrollmentId)},${q(f.classes[1].id)},${q(f.actors[1].id)});commit;`
    expect(sql.replace(expression![0],`${q(JSON.stringify(draft.content))}::jsonb`)).toBe(expected)
    expect(sql.indexOf('with ordinality as b(row_id,artifact_id,ordinal)')).toBeLessThan(sql.indexOf(expression![0]))
    expect(expression![1]).toContain(`where question.test_id=${q(bulkTest.id)}::uuid`)
    for(const key of ['question_type','question_text','options','correct_option','answer_key','sample_solution','points','response_max_chars','response_monospace'])
      expect(expression![1]).toContain(`'${key}',question.${key}`)
    expect(expression![1]).toContain('order by question.position,question.id')
    expect(expression![1]).toContain("'points',question.points::integer")
  })
  it.each(['row-drift','content-drift','marker-drift','count-drift'])('refuses unsupported bulk fixture %s instead of changing its full rows',defect=>{
    const f=structuredClone(newTestOwnerUnpublicationFixture(original)),tid=f.publicationBase.cases[2].testId
    if(defect==='row-drift') f.publicationBase.questions.find((q,i)=>q.test_id===tid&&i>5)!.answer_key='Unsupported varied bulk answer'
    if(defect==='content-drift') f.publicationBase.drafts.find(d=>d.assessment_id===tid)!.content.questions[0].question_text='Unsupported stale bulk Draft'
    if(defect==='marker-drift') f.publicationBase.drafts.find(d=>d.assessment_id===tid)!.content.question_identity_version=2
    if(defect==='count-drift') f.publicationBase.questions.splice(f.publicationBase.questions.findIndex(q=>q.test_id===tid),1)
    expect(()=>testOwnerUnpublicationSetupSql(f,`pika_assignment_list_${f.tag.slice(-12)}`)).toThrow()
  })
  it.each(['missing','duplicate'])('requires exactly one inherited fixed bulk content literal: %s',defect=>{
    const f=newTestOwnerUnpublicationFixture(original),project=`pika_assignment_list_${f.tag.slice(-12)}`
    const draft=f.publicationBase.drafts.find(d=>d.assessment_id===f.publicationBase.cases[2].testId)!
    const literal=`'${JSON.stringify(draft.content).replaceAll("'","''")}'::jsonb`,sql=testOwnerPublicationSetupSql(f.publicationBase,project)
    const altered=defect==='missing'?sql.replace(literal,"'{}'::jsonb"):sql.replace('commit;',`select ${literal};commit;`)
    const source=vi.spyOn(publicationFixture,'testOwnerPublicationSetupSql').mockReturnValueOnce(altered)
    try{expect(()=>testOwnerUnpublicationSetupSql(f,project)).toThrow()}finally{source.mockRestore()}
  })
  it('keeps every inert unpublication SQL frame within the actual fixed runner input cap',()=>{
    const m=buildTestOwnerUnpublicationNativeContractsManifest(original,'b'.repeat(40),process.cwd())
    for(const sql of [m.bootstrap,m.guard,m.preparation,m.setup,m.snapshot,...m.contracts.frames.map(frame=>frame.sql),m.privilege.catalog,m.privilege.revoke,m.privilege.restore,
      ...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])]) expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(256*1024)
  })
  it.each(['missing','duplicate','after-content'])('requires exactly one earlier bulk insertion witness: %s',defect=>{
    const f=newTestOwnerUnpublicationFixture(original),project=`pika_assignment_list_${f.tag.slice(-12)}`
    const marker='with ordinality as b(row_id,artifact_id,ordinal)',sql=testOwnerPublicationSetupSql(f.publicationBase,project)
    const without=sql.replace(marker,'')
    const altered=defect==='missing'?without:defect==='duplicate'?sql.replace(marker,marker+marker):without.replace('commit;',`${marker} commit;`)
    const source=vi.spyOn(publicationFixture,'testOwnerPublicationSetupSql').mockReturnValueOnce(altered)
    try{expect(()=>testOwnerUnpublicationSetupSql(f,project)).toThrow()}finally{source.mockRestore()}
  })
  it('binds actual current bytes to the externally fixed seal', () => {
    const name = TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.name, sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
    expect(() => validateTestOwnerUnpublicationReviewedMigration({ name, sql, sha256: createHash('sha256').update(sql).digest('hex') })).not.toThrow()
    const m = testOwnerUnpublicationNativePlan(original, 'b'.repeat(40), process.cwd())
    expect(m.migrations).toHaveLength(293)
    expect(m.migrations.at(-1)).toEqual(REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION)
    expect(m.migrations[291]).toMatchObject(CLASSROOM_HOME_VISIBILITY_REVIEWED_MIGRATION)
    expect(m.nativeVerified).toBe(false)
    for (const sql of [m.setup,m.snapshot,...m.contracts.frames.map(frame=>frame.sql),...m.concurrency.schedules.flatMap(s=>[s.holderSql,s.rejectSql])]) {
      expect(validateTestOwnerUnpublicationNativePlanSql(m,sql)).toBe(true)
      expect(validateTestOwnerUnpublicationNativePlanSql(m,sql+'select 1;')).toBe(false)
    }
    expect(validateTestOwnerUnpublicationNativePlanSql(m,m.preparation)).toBe(false)
    expect(validateTestOwnerUnpublicationNativePlanSql(m,m.contracts.sql)).toBe(false)
    expect(validateTestOwnerUnpublicationNativePlanSql(Object.freeze({...m,setup:'select 1;'}),'select 1;')).toBe(false)
  })
  it.each(['name', 'digest', 'bytes'])('rejects unreviewed %s and self-hashed substitution', defect => {
    const candidate = { name: TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.name, sql: 'select 1;', sha256: 'f'.repeat(64) }
    if (defect === 'name') candidate.name = '262_unknown.sql'
    if (defect === 'digest') candidate.sha256 = '0'.repeat(64)
    if (defect === 'bytes') candidate.sql += '\n'
    expect(() => validateTestOwnerUnpublicationReviewedMigration(candidate)).toThrow()
  })
  it('retains every requested matrix and holder source in the finite proof', () => {
    const sql = readFileSync('scripts/check-contextual-test-owner-unpublication.sql', 'utf8')
    for (const label of ['service-only-empty-search-path', 'private-core-service-denial', 'mixed-role-current-owner', 'canonical-published-source', 'whole-graph-preservation', 'idempotent-draft-full-equality', 'late-fault-atomic-rollback']) expect(sql).toContain(label)
    expect(sql).toContain('rollback;')
  })
  it('scopes fault injection and proves exact installed parent trigger effects',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const install=sql.indexOf('create trigger reject_unpublication_status_update'),drop=sql.indexOf('drop trigger reject_unpublication_status_update')
    expect(install).toBeGreaterThan(sql.indexOf("'invalid published question'"))
    expect(drop).toBeGreaterThan(sql.indexOf("'partial draft write rollback'"))
    expect(drop).toBeLessThan(sql.indexOf('do $limits261$'))
    expect(sql.match(/create trigger reject_unpublication_status_update/g)).toHaveLength(1)
    expect(sql.match(/drop trigger reject_unpublication_status_update/g)).toHaveLength(1)
    expect(sql).toContain("when 'public.classrooms' then format('where r.id<>(select classroom_id from public.tests where id=%L::uuid)',p_test_id)")
    expect(sql.match(/archive_revision,revision[\s\S]*?::bigint\+3/g)).toHaveLength(3)
    expect(sql.match(/classroom,blueprint_source_revision[\s\S]*?::bigint\+1/g)).toHaveLength(3)
    expect(sql.match(/classroom'\)-array\['blueprint_source_revision','updated_at'\]/g)).toHaveLength(6)
    expect(sql).toContain("update public.tests set status='draft' where id=p_test")
    expect(sql).toContain('Rejected unpublication changed graph')
  })
  it('rolls back only the unchanged late-fault DDL and full-graph55000 probe in one forced subtransaction',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const fault=sql.split('-- Release the late-fault trigger DDL locks before the next fixed frame.')[1]
      .split('  begin\n    update public.tests set questions_locked_at=now()')[0]
    const block=/  begin\n([\s\S]*?)\n  exception when sqlstate 'ZX261' then null;end;/.exec(fault)
    expect(block).not.toBeNull()
    expect(block![1]).toBe(`    execute $late_fault_ddl$create trigger reject_unpublication_status_update
      before update on public.tests for each row
      when (new.id='a2610000-0000-4000-8000-000000000031'::uuid
        and old.status='closed' and new.status='draft')
      execute function pg_temp.reject_unpublication_status_update()$late_fault_ddl$;
    perform pg_temp.expect_unpublication_rejection(owner_id,test_id,'55000','forced_unpublication_status_failure','partial draft write rollback');
    execute 'drop trigger reject_unpublication_status_update on public.tests';
    raise exception using errcode='ZX261',message='rollback late-fault trigger DDL';`)
    for(const witness of ['before_graph := pg_temp.test_unpublication_graph(test_id);',
      "into before_triggers\n    from pg_catalog.pg_trigger t where t.tgrelid='public.tests'::regclass;"]){
      expect(fault).toContain(witness);expect(fault.indexOf(witness)).toBeLessThan(fault.indexOf(block![0]))
    }
    expect(fault.match(/exception when/g)).toHaveLength(1)
    expect(fault).not.toMatch(/when others|disable trigger|session_replication_role/)
    const helper=sql.split('as $reject$')[1].split('$reject$;')[0]
    expect(helper).toContain('perform public.return_test_to_draft_atomic(p_actor,p_test);')
    expect(helper).toContain('perform public.test_owner_workflow_v1(p_actor,p_test,')
    expect(helper).toContain('if actual_code is distinct from p_code or actual_message is distinct from p_message then')
    expect(helper).toContain('if actual_code is distinct from p_code then raise exception')
    expect(helper).toContain('if after_graph is distinct from before_graph then')
  })
  it('fails closed on late-fault graph, exact trigger catalog, owned residue or retained exclusive lock before later probes',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const fault=sql.split('-- Release the late-fault trigger DDL locks before the next fixed frame.')[1]
      .split('  begin\n    update public.tests set questions_locked_at=now()')[0]
    const handler=fault.indexOf("exception when sqlstate 'ZX261' then null;end;")
    const assertions=[
      "if pg_temp.test_unpublication_graph(test_id) is distinct from before_graph then\n    raise exception 'Late-fault trigger rollback changed full graph';\n  end if;",
      "if after_triggers is distinct from before_triggers then\n    raise exception 'Late-fault trigger rollback changed trigger catalog';\n  end if;",
      "if exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='public.tests'::regclass\n    and t.tgname='reject_unpublication_status_update') then\n    raise exception 'Late-fault trigger rollback retained owned trigger';\n  end if;",
      "if exists(select 1 from pg_catalog.pg_locks l where l.locktype='relation'\n    and l.database=(select d.oid from pg_catalog.pg_database d where d.datname=current_database())\n    and l.relation='public.tests'::regclass and l.pid=pg_backend_pid()\n    and l.mode='AccessExclusiveLock' and l.granted) then\n    raise exception 'Late-fault trigger rollback retained owned AccessExclusiveLock';\n  end if;",
    ]
    for(const assertion of assertions){expect(fault).toContain(assertion);expect(fault.indexOf(assertion)).toBeGreaterThan(handler)}
    expect(fault.match(/select coalesce\(jsonb_agg\(to_jsonb\(t\) order by t\.oid\),'\[\]'::jsonb\) into (?:before|after)_triggers\n    from pg_catalog\.pg_trigger t where t\.tgrelid='public\.tests'::regclass;/g)).toHaveLength(2)
    expect(fault.indexOf('into after_triggers')).toBeGreaterThan(handler)
    expect(sql.indexOf(assertions[3])).toBeLessThan(sql.indexOf("message='rollback irreversible question-lock probe'"))
    expect(sql.indexOf(assertions[3])).toBeLessThan(sql.indexOf('do $limits261$'))
  })
  it('keeps the wrong-parent fixture storage-valid under the installed134 identity CHECK',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const limits=sql.split('do $limits261$')[1].split('end;$limits261$;')[0]
    const insert=/values\('test',tid,'([^']+)','([^']+)'(?:\:\:jsonb)?,1,owner_id,owner_id\)/.exec(limits)
    expect(insert).not.toBeNull()
    expect(insert![1]).toBe('a2610000-0000-4000-8000-000000000020')
    const content=JSON.parse(insert![2])
    expect(content.question_identity_version).toBe(1)
    expect(validateTestDraftContent(content,{requirePortableQuestionIdentity:true}).valid).toBe(true)
    const migration=readFileSync('supabase/migrations/134_blueprint_test_question_ordinal_identity.sql','utf8')
    expect(migration).toContain('add constraint assessment_drafts_test_question_identity_version_check')
    expect(migration).toContain("or content->'question_identity_version' is not distinct from '1'::jsonb")
    expect(limits).toContain("'PT409','test_unpublish_draft_mismatch','wrong Draft parent'")
    expect(limits).toContain('classroom_id=cid,version=2147483647')
    expect(limits).toContain("'draft shortcut still fences attempt history'")
  })
  it('rolls back the irreversible lock probe before the pristine limits fixture',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const cases=sql.split('do $reject_cases$')[1].split('$reject_cases$;')[0]
    expect(cases).toMatch(/begin\s+update public\.tests set questions_locked_at=now\(\) where id=test_id;[\s\S]*?'locked questions'[\s\S]*?errcode='ZX261',message='rollback irreversible question-lock probe'[\s\S]*?exception when sqlstate 'ZX261' then null;end;/)
    const trigger=readFileSync('supabase/migrations/143_test_prompt_corrections_after_start.sql','utf8')
    expect(trigger).toContain('if old.questions_locked_at is not null then')
    expect(trigger).toContain('new.questions_locked_at := old.questions_locked_at;')
    const limits=sql.split('do $limits261$')[1].split('end;$limits261$;')[0]
    expect(limits).toContain("update public.tests t set status='closed',questions_locked_at=null where t.id=tid and t.classroom_id=cid;")
    expect(limits).toContain('get diagnostics restored=row_count')
    expect(limits).toContain("t.status='closed' and t.questions_locked_at is null")
    expect(sql).not.toMatch(/disable trigger|session_replication_role/)
  })
  it('rolls provider-fence evidence back instead of deleting retained bindings',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const provider=sql.split('do $provider_fence261$')[1].split('end;$provider_fence261$;')[0]
    expect(provider).not.toMatch(/delete from (?:private\.student_provider_cleanup_bindings|public\.student_purge_operations)/)
    expect(provider).toContain("'PT403','test_unpublish_fenced','pending provider-cleanup fence'")
    expect(provider).toContain("errcode='ZX261',message='rollback retained provider-fence evidence'")
    expect(provider).toContain("exception when sqlstate 'ZX261' then null;")
    expect(provider).toContain('baseline:=pg_temp.test_unpublication_graph(tid)')
    expect(provider).toContain('Provider fence rollback changed full graph')
    const migration=readFileSync('supabase/migrations/171_student_provider_cleanup_prerequisite.sql','utf8')
    expect(migration).toContain("if tg_op <> 'UPDATE' then")
    expect(migration).toContain("errcode='55000', message='student_provider_evidence_retained'")
    expect(migration).toContain('create trigger guard_student_provider_binding before update or delete')
    expect(sql).not.toMatch(/disable trigger|session_replication_role/)
  })
  it('preserves the exact10000-row projection in four top-level2500-row statements under one savepoint',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const count=sql.split('create temporary table unpublication_count261_baseline')[1].split('-- Pending provider cleanup')[0]
    const batches=[...count.matchAll(/insert into public\.test_questions\(([^)]*)\)\n select ([\s\S]*?) from generate_series\((\d+),(\d+)\) g;/g)]
    expect(batches).toHaveLength(4)
    expect(batches.map(batch=>[Number(batch[3]),Number(batch[4])])).toEqual([[1,2500],[2501,5000],[5001,7500],[7501,10000]])
    const generated=batches.flatMap(batch=>Array.from({length:Number(batch[4])-Number(batch[3])+1},(_,i)=>Number(batch[3])+i))
    expect(generated).toEqual(Array.from({length:10000},(_,i)=>i+1))
    for(const batch of batches){
      expect(batch[1]).toBe('id,test_id,artifact_id,question_type,question_text,options,correct_option,points,position')
      expect(batch[2]).toBe("md5('unpublish261-bound-row:'||g)::uuid,'a2610000-0000-4000-8000-000000000031'::uuid,md5('unpublish261-bound-artifact:'||g)::uuid,'open_response','Synthetic bound','[]',null,1,g+1")
    }
    expect(count.match(/^savepoint unpublication_count261;/gm)).toHaveLength(1)
    expect(count.match(/^rollback to savepoint unpublication_count261;/gm)).toHaveLength(1)
    expect(count.match(/^release savepoint unpublication_count261;/gm)).toHaveLength(1)
    expect(count).not.toMatch(/disable trigger|session_replication_role|pg_advisory|\bset (?:local )?role\b|\bcommit;|rollback count-only source/)
    const m=plan(),limits=m.contracts.frames.find(frame=>frame.label==='limits')!
    expect(limits.sql).toMatch(/end;\$limits261\$;[\s\S]*?savepoint unpublication_count261;\ninsert into public\.test_questions/)
    for(const label of ['limits-count-2501-5000','limits-count-5001-7500','limits-count-7501-10000']){
      const frame=m.contracts.frames.find(frame=>frame.label===label)!
      expect(frame.sql.match(/^insert into public\.test_questions/gm)).toHaveLength(1)
      expect(frame.sql).not.toMatch(/\bdo \$|\bbegin;|\brollback|\brelease|set_config/)
    }
    const trigger=readFileSync('supabase/migrations/112_versioned_course_blueprint_identity.sql','utf8')
    expect(trigger).toContain('create trigger touch_classroom_blueprint_source_from_test_questions_insert_delete\n  after insert or delete on public.test_questions\n  for each row execute function public.touch_classroom_blueprint_source_from_test_question();')
  })
  it('retains the pre-savepoint singleton full graph and restores exact original questions before unchanged fences',()=>{
    const sql=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const count=sql.split('create temporary table unpublication_count261_baseline')[1].split('-- Pending provider cleanup')[0]
    expect(count).toContain('(singleton boolean primary key check(singleton),graph jsonb not null) on commit drop;')
    const ordered=["insert into pg_temp.unpublication_count261_baseline(singleton,graph)\n select true,pg_temp.test_unpublication_graph('a2610000-0000-4000-8000-000000000031'::uuid);",
      "then raise exception 'Count fixture pristine question count differs';end if;",'savepoint unpublication_count261;',
      'generate_series(7501,10000)',"perform pg_temp.expect_unpublication_rejection(owner_id,tid,'PT503','test_unpublish_question_limit','more than10000 published rows');",
      'rollback to savepoint unpublication_count261;','release savepoint unpublication_count261;',
      'select graph into strict baseline from pg_temp.unpublication_count261_baseline where singleton;',
      "if pg_temp.test_unpublication_graph(tid) is distinct from baseline then raise exception 'Count fixture rollback changed full graph';end if;",
      "then raise exception 'Count fixture rollback changed original question rows';end if;",'drop table pg_temp.unpublication_count261_baseline;',
      'do $limits_fences261$',"'PT403','test_unpublish_fenced',flag","raise exception 'Stale-source rejection changed whole graph'"]
    let previous=-1
    for(const witness of ordered){expect(count).toContain(witness);const position=count.indexOf(witness);expect(position).toBeGreaterThan(previous);previous=position}
    expect(count).toContain('if (select count(*) from public.test_questions where test_id=tid)<>10002')
    expect(count).toContain("join generate_series(1,10000) g on q.id=md5('unpublish261-bound-row:'||g)::uuid where q.test_id=tid)<>10000")
    expect(count).toContain('if (select count(*) from public.test_questions where test_id=tid)<>2')
    expect(count).toContain("(select jsonb_agg(to_jsonb(q) order by q.id) from public.test_questions q where q.test_id=tid) is distinct from baseline->'questions'")
    expect(sql).toContain("n.nspname in('public','private','storage')")
    const restore=plan().contracts.frames.find(frame=>frame.label==='limits-count-restore')!
    expect(restore.sql).toContain('do $count_limit261$');expect(restore.sql).toContain('do $count_restored261$');expect(restore.sql).toContain('do $limits_fences261$')
  })
  it.each(['gap','unknown289',...[253,254,255,256,257,258,259,260,261,262].flatMap(n=>[`name${n}`,`digest${n}`,`bytes${n}`,`selfhash${n}`])])('rejects altered complete actual source %s',defect=>{
    const inventory=platform.loadAssignmentListReviewedMigrations(process.cwd()).map(m=>({...m}))
    if(defect==='gap') inventory.splice(100,1)
    if(defect==='unknown289') inventory.push({name:'289_unknown.sql',sql:'select 1;',sha256:digest('select 1;')})
    for(const n of [253,254,255,256,257,258,259,260,261,262]){
      if(defect===`name${n}`) inventory[n-1].name=`${n}_unknown.sql`
      if(defect===`digest${n}`) inventory[n-1].sha256='f'.repeat(64)
      if(defect===`bytes${n}`||defect===`selfhash${n}`) inventory[n-1].sql+='\n'
      if(defect===`selfhash${n}`) inventory[n-1].sha256=digest(inventory[n-1].sql)
    }
    const loader=vi.spyOn(platform,'loadAssignmentListReviewedMigrations').mockReturnValueOnce(inventory)
    try{expect(plan).toThrow()}finally{loader.mockRestore()}
  })
  it('keeps engine caps, backend cancellation, restoration and no programmable selectors',()=>{
    const m=buildTestOwnerUnpublicationNativeContractsManifest(original,'b'.repeat(40),process.cwd())
    expect(m.capabilities).toMatchObject({sessions:2,totalMs:900000,controlCalls:4000,actions:200})
    expect(m.privilege.expectedEvidence).toEqual({status:503,rpcCalls:1,rawCode:'42501'})
    expect(m.termination).toContain('backend_start');expect(m.termination).toContain('owned_pid')
    expect(m.privilege.restore).toContain('grant execute');expect(m.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
  })
  it('uses actual access and no-work AI writer locks with valid fixed prerequisites in the unchanged race matrix',()=>{
    const m=plan(),f=m.fixture,q=(v:string)=>`'${v}'::uuid`
    const tid=q(f.testId),owner=q(f.actors[0].id),member=q(f.actors[2].id)
    const work=m.concurrency.schedules[10],ai=m.concurrency.schedules[11],reverse=m.concurrency.schedules[13]
    const aiCall=`public.create_test_ai_grading_run_atomic(${tid},${owner},'synthetic-contract',array[${member}]::uuid[],array[]::uuid[],'held-unpublication-source',0,0,0,'[]'::jsonb,'[]'::jsonb,null)`
    expect(work.holderSql).toContain(`do $write$ begin perform public.update_test_student_access_atomic(${tid},array[${member}]::uuid[],'open',${owner});end;$write$;`)
    expect(ai.holderSql).toContain(`do $write$ declare acknowledgment jsonb;begin acknowledgment:=${aiCall};if acknowledgment is distinct from jsonb_build_object('outcome','noop','run_id',null) then raise exception 'Unpublication AI holder no-work outcome differs';end if;end;$write$;`)
    expect(reverse.rejectSql).toContain(`begin perform ${aiCall};succeeded:=true;`)
    for(const holder of [work.holderSql,ai.holderSql]){
      expect(holder).not.toMatch(/insert into public\.(?:test_student_availability|test_ai_grading_runs)|pg_advisory_xact_lock|start_test_attempt|set_config|set local (?!lock_timeout|statement_timeout|idle_in_transaction_session_timeout)/)
      expect(holder.match(/select jsonb_build_object\('held'/g)).toHaveLength(1)
      expect(holder).toContain(`hashtextextended('${f.testId}',0)`)
      for(const witness of ['l.pid=pg_backend_pid()','l.granted',"l.locktype='advisory'",'l.objsubid=1']) expect(holder).toContain(witness)
    }
    expect(work).toMatchObject({label:'work-access-before-unpublish',relation:'public.test_student_availability',code:'PT409'})
    expect(ai).toMatchObject({label:'ai-before-unpublish',relation:'public.test_ai_grading_runs',code:'PT409'})
    expect(reverse).toMatchObject({label:'unpublish-before-ai-create',relation:'public.tests',code:'55P03'})
    expect(f.actors[0].role).toBe('teacher');expect(f.actors[2].role).toBe('student')
    expect(f.classes.find(c=>c.id===f.classroomId)).toMatchObject({owner:f.actors[0].id,archived:false})
    expect(f.tests.find(t=>t.id===f.testId)).toMatchObject({classroom_id:f.classroomId,status:'closed',questions_locked_at:null,blueprint_archived_at:null})
    expect(f.enrollments).toContainEqual(expect.objectContaining({classroom_id:f.classroomId,student_id:f.actors[2].id}))
    expect(m.preparation).not.toMatch(/insert into public\.(?:test_attempts|test_responses|test_ai_grading_runs|test_ai_grading_run_items)\b/)
    expect(m.setup).toContain('or exists(select 1 from public.test_attempts where test_id in (')
    expect(m.setup).toContain("then raise exception 'Unpublication261 no-work fixture presence differs'")
    const inventory=platform.loadAssignmentListReviewedMigrations(process.cwd())
    const definitions=(schema:string,name:string)=>inventory.filter(migration=>new RegExp(`create (?:or replace )?function ${schema}\\.${name}\\(`,'i').test(migration.sql))
    const access=definitions('public','update_test_student_access_atomic').at(-1)!
    const grading=definitions('public','create_test_ai_grading_run_atomic').at(-1)!
    const parent=definitions('public','lock_test_parent_for_child_mutation').at(-1)!
    const lifecycle=definitions('private','lock_test_lifecycle').at(-1)!
    expect(access.name).toBe('248_test_conflict_http_status.sql');expect(grading.name).toBe('264_test_ai_grading_saved_work.sql')
    expect(parent.name).toBe('220_allow_started_test_mc_choice_text.sql');expect(lifecycle.name).toBe('244_test_attempt_revision_and_return_guards.sql')
    const body=(sql:string,name:string)=>sql.split(`function ${name}(`)[1].split('\n$$;')[0]
    const accessBody=body(access.sql,'public.update_test_student_access_atomic'),aiBody=body(grading.sql,'public.create_test_ai_grading_run_atomic')
    expect(accessBody).toContain('v_test := private.lock_test_lifecycle(p_test_id);')
    expect(accessBody.indexOf('v_test := private.lock_test_lifecycle(p_test_id);')).toBeLessThan(accessBody.indexOf('teacher_id = p_updated_by'))
    expect(accessBody).toContain("if v_test.status = 'draft' then");expect(accessBody).toContain('archived_at is null')
    expect(accessBody).toContain('cardinality(v_locked_student_ids) <> cardinality(v_student_ids)')
    const lifecycleBody=body(lifecycle.sql,'private.lock_test_lifecycle')
    expect(lifecycleBody).toContain('perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));')
    expect(lifecycleBody).toContain('from public.classrooms where id = v_classroom_id for update;')
    expect(lifecycleBody).toContain('from public.tests where id = p_test_id and classroom_id = v_classroom_id for update;')
    expect(lifecycleBody.indexOf('perform pg_advisory_xact_lock')).toBeLessThan(lifecycleBody.indexOf('from public.classrooms where id = v_classroom_id for update;'))
    expect(lifecycleBody.indexOf('from public.classrooms where id = v_classroom_id for update;')).toBeLessThan(lifecycleBody.indexOf('from public.tests where id = p_test_id and classroom_id = v_classroom_id for update;'))
    const parentBody=body(parent.sql,'public.lock_test_parent_for_child_mutation')
    expect(parentBody).toMatch(/from public\.classrooms classroom[\s\S]*?for update;[\s\S]*?from public\.tests test[\s\S]*?for update;/)
    expect(parentBody).not.toContain('pg_advisory_xact_lock')
    expect(aiBody).toContain('perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));')
    expect(aiBody.indexOf('perform pg_advisory_xact_lock')).toBeLessThan(aiBody.indexOf('into v_current_eligible_student_ids'))
    expect(aiBody).toContain('classroom.teacher_id = p_teacher_id');expect(aiBody).toContain('classroom.archived_at is null')
    expect(aiBody).toContain("raise exception 'Student is not enrolled in this classroom'")
    expect(aiBody).toContain('filter (where attempt.is_submitted = true)')
    expect(aiBody).toContain('into v_current_eligible_student_ids, v_current_submitted_student_ids')
    expect(aiBody).toContain('v_current_eligible_student_ids is not distinct from v_eligible_student_ids')
    expect(aiBody).toContain('v_current_submitted_student_ids is not distinct from v_eligible_student_ids')
    expect(aiBody).toContain('and (attempt.is_submitted = true or attempt.closed_for_grading_at is not null);')
    expect(aiBody).toContain("if v_item_count = 0 then\n    return jsonb_build_object('outcome', 'noop', 'run_id', null);\n  end if;")
    expect(aiBody.indexOf("'outcome', 'noop'")).toBeLessThan(aiBody.indexOf('insert into public.test_ai_grading_runs'))
    expect(m.concurrency.schedules.map(s=>s.label)).toEqual(['settings','test-advisory','classroom-operation','membership-operation','owner-parent-archive',
      'archive-revision','actor','test-parent','draft','question','work-access-before-unpublish','ai-before-unpublish','unpublish-before-work-access','unpublish-before-ai-create'])
    expect(m.contracts.frames.length+2*m.concurrency.schedules.length).toBe(39)
    for(const race of m.concurrency.schedules){expect(race.rejectSql).toContain('Rejected unpublication changed whole graph');expect(race.rejectSql).toContain('to_jsonb(r)')}
  })
  it('requires exact fixed receipts and closes sessions on success or failure',async()=>{
    const m=plan(),t=target(m,'contracts'),close=vi.fn(async()=>{}),execute=vi.fn(async (sql:string,_timeout:number)=>{
      const frame=m.contracts.frames.find(frame=>frame.sql===sql)!
      return [{result:frame.label==='contextual'?{checks:m.contracts.checks}:{frame:frame.label,transaction:'17'}}]
    })
    const d:DraftSaveDriver={verifyTarget:vi.fn(async()=>t),openSession:vi.fn(async name=>({name,execute,rollbackAndClose:close}))}
    expect(await runTestOwnerUnpublicationNativeContracts(m,t,d)).toEqual({checks:m.contracts.checks,nativeVerified:false})
    expect(execute.mock.calls.map(([sql])=>sql)).toEqual(m.contracts.frames.map(frame=>frame.sql))
    expect(d.openSession).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls.every(([,timeout])=>timeout<=12000)).toBe(true)
    execute.mockResolvedValueOnce([{result:{checks:[]}}]);await expect(runTestOwnerUnpublicationNativeContracts(m,t,d)).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(2);d.openSession=vi.fn()
    await expect(runTestOwnerUnpublicationNativeContracts(m,Object.freeze({...t,databasePort:54322}),d)).rejects.toThrow()
    await expect(runTestOwnerUnpublicationNativeContracts(m,Object.freeze({...t,acceptedManifestSha256:'0'.repeat(64)}),d)).rejects.toThrow()
    await expect(runTestOwnerUnpublicationNativeContracts(Object.freeze({...m,sourceSha256:'0'.repeat(64)}),t,d)).rejects.toThrow()
    expect(d.openSession).not.toHaveBeenCalled()
  })
  it('reconstructs exact monolithic bytes from eleven closed frames',()=>{
    const m=plan(),labels=['initialize','success','rejections','limits','limits-count-2501-5000','limits-count-5001-7500',
      'limits-count-7501-10000','limits-count-restore','provider','acl','contextual']
    expect(digest(readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8'))).toBe('96e7b1c58e456b0775b74d8511e3415ccc21e19d9aae7355f46f2806dc3edf88')
    expect(m.contracts.frames.map(frame=>frame.label)).toEqual(labels)
    const source=m.contracts.frames.map((frame,index)=>index===m.contracts.frames.length-1?frame.sql:frame.sql.replace(
      `\nselect jsonb_build_object('frame','${labels[index]}','transaction',txid_current()::text) as result;`,''))
    expect(source.join('')).toBe(m.contracts.sql)
    expect(source[0]).toMatch(/^begin;/)
    expect(source.slice(1).every(sql=>!/^begin;/.test(sql))).toBe(true)
    expect(source.slice(0,-1).every(sql=>!sql.trimEnd().endsWith('rollback;'))).toBe(true)
    expect(source.at(-1)).toMatch(/rollback;$/)
    expect(m.contracts.frames.length+2*m.concurrency.schedules.length).toBeLessThanOrEqual(m.caps.dispatches)
    expect(m.concurrency.schedules).toHaveLength(14)
    expect(m.caps).toMatchObject({requestMs:12000,totalMs:180000,dispatches:40,sqlBytes:524288,responseBytes:8388608})
    expect(Object.isFrozen(m.contracts.frames)).toBe(true)
    expect(m.contracts.frames.every(Object.isFrozen)).toBe(true)
    expect(validateTestOwnerUnpublicationNativePlanSql(Object.freeze({...m,contracts:Object.freeze({...m.contracts,frames:[]})}),m.contracts.frames[0].sql)).toBe(false)
  })
  it.each(['missing','duplicate','order','outer-order'])('refuses fixed contract boundary %s drift',defect=>{
    const source=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8')
    const marker='\ndo $reject_cases$\n',other='\n-- Additional255/261 parity limits run before the intentional late status fault.\n'
    const altered=defect==='outer-order'?source.replace('-- owner-unpublication-contracts-begin','__outer_boundary__').replace('-- owner-unpublication-contracts-end','-- owner-unpublication-contracts-begin').replace('__outer_boundary__','-- owner-unpublication-contracts-end')
      :defect==='missing'?source.replace(marker,'\ndo $changed$\n'):defect==='duplicate'?source.replace(marker,marker+marker)
      :source.replace(marker,'__fixed_boundary__').replace(other,marker).replace('__fixed_boundary__',other)
    const mocked=vi.mocked(readFileSync),actual=mocked.getMockImplementation()!
    mocked.mockImplementation(((path,...args)=>
      String(path).endsWith('/scripts/check-contextual-test-owner-unpublication.sql')?altered:actual(path,...args)) as typeof readFileSync)
    try{expect(plan).toThrow()}finally{mocked.mockImplementation(actual)}
  })
  it.each(['rows2501-5000.','rows5001-7500.','rows7501-10000.','rejection and savepoint restoration.'])('rejects every new closed count boundary drift: %s',suffix=>{
    const source=readFileSync('scripts/check-contextual-test-owner-unpublication.sql','utf8'),marker=`\n-- Count-only fixture ${suffix}\n`
    const other='\n-- Pending provider cleanup is only a relational fence; no provider is called.\n'
    for(const defect of ['missing','duplicate','order']){
      const altered=defect==='missing'?source.replace(marker,'\n-- Changed count boundary.\n'):defect==='duplicate'?source.replace(marker,marker+marker)
        :source.replace(marker,'__fixed_count_boundary__').replace(other,marker).replace('__fixed_count_boundary__',other)
      const mocked=vi.mocked(readFileSync),actual=mocked.getMockImplementation()!
      mocked.mockImplementation(((path,...args)=>String(path).endsWith('/scripts/check-contextual-test-owner-unpublication.sql')?altered:actual(path,...args)) as typeof readFileSync)
      try{expect(plan).toThrow()}finally{mocked.mockImplementation(actual)}
    }
  })
  it.each(['malformed','order','transaction','throw','final','count-malformed','count-order','count-transaction','count-throw','count-restore-throw'])('stops at failed contract frame and finally closes: %s',defect=>{
    const m=plan(),close=vi.fn(async()=>{}),kind=defect.replace(/^count-(?:restore-)?/,'')
    const failed=defect==='final'?m.contracts.frames.length-1:failureFrame()
    function failureFrame(){return defect==='count-restore-throw'?m.contracts.frames.findIndex(frame=>frame.label==='limits-count-restore')
      :defect.startsWith('count-')?m.contracts.frames.findIndex(frame=>frame.label==='limits-count-2501-5000'):2}
    const execute=vi.fn(async (sql:string)=>{
      const index=m.contracts.frames.findIndex(frame=>frame.sql===sql),frame=m.contracts.frames[index]
      if(index===failed){if(kind==='throw')throw Error('modeled frame failure')
        if(defect==='final')return [{result:{checks:[]}}]
        return [{result:kind==='malformed'?{frame:frame.label}:kind==='order'?{frame:'limits',transaction:'17'}:{frame:frame.label,transaction:'18'}}]}
      return [{result:{frame:frame.label,transaction:'17'}}]
    }),d:DraftSaveDriver={verifyTarget:async()=>target(m,'contracts'),openSession:async name=>({name,execute,rollbackAndClose:close})}
    return expect(runTestOwnerUnpublicationNativeContracts(m,target(m,'contracts'),d)).rejects.toThrow().then(()=>{
      expect(execute).toHaveBeenCalledTimes(failed+1);expect(close).toHaveBeenCalledTimes(1)
    })
  })
  it('uses one aggregate180s clock instead of renewing time for each frame',async()=>{
    const m=plan(),t=target(m,'contracts'),close=vi.fn(async()=>{});let now=1000
    const clock=vi.spyOn(Date,'now').mockImplementation(()=>now),execute=vi.fn(async (sql:string)=>{
      const frame=m.contracts.frames.find(frame=>frame.sql===sql)!;now+=11000
      return[{result:{frame:frame.label,transaction:'17'}}]
    }),d:DraftSaveDriver={verifyTarget:async()=>{now+=20000;return t},openSession:async name=>({name,execute,rollbackAndClose:close})}
    try{await expect(runTestOwnerUnpublicationNativeContracts(m,t,d)).rejects.toThrow()
      expect(execute).toHaveBeenCalledTimes(5);expect(close).toHaveBeenCalledTimes(1)
    }finally{clock.mockRestore()}
  })
  it('validates reached-holder transaction/backend/scope receipts and closes both mock sessions',async()=>{
    const m=plan(),t=target(m,'concurrency'),close=vi.fn(async()=>{})
    const d:DraftSaveDriver={verifyTarget:vi.fn(async()=>t),openSession:vi.fn(async name=>({name,rollbackAndClose:close,execute:async sql=>{
      const s=m.concurrency.schedules.find(s=>s.holderSql===sql||s.rejectSql===sql)!
      return[{result:s.holderSql===sql?{held:true,transaction:true,scope:true,backend_pid:11,application_name:name,label:s.label,relation:s.relation}
        :{rejected:true,code:s.code,rows_unchanged:true,label:s.label}}]
    }}))}
    expect((await runTestOwnerUnpublicationNativeRaces(m,t,d)).outcomes).toHaveLength(m.concurrency.schedules.length)
    expect(close).toHaveBeenCalledTimes(2*m.concurrency.schedules.length)
    d.openSession=vi.fn(async name=>({name,rollbackAndClose:close,execute:async()=>[{result:{held:false}}]}))
    await expect(runTestOwnerUnpublicationNativeRaces(m,t,d)).rejects.toThrow();expect(close).toHaveBeenCalledTimes(2*m.concurrency.schedules.length+2)
  })
})

describe('complete reviewed268 source profile (offline)', () => {
  it.each([263, 264, 265, 266, 267, 268])('accepts exact complete source profile %i', count => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).slice(0, count)
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).not.toThrow() } finally { loader.mockRestore() }
  })
  it.each([263, 264, 265, 266, 267, 268].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))('rejects altered migration $number: $defect', ({ number, defect }) => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    const tail = migrations[number - 1]
    if (defect === 'name') tail.name = `${number}_unknown.sql`
    if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
    if (defect === 'self-hashed-bytes') tail.sha256 = createHash('sha256').update(tail.sql).digest('hex')
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
  it('rejects a contiguous unknown289 source tail', () => {
    const migrations = platform.loadAssignmentListReviewedMigrations(process.cwd()).map(migration => ({ ...migration }))
    migrations.push({ name: '289_unknown.sql', sql: 'select 1;', sha256: createHash('sha256').update('select 1;').digest('hex') })
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    try { expect(() => plan()).toThrow() } finally { loader.mockRestore() }
  })
})
