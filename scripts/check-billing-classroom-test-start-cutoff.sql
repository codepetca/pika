-- Rollback-only proof. Exercise the existing legacy and contextual Start paths.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$
declare
  v_teacher uuid:=gen_random_uuid();
  v_started uuid:=gen_random_uuid();
  v_late uuid:=gen_random_uuid();
  v_outsider uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid();
  v_test uuid:=gen_random_uuid();
  v_unstarted_test uuid:=gen_random_uuid();
  v_draft_test uuid:=gen_random_uuid();
  v_question uuid:=gen_random_uuid();
  v_draft_question uuid:=gen_random_uuid();
  v_result jsonb;
  v_source jsonb;
  v_answers jsonb;
  v_attempt uuid;
  v_revision bigint;
  v_cutoff timestamptz;
  v_start timestamptz;
begin
  if exists(select 1 from private.stripe_billing_settings where classroom_new_work_cutoff_enabled)
    or has_function_privilege('service_role','private.billing_classroom_can_start_work_v1(uuid)','execute')
    or has_function_privilege('authenticated','public.start_test_attempt_revision_atomic(uuid,uuid)','execute')
    or not has_function_privilege('service_role','public.start_test_attempt_revision_atomic(uuid,uuid)','execute') then
    raise exception 'Classroom cutoff default or privileges changed';
  end if;

  insert into public.users(id,email,role) values
    (v_teacher,'billing-cutoff-308-owner@example.invalid','teacher'),
    (v_started,'billing-cutoff-308-started@example.invalid','student'),
    (v_late,'billing-cutoff-308-late@example.invalid','student'),
    (v_outsider,'billing-cutoff-308-outsider@example.invalid','student');
  if not exists(select 1 from public.account_plans where subject_user_id=v_teacher) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_teacher,'free','test:cutoff','fixture',0);
  end if;
  update private.stripe_billing_settings set sandbox_enabled=true,classroom_new_work_cutoff_enabled=true where singleton;
  perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id',v_teacher,'operation_id',gen_random_uuid()));
  insert into public.classrooms(id,teacher_id,title,class_code) values(v_classroom,v_teacher,'Billing cutoff','CUT30801');
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_started),(v_classroom,v_late);
  insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values
    (v_test,v_classroom,'Started Test','draft',5,v_teacher),
    (v_unstarted_test,v_classroom,'New Test','draft',5,v_teacher),
    (v_draft_test,v_classroom,'Draft for publication','draft',1,v_teacher);
  insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,position) values
    (v_question,v_test,'multiple_choice','Question','["A","B"]',1,5,0);
  update public.tests set status='active' where id in (v_test,v_unstarted_test);
  insert into public.assessment_drafts(assessment_type,assessment_id,classroom_id,content,version,created_by,updated_by)
    values('test',v_draft_test,v_classroom,jsonb_build_object('title','Draft for publication','show_results',false,
      'question_identity_version',1,'questions',jsonb_build_array(jsonb_build_object('id',v_draft_question,
        'question_type','open_response','question_text','Question','options','[]'::jsonb,'correct_option',null,
        'answer_key','Yes','sample_solution',null,'points',1,'response_max_chars',5000,'response_monospace',false))),
      1,v_teacher,v_teacher);
  v_result:=public.start_test_attempt_revision_atomic(v_test,v_started);
  v_attempt:=(v_result#>>'{attempt,id}')::uuid;
  if v_result->>'created' is distinct from 'true' or v_attempt is null then raise exception 'Active trial could not start'; end if;

  -- Accelerate the exact trial timestamp in this isolated transaction. The
  -- expiry worker has not run, so a stale Pro plan alone cannot admit Start.
  v_cutoff:=clock_timestamp();
  v_start:=v_cutoff-interval '720 hours';
  update public.billing_trials set started_at=v_start,ends_at=v_cutoff where subject_user_id=v_teacher;
  update public.billing_account_access set starts_at=v_start,access_ends_at=v_cutoff where subject_user_id=v_teacher;
  update public.effective_feature_entitlements set starts_at=v_start,expires_at=v_cutoff
    where subject_user_id=v_teacher and feature_key='classrooms.create';

  begin
    perform public.start_test_attempt_revision_atomic(v_unstarted_test,v_late);
    raise exception 'Late legacy Start succeeded';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  begin
    perform public.test_learner_workflow_v1(v_late,v_unstarted_test,v_classroom,'start','{}',clock_timestamp()+interval '10 seconds');
    raise exception 'Late contextual Start succeeded';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  begin
    perform public.start_test_attempt_revision_atomic(v_unstarted_test,v_outsider);
    raise exception 'Outsider Start succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_test_from_draft_atomic(v_teacher,v_draft_test,1);
    raise exception 'Expired trial published a Test';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  v_source:=public.snapshot_test_draft_for_owner_v1(v_teacher,v_draft_test,clock_timestamp()+interval '8 seconds');
  begin
    perform public.publish_test_from_draft_for_owner_v1(v_teacher,v_draft_test,v_classroom,v_source->>'source_sha256',
      (v_source#>>'{draft,version}')::integer,v_source#>'{draft,content}',clock_timestamp()+interval '8 seconds');
    raise exception 'Expired trial published through the contextual Test RPC';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  if (select status from public.tests where id=v_draft_test) is distinct from 'draft'
    or exists(select 1 from public.test_questions where test_id=v_draft_test)
    or not exists(select 1 from public.assessment_drafts where assessment_id=v_draft_test and version=1) then
    raise exception 'Publication denial partially materialized or changed draft content';
  end if;
  if exists(select 1 from public.test_attempts where test_id=v_unstarted_test)
    or (select questions_locked_at from public.tests where id=v_unstarted_test) is not null
    or exists(select 1 from public.classrooms where id=v_classroom and archived_at is not null) then
    raise exception 'Cutoff changed existing work or archived the classroom';
  end if;

  v_result:=public.start_test_attempt_revision_atomic(v_test,v_started);
  if v_result->>'created' is distinct from 'false' or (v_result#>>'{attempt,id}')::uuid is distinct from v_attempt then
    raise exception 'Cutoff blocked or replaced an existing attempt';
  end if;
  v_revision:=(v_result#>>'{attempt,draft_revision}')::bigint;
  v_answers:=jsonb_build_object(v_question::text,jsonb_build_object('question_type','multiple_choice','selected_option',1));
  v_result:=public.save_test_attempt_revision_atomic(v_test,v_started,v_answers,v_revision);
  v_revision:=(v_result#>>'{attempt,draft_revision}')::bigint;
  v_result:=public.submit_test_attempt_revision_atomic(v_test,v_started,v_answers,v_revision,clock_timestamp());
  if (v_result->>'attempt_id')::uuid is distinct from v_attempt
    or not exists(select 1 from public.test_attempts where id=v_attempt and is_submitted) then
    raise exception 'Cutoff did not preserve completion of a started attempt';
  end if;

  perform public.billing_apply_due_access_v1('{"limit":25}');
  if (select plan_key from public.account_plans where subject_user_id=v_teacher) is distinct from 'free' then
    raise exception 'Expiry worker did not apply Free';
  end if;
  begin
    perform public.start_test_attempt_revision_atomic(v_unstarted_test,v_late);
    raise exception 'Post-expiry Start succeeded';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;

  update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=false where singleton;
  if public.start_test_attempt_revision_atomic(v_unstarted_test,v_late)->>'created' is distinct from 'true' then
    raise exception 'Dormant cutoff changed the current Start behavior';
  end if;
  if public.publish_test_from_draft_atomic(v_teacher,v_draft_test,1)#>>'{test,status}' is distinct from 'closed' then
    raise exception 'Dormant cutoff changed the current publication behavior';
  end if;
end $$;
rollback;
