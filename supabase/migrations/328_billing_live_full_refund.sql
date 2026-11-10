-- Operator-confirmed Stripe refund of the exact paid term. This migration
-- installs an idle RPC and ledger; it does not change any existing terms.
begin;

alter table public.billing_account_access
  drop constraint billing_account_access_end_reason_check,
  add constraint billing_account_access_end_reason_check
    check (end_reason in ('trial','cancellation','renewal_grace','renewal_pending','refund'));

create table private.billing_live_full_refunds (
  invoice_effect_id uuid primary key references public.stripe_billing_invoice_effects(id) on delete restrict,
  operation_id uuid not null unique,
  stripe_charge_id text not null unique check (stripe_charge_id ~ '^ch_[A-Za-z0-9]{1,255}$'),
  stripe_refund_ids text[] not null check (cardinality(stripe_refund_ids) between 1 and 100),
  currency text not null check (currency in ('cad','usd')),
  gross_amount bigint not null check (gross_amount>0),
  access_ended_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table private.billing_live_full_refunds enable row level security;
revoke all on table private.billing_live_full_refunds from public,anon,authenticated,service_role;

-- Server operators supply a fresh observation of the original captured card
-- payment, successful refunds for its entire gross, and a terminal Stripe
-- subscription without outstanding invoices. Only the current exact paid term
-- can change. The original invoice effect stays immutable.
create function public.billing_apply_live_full_refund_v1(
  p_project_ref text,p_stripe_account text,p_request jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  b public.stripe_billing_subscription_bindings%rowtype;
  p public.account_plans%rowtype;
  a public.billing_account_access%rowtype;
  e public.stripe_billing_invoice_effects%rowtype;
  receipt private.billing_live_full_refunds%rowtype;
  offering jsonb;
  v_operation uuid;
  v_refunds text[];
  v_gross bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz;
  v_cutoff timestamptz;
  v_revision bigint;
begin
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-array['apply','operation_id','stripe_subscription_id','stripe_customer_id','invoice_id',
      'charge_id','refund_ids','currency','gross_amount','base_amount','price_id','paid_period_start','paid_through']<>'{}'::jsonb
    or jsonb_typeof(p_request->'apply') is distinct from 'boolean'
    or coalesce(p_request->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request->>'stripe_subscription_id','') !~ '^sub_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'stripe_customer_id','') !~ '^cus_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'invoice_id','') !~ '^in_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'charge_id','') !~ '^ch_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'price_id','') !~ '^price_[A-Za-z0-9]{1,255}$'
    or coalesce(p_request->>'currency','') not in ('cad','usd')
    or jsonb_typeof(p_request->'gross_amount') is distinct from 'number'
    or coalesce(p_request->>'gross_amount','') !~ '^[1-9][0-9]{0,14}$'
    or jsonb_typeof(p_request->'base_amount') is distinct from 'number'
    or coalesce(p_request->>'base_amount','') !~ '^[1-9][0-9]{0,14}$'
    or jsonb_typeof(p_request->'paid_period_start') is distinct from 'string'
    or jsonb_typeof(p_request->'paid_through') is distinct from 'string'
    or jsonb_typeof(p_request->'refund_ids') is distinct from 'array' then
    raise exception using errcode='22023',message='billing_full_refund_request_invalid';
  end if;
  select array_agg(distinct id order by id) into v_refunds
    from jsonb_array_elements_text(p_request->'refund_ids') as ids(id)
    where id ~ '^re_[A-Za-z0-9]{1,255}$';
  if jsonb_array_length(p_request->'refund_ids') not between 1 and 100
    or cardinality(v_refunds) is distinct from jsonb_array_length(p_request->'refund_ids') then
    raise exception using errcode='22023',message='billing_full_refund_ids_invalid';
  end if;
  v_operation:=(p_request->>'operation_id')::uuid;
  v_gross:=(p_request->>'gross_amount')::bigint;
  v_start:=(p_request->>'paid_period_start')::timestamptz;
  v_end:=(p_request->>'paid_through')::timestamptz;
  perform private.lock_billing_live_payment_settings_v1(p_project_ref,p_stripe_account);
  select * into b from public.stripe_billing_subscription_bindings
    where stripe_account=p_stripe_account and provider_mode='live'
      and stripe_subscription_id=p_request->>'stripe_subscription_id'
      and stripe_customer_id=p_request->>'stripe_customer_id' for update;
  if not found then return jsonb_build_object('status','not_current_term'); end if;
  select * into e from public.stripe_billing_invoice_effects
    where stripe_account=p_stripe_account and stripe_invoice_id=p_request->>'invoice_id'
      and subscription_id=b.id and period_start=v_start and period_end=v_end;
  if not found then return jsonb_build_object('status','not_current_term'); end if;
  offering:=private.stripe_live_checkout_offering_v1(e.offering_version_id,p_stripe_account);
  if offering is null or offering->>'currency' is distinct from p_request->>'currency'
    or offering->>'stripe_price_id' is distinct from p_request->>'price_id'
    or offering->>'unit_amount' is distinct from p_request->>'base_amount'
    or v_gross<(p_request->>'base_amount')::bigint
    or (offering->>'tax_mode' is distinct from 'stripe_exclusive' and v_gross<>(p_request->>'base_amount')::bigint) then
    return jsonb_build_object('status','not_current_term');
  end if;
  select * into receipt from private.billing_live_full_refunds where invoice_effect_id=e.id;
  if found then
    if receipt.stripe_charge_id is distinct from p_request->>'charge_id'
      or receipt.stripe_refund_ids is distinct from v_refunds or receipt.gross_amount<>v_gross then
      raise exception using errcode='23505',message='billing_full_refund_evidence_conflict';
    end if;
    return jsonb_build_object('status','replayed','access_ended_at',receipt.access_ended_at);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||b.subject_user_id::text,20620260924));
  select * into p from public.account_plans where subject_user_id=b.subject_user_id for update;
  perform public.lock_effective_feature_entitlement_v1(b.subject_user_id,'classrooms.create');
  select * into a from public.billing_account_access where subject_user_id=b.subject_user_id for update;
  v_now:=clock_timestamp();
  if a.source is distinct from 'paid' or a.subscription_id is distinct from b.id
    or a.offering_version_id is distinct from e.offering_version_id or b.offering_version_id is distinct from e.offering_version_id
    or a.last_paid_invoice_id is distinct from e.stripe_invoice_id or a.paid_period_start is distinct from v_start
    or a.paid_through is distinct from v_end or a.starts_at>=v_now
    or private.billing_live_reconciliation_binding_v1(b.id,p_stripe_account) is null
    or not private.billing_live_reconciliation_plan_valid_v1(b.id,p_project_ref,p_stripe_account) then
    return jsonb_build_object('status','not_current_term');
  end if;
  if p_request->'apply'='false'::jsonb then return jsonb_build_object('status','verified'); end if;

  -- Use the same access writer as expiry. It records Free, disables the paid
  -- entitlement and invokes the ordinary classroom restriction trigger.
  v_cutoff:=least(a.access_ends_at,v_now);
  update public.billing_account_access set access_ends_at=v_cutoff,end_reason='refund',
    last_provider_verified_at=v_now,revision=revision+1,updated_at=v_now where subject_user_id=b.subject_user_id;
  if a.expiry_applied_at is null then
    v_revision:=private.billing_write_access_v1(b.subject_user_id,p.revision,'subscription_refunded');
  else
    v_revision:=p.revision;
    -- Grace may have materialized Free while leaving durable restrictions
    -- deferred until provider closeout. This refund proves terminal custody.
    perform private.restrict_billing_classrooms_v1(b.subject_user_id,v_revision,v_cutoff,0,null);
  end if;
  -- A terminal subscription cannot run its scheduled cancellation or undo.
  -- Preserve the provider identity and write-ahead history for audit.
  update private.billing_live_scheduled_cancellations set
    state='abandoned',next_attempt_at=null,revision=revision+1
    where subscription_id=b.id and state in ('cancel_pending','cancel_scheduled','undo_pending','attention');
  update private.billing_scheduled_plan_changes set state='canceled'
    where subscription_id=b.id and last_paid_invoice_id=e.stripe_invoice_id and state='scheduled';
  update public.stripe_billing_subscription_bindings set
    is_current=false,terminal_confirmed_at=coalesce(terminal_confirmed_at,v_now),
    obligations_cleared_at=coalesce(obligations_cleared_at,v_now),last_provider_status='canceled',
    lease_token=null,lease_expires_at=null,next_reconcile_at=null,last_exception_code=null,
    reconcile_state='queued',reconcile_attempt_count=0,reconcile_attention_at=null,
    revision=revision+1,updated_at=v_now where id=b.id;
  insert into private.billing_live_full_refunds(
    invoice_effect_id,operation_id,stripe_charge_id,stripe_refund_ids,currency,gross_amount,access_ended_at
  ) values(e.id,v_operation,p_request->>'charge_id',v_refunds,p_request->>'currency',v_gross,v_cutoff);
  insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,previous_state,next_state)
    values(b.subject_user_id,b.id,v_operation,'subscription_refunded',to_jsonb(a),
      jsonb_build_object('state','free','classroom_limit',0,'access_ends_at',v_cutoff,'revision',v_revision));
  return jsonb_build_object('status','applied','access_ended_at',v_cutoff);
end;
$$;

revoke all on function public.billing_apply_live_full_refund_v1(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.billing_apply_live_full_refund_v1(text,text,jsonb) to service_role;

commit;
