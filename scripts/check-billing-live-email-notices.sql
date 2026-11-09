-- Rollback-only proof on an owned disposable replay. All addresses are fictional.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

create function pg_temp.claim_notice_327()
returns jsonb language sql as $$
  select public.billing_claim_live_email_notice_v1('abcdefghijklmnopqrst','acct_Notice327');
$$;

create function pg_temp.finish_notice_327(p_notice jsonb,p_outcome text)
returns jsonb language sql as $$
  select public.billing_finish_live_email_notice_v1('abcdefghijklmnopqrst','acct_Notice327',
    jsonb_build_object('id',p_notice->'id','claim_token',p_notice->'claim_token','outcome',p_outcome));
$$;

create function pg_temp.bind_notice_327(p_teacher uuid,p_offering jsonb,p_suffix text)
returns uuid language plpgsql as $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Notice327';
  attempt uuid:=gen_random_uuid();
  claim jsonb;
  fence jsonb;
  subscription uuid;
begin
  perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
    'attempt_id',attempt,'subject_user_id',p_teacher,'offering',p_offering,'lookup_key',p_offering->>'catalog_key',
    'success_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=success',
    'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=cancel'));
  claim:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',attempt,'lease_seconds',120));
  fence:=jsonb_build_object('attempt_id',attempt,'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token');
  perform public.billing_save_live_checkout_progress_v1(project,account,fence||jsonb_build_object(
    'customer_id','cus_Notice327'||p_suffix,'session_id','cs_live_Notice327'||p_suffix));
  perform public.billing_finish_live_checkout_v1(project,account,
    fence||jsonb_build_object('outcome','bound','subscription_id','sub_Notice327'||p_suffix));
  select id into strict subscription from public.stripe_billing_subscription_bindings where subject_user_id=p_teacher;
  return subscription;
end;
$$;

create function pg_temp.observe_notice_327(
  p_subscription uuid,p_outcome text,p_invoice text,p_start timestamptz,p_end timestamptz,p_cancel boolean default false
) returns text language plpgsql as $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Notice327';
  claim jsonb;
begin
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second' where id=p_subscription;
  claim:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',p_subscription,'lease_seconds',120));
  if claim->>'status' is distinct from 'claimed' then raise exception 'Could not claim live payment fixture: %',claim->>'status'; end if;
  return public.billing_finish_live_lifecycle_v1(project,account,jsonb_build_object('subscription_id',p_subscription,
    'lease_token',claim->'lease_token','fencing_token',claim->'fencing_token','expected_subscription_revision',claim->'subscription_revision',
    'expected_account_plan_revision',claim->'expected_account_plan_revision','outcome',p_outcome,'invoice_id',p_invoice,
    'period_start',p_start,'period_end',p_end,'provider_status',case when p_outcome='renewal_failed' then 'past_due' else 'active' end,
    'cancel_at_period_end',p_cancel,'obligations_cleared',false))->>'status';
end;
$$;

-- Simulate the passage of time without changing the trial's 720-hour terms.
create function pg_temp.age_trial_notice_327(p_subject uuid,p_cutoff timestamptz)
returns void language plpgsql as $$
begin
  update public.billing_trials set started_at=p_cutoff-interval '720 hours',ends_at=p_cutoff where subject_user_id=p_subject;
  update public.billing_account_access set starts_at=p_cutoff-interval '720 hours',access_ends_at=p_cutoff where subject_user_id=p_subject;
  update public.effective_feature_entitlements set starts_at=p_cutoff-interval '720 hours',expires_at=p_cutoff
    where subject_user_id=p_subject and feature_key='classrooms.create';
end;
$$;

do $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Notice327';
  trial_user uuid:=gen_random_uuid(); paused_user uuid:=gen_random_uuid(); sandbox_user uuid:=gen_random_uuid();
  paid_user uuid:=gen_random_uuid(); failed_user uuid:=gen_random_uuid(); expired_user uuid:=gen_random_uuid();
  operation uuid:=gen_random_uuid(); paid_subscription uuid; failed_subscription uuid; expired_subscription uuid;
  version_id uuid; offering jsonb; result jsonb; notice jsonb; rpc text; subject uuid;
  now_at timestamptz:=date_trunc('second',clock_timestamp());
  paid_cutoff timestamptz:=now_at+interval '10 days';
  through_at timestamptz:=now_at-interval '1 day';
  paused_cutoff timestamptz:=now_at+interval '2 days';
  expired_cutoff timestamptz:=now_at-interval '10 minutes';
begin
  foreach rpc in array array['public.billing_claim_live_email_notice_v1(text,text)',
    'public.billing_finish_live_email_notice_v1(text,text,jsonb)'] loop
    if has_function_privilege('anon',rpc,'execute') or has_function_privilege('authenticated',rpc,'execute')
      or not has_function_privilege('service_role',rpc,'execute') then raise exception 'Unexpected notice authority: %',rpc; end if;
  end loop;
  if has_table_privilege('service_role','private.billing_live_email_notices','select')
    or has_table_privilege('service_role','private.billing_live_email_notices','insert')
    or exists(select 1 from information_schema.columns where table_schema='private' and table_name='billing_live_email_notices'
      and column_name in ('email','recipient')) then raise exception 'Recipient or outbox internals directly exposed'; end if;
  if pg_temp.claim_notice_327() is distinct from '{"status":"disabled","attention":0}'::jsonb then
    raise exception 'Notice claims did not default off';
  end if;

  foreach subject in array array[trial_user,paused_user,sandbox_user,paid_user,failed_user,expired_user] loop
    insert into public.users(id,email,role,email_verified_at) values(subject,subject||'@example.invalid','teacher',clock_timestamp());
    perform public.set_account_plan_v1(gen_random_uuid(),subject,'free','test:notices327','fixture',
      coalesce((select revision from public.account_plans where subject_user_id=subject),0));
  end loop;
  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_trial_lifecycle_enabled=true,live_trial_admission_enabled=true,
    live_payment_lifecycle_enabled=true,live_closeout_enabled=true,live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  perform public.billing_start_live_trial_v1(project,account,jsonb_build_object('subject_user_id',paused_user,'operation_id',gen_random_uuid()));
  perform pg_temp.age_trial_notice_327(paused_user,paused_cutoff);
  if exists(select 1 from private.billing_live_email_notices) then raise exception 'Paused gate enqueued notices'; end if;
  update private.stripe_billing_settings set live_email_notices_enabled=true where singleton;
  if (select count(*) from private.billing_live_email_notices)<>1
    or not exists(select 1 from private.billing_live_email_notices where subject_user_id=paused_user
      and kind='ending_24_hours' and due_at=paused_cutoff-interval '24 hours' and state='pending') then
    raise exception 'Enable did not backfill only the still-future trial reminder';
  end if;
  if public.billing_claim_live_email_notice_v1(project,'acct_Foreign327') is distinct from '{"status":"disabled","attention":0}'::jsonb
    or public.billing_claim_live_email_notice_v1('bcdefghijklmnopqrstu',account) is distinct from '{"status":"disabled","attention":0}'::jsonb
    or pg_temp.claim_notice_327() is distinct from '{"status":"empty","attention":0}'::jsonb then
    raise exception 'Notice scope or future reminder claim differed';
  end if;

  begin
    perform public.billing_start_live_trial_v1(project,account,jsonb_build_object('subject_user_id',trial_user,'operation_id',operation));
    if (select count(*) from private.billing_live_email_notices where subject_user_id=trial_user)<>2 then
      raise exception 'Trial did not enqueue both reminders within its transaction';
    end if;
    raise exception using errcode='P3270',message='Fixture rollback';
  exception when sqlstate 'P3270' then null;
  end;
  if exists(select 1 from private.billing_live_email_notices where subject_user_id=trial_user)
    or exists(select 1 from public.billing_account_access where subject_user_id=trial_user) then
    raise exception 'Notice escaped rollback of the trial';
  end if;
  perform public.billing_start_live_trial_v1(project,account,jsonb_build_object('subject_user_id',trial_user,'operation_id',operation));
  perform public.billing_start_live_trial_v1(project,account,jsonb_build_object('subject_user_id',trial_user,'operation_id',operation));
  if (select count(*) from private.billing_live_email_notices notice
      join public.billing_account_access access on access.subject_user_id=notice.subject_user_id
      where notice.subject_user_id=trial_user and notice.source_id=operation and notice.source='trial'
      and notice.access_ends_at=access.access_ends_at and notice.due_at=notice.access_ends_at-
        case notice.kind when 'ending_7_days' then interval '168 hours' when 'ending_24_hours' then interval '24 hours' end)<>2
    or (select count(*) from private.billing_live_email_notices where subject_user_id=trial_user)<>2 then
    raise exception 'Trial reminders lost exact timing or duplicated on replay';
  end if;

  -- A sandbox trial has the same access shape but lacks the exact live source.
  insert into public.billing_trials(subject_user_id,operation_id,definition_id,started_at,ends_at)
    values(sandbox_user,gen_random_uuid(),'pro-trial-v1',now_at,now_at+interval '720 hours');
  insert into public.billing_account_access(subject_user_id,source,trial_subject_user_id,starts_at,access_ends_at,end_reason,account_plan_revision)
    select sandbox_user,'trial',sandbox_user,now_at,now_at+interval '720 hours','trial',revision
    from public.account_plans where subject_user_id=sandbox_user;
  perform private.billing_write_access_v1(sandbox_user,(select revision from public.account_plans where subject_user_id=sandbox_user),'trial_started');
  if exists(select 1 from private.billing_live_email_notices where subject_user_id=sandbox_user) then
    raise exception 'Unscoped trial produced a live notice';
  end if;

  -- A still-current trial cannot deliver a missed 7-day reminder several days late.
  update private.billing_live_email_notices set due_at=clock_timestamp()-interval '25 hours'
    where subject_user_id=trial_user and kind='ending_7_days';
  result:=pg_temp.claim_notice_327();
  if result is distinct from '{"status":"empty","attention":0}'::jsonb
    or not exists(select 1 from private.billing_live_email_notices where subject_user_id=trial_user and kind='ending_7_days' and state='suppressed') then
    raise exception 'Missed reminder was not suppressed';
  end if;
  update private.billing_live_email_notices set due_at=clock_timestamp()-interval '1 minute'
    where subject_user_id=trial_user and kind='ending_24_hours';
  update public.users set role='student' where id=trial_user;
  result:=pg_temp.claim_notice_327();
  if result is distinct from '{"status":"empty","attention":0}'::jsonb
    or exists(select 1 from private.billing_live_email_notices where subject_user_id=trial_user and state<>'suppressed') then
    raise exception 'A subject that stopped being a teacher could receive a notice';
  end if;

  perform pg_temp.age_trial_notice_327(paused_user,expired_cutoff);
  if exists(select 1 from private.billing_live_email_notices where subject_user_id=paused_user and kind='expired') then
    raise exception 'Clock passage alone emitted trial expiry';
  end if;
  result:=public.billing_apply_due_live_trial_access_v1(project,account,'{"limit":10}');
  if result->>'processed' is distinct from '1' then raise exception 'The trial writer did not materialize expiry'; end if;
  result:=pg_temp.claim_notice_327();
  notice:=result->'notice';
  if result->>'status' is distinct from 'claimed' or notice->>'kind' is distinct from 'expired'
    or notice->>'source' is distinct from 'trial' or (notice->>'access_ends_at')::timestamptz is distinct from expired_cutoff
    or pg_temp.finish_notice_327(notice,'sent') is distinct from '{"status":"sent"}'::jsonb then
    raise exception 'Trial expiry did not claim and finish with its exact cutoff';
  end if;
  if public.billing_apply_due_live_trial_access_v1(project,account,'{"limit":10}') is distinct from '{"processed":0}'::jsonb
    or (select count(*) from private.billing_live_email_notices where subject_user_id=paused_user and kind='expired')<>1 then
    raise exception 'Repeated trial sweep duplicated expiry';
  end if;

  result:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
    'plan_key','plus','version',327001,'stripe_account',account,'provider_mode','live','stripe_product_id','prod_Notice327',
    'stripe_price_id','price_Notice327','currency','cad','unit_amount',2700,'interval','month','classroom_limit',5,
    'features','{"catalog_key":"pika:repolight-2026-10-29:pro:cad:month","display_name":"Pro","release_tag":"repolight-2026-10-29","repolight_analysis":true}'::jsonb,
    'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  version_id:=(result->>'offering_version_id')::uuid;
  offering:=public.billing_get_live_checkout_offering_v1(project,account,
    jsonb_build_object('offering_version_id',version_id,'stripe_account',account));
  paid_subscription:=pg_temp.bind_notice_327(paid_user,offering,'Paid');
  if pg_temp.observe_notice_327(paid_subscription,'paid','in_Notice327Paid',paid_cutoff-interval '1 month',paid_cutoff,true)
    is distinct from 'applied' then raise exception 'Could not observe paid cancellation'; end if;
  if pg_temp.observe_notice_327(paid_subscription,'paid','in_Notice327Paid',paid_cutoff-interval '1 month',paid_cutoff,true)
    is distinct from 'replayed'
    or (select count(*) from private.billing_live_email_notices where subject_user_id=paid_user)<>3 then
    raise exception 'Paid cancellation replay added notices';
  end if;
  update public.users set email='notice327-current@example.invalid' where id=paid_user;
  result:=pg_temp.claim_notice_327();
  notice:=result->'notice';
  if result->>'status' is distinct from 'claimed' or notice->>'kind' is distinct from 'cancellation'
    or notice->>'source' is distinct from 'paid' or notice->>'recipient' is distinct from 'notice327-current@example.invalid'
    or (notice->>'access_ends_at')::timestamptz is distinct from paid_cutoff
    or pg_temp.finish_notice_327(notice||jsonb_build_object('claim_token',gen_random_uuid()),'sent') is distinct from '{"status":"stale"}'::jsonb
    or public.billing_finish_live_email_notice_v1(project,'acct_Foreign327',
      jsonb_build_object('id',notice->'id','claim_token',notice->'claim_token','outcome','sent')) is distinct from '{"status":"stale"}'::jsonb then
    raise exception 'Cancellation claim lost current recipient, exact cutoff, or CAS scope';
  end if;
  if pg_temp.claim_notice_327() is distinct from '{"status":"empty","attention":0}'::jsonb then
    raise exception 'In-flight send was claimed twice';
  end if;
  update private.billing_live_email_notices set sending_started_at=clock_timestamp()-interval '6 minutes' where id=(notice->>'id')::uuid;
  result:=pg_temp.claim_notice_327();
  if result is distinct from '{"status":"empty","attention":1}'::jsonb
    or not exists(select 1 from private.billing_live_email_notices where id=(notice->>'id')::uuid and state='attention') then
    raise exception 'Interrupted send did not become terminal attention';
  end if;
  if pg_temp.claim_notice_327() is distinct from '{"status":"empty","attention":0}'::jsonb
    or pg_temp.finish_notice_327(notice,'sent') is distinct from '{"status":"stale"}'::jsonb then
    raise exception 'Terminal attention was reported twice or could finish later';
  end if;

  if pg_temp.observe_notice_327(paid_subscription,'paid','in_Notice327Paid',paid_cutoff-interval '1 month',paid_cutoff)
    is distinct from 'applied' then raise exception 'Could not undo paid cancellation'; end if;
  update private.billing_live_email_notices set due_at=clock_timestamp()-interval '1 minute' where subject_user_id=paid_user and state='pending';
  result:=pg_temp.claim_notice_327();
  if result is distinct from '{"status":"empty","attention":0}'::jsonb
    or exists(select 1 from private.billing_live_email_notices where subject_user_id=paid_user and state='pending') then
    raise exception 'Undo did not suppress obsolete cancellation reminders';
  end if;
  if pg_temp.observe_notice_327(paid_subscription,'paid','in_Notice327Paid',paid_cutoff-interval '1 month',paid_cutoff,true)
    is distinct from 'applied' then raise exception 'Could not begin a new cancellation episode'; end if;
  result:=pg_temp.claim_notice_327();
  notice:=result->'notice';
  if notice->>'kind' is distinct from 'cancellation' then raise exception 'New cancellation episode had no confirmation'; end if;
  update private.stripe_billing_settings set live_email_notices_enabled=false where singleton;
  if pg_temp.claim_notice_327() is distinct from '{"status":"disabled","attention":0}'::jsonb
    or pg_temp.finish_notice_327(notice,'attention') is distinct from '{"status":"attention"}'::jsonb then
    raise exception 'Pause did not fence new claims while preserving an in-flight result';
  end if;
  update private.stripe_billing_settings set live_email_notices_enabled=true where singleton;
  if (select count(*) from private.billing_live_email_notices where subject_user_id=paid_user)<>6 then
    raise exception 'Re-enable duplicated live reminders';
  end if;

  failed_subscription:=pg_temp.bind_notice_327(failed_user,offering,'Failed');
  if pg_temp.observe_notice_327(failed_subscription,'paid','in_Notice327Before',through_at-interval '1 month',through_at)
    is distinct from 'applied' or exists(select 1 from private.billing_live_email_notices where subject_user_id=failed_user) then
    raise exception 'Normally renewing paid term emitted an expiry notice';
  end if;
  if pg_temp.observe_notice_327(failed_subscription,'renewal_failed','in_Notice327Retry',through_at,through_at+interval '1 month')
    is distinct from 'applied' then raise exception 'Could not observe failed renewal'; end if;
  if (select count(*) from private.billing_live_email_notices where subject_user_id=failed_user)<>2
    or not exists(select 1 from private.billing_live_email_notices where subject_user_id=failed_user
      and kind='ending_24_hours' and due_at=through_at+interval '144 hours') then
    raise exception 'Grace scheduling manufactured a missed 7-day reminder or used the wrong cutoff';
  end if;
  result:=pg_temp.claim_notice_327();
  notice:=result->'notice';
  if notice->>'kind' is distinct from 'renewal_failed'
    or (notice->>'access_ends_at')::timestamptz is distinct from through_at+interval '168 hours'
    or pg_temp.finish_notice_327(notice,'sent') is distinct from '{"status":"sent"}'::jsonb then
    raise exception 'Failed renewal did not notify with the exact grace cutoff';
  end if;
  if pg_temp.observe_notice_327(failed_subscription,'paid','in_Notice327Retry',through_at,through_at+interval '1 month')
    is distinct from 'applied' then raise exception 'Could not recover failed renewal'; end if;
  update private.billing_live_email_notices set due_at=clock_timestamp()-interval '1 minute' where subject_user_id=failed_user and state='pending';
  result:=pg_temp.claim_notice_327();
  if result is distinct from '{"status":"empty","attention":0}'::jsonb
    or exists(select 1 from private.billing_live_email_notices where subject_user_id=failed_user and state='pending') then
    raise exception 'Renewal did not suppress obsolete grace reminders';
  end if;

  expired_subscription:=pg_temp.bind_notice_327(expired_user,offering,'Expired');
  if pg_temp.observe_notice_327(expired_subscription,'paid','in_Notice327Expired',expired_cutoff-interval '1 month',expired_cutoff,true)
    is distinct from 'applied' then raise exception 'Could not materialize elapsed paid access'; end if;
  result:=pg_temp.claim_notice_327();
  notice:=result->'notice';
  if notice->>'kind' is distinct from 'expired' or notice->>'source' is distinct from 'paid'
    or (notice->>'access_ends_at')::timestamptz is distinct from expired_cutoff
    or (select count(*) from private.billing_live_email_notices where subject_user_id=expired_user)<>1 then
    raise exception 'Elapsed cancellation did not produce exactly the materialized expiry';
  end if;
end;
$$;

rollback;
