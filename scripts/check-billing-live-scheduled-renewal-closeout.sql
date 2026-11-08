-- Rollback-only proof of the live scheduled closeout lane. No Stripe calls.
begin;
set local statement_timeout='30s';
set local lock_timeout='3s';

create temporary table live_closeout_324(
  kind text primary key,subject_id uuid,subscription_id uuid,schedule_operation uuid,through_at timestamptz,
  renewal_end timestamptz,invoice_id text,source_version uuid,target_version uuid,classroom_id uuid
);

create function pg_temp.claim_live_closeout_324(p_subscription uuid,p_capable boolean default true)
returns jsonb language sql as $$
  select public.billing_claim_live_renewal_closeout_v1('abcdefghijklmnopqrst','acct_Live324',
    jsonb_build_object('subscription_id',p_subscription,'lease_seconds',120)
    || case when p_capable then '{"scheduled_changes_enabled":true}'::jsonb else '{}'::jsonb end);
$$;

create function pg_temp.live_closeout_fence_324(p_claim jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('operation_id',p_claim->'operation_id','subscription_id',p_claim->'subscription_id',
    'lease_token',p_claim->'lease_token','fencing_token',p_claim->'fencing_token','subscription_revision',p_claim->'subscription_revision',
    'expected_account_plan_revision',p_claim->'expected_account_plan_revision','operation_revision',p_claim->'operation_revision');
$$;

-- Simulate a lease expiring after the provisional terminal state but before
-- the shared writer checks it. Structured lost_claim must roll back both.
create function pg_temp.expire_live_closeout_324()
returns trigger language plpgsql as $$
begin
  if new.id::text=current_setting('pika.fixture_expire_closeout_324',true) then
    update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second'
      where id=new.subscription_id;
  end if;
  return new;
end;
$$;
create trigger fixture_live_closeout_324 after update of status on public.billing_renewal_closeouts
  for each row when (new.status='payment_won') execute function pg_temp.expire_live_closeout_324();
create trigger fixture_live_schedule_324 after update of state on private.billing_scheduled_plan_changes
  for each row when (new.state='closed_unpaid') execute function pg_temp.expire_live_closeout_324();

do $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Live324';
  u uuid; attempt uuid; subscription uuid; schedule_operation uuid; source_version uuid; target_version uuid; classroom_id uuid;
  through_at timestamptz; source_start timestamptz; target_end timestamptz; max_invoice text; target_invoice text;
  offering jsonb; c jsonb; req jsonb; r jsonb; terms record; scenario text; rpc text;
begin
  foreach rpc in array array['billing_list_live_renewal_closeouts_v1','billing_claim_live_renewal_closeout_v1',
    'billing_checkpoint_live_renewal_closeout_v1','billing_finish_live_renewal_closeout_v1'] loop
    if has_function_privilege('anon','public.'||rpc||'(text,text,jsonb)','execute')
      or has_function_privilege('authenticated','public.'||rpc||'(text,text,jsonb)','execute')
      or not has_function_privilege('service_role','public.'||rpc||'(text,text,jsonb)','execute') then
      raise exception 'Live closeout ACL differs for %',rpc;
    end if;
  end loop;
  if (select live_scheduled_closeout_enabled from private.stripe_billing_settings where singleton)
    or has_function_privilege('service_role','private.billing_live_closeout_schedule_candidate_v1(uuid,text)','execute') then
    raise exception 'Scheduled closeout did not default off or exposed private scope proof';
  end if;
  update private.stripe_billing_settings set live_project_ref=project,live_stripe_account=account,
    classroom_new_work_cutoff_enabled=true where singleton;
  update private.stripe_billing_settings set live_payment_lifecycle_enabled=true,live_closeout_enabled=true,
    live_checkout_admission_enabled=true,live_checkout_writes_enabled=true where singleton;
  for terms in select * from (values
    ('pro','max','Max',3900,12,'prod_Max324','price_Max324'),
    ('plus','pro','Pro',1900,5,'prod_Pro324','price_Pro324')
  ) as versions(plan,public_plan,name,amount,classroom_limit,product,price) loop
    r:=public.billing_register_live_checkout_offering_v1(project,account,jsonb_build_object(
      'plan_key',terms.plan,'version',324001,'stripe_account',account,'provider_mode','live',
      'stripe_product_id',terms.product,'stripe_price_id',terms.price,'currency','usd','interval','month',
      'unit_amount',terms.amount,'classroom_limit',terms.classroom_limit,'features',jsonb_build_object(
        'catalog_key','pika:repolight-2026-10-29:'||terms.public_plan||':usd:month',
        'display_name',terms.name,'release_tag','repolight-2026-10-29','repolight_analysis',true),
      'ai_definition',null,'availability',jsonb_build_object('is_available',true)));
    if terms.plan='pro' then source_version:=(r->>'offering_version_id')::uuid;
    else target_version:=(r->>'offering_version_id')::uuid; end if;
  end loop;
  offering:=public.billing_get_live_checkout_offering_v1(project,account,jsonb_build_object('offering_version_id',source_version,'stripe_account',account));

  foreach scenario in array array['closed','paid','ordinary'] loop
    u:=gen_random_uuid(); attempt:=gen_random_uuid(); classroom_id:=gen_random_uuid();
    schedule_operation:=case when scenario<>'ordinary' then gen_random_uuid() end;
    insert into public.users(id,email,role) values(u,'closeout-324-'||scenario||'@example.invalid','teacher');
    perform public.set_account_plan_v1(gen_random_uuid(),u,'pro','test:closeout324','fixture',
      coalesce((select revision from public.account_plans where subject_user_id=u),0));
    insert into public.classrooms(id,teacher_id,title,class_code)
      values(classroom_id,u,'Preserved classroom',case scenario when 'closed' then 'SC324001' when 'paid' then 'SC324002' else 'SC324003' end);
    perform public.set_account_plan_v1(gen_random_uuid(),u,'free','test:closeout324','fixture',
      (select revision from public.account_plans where subject_user_id=u));
    perform public.billing_reserve_live_checkout_v1(project,account,jsonb_build_object(
      'attempt_id',attempt,'subject_user_id',u,'offering',offering,'lookup_key',offering->>'catalog_key',
      'success_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=success',
      'cancel_url','https://pika.codepet.ca/billing?checkout='||attempt||'&result=cancel'));
    c:=public.billing_claim_live_checkout_v1(project,account,jsonb_build_object('attempt_id',attempt,'lease_seconds',120));
    req:=jsonb_build_object('attempt_id',attempt,'lease_token',c->'lease_token','fencing_token',c->'fencing_token');
    perform public.billing_save_live_checkout_progress_v1(project,account,req||jsonb_build_object(
      'customer_id','cus_Live324'||scenario,'session_id','cs_live_Live324'||scenario));
    perform public.billing_finish_live_checkout_v1(project,account,req||jsonb_build_object('outcome','bound','subscription_id','sub_Live324'||scenario));
    select id into strict subscription from public.stripe_billing_subscription_bindings where subject_user_id=u;
    through_at:=date_trunc('second',clock_timestamp())-case scenario
      when 'closed' then interval '12 days' when 'paid' then interval '11 days' else interval '10 days' end;
    source_start:=through_at-interval '1 month';
    target_end:=private.billing_scheduled_term_end_v1(through_at,case when schedule_operation is null then source_version else target_version end);
    max_invoice:='in_Max324'||scenario; target_invoice:='in_Renewal324'||scenario;
    c:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',subscription,'lease_seconds',120));
    req:=jsonb_build_object('subscription_id',subscription,'lease_token',c->'lease_token',
      'fencing_token',c->'fencing_token','expected_subscription_revision',c->'subscription_revision',
      'expected_account_plan_revision',c->'expected_account_plan_revision',
      'provider_status','active','cancel_at_period_end',false,'obligations_cleared',false);
    r:=public.billing_finish_live_lifecycle_v1(project,account,req||jsonb_build_object(
      'outcome','paid','invoice_id',max_invoice,'period_start',source_start,'period_end',through_at));
    if r->>'status' is distinct from 'applied' then raise exception 'Fixture failed to settle source Max %',scenario; end if;

    -- Installation is independently verified in 322. Persist its normalized
    -- result, then use the real 323 writer to prove the failed target invoice.
    if schedule_operation is not null then
      insert into private.billing_scheduled_plan_changes(id,subject_user_id,subscription_id,source_offering_version_id,
        target_offering_version_id,paid_period_start,effective_at,quote_expires_at,last_paid_invoice_id,
        expected_plan_revision,expected_access_revision,expected_entitlement_revision,state,confirmed_at,provider_schedule_id)
        select schedule_operation,u,subscription,source_version,target_version,source_start,through_at,through_at-interval '15 minutes',
          max_invoice,access.account_plan_revision,access.revision,access.entitlement_revision,'scheduled',
          through_at-interval '1 day','sub_sched_Live324'||scenario
        from public.billing_account_access access where access.subject_user_id=u;
    end if;
    update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second' where id=subscription;
    c:=public.billing_claim_live_subscription_v1(project,account,jsonb_build_object('subscription_id',subscription,'lease_seconds',120));
    req:=jsonb_build_object('subscription_id',subscription,'lease_token',c->'lease_token',
      'fencing_token',c->'fencing_token','expected_subscription_revision',c->'subscription_revision',
      'expected_account_plan_revision',c->'expected_account_plan_revision',
      'provider_status','past_due','cancel_at_period_end',false,'obligations_cleared',false,
      'outcome','renewal_failed','invoice_id',target_invoice,'period_start',through_at,'period_end',target_end);
    if schedule_operation is null then
      r:=public.billing_finish_live_lifecycle_v1(project,account,req);
    else
      r:=public.billing_finish_live_scheduled_renewal_v1(project,account,req||jsonb_build_object(
        'operation_id',schedule_operation,'provider_schedule_id','sub_sched_Live324'||scenario,'target_offering_version_id',target_version));
    end if;
    if r->>'status' is distinct from 'applied' then raise exception 'Fixture failed to record renewal failure %: %',scenario,r; end if;
    insert into live_closeout_324 values(scenario,u,subscription,schedule_operation,through_at,target_end,target_invoice,
      source_version,target_version,classroom_id);
  end loop;
  -- These failure observations arrive after grace has elapsed, so the shared
  -- access writer already materialized Free. The sweep must not reapply it.
  r:=public.billing_apply_due_live_paid_access_v1(project,account,'{"limit":10}');
  if r->>'processed' is distinct from '0'
    or (select count(*) from live_closeout_324 c
      join public.account_plans plan on plan.subject_user_id=c.subject_id and plan.plan_key='free'
      join public.billing_account_access access on access.subscription_id=c.subscription_id
        and access.account_plan_revision=plan.revision and access.expiry_applied_at>=access.access_ends_at)<>3
    or exists(select 1 from private.billing_classroom_restrictions r join live_closeout_324 c on c.subject_id=r.subject_user_id) then
    raise exception 'Grace expiry did not apply Free exactly once or prematurely restricted classrooms: %',r;
  end if;
end;
$$;

do $$
declare
  project constant text:='abcdefghijklmnopqrst'; account constant text:='acct_Live324';
  unpaid live_closeout_324%rowtype; paid live_closeout_324%rowtype; ordinary live_closeout_324%rowtype;
  c jsonb; r jsonb; proof jsonb; envelope jsonb; evidence jsonb;
begin
  select * into strict unpaid from live_closeout_324 where kind='closed';
  select * into strict paid from live_closeout_324 where kind='paid';
  select * into strict ordinary from live_closeout_324 where kind='ordinary';
  if public.billing_list_live_renewal_closeouts_v1(project,account,'{"limit":1,"scheduled_changes_enabled":true}')#>>'{items,0,subscription_id}'
    is distinct from ordinary.subscription_id::text then raise exception 'Dormant scheduled gate changed ordinary discovery'; end if;

  update private.stripe_billing_settings set live_scheduled_closeout_enabled=true where singleton;
  update public.stripe_billing_subscription_bindings set next_reconcile_at=clock_timestamp()-interval '1 second' where id=unpaid.subscription_id;
  if public.billing_claim_live_subscription_v1(project,account,
    jsonb_build_object('subscription_id',unpaid.subscription_id,'lease_seconds',120))->>'status' is distinct from 'busy'
    or public.billing_list_live_renewal_closeouts_v1(project,account,'{"limit":1}')#>>'{items,0,subscription_id}'
      is distinct from ordinary.subscription_id::text
    or pg_temp.claim_live_closeout_324(unpaid.subscription_id,false)->>'status' is distinct from 'busy' then
    raise exception 'Scheduled arbitration or older ordinary caller compatibility failed';
  end if;
  update private.billing_scheduled_plan_changes set last_paid_invoice_id='in_Bad324' where id=unpaid.schedule_operation;
  if public.billing_list_live_renewal_closeouts_v1(project,account,'{"limit":1,"scheduled_changes_enabled":true}')#>>'{items,0,subscription_id}'
      is distinct from paid.subscription_id::text
    or pg_temp.claim_live_closeout_324(unpaid.subscription_id)->>'status' is distinct from 'plan_conflict'
    or exists(select 1 from public.billing_renewal_closeouts where subscription_id=unpaid.subscription_id) then
    raise exception 'Mismatched installed schedule fell back to ordinary closeout';
  end if;
  update private.billing_scheduled_plan_changes set last_paid_invoice_id='in_Max324closed' where id=unpaid.schedule_operation;
  if public.billing_list_live_renewal_closeouts_v1(project,account,'{"limit":1,"scheduled_changes_enabled":true}')#>>'{items,0,subscription_id}'
    is distinct from unpaid.subscription_id::text then raise exception 'Earliest exact scheduled closeout was not discovered'; end if;

  c:=pg_temp.claim_live_closeout_324(unpaid.subscription_id);
  if c->>'status' is distinct from 'claimed' or c#>>'{scheduled,operation_id}' is distinct from unpaid.schedule_operation::text
    or c#>>'{binding,offering_version_id}' is distinct from unpaid.source_version::text
    or c#>>'{scheduled,target_binding,offering_version_id}' is distinct from unpaid.target_version::text
    or c#>>'{scheduled,target_binding,provider_mode}' is distinct from 'live'
    or c->>'invoice_id' is distinct from unpaid.invoice_id then raise exception 'Scheduled closeout did not claim both exact terms'; end if;
  proof:=c->'scheduled';
  envelope:=pg_temp.live_closeout_fence_324(c);
  c:=public.billing_checkpoint_live_renewal_closeout_v1(project,account,envelope||'{"stage":"cancel_requested"}');
  if c->>'status' is distinct from 'claimed' or c->'scheduled' is distinct from proof
    or public.billing_checkpoint_live_renewal_closeout_v1(project,account,envelope||'{"stage":"cancel_requested"}')->>'status'
      is distinct from 'lost_claim' then raise exception 'Scheduled checkpoint changed scope or accepted stale fence'; end if;
  evidence:=jsonb_build_object('kind','invoice_voided','invoiceId',unpaid.invoice_id,'subscriptionCanceled',true,'obligationsCleared',true);
  envelope:=pg_temp.live_closeout_fence_324(c)||jsonb_build_object('outcome','closed','evidence',evidence,
    'scheduled_operation_id',unpaid.schedule_operation,'provider_schedule_id',proof->'provider_schedule_id');
  if public.billing_finish_live_renewal_closeout_v1(project,account,envelope||'{"provider_schedule_id":"sub_sched_Wrong324"}')->>'status'
    is distinct from 'plan_conflict' then raise exception 'Wrong schedule ID closed a subscription'; end if;

  -- Pausing new scheduled closeouts keeps an exact existing closeout recoverable.
  update private.stripe_billing_settings set live_scheduled_closeout_enabled=false where singleton;
  update public.stripe_billing_subscription_bindings set lease_expires_at=clock_timestamp()-interval '1 second' where id=unpaid.subscription_id;
  if public.billing_finish_live_renewal_closeout_v1(project,account,envelope)->>'status' is distinct from 'lost_claim' then
    raise exception 'Stale lease completed an unpaid schedule'; end if;
  c:=pg_temp.claim_live_closeout_324(unpaid.subscription_id);
  if c->>'status' is distinct from 'claimed' or c->>'stage' is distinct from 'cancel_requested'
    or c->'scheduled' is distinct from proof then raise exception 'Paused lane lost its durable closeout stage'; end if;
  envelope:=envelope||pg_temp.live_closeout_fence_324(c);
  perform set_config('pika.fixture_expire_closeout_324',unpaid.schedule_operation::text,true);
  r:=public.billing_finish_live_renewal_closeout_v1(project,account,envelope);
  perform set_config('pika.fixture_expire_closeout_324','',true);
  if r->>'status' is distinct from 'lost_claim'
    or not exists(select 1 from private.billing_scheduled_plan_changes where id=unpaid.schedule_operation and state='scheduled')
    or not exists(select 1 from public.billing_renewal_closeouts where subscription_id=unpaid.subscription_id and status='queued')
    or exists(select 1 from private.billing_classroom_restrictions where subject_user_id=unpaid.subject_id) then
    raise exception 'Lease failure after provisional unpaid closure did not roll back';
  end if;
  r:=public.billing_finish_live_renewal_closeout_v1(project,account,envelope);
  if r->>'status' is distinct from 'closed'
    or not exists(select 1 from private.billing_scheduled_plan_changes where id=unpaid.schedule_operation
      and state='closed_unpaid' and live_settled_invoice_id is null)
    or not exists(select 1 from public.billing_renewal_closeouts where subscription_id=unpaid.subscription_id
      and scheduled_operation_id=unpaid.schedule_operation and status='closed')
    or not exists(select 1 from public.stripe_billing_subscription_bindings where id=unpaid.subscription_id and not is_current
      and obligations_cleared_at is not null and terminal_confirmed_at is not null and offering_version_id=unpaid.source_version)
    or not exists(select 1 from private.billing_classroom_restrictions
      where subject_user_id=unpaid.subject_id and classroom_id=unpaid.classroom_id and restored_at is null) then
    raise exception 'Verified unpaid closure did not atomically retire payer and restrict retained classroom';
  end if;

  update private.stripe_billing_settings set live_scheduled_closeout_enabled=true where singleton;
  c:=pg_temp.claim_live_closeout_324(paid.subscription_id);
  if c->>'status' is distinct from 'claimed' then raise exception 'Paid race could not claim scheduled closeout'; end if;
  evidence:=jsonb_build_object('kind','paid','invoiceId',paid.invoice_id,
    'periodStart',to_char(paid.through_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'periodEnd',to_char(paid.renewal_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'providerStatus','active','cancelAtPeriodEnd',false,'terminalObligationsCleared',false);
  envelope:=pg_temp.live_closeout_fence_324(c)||jsonb_build_object('outcome','payment_won','evidence',evidence,
    'scheduled_operation_id',paid.schedule_operation,'provider_schedule_id',c#>'{scheduled,provider_schedule_id}');
  if public.billing_finish_live_renewal_closeout_v1(project,account,envelope||jsonb_build_object('lease_token',gen_random_uuid()))->>'status'
    is distinct from 'lost_claim' then raise exception 'Stale lease accepted scheduled payment'; end if;
  begin
    perform public.billing_finish_live_renewal_closeout_v1(project,account,envelope||jsonb_build_object('evidence',
      evidence||jsonb_build_object('periodEnd',to_char((paid.renewal_end+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))));
    raise exception 'Wrong scheduled term accepted paid closeout';
  exception when invalid_parameter_value then
    if sqlerrm<>'billing_scheduled_closeout_term_invalid' then raise; end if;
  end;
  perform set_config('pika.fixture_expire_closeout_324',c->>'operation_id',true);
  r:=public.billing_finish_live_renewal_closeout_v1(project,account,envelope);
  perform set_config('pika.fixture_expire_closeout_324','',true);
  if r->>'status' is distinct from 'lost_claim'
    or not exists(select 1 from private.billing_scheduled_plan_changes where id=paid.schedule_operation and state='scheduled')
    or not exists(select 1 from public.billing_renewal_closeouts where subscription_id=paid.subscription_id and status='queued')
    or exists(select 1 from public.stripe_billing_invoice_effects where stripe_account=account and stripe_invoice_id=paid.invoice_id) then
    raise exception 'Lease failure after provisional payment-won state did not roll back';
  end if;
  r:=public.billing_finish_live_renewal_closeout_v1(project,account,envelope);
  if r->>'status' is distinct from 'payment_won'
    or not exists(select 1 from private.billing_scheduled_plan_changes where id=paid.schedule_operation
      and state='applied' and live_settled_invoice_id=paid.invoice_id)
    or not exists(select 1 from public.billing_renewal_closeouts where subscription_id=paid.subscription_id and status='payment_won')
    or not exists(select 1 from public.billing_account_access a join public.account_plans p on p.subject_user_id=a.subject_user_id
      where a.subscription_id=paid.subscription_id and a.last_paid_invoice_id=paid.invoice_id
        and a.offering_version_id=paid.target_version and a.paid_through=paid.renewal_end and p.plan_key='plus')
    or (select count(*) from public.stripe_billing_invoice_effects where subscription_id=paid.subscription_id)<>2 then
    raise exception 'Payment-won did not adopt the exact target once';
  end if;

  c:=pg_temp.claim_live_closeout_324(ordinary.subscription_id,false);
  if c->>'status' is distinct from 'claimed' or c ? 'scheduled' then raise exception 'Ordinary live fallback changed'; end if;
  r:=public.billing_finish_live_renewal_closeout_v1(project,account,pg_temp.live_closeout_fence_324(c)||jsonb_build_object(
    'outcome','closed','evidence',jsonb_build_object('kind','invoice_voided','invoiceId',ordinary.invoice_id,
      'subscriptionCanceled',true,'obligationsCleared',true)));
  if r->>'status' is distinct from 'closed' or not exists(select 1 from public.billing_renewal_closeouts
    where subscription_id=ordinary.subscription_id and scheduled_operation_id is null and status='closed') then
    raise exception 'Ordinary live closeout required scheduled capability or evidence';
  end if;
end;
$$;

rollback;
