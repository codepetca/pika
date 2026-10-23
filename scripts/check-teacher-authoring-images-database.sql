-- Rollback-only migration291 behavior proof. Run only on an explicitly approved
-- disposable/local database after 291 is applied, as postgres, in a fresh session.
-- All fixtures, storage metadata and temporary helpers roll back. This does not
-- upload/delete bytes, activate cleanup, dispatch grading, or use existing rows.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local timezone = 'UTC';

create function pg_temp.authoring_fixture_id(p_number integer)
returns uuid language sql immutable as $$
  select ('c2910000-0000-4000-8000-' || lpad(p_number::text,12,'0'))::uuid
$$;
create function pg_temp.authoring_fixture_url(p_number integer)
returns text language sql immutable as $$
  select '/api/storage/authoring-images?object_id=' || pg_temp.authoring_fixture_id(p_number)::text
$$;
create function pg_temp.assert_authoring(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception '%',p_message; end if;
end;
$$;

-- Inspect real privilege/RLS state; no grants or policy changes are used to make
-- the proof pass. Function EXECUTE checks include inherited PUBLIC privileges.
do $boundary$
declare role_name text; operation text; signature text;
begin
  if current_user <> 'postgres' then raise exception 'Proof requires postgres'; end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
  then raise exception 'Proof must start outside archive maintenance'; end if;
  if not (select relrowsecurity from pg_class
      where oid='public.teacher_authoring_image_references'::regclass)
    or exists (select 1 from pg_policy
      where polrelid='public.teacher_authoring_image_references'::regclass)
  then raise exception 'Authoring ledger RLS/default-deny contract changed'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach operation in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name,'public.teacher_authoring_image_references',operation)
      then raise exception '% unexpectedly has ledger %',role_name,operation; end if;
    end loop;
    if has_table_privilege(role_name,'public.teacher_authoring_image_references','SELECT')
      is distinct from (role_name='service_role')
    then raise exception '% ledger read boundary changed',role_name; end if;
    foreach signature in array array[
      'public.sync_teacher_authoring_image_references()',
      'public.queue_removed_teacher_authoring_image()'
    ] loop
      if has_function_privilege(role_name,signature,'EXECUTE')
      then raise exception '% can execute internal trigger %',role_name,signature; end if;
    end loop;
  end loop;
  raise notice 'Initial maintenance settings: restore=%, compaction=%',
    current_setting('pika.classroom_archive_restore',true),
    current_setting('pika.classroom_archive_compaction',true);
end;
$boundary$;

insert into public.users(id,email,role) values
 (pg_temp.authoring_fixture_id(1),'authoring291-owner@example.invalid','teacher'),
 (pg_temp.authoring_fixture_id(2),'authoring291-other@example.invalid','teacher'),
 (pg_temp.authoring_fixture_id(3),'authoring291-student@example.invalid','student');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),
 pg_temp.authoring_fixture_id(1),'classrooms.create','manual',true,
 clock_timestamp(),null,10,'test:teacher-authoring-images','authoring_images_rollback',0);
insert into public.classrooms(id,teacher_id,title,class_code) values
 (pg_temp.authoring_fixture_id(10),pg_temp.authoring_fixture_id(1),'Authoring images proof','C291IMG1'),
 (pg_temp.authoring_fixture_id(11),pg_temp.authoring_fixture_id(1),'Other authoring classroom','C291IMG2');
insert into public.classroom_enrollments(classroom_id,student_id)
 values (pg_temp.authoring_fixture_id(10),pg_temp.authoring_fixture_id(3));
insert into public.assignments(id,classroom_id,title,due_at,created_by,instructions_markdown)
 values (pg_temp.authoring_fixture_id(20),pg_temp.authoring_fixture_id(10),
 'Authoring assignment',clock_timestamp()+interval '1 day',pg_temp.authoring_fixture_id(1),'');
insert into public.classwork_materials(id,classroom_id,title,created_by,content) values
 (pg_temp.authoring_fixture_id(30),pg_temp.authoring_fixture_id(10),'Shared material',
 pg_temp.authoring_fixture_id(1),'{"type":"doc","content":[]}');
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values
 (pg_temp.authoring_fixture_id(40),pg_temp.authoring_fixture_id(10),'Graph replacement','draft',1,pg_temp.authoring_fixture_id(1)),
 (pg_temp.authoring_fixture_id(50),pg_temp.authoring_fixture_id(10),'Snapshot pin','draft',1,pg_temp.authoring_fixture_id(1));

-- Reserve using the actual protocol, then verify actual storage metadata.
-- 103 is valid in another classroom; 104 deliberately remains reserved;
-- 105 is verified then queued; 106 is a different managed-object purpose.
do $objects$
declare n integer; object_id uuid; classroom_id uuid; object_purpose text; object_path text;
begin
  for n in select generate_series(100,110) union all select generate_series(120,130) loop
    object_id:=pg_temp.authoring_fixture_id(n);
    classroom_id:=pg_temp.authoring_fixture_id(case when n=103 then 11 else 10 end);
    object_purpose:=case when n in (106,129) then 'teacher_test_material' else 'teacher_authoring_image' end;
    object_path:='teacher-authoring-proof/' || object_id::text || '.png';
    perform public.begin_managed_storage_upload(object_id,'test-documents',object_path,
      classroom_id,null,null,object_purpose,pg_temp.authoring_fixture_id(1),null,
      'classroom',classroom_id,'image/png',4);
    insert into storage.objects(bucket_id,name,metadata)
      values ('test-documents',object_path,'{"mimetype":"image/png","size":4}');
    if n<>104 then perform public.verify_managed_storage_upload(object_id,repeat('a',64)); end if;
    if n=105 then
      perform pg_temp.assert_authoring(public.queue_managed_storage_cleanup(object_id,'fixture_pending'),
        'Fixture cleanup status was not established');
    end if;
  end loop;
end;
$objects$;

-- Do this BEFORE setting either maintenance GUC. On a fresh session the helper
-- returns NULL for absent GUCs: ordinary removal must still queue cleanup.
-- If the session defaults explicitly set off, this still checks ordinary cleanup;
-- the notice above records whether the additional NULL case was exercised.
update public.assignments set instructions_markdown='![Default cleanup](' || pg_temp.authoring_fixture_url(100) || ')'
 where id=pg_temp.authoring_fixture_id(20);
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(100)),'Same-class verified attachment did not become ready');
select pg_temp.assert_authoring(exists(select 1 from public.teacher_authoring_image_references
 where owner_table='assignments' and owner_id=pg_temp.authoring_fixture_id(20)
 and managed_object_id=pg_temp.authoring_fixture_id(100)),'Attachment ledger was not written atomically');
update public.assignments set instructions_markdown='' where id=pg_temp.authoring_fixture_id(20);
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(100)),'Removal queued cleanup before deferred evaluation');
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='cleanup_pending'
 and cleanup_reason_code='authoring_image_reference_removed' and next_attempt_at>clock_timestamp()+interval '59 minutes'
 and next_attempt_at<=clock_timestamp()+interval '1 hour' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(100)),'Normal/default-NULL maintenance state suppressed cleanup');
set local pika.classroom_archive_restore='off';
set local pika.classroom_archive_compaction='off';

-- Force deferred boundaries between real Survey question writes. These model the
-- separate Q1/Q2 PATCH transactions without committing any proof fixture.
insert into public.surveys(id,classroom_id,title,status,position,created_by)
 values(pg_temp.authoring_fixture_id(60),pg_temp.authoring_fixture_id(10),'Sequential image saves','draft',0,pg_temp.authoring_fixture_id(1));
insert into public.survey_questions(id,survey_id,question_type,question_text,position) values
 (pg_temp.authoring_fixture_id(61),pg_temp.authoring_fixture_id(60),'short_text','![First](' || pg_temp.authoring_fixture_url(120) || ')',0),
 (pg_temp.authoring_fixture_id(62),pg_temp.authoring_fixture_id(60),'short_text','![Second](' || pg_temp.authoring_fixture_url(121) || ')',1);
update public.survey_questions set question_text='Temporarily empty' where id=pg_temp.authoring_fixture_id(61);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='cleanup_pending' and cleanup_reason_code='authoring_image_reference_removed'
 and next_attempt_at>clock_timestamp()+interval '59 minutes' and next_attempt_at<=clock_timestamp()+interval '1 hour'
 and attempt_count=0 and lease_token is null and lease_expires_at is null and ready_at is not null and verified_at is not null
 from public.managed_storage_objects where id=pg_temp.authoring_fixture_id(120)),
 'Last Survey reference removal did not establish the bounded one-hour retention window');
-- The second PATCH moves the last reference and queues the other image. The
-- third PATCH completes the swap after the first image has already been queued.
update public.survey_questions set question_text='![Moved](' || pg_temp.authoring_fixture_url(120) || ')' where id=pg_temp.authoring_fixture_id(62);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='ready' and cleanup_reason_code is null from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(120)) and (select status='cleanup_pending' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(121)), 'Sequential Survey move failed to revive only the retained image');
update public.survey_questions set question_text='![Swapped](' || pg_temp.authoring_fixture_url(121) || ')' where id=pg_temp.authoring_fixture_id(61);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select count(*)=2 from public.managed_storage_objects where id in
 (pg_temp.authoring_fixture_id(120),pg_temp.authoring_fixture_id(121)) and status='ready' and cleanup_reason_code is null)
 and exists(select 1 from public.teacher_authoring_image_references where owner_id=pg_temp.authoring_fixture_id(61) and managed_object_id=pg_temp.authoring_fixture_id(121))
 and exists(select 1 from public.teacher_authoring_image_references where owner_id=pg_temp.authoring_fixture_id(62) and managed_object_id=pg_temp.authoring_fixture_id(120)),
 'Sequential Survey image swap did not preserve both identities');
-- Undo restores a removed image after cleanup has been queued, and clears the
-- prior removal diagnostics rather than preserving stale error/reason state.
update public.survey_questions set question_text='Removed for Undo' where id=pg_temp.authoring_fixture_id(61);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
update public.managed_storage_objects set last_error_code='fixture_previous_error' where id=pg_temp.authoring_fixture_id(121);
update public.survey_questions set question_text='![Undo](' || pg_temp.authoring_fixture_url(121) || ')' where id=pg_temp.authoring_fixture_id(61);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='ready' and cleanup_reason_code is null and last_error_code is null
 and attempt_count=0 and lease_token is null and lease_expires_at is null from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(121)), 'Undo did not restore the unclaimed retained image cleanly');

-- These are valid stored states, not claims against unrelated objects. Every
-- negative case gets its own identity and the existing protocol remains intact.
do $retention_states$
declare n integer;
begin
 for n in 122..130 loop
  perform public.managed_storage_mark_ready(pg_temp.authoring_fixture_id(n));
  perform public.queue_managed_storage_cleanup(pg_temp.authoring_fixture_id(n),'authoring_image_reference_removed');
  update public.managed_storage_objects set next_attempt_at=clock_timestamp()+interval '1 hour'
    where id=pg_temp.authoring_fixture_id(n);
 end loop;
 update public.managed_storage_objects set next_attempt_at=clock_timestamp()-interval '1 second' where id=pg_temp.authoring_fixture_id(122);
 update public.managed_storage_objects set status='cleanup_processing',attempt_count=1,lease_token=pg_temp.authoring_fixture_id(900),lease_expires_at=clock_timestamp()+interval '2 minutes' where id=pg_temp.authoring_fixture_id(123);
 update public.managed_storage_objects set attempt_count=1 where id=pg_temp.authoring_fixture_id(124);
 update public.managed_storage_objects set cleanup_reason_code='fixture_pending' where id=pg_temp.authoring_fixture_id(125);
 update public.managed_storage_objects set verified_at=null where id=pg_temp.authoring_fixture_id(126);
 update public.managed_storage_objects set ready_at=null where id=pg_temp.authoring_fixture_id(127);
 update public.managed_storage_objects set status='deleted',deleted_at=clock_timestamp() where id=pg_temp.authoring_fixture_id(128);
 update public.managed_storage_objects set status='cleanup_processing',attempt_count=1,lease_token=pg_temp.authoring_fixture_id(901),lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.authoring_fixture_id(130);
 -- Pending rows cannot carry leases even before the narrower feature predicate.
 begin
  update public.managed_storage_objects set lease_token=pg_temp.authoring_fixture_id(902),lease_expires_at=clock_timestamp()+interval '1 minute' where id=pg_temp.authoring_fixture_id(125);
  raise exception 'Pending object accepted a claim lease';
 exception when check_violation then null;end;
end;
$retention_states$;
do $retention_rejection$
declare n integer; source_before jsonb; object_before jsonb; ledger_before jsonb;
begin
 select to_jsonb(a) into source_before from public.assignments a where id=pg_temp.authoring_fixture_id(20);
 select coalesce(jsonb_agg(to_jsonb(r) order by owner_table,owner_id,managed_object_id),'[]'::jsonb) into ledger_before from public.teacher_authoring_image_references r;
 foreach n in array array[103,122,123,124,125,126,127,128,129,130] loop
  select to_jsonb(o) into object_before from public.managed_storage_objects o where id=pg_temp.authoring_fixture_id(n);
  begin
   update public.assignments set instructions_markdown='![Denied retention](' || pg_temp.authoring_fixture_url(n) || ')' where id=pg_temp.authoring_fixture_id(20);
   raise exception 'Expired/claimed/attempted/generic/deleted/wrong-class retained image % was revived',n;
  exception when check_violation then
   if sqlerrm<>'authoring_image_reference_not_attachable' then raise;end if;
  end;
  perform pg_temp.assert_authoring((select to_jsonb(a)=source_before from public.assignments a where id=pg_temp.authoring_fixture_id(20))
   and (select to_jsonb(o)=object_before from public.managed_storage_objects o where id=pg_temp.authoring_fixture_id(n))
   and (select coalesce(jsonb_agg(to_jsonb(r) order by owner_table,owner_id,managed_object_id),'[]'::jsonb)=ledger_before from public.teacher_authoring_image_references r),
   'Rejected retention attachment changed source, managed-object state, or ledger');
 end loop;
end;
$retention_rejection$;

-- A real SAVEPOINT proves owner write, adoption and ledger are one transaction.
savepoint authoring_attachment;
update public.assignments set instructions_markdown='![Rollback](' || pg_temp.authoring_fixture_url(102) || ')'
 where id=pg_temp.authoring_fixture_id(20);
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(102)),'Savepoint attachment was not adopted');
rollback to savepoint authoring_attachment;
release savepoint authoring_attachment;
select pg_temp.assert_authoring((select status='verified' and ready_at is null from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(102)),'Rollback did not restore verified object');
select pg_temp.assert_authoring((select instructions_markdown='' from public.assignments
 where id=pg_temp.authoring_fixture_id(20)) and not exists(select 1 from public.teacher_authoring_image_references
 where managed_object_id=pg_temp.authoring_fixture_id(102)),'Rollback left source or reference evidence');

do $rejection$
declare n integer; original jsonb;
begin
  select to_jsonb(a) into original from public.assignments a where id=pg_temp.authoring_fixture_id(20);
  foreach n in array array[103,104,105,106,112] loop
    begin
      update public.assignments set instructions_markdown='![Rejected](' || pg_temp.authoring_fixture_url(n) || ')'
        where id=pg_temp.authoring_fixture_id(20);
      raise exception 'Nonattachable fixture % was accepted',n;
    exception when check_violation then
      if sqlerrm<>'authoring_image_reference_not_attachable' then raise; end if;
    end;
    perform pg_temp.assert_authoring((select to_jsonb(a)=original from public.assignments a
      where id=pg_temp.authoring_fixture_id(20)),'Rejected reference changed the owner row');
  end loop;
  -- Sorted 102 is adopted before missing 112 fails; the whole statement rolls back.
  begin
    update public.assignments set instructions_markdown='![First](' || pg_temp.authoring_fixture_url(102)
      || ') ![Missing](' || pg_temp.authoring_fixture_url(112) || ')'
      where id=pg_temp.authoring_fixture_id(20);
    raise exception 'Mixed valid/invalid attachment was accepted';
  exception when check_violation then
    if sqlerrm<>'authoring_image_reference_not_attachable' then raise; end if;
  end;
  perform pg_temp.assert_authoring((select status='verified' from public.managed_storage_objects
    where id=pg_temp.authoring_fixture_id(102)) and not exists(select 1 from public.teacher_authoring_image_references
    where managed_object_id=pg_temp.authoring_fixture_id(102)),'Rejected statement partially adopted an image');
end;
$rejection$;

-- The same image can have two owners. Material Markdown, not stale compatibility
-- JSON (including a wrong-class image), determines reference/admission evidence.
update public.assignments set instructions_markdown='![Shared](' || pg_temp.authoring_fixture_url(101) || ')'
 where id=pg_temp.authoring_fixture_id(20);
update public.classwork_materials set content=jsonb_build_object('type','doc',
 'attrs',jsonb_build_object('authoring_markdown','![Shared](' || pg_temp.authoring_fixture_url(101) || ')'),
 'content',jsonb_build_array(jsonb_build_object('type','image','attrs',jsonb_build_object('src',pg_temp.authoring_fixture_url(103)))))
 where id=pg_temp.authoring_fixture_id(30);
select pg_temp.assert_authoring((select count(*)=2 from public.teacher_authoring_image_references
 where managed_object_id=pg_temp.authoring_fixture_id(101))
 and not exists(select 1 from public.teacher_authoring_image_references where managed_object_id=pg_temp.authoring_fixture_id(103)),
 'Shared references or Material source precedence is incorrect');

set local role service_role;
do $service_boundary$
begin
  if (select count(*) from public.teacher_authoring_image_references
    where managed_object_id='c2910000-0000-4000-8000-000000000101')<>2
  then raise exception 'Service reader cannot see durable ledger evidence'; end if;
  begin
    delete from public.teacher_authoring_image_references
      where managed_object_id='c2910000-0000-4000-8000-000000000101';
    raise exception 'Service role directly deleted ledger evidence';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.teacher_authoring_image_references(owner_table,owner_id,classroom_id,managed_object_id)
      values('assignments','c2910000-0000-4000-8000-000000000999',
      'c2910000-0000-4000-8000-000000000010','c2910000-0000-4000-8000-000000000101');
    raise exception 'Service role directly forged ledger evidence';
  exception when insufficient_privilege then null; end;
end;
$service_boundary$;
reset role;
set local role anon;
do $anon_boundary$
begin
  begin perform 1 from public.teacher_authoring_image_references;
    raise exception 'Anonymous ledger read admitted';
  exception when insufficient_privilege then null; end;
end;
$anon_boundary$;
reset role;
set local role authenticated;
do $authenticated_boundary$
begin
  begin perform 1 from public.teacher_authoring_image_references;
    raise exception 'Authenticated ledger read admitted';
  exception when insufficient_privilege then null; end;
end;
$authenticated_boundary$;
reset role;

update public.assignments set instructions_markdown='' where id=pg_temp.authoring_fixture_id(20);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(101)) and public.managed_storage_object_is_referenced(pg_temp.authoring_fixture_id(101)),
 'Removing one shared owner queued a still-referenced image');
update public.classwork_materials set content=jsonb_build_object('type','doc',
 'attrs',jsonb_build_object('authoring_markdown',''),
 'content',jsonb_build_array(jsonb_build_object('type','image','attrs',jsonb_build_object('src',pg_temp.authoring_fixture_url(101)))))
 where id=pg_temp.authoring_fixture_id(30);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring(not public.managed_storage_object_is_referenced(pg_temp.authoring_fixture_id(101))
 and (select status='cleanup_pending' from public.managed_storage_objects where id=pg_temp.authoring_fixture_id(101)),
 'Stale Material JSON kept a removed source image live');

-- Bulk imports delete/reinsert question identities before the deferred boundary.
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,position)
 values(pg_temp.authoring_fixture_id(41),pg_temp.authoring_fixture_id(40),'open_response',
 '![Kept](' || pg_temp.authoring_fixture_url(107) || ')','[]',null,1,0);
delete from public.test_questions where id=pg_temp.authoring_fixture_id(41);
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(107)),'Question deletion queued cleanup before replacement');
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,position)
 values(pg_temp.authoring_fixture_id(42),pg_temp.authoring_fixture_id(40),'open_response',
 '![Kept](' || pg_temp.authoring_fixture_url(107) || ')','[]',null,1,0);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='ready' and cleanup_reason_code is null from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(107)) and exists(select 1 from public.teacher_authoring_image_references
 where owner_table='test_questions' and owner_id=pg_temp.authoring_fixture_id(42)
 and managed_object_id=pg_temp.authoring_fixture_id(107)),'Delete/reinsert invalidated a kept image');
delete from public.test_questions where id=pg_temp.authoring_fixture_id(42);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='cleanup_pending' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(107)),'Final question removal did not queue cleanup');

-- A terminal run fixture avoids the grading wake/HTTP path entirely. This probes
-- the durable snapshot-row trigger, not snapshot construction or grading itself.
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,position)
 values(pg_temp.authoring_fixture_id(51),pg_temp.authoring_fixture_id(50),'open_response',
 '![Snapshot](' || pg_temp.authoring_fixture_url(108) || ')','[]',null,1,0);
insert into public.test_responses(id,test_id,question_id,student_id,response_text,revision)
 values(pg_temp.authoring_fixture_id(52),pg_temp.authoring_fixture_id(50),pg_temp.authoring_fixture_id(51),
 pg_temp.authoring_fixture_id(3),'A saved response',1);
insert into public.test_ai_grading_runs(id,test_id,status,triggered_by,selection_hash,completed_at)
 values(pg_temp.authoring_fixture_id(53),pg_temp.authoring_fixture_id(50),'completed',
 pg_temp.authoring_fixture_id(1),'authoring291-terminal-fixture',clock_timestamp());
insert into public.test_ai_grading_run_items(id,run_id,test_id,student_id,question_id,response_id,
 response_revision,status,completed_at,question_grading_snapshot,last_error_message)
 values(pg_temp.authoring_fixture_id(54),pg_temp.authoring_fixture_id(53),pg_temp.authoring_fixture_id(50),
 pg_temp.authoring_fixture_id(3),pg_temp.authoring_fixture_id(51),pg_temp.authoring_fixture_id(52),1,'completed',clock_timestamp(),
 jsonb_build_object('question_text','![Pinned](' || pg_temp.authoring_fixture_url(108) || ')'),
 pg_temp.authoring_fixture_url(103));
update public.test_questions set question_text='Corrected wording without image' where id=pg_temp.authoring_fixture_id(51);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects where id=pg_temp.authoring_fixture_id(108))
 and exists(select 1 from public.teacher_authoring_image_references where owner_table='test_ai_grading_run_items'
 and owner_id=pg_temp.authoring_fixture_id(54) and managed_object_id=pg_temp.authoring_fixture_id(108))
 and not exists(select 1 from public.teacher_authoring_image_references where owner_table='test_questions'
 and owner_id=pg_temp.authoring_fixture_id(51))
 and not exists(select 1 from public.teacher_authoring_image_references where managed_object_id=pg_temp.authoring_fixture_id(103)),
 'Grading snapshot failed to pin image independently of live prompt, or metadata became an image reference');
delete from public.test_ai_grading_run_items where id=pg_temp.authoring_fixture_id(54);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='cleanup_pending' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(108)),'Removing final grading snapshot did not release image');

-- Maintenance only suppresses cleanup after a valid reference disappears. It
-- must not weaken same-class attachment checks. Flags and effects stay LOCAL.
insert into public.classwork_materials(id,classroom_id,title,created_by,content) values
 (pg_temp.authoring_fixture_id(31),pg_temp.authoring_fixture_id(10),'Restore fixture',pg_temp.authoring_fixture_id(1),
 jsonb_build_object('type','doc','attrs',jsonb_build_object('authoring_markdown','![Restore](' || pg_temp.authoring_fixture_url(109) || ')'))),
 (pg_temp.authoring_fixture_id(32),pg_temp.authoring_fixture_id(10),'Compaction fixture',pg_temp.authoring_fixture_id(1),
 jsonb_build_object('type','doc','attrs',jsonb_build_object('authoring_markdown','![Compaction](' || pg_temp.authoring_fixture_url(110) || ')')));
set local pika.classroom_archive_restore='on';
delete from public.classwork_materials where id=pg_temp.authoring_fixture_id(31);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(109)) and not public.managed_storage_object_is_referenced(pg_temp.authoring_fixture_id(109)),
 'Restore maintenance did not defer ownership cleanup');
do $maintenance_admission$
begin
  begin
    update public.assignments set instructions_markdown='![Wrong classroom](' || pg_temp.authoring_fixture_url(103) || ')'
      where id=pg_temp.authoring_fixture_id(20);
    raise exception 'Maintenance bypassed authoring attachment admission';
  exception when check_violation then
    if sqlerrm<>'authoring_image_reference_not_attachable' then raise; end if;
  end;
end;
$maintenance_admission$;
set local pika.classroom_archive_restore='off';
set local pika.classroom_archive_compaction='on';
delete from public.classwork_materials where id=pg_temp.authoring_fixture_id(32);
set constraints removed_teacher_authoring_image_cleanup immediate;
set constraints removed_teacher_authoring_image_cleanup deferred;
select pg_temp.assert_authoring((select status='ready' from public.managed_storage_objects
 where id=pg_temp.authoring_fixture_id(110)) and not public.managed_storage_object_is_referenced(pg_temp.authoring_fixture_id(110)),
 'Compaction maintenance did not defer ownership cleanup');
set local pika.classroom_archive_compaction='off';

select pg_temp.assert_authoring((select count(*)=22 from storage.objects
 where bucket_id='test-documents' and name like 'teacher-authoring-proof/c2910000-%'),
 'Proof unexpectedly deleted storage metadata');
do $$ begin raise notice 'Teacher authoring images SQL behavior proof passed; rolling back every fixture'; end $$;
rollback;
