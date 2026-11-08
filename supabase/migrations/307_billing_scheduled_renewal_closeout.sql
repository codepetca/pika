-- A scheduled target renewal can own closeout while the paid source version
-- still owns the grace term. This preserves migration 228's single lease.
begin;

alter table public.billing_renewal_closeouts add column scheduled_operation_id uuid
  references private.billing_scheduled_plan_changes(id) on delete restrict;

create function private.billing_closeout_schedule_v1(p_subscription_id uuid,p_schedule_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proof jsonb;
begin
  v_proof:=public.billing_get_scheduled_renewal_v1(jsonb_build_object('subscription_id',p_subscription_id));
  if v_proof->>'state' is distinct from 'scheduled'
    or v_proof->>'operation_id' is distinct from p_schedule_operation_id::text then return null; end if;
  return v_proof-'state';
end;
$$;

create or replace function private.billing_renewal_closeout_claim_json_v1(p_operation uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('status','claimed','operation_id',o.id,'subscription_id',b.id,
    'lease_token',b.lease_token,'fencing_token',b.fencing_token,'lease_expires_at',b.lease_expires_at,
    'subscription_revision',b.revision,'expected_account_plan_revision',o.expected_account_plan_revision,
    'operation_revision',o.revision,'stage',o.stage,'invoice_id',o.invoice_id,'paid_through',o.paid_through,'cutoff',o.cutoff,
    'binding',jsonb_build_object('subscription_id',b.id,'subject_user_id',b.subject_user_id,
      'stripe_account',b.stripe_account,'stripe_customer_id',b.stripe_customer_id,'stripe_subscription_id',b.stripe_subscription_id,
      'offering_id',v.offering_id,'offering_version_id',v.id,'stripe_product_id',v.stripe_product_id,'stripe_price_id',v.stripe_price_id,
      'unit_amount',v.unit_amount,'plan_key',f.plan_key,'currency',v.currency,'interval',v.interval,'provider_mode',b.provider_mode))
    || case when o.scheduled_operation_id is null then '{}'::jsonb
      else jsonb_build_object('scheduled',private.billing_closeout_schedule_v1(o.subscription_id,o.scheduled_operation_id)) end
  from public.billing_renewal_closeouts o join public.stripe_billing_subscription_bindings b on b.id=o.subscription_id
  join public.stripe_billing_offering_versions v on v.id=b.offering_version_id
  join public.stripe_billing_offerings f on f.id=v.offering_id where o.id=p_operation;
$$;

create or replace function public.billing_list_renewal_closeouts_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_renewal_closeout_request_v1(p_request-'scheduled_changes_enabled','list');
  select coalesce(jsonb_agg(jsonb_build_object('subscription_id',due.id)),'[]'::jsonb) into r from (
    select b.id from public.stripe_billing_subscription_bindings b
    join public.billing_account_access a on a.subscription_id=b.id and a.subject_user_id=b.subject_user_id
    join public.account_plans p on p.subject_user_id=b.subject_user_id
    join public.effective_feature_entitlements e on e.subject_user_id=b.subject_user_id and e.feature_key='classrooms.create'
    left join public.billing_renewal_closeouts o on o.subscription_id=b.id and o.invoice_id=a.failed_renewal_invoice_id
    left join private.billing_scheduled_plan_changes change on change.subscription_id=b.id
      and change.effective_at=a.paid_through and change.state='scheduled'
    where b.is_current and b.provider_mode='test' and a.source='paid' and a.end_reason='renewal_grace'
      and a.access_ends_at<=clock_timestamp() and a.expiry_applied_at is not null
      and p.management_source='billing' and p.plan_key='free' and a.account_plan_revision=p.revision and a.entitlement_revision=e.revision
      and (o.id is null or (o.expected_account_plan_revision=p.revision and o.expected_access_revision=a.revision
        and o.expected_entitlement_revision=e.revision))
      and (b.lease_expires_at is null or b.lease_expires_at<=clock_timestamp())
      and (o.id is null or (o.status in ('queued','retry') and o.next_attempt_at<=clock_timestamp()))
      and ((change.id is null and o.scheduled_operation_id is null)
        or ((p_request->'scheduled_changes_enabled') is not distinct from 'true'::jsonb
          and change.id is not null and (o.id is null or o.scheduled_operation_id=change.id)
          and private.billing_closeout_schedule_v1(b.id,change.id) is not null))
    order by coalesce(o.next_attempt_at,a.access_ends_at),b.id limit 1
  ) due;
  return jsonb_build_object('items',r);
end; $$;

create or replace function public.billing_claim_renewal_closeout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.stripe_billing_subscription_bindings%rowtype; p public.account_plans%rowtype;
  a public.billing_account_access%rowtype; o public.billing_renewal_closeouts%rowtype; v_scheduled uuid;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_renewal_closeout_request_v1(p_request-'scheduled_changes_enabled','claim');
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
  select id into v_scheduled from private.billing_scheduled_plan_changes
    where subscription_id=b.id and effective_at=a.paid_through and state='scheduled';
  if v_scheduled is not null and (p_request->'scheduled_changes_enabled') is distinct from 'true'::jsonb then
    return jsonb_build_object('status','busy');
  end if;
  if v_scheduled is not null and private.billing_closeout_schedule_v1(b.id,v_scheduled) is null then
    return jsonb_build_object('status','plan_conflict');
  end if;
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
    if o.scheduled_operation_id is distinct from v_scheduled then
      return jsonb_build_object('status','plan_conflict');
    end if;
    if o.status in ('closed','payment_won','superseded') then return jsonb_build_object('status','superseded'); end if;
    if o.status='attention' or o.next_attempt_at>clock_timestamp() then return jsonb_build_object('status','busy'); end if;
  else
    insert into public.billing_renewal_closeouts(subscription_id,invoice_id,paid_through,cutoff,
      expected_account_plan_revision,expected_access_revision,expected_entitlement_revision,scheduled_operation_id)
      values(b.id,a.failed_renewal_invoice_id,a.paid_through,a.access_ends_at,p.revision,a.revision,a.entitlement_revision,v_scheduled) returning * into o;
  end if;
  update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>(p_request->>'lease_seconds')::integer),
    fencing_token=fencing_token+1,revision=revision+1,updated_at=clock_timestamp() where id=b.id;
  update public.billing_renewal_closeouts set status='queued',revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  return private.billing_renewal_closeout_claim_json_v1(o.id);
end; $$;

-- Keep the existing envelope, lease, revisions, payment race and closure
-- writer. Adopt the exact verified target inside its transaction.
alter function public.billing_finish_renewal_closeout_v1(jsonb) set schema private;
alter function private.billing_finish_renewal_closeout_v1(jsonb) rename to billing_finish_closeout_before_schedule_v1;

create function public.billing_finish_renewal_closeout_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_request jsonb:=p_request-array['scheduled_operation_id','provider_schedule_id'];
  v_closeout public.billing_renewal_closeouts%rowtype;
  v_change private.billing_scheduled_plan_changes%rowtype;
  v_proof jsonb;
  v_fence text;
  v_result jsonb;
  v_target_period_end timestamptz;
  v_outcome text:=p_request->>'outcome';
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  perform private.billing_validate_renewal_closeout_request_v1(v_request,'finish');
  select * into v_closeout from public.billing_renewal_closeouts
    where id=(v_request->>'operation_id')::uuid;
  if v_closeout.scheduled_operation_id is null then
    if p_request ?| array['scheduled_operation_id','provider_schedule_id'] then
      return jsonb_build_object('status','plan_conflict');
    end if;
    return private.billing_finish_closeout_before_schedule_v1(v_request);
  end if;
  v_fence:=private.billing_check_renewal_closeout_fence_v1(v_request);
  if v_fence<>'valid' then return jsonb_build_object('status',v_fence); end if;
  select * into v_change from private.billing_scheduled_plan_changes where id=v_closeout.scheduled_operation_id for update;
  perform public.lock_effective_feature_entitlement_v1(v_change.subject_user_id,'classrooms.create');
  v_fence:=private.billing_check_renewal_closeout_fence_v1(v_request);
  if v_fence<>'valid' then return jsonb_build_object('status',v_fence); end if;
  v_proof:=private.billing_closeout_schedule_v1(v_closeout.subscription_id,v_change.id);
  if v_proof is null or v_change.effective_at is distinct from v_closeout.paid_through
    or p_request->>'scheduled_operation_id' is distinct from v_change.id::text
    or p_request->>'provider_schedule_id' is distinct from v_change.provider_schedule_id then
    return jsonb_build_object('status','plan_conflict');
  end if;
  if v_outcome='payment_won' then
    v_target_period_end:=((v_change.effective_at at time zone 'UTC')
      + case v_proof#>>'{target_binding,interval}' when 'month' then interval '1 month' else interval '1 year' end) at time zone 'UTC';
    if (v_request#>>'{evidence,periodEnd}')::timestamptz is distinct from v_target_period_end then
      raise exception using errcode='22023',message='billing_scheduled_closeout_term_invalid';
    end if;
  end if;
  begin
    if v_outcome='payment_won' then
      update public.stripe_billing_subscription_bindings set offering_version_id=v_change.target_offering_version_id
        where id=v_closeout.subscription_id;
    end if;
    v_result:=private.billing_finish_closeout_before_schedule_v1(v_request);
    if v_outcome in ('payment_won','closed') then
      if v_result->>'status' is distinct from v_outcome then
        raise exception using errcode='P3071',message='billing_scheduled_closeout_not_applied';
      end if;
      update private.billing_scheduled_plan_changes
        set state=case when v_outcome='payment_won' then 'applied' else 'closed_unpaid' end where id=v_change.id;
    end if;
    return v_result;
  exception when sqlstate 'P3071' then
    return v_result;
  end;
end;
$$;

revoke all on function private.billing_closeout_schedule_v1(uuid,uuid),
  private.billing_finish_closeout_before_schedule_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.billing_finish_renewal_closeout_v1(jsonb) from public,anon,authenticated;
grant execute on function public.billing_finish_renewal_closeout_v1(jsonb) to service_role;

commit;
