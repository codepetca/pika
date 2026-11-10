-- A failed live scheduled renewal shares the ordinary closeout lease and proof
-- stages. Admission and schedule-installation writes do not control recovery.
begin;

alter table private.stripe_billing_settings
  add column live_scheduled_closeout_enabled boolean not null default false,
  add constraint stripe_billing_live_scheduled_closeout_controls check (
    not live_scheduled_closeout_enabled or live_closeout_enabled
  );

-- No row means ordinary closeout. A row with invalid proof must never fall back
-- to the ordinary path, which would verify and cancel against the wrong price.
create function private.billing_live_closeout_schedule_candidate_v1(p_subscription uuid,p_stripe_account text)
returns table(operation_id uuid,valid boolean) language sql stable set search_path='' as $$
  select change.id,coalesce(
    binding.subject_user_id=change.subject_user_id and binding.is_current
    and binding.offering_version_id=change.source_offering_version_id
    and access.source='paid' and access.offering_version_id=change.source_offering_version_id
    and access.paid_period_start=change.paid_period_start and access.paid_through=change.effective_at
    and access.last_paid_invoice_id=change.last_paid_invoice_id
    and change.provider_schedule_id is not null
    and private.billing_live_scheduled_target_valid_v1(change.source_offering_version_id,
      change.target_offering_version_id,p_stripe_account),false)
  from private.billing_scheduled_plan_changes change
  left join public.stripe_billing_subscription_bindings binding on binding.id=change.subscription_id
    and binding.provider_mode='live' and binding.stripe_account=p_stripe_account
  left join public.billing_account_access access on access.subscription_id=binding.id
    and access.subject_user_id=binding.subject_user_id
  where change.subscription_id=p_subscription and change.state='scheduled';
$$;

create or replace function private.billing_live_closeout_binding_valid_v1(p_subscription uuid,p_stripe_account text)
returns boolean language sql stable set search_path='' as $$
  select private.billing_live_reconciliation_binding_v1(p_subscription,p_stripe_account) is not null
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

-- The ordinary serializer's scheduled branch is sandbox-only. Keep the same
-- claim envelope but obtain the exact live target from the 323 proof reader.
create function private.billing_live_renewal_closeout_claim_json_v1(
  p_project_ref text,p_stripe_account text,p_operation uuid
)
returns jsonb language plpgsql set search_path='' as $$
declare
  o public.billing_renewal_closeouts%rowtype;
  b public.stripe_billing_subscription_bindings%rowtype;
  proof jsonb;
begin
  select * into strict o from public.billing_renewal_closeouts where id=p_operation;
  if o.scheduled_operation_id is null then return private.billing_renewal_closeout_claim_json_v1(o.id); end if;
  select * into strict b from public.stripe_billing_subscription_bindings where id=o.subscription_id
    and provider_mode='live' and stripe_account=p_stripe_account;
  proof:=public.billing_get_live_scheduled_renewal_v1(p_project_ref,p_stripe_account,
    jsonb_build_object('subscription_id',b.id,'lease_token',b.lease_token));
  if proof->>'state' is distinct from 'scheduled' or proof->>'operation_id' is distinct from o.scheduled_operation_id::text
    or (proof->>'effective_at')::timestamptz is distinct from o.paid_through then return null; end if;
  return jsonb_build_object('status','claimed','operation_id',o.id,'subscription_id',b.id,
    'lease_token',b.lease_token,'fencing_token',b.fencing_token,'lease_expires_at',b.lease_expires_at,
    'subscription_revision',b.revision,'expected_account_plan_revision',o.expected_account_plan_revision,
    'operation_revision',o.revision,'stage',o.stage,'invoice_id',o.invoice_id,'paid_through',o.paid_through,'cutoff',o.cutoff,
    'binding',private.billing_live_reconciliation_binding_v1(b.id,p_stripe_account),'scheduled',proof-'state');
end;
$$;

create or replace function private.billing_check_live_renewal_closeout_fence_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; o public.billing_renewal_closeouts%rowtype;
  v_schedule uuid; v_schedule_valid boolean;
begin
  select * into b from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid and provider_mode='live' and stripe_account=p_stripe_account for update;
  if not found then return 'lost_claim'; end if;
  if b.lease_token is null or b.lease_expires_at is null or b.lease_token is distinct from (p_request->>'lease_token')::uuid
    or b.lease_expires_at<=clock_timestamp() or b.fencing_token<>(p_request->>'fencing_token')::bigint
    or b.revision<>(p_request->>'subscription_revision')::bigint then return 'lost_claim'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(b.subject_user_id,'classrooms.create');
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  perform 1 from private.billing_scheduled_plan_changes where subscription_id=b.id and state='scheduled' for update;
  select operation_id,valid into v_schedule,v_schedule_valid
    from private.billing_live_closeout_schedule_candidate_v1(b.id,p_stripe_account);
  select * into o from public.billing_renewal_closeouts where id=(p_request->>'operation_id')::uuid and subscription_id=b.id for update;
  if not found or o.revision<>(p_request->>'operation_revision')::bigint
    or o.status not in ('queued','retry') then return 'lost_claim'; end if;
  -- A waiter may have consumed its lease while acquiring the plan/access locks.
  if b.lease_expires_at<=clock_timestamp() then return 'lost_claim'; end if;
  if not b.is_current or b.provider_mode<>'live' or a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
    or a.end_reason is distinct from 'renewal_grace' or a.failed_renewal_invoice_id is distinct from o.invoice_id
    or a.paid_through is distinct from o.paid_through or a.access_ends_at is distinct from o.cutoff
    or a.access_ends_at>clock_timestamp() or a.expiry_applied_at is null then return 'superseded'; end if;
  if p.revision is distinct from (p_request->>'expected_account_plan_revision')::bigint
    or p.revision is distinct from o.expected_account_plan_revision or a.account_plan_revision is distinct from p.revision
    or p.management_source is distinct from 'billing' or p.plan_key is distinct from 'free'
    or a.revision is distinct from o.expected_access_revision
    or a.entitlement_revision is distinct from o.expected_entitlement_revision
    or o.expected_entitlement_revision is distinct from (select revision from public.effective_feature_entitlements
      where subject_user_id=b.subject_user_id and feature_key='classrooms.create') then return 'plan_conflict'; end if;
  if o.scheduled_operation_id is distinct from v_schedule or (v_schedule is not null and v_schedule_valid is not true) then
    return 'plan_conflict'; end if;
  if not private.billing_live_closeout_binding_valid_v1(b.id,p_stripe_account) then return 'superseded'; end if;
  if not private.billing_live_reconciliation_plan_valid_v1(b.id,p_project_ref,p_stripe_account) then return 'plan_conflict'; end if;
  return 'valid';
end; $$;

create or replace function public.billing_list_live_renewal_closeouts_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  if not private.lock_billing_live_closeout_settings_v1(p_project_ref,p_stripe_account) then return jsonb_build_object('items','[]'::jsonb); end if;
  if p_request ? 'scheduled_changes_enabled' and p_request->'scheduled_changes_enabled' is distinct from 'true'::jsonb then
    raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  perform private.billing_validate_renewal_closeout_request_v1(p_request-'scheduled_changes_enabled','list');
  select coalesce(jsonb_agg(jsonb_build_object('subscription_id',due.id)),'[]'::jsonb) into r from (
    select b.id from public.stripe_billing_subscription_bindings b
    join public.billing_account_access a on a.subscription_id=b.id and a.subject_user_id=b.subject_user_id
    join public.account_plans p on p.subject_user_id=b.subject_user_id
    join public.effective_feature_entitlements e on e.subject_user_id=b.subject_user_id and e.feature_key='classrooms.create'
    left join public.billing_renewal_closeouts o on o.subscription_id=b.id and o.invoice_id=a.failed_renewal_invoice_id
    left join lateral private.billing_live_closeout_schedule_candidate_v1(b.id,p_stripe_account) schedule on true
    where private.billing_live_closeout_binding_valid_v1(b.id,p_stripe_account)
      and private.billing_live_reconciliation_plan_valid_v1(b.id,p_project_ref,p_stripe_account)
      and a.access_ends_at=a.paid_through+interval '168 hours' and a.failed_renewal_invoice_id is not null
      and b.is_current and b.provider_mode='live' and b.stripe_account=p_stripe_account and a.source='paid' and a.end_reason='renewal_grace'
      and a.access_ends_at<=clock_timestamp() and a.expiry_applied_at is not null
      and p.management_source='billing' and p.plan_key='free' and a.account_plan_revision=p.revision and a.entitlement_revision=e.revision
      and (schedule.operation_id is null or p_request->'scheduled_changes_enabled'='true'::jsonb)
      and (o.id is null or (o.scheduled_operation_id is not distinct from schedule.operation_id
        and o.expected_account_plan_revision=p.revision and o.expected_access_revision=a.revision
        and o.expected_entitlement_revision=e.revision))
      and (b.lease_expires_at is null or b.lease_expires_at<=clock_timestamp())
      and (o.id is null or (o.status in ('queued','retry') and o.next_attempt_at<=clock_timestamp()))
    order by coalesce(o.next_attempt_at,a.access_ends_at),b.id limit 1
  ) due;
  return jsonb_build_object('items',r);
end; $$;

create or replace function public.billing_claim_live_renewal_closeout_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; o public.billing_renewal_closeouts%rowtype;
  v_schedule uuid; v_schedule_valid boolean;
begin
  if not private.lock_billing_live_closeout_settings_v1(p_project_ref,p_stripe_account) then return jsonb_build_object('status','not_found'); end if;
  if p_request ? 'scheduled_changes_enabled' and p_request->'scheduled_changes_enabled' is distinct from 'true'::jsonb then
    raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  perform private.billing_validate_renewal_closeout_request_v1(p_request-'scheduled_changes_enabled','claim');
  select * into b from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid and provider_mode='live' and stripe_account=p_stripe_account for update;
  if not found or not b.is_current then return jsonb_build_object('status','not_found'); end if;
  if b.lease_expires_at>clock_timestamp() then return jsonb_build_object('status','busy'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(b.subject_user_id,'classrooms.create');
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  perform 1 from private.billing_scheduled_plan_changes where subscription_id=b.id and state='scheduled' for update;
  select operation_id,valid into v_schedule,v_schedule_valid
    from private.billing_live_closeout_schedule_candidate_v1(b.id,p_stripe_account);
  if b.provider_mode<>'live' or a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
    or a.end_reason is distinct from 'renewal_grace' or a.failed_renewal_invoice_id is null
    or a.access_ends_at is distinct from a.paid_through+interval '168 hours'
    or a.access_ends_at>clock_timestamp() or a.expiry_applied_at is null then
    return jsonb_build_object('status','superseded'); end if;
  if p.plan_key is distinct from 'free' or p.management_source is distinct from 'billing'
    or a.account_plan_revision is distinct from p.revision or a.entitlement_revision is null
    or a.entitlement_revision is distinct from (select revision from public.effective_feature_entitlements
      where subject_user_id=b.subject_user_id and feature_key='classrooms.create') then
    return jsonb_build_object('status','plan_conflict'); end if;
  if v_schedule is not null and v_schedule_valid is not true then return jsonb_build_object('status','plan_conflict'); end if;
  if v_schedule is not null and p_request->'scheduled_changes_enabled' is distinct from 'true'::jsonb then
    return jsonb_build_object('status','busy'); end if;
  if not private.billing_live_closeout_binding_valid_v1(b.id,p_stripe_account) then return jsonb_build_object('status','superseded'); end if;
  if not private.billing_live_reconciliation_plan_valid_v1(b.id,p_project_ref,p_stripe_account) then return jsonb_build_object('status','plan_conflict'); end if;
  select * into o from public.billing_renewal_closeouts where subscription_id=b.id
    and (invoice_id=a.failed_renewal_invoice_id or status in ('queued','retry','attention'))
    order by (invoice_id=a.failed_renewal_invoice_id) desc limit 1 for update;
  if o.id is not null then
    if o.scheduled_operation_id is distinct from v_schedule then return jsonb_build_object('status','plan_conflict'); end if;
    if o.invoice_id<>a.failed_renewal_invoice_id or o.paid_through<>a.paid_through or o.cutoff<>a.access_ends_at then
      update public.billing_renewal_closeouts set status='superseded',stage='superseded',completed_at=clock_timestamp(),
        next_attempt_at=null,revision=revision+1,updated_at=clock_timestamp() where id=o.id;
      return jsonb_build_object('status','superseded'); end if;
    if o.expected_account_plan_revision<>p.revision or o.expected_access_revision<>a.revision
      or o.expected_entitlement_revision<>a.entitlement_revision then return jsonb_build_object('status','plan_conflict'); end if;
    if o.status in ('closed','payment_won','superseded') then return jsonb_build_object('status','superseded'); end if;
    if o.status='attention' or o.next_attempt_at>clock_timestamp() then return jsonb_build_object('status','busy'); end if;
  else
    insert into public.billing_renewal_closeouts(subscription_id,invoice_id,paid_through,cutoff,
      expected_account_plan_revision,expected_access_revision,expected_entitlement_revision,scheduled_operation_id)
      values(b.id,a.failed_renewal_invoice_id,a.paid_through,a.access_ends_at,p.revision,a.revision,a.entitlement_revision,v_schedule) returning * into o;
  end if;
  update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>(p_request->>'lease_seconds')::integer),
    fencing_token=fencing_token+1,revision=revision+1,updated_at=clock_timestamp() where id=b.id;
  update public.billing_renewal_closeouts set status='queued',revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  return coalesce(private.billing_live_renewal_closeout_claim_json_v1(p_project_ref,p_stripe_account,o.id),jsonb_build_object('status','busy'));
end; $$;

create or replace function public.billing_checkpoint_live_renewal_closeout_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; previous_stage text;
  stages text[]:=array['queued','pause_requested','collection_paused','void_requested','invoice_voided','cancel_requested'];
begin
  if not private.lock_billing_live_closeout_settings_v1(p_project_ref,p_stripe_account) then return jsonb_build_object('status','lost_claim'); end if;
  perform private.billing_validate_renewal_closeout_request_v1(p_request,'checkpoint');
  s:=private.billing_check_live_renewal_closeout_fence_v1(p_project_ref,p_stripe_account,p_request);
  if s<>'valid' then return jsonb_build_object('status',s); end if;
  select stage into previous_stage from public.billing_renewal_closeouts where id=(p_request->>'operation_id')::uuid;
  -- Recovery may skip an already observed successful write, never move backward.
  if array_position(stages,p_request->>'stage')<array_position(stages,previous_stage) then
    raise exception using errcode='22023',message='billing_closeout_stage_invalid'; end if;
  update public.billing_renewal_closeouts set stage=p_request->>'stage',revision=revision+1,updated_at=clock_timestamp()
    where id=(p_request->>'operation_id')::uuid;
  return coalesce(private.billing_live_renewal_closeout_claim_json_v1(
    p_project_ref,p_stripe_account,(p_request->>'operation_id')::uuid),jsonb_build_object('status','lost_claim'));
end; $$;

create or replace function public.billing_finish_live_renewal_closeout_v1(p_project_ref text,p_stripe_account text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; o public.billing_renewal_closeouts%rowtype; e jsonb:=p_request->'evidence';
  outcome text:=p_request->>'outcome'; r jsonb; finish_request jsonb; start_at timestamptz; end_at timestamptz;
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_has_schedule boolean:=p_request ?| array['scheduled_operation_id','provider_schedule_id'];
begin
  if not private.lock_billing_live_closeout_settings_v1(p_project_ref,p_stripe_account) then return jsonb_build_object('status','lost_claim'); end if;
  perform private.billing_validate_renewal_closeout_request_v1(p_request-array['scheduled_operation_id','provider_schedule_id'],'finish');
  if v_has_schedule and (
    jsonb_typeof(p_request->'scheduled_operation_id') is distinct from 'string'
    or coalesce(p_request->>'scheduled_operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_request->'provider_schedule_id') is distinct from 'string'
    or coalesce(p_request->>'provider_schedule_id','') !~ '^sub_sched_[A-Za-z0-9]{1,240}$') then
    raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  -- Evidence is normalized, bounded and independently revalidated at this boundary.
  if p_request ? 'evidence' then
    if jsonb_typeof(e) is distinct from 'object' or coalesce(e->>'kind','') not in ('paid','unpaid','payment_pending','invoice_voided','attention') then
      raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
    if e->>'kind'='paid' then
      if e-array['kind','invoiceId','periodStart','periodEnd','providerStatus','cancelAtPeriodEnd','terminalObligationsCleared']<>'{}'::jsonb
        or coalesce(e->>'providerStatus','') not in ('active','canceled')
        or jsonb_typeof(e->'cancelAtPeriodEnd') is distinct from 'boolean'
        or jsonb_typeof(e->'terminalObligationsCleared') is distinct from 'boolean'
        or jsonb_typeof(e->'periodStart') is distinct from 'string' or jsonb_typeof(e->'periodEnd') is distinct from 'string'
        or coalesce(e->>'periodStart','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
        or coalesce(e->>'periodEnd','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
      begin start_at:=(e->>'periodStart')::timestamptz; end_at:=(e->>'periodEnd')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end;
      if not isfinite(start_at) or not isfinite(end_at) or end_at<=start_at then
        raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
    elsif e->>'kind'='invoice_voided' then
      if e-array['kind','invoiceId','subscriptionCanceled','obligationsCleared']<>'{}'::jsonb
        or jsonb_typeof(e->'subscriptionCanceled') is distinct from 'boolean' or jsonb_typeof(e->'obligationsCleared') is distinct from 'boolean' then
        raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
    elsif e->>'kind'='unpaid' then
      if e-array['kind','invoiceId','invoiceStatus','collectionPaused']<>'{}'::jsonb
        or coalesce(e->>'invoiceStatus','') not in ('open','uncollectible') or jsonb_typeof(e->'collectionPaused') is distinct from 'boolean' then
        raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
    elsif e->>'kind'='payment_pending' then
      if e-array['kind','invoiceId']<>'{}'::jsonb then raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
    elsif e-array['kind','reason']<>'{}'::jsonb or coalesce(e->>'reason','') not in
      ('identity_mismatch','unsupported_payment','partial_payment','unknown_invoice','incomplete_evidence','unexpected_money') then
      raise exception using errcode='22023',message='billing_closeout_evidence_invalid';
    end if;
    if e->>'kind'<>'attention' and (jsonb_typeof(e->'invoiceId') is distinct from 'string'
      or coalesce(e->>'invoiceId','') !~ '^in_[A-Za-z0-9]{1,252}$') then
      raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
  end if;
  if (outcome='closed' and (e->>'kind' is distinct from 'invoice_voided'
      or e->'subscriptionCanceled' is distinct from 'true'::jsonb or e->'obligationsCleared' is distinct from 'true'::jsonb))
    or (outcome='payment_won' and e->>'kind' is distinct from 'paid') then
    raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
  s:=private.billing_check_live_renewal_closeout_fence_v1(p_project_ref,p_stripe_account,p_request);
  if s<>'valid' then return jsonb_build_object('status',s); end if;
  select * into o from public.billing_renewal_closeouts where id=(p_request->>'operation_id')::uuid;
  if o.scheduled_operation_id is not null then
    select * into strict v_change from private.billing_scheduled_plan_changes where id=o.scheduled_operation_id;
    if not v_has_schedule or (p_request->>'scheduled_operation_id')::uuid is distinct from v_change.id
      or p_request->>'provider_schedule_id' is distinct from v_change.provider_schedule_id then
      return jsonb_build_object('status','plan_conflict'); end if;
    if outcome='payment_won' and end_at is distinct from
      private.billing_scheduled_term_end_v1(v_change.effective_at,v_change.target_offering_version_id) then
      raise exception using errcode='22023',message='billing_scheduled_closeout_term_invalid'; end if;
  elsif v_has_schedule then
    return jsonb_build_object('status','plan_conflict');
  end if;
  if (e ? 'invoiceId' and e->>'invoiceId'<>o.invoice_id)
    or (outcome='payment_won' and start_at<>o.paid_through) then
    raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
  if outcome in ('closed','payment_won') then
    finish_request:=jsonb_build_object('subscription_id',o.subscription_id,'lease_token',p_request->>'lease_token',
      'fencing_token',p_request->'fencing_token','expected_subscription_revision',p_request->'subscription_revision',
      'expected_account_plan_revision',p_request->'expected_account_plan_revision',
      'outcome',case when outcome='payment_won' then 'paid' else 'canceled' end,
      'provider_status',case when outcome='payment_won' then e->>'providerStatus' else 'canceled' end,
      'cancel_at_period_end',case when outcome='payment_won' then (e->>'cancelAtPeriodEnd')::boolean else false end,
      'obligations_cleared',case when outcome='payment_won' then (e->>'terminalObligationsCleared')::boolean else true end,
      'invoice_id',case when outcome='payment_won' then o.invoice_id else null end,
      'period_start',start_at,'period_end',end_at);
    begin
      -- Only this fenced operation is removed from arbitration, and only within
      -- the same subtransaction as the corresponding lifecycle result.
      if v_change.id is not null and outcome='payment_won' then
        update public.billing_renewal_closeouts set status=outcome,stage=outcome,revision=revision+1,
          next_attempt_at=null,reason=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=o.id;
        r:=private.billing_finish_live_lifecycle_core_v1(p_project_ref,p_stripe_account,finish_request,jsonb_build_object(
          'operation_id',v_change.id,'provider_schedule_id',v_change.provider_schedule_id,
          'target_offering_version_id',v_change.target_offering_version_id));
      else
        if v_change.id is not null then
          update private.billing_scheduled_plan_changes set state='closed_unpaid' where id=v_change.id;
        end if;
        r:=public.billing_finish_live_lifecycle_v1(p_project_ref,p_stripe_account,finish_request);
      end if;
      if coalesce(r->>'status','') not in ('applied','replayed') then
        raise exception using errcode='P3241',message='billing_closeout_lifecycle_rejected'; end if;
      if v_change.id is null or outcome='closed' then
        update public.billing_renewal_closeouts set status=outcome,stage=outcome,revision=revision+1,
          next_attempt_at=null,reason=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=o.id;
      end if;
    exception when sqlstate 'P3241' then
      -- Undo provisional terminal states even for a structured lease conflict.
      if r->>'status' in ('lost_claim','plan_conflict') then return jsonb_build_object('status',r->>'status'); end if;
      raise exception using errcode='55000',message='billing_closeout_lifecycle_rejected';
    end;
  else
    -- Match the foundation's five-failure budget. Process death without a
    -- completion is recovered through the lease and does not consume a failure.
    if outcome='deferred' and o.attempt_count>=4 then outcome:='attention'; end if;
    update public.billing_renewal_closeouts set status=case when outcome='attention' then 'attention' else 'retry' end,
      reason=p_request->>'reason',attempt_count=least(attempt_count+1,5),revision=revision+1,
      next_attempt_at=case when outcome='attention' then null else clock_timestamp()+interval '1 minute' end,
      updated_at=clock_timestamp() where id=o.id;
    update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,
      revision=revision+1,next_reconcile_at=null,updated_at=clock_timestamp() where id=o.subscription_id;
  end if;
  return jsonb_build_object('status',outcome);
end; $$;

revoke all on function private.billing_live_closeout_schedule_candidate_v1(uuid,text),
  private.billing_live_renewal_closeout_claim_json_v1(text,text,uuid)
  from public,anon,authenticated,service_role;

commit;
