-- Rollback-only proof for the guarded owner and worker contracts.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid();
  v_assignment uuid:=gen_random_uuid();
begin
  update private.stripe_billing_settings set live_project_ref='abcdefghijklmnopqrst',live_stripe_account='acct_release311'
    where singleton;
  if not public.billing_attest_live_target_v1('abcdefghijklmnopqrst','acct_release311') then
    raise exception 'Clean live target fixture did not attest';
  end if;
  insert into public.users(id,email,role) values(v_owner,'release-scope-owner@example.invalid','teacher');
  insert into public.classrooms(id,teacher_id,title,class_code,archived_at)
    values(v_classroom,v_owner,'Historical classroom','REL31201',clock_timestamp());
  insert into public.assignments(id,classroom_id,created_by,title,due_at)
    values(v_assignment,v_classroom,v_owner,'Retained schedule',clock_timestamp()+interval '1 day');
  insert into private.billing_assignment_release_intents(assignment_id,classroom_id,subject_user_id,scheduled_for)
    values(v_assignment,v_classroom,v_owner,clock_timestamp()+interval '1 hour');
  if public.billing_attest_live_target_v1('abcdefghijklmnopqrst','acct_release311') then
    raise exception 'Live target attested with retained sandbox release evidence';
  end if;
  raise exception using errcode='P3120',message='rollback_target_fixture';
exception when sqlstate 'P3120' then null;
end $$;

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_student uuid:=gen_random_uuid();
  v_classroom uuid:=gen_random_uuid();
  v_good uuid:=gen_random_uuid();
  v_missed uuid:=gen_random_uuid();
  v_cancel uuid:=gen_random_uuid();
  v_other_classroom uuid:=gen_random_uuid();
  v_cancel_intent uuid;
  v_previous_intent uuid;
  v_mutation text;
  v_rpc text;
  v_good_intent uuid;
  v_missed_intent uuid;
  v_scheduled timestamptz;
  v_cutoff timestamptz;
  v_result jsonb;
  v_outcome text;
  v_offering uuid;
  v_binding uuid;
  v_claim jsonb;
  v_period_start timestamptz;
begin
  if has_table_privilege('service_role','private.billing_assignment_release_intents','select')
    or has_sequence_privilege('service_role','private.billing_assignment_release_intents_generation_seq','usage')
    or has_function_privilege('service_role',
      'private.apply_assignment_release_intent_for_owner_v1(uuid,uuid,uuid,boolean)','execute') then
    raise exception 'Scheduled release internals became directly accessible';
  end if;
  foreach v_rpc in array array[
    'public.get_assignment_release_states_for_owner_v1(uuid,uuid,uuid[])',
    'public.schedule_assignment_for_billing_v1(uuid,uuid,timestamptz,uuid)',
    'public.cancel_assignment_release_for_owner_v1(uuid,uuid,uuid)',
    'public.publish_scheduled_assignment_for_owner_v1(uuid,uuid,uuid)',
    'public.list_due_billing_assignment_releases_v1(integer)',
    'public.process_billing_assignment_release_v1(uuid)'
  ] loop
    if has_function_privilege('authenticated',v_rpc,'execute') or has_function_privilege('anon',v_rpc,'execute')
      or not has_function_privilege('service_role',v_rpc,'execute') then
      raise exception 'Unexpected execute authority for %',v_rpc;
    end if;
  end loop;
  insert into public.users(id,email,role) values
    (v_owner,'billing-scheduled-assignment-owner@example.invalid','teacher'),
    (v_student,'billing-scheduled-assignment-student@example.invalid','student');
  if not exists(select 1 from public.account_plans where subject_user_id=v_owner) then
    perform public.set_account_plan_v1(gen_random_uuid(),v_owner,'free','test:assignment-release','fixture',0);
  end if;
  update private.stripe_billing_settings set sandbox_enabled=true where singleton;
  perform public.billing_start_trial_v1(jsonb_build_object('subject_user_id',v_owner,'operation_id',gen_random_uuid()));
  insert into public.classrooms(id,teacher_id,title,class_code) values
    (v_classroom,v_owner,'Scheduled release','REL31101'),
    (v_other_classroom,v_owner,'Other classroom','REL31102');
  insert into public.classroom_enrollments(classroom_id,student_id) values(v_classroom,v_student);
  insert into public.assignments(id,classroom_id,created_by,title,due_at) values
    (v_good,v_classroom,v_owner,'Untitled',clock_timestamp()+interval '1 day'),
    (v_missed,v_classroom,v_owner,'Scheduled after trial',clock_timestamp()+interval '1 day'),
    (v_cancel,v_classroom,v_owner,'Untitled',clock_timestamp()+interval '1 day');
  if public.schedule_assignment_for_billing_v1(v_owner,v_good,clock_timestamp()+interval '1 minute') is not null
    or public.list_due_billing_assignment_releases_v1(10) is distinct from '[]'::jsonb then
    raise exception 'Dormant schedule changed the existing path';
  end if;
  update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=true where singleton;
  begin
    perform public.schedule_assignment_for_billing_v1(v_student,v_good,clock_timestamp()+interval '1 minute');
    raise exception 'A classroom member scheduled an owner assignment';
  exception when insufficient_privilege then null;
  end;

  v_scheduled:=clock_timestamp()+interval '1 second';
  v_result:=public.schedule_assignment_for_billing_v1(v_owner,v_good,v_scheduled);
  v_previous_intent:=(v_result#>>'{release_schedule,id}')::uuid;
  if v_result#>>'{assignment,is_draft}' is distinct from 'true'
    or public.schedule_assignment_for_billing_v1(v_owner,v_good,v_scheduled) is distinct from v_result then
    raise exception 'Scheduling changed the learner publication state or failed replay';
  end if;
  if v_result#>>'{release_schedule,state}' is distinct from 'pending'
    or public.get_assignment_release_states_for_owner_v1(v_owner,v_classroom,array[v_good,v_missed])
      is distinct from jsonb_build_array(jsonb_build_object('assignment_id',v_good,
        'updated_at',v_result#>'{assignment,updated_at}','release_schedule',v_result->'release_schedule'))
    or public.get_assignment_release_states_for_owner_v1(v_student,v_classroom,array[v_good]) is distinct from '[]'::jsonb
    or public.get_assignment_release_states_for_owner_v1(v_owner,v_other_classroom,array[v_good]) is distinct from '[]'::jsonb then
    raise exception 'Owner release read widened its scope or lost the pending intent';
  end if;
  begin
    perform public.get_assignment_release_states_for_owner_v1(v_owner,v_classroom,array_fill(v_good,array[101]));
    raise exception 'Unbounded release-state request succeeded';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.schedule_assignment_for_billing_v1(v_owner,v_good,v_scheduled+interval '1 hour');
    raise exception 'A stale scheduling request replaced a pending release';
  exception when sqlstate 'PT409' then
    if sqlerrm<>'billing_assignment_schedule_changed' then raise; end if;
  end;
  v_scheduled:=clock_timestamp()+interval '1 second';
  v_result:=public.schedule_assignment_for_billing_v1(v_owner,v_good,v_scheduled,v_previous_intent);
  v_good_intent:=(v_result#>>'{release_schedule,id}')::uuid;
  if v_good_intent is not distinct from v_previous_intent
    or not exists(select 1 from private.billing_assignment_release_intents where id=v_previous_intent and state='superseded') then
    raise exception 'Reschedule did not supersede its observed generation';
  end if;
  foreach v_mutation in array array['reschedule','cancel','publish','legacy publish','legacy bulk','direct publish'] loop
    begin
      case v_mutation
        when 'reschedule' then perform public.schedule_assignment_for_billing_v1(v_owner,v_good,v_scheduled,v_previous_intent);
        when 'cancel' then perform public.cancel_assignment_release_for_owner_v1(v_owner,v_good,v_previous_intent);
        when 'publish' then perform public.publish_scheduled_assignment_for_owner_v1(v_owner,v_good,v_previous_intent);
        when 'legacy publish' then perform public.release_assignment_for_owner_v1(v_owner,v_good,clock_timestamp(),false);
        when 'legacy bulk' then perform public.save_legacy_assignments_bulk_for_owner_v1(v_owner,v_classroom,
          jsonb_build_array(jsonb_build_object('id',v_good,'title','Untitled','due_at',clock_timestamp()+interval '1 day',
            'instructions_markdown','','description','','rich_instructions','{}'::jsonb,'is_draft',false)));
        when 'direct publish' then update public.assignments set is_draft=false where id=v_good;
      end case;
      raise exception 'Stale or blind % changed the current generation',v_mutation;
    exception when sqlstate 'PT409' then
      if sqlerrm<>'billing_assignment_schedule_changed' then raise; end if;
    end;
  end loop;
  begin
    perform public.cancel_assignment_release_for_owner_v1(v_student,v_good,v_good_intent);
    raise exception 'A classroom member cancelled the owner schedule';
  exception when insufficient_privilege then null;
  end;
  v_result:=public.discard_pristine_assignment_draft_atomic(v_good,v_owner,
    (select updated_at from public.assignments where id=v_good));
  if v_result->>'discarded' is distinct from 'false' then raise exception 'Draft cleanup discarded a scheduled assignment'; end if;
  begin
    perform public.open_assignment_doc_for_member_v1(v_student,v_good,clock_timestamp(),null);
    raise exception 'A pending assignment became visible';
  exception when no_data_found then null;
  end;
  if public.process_billing_assignment_release_v1(v_good_intent) is distinct from 'noop' then
    raise exception 'Worker released an assignment before its schedule';
  end if;
  perform pg_sleep(greatest(0,extract(epoch from v_scheduled-clock_timestamp()))+0.05);
  if not public.list_due_billing_assignment_releases_v1(10) @> jsonb_build_array(v_good_intent) then
    raise exception 'Worker did not list a due assignment';
  end if;
  if public.process_billing_assignment_release_v1(v_previous_intent) is distinct from 'noop'
    or public.list_due_billing_assignment_releases_v1(10) @> jsonb_build_array(v_previous_intent) then
    raise exception 'Worker reconsidered a superseded generation';
  end if;
  v_outcome:=public.process_billing_assignment_release_v1(v_good_intent);
  if v_outcome is distinct from 'released' or public.process_billing_assignment_release_v1(v_good_intent) is distinct from 'noop' then
    raise exception 'Worker did not publish the eligible assignment exactly once';
  end if;
  v_result:=public.open_assignment_doc_for_member_v1(v_student,v_good,clock_timestamp(),null);
  if v_result#>>'{doc,student_id}' is distinct from v_student::text then raise exception 'Published schedule remained hidden'; end if;

  begin
    perform public.cancel_assignment_release_for_owner_v1(v_owner,v_good,v_good_intent);
    raise exception 'Owner cancelled an already released generation';
  exception when sqlstate 'PT409' then null;
  end;
  v_result:=public.schedule_assignment_for_billing_v1(v_owner,v_cancel,clock_timestamp()+interval '1 hour');
  v_cancel_intent:=(v_result#>>'{release_schedule,id}')::uuid;

  v_scheduled:=clock_timestamp()+interval '1 second';
  perform public.schedule_assignment_for_billing_v1(v_owner,v_missed,v_scheduled);
  select id into strict v_missed_intent from private.billing_assignment_release_intents where assignment_id=v_missed;
  v_cutoff:=clock_timestamp();
  update public.billing_trials set started_at=v_cutoff-interval '720 hours',ends_at=v_cutoff where subject_user_id=v_owner;
  update public.billing_account_access set starts_at=v_cutoff-interval '720 hours',access_ends_at=v_cutoff where subject_user_id=v_owner;
  update public.effective_feature_entitlements set starts_at=v_cutoff-interval '720 hours',expires_at=v_cutoff
    where subject_user_id=v_owner and feature_key='classrooms.create';
  update public.effective_feature_entitlement_audit set new_starts_at=v_cutoff-interval '720 hours',new_expires_at=v_cutoff
    where subject_user_id=v_owner and feature_key='classrooms.create' and new_source='trial';
  perform public.billing_apply_due_access_v1('{"limit":25}');
  begin
    perform public.publish_scheduled_assignment_for_owner_v1(v_owner,v_cancel,v_cancel_intent);
    raise exception 'Publish Now succeeded after billing access expired';
  exception when sqlstate 'PT403' then null;
  end;
  update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=false where singleton;
  if public.get_assignment_release_states_for_owner_v1(v_owner,v_classroom,array[v_cancel])
    #>>'{0,release_schedule,id}' is distinct from v_cancel_intent::text then
    raise exception 'The disabled flag hid the persisted schedule';
  end if;
  begin
    update public.assignments set is_draft=false where id=v_cancel;
    raise exception 'The disabled flag allowed a direct publication bypass';
  exception when sqlstate 'PT409' then null;
  end;
  v_result:=public.cancel_assignment_release_for_owner_v1(v_owner,v_cancel,v_cancel_intent);
  if v_result#>>'{assignment,is_draft}' is distinct from 'true' or v_result->'release_schedule' is distinct from 'null'::jsonb
    or public.get_assignment_release_states_for_owner_v1(v_owner,v_classroom,array[v_cancel]) is distinct from '[]'::jsonb
    or not exists(select 1 from private.billing_assignment_release_intents where id=v_cancel_intent and state='cancelled') then
    raise exception 'Cancellation with cutoff disabled did not clear the schedule and preserve its draft';
  end if;
  v_result:=public.discard_pristine_assignment_draft_atomic(v_cancel,v_owner,
    (select updated_at from public.assignments where id=v_cancel));
  if v_result->>'discarded' is distinct from 'false' then
    raise exception 'Pristine cleanup deleted a cancelled schedule and its audit history';
  end if;
  update private.stripe_billing_settings set classroom_new_work_cutoff_enabled=true where singleton;
  if public.process_billing_assignment_release_v1(v_cancel_intent) is distinct from 'noop' then
    raise exception 'Worker reconsidered a cancelled generation';
  end if;
  perform pg_sleep(greatest(0,extract(epoch from v_scheduled-clock_timestamp()))+0.05);

  v_offering:=(public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9311,
    'stripe_account','acct_release311','provider_mode','test','stripe_product_id','prod_release311',
    'stripe_price_id','price_release311','currency','usd','unit_amount',1900,'interval','month','classroom_limit',5,
    'features','{"catalog_key":"pika-release-fixture"}'::jsonb,'ai_definition',null,
    'availability',jsonb_build_object('is_available',true)))->>'offering_version_id')::uuid;
  v_binding:=(public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',v_owner,
    'stripe_account','acct_release311','provider_mode','test','stripe_price_id','price_release311',
    'stripe_customer_id','cus_release311','stripe_subscription_id','sub_release311',
    'offering_version_id',v_offering))->>'subscription_id')::uuid;
  v_claim:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',v_binding,'lease_seconds',120));
  v_period_start:=v_scheduled-interval '1 second';
  v_result:=public.billing_finish_lifecycle_v1(jsonb_build_object('subscription_id',v_binding,'lease_token',v_claim->'lease_token',
    'fencing_token',v_claim->'fencing_token','expected_subscription_revision',v_claim->'subscription_revision',
    'expected_account_plan_revision',v_claim->'expected_account_plan_revision','outcome','paid',
    'invoice_id','in_release311','period_start',v_period_start,'period_end',v_period_start+interval '1 month',
    'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false));
  if v_result->>'status' is distinct from 'applied' or not public.restore_billing_classroom_v1(v_owner,v_classroom) then
    raise exception 'Fixture could not restore the paid classroom';
  end if;
  if not private.billing_classroom_can_start_work_v1(v_classroom) then raise exception 'Fixture did not regain access'; end if;
  v_outcome:=public.process_billing_assignment_release_v1(v_missed_intent);
  if v_outcome is distinct from 'suppressed' or public.process_billing_assignment_release_v1(v_missed_intent) is distinct from 'noop' then
    raise exception 'Late paid access rescued a missed assignment';
  end if;
  if not exists(select 1 from private.billing_assignment_release_intents
    where id=v_missed_intent and state='suppressed' and notice_code='access_unavailable')
    or not exists(select 1 from public.assignments where id=v_missed and is_draft and released_at is null) then
    raise exception 'Suppression lost the assignment or its teacher notice';
  end if;
  if public.get_assignment_release_states_for_owner_v1(v_owner,v_classroom,array[v_missed])
    #>>'{0,release_schedule,notice_code}' is distinct from 'access_unavailable' then
    raise exception 'Owner could not read the suppression notice';
  end if;
  begin
    perform public.schedule_assignment_for_billing_v1(v_owner,v_missed,clock_timestamp()+interval '1 hour');
    raise exception 'A blind reschedule replaced a suppression notice';
  exception when sqlstate 'PT409' then null;
  end;
  v_result:=public.schedule_assignment_for_billing_v1(v_owner,v_missed,clock_timestamp()+interval '1 hour',v_missed_intent);
  v_previous_intent:=v_missed_intent;
  v_missed_intent:=(v_result#>>'{release_schedule,id}')::uuid;
  if v_missed_intent is not distinct from v_previous_intent
    or not exists(select 1 from private.billing_assignment_release_intents
      where id=v_previous_intent and state='suppressed' and notice_code='access_unavailable') then
    raise exception 'Explicit rescheduling failed to recover the draft and retain its suppression history';
  end if;
  v_result:=public.publish_scheduled_assignment_for_owner_v1(v_owner,v_missed,v_missed_intent);
  if v_result#>>'{assignment,is_draft}' is distinct from 'false'
    or v_result->'release_schedule' is distinct from 'null'::jsonb
    or public.get_assignment_release_states_for_owner_v1(v_owner,v_classroom,array[v_missed]) is distinct from '[]'::jsonb
    or public.process_billing_assignment_release_v1(v_missed_intent) is distinct from 'noop' then
    raise exception 'Publish Now did not atomically release the draft and finish its generation';
  end if;
end $$;

rollback;
