-- Rollback-only exercise of both owner write paths and the existing learner path.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $$
declare
  v_teacher uuid:=gen_random_uuid();
  v_student uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid();
  v_live uuid:=gen_random_uuid();
  v_draft uuid:=gen_random_uuid();
  v_other_draft uuid:=gen_random_uuid();
  v_retired uuid:=gen_random_uuid();
  v_cutoff timestamptz;
  v_due timestamptz:=clock_timestamp()+interval '1 day';
  v_result jsonb;
  v_content constant jsonb:='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Retained work"}]}]}';
begin
  if exists(select 1 from private.stripe_billing_settings where classroom_new_work_cutoff_enabled)
    or has_function_privilege('service_role','private.guard_billing_assignment_publication_v1()','execute') then
    raise exception 'Assignment cutoff default or authority widened';
  end if;
  insert into public.users(id,email,role) values
    (v_teacher,'billing-assignment-310-owner@example.invalid','teacher'),
    (v_student,'billing-assignment-310-student@example.invalid','student');
  if not exists(select 1 from public.account_plans where subject_user_id=v_teacher) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_teacher,'free','test:billing-assignment','fixture',0);
  end if;
  update private.stripe_billing_settings set sandbox_enabled=true,classroom_new_work_cutoff_enabled=true where singleton;
  perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id',v_teacher,'operation_id',gen_random_uuid()));
  insert into public.classrooms(id,teacher_id,title,class_code) values(v_classroom,v_teacher,'Assignment cutoff','PUB31001');
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_student);
  insert into public.assignments(id,classroom_id,created_by,title,due_at) values
    (v_live,v_classroom,v_teacher,'Live assignment',v_due),
    (v_draft,v_classroom,v_teacher,'Draft title',v_due),
    (v_other_draft,v_classroom,v_teacher,'Legacy draft title',v_due),
    (v_retired,v_classroom,v_teacher,'Retired assignment',v_due);

  v_result:=public.release_assignment_for_owner_v1(v_teacher,v_live,clock_timestamp(),false);
  if v_result#>>'{assignment,is_draft}' is distinct from 'false' then raise exception 'Active trial could not publish'; end if;
  perform public.release_assignment_for_owner_v1(v_teacher,v_retired,clock_timestamp(),false);
  update public.assignments set blueprint_archived_at=clock_timestamp() where id=v_retired;
  begin
    perform public.release_assignment_for_owner_v1(v_teacher,v_draft,v_due-interval '1 hour',true);
    raise exception 'Direct time-based publication escaped the gated release path';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;

  v_cutoff:=clock_timestamp();
  update public.billing_trials set started_at=v_cutoff-interval '720 hours',ends_at=v_cutoff where subject_user_id=v_teacher;
  update public.billing_account_access set starts_at=v_cutoff-interval '720 hours',access_ends_at=v_cutoff where subject_user_id=v_teacher;
  update public.effective_feature_entitlements set starts_at=v_cutoff-interval '720 hours',expires_at=v_cutoff
    where subject_user_id=v_teacher and feature_key='classrooms.create';
  begin
    perform public.release_assignment_for_owner_v1(v_student,v_draft,clock_timestamp(),false);
    raise exception 'Subscription granted another user assignment authority';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_assignment_for_owner_v1(v_teacher,v_draft,
      jsonb_build_object('is_draft',false,'title','Uncommitted title','released_at',clock_timestamp()),null);
    raise exception 'Contextual draft published after cutoff';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  begin
    update public.assignments set is_draft=false,released_at=clock_timestamp() where id=v_other_draft;
    raise exception 'Legacy draft published after cutoff';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  begin
    perform public.save_legacy_assignments_bulk_for_owner_v1(v_teacher,v_classroom,jsonb_build_array(
      jsonb_build_object('title','Tentative bulk draft','due_at',v_due,'is_draft',true,
        'instructions_markdown','','description','','rich_instructions',v_content),
      jsonb_build_object('id',v_retired,'title','Tentative history edit','due_at',v_due,'is_draft',false,
        'instructions_markdown','','description','','rich_instructions',v_content),
      jsonb_build_object('id',v_other_draft,'title','Tentative bulk release','due_at',v_due,'is_draft',false,
        'instructions_markdown','','description','','rich_instructions',v_content)));
    raise exception 'Bulk publication escaped the cutoff';
  exception when sqlstate 'PT403' then
    if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
  end;
  if exists(select 1 from public.assignments where classroom_id=v_classroom
    and title in ('Tentative bulk draft','Tentative bulk release','Tentative history edit')) then
    raise exception 'Cutoff rejection partially committed a bulk write';
  end if;
  v_result:=public.save_legacy_assignments_bulk_for_owner_v1(v_teacher,v_classroom,jsonb_build_array(
    jsonb_build_object('title','Retained new draft','due_at',v_due,'is_draft',true,
      'instructions_markdown','','description','','rich_instructions',v_content),
    jsonb_build_object('id',v_retired,'title','Retained history edit','due_at',v_due,'is_draft',false,
      'instructions_markdown','','description','','rich_instructions',v_content)));
  if v_result->>'created' is distinct from '1' or v_result->>'updated' is distinct from '1'
    or not exists(select 1 from public.assignments where id=v_retired and title='Retained history edit'
      and blueprint_archived_at is not null and not is_draft) then
    raise exception 'Legacy bulk could not edit Blueprint-retired history';
  end if;
  begin
    perform public.save_assignments_bulk_for_owner_v1(v_teacher,v_classroom,jsonb_build_array(
      jsonb_build_object('id',v_retired,'title','Contextual retired edit','due_at',v_due,'is_draft',false,
        'instructions_markdown','','description','','rich_instructions',v_content)));
    raise exception 'Contextual writer accepted Blueprint-retired edit';
  exception when sqlstate '55000' then
    if sqlerrm<>'assignment_bulk_archived' then raise; end if;
  end;
  if not exists(select 1 from public.assignments where id=v_draft and title='Draft title'
    and is_draft and released_at is null) then raise exception 'Denied publication changed the draft'; end if;
  v_result:=public.update_assignment_for_owner_v1(v_teacher,v_draft,'{"title":"Retained draft"}',null);
  if v_result#>>'{assignment,title}' is distinct from 'Retained draft' then raise exception 'Draft editing was denied'; end if;
  v_result:=public.update_assignment_for_owner_v1(v_teacher,v_live,'{"title":"Retained live assignment"}',null);
  if v_result#>>'{assignment,title}' is distinct from 'Retained live assignment' then raise exception 'Live editing was denied'; end if;
  begin
    perform public.open_assignment_doc_for_member_v1(v_student,v_draft,clock_timestamp(),null);
    raise exception 'Denied draft became visible to a learner';
  exception when no_data_found then null;
  end;

  v_result:=public.open_assignment_doc_for_member_v1(v_student,v_live,clock_timestamp(),null);
  if v_result#>>'{doc,student_id}' is distinct from v_student::text then raise exception 'Published assignment was hidden'; end if;
  v_result:=public.submit_assignment_doc_for_member_v1(v_student,v_live,v_content,
    (v_result#>>'{doc,updated_at}')::timestamptz,2,13,'{}'::uuid[],false,null);
  if v_result#>>'{doc,is_submitted}' is distinct from 'true' then raise exception 'Published assignment could not be submitted'; end if;

  update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=false where singleton;
  v_result:=public.release_assignment_for_owner_v1(v_teacher,v_draft,clock_timestamp(),false);
  if v_result#>>'{assignment,is_draft}' is distinct from 'false' then raise exception 'Dormant cutoff changed publication'; end if;
end $$;

rollback;
