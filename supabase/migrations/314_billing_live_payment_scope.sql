-- Live receipt intake foundation. No live checkout, binding or entitlement writes.
begin;

alter table private.stripe_billing_settings
  add column live_payment_lifecycle_enabled boolean not null default false,
  add column live_checkout_admission_enabled boolean not null default false,
  add column live_checkout_writes_enabled boolean not null default false,
  add constraint stripe_billing_live_payment_controls check (
    (not live_checkout_admission_enabled or live_payment_lifecycle_enabled)
    and (not live_checkout_writes_enabled or live_payment_lifecycle_enabled)
    and (not live_payment_lifecycle_enabled or (
      live_project_ref is not null and live_stripe_account is not null
      and not sandbox_enabled and classroom_new_work_cutoff_enabled
    ))
  );

-- Durable proof of an attested paid target. This is written only by the
-- security-definer settings guard and survives disabling the lifecycle.
create table private.billing_live_payment_target (
  singleton boolean primary key default true check (singleton),
  project_ref text not null check (project_ref ~ '^[a-z0-9]{20}$'),
  stripe_account text not null check (stripe_account ~ '^acct_[A-Za-z0-9]{1,255}$')
);
alter table private.billing_live_payment_target enable row level security;
revoke all on private.billing_live_payment_target from public,anon,authenticated,service_role;

-- A 313 source is evidence only when every source is bound to this target and
-- its corresponding durable trial. It was inserted under the 313 share lock.
create function private.billing_live_target_proven_v1(p_project_ref text,p_stripe_account text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.billing_attest_live_target_v1(p_project_ref,p_stripe_account),false)
    or exists (select 1 from private.billing_live_payment_target target
      where target.singleton and target.project_ref=p_project_ref and target.stripe_account=p_stripe_account)
    or (
      exists (select 1 from private.billing_live_trial_sources source
        join public.billing_trials trial on trial.subject_user_id=source.subject_user_id
          and trial.operation_id=source.operation_id
        where source.project_ref=p_project_ref and source.stripe_account=p_stripe_account
          and trial.definition_id='pro-trial-v1')
      and not exists (select 1 from private.billing_live_trial_sources source
        left join public.billing_trials trial on trial.subject_user_id=source.subject_user_id
          and trial.operation_id=source.operation_id and trial.definition_id='pro-trial-v1'
        where source.project_ref is distinct from p_project_ref
          or source.stripe_account is distinct from p_stripe_account or trial.subject_user_id is null)
    );
$$;

create function private.guard_billing_live_payment_controls_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (old.live_project_ref is not null or new.live_project_ref is not null)
    and current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_payment_requires_read_committed';
  end if;
  if exists(select 1 from private.billing_live_payment_target) then
    if new.live_project_ref is distinct from old.live_project_ref
      or new.live_stripe_account is distinct from old.live_stripe_account
      or not new.classroom_new_work_cutoff_enabled
      or not exists(select 1 from private.billing_live_payment_target target
        where target.singleton and target.project_ref=new.live_project_ref
          and target.stripe_account=new.live_stripe_account) then
      raise exception using errcode='55000',message='billing_live_payment_target_in_use';
    end if;
  elsif new.live_payment_lifecycle_enabled then
    if new.live_project_ref is distinct from old.live_project_ref
      or new.live_stripe_account is distinct from old.live_stripe_account
      or not private.billing_live_target_proven_v1(new.live_project_ref,new.live_stripe_account) then
      raise exception using errcode='55000',message='billing_live_payment_target_not_attested';
    end if;
    insert into private.billing_live_payment_target(singleton,project_ref,stripe_account)
      values(true,new.live_project_ref,new.live_stripe_account);
  end if;
  return new;
end;
$$;
create trigger billing_live_payment_controls
  before update of live_project_ref,live_stripe_account,classroom_new_work_cutoff_enabled,
    live_payment_lifecycle_enabled,live_checkout_admission_enabled,live_checkout_writes_enabled
  on private.stripe_billing_settings for each row execute function private.guard_billing_live_payment_controls_v1();

-- Preserve the 313 freeze and allow its first enable on the same paid target.
create or replace function private.guard_billing_live_trial_controls_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (old.live_project_ref is not null or new.live_project_ref is not null)
    and current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_trial_requires_read_committed';
  end if;
  if exists(select 1 from private.billing_live_trial_sources) then
    if new.live_project_ref is distinct from old.live_project_ref
      or new.live_stripe_account is distinct from old.live_stripe_account
      or not new.classroom_new_work_cutoff_enabled
      or not private.billing_live_target_proven_v1(new.live_project_ref,new.live_stripe_account) then
      raise exception using errcode='55000',message='billing_live_trial_target_in_use';
    end if;
  elsif new.live_trial_lifecycle_enabled and (
    new.live_project_ref is distinct from old.live_project_ref
    or new.live_stripe_account is distinct from old.live_stripe_account
    or (not old.live_trial_lifecycle_enabled and not private.billing_live_target_proven_v1(
      new.live_project_ref,new.live_stripe_account))
  ) then
    raise exception using errcode='55000',message='billing_live_trial_target_not_attested';
  end if;
  return new;
end;
$$;

create function public.billing_live_payment_lifecycle_ready_v1(p_project_ref text,p_stripe_account text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.stripe_billing_settings settings
    join private.billing_live_payment_target target on target.singleton
      and target.project_ref=settings.live_project_ref and target.stripe_account=settings.live_stripe_account
    where settings.singleton and settings.live_payment_lifecycle_enabled
      and not settings.sandbox_enabled and settings.classroom_new_work_cutoff_enabled
      and settings.live_project_ref=p_project_ref and settings.live_stripe_account=p_stripe_account);
$$;

create function private.lock_billing_live_payment_settings_v1(p_project_ref text,p_stripe_account text)
returns private.stripe_billing_settings language plpgsql set search_path='' as $$
declare v_settings private.stripe_billing_settings%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='billing_live_payment_requires_read_committed';
  end if;
  select settings.* into v_settings from private.stripe_billing_settings settings
    join private.billing_live_payment_target target on target.singleton
      and target.project_ref=settings.live_project_ref and target.stripe_account=settings.live_stripe_account
    where settings.singleton and settings.live_payment_lifecycle_enabled
      and not settings.sandbox_enabled and settings.classroom_new_work_cutoff_enabled
      and settings.live_project_ref=p_project_ref and settings.live_stripe_account=p_stripe_account
    for share of settings;
  if not found then
    raise exception using errcode='55000',message='billing_live_payment_lifecycle_unavailable';
  end if;
  return v_settings;
end;
$$;

alter table public.stripe_billing_event_inbox
  drop constraint stripe_billing_event_inbox_provider_mode_check,
  add constraint stripe_billing_event_inbox_provider_mode_check check (provider_mode in ('test','live'));

create function public.billing_record_live_event_v1(p_project_ref text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_event public.stripe_billing_event_inbox%rowtype;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_payload jsonb;
  v_account text;
  v_subscription text;
  v_customer text;
  v_object text;
  v_type text;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='billing_live_event_request_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) as k(name) where k.name not in (
      'stripe_account','provider_mode','event_id','payload_hash','event_type','event_created_at','received_at','payload'))
    or p_request->>'provider_mode' is distinct from 'live'
    or coalesce(p_request->>'stripe_account','') !~ '^acct_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'event_id','') !~ '^evt_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'payload_hash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request->>'event_type','') !~ '^[A-Za-z0-9._-]{1,100}$'
    or jsonb_typeof(p_request->'event_created_at') is distinct from 'string'
    or jsonb_typeof(p_request->'received_at') is distinct from 'string'
    or jsonb_typeof(p_request->'payload') is distinct from 'object' then
    raise exception using errcode='22023',message='billing_live_event_request_invalid';
  end if;
  v_payload:=p_request->'payload'; v_account:=p_request->>'stripe_account';
  v_subscription:=v_payload->>'subscription_id'; v_customer:=v_payload->>'customer_id';
  v_object:=v_payload->>'object_id'; v_type:=p_request->>'event_type';
  if exists(select 1 from jsonb_object_keys(v_payload) as k(name) where k.name not in ('object_id','customer_id','subscription_id'))
    or not (v_payload ?& array['object_id','customer_id','subscription_id'])
    or jsonb_typeof(v_payload->'object_id') is distinct from 'string'
    or coalesce(v_object,'') !~ '^[A-Za-z0-9_]{1,255}$'
    or (jsonb_typeof(v_payload->'customer_id') not in ('null','string'))
    or (jsonb_typeof(v_payload->'subscription_id') not in ('null','string'))
    or (v_customer is not null and v_customer !~ '^cus_[A-Za-z0-9]{1,255}$')
    or (v_subscription is not null and v_subscription !~ '^sub_[A-Za-z0-9]{1,255}$')
    or (v_type like 'customer.subscription.%' and (v_subscription is null or v_subscription<>v_object))
    or (v_type like 'invoice.%' and v_object !~ '^in_[A-Za-z0-9]{1,255}$') then
    raise exception using errcode='22023',message='billing_live_event_request_invalid';
  end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,v_account);
  if v_subscription is not null then
    perform pg_advisory_xact_lock(hashtextextended('stripe-binding:'||v_account||':live:'||v_subscription,20920260926));
  end if;
  select * into v_binding from public.stripe_billing_subscription_bindings
    where stripe_account=v_account and provider_mode='live' and stripe_subscription_id=v_subscription
      and v_customer is not null and stripe_customer_id=v_customer for update;
  insert into public.stripe_billing_event_inbox(stripe_account,provider_mode,stripe_event_id,payload_hash,event_type,
    event_created_at,received_at,subscription_id,stripe_customer_id,stripe_subscription_id,stripe_invoice_id,
    status,exception_code,next_attempt_at)
  values(v_account,'live',p_request->>'event_id',p_request->>'payload_hash',v_type,
    (p_request->>'event_created_at')::timestamptz,(p_request->>'received_at')::timestamptz,
    v_binding.id,v_customer,v_subscription,case when v_type like 'invoice.%' then v_object else null end,
    case when v_binding.id is null then 'exception' else 'received' end,
    case when v_binding.id is null then 'unbound_event' end,
    case when v_binding.id is null then null else clock_timestamp() end)
  on conflict (stripe_account,provider_mode,stripe_event_id) do nothing returning * into v_event;
  if v_event.id is null then
    select * into strict v_event from public.stripe_billing_event_inbox
      where stripe_account=v_account and provider_mode='live' and stripe_event_id=p_request->>'event_id';
    if v_event.payload_hash<>p_request->>'payload_hash' then
      raise exception using errcode='23505',message='stripe_billing_event_conflict';
    end if;
    return jsonb_build_object('status','duplicate','event_inbox_id',v_event.id);
  end if;
  if v_binding.id is not null then
    update public.stripe_billing_event_inbox set status='attention',attention_at=clock_timestamp(),
      exception_code='superseded_by_verified_event',next_attempt_at=null
      where subscription_id=v_binding.id and status='exception' and id<>v_event.id;
    update public.stripe_billing_subscription_bindings set reconcile_state='queued',reconcile_attempt_count=0,
      reconcile_attention_at=null,next_reconcile_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      where id=v_binding.id;
  end if;
  return jsonb_build_object('status','accepted','event_inbox_id',v_event.id);
end;
$$;

revoke all on function private.billing_live_target_proven_v1(text,text),
  private.guard_billing_live_payment_controls_v1(),private.lock_billing_live_payment_settings_v1(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.billing_live_payment_lifecycle_ready_v1(text,text),
  public.billing_record_live_event_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_live_payment_lifecycle_ready_v1(text,text),
  public.billing_record_live_event_v1(text,jsonb) to service_role;
commit;
