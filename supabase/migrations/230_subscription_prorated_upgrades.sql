-- SUB-03/04/07: durable frozen-invoice upgrades. Test mode only; billing stays OFF.
create table public.billing_upgrade_operations (
  id uuid primary key,
  subject_user_id uuid not null references public.users(id) on delete restrict,
  subscription_id uuid not null references public.stripe_billing_subscription_bindings(id) on delete restrict,
  source_offering_version_id uuid not null references public.stripe_billing_offering_versions(id),
  target_offering_version_id uuid not null references public.stripe_billing_offering_versions(id),
  source_binding jsonb not null,
  target jsonb not null,
  paid_period_start timestamptz not null,
  paid_through timestamptz not null,
  last_paid_invoice_id text not null,
  expires_at timestamptz not null,
  expected_account_plan_revision bigint not null check(expected_account_plan_revision>0),
  expected_access_revision bigint not null check(expected_access_revision>0),
  expected_entitlement_revision bigint not null check(expected_entitlement_revision>0),
  stage text not null default 'reserved' check(stage in ('reserved','preview_verified','invoice_requested','invoice_created',
    'finalize_requested','quoted','payment_requested','payment_verified','change_requested','applied','void_requested','expired')),
  status text not null default 'queued' check(status in ('queued','retry','attention','applied','expired')),
  revision bigint not null default 1 check(revision>0),
  quote jsonb,
  quote_digest text check(quote_digest ~ '^[a-f0-9]{64}$'),
  quote_revision bigint check(quote_revision>0),
  invoice_id text check(invoice_id ~ '^in_[A-Za-z0-9]{1,252}$'),
  payment_intent_id text check(payment_intent_id ~ '^pi_[A-Za-z0-9]{1,252}$'),
  confirmed boolean not null default false,
  attempt_count integer not null default 0 check(attempt_count between 0 and 5),
  next_attempt_at timestamptz default clock_timestamp(),
  reason text check(reason ~ '^[a-z][a-z0-9._-]{0,99}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check(paid_through>paid_period_start and expires_at<=paid_through),
  check((quote is null)=(quote_digest is null) and (quote is null)=(quote_revision is null)),
  check(not confirmed or (quote is not null and invoice_id is not null)),
  check((status in ('applied','expired'))=(completed_at is not null))
);
create unique index billing_upgrade_active_binding on public.billing_upgrade_operations(subscription_id)
  where status in ('queued','retry','attention');
create unique index billing_upgrade_invoice_identity on public.billing_upgrade_operations((source_binding->>'stripe_account'),invoice_id)
  where invoice_id is not null;
create index billing_upgrade_due on public.billing_upgrade_operations(next_attempt_at,id) where status in ('queued','retry');
create table public.billing_upgrade_receipts (
  operation_id uuid primary key references public.billing_upgrade_operations(id),
  subscription_id uuid not null references public.stripe_billing_subscription_bindings(id),
  source_offering_version_id uuid not null references public.stripe_billing_offering_versions(id),
  target_offering_version_id uuid not null references public.stripe_billing_offering_versions(id),
  stripe_account text not null,
  invoice_id text not null,
  payment_intent_id text not null,
  amount_paid bigint not null check(amount_paid>0),
  currency text not null,
  paid_period_start timestamptz not null,
  paid_through timestamptz not null,
  account_plan_revision bigint not null,
  evidence jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(stripe_account,invoice_id)
);
create trigger billing_upgrade_receipts_immutable before update or delete on public.billing_upgrade_receipts
  for each row execute function public.guard_stripe_billing_immutable_v1();
alter table public.billing_upgrade_operations enable row level security;
alter table public.billing_upgrade_receipts enable row level security;
revoke all on public.billing_upgrade_operations,public.billing_upgrade_receipts from public,anon,authenticated,service_role;
grant select on public.billing_upgrade_operations,public.billing_upgrade_receipts to service_role;

create function private.billing_validate_upgrade_request_v1(p_request jsonb,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare allowed text[]; uuids text[]:=array[]::text[]; nums text[]:=array[]::text[]; k text;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' then
    raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  case p_kind
    when 'reserve' then uuids:=array['subject_user_id','operation_id','offering_version_id']; allowed:=uuids;
    when 'get' then uuids:=array['subject_user_id','operation_id']; allowed:=uuids;
    when 'applied' then uuids:=array['subscription_id']; allowed:=uuids;
    when 'claim' then uuids:=array['operation_id']; nums:=array['lease_seconds']; allowed:=uuids||nums;
    when 'list' then nums:=array['limit']; allowed:=nums;
    when 'confirm' then uuids:=array['subject_user_id','operation_id']; nums:=array['quote_revision']; allowed:=uuids||nums||array['quote_digest'];
    else
      uuids:=array['operation_id','subscription_id','lease_token'];
      nums:=array['fencing_token','subscription_revision','expected_account_plan_revision','expected_access_revision','expected_entitlement_revision','operation_revision'];
      allowed:=uuids||nums;
      if p_kind='checkpoint' then allowed:=allowed||array['stage','quote','quote_digest','invoice_id','payment_intent_id'];
      elsif p_kind='finish' then allowed:=allowed||array['outcome','reason','evidence'];
      else raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  end case;
  if p_request-allowed<>'{}' then raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  foreach k in array uuids loop
    if jsonb_typeof(p_request->k) is distinct from 'string' or coalesce(p_request->>k,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  end loop;
  foreach k in array nums loop
    if jsonb_typeof(p_request->k) is distinct from 'number' or coalesce(p_request->>k,'') !~ '^[1-9][0-9]{0,14}$' then
      raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  end loop;
  if (p_kind='list' and (p_request->>'limit')::bigint<>1)
    or (p_kind='claim' and (p_request->>'lease_seconds')::bigint not between 30 and 300)
    or (p_kind='checkpoint' and coalesce(p_request->>'stage','') not in ('preview_verified','invoice_requested','invoice_created','finalize_requested','quoted','payment_requested','payment_verified','change_requested','void_requested'))
    or (p_kind='finish' and coalesce(p_request->>'outcome','') not in ('applied','deferred','awaiting_confirmation','payment_pending','attention','expired')) then
    raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  if (p_kind='confirm' or p_request ? 'quote_digest') and
    (jsonb_typeof(p_request->'quote_digest') is distinct from 'string' or coalesce(p_request->>'quote_digest','') !~ '^[a-f0-9]{64}$') then
    raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  foreach k in array array['invoice_id','payment_intent_id','reason'] loop
    if p_request ? k and (jsonb_typeof(p_request->k) is distinct from 'string' or coalesce(p_request->>k,'') !~
      case k when 'invoice_id' then '^in_[A-Za-z0-9]{1,252}$' when 'payment_intent_id' then '^pi_[A-Za-z0-9]{1,252}$' else '^[a-z][a-z0-9._-]{0,99}$' end) then
      raise exception using errcode='22023',message='billing_upgrade_request_invalid'; end if;
  end loop;
end; $$;

create function private.billing_upgrade_json_v1(p_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('operation_id',id,'subject_user_id',subject_user_id,'subscription_id',subscription_id,
    'source_binding',source_binding,'target',target,'stage',stage,'status',status,'revision',revision,
    'paid_period_start',paid_period_start,'paid_through',paid_through,'last_paid_invoice_id',last_paid_invoice_id,
    'expires_at',expires_at,'quote',quote,'quote_digest',quote_digest,'quote_revision',quote_revision,
    'invoice_id',invoice_id,'payment_intent_id',payment_intent_id,'confirmed',confirmed)
  from public.billing_upgrade_operations where id=p_id;
$$;
create function private.billing_upgrade_claim_json_v1(p_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('status','claimed','operation',private.billing_upgrade_json_v1(o.id),
    'lease_token',b.lease_token,'fencing_token',b.fencing_token,'lease_expires_at',b.lease_expires_at,
    'subscription_revision',b.revision,'expected_account_plan_revision',o.expected_account_plan_revision,
    'expected_access_revision',o.expected_access_revision,'expected_entitlement_revision',o.expected_entitlement_revision)
  from public.billing_upgrade_operations o join public.stripe_billing_subscription_bindings b on b.id=o.subscription_id where o.id=p_id;
$$;

-- Binding -> subject advisory/plan -> access -> operation. Never refresh saved
-- revisions after a manual override. The final check follows all lock waits.
create function private.billing_check_upgrade_state_v1(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare o public.billing_upgrade_operations%rowtype; b public.stripe_billing_subscription_bindings%rowtype;
  p public.account_plans%rowtype; a public.billing_account_access%rowtype;
begin
  select * into o from public.billing_upgrade_operations where id=p_id;
  if not found then return 'not_found'; end if;
  select * into b from public.stripe_billing_subscription_bindings where id=o.subscription_id for update;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  select * into o from public.billing_upgrade_operations where id=p_id for update;
  if not b.is_current or b.provider_mode<>'test' or b.offering_version_id<>o.source_offering_version_id
    or a.source is distinct from 'paid' or a.subscription_id is distinct from b.id or a.offering_version_id is distinct from o.source_offering_version_id
    or a.end_reason is distinct from 'renewal_pending' or a.failed_renewal_invoice_id is not null or a.expiry_applied_at is not null
    or a.paid_period_start is distinct from o.paid_period_start or a.paid_through is distinct from o.paid_through
    or a.last_paid_invoice_id is distinct from o.last_paid_invoice_id or a.access_ends_at is distinct from o.paid_through
    or p.management_source is distinct from 'billing' or p.billing_offering_version_id is distinct from o.source_offering_version_id
    or p.revision is distinct from o.expected_account_plan_revision or a.account_plan_revision is distinct from p.revision
    or a.revision is distinct from o.expected_access_revision or a.entitlement_revision is distinct from o.expected_entitlement_revision
    or o.expected_entitlement_revision is distinct from (select revision from public.effective_feature_entitlements
      where subject_user_id=b.subject_user_id and feature_key='classrooms.create')
    or exists(select 1 from public.billing_renewal_closeouts where subscription_id=b.id and status in ('queued','retry','attention')) then
    return 'plan_conflict'; end if;
  return 'valid';
end; $$;
create function private.billing_check_upgrade_fence_v1(p_request jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare s text; b public.stripe_billing_subscription_bindings%rowtype; o public.billing_upgrade_operations%rowtype;
begin
  s:=private.billing_check_upgrade_state_v1((p_request->>'operation_id')::uuid);
  if s='not_found' then return 'lost_claim'; end if;
  select * into o from public.billing_upgrade_operations where id=(p_request->>'operation_id')::uuid;
  select * into b from public.stripe_billing_subscription_bindings where id=o.subscription_id;
  if o.subscription_id<>(p_request->>'subscription_id')::uuid or o.revision<>(p_request->>'operation_revision')::bigint
    or o.status not in ('queued','retry') or b.lease_token is null or b.lease_expires_at<=clock_timestamp()
    or b.lease_token is distinct from (p_request->>'lease_token')::uuid or b.fencing_token<>(p_request->>'fencing_token')::bigint
    or b.revision<>(p_request->>'subscription_revision')::bigint then return 'lost_claim'; end if;
  if o.expected_account_plan_revision<>(p_request->>'expected_account_plan_revision')::bigint
    or o.expected_access_revision<>(p_request->>'expected_access_revision')::bigint
    or o.expected_entitlement_revision<>(p_request->>'expected_entitlement_revision')::bigint then return 'plan_conflict'; end if;
  return s;
end; $$;

create function public.billing_reserve_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype; a public.billing_account_access%rowtype;
  o public.billing_upgrade_operations%rowtype; v public.stripe_billing_offering_versions%rowtype; target jsonb; source jsonb; target_plan text; source_plan text;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_upgrade_request_v1(p_request,'reserve');
  select * into b from public.stripe_billing_subscription_bindings where subject_user_id=(p_request->>'subject_user_id')::uuid and is_current for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  select * into o from public.billing_upgrade_operations where id=(p_request->>'operation_id')::uuid for update;
  if found then
    if o.subject_user_id<>b.subject_user_id or o.subscription_id<>b.id or o.target_offering_version_id<>(p_request->>'offering_version_id')::uuid then
      return jsonb_build_object('status','plan_conflict'); end if;
    return jsonb_build_object('status','existing','operation',private.billing_upgrade_json_v1(o.id)); end if;
  if b.lease_expires_at>clock_timestamp() or exists(select 1 from public.billing_upgrade_operations where subscription_id=b.id and status in ('queued','retry','attention'))
    or exists(select 1 from public.billing_renewal_closeouts where subscription_id=b.id and status in ('queued','retry','attention')) then return jsonb_build_object('status','busy'); end if;
  if b.provider_mode<>'test' or a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
    or a.offering_version_id is distinct from b.offering_version_id or a.end_reason is distinct from 'renewal_pending'
    or a.failed_renewal_invoice_id is not null or a.expiry_applied_at is not null or a.paid_through<=clock_timestamp()
    or a.access_ends_at is distinct from a.paid_through or a.paid_period_start>clock_timestamp()
    or p.management_source is distinct from 'billing' or p.billing_offering_version_id is distinct from b.offering_version_id
    or a.account_plan_revision is distinct from p.revision or a.entitlement_revision is null
    or a.entitlement_revision is distinct from (select revision from public.effective_feature_entitlements where subject_user_id=b.subject_user_id and feature_key='classrooms.create') then
    return jsonb_build_object('status','plan_conflict'); end if;
  select * into v from public.stripe_billing_offering_versions where id=b.offering_version_id;
  select plan_key into source_plan from public.stripe_billing_offerings where id=v.offering_id;
  source:=jsonb_build_object('subscription_id',b.id,'subject_user_id',b.subject_user_id,'stripe_account',b.stripe_account,
    'stripe_customer_id',b.stripe_customer_id,'stripe_subscription_id',b.stripe_subscription_id,'offering_id',v.offering_id,
    'offering_version_id',v.id,'stripe_product_id',v.stripe_product_id,'stripe_price_id',v.stripe_price_id,'unit_amount',v.unit_amount,
    'plan_key',source_plan,'currency',v.currency,'interval',v.interval,'provider_mode',b.provider_mode);
  target:=public.billing_get_checkout_offering_v1(jsonb_build_object('offering_version_id',p_request->>'offering_version_id','stripe_account',b.stripe_account));
  target_plan:=target->>'plan_key';
  if target is null or v.unit_amount<=0 or v.currency not in ('usd','cad') or target->>'currency'<>v.currency or target->>'interval'<>v.interval
    or array_position(array['basic','plus','pro'],target_plan)<=array_position(array['basic','plus','pro'],source_plan)
    or (target->>'unit_amount')::bigint<=v.unit_amount then return jsonb_build_object('status','plan_conflict'); end if;
  -- Current implementation gate: a full-cycle payment must anchor this exact
  -- version. Repeat same-period upgrades require receipt-chain reconciliation
  -- before launch; this is not a one-upgrade-per-period commercial policy.
  if not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=b.id and stripe_invoice_id=a.last_paid_invoice_id
      and offering_version_id=b.offering_version_id and period_start=a.paid_period_start and period_end=a.paid_through) then return jsonb_build_object('status','plan_conflict'); end if;
  insert into public.billing_upgrade_operations(id,subject_user_id,subscription_id,source_offering_version_id,target_offering_version_id,
    source_binding,target,paid_period_start,paid_through,last_paid_invoice_id,expires_at,expected_account_plan_revision,expected_access_revision,expected_entitlement_revision)
    values((p_request->>'operation_id')::uuid,b.subject_user_id,b.id,b.offering_version_id,(p_request->>'offering_version_id')::uuid,
      source,target,a.paid_period_start,a.paid_through,a.last_paid_invoice_id,least(clock_timestamp()+interval '15 minutes',a.paid_through),p.revision,a.revision,a.entitlement_revision);
  return jsonb_build_object('status','reserved','operation',private.billing_upgrade_json_v1((p_request->>'operation_id')::uuid));
end; $$;

create function public.billing_get_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'get');
  select private.billing_upgrade_json_v1(id) into o from public.billing_upgrade_operations
    where id=(p_request->>'operation_id')::uuid and subject_user_id=(p_request->>'subject_user_id')::uuid;
  return case when o is null then jsonb_build_object('status','not_found') else jsonb_build_object('status','found','operation',o) end;
end; $$;
create function public.billing_get_applied_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'applied');
  select private.billing_upgrade_json_v1(id) into o from public.billing_upgrade_operations where subscription_id=(p_request->>'subscription_id')::uuid
    and status='applied' order by completed_at desc,id desc limit 1;
  return jsonb_build_object('operation',o);
end; $$;
create function public.billing_claim_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; o public.billing_upgrade_operations%rowtype; b public.stripe_billing_subscription_bindings%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'claim');
  s:=private.billing_check_upgrade_state_v1((p_request->>'operation_id')::uuid);
  if s<>'valid' then return jsonb_build_object('status',s); end if;
  select * into o from public.billing_upgrade_operations where id=(p_request->>'operation_id')::uuid;
  select * into b from public.stripe_billing_subscription_bindings where id=o.subscription_id;
  if o.status not in ('queued','retry') or o.next_attempt_at>clock_timestamp() or b.lease_expires_at>clock_timestamp()
    or (o.stage='quoted' and not o.confirmed and o.expires_at>clock_timestamp()) then return jsonb_build_object('status','busy'); end if;
  update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>(p_request->>'lease_seconds')::integer),
    fencing_token=fencing_token+1,revision=revision+1,updated_at=clock_timestamp() where id=b.id;
  update public.billing_upgrade_operations set status='queued',revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  return private.billing_upgrade_claim_json_v1(o.id);
end; $$;
create function public.billing_list_upgrades_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'list');
  select coalesce(jsonb_agg(jsonb_build_object('operation_id',id)),'[]'::jsonb) into r from (
    select o.id from public.billing_upgrade_operations o
    join public.stripe_billing_subscription_bindings b on b.id=o.subscription_id
    join public.billing_account_access a on a.subject_user_id=o.subject_user_id and a.subscription_id=b.id
    join public.account_plans p on p.subject_user_id=o.subject_user_id
    join public.effective_feature_entitlements e on e.subject_user_id=o.subject_user_id and e.feature_key='classrooms.create'
    where o.status in ('queued','retry') and o.next_attempt_at<=clock_timestamp() and b.is_current
      and (b.lease_expires_at is null or b.lease_expires_at<=clock_timestamp())
      and (o.stage<>'quoted' or o.confirmed or o.expires_at<=clock_timestamp())
      and p.management_source='billing' and p.revision=o.expected_account_plan_revision
      and a.revision=o.expected_access_revision and a.account_plan_revision=p.revision
      and e.revision=o.expected_entitlement_revision and a.entitlement_revision=e.revision
      and a.end_reason='renewal_pending' and a.failed_renewal_invoice_id is null
      and b.offering_version_id=o.source_offering_version_id and a.offering_version_id=o.source_offering_version_id
      and a.paid_period_start=o.paid_period_start and a.paid_through=o.paid_through
      and not exists(select 1 from public.billing_renewal_closeouts c where c.subscription_id=b.id and c.status in ('queued','retry','attention'))
    order by o.next_attempt_at,o.id limit 1
  ) due;
  return jsonb_build_object('items',r);
end; $$;

-- All quote identities are exact stored terms. Money is trusted service evidence,
-- never browser input; every integer, timestamp and line is bounded here as well.
create function private.billing_validate_upgrade_quote_v1(q jsonb,o public.billing_upgrade_operations)
returns void language plpgsql security definer set search_path='' as $$
declare k text; l jsonb; credit bigint:=0; debit bigint:=0; credit_count integer:=0; debit_count integer:=0;
  quoted_at timestamptz; expires_at timestamptz; proration_at timestamptz;
begin
  if jsonb_typeof(q) is distinct from 'object' or q-array['binding','target','subscriptionItemId','prorationDate','quotedAt','paidPeriodStart','paidThrough',
    'expiresAt','unusedCreditAmount','remainingChargeAmount','amountDue','currency','nextRecurringAmount','lines','paymentState']<>'{}'
    or q->'binding' is distinct from o.source_binding or q->'target' is distinct from o.target
    or jsonb_typeof(q->'subscriptionItemId') is distinct from 'string' or coalesce(q->>'subscriptionItemId','') !~ '^si_[A-Za-z0-9]{1,252}$'
    or q->>'currency' is distinct from o.target->>'currency' or coalesce(q->>'paymentState','') not in ('payment_required','zero_due') then
    raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
  foreach k in array array['prorationDate','unusedCreditAmount','remainingChargeAmount','amountDue','nextRecurringAmount'] loop
    if jsonb_typeof(q->k) is distinct from 'number' or coalesce(q->>k,'') !~ '^-?(0|[1-9][0-9]{0,15})$'
      or abs((q->>k)::numeric)>9007199254740991 then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
  end loop;
  foreach k in array array['quotedAt','paidPeriodStart','paidThrough','expiresAt'] loop
    if jsonb_typeof(q->k) is distinct from 'string' or coalesce(q->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
    begin perform (q->>k)::timestamptz; exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end;
  end loop;
  quoted_at:=(q->>'quotedAt')::timestamptz; expires_at:=(q->>'expiresAt')::timestamptz;
  if (q->>'prorationDate')::bigint not between 0 and 8640000000000 then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
  proration_at:=to_timestamp((q->>'prorationDate')::bigint);
  if (q->>'paidPeriodStart')::timestamptz<>o.paid_period_start or (q->>'paidThrough')::timestamptz<>o.paid_through
    or quoted_at<date_trunc('second',o.created_at) or quoted_at>clock_timestamp()+interval '5 seconds'
    or quoted_at<o.paid_period_start or quoted_at>=o.paid_through
    or proration_at<>date_trunc('second',quoted_at) or expires_at<>least(quoted_at+interval '15 minutes',o.paid_through)
    or (q->>'unusedCreditAmount')::bigint>0 or (q->>'remainingChargeAmount')::bigint<0
    or (q->>'amountDue')::bigint<0 or (q->>'nextRecurringAmount')::bigint<>(o.target->>'unit_amount')::bigint
    or ((q->>'amountDue')::bigint=0)<>(q->>'paymentState'='zero_due')
    or jsonb_typeof(q->'lines') is distinct from 'array' then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
  if jsonb_array_length(q->'lines')<>2 then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
  for l in select value from jsonb_array_elements(q->'lines') loop
    if jsonb_typeof(l) is distinct from 'object' or l-array['kind','priceId','subscriptionItemId','amount','quantity','periodStart','periodEnd']<>'{}'
      or coalesce(l->>'kind','') not in ('old_credit','target_debit') or l->'quantity' is distinct from '1'::jsonb
      or l->>'subscriptionItemId' is distinct from q->>'subscriptionItemId'
      or jsonb_typeof(l->'amount') is distinct from 'number' or coalesce(l->>'amount','') !~ '^-?(0|[1-9][0-9]{0,15})$' then
      raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
    foreach k in array array['periodStart','periodEnd'] loop
      if jsonb_typeof(l->k) is distinct from 'string' or coalesce(l->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
      begin perform (l->>k)::timestamptz; exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end;
    end loop;
    if (l->>'periodStart')::timestamptz<>proration_at or (l->>'periodEnd')::timestamptz<>o.paid_through or abs((l->>'amount')::numeric)>9007199254740991 then
      raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
    if l->>'kind'='old_credit' then
      credit_count:=credit_count+1; credit:=(l->>'amount')::bigint;
      if credit>0 or l->>'priceId' is distinct from o.source_binding->>'stripe_price_id' then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
    else
      debit_count:=debit_count+1; debit:=(l->>'amount')::bigint;
      if debit<0 or l->>'priceId' is distinct from o.target->>'stripe_price_id' then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
    end if;
  end loop;
  if credit_count<>1 or debit_count<>1 or credit<>(q->>'unusedCreditAmount')::bigint or debit<>(q->>'remainingChargeAmount')::bigint
    or credit < -(o.source_binding->>'unit_amount')::bigint or debit>(o.target->>'unit_amount')::bigint
    or credit+debit<>(q->>'amountDue')::bigint
    or q#>>'{lines,0,kind}'<>'old_credit' or q#>>'{lines,1,kind}'<>'target_debit' then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
end; $$;

create function public.billing_checkpoint_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; o public.billing_upgrade_operations%rowtype; next_stage text:=p_request->>'stage'; new_quote jsonb;
  stages text[]:=array['reserved','preview_verified','invoice_requested','invoice_created','finalize_requested','quoted','payment_requested','payment_verified','change_requested'];
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'checkpoint');
  s:=private.billing_check_upgrade_fence_v1(p_request); if s<>'valid' then return jsonb_build_object('status',s); end if;
  select * into o from public.billing_upgrade_operations where id=(p_request->>'operation_id')::uuid;
  if (next_stage<>'void_requested' and (o.stage='void_requested' or array_position(stages,next_stage)<array_position(stages,o.stage)
      or array_position(stages,next_stage)>array_position(stages,o.stage)+1))
    or (next_stage='void_requested' and (o.invoice_id is null or o.stage in ('payment_verified','change_requested')))
    or (next_stage in ('payment_requested','payment_verified','change_requested') and not o.confirmed)
    or (next_stage in ('invoice_requested','finalize_requested') and next_stage<>o.stage and clock_timestamp()>=o.expires_at)
    or (next_stage='payment_requested' and o.stage<>'payment_requested' and clock_timestamp()>=o.expires_at)
    or (next_stage in ('payment_verified','change_requested') and clock_timestamp()>=o.paid_through)
    or (p_request ? 'invoice_id' and o.invoice_id is not null and o.invoice_id<>p_request->>'invoice_id')
    or (p_request ? 'payment_intent_id' and o.payment_intent_id is not null and o.payment_intent_id<>p_request->>'payment_intent_id') then
    raise exception using errcode='22023',message='billing_upgrade_stage_invalid'; end if;
  if (p_request ? 'quote')<>(p_request ? 'quote_digest') then raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
  new_quote:=case when p_request ? 'quote' then p_request->'quote' else o.quote end;
  if p_request ? 'quote' then
    perform private.billing_validate_upgrade_quote_v1(new_quote,o);
    if o.confirmed or next_stage not in ('preview_verified','quoted') or clock_timestamp()>=(new_quote->>'expiresAt')::timestamptz
      or (o.quote is not null and (new_quote->>'quotedAt' is distinct from o.quote->>'quotedAt'
        or new_quote->>'subscriptionItemId' is distinct from o.quote->>'subscriptionItemId')) then
      raise exception using errcode='22023',message='billing_upgrade_quote_invalid'; end if;
  end if;
  if (next_stage<>'void_requested' and new_quote is null)
    or (next_stage in ('invoice_created','finalize_requested','quoted','payment_requested','payment_verified','change_requested') and coalesce(o.invoice_id,p_request->>'invoice_id') is null)
    or (next_stage in ('payment_verified','change_requested') and coalesce(o.payment_intent_id,p_request->>'payment_intent_id') is null) then
    raise exception using errcode='22023',message='billing_upgrade_stage_invalid'; end if;
  -- Repeat entitlement/lease checks after all validation and immediately before
  -- returning a provider-write permit; saved revisions are never replaced.
  s:=private.billing_check_upgrade_fence_v1(p_request); if s<>'valid' then return jsonb_build_object('status',s); end if;
  update public.billing_upgrade_operations set stage=next_stage,quote=new_quote,
    quote_digest=case when p_request ? 'quote' then p_request->>'quote_digest' else quote_digest end,
    quote_revision=case when p_request ? 'quote' then revision+1 else quote_revision end,
    expires_at=case when p_request ? 'quote' then (new_quote->>'expiresAt')::timestamptz else expires_at end,
    invoice_id=coalesce(invoice_id,p_request->>'invoice_id'),payment_intent_id=coalesce(payment_intent_id,p_request->>'payment_intent_id'),
    revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  return private.billing_upgrade_claim_json_v1(o.id);
end; $$;

create function public.billing_confirm_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.billing_upgrade_operations%rowtype; s text;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'confirm');
  select * into o from public.billing_upgrade_operations where id=(p_request->>'operation_id')::uuid and subject_user_id=(p_request->>'subject_user_id')::uuid;
  if not found then return jsonb_build_object('status','not_found'); end if;
  s:=private.billing_check_upgrade_state_v1(o.id);
  select * into o from public.billing_upgrade_operations where id=o.id;
  if o.quote_revision is distinct from (p_request->>'quote_revision')::bigint or o.quote_digest is distinct from p_request->>'quote_digest' then
    return jsonb_build_object('status','rejected'); end if;
  if o.confirmed then return jsonb_build_object('status','existing','operation',private.billing_upgrade_json_v1(o.id)); end if;
  if s<>'valid' then return jsonb_build_object('status',s); end if;
  if o.expires_at<=clock_timestamp() then return jsonb_build_object('status','expired'); end if;
  if o.status not in ('queued','retry') or o.stage<>'quoted' or o.invoice_id is null or o.quote is null or (o.quote->>'amountDue')::bigint<=0 then
    return jsonb_build_object('status','rejected'); end if;
  update public.billing_upgrade_operations set confirmed=true,status='queued',next_attempt_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  return jsonb_build_object('status','confirmed','operation',private.billing_upgrade_json_v1(o.id));
end; $$;

create function public.billing_finish_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; o public.billing_upgrade_operations%rowtype; outcome text:=p_request->>'outcome'; e jsonb:=p_request->'evidence';
  k text; plan_revision bigint; a public.billing_account_access%rowtype; previous_state jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'finish');
  if p_request ? 'evidence' and outcome not in ('applied','expired') then raise exception using errcode='22023',message='billing_upgrade_evidence_invalid'; end if;
  s:=private.billing_check_upgrade_fence_v1(p_request); if s<>'valid' then return jsonb_build_object('status',s); end if;
  select * into o from public.billing_upgrade_operations where id=(p_request->>'operation_id')::uuid;
  if outcome='applied' then
    if jsonb_typeof(e) is distinct from 'object' or e-array['invoiceId','paymentIntentId','subscriptionId','paymentState','providerStatus','amountPaid','currency','subscriptionItemId','targetPriceId','paidPeriodStart','paidThrough']<>'{}'
      or e->>'invoiceId' is distinct from o.invoice_id or e->>'paymentIntentId' is distinct from o.payment_intent_id
      or e->>'subscriptionId' is distinct from o.source_binding->>'stripe_subscription_id'
      or e->>'subscriptionItemId' is distinct from o.quote->>'subscriptionItemId' or e->>'targetPriceId' is distinct from o.target->>'stripe_price_id'
      or e->>'currency' is distinct from o.target->>'currency' or e->>'paymentState' is distinct from 'paid' or e->>'providerStatus' is distinct from 'active'
      or jsonb_typeof(e->'amountPaid') is distinct from 'number' or coalesce(e->>'amountPaid','') !~ '^[1-9][0-9]{0,15}$'
      or not o.confirmed or o.stage<>'change_requested' or o.invoice_id is null or o.payment_intent_id is null
      or o.paid_through<=clock_timestamp() then raise exception using errcode='22023',message='billing_upgrade_evidence_invalid'; end if;
    foreach k in array array['paidPeriodStart','paidThrough'] loop
      if jsonb_typeof(e->k) is distinct from 'string' or coalesce(e->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception using errcode='22023',message='billing_upgrade_evidence_invalid'; end if;
      begin perform (e->>k)::timestamptz; exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='billing_upgrade_evidence_invalid'; end;
    end loop;
    if (e->>'amountPaid')::numeric<> (o.quote->>'amountDue')::numeric or (e->>'amountPaid')::numeric>9007199254740991
      or (e->>'paidPeriodStart')::timestamptz<>o.paid_period_start or (e->>'paidThrough')::timestamptz<>o.paid_through then
      raise exception using errcode='22023',message='billing_upgrade_evidence_invalid'; end if;
    s:=private.billing_check_upgrade_fence_v1(p_request); if s<>'valid' then return jsonb_build_object('status',s); end if;
    select to_jsonb(x) into previous_state from public.billing_account_access x where subject_user_id=o.subject_user_id;
    update public.stripe_billing_subscription_bindings set offering_version_id=o.target_offering_version_id where id=o.subscription_id;
    update public.billing_account_access set offering_version_id=o.target_offering_version_id,revision=revision+1,
      last_provider_verified_at=clock_timestamp(),updated_at=clock_timestamp() where subject_user_id=o.subject_user_id;
    -- A version change always rewrites benefits, even with identical period dates.
    plan_revision:=private.billing_write_access_v1(o.subject_user_id,o.expected_account_plan_revision,'stripe_prorated_upgrade');
    insert into public.billing_upgrade_receipts(operation_id,subscription_id,source_offering_version_id,target_offering_version_id,
      stripe_account,invoice_id,payment_intent_id,amount_paid,currency,paid_period_start,paid_through,account_plan_revision,evidence)
      values(o.id,o.subscription_id,o.source_offering_version_id,o.target_offering_version_id,o.source_binding->>'stripe_account',
        o.invoice_id,o.payment_intent_id,(e->>'amountPaid')::bigint,e->>'currency',o.paid_period_start,o.paid_through,plan_revision,e);
    select * into a from public.billing_account_access where subject_user_id=o.subject_user_id;
    insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,previous_state,next_state)
      values(o.subject_user_id,o.subscription_id,o.id,'prorated_upgrade',previous_state,to_jsonb(a));
  elsif outcome='expired' then
    if o.expires_at>clock_timestamp() or (o.invoice_id is null and o.stage not in ('reserved','preview_verified'))
      or (o.invoice_id is not null and (o.stage<>'void_requested' or jsonb_typeof(e) is distinct from 'object'
        or e is distinct from jsonb_build_object('kind','voided','invoiceId',o.invoice_id))) then
      raise exception using errcode='22023',message='billing_upgrade_evidence_invalid'; end if;
  elsif outcome='awaiting_confirmation' then
    if o.stage<>'quoted' or o.confirmed or o.expires_at<=clock_timestamp() then raise exception using errcode='22023',message='billing_upgrade_stage_invalid'; end if;
  elsif outcome='payment_pending' then
    if not o.confirmed or o.stage<>'payment_requested' then raise exception using errcode='22023',message='billing_upgrade_stage_invalid'; end if;
  end if;
  if outcome='deferred' and o.attempt_count>=4 then outcome:='attention'; end if;
  update public.billing_upgrade_operations set
    status=case when outcome in ('applied','expired','attention') then outcome when outcome='deferred' then 'retry' else 'queued' end,
    stage=case when outcome in ('applied','expired') then outcome else stage end,
    attempt_count=least(5,attempt_count+case when p_request->>'outcome'='deferred' then 1 else 0 end),
    next_attempt_at=case when outcome='deferred' then clock_timestamp()+make_interval(secs=>60*(2^o.attempt_count)::integer)
      when outcome='awaiting_confirmation' then expires_at when outcome='payment_pending' then clock_timestamp()+interval '1 minute' else null end,
    completed_at=case when outcome in ('applied','expired') then clock_timestamp() else null end,
    reason=p_request->>'reason',revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,revision=revision+1,
    next_reconcile_at=case when outcome in ('applied','expired') then clock_timestamp() else next_reconcile_at end,
    updated_at=clock_timestamp() where id=o.subscription_id;
  return jsonb_build_object('status',outcome);
end; $$;

-- Preserve migration 228's closeout arbitration in the renamed wrapper chain.
alter function public.billing_claim_subscription_v1(jsonb) set schema private;
alter function private.billing_claim_subscription_v1(jsonb) rename to billing_claim_subscription_before_upgrade_v1;
create function public.billing_claim_subscription_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_request->>'subscription_id' is null
    or coalesce(p_request->>'lease_seconds','') !~ '^[0-9]+$' then
    return private.billing_claim_subscription_before_upgrade_v1(p_request); end if;
  if (p_request->>'lease_seconds')::numeric not between 30 and 300 then
    return private.billing_claim_subscription_before_upgrade_v1(p_request); end if;
  perform 1 from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid for update;
  if exists(select 1 from public.billing_upgrade_operations where subscription_id=(p_request->>'subscription_id')::uuid
    and status in ('queued','retry','attention')) then return jsonb_build_object('status','busy'); end if;
  return private.billing_claim_subscription_before_upgrade_v1(p_request);
end; $$;

-- Exclude every owned binding before ordering/limiting either queue arm.
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
      and not exists(select 1 from public.billing_upgrade_operations upgrade
        where upgrade.subscription_id=binding.id and upgrade.status in ('queued','retry','attention'))
      and not exists(select 1 from public.billing_renewal_closeouts closeout
        where closeout.subscription_id=binding.id and closeout.status in ('queued','retry','attention'))
    union all
    select 'reconcile'::text, null::uuid, binding.id, binding.next_reconcile_at
    from public.stripe_billing_subscription_bindings binding
    where binding.is_current and binding.reconcile_state in ('queued', 'retry')
      and binding.reconcile_attempt_count < 5
      and binding.next_reconcile_at <= clock_timestamp()
      and (binding.lease_expires_at is null or binding.lease_expires_at <= clock_timestamp())
      and not exists(select 1 from public.billing_upgrade_operations upgrade
        where upgrade.subscription_id=binding.id and upgrade.status in ('queued','retry','attention'))
      and not exists(select 1 from public.billing_renewal_closeouts closeout
        where closeout.subscription_id=binding.id and closeout.status in ('queued','retry','attention'))
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


revoke all on function private.billing_validate_upgrade_request_v1(jsonb,text),private.billing_upgrade_json_v1(uuid),
  private.billing_upgrade_claim_json_v1(uuid),private.billing_check_upgrade_state_v1(uuid),private.billing_check_upgrade_fence_v1(jsonb),
  private.billing_validate_upgrade_quote_v1(jsonb,public.billing_upgrade_operations),private.billing_claim_subscription_before_upgrade_v1(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.billing_reserve_upgrade_v1(jsonb),public.billing_get_upgrade_v1(jsonb),
  public.billing_get_applied_upgrade_v1(jsonb),public.billing_claim_upgrade_v1(jsonb),public.billing_list_upgrades_v1(jsonb),
  public.billing_checkpoint_upgrade_v1(jsonb),public.billing_confirm_upgrade_v1(jsonb),public.billing_finish_upgrade_v1(jsonb),
  public.billing_claim_subscription_v1(jsonb) from public,anon,authenticated;
grant execute on function public.billing_reserve_upgrade_v1(jsonb),public.billing_get_upgrade_v1(jsonb),
  public.billing_get_applied_upgrade_v1(jsonb),public.billing_claim_upgrade_v1(jsonb),public.billing_list_upgrades_v1(jsonb),
  public.billing_checkpoint_upgrade_v1(jsonb),public.billing_confirm_upgrade_v1(jsonb),public.billing_finish_upgrade_v1(jsonb),
  public.billing_claim_subscription_v1(jsonb) to service_role;
