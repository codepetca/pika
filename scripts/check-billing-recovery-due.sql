-- Rollback-only proof on an owned Supabase replay.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

do $$
declare
  signature constant text := 'public.billing_recovery_due_v1(boolean,boolean,boolean,boolean,boolean,boolean,boolean,uuid)';
begin
  if not has_function_privilege('anon',signature,'execute')
    or has_function_privilege('authenticated',signature,'execute')
    or has_function_privilege('service_role',signature,'execute')
    or has_schema_privilege('anon','private','usage')
    or has_table_privilege('anon','vault.decrypted_secrets','select') then
    raise exception 'Unexpected recovery check authority';
  end if;
end;
$$;

do $$
begin
  perform vault.create_secret(encode(extensions.digest(repeat('a',43),'sha256'),'hex'),'pika_billing_recovery_check_sha256');
end;
$$;
set local role anon;
do $$
declare header text;
begin
  foreach header in array array['{}','{"x-pika-billing-recovery-secret":"' || repeat('b',43) || '"}'] loop
    perform set_config('request.headers',header,true);
    begin
      perform public.billing_recovery_due_v1(true,true,false,false,false,false,false,null);
      raise exception 'Recovery check accepted an unauthorized request';
    exception when insufficient_privilege then
      if sqlerrm<>'billing_recovery_check_unauthorized' then raise; end if;
    end;
  end loop;
end;
$$;
do $$
begin
  perform set_config('request.headers',jsonb_build_object('x-pika-billing-recovery-secret',repeat('a',43))::text,true);
  if public.billing_recovery_due_v1(true,false,false,false,false,false,false,null)
    is distinct from '{"paid":"unavailable","trial":null,"assignment_releases":false,"email_notices":false,"repolight":false}'::jsonb then
    raise exception 'An enabled worker must observe the unavailable database lane';
  end if;
end;
$$;
reset role;

create function pg_temp.assert_due(
  p_case text, p_paid text, p_trial text, p_email boolean default false,
  p_release_due boolean default false, p_email_due boolean default false,
  p_repolight boolean default false, p_teacher_id uuid default null, p_repolight_due boolean default false
) returns void language plpgsql as $$
declare actual jsonb;
begin
  actual:=public.billing_recovery_due_v1(p_paid is not null,p_trial is not null,false,false,false,p_email,p_repolight,p_teacher_id);
  if actual is distinct from jsonb_build_object('paid',p_paid,'trial',p_trial,
    'assignment_releases',p_release_due,'email_notices',p_email_due,'repolight',p_repolight_due) then
    raise exception 'Wrong recovery check for %: %',p_case,actual;
  end if;
end;
$$;

create function pg_temp.observe_paid(
  p_project text, p_account text, p_binding uuid, p_observation jsonb
) returns void language plpgsql as $$
declare claim jsonb;
begin
  update public.stripe_billing_subscription_bindings set next_reconcile_at=statement_timestamp()-interval '1 minute'
    where id=p_binding;
  claim:=public.billing_claim_live_subscription_v1(p_project,p_account,
    jsonb_build_object('subscription_id',p_binding,'lease_seconds',120));
  if claim->>'status' is distinct from 'claimed'
    or public.billing_finish_live_lifecycle_v1(p_project,p_account,jsonb_build_object(
      'subscription_id',p_binding,'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token',
      'expected_subscription_revision',claim->'subscription_revision',
      'expected_account_plan_revision',claim->'expected_account_plan_revision',
      'cancel_at_period_end',false,'obligations_cleared',false)||p_observation)->>'status' is distinct from 'applied' then
    raise exception 'Paid lifecycle fixture did not apply';
  end if;
end;
$$;

do $$
declare
  project constant text := 'abcdefghijklmnopqrst';
  account constant text := 'acct_Recovery329';
  trial_user uuid := gen_random_uuid();
  paid_user uuid := gen_random_uuid();
  classroom_id uuid := gen_random_uuid();
  v_assignment uuid := gen_random_uuid();
  attempt_id uuid := gen_random_uuid();
  notice_id uuid := gen_random_uuid();
  operation_id uuid := gen_random_uuid();
  version_id uuid;
  binding_id uuid;
  offering jsonb;
  fence jsonb;
  result jsonb;
  cutoff timestamptz := statement_timestamp()-interval '1 minute';
  paid_through timestamptz := statement_timestamp()-interval '8 days';
begin
  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true,live_trial_admission_enabled=true
    where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true where singleton;
  perform pg_temp.assert_due('empty lanes','idle','idle');

  insert into public.users(id,email,role,email_verified_at) values
    (trial_user,'trial-recovery@example.invalid','teacher',clock_timestamp()),
    (paid_user,'paid-recovery@example.invalid','teacher',clock_timestamp());
  perform public.set_account_plan_v1(gen_random_uuid(),trial_user,'free','test:billing-recovery','fixture',
    coalesce((select revision from public.account_plans where subject_user_id=trial_user),0));
  perform public.set_account_plan_v1(gen_random_uuid(),paid_user,'free','test:billing-recovery','fixture',
    coalesce((select revision from public.account_plans where subject_user_id=paid_user),0));

  perform public.billing_start_live_trial_v1(project,account,
    jsonb_build_object('subject_user_id',trial_user,'operation_id',operation_id));
  -- The check uses statement time. Make the new trial already active at the
  -- start of this fixture statement without shortening its 720-hour term.
  update public.billing_trials set started_at=cutoff,ends_at=cutoff+interval '720 hours' where subject_user_id=trial_user;
  update public.billing_account_access set starts_at=cutoff,access_ends_at=cutoff+interval '720 hours'
    where subject_user_id=trial_user;
  update public.effective_feature_entitlements set starts_at=cutoff,expires_at=cutoff+interval '720 hours'
    where subject_user_id=trial_user and feature_key='classrooms.create';
  perform pg_temp.assert_due('future trial','idle','idle');
  insert into private.repolight_provision_outbox(teacher_id,source_revision,eligibility_epoch,next_attempt_at)
    values(trial_user,private.repolight_provision_revision_v1(trial_user),1,cutoff)
    on conflict (teacher_id) do update set next_attempt_at=excluded.next_attempt_at;
  perform pg_temp.assert_due('RepoLight database gate off','idle','idle',false,false,false,true,null,false);
  update private.repolight_settings set managed_provisioning_enabled=true where singleton;
  perform pg_temp.assert_due('RepoLight outside worker scope','idle','idle',false,false,false,true,paid_user,false);
  perform pg_temp.assert_due('RepoLight trial retry in scope','idle','idle',false,false,false,true,trial_user,true);
  perform pg_temp.assert_due('RepoLight trial retry in full rollout','idle','idle',false,false,false,true,null,true);
  update private.repolight_provision_outbox set next_attempt_at=statement_timestamp()+interval '1 hour'
    where teacher_id=trial_user;
  perform pg_temp.assert_due('RepoLight retry still backing off','idle','idle',false,false,false,true,null,false);
  update public.billing_trials set started_at=cutoff-interval '720 hours',ends_at=cutoff where subject_user_id=trial_user;
  update public.billing_account_access set starts_at=cutoff-interval '720 hours',access_ends_at=cutoff
    where subject_user_id=trial_user;
  update public.effective_feature_entitlements set starts_at=cutoff-interval '720 hours',expires_at=cutoff
    where subject_user_id=trial_user and feature_key='classrooms.create';
  update private.stripe_billing_settings set live_trial_admission_enabled=false where singleton;
  perform pg_temp.assert_due('expired trial during admission pause','idle','due');
  if public.billing_apply_due_live_trial_access_v1(project,account,'{"limit":1}') is distinct from '{"processed":1}'::jsonb then
    raise exception 'The trial handler did not recognize the same candidate';
  end if;
  perform pg_temp.assert_due('processed trial','idle','idle');

  result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
    'plan_key','plus','version',1,'stripe_account',account,'provider_mode','live',
    'stripe_product_id','prod_Recovery329','stripe_price_id','price_Recovery329','currency','usd',
    'interval','month','unit_amount',1900,'classroom_limit',5,'features',jsonb_build_object(
      'catalog_key','pika:repolight-2026-10-29:pro:usd:month','display_name','Pro',
      'release_tag','repolight-2026-10-29','repolight_analysis',true),
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  version_id:=(result->>'offering_version_id')::uuid;
  update private.stripe_billing_settings set live_closeout_enabled=true where singleton;
  update private.stripe_billing_settings set live_checkout_admission_enabled=true,live_checkout_writes_enabled=true
    where singleton;
  offering:=public.billing_get_live_checkout_offering_v1(project,account,
    jsonb_build_object('offering_version_id',version_id,'stripe_account',account));
  perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
    'attempt_id',attempt_id,'subject_user_id',paid_user,'offering',offering,'lookup_key',offering->>'catalog_key',
    'success_url','https://pika.codepet.ca/billing?checkout='||attempt_id||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt_id||'&result=cancel'));
  update public.stripe_checkout_attempts
    set next_attempt_at=cutoff,lease_token=gen_random_uuid(),lease_expires_at=statement_timestamp()+interval '1 hour'
    where id=attempt_id;
  update private.stripe_billing_settings set live_checkout_admission_enabled=false,live_checkout_writes_enabled=false
    where singleton;
  perform pg_temp.assert_due('active checkout lease','idle','idle');
  update public.stripe_checkout_attempts set lease_expires_at=cutoff where id=attempt_id;
  perform pg_temp.assert_due('checkout retry with expired lease','due','idle');
  if public.billing_list_live_checkout_work_v1(project,account,'{"limit":1}')->'attempt_ids'
    is distinct from jsonb_build_array(attempt_id) then
    raise exception 'Checkout list did not recognize the same candidate';
  end if;
  update public.stripe_checkout_attempts set next_attempt_at=statement_timestamp()+interval '1 hour' where id=attempt_id;
  perform pg_temp.assert_due('future checkout retry','idle','idle');

  update public.stripe_checkout_attempts set next_attempt_at=cutoff where id=attempt_id;
  result:=public.billing_claim_live_checkout_v1(project,account,
    jsonb_build_object('attempt_id',attempt_id,'lease_seconds',120));
  fence:=jsonb_build_object('attempt_id',attempt_id,'lease_token',result->'lease_token','fencing_token',result->'fencing_token');
  perform public.billing_save_live_checkout_progress_v1(project,account,
    fence||'{"customer_id":"cus_Recovery329","session_id":"cs_live_Recovery329"}');
  perform public.billing_finish_live_checkout_v1(project,account,
    fence||'{"outcome":"bound","subscription_id":"sub_Recovery329"}');
  select id into strict binding_id from public.stripe_billing_subscription_bindings where subject_user_id=paid_user;
  update public.stripe_billing_subscription_bindings set next_reconcile_at=cutoff where id=binding_id;
  perform pg_temp.assert_due('bound subscription reconciliation','due','idle');
  if public.billing_list_live_work_v1(project,account,'{"limit":1}')#>>'{items,0,subscription_id}'
    is distinct from binding_id::text then
    raise exception 'Reconciliation list did not recognize the same candidate';
  end if;
  update public.stripe_billing_subscription_bindings set next_reconcile_at=statement_timestamp()+interval '1 hour'
    where id=binding_id;
  insert into public.stripe_billing_event_inbox(stripe_account,provider_mode,stripe_event_id,payload_hash,event_type,
    subscription_id,stripe_customer_id,stripe_subscription_id,next_attempt_at)
    values(account,'live','evt_Foreign329',repeat('b',64),'invoice.paid',
      binding_id,'cus_Foreign329','sub_Recovery329',cutoff);
  perform pg_temp.assert_due('foreign inbox event','idle','idle');
  insert into public.stripe_billing_event_inbox(stripe_account,provider_mode,stripe_event_id,payload_hash,event_type,
    subscription_id,stripe_customer_id,stripe_subscription_id,next_attempt_at)
    values(account,'live','evt_Bound329',repeat('c',64),'invoice.paid',
      binding_id,'cus_Recovery329','sub_Recovery329',cutoff);
  perform pg_temp.assert_due('bound inbox event before periodic reconciliation','due','idle');
  delete from public.stripe_billing_event_inbox where subscription_id=binding_id;
  perform pg_temp.observe_paid(project,account,binding_id,jsonb_build_object(
    'outcome','paid','invoice_id','in_First329','provider_status','active',
    'period_start',paid_through-interval '30 days','period_end',paid_through));
  perform pg_temp.observe_paid(project,account,binding_id,jsonb_build_object(
    'outcome','renewal_failed','invoice_id','in_Renew329','provider_status','past_due',
    'period_start',paid_through,'period_end',paid_through+interval '30 days'));
  update public.stripe_billing_subscription_bindings set next_reconcile_at=statement_timestamp()+interval '1 hour'
    where id=binding_id;
  -- An already-ended grace period is materialized by reconciliation itself.
  -- With periodic reconciliation in the future, only closeout is due now.
  perform pg_temp.assert_due('failed renewal closeout','due','idle');
  if public.billing_list_live_renewal_closeouts_v1(project,account,'{"limit":1}')#>>'{items,0,subscription_id}'
    is distinct from binding_id::text then
    raise exception 'Closeout list did not recognize the same candidate';
  end if;
  update private.stripe_billing_settings set live_closeout_enabled=false where singleton;
  perform pg_temp.assert_due('paid closeout disabled','idle','idle');

  insert into public.classrooms(id,teacher_id,title,class_code,archived_at)
    values(classroom_id,trial_user,'Recovery fixture','REC32901',clock_timestamp());
  insert into public.assignments(id,classroom_id,created_by,title,due_at)
    values(v_assignment,classroom_id,trial_user,'Shared work',clock_timestamp()+interval '1 day');
  insert into private.billing_assignment_release_intents(assignment_id,classroom_id,subject_user_id,scheduled_for,created_at)
    values(v_assignment,classroom_id,trial_user,cutoff,cutoff-interval '1 minute');
  perform pg_temp.assert_due('shared release visible to both lanes','idle','idle',false,true);
  perform pg_temp.assert_due('shared release when trial is off','idle',null,false,true);
  update private.billing_assignment_release_intents intent set state='cancelled',processed_at=clock_timestamp()
    where intent.assignment_id=v_assignment and intent.subject_user_id=trial_user;

  insert into private.billing_live_email_notices(id,project_ref,stripe_account,subject_user_id,source,source_id,
    access_revision,access_ends_at,kind,due_at,state,claim_token,sending_started_at)
    values(notice_id,project,account,trial_user,'trial',operation_id,1,cutoff,'expired',cutoff,
      'sending',gen_random_uuid(),cutoff);
  update private.stripe_billing_settings set live_email_notices_enabled=true where singleton;
  perform pg_temp.assert_due('email still sending','idle','idle',true);
  update private.billing_live_email_notices set sending_started_at=cutoff-interval '5 minutes' where id=notice_id;
  perform pg_temp.assert_due('email disabled in application','idle','idle');
  perform pg_temp.assert_due('interrupted email needs attention','idle','idle',true,false,true);
  if public.billing_claim_live_email_notice_v1(project,account) is distinct from '{"status":"empty","attention":1}'::jsonb then
    raise exception 'Email handler did not recognize the interrupted attempt';
  end if;
  perform pg_temp.assert_due('email already marked for attention','idle','idle',true);
end;
$$;

rollback;
