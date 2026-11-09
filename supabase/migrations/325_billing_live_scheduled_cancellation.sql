-- Durable live cancellation/undo of an installed Max-to-Pro schedule.
begin;

alter table private.stripe_billing_settings
  add column live_scheduled_cancellation_admission_enabled boolean not null default false,
  add column live_scheduled_cancellation_provider_writes_enabled boolean not null default false,
  add constraint stripe_billing_live_scheduled_cancellation_controls check (
    not (live_scheduled_cancellation_admission_enabled or live_scheduled_cancellation_provider_writes_enabled)
    or live_payment_lifecycle_enabled
  );

-- Replace the original three state checks. Keep the 323 paid-invoice check.
do $$
declare c record; replaced integer:=0;
begin
  for c in select conname from pg_constraint
    where conrelid='private.billing_scheduled_plan_changes'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%state%'
      and pg_get_constraintdef(oid) not like '%live_settled_invoice_id%'
  loop
    execute format('alter table private.billing_scheduled_plan_changes drop constraint %I',c.conname);
    replaced:=replaced+1;
  end loop;
  if replaced<>3 then raise exception 'Scheduled plan change state checks differ'; end if;
end;
$$;
alter table private.billing_scheduled_plan_changes
  add constraint billing_scheduled_plan_change_state_check
    check (state in ('quoted','confirmed','scheduled','applied','closed_unpaid','expired','canceled')),
  add constraint billing_scheduled_plan_change_confirmation_check
    check ((state in ('confirmed','scheduled','applied','closed_unpaid','canceled'))=(confirmed_at is not null)),
  add constraint billing_scheduled_plan_change_provider_check
    check ((state in ('scheduled','applied','closed_unpaid','canceled'))=(provider_schedule_id is not null));

create table private.billing_live_scheduled_cancellations (
  id uuid primary key,
  schedule_operation_id uuid not null references private.billing_scheduled_plan_changes(id) on delete restrict,
  subscription_id uuid not null references public.stripe_billing_subscription_bindings(id) on delete restrict,
  state text not null check (state in ('cancel_pending','cancel_scheduled','undo_pending','undone','completed','attention','abandoned')),
  requested_action text not null check (requested_action in ('cancel','undo')),
  action_requested_at timestamptz not null,
  write_authorized_at timestamptz,
  late_undo_handoff_at timestamptz,
  next_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  revision bigint not null default 1 check (revision>0),
  expected_plan_revision bigint,
  expected_access_revision bigint,
  expected_entitlement_revision bigint,
  created_at timestamptz not null default clock_timestamp(),
  check (id<>schedule_operation_id),
  check ((state in ('cancel_pending','cancel_scheduled','undo_pending')
    or (state='attention' and (write_authorized_at is not null or requested_action='undo')))=(next_attempt_at is not null)),
  check (state<>'cancel_pending' or requested_action='cancel'),
  check (state<>'undo_pending' or requested_action='undo'),
  check (late_undo_handoff_at is null or (state='undone' and requested_action='undo' and write_authorized_at is not null))
);
create unique index billing_live_scheduled_cancellation_current
  on private.billing_live_scheduled_cancellations(subscription_id)
  where state in ('cancel_pending','cancel_scheduled','undo_pending','attention');
create index billing_live_scheduled_cancellation_history
  on private.billing_live_scheduled_cancellations(schedule_operation_id,created_at desc);
create index billing_live_scheduled_cancellation_due
  on private.billing_live_scheduled_cancellations(next_attempt_at,id) where next_attempt_at is not null;
alter table private.billing_live_scheduled_cancellations enable row level security;
revoke all on table private.billing_live_scheduled_cancellations from public,anon,authenticated,service_role;

create function public.billing_live_scheduled_customer_ready_v1(p_project_ref text,p_stripe_account text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.billing_live_payment_lifecycle_ready_v1(p_project_ref,p_stripe_account) and exists(
    select 1 from private.stripe_billing_settings where singleton
      and live_project_ref=p_project_ref and live_stripe_account=p_stripe_account
      and live_closeout_enabled and live_scheduled_closeout_enabled
      and live_scheduled_plan_change_admission_enabled and live_scheduled_plan_change_provider_writes_enabled
      and live_scheduled_cancellation_admission_enabled and live_scheduled_cancellation_provider_writes_enabled);
$$;

create function private.billing_live_cancellation_active_v1(p_subscription uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.billing_live_scheduled_cancellations operation
    join private.billing_scheduled_plan_changes change on change.id=operation.schedule_operation_id
    where operation.subscription_id=p_subscription and operation.state in ('cancel_pending','cancel_scheduled','undo_pending','attention')
      and not (operation.state in ('cancel_pending','attention') and operation.requested_action='cancel'
        and operation.write_authorized_at is null and change.effective_at<=clock_timestamp()));
$$;

-- The original Max receipt, checkout custody and paired plan/feature audits
-- remain authoritative even when a known cancellation has materialized Free.
create function private.billing_live_cancellation_source_valid_v1(
  p_change private.billing_scheduled_plan_changes,p_project_ref text,p_stripe_account text
)
returns boolean language sql stable set search_path='' as $$
  select exists(
    select 1 from public.stripe_billing_subscription_bindings binding
    join public.users subject on subject.id=binding.subject_user_id and subject.role='teacher'
    join public.billing_account_access access on access.subject_user_id=binding.subject_user_id
      and access.subscription_id=binding.id and access.source='paid'
    where binding.id=p_change.subscription_id and binding.subject_user_id=p_change.subject_user_id
      and binding.is_current and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
      and binding.offering_version_id=p_change.source_offering_version_id
      and access.offering_version_id=p_change.source_offering_version_id
      and access.paid_period_start=p_change.paid_period_start and access.paid_through=p_change.effective_at
      and access.access_ends_at=p_change.effective_at and access.last_paid_invoice_id=p_change.last_paid_invoice_id
      and access.end_reason in ('renewal_pending','cancellation') and access.failed_renewal_invoice_id is null
      and private.billing_live_reconciliation_binding_v1(binding.id,p_stripe_account) is not null
      and private.billing_live_reconciliation_plan_valid_v1(binding.id,p_project_ref,p_stripe_account)
      and private.billing_live_scheduled_target_valid_v1(p_change.source_offering_version_id,
        p_change.target_offering_version_id,p_stripe_account)
      and not private.billing_live_scheduled_other_operation_v1(binding.id));
$$;

create function private.billing_live_cancellation_status_v1(
  p_change private.billing_scheduled_plan_changes,p_operation private.billing_live_scheduled_cancellations,
  p_allow_request boolean,p_now timestamptz
)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'scheduleOperationId',p_change.id,'cancellationOperationId',p_operation.id,
    'state',case when p_change.state='confirmed' then
      case when p_change.installation_attention_at is null then 'install_pending' else 'attention' end
      else coalesce(nullif(p_operation.state,'abandoned'),'scheduled') end,
    'effectiveAt',p_change.effective_at,
    'canCancel',p_allow_request and p_change.state='scheduled' and p_now+interval '5 seconds'<p_change.effective_at
      and coalesce(p_operation.state,'scheduled') in ('scheduled','undone','abandoned')
      and access.end_reason='renewal_pending' and access.expiry_applied_at is null,
    'canUndo',p_allow_request and p_change.state='scheduled' and p_now+interval '5 seconds'<p_change.effective_at
      and coalesce(p_operation.state='cancel_scheduled',false)
      and access.end_reason='cancellation' and access.expiry_applied_at is null)
  from public.billing_account_access access where access.subject_user_id=p_change.subject_user_id;
$$;

create function public.billing_get_live_scheduled_cancellation_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype; v_subject uuid;
  c private.billing_scheduled_plan_changes%rowtype;
  o private.billing_live_scheduled_cancellations%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object' or p_request-'subject_user_id'<>'{}'::jsonb
    or jsonb_typeof(p_request->'subject_user_id') is distinct from 'string' then
    raise exception using errcode='22023',message='billing_scheduled_cancellation_request_invalid'; end if;
  v_subject:=(p_request->>'subject_user_id')::uuid;
  v_settings:=private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  select change.* into c from private.billing_scheduled_plan_changes change
    join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
      and binding.subject_user_id=change.subject_user_id and binding.provider_mode='live'
      and binding.stripe_account=p_stripe_account and binding.is_current
    join public.users subject on subject.id=binding.subject_user_id and subject.role='teacher'
    where change.subject_user_id=v_subject and change.state in ('confirmed','scheduled');
  if not found then return null; end if;
  select * into o from private.billing_live_scheduled_cancellations where schedule_operation_id=c.id
    order by (state in ('cancel_pending','cancel_scheduled','undo_pending','attention')) desc,created_at desc,id desc limit 1;
  return private.billing_live_cancellation_status_v1(c,o,
    v_settings.live_scheduled_cancellation_admission_enabled and v_settings.live_scheduled_cancellation_provider_writes_enabled
      and private.billing_live_cancellation_source_valid_v1(c,p_project_ref,p_stripe_account),clock_timestamp());
end;
$$;

create function public.billing_request_live_scheduled_cancellation_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype;
  v_subject uuid; v_schedule uuid; v_id uuid; v_action text; v_now timestamptz; v_allow boolean;
  b public.stripe_billing_subscription_bindings%rowtype; a public.billing_account_access%rowtype;
  c private.billing_scheduled_plan_changes%rowtype; o private.billing_live_scheduled_cancellations%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-array['subject_user_id','schedule_operation_id','operation_id','action']<>'{}'::jsonb
    or jsonb_typeof(p_request->'subject_user_id') is distinct from 'string'
    or jsonb_typeof(p_request->'schedule_operation_id') is distinct from 'string'
    or jsonb_typeof(p_request->'operation_id') is distinct from 'string'
    or coalesce(p_request->>'action','') not in ('cancel','undo') then
    raise exception using errcode='22023',message='billing_scheduled_cancellation_request_invalid'; end if;
  v_settings:=private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  v_subject:=(p_request->>'subject_user_id')::uuid;
  v_schedule:=(p_request->>'schedule_operation_id')::uuid;
  v_id:=(p_request->>'operation_id')::uuid;
  v_action:=p_request->>'action';
  if v_id=v_schedule then raise exception using errcode='22023',message='billing_scheduled_cancellation_request_invalid'; end if;
  select binding.* into b from public.stripe_billing_subscription_bindings binding
    join private.billing_scheduled_plan_changes change on change.subscription_id=binding.id and change.subject_user_id=binding.subject_user_id
    join public.users subject on subject.id=binding.subject_user_id and subject.role='teacher'
    where change.id=v_schedule and binding.subject_user_id=v_subject and binding.stripe_account=p_stripe_account
      and binding.provider_mode='live' and binding.is_current for update of binding;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  perform 1 from public.account_plans where subject_user_id=b.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(b.subject_user_id,'classrooms.create');
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  select * into c from private.billing_scheduled_plan_changes where id=v_schedule and subscription_id=b.id and state='scheduled' for update;
  if not found or not private.billing_live_cancellation_source_valid_v1(c,p_project_ref,p_stripe_account) then return null; end if;
  select * into o from private.billing_live_scheduled_cancellations where id=v_id
    and schedule_operation_id=c.id and subscription_id=b.id for update;
  if o.id is null and exists(select 1 from private.billing_live_scheduled_cancellations where id=v_id) then
    raise exception using errcode='23505',message='billing_scheduled_cancellation_operation_conflict'; end if;
  v_now:=clock_timestamp();
  v_allow:=v_settings.live_scheduled_cancellation_admission_enabled and v_settings.live_scheduled_cancellation_provider_writes_enabled;
  if o.id is not null and (v_action='cancel' or o.state in ('undo_pending','undone','completed')) then
    return private.billing_live_cancellation_status_v1(c,o,v_allow,v_now);
  end if;
  if not v_allow then raise exception using errcode='55000',message='billing_scheduled_cancellation_unavailable'; end if;
  if v_now+interval '5 seconds'>=c.effective_at or a.expiry_applied_at is not null
    or b.lease_expires_at>v_now then return null; end if;
  if v_action='cancel' then
    if a.end_reason<>'renewal_pending' or private.billing_live_cancellation_active_v1(b.id) then return null; end if;
    insert into private.billing_live_scheduled_cancellations(id,schedule_operation_id,subscription_id,state,
      requested_action,action_requested_at,next_attempt_at) values(v_id,c.id,b.id,'cancel_pending','cancel',v_now,v_now)
      returning * into o;
  else
    if o.state is distinct from 'cancel_scheduled' or a.end_reason<>'cancellation' then return null; end if;
    update private.billing_live_scheduled_cancellations set state='undo_pending',requested_action='undo',
      action_requested_at=v_now,write_authorized_at=null,next_attempt_at=v_now,attempt_count=0,revision=revision+1
      where id=o.id returning * into o;
  end if;
  return private.billing_live_cancellation_status_v1(c,o,v_allow,v_now);
end;
$$;

create function public.billing_list_live_scheduled_cancellations_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_limit integer; v_now timestamptz;
begin
  if jsonb_typeof(p_request) is distinct from 'object' or p_request-'limit'<>'{}'::jsonb
    or jsonb_typeof(p_request->'limit') is distinct from 'number' or coalesce(p_request->>'limit','') !~ '^[1-5]$' then
    raise exception using errcode='22023',message='billing_scheduled_cancellation_request_invalid'; end if;
  v_limit:=(p_request->>'limit')::integer;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  v_now:=clock_timestamp();
  return (
    select coalesce(jsonb_agg(item.id order by item.read_only,item.due_at,item.id),'[]'::jsonb) from (
      select o.id,o.next_attempt_at as due_at,o.state='attention' as read_only
      from private.billing_live_scheduled_cancellations o
      join private.billing_scheduled_plan_changes c on c.id=o.schedule_operation_id and c.subscription_id=o.subscription_id
      join public.stripe_billing_subscription_bindings b on b.id=o.subscription_id and b.subject_user_id=c.subject_user_id
        and b.provider_mode='live' and b.stripe_account=p_stripe_account
      where o.next_attempt_at<=v_now and (b.lease_expires_at is null or b.lease_expires_at<=v_now)
      order by read_only,o.next_attempt_at,o.id limit v_limit
    ) item
  );
end;
$$;

create function private.billing_live_cancellation_claim_json_v1(p_id uuid,p_stripe_account text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'fence',jsonb_build_object('operationId',o.id,'subscriptionId',b.id,'leaseToken',b.lease_token,
      'fencingToken',b.fencing_token,'subscriptionRevision',b.revision,'operationRevision',o.revision),
    'operation',(private.billing_live_scheduled_installation_claim_v1(c.id)->'operation')
      || jsonb_build_object('scheduleId',c.provider_schedule_id),
    'cancellationOperationId',o.id,'action',o.requested_action,'replayUntil',o.action_requested_at+interval '23 hours',
    'binding',private.billing_live_reconciliation_binding_v1(b.id,p_stripe_account),'readOnly',o.state='attention')
  from private.billing_live_scheduled_cancellations o
  join private.billing_scheduled_plan_changes c on c.id=o.schedule_operation_id and c.subscription_id=o.subscription_id
  join public.stripe_billing_subscription_bindings b on b.id=o.subscription_id
  where o.id=p_id;
$$;

create function public.billing_live_scheduled_cancellation_command_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_settings private.stripe_billing_settings%rowtype; v_id uuid; v_action text; v_outcome text;
  v_fence jsonb; v_evidence jsonb; v_now timestamptz; v_ended timestamptz; v_previous jsonb;
  v_target_start timestamptz; v_target_end timestamptz; v_late_handoff boolean;
  v_attention_due timestamptz; v_needs_attention boolean;
  b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; c private.billing_scheduled_plan_changes%rowtype;
  o private.billing_live_scheduled_cancellations%rowtype;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-array['operation_id','action','fence','outcome','evidence']<>'{}'::jsonb
    or jsonb_typeof(p_request->'operation_id') is distinct from 'string'
    or coalesce(p_request->>'action','') not in ('claim','authorize_write','finish') then
    raise exception using errcode='22023',message='billing_scheduled_cancellation_command_invalid'; end if;
  v_id:=(p_request->>'operation_id')::uuid;
  v_action:=p_request->>'action'; v_outcome:=p_request->>'outcome';
  v_fence:=p_request->'fence'; v_evidence:=p_request->'evidence';
  v_late_handoff:=coalesce(v_outcome in ('restored_after_cutoff','unchanged_after_cutoff'),false);
  if (v_action='claim' and p_request ? 'fence')
    or (v_action<>'claim' and (jsonb_typeof(v_fence) is distinct from 'object'
      or v_fence-array['operationId','subscriptionId','leaseToken','fencingToken','subscriptionRevision','operationRevision']<>'{}'::jsonb))
    or (v_action<>'finish' and p_request ?| array['outcome','evidence'])
    or (v_action='finish' and coalesce(v_outcome,'') not in (
      'canceled','restored','restored_after_cutoff','unchanged_after_cutoff','completed','retry','attention','deferred'))
    or (v_outcome is distinct from 'completed' and not v_late_handoff and p_request ? 'evidence') then
    raise exception using errcode='22023',message='billing_scheduled_cancellation_command_invalid'; end if;
  if v_outcome='completed' then
    if jsonb_typeof(v_evidence) is distinct from 'object'
      or v_evidence-array['ended_at','obligations_cleared']<>'{}'::jsonb
      or v_evidence->'obligations_cleared' is distinct from 'true'::jsonb
      or jsonb_typeof(v_evidence->'ended_at') is distinct from 'string'
      or coalesce(v_evidence->>'ended_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode='22023',message='billing_scheduled_cancellation_evidence_invalid'; end if;
    v_ended:=(v_evidence->>'ended_at')::timestamptz;
  elsif v_late_handoff then
    if jsonb_typeof(v_evidence) is distinct from 'object'
      or v_evidence-array['provider_schedule_id','period_start','period_end']<>'{}'::jsonb
      or jsonb_typeof(v_evidence->'provider_schedule_id') is distinct from 'string'
      or coalesce(v_evidence->>'provider_schedule_id','') !~ '^sub_sched_[A-Za-z0-9]{1,240}$'
      or jsonb_typeof(v_evidence->'period_start') is distinct from 'string'
      or jsonb_typeof(v_evidence->'period_end') is distinct from 'string'
      or coalesce(v_evidence->>'period_start','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or coalesce(v_evidence->>'period_end','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode='22023',message='billing_scheduled_cancellation_evidence_invalid'; end if;
    v_target_start:=(v_evidence->>'period_start')::timestamptz;
    v_target_end:=(v_evidence->>'period_end')::timestamptz;
  end if;
  v_settings:=private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  select operation.* into o from private.billing_live_scheduled_cancellations operation
    join public.stripe_billing_subscription_bindings binding on binding.id=operation.subscription_id
      and binding.stripe_account=p_stripe_account and binding.provider_mode='live'
    where operation.id=v_id;
  if not found then return null; end if;
  select * into b from public.stripe_billing_subscription_bindings where id=o.subscription_id
    and stripe_account=p_stripe_account and provider_mode='live' for update;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(b.subject_user_id,'classrooms.create');
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  select * into c from private.billing_scheduled_plan_changes where id=o.schedule_operation_id
    and subscription_id=b.id and subject_user_id=b.subject_user_id for update;
  select * into o from private.billing_live_scheduled_cancellations where id=v_id
    and subscription_id=b.id and schedule_operation_id=c.id for update;
  if not found or o.state not in ('cancel_pending','cancel_scheduled','undo_pending','attention') then return null; end if;
  v_now:=clock_timestamp();
  -- An unauthorized undo still has a verified predecessor cancellation.
  -- Keep owned ambiguity discoverable after a cooldown without reopening writes.
  if o.write_authorized_at is not null or o.requested_action='undo' then
    v_attention_due:=v_now+interval '15 minutes';
  end if;
  if v_action='claim' then
    if b.lease_expires_at>v_now or o.next_attempt_at is null or o.next_attempt_at>v_now then return null; end if;
    -- No Stripe write can have occurred without a committed authorization.
    -- Let the untouched Pro renewal reconcile when this pristine intent lapses.
    if o.state='cancel_pending' and o.write_authorized_at is null and v_now>=c.effective_at then
      update private.billing_live_scheduled_cancellations set state='abandoned',next_attempt_at=null,revision=revision+1 where id=o.id;
      return null;
    end if;
    if c.state<>'scheduled' or not private.billing_live_cancellation_source_valid_v1(c,p_project_ref,p_stripe_account) then
      update private.billing_live_scheduled_cancellations set state='attention',next_attempt_at=v_attention_due,
        revision=revision+1 where id=o.id;
      return null;
    end if;
    update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),lease_expires_at=v_now+interval '120 seconds',
      fencing_token=fencing_token+1,revision=revision+1,updated_at=v_now where id=b.id;
    update private.billing_live_scheduled_cancellations set revision=revision+1,
      expected_plan_revision=p.revision,expected_access_revision=a.revision,expected_entitlement_revision=a.entitlement_revision where id=o.id;
    return private.billing_live_cancellation_claim_json_v1(o.id,p_stripe_account);
  end if;
  if b.lease_token is null or b.lease_expires_at<=v_now
    or v_fence->>'operationId' is distinct from o.id::text or v_fence->>'subscriptionId' is distinct from b.id::text
    or v_fence->>'leaseToken' is distinct from b.lease_token::text or v_fence->>'fencingToken' is distinct from b.fencing_token::text
    or v_fence->>'subscriptionRevision' is distinct from b.revision::text
    or v_fence->>'operationRevision' is distinct from o.revision::text then return null; end if;
  if c.state<>'scheduled' or not private.billing_live_cancellation_source_valid_v1(c,p_project_ref,p_stripe_account)
    or o.expected_plan_revision is distinct from p.revision or o.expected_access_revision is distinct from a.revision
    or o.expected_entitlement_revision is distinct from a.entitlement_revision then
    -- Only the matching worker may release this lease. The next claim rechecks
    -- custody and can capture the normal Free-at-cutoff revision.
    update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,
      revision=revision+1,updated_at=v_now where id=b.id;
    return null;
  end if;
  if v_action='authorize_write' then
    if not v_settings.live_scheduled_cancellation_provider_writes_enabled or o.state not in ('cancel_pending','undo_pending')
      or v_now+interval '5 seconds'>=least(c.effective_at,o.action_requested_at+interval '23 hours')
      or b.lease_expires_at<=v_now+interval '15 seconds'
      or (o.state='cancel_pending' and a.end_reason<>'renewal_pending')
      or (o.state='undo_pending' and a.end_reason<>'cancellation') then return null; end if;
    update private.billing_live_scheduled_cancellations set write_authorized_at=coalesce(write_authorized_at,v_now),
      revision=revision+1 where id=o.id;
    return private.billing_live_cancellation_claim_json_v1(o.id,p_stripe_account);
  end if;

  if v_outcome='canceled' then
    if o.state not in ('cancel_pending','cancel_scheduled','attention')
      or o.requested_action<>'cancel' or o.write_authorized_at is null then return null; end if;
    update public.billing_account_access set end_reason='cancellation',last_provider_verified_at=v_now,
      revision=revision+case when end_reason='cancellation' then 0 else 1 end,updated_at=v_now
      where subject_user_id=b.subject_user_id;
    update private.billing_live_scheduled_cancellations set state='cancel_scheduled',next_attempt_at=c.effective_at,
      attempt_count=0,revision=revision+1 where id=o.id;
  elsif v_outcome='restored' then
    if o.state not in ('undo_pending','attention') or o.requested_action<>'undo'
      or o.write_authorized_at is null or v_now>=c.effective_at
      or a.end_reason<>'cancellation' or a.expiry_applied_at is not null then return null; end if;
    update public.billing_account_access set end_reason='renewal_pending',last_provider_verified_at=v_now,revision=revision+1,updated_at=v_now
      where subject_user_id=b.subject_user_id;
    update private.billing_live_scheduled_cancellations set state='undone',next_attempt_at=null,revision=revision+1 where id=o.id;
  elsif v_late_handoff then
    -- A verified target phase can disambiguate a lost Stripe response. Change
    -- custody only; normal reconciliation must still prove the target invoice.
    if v_now<c.effective_at or o.write_authorized_at is null or o.write_authorized_at>=c.effective_at
      or v_evidence->>'provider_schedule_id' is distinct from c.provider_schedule_id
      or v_target_start is distinct from c.effective_at
      or v_target_end is distinct from private.billing_scheduled_term_end_v1(c.effective_at,c.target_offering_version_id)
      or (v_outcome='restored_after_cutoff' and (o.state not in ('undo_pending','attention') or o.requested_action<>'undo'
        or a.end_reason<>'cancellation' or a.expiry_applied_at is not null))
      or (v_outcome='unchanged_after_cutoff' and (o.state not in ('cancel_pending','attention') or o.requested_action<>'cancel' or a.end_reason<>'renewal_pending')) then
      return null; end if;
    if v_outcome='restored_after_cutoff' then
      -- Retain the exact term and its revisions. Current-time access remains blocked.
      update public.billing_account_access set end_reason='renewal_pending',last_provider_verified_at=v_now,
        revision=revision+1,updated_at=v_now where subject_user_id=b.subject_user_id;
    end if;
    update private.billing_live_scheduled_cancellations set
      state=case when v_outcome='restored_after_cutoff' then 'undone' else 'abandoned' end,
      late_undo_handoff_at=case when v_outcome='restored_after_cutoff' then v_now end,
      next_attempt_at=null,revision=revision+1 where id=o.id;
  elsif v_outcome='completed' then
    if v_now<c.effective_at or v_ended is distinct from c.effective_at
      or (o.requested_action='cancel' and o.write_authorized_at is null) then return null; end if;
    v_previous:=to_jsonb(a);
    update public.billing_account_access set end_reason='cancellation',last_provider_verified_at=v_now,
      revision=revision+case when end_reason='cancellation' then 0 else 1 end,updated_at=v_now
      where subject_user_id=b.subject_user_id;
    if a.expiry_applied_at is null then perform private.billing_write_access_v1(b.subject_user_id,p.revision,'subscription_expired'); end if;
    select * into a from public.billing_account_access where subject_user_id=b.subject_user_id;
    insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,previous_state,next_state)
      values(b.subject_user_id,b.id,gen_random_uuid(),'canceled',v_previous,to_jsonb(a));
    update private.billing_scheduled_plan_changes set state='canceled' where id=c.id;
    update private.billing_live_scheduled_cancellations set state='completed',next_attempt_at=null,revision=revision+1 where id=o.id;
    update public.stripe_billing_subscription_bindings set is_current=false,terminal_confirmed_at=v_now,
      obligations_cleared_at=v_now,last_provider_status='canceled',next_reconcile_at=null,last_exception_code=null,
      lease_token=null,lease_expires_at=null,revision=revision+1,updated_at=v_now where id=b.id;
    return 'true'::jsonb;
  else
    v_needs_attention:=o.state='attention' or v_outcome='attention' or (v_outcome='retry' and o.attempt_count>=4);
    update private.billing_live_scheduled_cancellations set
      state=case when v_needs_attention then 'attention' else state end,
      next_attempt_at=case
        when v_needs_attention then v_attention_due
        when v_now<c.effective_at then least(c.effective_at,v_now+interval '30 seconds')
        else v_now+interval '30 seconds' end,
      attempt_count=least(5,attempt_count+case when v_outcome='retry' then 1 else 0 end),revision=revision+1 where id=o.id;
  end if;
  update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,
    next_reconcile_at=case when v_outcome='restored' or v_late_handoff then v_now else next_reconcile_at end,
    reconcile_state=case when v_outcome='restored' or v_late_handoff then 'queued' else reconcile_state end,
    reconcile_attempt_count=case when v_outcome='restored' or v_late_handoff then 0 else reconcile_attempt_count end,
    reconcile_attention_at=case when v_outcome='restored' or v_late_handoff then null else reconcile_attention_at end,
    revision=revision+1,updated_at=v_now where id=b.id;
  return 'true'::jsonb;
end;
$$;

-- The customer precheck is advisory. Admission locks the same settings row so
-- disabling cancellation or closeout cannot race creation/confirmation.
create function private.billing_live_scheduled_customer_admission_v1(
  p_project_ref text,p_stripe_account text,p_request jsonb,p_confirm boolean
)
returns jsonb language plpgsql set search_path='' as $$
begin
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if not public.billing_live_scheduled_customer_ready_v1(p_project_ref,p_stripe_account)
    and not exists(select 1 from private.billing_scheduled_plan_changes change
      join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
        and binding.subject_user_id=change.subject_user_id and binding.is_current
        and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
      where change.id::text=lower(p_request->>'operation_id') and change.subject_user_id::text=lower(p_request->>'subject_user_id')
        and change.state in ('confirmed','scheduled','applied')) then
    raise exception using errcode='55000',message='billing_live_scheduled_change_admission_unavailable'; end if;
  return private.billing_live_scheduled_admission_v1(p_project_ref,p_stripe_account,p_request,p_confirm);
end;
$$;

create or replace function public.billing_reserve_live_scheduled_plan_change_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.billing_live_scheduled_customer_admission_v1(p_project_ref,p_stripe_account,p_request,false);
$$;

create or replace function public.billing_confirm_live_scheduled_plan_change_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select private.billing_live_scheduled_customer_admission_v1(p_project_ref,p_stripe_account,p_request,true);
$$;

create or replace function private.billing_live_closeout_binding_valid_v1(p_subscription uuid,p_stripe_account text)
returns boolean language sql stable set search_path='' as $$
  select not private.billing_live_cancellation_active_v1(p_subscription)
    and private.billing_live_reconciliation_binding_v1(p_subscription,p_stripe_account) is not null
    and not exists(select 1 from public.billing_upgrade_operations operation
      where operation.subscription_id=p_subscription and operation.status in ('queued','retry','attention'))
    and not exists(select 1 from private.billing_scheduled_plan_changes change
      where change.subscription_id=p_subscription and change.state='confirmed')
    and not exists(select 1 from private.billing_live_closeout_schedule_candidate_v1(p_subscription,p_stripe_account) schedule
      where not schedule.valid or not (
        exists(select 1 from private.stripe_billing_settings where singleton and live_scheduled_closeout_enabled)
        or exists(select 1 from public.billing_renewal_closeouts closeout where closeout.subscription_id=p_subscription
          and closeout.scheduled_operation_id=schedule.operation_id and closeout.status in ('queued','retry','attention'))));
$$;

create or replace function private.billing_live_reconciliation_blocked_v1(p_subscription uuid)
returns boolean language sql stable set search_path='' as $$
  select private.billing_live_cancellation_active_v1(p_subscription)
    or exists(select 1 from public.billing_upgrade_operations upgrade
      where upgrade.subscription_id=p_subscription and upgrade.status in ('queued','retry','attention'))
    or exists(select 1 from private.billing_scheduled_plan_changes change
      where change.subscription_id=p_subscription and change.state='confirmed')
    or exists(select 1 from public.billing_renewal_closeouts closeout
      where closeout.subscription_id=p_subscription and closeout.status in ('queued','retry','attention'))
    or exists(select 1 from public.stripe_billing_subscription_bindings binding
      join public.billing_account_access access on access.subscription_id=binding.id and access.subject_user_id=binding.subject_user_id
      join private.stripe_billing_settings settings on settings.singleton and settings.live_closeout_enabled
        and settings.live_payment_lifecycle_enabled and settings.live_stripe_account=binding.stripe_account
      where binding.id=p_subscription and binding.is_current and binding.provider_mode='live'
        and access.source='paid' and access.end_reason='renewal_grace' and access.failed_renewal_invoice_id is not null
        and access.access_ends_at=access.paid_through+interval '168 hours' and access.access_ends_at<=clock_timestamp()
        and private.billing_live_closeout_binding_valid_v1(binding.id,binding.stripe_account));
$$;

-- An authorized undo might have restored Pro already. Effective access still
-- ends at the exact clock cutoff, but writing a cancellation expiry before
-- verification would permanently restrict classrooms for a canceled operation
-- that Stripe may have undone. Both writers share the binding and subject locks.
create function private.billing_live_undo_awaiting_proof_v1(p_subscription uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from private.billing_live_scheduled_cancellations operation
    join private.billing_scheduled_plan_changes change on change.id=operation.schedule_operation_id
      and change.subscription_id=operation.subscription_id and change.state='scheduled'
    where operation.subscription_id=p_subscription and operation.requested_action='undo'
      and operation.state in ('undo_pending','attention') and operation.write_authorized_at<change.effective_at);
$$;

create or replace function public.billing_apply_due_live_paid_access_v1(
  p_project_ref text,p_stripe_account text,p_request jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_candidate record;
  v_binding public.stripe_billing_subscription_bindings%rowtype;
  v_access public.billing_account_access%rowtype;
  v_plan public.account_plans%rowtype;
  v_limit integer;
  v_revision bigint;
  v_count integer:=0;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode='22023',message='billing_limit_invalid';
  end if;
  if exists(select 1 from jsonb_object_keys(p_request) as key(name) where key.name<>'limit')
    or coalesce(p_request->>'limit','') !~ '^[1-9][0-9]{0,2}$' then
    raise exception using errcode='22023',message='billing_limit_invalid';
  end if;
  v_limit:=(p_request->>'limit')::integer;
  if v_limit>100 then raise exception using errcode='22023',message='billing_limit_invalid'; end if;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);

  for v_candidate in
    select access.subject_user_id,access.subscription_id
    from public.billing_account_access access
    join public.stripe_billing_subscription_bindings binding on binding.id=access.subscription_id
      and binding.subject_user_id=access.subject_user_id
      and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
    join public.account_plans plan on plan.subject_user_id=access.subject_user_id
      and plan.revision=access.account_plan_revision and plan.management_source='billing'
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
      and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
    where access.source='paid' and access.end_reason in ('cancellation','renewal_grace')
      and access.expiry_applied_at is null and access.access_ends_at<=clock_timestamp()
      and not private.billing_live_undo_awaiting_proof_v1(binding.id)
      and private.billing_live_reconciliation_binding_v1(binding.id,p_stripe_account) is not null
      and private.billing_live_reconciliation_plan_valid_v1(binding.id,p_project_ref,p_stripe_account)
    order by access.access_ends_at,access.subject_user_id limit v_limit
  loop
    -- A financially retired binding can still own the expired local term.
    select * into v_binding from public.stripe_billing_subscription_bindings
      where id=v_candidate.subscription_id and subject_user_id=v_candidate.subject_user_id
        and provider_mode='live' and stripe_account=p_stripe_account for update skip locked;
    if not found or not pg_try_advisory_xact_lock(hashtextextended(
      'account-plan-subject:'||v_candidate.subject_user_id::text,20620260924)) then continue; end if;
    select * into v_plan from public.account_plans where subject_user_id=v_candidate.subject_user_id for update;
    select * into v_access from public.billing_account_access
      where subject_user_id=v_candidate.subject_user_id for update;
    perform public.lock_effective_feature_entitlement_v1(v_candidate.subject_user_id,'classrooms.create');
    if v_access.source is distinct from 'paid' or v_access.subscription_id is distinct from v_binding.id
      or v_access.end_reason not in ('cancellation','renewal_grace') or v_access.expiry_applied_at is not null
      or v_access.access_ends_at>clock_timestamp()
      or private.billing_live_undo_awaiting_proof_v1(v_binding.id)
      or private.billing_live_reconciliation_binding_v1(v_binding.id,p_stripe_account) is null
      or not private.billing_live_reconciliation_plan_valid_v1(v_binding.id,p_project_ref,p_stripe_account) then
      continue;
    end if;
    v_revision:=private.billing_write_access_v1(v_candidate.subject_user_id,v_plan.revision,'subscription_expired');
    insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,next_state)
      values(v_candidate.subject_user_id,v_binding.id,gen_random_uuid(),'subscription_expired',
        jsonb_build_object('state','free','classroom_limit',0,'access_ends_at',v_access.access_ends_at,'revision',v_revision));
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('processed',v_count);
end;
$$;

-- A valid cancellation lease belongs only to the cancellation writer. This
-- protects the completion RPCs as well as the list/claim arbitration.
create function private.billing_live_cancellation_finish_blocked_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns boolean language plpgsql set search_path='' as $$
begin
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  if coalesce(p_request->>'subscription_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false; end if;
  return exists(select 1 from public.stripe_billing_subscription_bindings binding
    where binding.id=(p_request->>'subscription_id')::uuid and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
      and private.billing_live_cancellation_active_v1(binding.id));
end;
$$;

create or replace function public.billing_finish_live_lifecycle_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if private.billing_live_cancellation_finish_blocked_v1(p_project_ref,p_stripe_account,p_request) then
    return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  return private.billing_finish_live_lifecycle_core_v1(p_project_ref,p_stripe_account,p_request,null);
end;
$$;

create or replace function public.billing_finish_live_scheduled_renewal_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or coalesce(p_request->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request->>'target_offering_version_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request->>'provider_schedule_id','') !~ '^sub_sched_[A-Za-z0-9]{1,240}$' then
    raise exception using errcode='22023',message='billing_scheduled_renewal_request_invalid';
  end if;
  if private.billing_live_cancellation_finish_blocked_v1(p_project_ref,p_stripe_account,p_request) then
    return jsonb_build_object('status','rejected','retry_scheduled',false); end if;
  return private.billing_finish_live_lifecycle_core_v1(p_project_ref,p_stripe_account,
    p_request-array['operation_id','provider_schedule_id','target_offering_version_id'],
    jsonb_build_object('operation_id',p_request->'operation_id','provider_schedule_id',p_request->'provider_schedule_id',
      'target_offering_version_id',p_request->'target_offering_version_id'));
end;
$$;

revoke all on function private.billing_live_cancellation_active_v1(uuid),
  private.billing_live_undo_awaiting_proof_v1(uuid),
  private.billing_live_cancellation_finish_blocked_v1(text,text,jsonb),
  private.billing_live_cancellation_source_valid_v1(private.billing_scheduled_plan_changes,text,text),
  private.billing_live_cancellation_status_v1(private.billing_scheduled_plan_changes,private.billing_live_scheduled_cancellations,boolean,timestamptz),
  private.billing_live_cancellation_claim_json_v1(uuid,text),
  private.billing_live_scheduled_customer_admission_v1(text,text,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.billing_live_scheduled_customer_ready_v1(text,text),
  public.billing_get_live_scheduled_cancellation_v1(text,text,jsonb),
  public.billing_request_live_scheduled_cancellation_v1(text,text,jsonb),
  public.billing_list_live_scheduled_cancellations_v1(text,text,jsonb),
  public.billing_live_scheduled_cancellation_command_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_live_scheduled_customer_ready_v1(text,text),
  public.billing_get_live_scheduled_cancellation_v1(text,text,jsonb),
  public.billing_request_live_scheduled_cancellation_v1(text,text,jsonb),
  public.billing_list_live_scheduled_cancellations_v1(text,text,jsonb),
  public.billing_live_scheduled_cancellation_command_v1(text,text,jsonb) to service_role;

commit;
