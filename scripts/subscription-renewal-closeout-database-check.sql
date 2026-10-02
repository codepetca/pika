-- Rollback-only integration contracts. Run only after separately authorized 228
-- application. No provider calls; normalized provider evidence is synthetic.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$ declare fn text; begin
  foreach fn in array array['billing_list_renewal_closeouts_v1','billing_claim_renewal_closeout_v1',
    'billing_checkpoint_renewal_closeout_v1','billing_finish_renewal_closeout_v1','billing_claim_subscription_v1',
    'billing_list_work_v1','billing_requeue_subscription_v1'] loop
    if has_function_privilege('anon','public.'||fn||'(jsonb)','execute')
      or has_function_privilege('authenticated','public.'||fn||'(jsonb)','execute')
      or not has_function_privilege('service_role','public.'||fn||'(jsonb)','execute') then raise exception 'Closeout RPC ACL drift: %',fn; end if;
  end loop;
  if has_table_privilege('anon','public.billing_renewal_closeouts','select')
    or has_table_privilege('authenticated','public.billing_renewal_closeouts','select')
    or has_table_privilege('service_role','public.billing_renewal_closeouts','insert')
    or has_table_privilege('service_role','public.billing_renewal_closeouts','update')
    or has_table_privilege('service_role','public.billing_renewal_closeouts','delete')
    or not (select relrowsecurity from pg_class where oid='public.billing_renewal_closeouts'::regclass)
    or has_function_privilege('service_role','private.billing_check_renewal_closeout_fence_v1(jsonb)','execute')
    or has_function_privilege('service_role','private.billing_claim_subscription_before_closeout_v1(jsonb)','execute') then
    raise exception 'Closeout private boundary exposed'; end if;
end $$;
update private.stripe_billing_settings set sandbox_enabled=false where singleton;
set local role service_role;
do $$ begin
  begin perform public.billing_list_renewal_closeouts_v1('{"limit":1}'); raise exception 'Disabled gate accepted';
  exception when object_not_in_prerequisite_state then if sqlerrm<>'stripe_billing_sandbox_disabled' then raise; end if; end;
end $$;
reset role;
update private.stripe_billing_settings set sandbox_enabled=true where singleton;

create temporary table renewal_closeout_cases(name text primary key,subject_id uuid,subscription_id uuid,version_id uuid);
grant select on renewal_closeout_cases to service_role;
create function pg_temp.closeout_fence(c jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('operation_id',c->>'operation_id','subscription_id',c->>'subscription_id',
    'lease_token',c->>'lease_token','fencing_token',c->'fencing_token','subscription_revision',c->'subscription_revision',
    'expected_account_plan_revision',c->'expected_account_plan_revision','operation_revision',c->'operation_revision');
$$;
-- Build representative durable states through the actual catalog, binding and
-- paid/failed-renewal writers. Only these synthetic users are created.
do $$ declare offering jsonb; binding jsonb; c jsonb; r jsonb; req jsonb; name text; u uuid; s uuid;
  through_at timestamptz; begin
  offering:=public.billing_register_offering_v1(jsonb_build_object('plan_key','plus','version',9228,
    'stripe_account','acct_closeout228','provider_mode','test','stripe_product_id','prod_closeout228',
    'stripe_price_id','price_closeout228','currency','usd','unit_amount',1900,'interval','month',
    'classroom_limit',7,'features','{}'::jsonb,'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
  foreach name in array array['closed','paid','manual','entitlement','partial','future','incomplete'] loop
    u:=gen_random_uuid();
    insert into public.users(id,email,role) values(u,'closeout228-'||name||'@example.invalid','teacher');
    if not exists(select 1 from public.account_plans where subject_user_id=u) then
      perform public.set_account_plan_v1(gen_random_uuid(),u,'free','test:closeout','fixture',0); end if;
    binding:=public.billing_bind_customer_v1(jsonb_build_object('subject_user_id',u,'stripe_account','acct_closeout228',
      'provider_mode','test','stripe_price_id','price_closeout228','stripe_customer_id','cus_closeout228'||name,
      'stripe_subscription_id','sub_closeout228'||name,'offering_version_id',offering->>'offering_version_id'));
    s:=(binding->>'subscription_id')::uuid;
    through_at:=clock_timestamp()-case when name='future' then interval '6 days' else interval '8 days' end;
    c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
    req:=jsonb_build_object('subscription_id',s,'lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
      'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
      'outcome','paid','invoice_id','in_closeout228first'||name,'period_start',through_at-interval '30 days',
      'period_end',through_at,'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false);
    r:=public.billing_finish_lifecycle_v1(req);
    if r->>'status'<>'applied' then raise exception 'Fixture first payment failed: %',r; end if;
    c:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
    r:=public.billing_finish_lifecycle_v1(req||jsonb_build_object('lease_token',c->>'lease_token','fencing_token',c->'fencing_token',
      'expected_subscription_revision',c->'subscription_revision','expected_account_plan_revision',c->'expected_account_plan_revision',
      'outcome','renewal_failed','invoice_id','in_closeout228renew'||name,'period_start',through_at,
      'period_end',through_at+interval '30 days','provider_status','past_due'));
    if r->>'status'<>'applied' then raise exception 'Fixture failed renewal failed: %',r; end if;
    insert into renewal_closeout_cases values(name,u,s,(offering->>'offering_version_id')::uuid);
  end loop;
  perform public.billing_apply_due_access_v1('{"limit":100}');
end $$;

-- Invalid envelopes/fences fail before lookup, including unknown extra fields.
set local role service_role;
do $$ declare base jsonb; bad jsonb; k text; value jsonb; begin
  base:=jsonb_build_object('operation_id',gen_random_uuid(),'subscription_id',gen_random_uuid(),'lease_token',gen_random_uuid(),
    'fencing_token',1,'subscription_revision',1,'expected_account_plan_revision',1,'operation_revision',1,'stage','pause_requested');
  foreach k in array array['operation_id','subscription_id','lease_token','fencing_token','subscription_revision','expected_account_plan_revision','operation_revision','stage'] loop
    foreach bad in array array[base-k,jsonb_set(base,array[k],'null'::jsonb)] loop
      begin perform public.billing_checkpoint_renewal_closeout_v1(bad); raise exception 'Missing closeout field accepted: %',k;
      exception when invalid_parameter_value then if sqlerrm<>'billing_closeout_request_invalid' then raise; end if; end;
    end loop;
  end loop;
  foreach value in array array['0'::jsonb,'-1'::jsonb,'1.5'::jsonb,'"1"'::jsonb,'true'::jsonb,'[]'::jsonb] loop
    begin perform public.billing_checkpoint_renewal_closeout_v1(base||jsonb_build_object('operation_revision',value));
      raise exception 'Malformed closeout fence accepted';
    exception when invalid_parameter_value then if sqlerrm<>'billing_closeout_request_invalid' then raise; end if; end;
  end loop;
  foreach bad in array array[null::jsonb,'[]'::jsonb,base||'{"unknown":true}'::jsonb,base||'{"stage":"closed"}'::jsonb] loop
    begin perform public.billing_checkpoint_renewal_closeout_v1(bad); raise exception 'Malformed closeout envelope accepted';
    exception when invalid_parameter_value then if sqlerrm<>'billing_closeout_request_invalid' then raise; end if; end;
  end loop;
  begin perform public.billing_list_renewal_closeouts_v1('{"limit":2}'); raise exception 'Unbounded closeout list accepted';
  exception when invalid_parameter_value then if sqlerrm<>'billing_closeout_request_invalid' then raise; end if; end;
end $$;

-- The future grace boundary remains ineligible; elapsed duration is exact.
do $$ declare s uuid; r jsonb; begin
  select subscription_id into s from renewal_closeout_cases where name='future';
  r:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  if r->>'status'<>'superseded' then raise exception 'Closeout started before exact grace cutoff'; end if;
  if exists(select 1 from public.billing_renewal_closeouts where subscription_id=s) then raise exception 'Premature closeout journal'; end if;
end $$;
reset role;
do $$ declare a public.billing_account_access%rowtype; begin
  select a0.* into a from public.billing_account_access a0 join renewal_closeout_cases c on c.subject_id=a0.subject_user_id where c.name='future';
  if a.access_ends_at-a.paid_through<>interval '168 hours' then raise exception 'Grace duration drift'; end if;
  begin update public.billing_account_access set access_ends_at=a.access_ends_at+interval '1 second' where subject_user_id=a.subject_user_id;
    raise exception 'Nonexact cutoff accepted'; exception when check_violation then null; end;
end $$;

-- Crash/reclaim/fencing and durable stage preservation. SQL cannot emulate the
-- provider network race; these tests drive the resulting states explicitly.
create temporary table renewal_closeout_saved(claim jsonb);
grant select,insert,update,delete on renewal_closeout_saved to service_role;
set local role service_role;
do $$ declare s uuid; c jsonb; fresh jsonb; r jsonb; begin
  select subscription_id into s from renewal_closeout_cases where name='closed';
  c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  if c->>'status'<>'claimed' then raise exception 'Due closeout not claimed: %',c; end if;
  if public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120))->>'status'<>'busy'
    or public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120))->>'status'<>'busy' then
    raise exception 'Shared binding lease did not serialize workers'; end if;
  fresh:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"pause_requested"}');
  if fresh->>'status'<>'claimed' or (fresh->>'operation_revision')::bigint<=(c->>'operation_revision')::bigint then raise exception 'Checkpoint did not advance fence'; end if;
  if public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"pause_requested"}')->>'status'<>'lost_claim' then
    raise exception 'Stale checkpoint accepted'; end if;
  c:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(fresh)||'{"stage":"pause_requested"}');
  r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"outcome":"deferred","reason":"provider_unavailable"}');
  if r->>'status'<>'deferred' or not exists(select 1 from public.billing_renewal_closeouts where id=(c->>'operation_id')::uuid and stage='pause_requested' and status='retry') then
    raise exception 'Deferral lost provider write intent'; end if;
  if public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120))->>'status'<>'busy' then
    raise exception 'General reconciliation stole closeout recovery'; end if;
  insert into renewal_closeout_saved values(c);
end $$;
reset role;
update public.billing_renewal_closeouts set next_attempt_at=clock_timestamp()-interval '1 second'
  where subscription_id=(select subscription_id from renewal_closeout_cases where name='closed');
set local role service_role;
do $$ declare old jsonb; c jsonb; s uuid; begin
  select claim into old from renewal_closeout_saved;
  s:=(old->>'subscription_id')::uuid;
  c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  if c->>'operation_id'<>old->>'operation_id' or c->>'stage'<>'pause_requested'
    or (c->>'fencing_token')::bigint<=(old->>'fencing_token')::bigint then raise exception 'Reclaim lost stable operation identity'; end if;
  c:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"void_requested"}');
  begin perform public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"pause_requested"}');
    raise exception 'Mutation stage moved backward';
  exception when invalid_parameter_value then if sqlerrm<>'billing_closeout_stage_invalid' then raise; end if; end;
  update renewal_closeout_saved set claim=c;
end $$;
reset role;
update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second'
  where id=(select subscription_id from renewal_closeout_cases where name='closed');
set local role service_role;
do $$ declare old jsonb; c jsonb; r jsonb; begin
  select claim into old from renewal_closeout_saved;
  if public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(old)||'{"stage":"void_requested"}')->>'status'<>'lost_claim' then
    raise exception 'Expired lease accepted before mutation'; end if;
  c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',old->>'subscription_id','lease_seconds',120));
  if c->>'stage'<>'void_requested' or c->>'operation_id'<>old->>'operation_id' then raise exception 'Void crash recovery changed intent'; end if;
  c:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"cancel_requested"}');
  r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','closed',
    'evidence',jsonb_build_object('kind','invoice_voided','invoiceId',c->>'invoice_id','subscriptionCanceled',true,'obligationsCleared',true)));
  if r->>'status'<>'closed' then raise exception 'Verified closeout failed: %',r; end if;
  if not exists(select 1 from public.stripe_billing_subscription_bindings where id=(c->>'subscription_id')::uuid
    and not is_current and terminal_confirmed_at is not null and obligations_cleared_at is not null and lease_token is null) then
    raise exception 'Binding retired without complete proof or not retired'; end if;
  if public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','closed',
    'evidence',jsonb_build_object('kind','invoice_voided','invoiceId',c->>'invoice_id','subscriptionCanceled',true,'obligationsCleared',true)))->>'status'<>'lost_claim' then
    raise exception 'Completion replay bypassed released lease'; end if;
  if (select count(*) from public.billing_renewal_closeouts where subscription_id=(c->>'subscription_id')::uuid)<>1 then raise exception 'Duplicate operation created'; end if;
end $$;

-- Actual checkout reservation succeeds only after closure. It remains blocked
-- for unpaid, partial, pending and still-current paid subscriptions.
do $$ declare f record; offering jsonb; r jsonb; begin
  select * into f from renewal_closeout_cases where name='closed';
  offering:=public.billing_get_checkout_offering_v1(jsonb_build_object('offering_version_id',f.version_id,'stripe_account','acct_closeout228'));
  r:=public.billing_reserve_checkout_v1(jsonb_build_object('subject_user_id',f.subject_id,'attempt_id',gen_random_uuid(),
    'offering',offering,'lookup_key','closeout228-resubscribe',
    'success_url','http://localhost:3000/billing?checkout=success','cancel_url','http://localhost:3000/billing?checkout=cancel'));
  if r is null or r->>'status'='attention' then raise exception 'Cleared account cannot reserve resubscription: %',r; end if;
  select * into f from renewal_closeout_cases where name='partial';
  begin perform public.billing_reserve_checkout_v1(jsonb_build_object('subject_user_id',f.subject_id,'attempt_id',gen_random_uuid(),
    'offering',offering,'lookup_key','closeout228-blocked',
    'success_url','http://localhost:3000/billing?checkout=success','cancel_url','http://localhost:3000/billing?checkout=cancel'));
    raise exception 'Unclosed account can resubscribe';
  exception when unique_violation then if sqlerrm<>'checkout_account_already_bound_or_pending' then raise; end if; end;
end $$;

-- A late fully verified payment wins and restores the purchased offering once.
do $$ declare s uuid; c jsonb; r jsonb; evidence jsonb; revisions bigint; begin
  select subscription_id into s from renewal_closeout_cases where name='paid';
  c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  c:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"void_requested"}');
  evidence:=jsonb_build_object('kind','paid','invoiceId',c->>'invoice_id','periodStart',c->>'paid_through',
    'periodEnd',(c->>'paid_through')::timestamptz+interval '30 days','providerStatus','active',
    'cancelAtPeriodEnd',false,'terminalObligationsCleared',false);
  r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','payment_won','evidence',evidence));
  if r->>'status'<>'payment_won' or not exists(select 1 from public.billing_account_access where subscription_id=s
    and expiry_applied_at is null and failed_renewal_invoice_id is null and last_paid_invoice_id=c->>'invoice_id') then
    raise exception 'Payment did not win and restore access: %',r; end if;
  if (select count(*) from public.stripe_billing_invoice_effects where subscription_id=s and stripe_invoice_id=c->>'invoice_id')<>1 then
    raise exception 'Payment effect not deduplicated'; end if;
  if not exists(select 1 from public.effective_feature_entitlements e join renewal_closeout_cases f on f.subject_id=e.subject_user_id
    where f.name='paid' and e.feature_key='classrooms.create' and e.enabled and e.quota_limit=7) then
    raise exception 'Late payment lost purchased quota'; end if;
  if public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','payment_won','evidence',evidence))->>'status'<>'lost_claim' then
    raise exception 'Paid completion replay wrote twice'; end if;
  r:=public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  if r->>'status'<>'claimed' then raise exception 'Payment winner did not release ordinary reconciliation'; end if;
end $$;

-- Pending and partial payment stop provider work while retaining their binding.
do $$ declare c jsonb; s uuid; r jsonb; begin
  select subscription_id into s from renewal_closeout_cases where name='partial';
  c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  c:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"pause_requested"}');
  r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','attention','reason','partial_payment',
    'evidence',jsonb_build_object('kind','attention','reason','partial_payment')));
  if r->>'status'<>'attention' or not exists(select 1 from public.billing_renewal_closeouts where subscription_id=s and stage='pause_requested' and status='attention')
    or not exists(select 1 from public.stripe_billing_subscription_bindings where id=s and is_current) then raise exception 'Partial payment retired binding or lost intent'; end if;
  if public.billing_claim_subscription_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120))->>'status'<>'busy' then
    raise exception 'Attention allowed competing ordinary reconciliation'; end if;
  select subscription_id into s from renewal_closeout_cases where name='incomplete';
  c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  begin perform public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','closed',
    'evidence',jsonb_build_object('kind','invoice_voided','invoiceId',c->>'invoice_id','subscriptionCanceled',true,'obligationsCleared',false)));
    raise exception 'Incomplete obligations proof retired binding';
  exception when invalid_parameter_value then if sqlerrm<>'billing_closeout_evidence_invalid' then raise; end if; end;
  begin perform public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','closed',
    'evidence',jsonb_build_object('kind','invoice_voided','invoiceId','in_wrong','subscriptionCanceled',true,'obligationsCleared',true)));
    raise exception 'Wrong invoice retired binding';
  exception when invalid_parameter_value then if sqlerrm<>'billing_closeout_evidence_invalid' then raise; end if; end;
  r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','deferred','reason','payment_pending',
    'evidence',jsonb_build_object('kind','payment_pending','invoiceId',c->>'invoice_id')));
  if r->>'status'<>'deferred' or not exists(select 1 from public.stripe_billing_subscription_bindings where id=s and is_current) then
    raise exception 'Pending payment did not preserve binding'; end if;
end $$;
reset role;

-- A plan override and an entitlement-only override each fence already claimed
-- work without relying on a changed subscription or operation revision.
do $$ declare f record; c jsonb; p public.account_plans%rowtype; ent public.effective_feature_entitlements%rowtype; r jsonb; begin
  for f in select * from renewal_closeout_cases where name in ('manual','entitlement') loop
    c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',f.subscription_id,'lease_seconds',120));
    if c->>'status'<>'claimed' then raise exception 'Override fixture not claimed'; end if;
    r:=public.billing_requeue_subscription_v1(jsonb_build_object('subscription_id',f.subscription_id,
      'actor_ref','test:closeout','reason_code','recover_provider'));
    if r->>'status'<>'busy' then raise exception 'Operator requeue stole an active binding lease'; end if;
    if f.name='manual' then
      select * into p from public.account_plans where subject_user_id=f.subject_id;
      begin
        perform public.set_account_plan_v1(gen_random_uuid(),f.subject_id,'free','test:closeout','manual_override',p.revision);
        raise exception 'Public setter allowed an override of billing management';
      exception when insufficient_privilege then
        if sqlerrm<>'billing_managed_account_plan' then raise; end if;
      end;
      -- Only this privileged, rollback-only synthetic fixture simulates a saved
      -- override. The public setter must continue to refuse billing-managed rows.
      update public.account_plans set revision=revision+1,management_source='legacy',billing_offering_version_id=null
        where subject_user_id=f.subject_id;
    else
      select * into ent from public.effective_feature_entitlements where subject_user_id=f.subject_id and feature_key='classrooms.create';
      perform public.set_effective_feature_entitlement_v1(gen_random_uuid(),f.subject_id,'classrooms.create','manual',false,
        clock_timestamp(),null,0,'test:closeout','manual_override',ent.revision);
    end if;
    r:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"pause_requested"}');
    if r->>'status'<>'plan_conflict' then raise exception 'Override did not fence provider checkpoint: %',r; end if;
    r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"outcome":"deferred","reason":"provider_unavailable"}');
    if r->>'status'<>'plan_conflict' then raise exception 'Override did not fence completion'; end if;
    if not exists(select 1 from public.billing_renewal_closeouts where subscription_id=f.subscription_id and stage='queued') then
      raise exception 'Rejected override checkpoint changed stage'; end if;
    update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second'
      where id=f.subscription_id;
    r:=public.billing_requeue_subscription_v1(jsonb_build_object('subscription_id',f.subscription_id,
      'actor_ref','test:closeout','reason_code','recover_provider'));
    if r->>'status'<>'plan_conflict' then raise exception 'Operator requeue refreshed a manual override fence: %',r; end if;
    if not exists(select 1 from public.billing_renewal_closeouts where subscription_id=f.subscription_id
      and expected_account_plan_revision=(c->>'expected_account_plan_revision')::bigint
      and revision=(c->>'operation_revision')::bigint) then raise exception 'Refused requeue changed saved closeout fences'; end if;
  end loop;
end $$;
-- Five deferred completions exhaust the same bounded failure budget as the
-- foundation, preserving the last write intent and current binding for attention.
-- The incomplete fixture already has one deferred completion above.
do $$ declare s uuid; c jsonb; r jsonb; n integer; begin
  select subscription_id into s from renewal_closeout_cases where name='incomplete';
  for n in 2..5 loop
    update public.billing_renewal_closeouts set next_attempt_at=clock_timestamp()-interval '1 second'
      where subscription_id=s;
    c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
    if c->>'status'<>'claimed' then raise exception 'Retry budget fixture could not reclaim at %: %',n,c; end if;
    if n=2 then
      c:=public.billing_checkpoint_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"stage":"void_requested"}');
    end if;
    r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||'{"outcome":"deferred","reason":"provider_unavailable"}');
    if r->>'status' is distinct from case when n=5 then 'attention' else 'deferred' end then
      raise exception 'Retry budget outcome incorrect at %: %',n,r; end if;
    if not exists(select 1 from public.billing_renewal_closeouts where subscription_id=s
      and attempt_count=n and stage='void_requested') then raise exception 'Retry budget lost count or durable intent'; end if;
  end loop;
  if not exists(select 1 from public.billing_renewal_closeouts where subscription_id=s
    and status='attention' and next_attempt_at is null and attempt_count=5)
    or not exists(select 1 from public.stripe_billing_subscription_bindings where id=s and is_current and lease_token is null) then
    raise exception 'Exhausted closeout did not retain binding for attention'; end if;
  if public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120))->>'status'<>'busy' then
    raise exception 'Exhausted retry budget allowed another automatic claim'; end if;
end $$;
-- An old held webhook and its old reconciliation deadline must both be excluded
-- before LIMIT 1. The second synthetic account remains eligible in either arm.
do $$ declare held uuid; eligible uuid; state text; r jsonb; begin
  select subscription_id into held from renewal_closeout_cases where name='partial';
  select subscription_id into eligible from renewal_closeout_cases where name='future';
  update public.stripe_billing_subscription_bindings set reconcile_state='queued',reconcile_attempt_count=0,
    next_reconcile_at=case when id=held then '2000-01-01 UTC'::timestamptz else '2001-01-01 UTC'::timestamptz end
    where id in (held,eligible);
  insert into public.stripe_billing_event_inbox(stripe_account,provider_mode,stripe_event_id,payload_hash,event_type,
    subscription_id,status,next_attempt_at)
    values('acct_closeout228','test','evt_closeout228held',repeat('a',64),'invoice.payment_failed',held,'received','2000-01-01 UTC'),
      ('acct_closeout228','test','evt_closeout228eligible',repeat('b',64),'invoice.payment_failed',eligible,'received','2001-01-01 UTC');
  foreach state in array array['queued','retry','attention'] loop
    update public.billing_renewal_closeouts set status=state where subscription_id=held;
    update public.stripe_billing_event_inbox set status='received' where stripe_event_id in ('evt_closeout228held','evt_closeout228eligible');
    r:=public.billing_list_work_v1('{"limit":1}');
    if jsonb_array_length(r->'items')<>1 or r->'items'->0->>'subscription_id' is distinct from eligible::text
      or r->'items'->0->>'kind'<>'event' or r->'items'->0->'binding'->>'subscription_id' is distinct from eligible::text then
      raise exception 'Held % event starved another account or changed work shape: %',state,r; end if;
    update public.stripe_billing_event_inbox set status='completed' where stripe_event_id in ('evt_closeout228held','evt_closeout228eligible');
    r:=public.billing_list_work_v1('{"limit":1}');
    if jsonb_array_length(r->'items')<>1 or r->'items'->0->>'subscription_id' is distinct from eligible::text
      or r->'items'->0->>'kind'<>'reconcile' then
      raise exception 'Held % reconciliation starved another account: %',state,r; end if;
  end loop;
end $$;

-- A transient failure that exhausted the budget can be explicitly requeued
-- through the existing audited operator action; a late verified payment wins.
do $$ declare s uuid; old public.billing_renewal_closeouts%rowtype; c jsonb; r jsonb; begin
  select subscription_id into s from renewal_closeout_cases where name='incomplete';
  select * into old from public.billing_renewal_closeouts where subscription_id=s;
  if old.status<>'attention' or old.attempt_count<>5 then raise exception 'Recovery fixture has not exhausted retries'; end if;
  r:=public.billing_requeue_subscription_v1(jsonb_build_object('subscription_id',s,'actor_ref','test:closeout','reason_code','recover_provider'));
  if r->>'status'<>'requeued' then raise exception 'Operator could not recover eligible attention: %',r; end if;
  if not exists(select 1 from public.billing_renewal_closeouts where id=old.id and status='queued' and attempt_count=0
    and stage=old.stage and invoice_id=old.invoice_id and paid_through=old.paid_through and cutoff=old.cutoff
    and expected_account_plan_revision=old.expected_account_plan_revision and expected_access_revision=old.expected_access_revision
    and expected_entitlement_revision=old.expected_entitlement_revision and next_attempt_at<=clock_timestamp()) then
    raise exception 'Operator requeue lost intent, identity, retry reset, or original fences'; end if;
  if not exists(select 1 from public.stripe_billing_subscription_audit where subscription_id=s and outcome='requeued'
    and actor_ref='test:closeout' and reason_code='recover_provider') then raise exception 'Closeout recovery omitted operator audit'; end if;
  c:=public.billing_claim_renewal_closeout_v1(jsonb_build_object('subscription_id',s,'lease_seconds',120));
  if c->>'status'<>'claimed' or c->>'operation_id'<>old.id::text or c->>'stage'<>old.stage then
    raise exception 'Recovered closeout cannot reclaim its original operation'; end if;
  r:=public.billing_finish_renewal_closeout_v1(pg_temp.closeout_fence(c)||jsonb_build_object('outcome','payment_won',
    'evidence',jsonb_build_object('kind','paid','invoiceId',c->>'invoice_id','periodStart',c->>'paid_through',
      'periodEnd',(c->>'paid_through')::timestamptz+interval '30 days','providerStatus','active',
      'cancelAtPeriodEnd',false,'terminalObligationsCleared',false)));
  if r->>'status'<>'payment_won' or not exists(select 1 from public.billing_account_access where subscription_id=s
    and expiry_applied_at is null and failed_renewal_invoice_id is null and last_paid_invoice_id=old.invoice_id) then
    raise exception 'Late payment did not restore access after attention recovery: %',r; end if;
  if (select count(*) from public.stripe_billing_invoice_effects where subscription_id=s and stripe_invoice_id=old.invoice_id)<>1 then
    raise exception 'Attention recovery did not preserve payment deduplication'; end if;
end $$;
rollback;
