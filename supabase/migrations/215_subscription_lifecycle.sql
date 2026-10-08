-- Subscription lifecycle, test-only and disabled behind the existing sandbox gate.
-- No provider mutations or gate activation. Historical payment evidence is retained.
create table public.billing_trial_definitions (
  id text primary key,
  plan_key text not null check (plan_key='plus'),
  classroom_limit integer not null check (classroom_limit=5),
  duration_seconds integer not null check (duration_seconds=2592000)
);
insert into public.billing_trial_definitions values ('pro-trial-v1','plus',5,2592000);
create trigger billing_trial_definitions_immutable before update or delete on public.billing_trial_definitions
  for each row execute function public.guard_stripe_billing_immutable_v1();

create table public.billing_trials (
  subject_user_id uuid primary key references public.users(id) on delete restrict,
  operation_id uuid not null unique,
  definition_id text not null references public.billing_trial_definitions(id),
  started_at timestamptz not null,
  ends_at timestamptz not null,
  converted_to_paid_at timestamptz,
  check (ends_at=started_at+interval '720 hours'),
  check (converted_to_paid_at is null or converted_to_paid_at>=started_at)
);

alter table public.account_plans drop constraint account_plans_management_source_check;
alter table public.account_plans add constraint account_plans_management_source_check
  check (management_source in ('legacy','billing','trial'));
alter table public.stripe_billing_subscription_bindings
  add column is_current boolean not null default true,
  add column terminal_confirmed_at timestamptz,
  add column obligations_cleared_at timestamptz;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.stripe_billing_subscription_bindings'::regclass
    and contype='u' and conkey in (
      array[(select attnum from pg_attribute where attrelid='public.stripe_billing_subscription_bindings'::regclass and attname='subject_user_id')],
      array[(select attnum from pg_attribute where attrelid='public.stripe_billing_subscription_bindings'::regclass and attname='stripe_account'),
        (select attnum from pg_attribute where attrelid='public.stripe_billing_subscription_bindings'::regclass and attname='provider_mode'),
        (select attnum from pg_attribute where attrelid='public.stripe_billing_subscription_bindings'::regclass and attname='stripe_customer_id')]) loop
    execute format('alter table public.stripe_billing_subscription_bindings drop constraint %I',c.conname);
  end loop;
end $$;
create unique index stripe_billing_current_subject on public.stripe_billing_subscription_bindings(subject_user_id) where is_current;
create unique index stripe_billing_current_customer on public.stripe_billing_subscription_bindings(stripe_account,provider_mode,stripe_customer_id) where is_current;

create table public.billing_account_access (
  subject_user_id uuid primary key references public.users(id) on delete restrict,
  source text not null check (source in ('trial','paid')),
  subscription_id uuid references public.stripe_billing_subscription_bindings(id) on delete restrict,
  offering_version_id uuid references public.stripe_billing_offering_versions(id) on delete restrict,
  trial_subject_user_id uuid references public.billing_trials(subject_user_id) on delete restrict,
  starts_at timestamptz not null,
  paid_period_start timestamptz,
  paid_through timestamptz,
  last_paid_invoice_id text,
  access_ends_at timestamptz not null,
  end_reason text not null check (end_reason in ('trial','cancellation','renewal_grace','renewal_pending')),
  failed_renewal_invoice_id text,
  account_plan_revision bigint not null check (account_plan_revision>0),
  entitlement_revision bigint,
  revision bigint not null default 1 check (revision>0),
  last_provider_verified_at timestamptz,
  expiry_applied_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (access_ends_at>starts_at),
  check ((source='trial' and trial_subject_user_id=subject_user_id and subscription_id is null and offering_version_id is null and end_reason='trial')
    or (source='paid' and subscription_id is not null and offering_version_id is not null and paid_through is not null and paid_period_start is not null and last_paid_invoice_id is not null)),
  check (paid_through is null or paid_through>paid_period_start),
  check (end_reason<>'renewal_grace' or (access_ends_at=paid_through+interval '168 hours' and failed_renewal_invoice_id is not null))
);
create index billing_account_access_due on public.billing_account_access(access_ends_at,subject_user_id)
  where expiry_applied_at is null and end_reason<>'renewal_pending';
create table public.billing_lifecycle_audit (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references public.users(id) on delete restrict,
  subscription_id uuid references public.stripe_billing_subscription_bindings(id) on delete restrict,
  operation_id uuid not null unique,
  reason text not null,
  previous_state jsonb,
  next_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

-- Shared writer: caller locks binding (if any), then subject plan, then entitlement.
-- The purchased version supplies quota; legacy plan-key limits are never used.
create function private.billing_write_access_v1(p_subject uuid,p_expected_revision bigint,p_reason text)
returns bigint language plpgsql security definer set search_path='' as $$
declare a public.billing_account_access%rowtype; p public.account_plans%rowtype;
  v public.stripe_billing_offering_versions%rowtype; t public.billing_trial_definitions%rowtype;
  v_plan text; v_previous_plan text; v_limit integer; v_expired boolean; e jsonb; v_ent_revision bigint; v_op uuid:=gen_random_uuid(); v_now timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||p_subject::text,20620260924));
  select * into p from public.account_plans where subject_user_id=p_subject for update;
  select * into a from public.billing_account_access where subject_user_id=p_subject for update;
  if not found or p.revision is distinct from p_expected_revision or a.account_plan_revision is distinct from p_expected_revision then
    raise exception using errcode='40001',message='account_plan_revision_conflict';
  end if;
  v_expired:=v_now>=a.access_ends_at and a.end_reason<>'renewal_pending';
  if a.source='trial' then
    select d.* into t from public.billing_trial_definitions d join public.billing_trials trial on trial.definition_id=d.id where trial.subject_user_id=p_subject;
    v_plan:=t.plan_key; v_limit:=t.classroom_limit;
  else
    select * into v from public.stripe_billing_offering_versions where id=a.offering_version_id;
    select plan_key into v_plan from public.stripe_billing_offerings where id=v.offering_id;
    v_limit:=v.classroom_limit;
  end if;
  if v_plan is null or v_limit is null then raise exception using errcode='55000',message='billing_definition_unavailable'; end if;
  if v_expired then v_plan:='free'; v_limit:=0; end if;
  select revision into v_ent_revision from public.effective_feature_entitlements where subject_user_id=p_subject and feature_key='classrooms.create';
  if a.entitlement_revision is not null and a.entitlement_revision is distinct from v_ent_revision then
    raise exception using errcode='40001',message='account_plan_revision_conflict'; end if;
  e:=public.set_effective_feature_entitlement_v1(v_op,p_subject,'classrooms.create',
    case when a.source='trial' then 'trial' else 'plan' end,not v_expired and v_limit>0,
    case when v_expired then v_now else a.starts_at end,
    case when v_expired then null else a.access_ends_at end,v_limit,'stripe:billing',p_reason,coalesce(v_ent_revision,0));
  v_previous_plan:=p.plan_key;
  update public.account_plans set plan_key=v_plan,revision=revision+1,
    management_source=case when a.source='trial' then 'trial' else 'billing' end,
    billing_offering_version_id=a.offering_version_id,updated_at=v_now where subject_user_id=p_subject returning * into p;
  insert into public.account_plan_audit(operation_id,subject_user_id,previous_plan_key,new_plan_key,new_classroom_limit,
    plan_revision,entitlement_revision,actor_ref,reason_code,request_fingerprint)
    values(v_op,p_subject,v_previous_plan,v_plan,v_limit,p.revision,(e->>'revision')::bigint,
      'stripe:billing',p_reason,md5(jsonb_build_object('access_revision',a.revision,'reason',p_reason)::text));
  update public.billing_account_access set account_plan_revision=p.revision,entitlement_revision=(e->>'revision')::bigint,
    expiry_applied_at=case when v_expired then v_now else null end,updated_at=v_now where subject_user_id=p_subject;
  return p.revision;
end; $$;

create function public.billing_get_access_status_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(p_request->>'subject_user_id')::uuid; a public.billing_account_access%rowtype;
  p public.account_plans%rowtype; entitlement public.effective_feature_entitlements%rowtype; v_limit integer; v_plan text; v_state text; v_pending boolean; v_expired boolean;
  v_now timestamptz:=clock_timestamp();
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  select * into p from public.account_plans where subject_user_id=v_user;
  if not found then raise exception using errcode='55000',message='billing_account_unavailable'; end if;
  select * into entitlement from public.effective_feature_entitlements where subject_user_id=v_user and feature_key='classrooms.create';
  select * into a from public.billing_account_access where subject_user_id=v_user;
  if not found or a.account_plan_revision<>p.revision or a.entitlement_revision is distinct from entitlement.revision then
    select quota_limit into v_limit from public.effective_feature_entitlements where subject_user_id=v_user and feature_key='classrooms.create';
    return jsonb_build_object('subject_user_id',v_user,'state',case when p.plan_key='free' then 'free' else 'unmanaged' end,
      'plan_key',p.plan_key,'offering_version_id',p.billing_offering_version_id,'classroom_limit',coalesce(v_limit,0),
      'access_ends_at',entitlement.expires_at,'renewal_at',null,'can_start_paid_work',coalesce(entitlement.enabled and v_now>=entitlement.starts_at
        and (entitlement.expires_at is null or v_now<entitlement.expires_at) and entitlement.quota_limit>0,false),'retryable',false,'revision',p.revision);
  end if;
  v_pending:=a.account_plan_revision<>p.revision or (v_now>=a.access_ends_at and a.end_reason='renewal_pending');
  v_expired:=v_now>=a.access_ends_at and not v_pending;
  if a.source='trial' then
    select d.plan_key,d.classroom_limit into v_plan,v_limit from public.billing_trial_definitions d
      join public.billing_trials trial on trial.definition_id=d.id where trial.subject_user_id=v_user;
  else
    select o.plan_key,v.classroom_limit into v_plan,v_limit from public.stripe_billing_offering_versions v
      join public.stripe_billing_offerings o on o.id=v.offering_id where v.id=a.offering_version_id;
  end if;
  v_state:=case when v_pending then 'synchronization_pending' when v_expired then 'free' when a.source='trial' then 'trial'
    when a.end_reason='renewal_grace' and v_now>=a.paid_through then 'renewal_grace' else 'paid' end;
  return jsonb_build_object('subject_user_id',v_user,'state',v_state,'plan_key',case when v_expired then 'free' else v_plan end,
    'offering_version_id',a.offering_version_id,'classroom_limit',case when v_expired then 0 else v_limit end,
    'access_ends_at',case when a.end_reason='renewal_pending' then null else a.access_ends_at end,
    'renewal_at',case when a.end_reason='renewal_pending' then a.paid_through else null end,
    'can_start_paid_work',v_now>=a.starts_at and not v_pending and not v_expired,'retryable',v_pending,'revision',a.revision);
end; $$;

create function public.billing_start_trial_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(p_request->>'subject_user_id')::uuid; v_op uuid:=(p_request->>'operation_id')::uuid;
  p public.account_plans%rowtype; trial public.billing_trials%rowtype; v_now timestamptz:=clock_timestamp(); v_revision bigint;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_user is null or v_op is null or not exists(select 1 from public.users where id=v_user and role='teacher') then
    raise exception using errcode='55000',message='billing_trial_ineligible'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  select * into trial from public.billing_trials where subject_user_id=v_user;
  if found then
    if trial.operation_id=v_op then return public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user)); end if;
    raise exception using errcode='55000',message='billing_trial_ineligible';
  end if;
  select * into p from public.account_plans where subject_user_id=v_user for update;
  if not found or p.plan_key<>'free' or (p.management_source<>'legacy' and not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false))
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current)
    or exists(select 1 from public.stripe_checkout_attempts where subject_user_id=v_user and status not in ('expired','bound')) then
    raise exception using errcode='55000',message='billing_trial_ineligible'; end if;
  insert into public.billing_trials(subject_user_id,operation_id,definition_id,started_at,ends_at)
    values(v_user,v_op,'pro-trial-v1',v_now,v_now+interval '720 hours');
  insert into public.billing_account_access(subject_user_id,source,trial_subject_user_id,starts_at,access_ends_at,end_reason,account_plan_revision)
    values(v_user,'trial',v_user,v_now,v_now+interval '720 hours','trial',p.revision)
    on conflict(subject_user_id) do update set source='trial',trial_subject_user_id=v_user,subscription_id=null,offering_version_id=null,
      starts_at=v_now,access_ends_at=v_now+interval '720 hours',end_reason='trial',paid_period_start=null,paid_through=null,last_paid_invoice_id=null,
      failed_renewal_invoice_id=null,expiry_applied_at=null,account_plan_revision=p.revision,revision=public.billing_account_access.revision+1;
  v_revision:=private.billing_write_access_v1(v_user,p.revision,'trial_started');
  insert into public.billing_lifecycle_audit(subject_user_id,operation_id,reason,next_state)
    values(v_user,v_op,'trial_started',public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user)));
  return public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_user));
end; $$;

-- Expiry changes access only. Financial closeout is a separately fenced provider
-- operation; current bindings remain ineligible for replacement until verified closed.
create function public.billing_apply_due_access_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.billing_account_access%rowtype; p public.account_plans%rowtype; v_count integer:=0;
  v_limit integer:=(p_request->>'limit')::integer;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_limit is null or v_limit not between 1 and 100 then raise exception using errcode='22023',message='billing_limit_invalid'; end if;
  -- Do not lock access rows before the plan lock: paid writers use binding,plan,access.
  for a in select * from public.billing_account_access where access_ends_at<=clock_timestamp()
    and end_reason<>'renewal_pending' and expiry_applied_at is null order by access_ends_at,subject_user_id limit v_limit loop
    perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||a.subject_user_id::text,20620260924));
    select * into p from public.account_plans where subject_user_id=a.subject_user_id for update;
    select * into a from public.billing_account_access where subject_user_id=a.subject_user_id for update;
    if a.expiry_applied_at is null and a.end_reason<>'renewal_pending' and a.access_ends_at<=clock_timestamp()
      and a.account_plan_revision=p.revision then
      perform private.billing_write_access_v1(a.subject_user_id,p.revision,'subscription_expired');
      insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,next_state)
        values(a.subject_user_id,a.subscription_id,gen_random_uuid(),'subscription_expired',
          public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',a.subject_user_id)));
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('processed',v_count);
end; $$;

create function public.billing_finish_lifecycle_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; e public.stripe_billing_invoice_effects%rowtype;
  v_outcome text:=p_request->>'outcome'; v_now timestamptz:=clock_timestamp(); v_period_start timestamptz;
  v_period_end timestamptz; v_end timestamptz; v_reason text; v_replayed boolean:=false; v_changed boolean:=false; v_preserve_cutoff boolean:=false;
  v_previous jsonb; v_event uuid:=(p_request->>'event_inbox_id')::uuid; v_revision bigint;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_outcome is null or v_outcome not in ('paid','renewal_failed','canceled','observed','noop','exception') then
    raise exception using errcode='22023',message='stripe_billing_finish_request_invalid'; end if;
  select * into b from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid for update;
  if not found or not b.is_current then return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  if b.lease_token is null or b.lease_token is distinct from (p_request->>'lease_token')::uuid
    or b.lease_expires_at<=v_now or b.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or b.revision is distinct from (p_request->>'expected_subscription_revision')::bigint then
    return jsonb_build_object('status','lost_claim','retry_scheduled',true); end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  if p.revision is distinct from (p_request->>'expected_account_plan_revision')::bigint
    or (a.subject_user_id is not null and (a.account_plan_revision<>p.revision or a.entitlement_revision is distinct from
      (select revision from public.effective_feature_entitlements where subject_user_id=b.subject_user_id and feature_key='classrooms.create'))) then
    return jsonb_build_object('status','plan_conflict','retry_scheduled',true); end if;
  if a.source='paid' and a.subscription_id<>b.id and exists(select 1 from public.stripe_billing_subscription_bindings where id=a.subscription_id and is_current) then
    return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  if v_event is not null then
    perform 1 from public.stripe_billing_event_inbox where id=v_event and subscription_id=b.id for update;
    if not found then return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  end if;
  -- Keep foundation retry accounting and privacy-safe exception handling.
  if v_outcome in ('exception','noop') then return private.billing_finish_subscription_foundation_v1(p_request); end if;
  v_previous:=case when a.subject_user_id is null then null else to_jsonb(a) end;
  if v_outcome='paid' then
    v_period_start:=(p_request->>'period_start')::timestamptz; v_period_end:=(p_request->>'period_end')::timestamptz;
    if p_request->>'invoice_id' is null or v_period_start is null or v_period_end is null or v_period_end<=v_period_start
      or (a.subscription_id=b.id and a.paid_through is not null and v_period_end<a.paid_through) then
      return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
    perform pg_advisory_xact_lock(hashtextextended('stripe-invoice:'||b.stripe_account||':'||(p_request->>'invoice_id'),20920260926));
    select * into e from public.stripe_billing_invoice_effects where stripe_account=b.stripe_account and stripe_invoice_id=p_request->>'invoice_id';
    if found then
      if e.subscription_id<>b.id or e.offering_version_id<>b.offering_version_id or e.period_start<>v_period_start or e.period_end<>v_period_end then
        return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
      v_replayed:=true;
    end if;
    -- Re-reading the original paid invoice is not a successful renewal. Preserve
    -- its recorded grace (including an elapsed cutoff) and failed invoice identity.
    -- An elapsed cancellation also cannot be undone by replaying its old payment.
    v_preserve_cutoff:=coalesce(a.source='paid' and a.subscription_id=b.id and a.paid_through=v_period_end
      and (a.end_reason='renewal_grace' or (a.end_reason='cancellation' and a.access_ends_at<=v_now)),false);
    if v_preserve_cutoff and a.last_paid_invoice_id is distinct from (p_request->>'invoice_id') then
      return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
    v_reason:=case when v_preserve_cutoff then a.end_reason
      when coalesce((p_request->>'cancel_at_period_end')::boolean,false) or coalesce(p_request->>'provider_status','')='canceled' then 'cancellation' else 'renewal_pending' end;
    v_end:=case when v_preserve_cutoff then a.access_ends_at else v_period_end end;
    v_changed:=a.subject_user_id is null or a.source<>'paid' or a.subscription_id<>b.id or a.paid_through is distinct from v_period_end
      or a.end_reason<>v_reason or (a.expiry_applied_at is not null and not v_preserve_cutoff);
    insert into public.billing_account_access(subject_user_id,source,subscription_id,offering_version_id,starts_at,
      paid_period_start,paid_through,last_paid_invoice_id,access_ends_at,end_reason,failed_renewal_invoice_id,account_plan_revision,last_provider_verified_at)
      values(b.subject_user_id,'paid',b.id,b.offering_version_id,v_period_start,v_period_start,v_period_end,p_request->>'invoice_id',v_end,v_reason,
        case when v_preserve_cutoff then a.failed_renewal_invoice_id else null end,p.revision,v_now)
    on conflict(subject_user_id) do update set source='paid',subscription_id=b.id,offering_version_id=b.offering_version_id,
      trial_subject_user_id=null,starts_at=v_period_start,paid_period_start=v_period_start,paid_through=v_period_end,
      last_paid_invoice_id=p_request->>'invoice_id',access_ends_at=v_end,end_reason=v_reason,
      failed_renewal_invoice_id=case when v_preserve_cutoff then a.failed_renewal_invoice_id else null end,
      last_provider_verified_at=v_now,revision=public.billing_account_access.revision+case when v_changed then 1 else 0 end,updated_at=v_now;
    update public.billing_trials set converted_to_paid_at=coalesce(converted_to_paid_at,v_now) where subject_user_id=b.subject_user_id;
    if v_changed then v_revision:=private.billing_write_access_v1(b.subject_user_id,p.revision,'stripe_paid'); else v_revision:=p.revision; end if;
    if not v_replayed then
      insert into public.stripe_billing_invoice_effects(subscription_id,stripe_account,stripe_invoice_id,offering_version_id,account_plan_revision,period_start,period_end,event_inbox_id)
        values(b.id,b.stripe_account,p_request->>'invoice_id',b.offering_version_id,v_revision,v_period_start,v_period_end,v_event);
    end if;
    update public.stripe_billing_subscription_bindings set last_period_start=v_period_start,last_period_end=v_period_end where id=b.id;
  elsif v_outcome in ('renewal_failed','canceled') then
    if a.source is distinct from 'paid' or a.subscription_id is distinct from b.id or a.paid_through is null then
      return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
    if v_outcome='renewal_failed' then
      if p_request->>'invoice_id' is null or (p_request->>'period_start')::timestamptz is distinct from a.paid_through
        or coalesce(p_request->>'provider_status','') not in ('active','past_due','unpaid','canceled')
        or (p_request->>'period_end')::timestamptz is null or (p_request->>'period_end')::timestamptz<=a.paid_through
        or (a.end_reason='renewal_grace' and a.failed_renewal_invoice_id is distinct from (p_request->>'invoice_id')) then
        return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
      v_end:=a.paid_through+interval '168 hours'; v_reason:='renewal_grace';
    else
      -- Provider cancellation after exhausted retries does not revoke the promised
      -- complimentary grace. Preserve its exact cutoff even after local expiry.
      v_end:=case when a.end_reason='renewal_grace' then a.access_ends_at else a.paid_through end;
      v_reason:=case when a.end_reason='renewal_grace' then 'renewal_grace' else 'cancellation' end;
    end if;
    v_changed:=a.access_ends_at<>v_end or a.end_reason<>v_reason;
    update public.billing_account_access set access_ends_at=v_end,end_reason=v_reason,
      failed_renewal_invoice_id=case when v_outcome='renewal_failed' then p_request->>'invoice_id' else failed_renewal_invoice_id end,
      last_provider_verified_at=v_now,revision=revision+case when v_changed then 1 else 0 end,updated_at=v_now where subject_user_id=b.subject_user_id;
    if v_changed then perform private.billing_write_access_v1(b.subject_user_id,p.revision,
      case when v_outcome='renewal_failed' then 'renewal_failed' else 'subscription_canceled' end); end if;
  end if;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id;
  -- Terminal + cleared observations are required together. Open invoices keep the
  -- binding current even after effective access ends; never create a second payer.
  update public.stripe_billing_subscription_bindings set
    terminal_confirmed_at=case when coalesce(p_request->>'provider_status','')='canceled' then v_now else terminal_confirmed_at end,
    obligations_cleared_at=case when coalesce(p_request->>'provider_status','')='canceled' and coalesce((p_request->>'obligations_cleared')::boolean,false) then v_now else obligations_cleared_at end,
    is_current=not (coalesce(p_request->>'provider_status','')='canceled' and coalesce((p_request->>'obligations_cleared')::boolean,false) and a.access_ends_at<=v_now),
    last_provider_status=coalesce(p_request->>'provider_status',last_provider_status),
    lease_token=null,lease_expires_at=null,reconcile_state='queued',reconcile_attempt_count=0,reconcile_attention_at=null,last_exception_code=null,
    next_reconcile_at=least(v_now+interval '1 day',greatest(a.access_ends_at,v_now+interval '1 minute')),
    revision=revision+1,updated_at=v_now where id=b.id;
  if v_event is not null then update public.stripe_billing_event_inbox set status='completed',completed_at=v_now,next_attempt_at=null,exception_code=null where id=v_event; end if;
  if v_changed then
    insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,previous_state,next_state)
      values(b.subject_user_id,b.id,gen_random_uuid(),v_outcome,v_previous,to_jsonb(a));
  end if;
  return jsonb_build_object('status',case when v_replayed and not v_changed then 'replayed' else 'applied' end,'retry_scheduled',false);
end; $$;

-- Only known automated trial expiry can advance a checkout's saved revision.
-- Any manual revision remains a conflict, including changes that restore the same label.
create function private.billing_checkout_revision_matches_v1(p_subject uuid,p_reserved bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select p_reserved is not null and (p.revision=p_reserved or (
    p.revision=p_reserved+1 and p.management_source='trial' and p.plan_key='free'
    and exists(select 1 from public.account_plan_audit audit where audit.subject_user_id=p_subject and audit.plan_revision=p.revision
      and audit.reason_code='subscription_expired' and audit.actor_ref='stripe:billing')
    and exists(select 1 from public.billing_account_access a where a.subject_user_id=p_subject and a.source='trial'
      and a.account_plan_revision=p.revision and a.expiry_applied_at is not null)))
  from public.account_plans p where p.subject_user_id=p_subject;
$$;
create function private.billing_checkout_plan_eligible_v1(p_subject uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (p.plan_key='free' and p.management_source='legacy')
    or (p.management_source='trial' and p.plan_key in ('free','plus') and exists(
      select 1 from public.billing_account_access a join public.billing_trials t on t.subject_user_id=a.subject_user_id
      where a.subject_user_id=p_subject and a.source='trial' and a.account_plan_revision=p.revision and t.converted_to_paid_at is null))
    or (p.plan_key='free' and p.management_source='billing' and exists(
      select 1 from public.billing_account_access a where a.subject_user_id=p_subject and a.account_plan_revision=p.revision
        and a.expiry_applied_at is not null)
      and not exists(select 1 from public.stripe_billing_subscription_bindings b where b.subject_user_id=p_subject
        and not (b.is_current and not exists(select 1 from public.stripe_billing_invoice_effects e where e.subscription_id=b.id))
        and (b.terminal_confirmed_at is null or b.obligations_cleared_at is null)))
  from public.account_plans p where p.subject_user_id=p_subject;
$$;

-- Claim facts are private and reference only already verified invoice effects.
create function private.billing_claim_access_facts_v1(p_subscription uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('paid_through',case when a.subscription_id=b.id then a.paid_through else null end,
    'paid_period_start',case when a.subscription_id=b.id then a.paid_period_start else null end,
    'last_paid_invoice_id',case when a.subscription_id=b.id then a.last_paid_invoice_id else null end,
    'access_ends_at',a.access_ends_at,'end_reason',a.end_reason,'assignment_revision',a.account_plan_revision,'is_current',b.is_current)
  from public.stripe_billing_subscription_bindings b left join public.billing_account_access a on a.subject_user_id=b.subject_user_id where b.id=p_subscription;
$$;

create or replace function public.billing_reserve_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_id uuid; v_version uuid;
  v_offering jsonb; v_fingerprint text; v_customer public.stripe_billing_customers%rowtype; v_plan public.account_plans%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  v_user := (p_request->>'subject_user_id')::uuid; v_id := (p_request->>'attempt_id')::uuid;
  v_version := (p_request->'offering'->>'offering_version_id')::uuid;
  if v_user is null or v_id is null or v_version is null
    or coalesce(length(p_request->>'lookup_key'),0) not between 1 and 200
    or coalesce(p_request->>'success_url','') !~ '^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?/billing[?]checkout='
    or coalesce(p_request->>'cancel_url','') !~ '^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?/billing[?]checkout='
    or not exists(select 1 from public.users where id=v_user and role='teacher') then
    raise exception using errcode='22023',message='checkout_request_invalid';
  end if;
  -- One account lock orders reservations; finalization takes this before the
  -- migration-209 subscription identity lock, and never reverses that order.
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  v_fingerprint := md5(jsonb_build_object('subject_user_id',v_user,'offering',p_request->'offering',
    'lookup_key',p_request->>'lookup_key','success_url',p_request->>'success_url','cancel_url',p_request->>'cancel_url')::text);
  select * into v_attempt from public.stripe_checkout_attempts where id=v_id for update;
  if found then
    if v_attempt.subject_user_id<>v_user or v_attempt.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='checkout_operation_conflict';
    end if;
    if v_attempt.status not in ('bound','expired','attention') then
      perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
      select * into v_plan from public.account_plans where subject_user_id=v_user for update;
      if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false)
        or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_user,v_attempt.reserved_plan_revision),false)
        or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current) then
        update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
          lease_token=null,lease_expires_at=null where id=v_id;
        insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
          values(v_id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
      end if;
    end if;
    return private.stripe_checkout_attempt_v1(v_id);
  end if;
  if exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current)
    or exists(select 1 from public.stripe_checkout_attempts where subject_user_id=v_user and status not in ('expired','bound')) then
    raise exception using errcode='23505',message='checkout_account_already_bound_or_pending';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_user for update;
  if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false) then
    raise exception using errcode='55000',message='checkout_account_plan_ineligible';
  end if;
  v_offering := public.billing_get_checkout_offering_v1(jsonb_build_object(
    'offering_version_id',v_version,'stripe_account',p_request->'offering'->>'stripe_account'));
  if v_offering is null or v_offering is distinct from p_request->'offering' then
    raise exception using errcode='55000',message='checkout_offering_unavailable_or_changed';
  end if;
  select * into v_customer from public.stripe_billing_customers where subject_user_id=v_user;
  if found and v_customer.stripe_account<>v_offering->>'stripe_account' then
    raise exception using errcode='23505',message='checkout_customer_account_conflict';
  end if;
  insert into public.stripe_checkout_attempts(id,subject_user_id,offering_version_id,lookup_key,
    request_fingerprint,success_url,cancel_url,stripe_customer_id,reserved_plan_revision)
  values(v_id,v_user,v_version,p_request->>'lookup_key',v_fingerprint,p_request->>'success_url',
    p_request->>'cancel_url',v_customer.stripe_customer_id,v_plan.revision);
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_id,'reserved',0);
  return private.stripe_checkout_attempt_v1(v_id);
end; $$;

create or replace function public.billing_claim_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_seconds integer := (p_request->>'lease_seconds')::integer;
  v_plan public.account_plans%rowtype; v_user uuid;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_seconds is null or v_seconds not between 30 and 300 then
    raise exception using errcode='22023',message='checkout_lease_invalid';
  end if;
  select subject_user_id into v_user from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid;
  if v_user is null then return jsonb_build_object('status','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if v_attempt.status in ('bound','expired','attention') then return jsonb_build_object('status','terminal'); end if;
  if v_attempt.lease_expires_at>clock_timestamp() or v_attempt.next_attempt_at>clock_timestamp() then
    return jsonb_build_object('status','busy');
  end if;
  -- No provider work is issued on a resumed checkout whose initial Free plan changed.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_user for update;
  if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false)
    or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_user,v_attempt.reserved_plan_revision),false)
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current) then
    update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
      lease_token=null,lease_expires_at=null where id=v_attempt.id;
    insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
      values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
    return jsonb_build_object('status','terminal');
  end if;
  update public.stripe_checkout_attempts set lease_token=gen_random_uuid(),
    fencing_token=fencing_token+1,lease_expires_at=clock_timestamp()+make_interval(secs=>v_seconds)
    where id=v_attempt.id returning * into v_attempt;
  return jsonb_build_object('status','claimed','attempt',private.stripe_checkout_attempt_v1(v_attempt.id),
    'lease_token',v_attempt.lease_token,'fencing_token',v_attempt.fencing_token,'lease_expires_at',v_attempt.lease_expires_at);
end; $$;

create or replace function public.billing_finish_checkout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_user uuid; v_version public.stripe_billing_offering_versions%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype; v_outcome text := p_request->>'outcome';
  v_plan public.account_plans%rowtype; v_reason text := p_request->>'reason_code'; v_status text; v_retry integer;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_outcome is null or v_outcome not in ('pending','bound','expired','retry','attention')
    or (v_reason is not null and v_reason not in ('provider_unavailable','provider_contract_invalid','write_recovery_expired')) then
    raise exception using errcode='22023',message='checkout_outcome_invalid';
  end if;
  select subject_user_id into v_user from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid;
  if v_user is null then return jsonb_build_object('status','lost_claim'); end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-checkout-account:'||v_user::text,21120260926));
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid for update;
  if v_attempt.lease_token is null or v_attempt.lease_expires_at is null
    or p_request->>'lease_token' is null or coalesce((p_request->>'fencing_token')::bigint,0)<1
    or v_attempt.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_attempt.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or v_attempt.lease_expires_at<=clock_timestamp() or v_attempt.status in ('bound','expired','attention') then
    return jsonb_build_object('status','lost_claim');
  end if;
  if v_outcome in ('bound','expired','pending') and v_attempt.stripe_session_id is null then
    raise exception using errcode='22023',message='checkout_session_required';
  end if;
  if v_outcome='bound' then
    if coalesce(p_request->>'subscription_id','') !~ '^sub_[A-Za-z0-9]+$' then
      raise exception using errcode='22023',message='checkout_subscription_invalid';
    end if;
    select * into v_version from public.stripe_billing_offering_versions where id=v_attempt.offering_version_id;
    -- The exact reservation is the availability proof. Do not call the general
    -- bind RPC: a retired catalog must still honor this already-created attempt.
    perform pg_advisory_xact_lock(hashtextextended(
      'stripe-binding:'||v_version.stripe_account||':test:'||(p_request->>'subscription_id'),20920260926));
    select * into v_binding from public.stripe_billing_subscription_bindings
      where stripe_account=v_version.stripe_account and provider_mode='test'
        and stripe_subscription_id=p_request->>'subscription_id' for update;
    -- Keep the billing lock order: subscription identity/binding, then account plan.
    perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_user::text,20620260924));
    select * into v_plan from public.account_plans where subject_user_id=v_user for update;
    if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_user),false)
      or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_user,v_attempt.reserved_plan_revision),false)
      or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_user and is_current) then
      update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
        lease_token=null,lease_expires_at=null where id=v_attempt.id;
      insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
        values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
      return jsonb_build_object('status','finished');
    end if;
    if v_binding.id is not null then
      if v_binding.subject_user_id<>v_user or v_binding.stripe_customer_id<>v_attempt.stripe_customer_id
        or v_binding.offering_version_id<>v_version.id then
        raise exception using errcode='23505',message='checkout_subscription_conflict';
      end if;
    else
      insert into public.stripe_billing_subscription_bindings(subject_user_id,stripe_account,provider_mode,
        stripe_customer_id,stripe_subscription_id,offering_version_id)
      values(v_user,v_version.stripe_account,'test',v_attempt.stripe_customer_id,p_request->>'subscription_id',v_version.id)
      returning * into v_binding;
    end if;
    -- Match migration 209's lock order: binding before inbox; the same identity
    -- advisory lock excludes webhook-before-binding races.
    update public.stripe_billing_event_inbox set subscription_id=v_binding.id,status='received',
      exception_code=null,next_attempt_at=clock_timestamp()
    where stripe_account=v_version.stripe_account and provider_mode='test' and status='exception'
      and stripe_subscription_id=v_binding.stripe_subscription_id
      and (stripe_customer_id is null or stripe_customer_id=v_binding.stripe_customer_id);
  end if;
  v_retry := case when v_outcome='retry' then least(v_attempt.retry_count+1,5) else 0 end;
  v_status := case v_outcome when 'bound' then 'bound' when 'expired' then 'expired'
    when 'attention' then 'attention' when 'pending' then case when coalesce((p_request->>'payment_pending')::boolean,false) then 'payment_pending' else 'open' end
    when 'retry' then case when v_retry>=5 then 'attention' else v_attempt.status end end;
  update public.stripe_checkout_attempts set status=v_status,subscription_id=coalesce(v_binding.id,subscription_id),
    retry_count=v_retry,reason_code=v_reason,lease_token=null,lease_expires_at=null,
    next_attempt_at=clock_timestamp()+case when v_outcome='retry' then make_interval(secs=>(60*power(2,v_retry-1))::integer) else interval '1 minute' end
    where id=v_attempt.id;
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
    values(v_attempt.id,v_status,v_attempt.fencing_token,v_reason);
  return jsonb_build_object('status','finished');
end; $$;

create or replace function public.billing_claim_subscription_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_plan public.account_plans%rowtype;
  v_version public.stripe_billing_offering_versions%rowtype;
  v_offering public.stripe_billing_offerings%rowtype;
  v_seconds integer;
  v_token uuid := gen_random_uuid();
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  v_seconds := (p_request->>'lease_seconds')::integer;
  if p_request is null or jsonb_typeof(p_request) <> 'object'
    or (p_request->>'subscription_id') is null
    or v_seconds is null or v_seconds not between 30 and 300 then
    raise exception using errcode = '22023', message = 'stripe_billing_claim_request_invalid';
  end if;
  select * into v_binding
  from public.stripe_billing_subscription_bindings
  where id = (p_request->>'subscription_id')::uuid
  for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not v_binding.is_current then return jsonb_build_object('status','not_found'); end if;
  if v_binding.reconcile_state = 'attention'
    or (v_binding.reconcile_state = 'retry' and v_binding.next_reconcile_at > clock_timestamp())
    or (v_binding.lease_expires_at is not null and v_binding.lease_expires_at > clock_timestamp()) then
    return jsonb_build_object('status', 'busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:' || v_binding.subject_user_id::text, 20620260924));
  select * into v_plan from public.account_plans where subject_user_id = v_binding.subject_user_id for update;
  if not found then raise exception using errcode = '55000', message = 'stripe_billing_account_plan_unavailable'; end if;
  -- Only the first paid effect of a checkout-backed binding uses this gate.
  -- Never lock the attempt here: checkout finalization locks attempt before binding.
  -- A change after this claim is also rejected by finish's account-plan revision fence.
  if exists(select 1 from public.stripe_checkout_attempts where subscription_id=v_binding.id)
    and not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding.id)
    and (not coalesce(private.billing_checkout_plan_eligible_v1(v_binding.subject_user_id),false)
      or not exists(select 1 from public.stripe_checkout_attempts a where a.subscription_id=v_binding.id
        and a.status='bound' and private.billing_checkout_revision_matches_v1(v_binding.subject_user_id,a.reserved_plan_revision))) then
    update public.stripe_billing_subscription_bindings set reconcile_state='attention',
      reconcile_attention_at=clock_timestamp(),last_exception_code='subscription_transition_unapproved',
      lease_token=null,lease_expires_at=null,next_reconcile_at=null,revision=revision+1,updated_at=clock_timestamp()
      where id=v_binding.id returning * into v_binding;
    insert into public.stripe_billing_subscription_audit(subscription_id,outcome,subscription_revision,
      account_plan_revision,offering_version_id,reason_code)
      values(v_binding.id,'exception',v_binding.revision,v_plan.revision,v_binding.offering_version_id,'subscription_transition_unapproved');
    return jsonb_build_object('status','busy');
  end if;
  select * into v_version from public.stripe_billing_offering_versions where id = v_binding.offering_version_id;
  select * into v_offering from public.stripe_billing_offerings where id = v_version.offering_id;
  update public.stripe_billing_subscription_bindings
  set lease_token = v_token, lease_expires_at = clock_timestamp() + make_interval(secs => v_seconds),
      fencing_token = fencing_token + 1, revision = revision + 1, updated_at = clock_timestamp()
  where id = v_binding.id returning * into v_binding;
  return jsonb_build_object(
    'status', 'claimed', 'subscription_id', v_binding.id, 'lease_token', v_token,
    'fencing_token', v_binding.fencing_token, 'lease_expires_at', v_binding.lease_expires_at,
    'subscription_revision', v_binding.revision, 'expected_account_plan_revision', v_plan.revision,
    'lifecycle', private.billing_claim_access_facts_v1(v_binding.id),
    'binding', jsonb_build_object(
      'subscription_id', v_binding.id, 'subject_user_id', v_binding.subject_user_id,
      'stripe_account', v_binding.stripe_account, 'stripe_customer_id', v_binding.stripe_customer_id,
      'stripe_subscription_id', v_binding.stripe_subscription_id, 'offering_id', v_offering.id,
      'offering_version_id', v_version.id, 'stripe_product_id', v_version.stripe_product_id,
      'stripe_price_id', v_version.stripe_price_id, 'unit_amount', v_version.unit_amount,
      'plan_key', v_offering.plan_key, 'currency', v_version.currency,
      'interval', v_version.interval, 'provider_mode', v_binding.provider_mode
    )
  );
end;
$$;

create or replace function public.billing_save_checkout_progress_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.stripe_checkout_attempts%rowtype; v_account text; v_customer public.stripe_billing_customers%rowtype; v_plan public.account_plans%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  select * into v_attempt from public.stripe_checkout_attempts where id=(p_request->>'attempt_id')::uuid for update;
  if not found or v_attempt.lease_token is null or v_attempt.lease_expires_at is null
    or p_request->>'lease_token' is null or coalesce((p_request->>'fencing_token')::bigint,0)<1
    or v_attempt.lease_token is distinct from (p_request->>'lease_token')::uuid
    or v_attempt.fencing_token is distinct from (p_request->>'fencing_token')::bigint
    or v_attempt.lease_expires_at<=clock_timestamp() or v_attempt.status in ('bound','expired','attention') then
    return jsonb_build_object('status','lost_claim');
  end if;
  if p_request ? 'customer_id' then
    if coalesce(p_request->>'customer_id','') !~ '^cus_[A-Za-z0-9]+$'
      or (v_attempt.stripe_customer_id is not null and v_attempt.stripe_customer_id<>p_request->>'customer_id') then
      raise exception using errcode='23505',message='checkout_customer_conflict';
    end if;
    select stripe_account into v_account from public.stripe_billing_offering_versions where id=v_attempt.offering_version_id;
    insert into public.stripe_billing_customers(subject_user_id,stripe_account,stripe_customer_id)
      values(v_attempt.subject_user_id,v_account,p_request->>'customer_id') on conflict(subject_user_id) do nothing;
    select * into v_customer from public.stripe_billing_customers where subject_user_id=v_attempt.subject_user_id;
    if v_customer.stripe_account<>v_account or v_customer.stripe_customer_id<>p_request->>'customer_id' then
      raise exception using errcode='23505',message='checkout_customer_conflict';
    end if;
    update public.stripe_checkout_attempts set stripe_customer_id=p_request->>'customer_id' where id=v_attempt.id;
  end if;
  if p_request ? 'session_id' then
    if coalesce(p_request->>'session_id','') !~ '^cs_test_[A-Za-z0-9]+$'
      or (v_attempt.stripe_session_id is not null and v_attempt.stripe_session_id<>p_request->>'session_id')
      or (p_request->>'checkout_url' is not null and p_request->>'checkout_url' !~ '^https://checkout[.]stripe[.]com/') then
      raise exception using errcode='23505',message='checkout_session_conflict';
    end if;
    update public.stripe_checkout_attempts set stripe_session_id=p_request->>'session_id',
      checkout_url=p_request->>'checkout_url',status='open' where id=v_attempt.id;
  end if;
  -- Retain any verified provider IDs for recovery, but stop further provider work
  -- if the account changed while the preceding network request was in flight.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_attempt.subject_user_id::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_attempt.subject_user_id for update;
  if not found or not coalesce(private.billing_checkout_plan_eligible_v1(v_attempt.subject_user_id),false)
    or v_attempt.reserved_plan_revision is null or not coalesce(private.billing_checkout_revision_matches_v1(v_attempt.subject_user_id,v_attempt.reserved_plan_revision),false)
    or exists(select 1 from public.stripe_billing_subscription_bindings where subject_user_id=v_attempt.subject_user_id and is_current) then
    update public.stripe_checkout_attempts set status='attention',reason_code='checkout_account_plan_ineligible',
      lease_token=null,lease_expires_at=null where id=v_attempt.id;
    insert into public.stripe_checkout_audit(attempt_id,action,fencing_token,reason_code)
      values(v_attempt.id,'attention',v_attempt.fencing_token,'checkout_account_plan_ineligible');
    return jsonb_build_object('status','lost_claim');
  end if;
  insert into public.stripe_checkout_audit(attempt_id,action,fencing_token) values(v_attempt.id,'progress',v_attempt.fencing_token);
  return jsonb_build_object('status','saved');
end; $$;

alter function public.billing_finish_subscription_v1(jsonb) set schema private;
alter function private.billing_finish_subscription_v1(jsonb) rename to billing_finish_subscription_foundation_v1;
create function public.billing_finish_subscription_v1(p_request jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select public.billing_finish_lifecycle_v1(p_request);
$$;

create or replace function public.set_account_plan_v1(
  p_operation_id uuid, p_subject_user_id uuid, p_plan_key text, p_actor_ref text,
  p_reason_code text, p_expected_revision bigint default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.account_plans%rowtype; v_audit public.account_plan_audit%rowtype;
  v_entitlement_revision bigint; v_entitlement jsonb; v_plan_revision bigint;
  v_limit integer; v_fingerprint text;
begin
  if p_operation_id is null or p_subject_user_id is null or p_plan_key is null or p_plan_key not in ('free','basic','plus','pro')
    or p_actor_ref is null or p_actor_ref !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9._-]{0,99}$'
    or (p_expected_revision is not null and p_expected_revision < 0) then
    raise exception using errcode = '22023', message = 'account_plan_request_invalid';
  end if;
  if not exists (select 1 from public.users where id = p_subject_user_id) then
    raise exception using errcode = 'P0002', message = 'account_plan_subject_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-operation:' || p_operation_id::text, 20620260923));
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:' || p_subject_user_id::text, 20620260924));
  v_fingerprint := md5(jsonb_build_object('subject_user_id',p_subject_user_id,'plan_key',p_plan_key,'actor_ref',p_actor_ref,'reason_code',p_reason_code,'expected_revision',p_expected_revision)::text);
  select * into v_audit from public.account_plan_audit where operation_id = p_operation_id;
  if v_audit.id is not null then
    if v_audit.request_fingerprint <> v_fingerprint then raise exception using errcode = '23505', message = 'account_plan_operation_conflict'; end if;
    return jsonb_build_object('subject_user_id',v_audit.subject_user_id,'plan_key',v_audit.new_plan_key,'revision',v_audit.plan_revision,'classroom_limit',v_audit.new_classroom_limit,'entitlement_revision',v_audit.entitlement_revision,'duplicate',true);
  end if;
  select * into v_existing from public.account_plans where subject_user_id = p_subject_user_id for update;
  if v_existing.management_source in ('billing','trial') then raise exception using errcode = '42501', message = 'billing_managed_account_plan'; end if;
  if coalesce(v_existing.revision,0) <> coalesce(p_expected_revision,0) then raise exception using errcode = '40001', message = 'account_plan_revision_conflict'; end if;
  v_limit := case p_plan_key when 'free' then 0 when 'basic' then 2 when 'plus' then 5 when 'pro' then 10 end;
  v_plan_revision := coalesce(v_existing.revision,0) + 1;
  select revision into v_entitlement_revision from public.effective_feature_entitlements where subject_user_id=p_subject_user_id and feature_key='classrooms.create';
  v_entitlement := public.set_effective_feature_entitlement_v1(p_operation_id,p_subject_user_id,'classrooms.create','plan',v_limit>0,clock_timestamp(),null,v_limit,p_actor_ref,p_reason_code,coalesce(v_entitlement_revision,0));
  insert into public.account_plans (subject_user_id,plan_key,revision,management_source,billing_offering_version_id)
  values (p_subject_user_id,p_plan_key,v_plan_revision,'legacy',null)
  on conflict (subject_user_id) do update set plan_key=excluded.plan_key,revision=excluded.revision,management_source='legacy',billing_offering_version_id=null,updated_at=clock_timestamp();
  insert into public.account_plan_audit (operation_id,subject_user_id,previous_plan_key,new_plan_key,new_classroom_limit,plan_revision,entitlement_revision,actor_ref,reason_code,request_fingerprint)
  values (p_operation_id,p_subject_user_id,v_existing.plan_key,p_plan_key,v_limit,v_plan_revision,(v_entitlement->>'revision')::bigint,p_actor_ref,p_reason_code,v_fingerprint);
  return jsonb_build_object('subject_user_id',p_subject_user_id,'plan_key',p_plan_key,'revision',v_plan_revision,'classroom_limit',v_limit,'entitlement_revision',(v_entitlement->>'revision')::bigint,'duplicate',false);
end; $$;

create or replace function public.billing_list_work_v1(p_request jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select greatest(1, least(50, coalesce((p_request->>'limit')::integer, 0))) as limit_value
  ), candidates as (
    select 'event'::text as kind, event.id as event_inbox_id,
      event.subscription_id, event.next_attempt_at as due_at
    from public.stripe_billing_event_inbox event
    join public.stripe_billing_subscription_bindings binding on binding.id = event.subscription_id
    where binding.is_current and event.status in ('received', 'exception')
      and event.attempt_count < 5
      and event.next_attempt_at <= clock_timestamp()
      and (binding.lease_expires_at is null or binding.lease_expires_at <= clock_timestamp())
      and binding.reconcile_state in ('queued', 'retry')
      and (binding.reconcile_state = 'queued' or binding.next_reconcile_at <= clock_timestamp())
    union all
    select 'reconcile'::text, null::uuid, binding.id, binding.next_reconcile_at
    from public.stripe_billing_subscription_bindings binding
    where binding.is_current and binding.reconcile_state in ('queued', 'retry')
      and binding.reconcile_attempt_count < 5
      and binding.next_reconcile_at <= clock_timestamp()
      and (binding.lease_expires_at is null or binding.lease_expires_at <= clock_timestamp())
  ), one_per_subscription as (
    select candidates.*, row_number() over (
      partition by subscription_id
      order by due_at, case kind when 'event' then 0 else 1 end, event_inbox_id nulls last
    ) as item_rank
    from candidates
  ), picked as (
    select * from one_per_subscription
    where item_rank = 1
    order by due_at, subscription_id
    limit (select limit_value from params)
  )
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
    'kind', picked.kind,
    'event_inbox_id', picked.event_inbox_id,
    'subscription_id', binding.id,
    'binding', jsonb_build_object(
      'subscription_id', binding.id,
      'subject_user_id', binding.subject_user_id,
      'stripe_account', binding.stripe_account,
      'stripe_customer_id', binding.stripe_customer_id,
      'stripe_subscription_id', binding.stripe_subscription_id,
      'offering_id', offering.id,
      'offering_version_id', version.id,
      'stripe_product_id', version.stripe_product_id,
      'stripe_price_id', version.stripe_price_id,
      'unit_amount', version.unit_amount,
      'plan_key', offering.plan_key,
      'currency', version.currency,
      'interval', version.interval,
      'provider_mode', binding.provider_mode
    ),
    'next_attempt_at', picked.due_at
  ) order by picked.due_at, picked.subscription_id), '[]'::jsonb))
  from picked
  join public.stripe_billing_subscription_bindings binding on binding.id = picked.subscription_id
  join public.stripe_billing_offering_versions version on version.id = binding.offering_version_id
  join public.stripe_billing_offerings offering on offering.id = version.offering_id;
$$;

-- Project existing verified purchased assignments, never legacy/manual rows or
-- rows whose entitlement was changed independently. No catalog availability lookup.
do $$ declare r record; begin
  for r in select b.*,e.period_start,e.period_end,e.stripe_invoice_id,p.revision as plan_revision,ent.revision as entitlement_revision
    from public.stripe_billing_subscription_bindings b
    join public.account_plans p on p.subject_user_id=b.subject_user_id and p.management_source='billing' and p.billing_offering_version_id=b.offering_version_id
    join public.stripe_billing_invoice_effects e on e.subscription_id=b.id and e.account_plan_revision=p.revision
    join public.stripe_billing_offering_versions v on v.id=b.offering_version_id
    join public.effective_feature_entitlements ent on ent.subject_user_id=b.subject_user_id and ent.feature_key='classrooms.create'
      and ent.source='plan' and ent.enabled=(v.classroom_limit>0) and ent.quota_limit=v.classroom_limit
    where b.is_current loop
    insert into public.billing_account_access(subject_user_id,source,subscription_id,offering_version_id,starts_at,paid_period_start,
      paid_through,last_paid_invoice_id,access_ends_at,end_reason,account_plan_revision,entitlement_revision)
      values(r.subject_user_id,'paid',r.id,r.offering_version_id,r.period_start,r.period_start,r.period_end,r.stripe_invoice_id,
        r.period_end,'renewal_pending',r.plan_revision,r.entitlement_revision);
    perform private.billing_write_access_v1(r.subject_user_id,r.plan_revision,'billing_lifecycle_backfill');
  end loop;
end $$;

alter table public.billing_trial_definitions enable row level security;
alter table public.billing_trials enable row level security;
alter table public.billing_account_access enable row level security;
alter table public.billing_lifecycle_audit enable row level security;
revoke all on table public.billing_trial_definitions,public.billing_trials,public.billing_account_access,public.billing_lifecycle_audit
  from public,anon,authenticated,service_role;
grant select on table public.billing_trial_definitions,public.billing_trials,public.billing_account_access,public.billing_lifecycle_audit to service_role;
revoke all on function private.billing_write_access_v1(uuid,bigint,text),private.billing_claim_access_facts_v1(uuid),
  private.billing_checkout_plan_eligible_v1(uuid),private.billing_checkout_revision_matches_v1(uuid,bigint),
  private.billing_finish_subscription_foundation_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.billing_start_trial_v1(jsonb),public.billing_get_access_status_v1(jsonb),
  public.billing_apply_due_access_v1(jsonb),public.billing_finish_lifecycle_v1(jsonb),public.billing_finish_subscription_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.billing_start_trial_v1(jsonb),public.billing_get_access_status_v1(jsonb),
  public.billing_apply_due_access_v1(jsonb),public.billing_finish_lifecycle_v1(jsonb),public.billing_finish_subscription_v1(jsonb) to service_role;

-- A paid checkout reflects current verified access, not the first invoice revision.
create or replace function private.stripe_checkout_attempt_v1(p_attempt uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('attempt_id',a.id,'subject_user_id',a.subject_user_id,
    'offering',private.stripe_checkout_offering_v1(a.offering_version_id),'lookup_key',a.lookup_key,
    'status',a.status,'customer_id',a.stripe_customer_id,'session_id',a.stripe_session_id,
    'checkout_url',a.checkout_url,'success_url',a.success_url,'cancel_url',a.cancel_url,
    'write_deadline',a.write_deadline,'created_at',a.created_at,
    'access_confirmed',a.status='bound' and exists(
      select 1 from public.billing_account_access access
      join public.account_plans p on p.subject_user_id=access.subject_user_id
      join public.stripe_billing_subscription_bindings b on b.id=access.subscription_id
      join public.effective_feature_entitlements ent on ent.subject_user_id=p.subject_user_id and ent.feature_key='classrooms.create'
      where access.subject_user_id=a.subject_user_id and access.source='paid'
        and access.subscription_id=a.subscription_id and b.is_current
        and access.offering_version_id=a.offering_version_id and p.billing_offering_version_id=a.offering_version_id
        and p.management_source='billing' and p.revision=access.account_plan_revision
        and ent.revision=access.entitlement_revision and ent.enabled
        and access.starts_at<=clock_timestamp() and access.access_ends_at>clock_timestamp()
        and (ent.starts_at is null or ent.starts_at<=clock_timestamp())
        and (ent.expires_at is null or ent.expires_at>clock_timestamp())))
  from public.stripe_checkout_attempts a where a.id=p_attempt;
$$;
