-- SUB-11: durable, test-only failed-renewal closeout. Does not enable billing.
-- Access expiry is applied separately before a closeout can claim its binding.
create table public.billing_renewal_closeouts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.stripe_billing_subscription_bindings(id) on delete restrict,
  invoice_id text not null check (invoice_id ~ '^in_[A-Za-z0-9]{1,252}$'),
  paid_through timestamptz not null,
  cutoff timestamptz not null check (cutoff=paid_through+interval '168 hours'),
  expected_account_plan_revision bigint not null check (expected_account_plan_revision>0),
  expected_access_revision bigint not null check (expected_access_revision>0),
  expected_entitlement_revision bigint not null check (expected_entitlement_revision>0),
  stage text not null default 'queued' check (stage in ('queued','pause_requested','collection_paused','void_requested','invoice_voided','cancel_requested','closed','payment_won','superseded')),
  -- Status is independent of stage: a timeout never erases a durable write intent.
  status text not null default 'queued' check (status in ('queued','retry','attention','closed','payment_won','superseded')),
  revision bigint not null default 1 check (revision>0),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz default clock_timestamp(),
  reason text check (reason is null or reason ~ '^[a-z][a-z0-9._-]{0,99}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(subscription_id,invoice_id),
  check ((status in ('closed','payment_won','superseded'))=(completed_at is not null))
);
create unique index billing_renewal_closeouts_active_subscription
  on public.billing_renewal_closeouts(subscription_id) where status in ('queued','retry','attention');
create index billing_renewal_closeouts_due on public.billing_renewal_closeouts(next_attempt_at,id)
  where status in ('queued','retry');
alter table public.billing_renewal_closeouts enable row level security;
revoke all on table public.billing_renewal_closeouts from public,anon,authenticated,service_role;
grant select on table public.billing_renewal_closeouts to service_role;

create function private.billing_validate_renewal_closeout_request_v1(p_request jsonb,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare k text; allowed text[]; required_uuid text[]; required_number text[];
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' then
    raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  if p_kind='list' then
    allowed:=array['limit']; required_uuid:=array[]::text[]; required_number:=array['limit'];
  elsif p_kind='claim' then
    allowed:=array['subscription_id','lease_seconds']; required_uuid:=array['subscription_id']; required_number:=array['lease_seconds'];
  else
    allowed:=array['operation_id','subscription_id','lease_token','fencing_token','subscription_revision','expected_account_plan_revision','operation_revision'];
    required_uuid:=array['operation_id','subscription_id','lease_token'];
    required_number:=array['fencing_token','subscription_revision','expected_account_plan_revision','operation_revision'];
    if p_kind='checkpoint' then allowed:=allowed||array['stage'];
    elsif p_kind='finish' then allowed:=allowed||array['outcome','reason','evidence'];
    else raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  end if;
  if p_request-allowed<>'{}'::jsonb then raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  foreach k in array required_uuid loop
    if jsonb_typeof(p_request->k) is distinct from 'string'
      or coalesce(p_request->>k,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  end loop;
  foreach k in array required_number loop
    if jsonb_typeof(p_request->k) is distinct from 'number' or coalesce(p_request->>k,'') !~ '^[1-9][0-9]{0,14}$' then
      raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
  end loop;
  if (p_kind='list' and (p_request->>'limit')::bigint<>1)
    or (p_kind='claim' and (p_request->>'lease_seconds')::bigint not between 30 and 300)
    or (p_kind='checkpoint' and coalesce(p_request->>'stage','') not in ('pause_requested','collection_paused','void_requested','invoice_voided','cancel_requested'))
    or (p_kind='finish' and (coalesce(p_request->>'outcome','') not in ('closed','payment_won','deferred','attention')
      or (p_request ? 'reason' and (jsonb_typeof(p_request->'reason') is distinct from 'string'
        or coalesce(p_request->>'reason','') !~ '^[a-z][a-z0-9._-]{0,99}$')))) then
    raise exception using errcode='22023',message='billing_closeout_request_invalid'; end if;
end; $$;

create function private.billing_renewal_closeout_claim_json_v1(p_operation uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('status','claimed','operation_id',o.id,'subscription_id',b.id,
    'lease_token',b.lease_token,'fencing_token',b.fencing_token,'lease_expires_at',b.lease_expires_at,
    'subscription_revision',b.revision,'expected_account_plan_revision',o.expected_account_plan_revision,
    'operation_revision',o.revision,'stage',o.stage,'invoice_id',o.invoice_id,'paid_through',o.paid_through,'cutoff',o.cutoff,
    'binding',jsonb_build_object('subscription_id',b.id,'subject_user_id',b.subject_user_id,
      'stripe_account',b.stripe_account,'stripe_customer_id',b.stripe_customer_id,'stripe_subscription_id',b.stripe_subscription_id,
      'offering_id',v.offering_id,'offering_version_id',v.id,'stripe_product_id',v.stripe_product_id,'stripe_price_id',v.stripe_price_id,
      'unit_amount',v.unit_amount,'plan_key',f.plan_key,'currency',v.currency,'interval',v.interval,'provider_mode',b.provider_mode))
  from public.billing_renewal_closeouts o join public.stripe_billing_subscription_bindings b on b.id=o.subscription_id
  join public.stripe_billing_offering_versions v on v.id=b.offering_version_id
  join public.stripe_billing_offerings f on f.id=v.offering_id where o.id=p_operation;
$$;

-- Called only after envelope validation. Locks are retained by the outer RPC.
create function private.billing_check_renewal_closeout_fence_v1(p_request jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; o public.billing_renewal_closeouts%rowtype;
begin
  select * into b from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid for update;
  if not found then return 'lost_claim'; end if;
  if b.lease_token is null or b.lease_expires_at is null or b.lease_token is distinct from (p_request->>'lease_token')::uuid
    or b.lease_expires_at<=clock_timestamp() or b.fencing_token<>(p_request->>'fencing_token')::bigint
    or b.revision<>(p_request->>'subscription_revision')::bigint then return 'lost_claim'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  select * into o from public.billing_renewal_closeouts where id=(p_request->>'operation_id')::uuid for update;
  if not found or o.subscription_id<>b.id or o.revision<>(p_request->>'operation_revision')::bigint
    or o.status not in ('queued','retry') then return 'lost_claim'; end if;
  -- A waiter may have consumed its lease while acquiring the plan/access locks.
  if b.lease_expires_at<=clock_timestamp() then return 'lost_claim'; end if;
  if not b.is_current or b.provider_mode<>'test' or a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
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
  return 'valid';
end; $$;

create function public.billing_list_renewal_closeouts_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_renewal_closeout_request_v1(p_request,'list');
  select coalesce(jsonb_agg(jsonb_build_object('subscription_id',due.id)),'[]'::jsonb) into r from (
    select b.id from public.stripe_billing_subscription_bindings b
    join public.billing_account_access a on a.subscription_id=b.id and a.subject_user_id=b.subject_user_id
    join public.account_plans p on p.subject_user_id=b.subject_user_id
    join public.effective_feature_entitlements e on e.subject_user_id=b.subject_user_id and e.feature_key='classrooms.create'
    left join public.billing_renewal_closeouts o on o.subscription_id=b.id and o.invoice_id=a.failed_renewal_invoice_id
    where b.is_current and b.provider_mode='test' and a.source='paid' and a.end_reason='renewal_grace'
      and a.access_ends_at<=clock_timestamp() and a.expiry_applied_at is not null
      and p.management_source='billing' and p.plan_key='free' and a.account_plan_revision=p.revision and a.entitlement_revision=e.revision
      and (o.id is null or (o.expected_account_plan_revision=p.revision and o.expected_access_revision=a.revision
        and o.expected_entitlement_revision=e.revision))
      and (b.lease_expires_at is null or b.lease_expires_at<=clock_timestamp())
      and (o.id is null or (o.status in ('queued','retry') and o.next_attempt_at<=clock_timestamp()))
    order by coalesce(o.next_attempt_at,a.access_ends_at),b.id limit 1
  ) due;
  return jsonb_build_object('items',r);
end; $$;

create function public.billing_claim_renewal_closeout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; o public.billing_renewal_closeouts%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_renewal_closeout_request_v1(p_request,'claim');
  select * into b from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid for update;
  if not found or not b.is_current then return jsonb_build_object('status','not_found'); end if;
  if b.lease_expires_at>clock_timestamp() then return jsonb_build_object('status','busy'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  if b.provider_mode<>'test' or a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
    or a.end_reason is distinct from 'renewal_grace' or a.failed_renewal_invoice_id is null
    or a.access_ends_at is distinct from a.paid_through+interval '168 hours'
    or a.access_ends_at>clock_timestamp() or a.expiry_applied_at is null then
    return jsonb_build_object('status','superseded'); end if;
  if p.plan_key is distinct from 'free' or p.management_source is distinct from 'billing'
    or a.account_plan_revision is distinct from p.revision or a.entitlement_revision is null
    or a.entitlement_revision is distinct from (select revision from public.effective_feature_entitlements
      where subject_user_id=b.subject_user_id and feature_key='classrooms.create') then
    return jsonb_build_object('status','plan_conflict'); end if;
  select * into o from public.billing_renewal_closeouts where subscription_id=b.id
    and (invoice_id=a.failed_renewal_invoice_id or status in ('queued','retry','attention'))
    order by (invoice_id=a.failed_renewal_invoice_id) desc limit 1 for update;
  if o.id is not null then
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
      expected_account_plan_revision,expected_access_revision,expected_entitlement_revision)
      values(b.id,a.failed_renewal_invoice_id,a.paid_through,a.access_ends_at,p.revision,a.revision,a.entitlement_revision) returning * into o;
  end if;
  update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>(p_request->>'lease_seconds')::integer),
    fencing_token=fencing_token+1,revision=revision+1,updated_at=clock_timestamp() where id=b.id;
  update public.billing_renewal_closeouts set status='queued',revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  return private.billing_renewal_closeout_claim_json_v1(o.id);
end; $$;

create function public.billing_checkpoint_renewal_closeout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; previous_stage text;
  stages text[]:=array['queued','pause_requested','collection_paused','void_requested','invoice_voided','cancel_requested'];
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_renewal_closeout_request_v1(p_request,'checkpoint');
  s:=private.billing_check_renewal_closeout_fence_v1(p_request);
  if s<>'valid' then return jsonb_build_object('status',s); end if;
  select stage into previous_stage from public.billing_renewal_closeouts where id=(p_request->>'operation_id')::uuid;
  -- Recovery may skip an already observed successful write, never move backward.
  if array_position(stages,p_request->>'stage')<array_position(stages,previous_stage) then
    raise exception using errcode='22023',message='billing_closeout_stage_invalid'; end if;
  update public.billing_renewal_closeouts set stage=p_request->>'stage',revision=revision+1,updated_at=clock_timestamp()
    where id=(p_request->>'operation_id')::uuid;
  return private.billing_renewal_closeout_claim_json_v1((p_request->>'operation_id')::uuid);
end; $$;

create function public.billing_finish_renewal_closeout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; o public.billing_renewal_closeouts%rowtype; e jsonb:=p_request->'evidence';
  outcome text:=p_request->>'outcome'; r jsonb; finish_request jsonb; start_at timestamptz; end_at timestamptz;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_renewal_closeout_request_v1(p_request,'finish');
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
  s:=private.billing_check_renewal_closeout_fence_v1(p_request);
  if s<>'valid' then return jsonb_build_object('status',s); end if;
  select * into o from public.billing_renewal_closeouts where id=(p_request->>'operation_id')::uuid;
  if (e ? 'invoiceId' and e->>'invoiceId'<>o.invoice_id)
    or (outcome='payment_won' and start_at<>o.paid_through) then
    raise exception using errcode='22023',message='billing_closeout_evidence_invalid'; end if;
  if outcome in ('closed','payment_won') then
    finish_request:=jsonb_build_object('subscription_id',o.subscription_id,'lease_token',p_request->>'lease_token',
      'fencing_token',p_request->'fencing_token','expected_subscription_revision',p_request->'subscription_revision',
      'expected_account_plan_revision',p_request->'expected_account_plan_revision',
      'outcome',case when outcome='payment_won' then 'paid' else 'observed' end,
      'provider_status',case when outcome='payment_won' then e->>'providerStatus' else 'canceled' end,
      'cancel_at_period_end',case when outcome='payment_won' then (e->>'cancelAtPeriodEnd')::boolean else false end,
      'obligations_cleared',case when outcome='payment_won' then (e->>'terminalObligationsCleared')::boolean else true end,
      'invoice_id',case when outcome='payment_won' then o.invoice_id else null end,
      'period_start',start_at,'period_end',end_at);
    r:=public.billing_finish_lifecycle_v1(finish_request);
    if r->>'status' not in ('applied','replayed') then
      -- A normal rejection cannot commit a partially finished operation.
      if r->>'status' in ('lost_claim','plan_conflict') then return jsonb_build_object('status',r->>'status'); end if;
      raise exception using errcode='55000',message='billing_closeout_lifecycle_rejected'; end if;
    update public.billing_renewal_closeouts set status=outcome,stage=outcome,revision=revision+1,
      next_attempt_at=null,reason=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=o.id;
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

-- An ordinary lifecycle read cannot interpret our intermediate voided invoice.
-- Preserve the original claim implementation and refuse general claims while a
-- closeout owns recovery (including attention). The same binding lock/lease
-- orders this wrapper against closeout claims; stale pre-closeout workers fail
-- the existing revision/fencing checks. Terminal closeouts release this guard.
alter function public.billing_claim_subscription_v1(jsonb) set schema private;
alter function private.billing_claim_subscription_v1(jsonb) rename to billing_claim_subscription_before_closeout_v1;
create function public.billing_claim_subscription_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  -- Leave original malformed-request handling intact, including legacy numeric strings.
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_request->>'subscription_id' is null
    or coalesce(p_request->>'lease_seconds','') !~ '^[0-9]+$' then
    return private.billing_claim_subscription_before_closeout_v1(p_request); end if;
  if (p_request->>'lease_seconds')::numeric not between 30 and 300 then
    return private.billing_claim_subscription_before_closeout_v1(p_request); end if;
  perform 1 from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid for update;
  if exists(select 1 from public.billing_renewal_closeouts where subscription_id=(p_request->>'subscription_id')::uuid
    and status in ('queued','retry','attention')) then return jsonb_build_object('status','busy'); end if;
  return private.billing_claim_subscription_before_closeout_v1(p_request);
end; $$;

revoke all on function private.billing_validate_renewal_closeout_request_v1(jsonb,text),
  private.billing_renewal_closeout_claim_json_v1(uuid),private.billing_check_renewal_closeout_fence_v1(jsonb),
  private.billing_claim_subscription_before_closeout_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.billing_list_renewal_closeouts_v1(jsonb),public.billing_claim_renewal_closeout_v1(jsonb),
  public.billing_checkpoint_renewal_closeout_v1(jsonb),public.billing_finish_renewal_closeout_v1(jsonb),
  public.billing_claim_subscription_v1(jsonb) from public,anon,authenticated;
grant execute on function public.billing_list_renewal_closeouts_v1(jsonb),public.billing_claim_renewal_closeout_v1(jsonb),
  public.billing_checkpoint_renewal_closeout_v1(jsonb),public.billing_finish_renewal_closeout_v1(jsonb),
  public.billing_claim_subscription_v1(jsonb) to service_role;
