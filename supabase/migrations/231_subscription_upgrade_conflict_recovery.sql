-- Forward repair for applied 230. Conflicts must not remain invisible queue owners.
-- No provider evidence is fabricated and saved plan/access fences are never refreshed.
create function private.billing_resolve_upgrade_conflict_v1(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare o public.billing_upgrade_operations%rowtype; next_operation jsonb; safe_release boolean;
begin
  -- Also acquires binding -> subject/plan -> access -> operation locks.
  if private.billing_check_upgrade_state_v1(p_id)<>'plan_conflict' then return; end if;
  select * into o from public.billing_upgrade_operations where id=p_id;
  if o.status not in ('queued','retry') then return; end if;
  -- Before invoice_requested there cannot have been a provider write. Anything
  -- later, including an unknown create/pay response, retains recovery ownership.
  safe_release:=o.stage in ('reserved','preview_verified') and o.invoice_id is null;
  update public.billing_upgrade_operations set
    status=case when safe_release then 'expired' else 'attention' end,
    stage=case when safe_release then 'expired' else stage end,
    reason='plan_conflict',next_attempt_at=null,revision=revision+1,
    completed_at=case when safe_release then clock_timestamp() else null end,
    updated_at=clock_timestamp() where id=o.id returning to_jsonb(billing_upgrade_operations.*) into next_operation;
  update public.stripe_billing_subscription_bindings set lease_token=null,lease_expires_at=null,
    fencing_token=fencing_token+1,revision=revision+1,
    next_reconcile_at=case when safe_release then clock_timestamp() else next_reconcile_at end,
    updated_at=clock_timestamp() where id=o.subscription_id;
  insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,previous_state,next_state)
    values(o.subject_user_id,o.subscription_id,o.id,'upgrade_plan_conflict',to_jsonb(o),next_operation);
end; $$;
revoke all on function private.billing_resolve_upgrade_conflict_v1(uuid) from public,anon,authenticated,service_role;

-- Keep 230's complete lease/request fencing. Only its verified current claimant
-- may quarantine a conflict; a stale worker or altered expected revision cannot.
alter function private.billing_check_upgrade_fence_v1(jsonb) rename to billing_check_upgrade_fence_before_conflict_v1;
create function private.billing_check_upgrade_fence_v1(p_request jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare s text;
begin
  s:=private.billing_check_upgrade_fence_before_conflict_v1(p_request);
  if s='plan_conflict' then
    perform private.billing_resolve_upgrade_conflict_v1((p_request->>'operation_id')::uuid);
  end if;
  return s;
end; $$;
revoke all on function private.billing_check_upgrade_fence_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.billing_claim_upgrade_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s text; o public.billing_upgrade_operations%rowtype; b public.stripe_billing_subscription_bindings%rowtype;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'claim');
  s:=private.billing_check_upgrade_state_v1((p_request->>'operation_id')::uuid);
  if s='not_found' then return jsonb_build_object('status',s); end if;
  select * into o from public.billing_upgrade_operations where id=(p_request->>'operation_id')::uuid;
  select * into b from public.stripe_billing_subscription_bindings where id=o.subscription_id;
  -- A queue claimant must wait for an existing provider-write lease to finish.
  if o.status not in ('queued','retry') or b.lease_expires_at>clock_timestamp() then return jsonb_build_object('status','busy'); end if;
  if s='plan_conflict' then
    perform private.billing_resolve_upgrade_conflict_v1(o.id);
    return jsonb_build_object('status',s);
  end if;
  if o.next_attempt_at>clock_timestamp()
    or (o.stage='quoted' and not o.confirmed and o.expires_at>clock_timestamp()) then return jsonb_build_object('status','busy'); end if;
  update public.stripe_billing_subscription_bindings set lease_token=gen_random_uuid(),
    lease_expires_at=clock_timestamp()+make_interval(secs=>(p_request->>'lease_seconds')::integer),
    fencing_token=fencing_token+1,revision=revision+1,updated_at=clock_timestamp() where id=b.id;
  update public.billing_upgrade_operations set status='queued',revision=revision+1,updated_at=clock_timestamp() where id=o.id;
  return private.billing_upgrade_claim_json_v1(o.id);
end; $$;

-- Discover conflicts without using a mutating helper in a read query. Missing
-- plan/access/entitlement rows and retired bindings must remain discoverable.
create or replace function public.billing_list_upgrades_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1(); perform private.billing_validate_upgrade_request_v1(p_request,'list');
  select coalesce(jsonb_agg(jsonb_build_object('operation_id',id)),'[]'::jsonb) into r from (
    select o.id from public.billing_upgrade_operations o
    join public.stripe_billing_subscription_bindings b on b.id=o.subscription_id
    left join public.billing_account_access a on a.subject_user_id=o.subject_user_id
    left join public.account_plans p on p.subject_user_id=o.subject_user_id
    left join public.effective_feature_entitlements e on e.subject_user_id=o.subject_user_id and e.feature_key='classrooms.create'
    where o.status in ('queued','retry')
      and (b.lease_expires_at is null or b.lease_expires_at<=clock_timestamp())
      and ((o.next_attempt_at<=clock_timestamp() and (o.stage<>'quoted' or o.confirmed or o.expires_at<=clock_timestamp()))
        or not b.is_current or b.provider_mode<>'test' or b.offering_version_id is distinct from o.source_offering_version_id
        or p.management_source is distinct from 'billing' or p.billing_offering_version_id is distinct from o.source_offering_version_id
        or p.revision is distinct from o.expected_account_plan_revision or a.account_plan_revision is distinct from p.revision
        or a.revision is distinct from o.expected_access_revision or a.entitlement_revision is distinct from o.expected_entitlement_revision
        or e.revision is distinct from o.expected_entitlement_revision
        or a.subscription_id is distinct from b.id or a.source is distinct from 'paid'
        or a.offering_version_id is distinct from o.source_offering_version_id
        or a.end_reason is distinct from 'renewal_pending' or a.failed_renewal_invoice_id is not null or a.expiry_applied_at is not null
        or a.paid_period_start is distinct from o.paid_period_start or a.paid_through is distinct from o.paid_through
        or a.access_ends_at is distinct from o.paid_through or a.last_paid_invoice_id is distinct from o.last_paid_invoice_id
        or exists(select 1 from public.billing_renewal_closeouts c where c.subscription_id=b.id and c.status in ('queued','retry','attention')))
    order by o.next_attempt_at nulls first,o.id limit 1
  ) due;
  return jsonb_build_object('items',r);
end; $$;

-- The ordinary operator requeue is not authority to erase an unresolved upgrade
-- or to adopt override revisions. Preserve its closeout and non-upgrade behavior.
alter function public.billing_requeue_subscription_v1(jsonb) set schema private;
alter function private.billing_requeue_subscription_v1(jsonb) rename to billing_requeue_subscription_before_upgrade_conflict_v1;
create function public.billing_requeue_subscription_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if p_request is null or jsonb_typeof(p_request)<>'object' or p_request->>'subscription_id' is null
    or coalesce(p_request->>'actor_ref','') !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or coalesce(p_request->>'reason_code','') !~ '^[a-z][a-z0-9._-]{0,99}$' then
    raise exception using errcode='22023',message='stripe_billing_requeue_request_invalid'; end if;
  perform 1 from public.stripe_billing_subscription_bindings where id=(p_request->>'subscription_id')::uuid for update;
  if exists(select 1 from public.billing_upgrade_operations where subscription_id=(p_request->>'subscription_id')::uuid
    and status in ('queued','retry','attention')) then return jsonb_build_object('status','plan_conflict'); end if;
  return private.billing_requeue_subscription_before_upgrade_conflict_v1(p_request);
end; $$;
revoke all on function private.billing_requeue_subscription_before_upgrade_conflict_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.billing_requeue_subscription_v1(jsonb) from public,anon,authenticated;
grant execute on function public.billing_requeue_subscription_v1(jsonb) to service_role;
