#!/usr/bin/env node
// Proposed definitions and synthetic data exist only inside a rolled-back
// transaction. This rehearsal applies no migration and changes no rollout gate.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const definition = readFileSync(new URL('../supabase/migrations/233_contextual_announcement_member_receipts.sql', import.meta.url), 'utf8')
const tag = `ann_receipt_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), member = randomUUID(), teacherMember = randomUUID(), outsider = randomUUID()
const classroom = randomUUID(), emptyClassroom = randomUUID(), missingClassroom = randomUUID()
const first = `10000000${randomUUID().slice(8)}`, last = `f0000000${randomUUID().slice(8)}`
const run = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { input, encoding: 'utf8', timeout: 45_000 }).trim()
const signature = 'public.mark_announcements_read_for_member_v1(uuid,uuid,timestamptz)'
const installed = run(`select to_regprocedure('${signature}') is not null;`)
assert(['t', 'f'].includes(installed))
// Resource IDs are random but ordered for the late-failure proof. The entire
// fixture is rolled back even on failure.
console.log(run(`
set statement_timeout='30s'; set lock_timeout='4s'; begin;
${installed === 'f' ? definition : ''}
insert into public.users(id,email,role) values
 ('${owner}','${tag}_owner@example.invalid','student'),
 ('${member}','${tag}_member@example.invalid','student'),
 ('${teacherMember}','${tag}_teacher@example.invalid','teacher'),
 ('${outsider}','${tag}_outsider@example.invalid','teacher');
set local role service_role;
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),'${owner}','classrooms.create',
 'manual',true,clock_timestamp(),null,2,'test:announcement-receipt','${tag}',
 coalesce((select revision from public.effective_feature_entitlements where subject_user_id='${owner}' and feature_key='classrooms.create'),0));
reset role;
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('${classroom}','${owner}','${tag}','${tag}_c'),('${emptyClassroom}','${owner}','${tag} empty','${tag}_e');
insert into public.classroom_enrollments(classroom_id,student_id) values
 ('${classroom}','${member}'),('${classroom}','${teacherMember}'),('${classroom}','${owner}'),
 ('${emptyClassroom}','${member}');
insert into public.announcements(id,classroom_id,created_by,content,is_draft,published_at,scheduled_for) values
 ('${first}','${classroom}','${owner}','immediate',false,'2099-01-01Z',null),
 ('${last}','${classroom}','${owner}','equal cutoff',false,'2020-01-01Z','2020-01-01Z');
insert into public.announcements(classroom_id,created_by,content,is_draft,published_at,scheduled_for) values
 ('${classroom}','${owner}','future',false,'2099-01-01Z','2099-01-01Z'),
 ('${classroom}','${owner}','draft',true,null,null);

create function pg_temp.assert_denied(actor uuid, classroom uuid, expected text) returns void
 language plpgsql as $assert$ begin
 begin perform public.mark_announcements_read_for_member_v1(actor,classroom,'2020-01-01Z');
 exception when others then if sqlstate=expected then return; end if; raise; end;
 raise exception 'Expected denial %, receipt operation was admitted', expected;
 end $assert$;
do $test$
declare result jsonb; before_reads jsonb; before_revision bigint; operation uuid;
 archive_operation uuid; archive_id uuid; fence_class uuid; fence_actor uuid;
begin
 if has_function_privilege('anon','${signature}','execute')
  or has_function_privilege('authenticated','${signature}','execute')
  or not has_function_privilege('service_role','${signature}','execute')
  or not exists(select 1 from pg_proc where oid=to_regprocedure('${signature}')
   and prosecdef and proconfig @> array['search_path=""']::text[]) then
  raise exception 'Receipt ACL or security metadata contract failed'; end if;
 perform pg_temp.assert_denied('${owner}','${classroom}','42501');
 perform pg_temp.assert_denied('${outsider}','${classroom}','42501');
 perform pg_temp.assert_denied('${teacherMember}','${emptyClassroom}','42501');
 perform pg_temp.assert_denied('${member}','${missingClassroom}','P0002');
 perform pg_temp.assert_denied(null,'${classroom}','22023');
 begin perform public.mark_announcements_read_for_member_v1('${member}','${classroom}','infinity');
  raise exception 'Infinite cutoff admitted'; exception when sqlstate '22023' then null; end;
 result := public.mark_announcements_read_for_member_v1('${teacherMember}','${classroom}','2020-01-01Z');
 if result <> jsonb_build_object('actor_id','${teacherMember}'::uuid,'classroom_id','${classroom}'::uuid,'marked',2,'inserted',2)
  then raise exception 'Cross-role receipt or publication contract failed: %',result; end if;
 select jsonb_agg(to_jsonb(r) order by id) into before_reads from public.announcement_reads r where user_id='${teacherMember}';
 select revision into before_revision from public.classroom_archive_revisions where classroom_id='${classroom}';
 result := public.mark_announcements_read_for_member_v1('${teacherMember}','${classroom}','2020-01-01Z');
 if result->>'marked'<>'2' or result->>'inserted'<>'0'
  or before_reads is distinct from (select jsonb_agg(to_jsonb(r) order by id) from public.announcement_reads r where user_id='${teacherMember}')
  or (select revision from public.classroom_archive_revisions where classroom_id='${classroom}') <> before_revision+2 then
  raise exception 'Repeat count/read_at or legacy duplicate revision behavior changed'; end if;
 result := public.mark_announcements_read_for_member_v1('${member}','${emptyClassroom}','2020-01-01Z');
 if result->>'marked'<>'0' or result->>'inserted'<>'0' then raise exception 'Empty contract failed'; end if;
 update public.classrooms set archived_at=clock_timestamp() where id='${emptyClassroom}';
 perform pg_temp.assert_denied('${member}','${emptyClassroom}','42501');
 update public.classrooms set archived_at=null where id='${emptyClassroom}';

 -- Real committed-fence shapes, but only within rollback subtransactions.
 foreach fence_class in array array['${emptyClassroom}'::uuid,'${classroom}'::uuid] loop
  fence_actor := case when fence_class='${classroom}' then '${teacherMember}'::uuid else '${member}'::uuid end;
  begin
   operation:=gen_random_uuid();
   insert into public.classroom_purge_operations(id,teacher_id,classroom_id,classroom_title,
    request_sha256,status,source_revision,impact_summary,retryable,error_code)
    values(operation,'${owner}',fence_class,'${tag}',repeat('9',64),'failed',1,'{}',true,'database_finalize_failed');
   insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id)
    values(fence_class,operation,'${owner}');
   perform pg_temp.assert_denied(fence_actor,fence_class,'PT409');
   raise exception using errcode='ZX001',message='rollback fence';
  exception when sqlstate 'ZX001' then null; end;
  begin
  insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,installation_ref,roster_ref,actor_principal_ref)
   values(gen_random_uuid(),fence_class,'${owner}','${tag}','${tag}','${tag}');
  perform pg_temp.assert_denied(fence_actor,fence_class,'PT409');
  raise exception using errcode='ZX001',message='rollback fence';
 exception when sqlstate 'ZX001' then null; end;
 begin
  operation:=gen_random_uuid();
  insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,request_sha256,source_revision)
   values(operation,'${owner}',fence_class,fence_actor,repeat('9',64),repeat('8',64),1);
  insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id)
   values(fence_class,fence_actor,operation,'${owner}');
  perform pg_temp.assert_denied(fence_actor,fence_class,'PT409');
  raise exception using errcode='ZX001',message='rollback fence';
 exception when sqlstate 'ZX001' then null; end;
 end loop;
 -- An actual cold-purge fence denies before missing-hot-class lookup. The
 -- archive metadata is synthetic rollback-only; no Storage object is touched.
 begin
  operation:=gen_random_uuid(); archive_operation:=gen_random_uuid(); archive_id:=gen_random_uuid();
  insert into public.classroom_archive_operations(id,teacher_id,classroom_id,operation_type,request_sha256,status,
   source_revision,source_schema_migration,source_app_commit,retention,snapshot_created_at,snapshot_expires_at)
   values(archive_operation,'${owner}','${missingClassroom}','export',repeat('1',64),'completed',1,'233','fixture','{}',
    clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute');
  insert into public.classroom_archives(id,operation_id,classroom_id,teacher_id,format,format_version,
   source_revision,source_schema_migration,source_app_commit,storage_bucket,storage_path,artifact_sha256,content_sha256,
   compressed_byte_size,uncompressed_byte_size,resource_counts,storage_object_counts,verification,retention,created_at,verified_at)
   values(archive_id,archive_operation,'${missingClassroom}','${owner}','pika.classroom-archive',1,1,'233','fixture',
    'classroom-archives','${tag}/rollback.tar.gz',repeat('a',64),repeat('b',64),1,1,'{}','{}','{}','{}',
    clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute');
  insert into public.classroom_cold_tombstones(classroom_id,teacher_id,archive_id,title,archived_at,source_revision)
   values('${missingClassroom}','${owner}',archive_id,'${tag}',clock_timestamp()-interval '3 minutes',1);
  insert into public.classroom_purge_operations(id,teacher_id,classroom_id,request_sha256,status,source_revision,impact_summary)
   values(operation,'${owner}','${missingClassroom}',repeat('9',64),'inventorying',1,'{}');
  insert into public.cold_classroom_purge_fences(classroom_id,operation_id,teacher_id,archive_id)
   values('${missingClassroom}',operation,'${owner}',archive_id);
  perform pg_temp.assert_denied('${member}','${missingClassroom}','PT409');
  raise exception using errcode='ZX001',message='rollback cold fence';
 exception when sqlstate 'ZX001' then null; end;
end $test$;

-- Failure on the second ordered insert must undo the first receipt AND both
-- BEFORE INSERT archive revision effects, before the outer fixture rollback.
create function pg_temp.receipt_fault() returns trigger language plpgsql as $fault$
begin if new.announcement_id='${last}' and new.user_id='${member}' then
 raise exception using errcode='ZX002',message='late receipt failure'; end if; return new; end $fault$;
create trigger zzzz_receipt_fault before insert on public.announcement_reads for each row execute function pg_temp.receipt_fault();
do $test$ declare revision_before bigint; begin
 select revision into revision_before from public.classroom_archive_revisions where classroom_id='${classroom}';
 begin perform public.mark_announcements_read_for_member_v1('${member}','${classroom}','2020-01-01Z');
  raise exception 'Late fault did not execute'; exception when sqlstate 'ZX002' then null; end;
 if exists(select 1 from public.announcement_reads where user_id='${member}')
  or revision_before is distinct from (select revision from public.classroom_archive_revisions where classroom_id='${classroom}') then
  raise exception 'Late failure left partial receipt/revision effects'; end if;
end $test$;
drop trigger zzzz_receipt_fault on public.announcement_reads;
create function pg_temp.receipt_suppress() returns trigger language plpgsql as $fault$
begin if new.user_id='${member}' then return null; end if; return new; end $fault$;
create trigger zzzz_receipt_suppress before insert on public.announcement_reads for each row execute function pg_temp.receipt_suppress();
do $test$ declare revision_before bigint; begin
 select revision into revision_before from public.classroom_archive_revisions where classroom_id='${classroom}';
 perform pg_temp.assert_denied('${member}','${classroom}','PT409');
 if exists(select 1 from public.announcement_reads where user_id='${member}')
  or revision_before is distinct from (select revision from public.classroom_archive_revisions where classroom_id='${classroom}') then
  raise exception 'Suppressed receipt left partial effects'; end if;
end $test$;
drop trigger zzzz_receipt_suppress on public.announcement_reads;
create function pg_temp.receipt_redirect() returns trigger language plpgsql as $fault$
begin if new.user_id='${member}' then new.user_id:='${teacherMember}'; end if; return new; end $fault$;
create trigger zzzz_receipt_redirect before insert on public.announcement_reads for each row execute function pg_temp.receipt_redirect();
do $test$ declare revision_before bigint; receipts_before jsonb; begin
 select revision into revision_before from public.classroom_archive_revisions where classroom_id='${classroom}';
 select jsonb_agg(to_jsonb(r) order by id) into receipts_before from public.announcement_reads r
  where user_id in ('${member}','${teacherMember}');
 perform pg_temp.assert_denied('${member}','${classroom}','PT409');
 if receipts_before is distinct from (select jsonb_agg(to_jsonb(r) order by id) from public.announcement_reads r
   where user_id in ('${member}','${teacherMember}'))
  or revision_before is distinct from (select revision from public.classroom_archive_revisions where classroom_id='${classroom}') then
  raise exception 'Redirected receipt left partial effects'; end if;
end $test$;
drop trigger zzzz_receipt_redirect on public.announcement_reads;
insert into public.announcements(classroom_id,created_by,content,is_draft,published_at)
 select '${classroom}','${owner}','bulk '||n,false,'2020-01-01Z' from generate_series(1,1001) n;
set local role service_role;
do $test$ declare result jsonb; begin
 result:=public.mark_announcements_read_for_member_v1('${member}','${classroom}','2020-01-01Z');
 if result->>'marked'<>'1003' or result->>'inserted'<>'1003'
  or (select count(*) from public.announcement_reads where user_id='${member}')<>1003 then
  raise exception 'Complete-set receipt operation failed: %',result; end if;
end $test$;
reset role; rollback;
select 'PASS rollback receipt authorization/publication/count/ACL/fence/atomicity contracts';
`))
assert.equal(run(`select
 (select count(*) from public.users where id in ('${owner}','${member}','${teacherMember}','${outsider}'))+
 (select count(*) from public.classrooms where id in ('${classroom}','${emptyClassroom}'))+
 (select count(*) from public.account_plan_audit where subject_user_id in ('${owner}','${member}','${teacherMember}','${outsider}'))+
 (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in ('${owner}','${member}','${teacherMember}','${outsider}'));`), '0')
assert.equal(run(`select to_regprocedure('${signature}') is not null;`), installed)
console.log('PASS zero fixture/audit residue; no schema or migration history applied')
