-- Rollback-only proof for the cardless trial lane on an owned replay.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $$
declare
  v_project text:='abcdefghijklmnopqrst';
  v_account text:='acct_LiveTrial313';
  v_subject uuid:=gen_random_uuid();
  v_legacy uuid:=gen_random_uuid();
  v_student uuid:=gen_random_uuid();
  v_other uuid:=gen_random_uuid();
  v_manual uuid:=gen_random_uuid();
  v_school uuid:=gen_random_uuid();
  v_unmatched uuid:=gen_random_uuid();
  v_grant_subject uuid;
  v_grant_source text;
  v_snapshot jsonb;
  v_plan_snapshot jsonb;
  v_audit_count bigint;
  v_classroom uuid:=gen_random_uuid();
  v_assignment uuid:=gen_random_uuid();
  v_operation uuid:=gen_random_uuid();
  v_start jsonb:=jsonb_build_object('subject_user_id',v_subject,'operation_id',v_operation);
  v_status jsonb:=jsonb_build_object('subject_user_id',v_subject,'include_options',true);
  v_result jsonb;
  v_first jsonb;
  v_cutoff timestamptz;
  v_epoch bigint;
  v_rpc text;
begin
  foreach v_rpc in array array[
    'public.billing_live_trial_lifecycle_ready_v1(text,text)',
    'public.billing_start_live_trial_v1(text,text,jsonb)',
    'public.billing_get_live_access_status_v1(text,text,jsonb)',
    'public.billing_apply_due_live_trial_access_v1(text,text,jsonb)'
  ] loop
    if has_function_privilege('anon',v_rpc,'execute')
      or has_function_privilege('authenticated',v_rpc,'execute')
      or not has_function_privilege('service_role',v_rpc,'execute') then
      raise exception 'Unexpected authority for %',v_rpc;
    end if;
  end loop;
  if has_table_privilege('service_role','private.billing_live_trial_sources','select')
    or has_table_privilege('service_role','private.billing_live_trial_sources','insert')
    or has_function_privilege('service_role',
      'private.billing_live_trial_source_matches_v1(uuid,text,text)','execute') then
    raise exception 'Live trial internals are directly accessible';
  end if;
  if public.billing_live_trial_lifecycle_ready_v1(v_project,v_account) then
    raise exception 'Live trial lane started enabled';
  end if;

  insert into public.users(id,email,role) values
    (v_subject,'live-trial-owner@example.invalid','teacher'),
    (v_legacy,'live-trial-legacy@example.invalid','teacher'),
    (v_student,'live-trial-student@example.invalid','student'),
    (v_other,'live-trial-other@example.invalid','teacher'),
    (v_manual,'live-trial-manual@example.invalid','teacher'),
    (v_school,'live-trial-school@example.invalid','teacher'),
    (v_unmatched,'live-trial-unmatched@example.invalid','teacher');
  -- A legacy classroom can outlive its old entitlement. Create it while the
  -- teacher has a plan, then return them to Free before testing trial admission.
  perform public.set_account_plan_v1(gen_random_uuid(),v_subject,'plus','test:live-trial','fixture',
    coalesce((select revision from public.account_plans where subject_user_id=v_subject),0));
  perform public.set_account_plan_v1(gen_random_uuid(),v_legacy,'plus','test:live-trial','fixture',
    coalesce((select revision from public.account_plans where subject_user_id=v_legacy),0));
  if not exists(select 1 from public.account_plans where subject_user_id=v_other) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_other,'free','test:live-trial','fixture',0);
  end if;

  update private.repolight_settings set billing_access_enabled=true,legacy_plan_access_enabled=true,
    plan_enforcement_enabled=true,managed_provisioning_enabled=true where singleton;
  insert into public.classrooms(id,teacher_id,title,class_code)
    values(v_classroom,v_subject,'Retained Classroom','TRL31301');
  insert into public.assignments(id,classroom_id,created_by,title,due_at,is_draft,released_at)
    values(v_assignment,v_classroom,v_subject,'Legacy schedule',clock_timestamp()+interval '3 days',false,
      clock_timestamp()+interval '2 days');
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_student);
  perform public.set_account_plan_v1(gen_random_uuid(),v_subject,'free','test:live-trial','fixture',
    (select revision from public.account_plans where subject_user_id=v_subject));
  update private.stripe_billing_settings set live_project_ref=v_project,live_stripe_account=v_account,
    classroom_new_work_cutoff_enabled=true where singleton;

  begin
    insert into public.stripe_billing_offerings(plan_key) values('basic');
    update private.stripe_billing_settings set live_trial_lifecycle_enabled=true where singleton;
    raise exception 'Sandbox evidence did not block first live activation';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_trial_target_not_attested' then raise; end if;
  end;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true where singleton;
  if public.billing_live_trial_lifecycle_ready_v1(v_project,v_account) is distinct from true
    or public.billing_live_trial_lifecycle_ready_v1('abcdefghijklmnopqrsu',v_account)
    or public.billing_live_trial_lifecycle_ready_v1(v_project,'acct_Other313')
    or public.billing_live_trial_lifecycle_ready_v1(v_project,null) then
    raise exception 'Live trial readiness did not bind the exact target';
  end if;
  v_result:=public.billing_get_live_access_status_v1(v_project,v_account,v_status);
  if v_result->>'state' is distinct from 'free'
    or v_result#>>'{customer_options,trial_available}' is distinct from 'false'
    or v_result#>>'{customer_options,checkout_available}' is distinct from 'false' then
    raise exception 'Trial status was unavailable or enabled an admission lane';
  end if;
  begin
    perform public.billing_start_live_trial_v1(v_project,v_account,v_start);
    raise exception 'Disabled trial admission accepted a new trial';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_trial_admission_disabled' then raise; end if;
  end;
  update private.stripe_billing_settings set live_trial_admission_enabled=true where singleton;
  -- An independently managed Free entitlement must remain untouched even if
  -- the account plan itself is Free. Trial options and admission both deny it.
  for v_grant_subject, v_grant_source in select * from (values (v_manual,'manual'),(v_school,'school'),(v_unmatched,'plan')) grants(subject,source) loop
    if not exists(select 1 from public.account_plans where subject_user_id=v_grant_subject) then
      perform public.set_account_plan_v1(gen_random_uuid(),v_grant_subject,'free','test:live-trial','fixture',0);
    end if;
    perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),v_grant_subject,'classrooms.create',
      v_grant_source,v_grant_source<>'plan',clock_timestamp(),null,case when v_grant_source='plan' then 0 else 2 end,'test:live-trial','independent_grant',
      (select revision from public.effective_feature_entitlements where subject_user_id=v_grant_subject and feature_key='classrooms.create'));
    select to_jsonb(e) into v_snapshot from public.effective_feature_entitlements e
      where subject_user_id=v_grant_subject and feature_key='classrooms.create';
    select to_jsonb(p) into v_plan_snapshot from public.account_plans p where subject_user_id=v_grant_subject;
    select count(*) into v_audit_count from public.effective_feature_entitlement_audit where subject_user_id=v_grant_subject;
    if public.billing_get_live_access_status_v1(v_project,v_account,
      jsonb_build_object('subject_user_id',v_grant_subject,'include_options',true))#>>'{customer_options,trial_available}' is distinct from 'false' then
      raise exception 'Independent % grant was presented as trial eligible',v_grant_source;
    end if;
    begin
      perform public.billing_start_live_trial_v1(v_project,v_account,
        jsonb_build_object('subject_user_id',v_grant_subject,'operation_id',gen_random_uuid()));
      raise exception 'Independent % grant was overwritten',v_grant_source;
    exception when sqlstate '55000' then
      if sqlerrm<>'billing_trial_ineligible' then raise; end if;
    end;
    if (select to_jsonb(e) from public.effective_feature_entitlements e where subject_user_id=v_grant_subject and feature_key='classrooms.create') is distinct from v_snapshot
      or (select to_jsonb(p) from public.account_plans p where subject_user_id=v_grant_subject) is distinct from v_plan_snapshot
      or (select count(*) from public.effective_feature_entitlement_audit where subject_user_id=v_grant_subject)<>v_audit_count
      or exists(select 1 from public.billing_trials where subject_user_id=v_grant_subject)
      or exists(select 1 from public.billing_account_access where subject_user_id=v_grant_subject) then
      raise exception 'Independent % grant changed',v_grant_source;
    end if;
  end loop;
  begin
    perform public.billing_start_live_trial_v1(v_project,'acct_Other313',v_start);
    raise exception 'Wrong Stripe account started a live trial';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_trial_lifecycle_unavailable' then raise; end if;
  end;
  begin
    perform public.billing_start_live_trial_v1(v_project,v_account,
      jsonb_build_object('subject_user_id',v_student,'operation_id',gen_random_uuid()));
    raise exception 'A student started a live teacher trial';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_trial_ineligible' then raise; end if;
  end;
  begin
    perform public.billing_start_live_trial_v1(v_project,v_account,v_start);
    raise exception 'Future legacy release did not block admission';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_trial_future_releases' then raise; end if;
  end;
  update public.assignments set is_draft=true,released_at=null where id=v_assignment;
  if public.billing_get_live_access_status_v1(v_project,v_account,v_status)
    #>>'{customer_options,trial_available}' is distinct from 'true' then
    raise exception 'Resolved legacy schedule left trial unavailable';
  end if;

  v_first:=public.billing_start_live_trial_v1(v_project,v_account,v_start);
  if v_first->>'state' is distinct from 'trial' or v_first->>'classroom_limit' is distinct from '5'
    or v_first->>'can_start_paid_work' is distinct from 'true'
    or not exists(select 1 from public.billing_trials where subject_user_id=v_subject
      and operation_id=v_operation and ends_at=started_at+interval '720 hours')
    or not exists(select 1 from private.billing_live_trial_sources where subject_user_id=v_subject
      and operation_id=v_operation and project_ref=v_project and stripe_account=v_account)
    or public.billing_attest_live_target_v1(v_project,v_account)
    or not public.billing_live_trial_lifecycle_ready_v1(v_project,v_account) then
    raise exception 'Live trial failed its exact term or confused runtime readiness with first attestation';
  end if;
  if public.get_repolight_analysis_access_v1(v_subject)->>'allowed' is distinct from 'true'
    or public.get_repolight_analysis_access_v1(v_legacy)->>'source' is distinct from 'legacy'
    or public.get_repolight_analysis_access_v1(v_legacy)->>'allowed' is distinct from 'true'
    or public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',v_subject))->>'teacherId'
      is distinct from v_subject::text then
    raise exception 'RepoLight trial, legacy or provisioning eligibility failed';
  end if;
  begin
    perform public.billing_start_trial_v1(v_start);
    raise exception 'Live runtime unlocked the sandbox trial writer';
  exception when sqlstate '55000' then
    if sqlerrm<>'stripe_billing_sandbox_disabled' then raise; end if;
  end;
  begin
    perform public.billing_list_checkout_offerings_v1(jsonb_build_object('stripe_account',v_account));
    raise exception 'Live trial unlocked checkout';
  exception when sqlstate '55000' then
    if sqlerrm<>'stripe_billing_sandbox_disabled' then raise; end if;
  end;
  begin
    update private.stripe_billing_settings set live_stripe_account='acct_Rebound313' where singleton;
    raise exception 'A live trial could be relabelled to another Stripe account';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_trial_target_in_use' then raise; end if;
  end;

  update private.stripe_billing_settings set live_trial_admission_enabled=false where singleton;
  v_result:=public.billing_start_live_trial_v1(v_project,v_account,v_start);
  if v_result is distinct from v_first or public.get_repolight_analysis_access_v1(v_subject)->>'allowed' is distinct from 'true' then
    raise exception 'Closing admission changed an existing trial or its replay';
  end if;
  begin
    perform public.billing_start_live_trial_v1(v_project,v_account,
      jsonb_build_object('subject_user_id',v_other,'operation_id',gen_random_uuid()));
    raise exception 'Closing admission did not stop a second teacher';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_trial_admission_disabled' then raise; end if;
  end;

  -- Turning the lifecycle switch off invalidates prior outbox eligibility and
  -- keeps the classroom cutoff in place. It can be restarted for this target.
  select epoch into v_epoch from private.repolight_provision_control where singleton;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=false where singleton;
  if public.billing_live_trial_lifecycle_ready_v1(v_project,v_account)
    or public.get_repolight_analysis_access_v1(v_subject)->>'allowed' is distinct from 'false'
    or (select epoch from private.repolight_provision_control where singleton)<>v_epoch+1 then
    raise exception 'Stopping lifecycle did not invalidate live RepoLight eligibility';
  end if;
  begin
    update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=false where singleton;
    raise exception 'Existing trial permitted disabling its classroom cutoff';
  exception when sqlstate '55000' then
    if sqlerrm<>'billing_live_trial_target_in_use' then raise; end if;
  end;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true where singleton;

  -- Move only the synthetic trial's linked time facts together. Use a cutoff
  -- before this statement so the due scan and real-time read both see expiry.
  v_cutoff:=statement_timestamp()-interval '1 second';
  update public.assignments set is_draft=false,released_at=v_cutoff-interval '1 day' where id=v_assignment;
  update public.billing_trials set started_at=v_cutoff-interval '720 hours',ends_at=v_cutoff where subject_user_id=v_subject;
  update public.billing_account_access set starts_at=v_cutoff-interval '720 hours',access_ends_at=v_cutoff where subject_user_id=v_subject;
  update public.effective_feature_entitlements set starts_at=v_cutoff-interval '720 hours',expires_at=v_cutoff
    where subject_user_id=v_subject and feature_key='classrooms.create';
  if private.billing_classroom_can_start_work_v1(v_classroom)
    or public.get_repolight_analysis_access_v1(v_subject)->>'reason' is distinct from 'expired'
    or public.billing_get_live_access_status_v1(v_project,v_account,v_status)->>'state' is distinct from 'free' then
    raise exception 'Exact cutoff depended on running the expiry worker';
  end if;
  v_result:=public.billing_apply_due_live_trial_access_v1(v_project,v_account,'{"limit":10}');
  if v_result->>'processed' is distinct from '1'
    or public.billing_apply_due_live_trial_access_v1(v_project,v_account,'{"limit":10}')->>'processed' is distinct from '0'
    or not exists(select 1 from public.billing_account_access where subject_user_id=v_subject and expiry_applied_at is not null)
    or not exists(select 1 from public.account_plans where subject_user_id=v_subject and plan_key='free' and management_source='trial')
    or not exists(select 1 from private.billing_classroom_restrictions where subject_user_id=v_subject and classroom_id=v_classroom)
    or not exists(select 1 from public.classrooms where id=v_classroom and archived_at is null)
    or public.open_assignment_doc_for_member_v1(v_student,v_assignment,clock_timestamp(),null)
      #>>'{doc,student_id}' is distinct from v_student::text then
    raise exception 'Live expiry did not preserve prior student work and close the trial exactly once';
  end if;
end $$;

rollback;
