-- A stale plan or entitlement may require operator attention. Its expiry
-- cannot occupy every worker batch or rewrite a newer effective entitlement.
-- CREATE OR REPLACE retains the service-only execution ACL.
create or replace function public.billing_apply_due_access_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_subject uuid;
  v_access public.billing_account_access%rowtype;
  v_plan_revision bigint;
  v_entitlement_revision bigint;
  v_count integer:=0;
  v_limit integer:=(p_request->>'limit')::integer;
begin
  perform private.assert_stripe_billing_sandbox_enabled_v1();
  if v_limit is null or v_limit not between 1 and 100 then
    raise exception using errcode='22023',message='billing_limit_invalid';
  end if;
  for v_subject in
    select access.subject_user_id
    from public.billing_account_access access
    join public.account_plans plan on plan.subject_user_id=access.subject_user_id
      and plan.revision=access.account_plan_revision
    join public.effective_feature_entitlements entitlement on entitlement.subject_user_id=access.subject_user_id
      and entitlement.feature_key='classrooms.create' and entitlement.revision=access.entitlement_revision
    where access.access_ends_at<=clock_timestamp() and access.end_reason<>'renewal_pending'
      and access.expiry_applied_at is null
    order by access.access_ends_at,access.subject_user_id limit v_limit
  loop
    -- Match the existing plan -> access -> entitlement writer order. A worker
    -- can retry a contended account later without waiting on its plan lock.
    if not pg_try_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_subject::text,20620260924)) then
      continue;
    end if;
    select revision into v_plan_revision from public.account_plans where subject_user_id=v_subject for update;
    select * into v_access from public.billing_account_access where subject_user_id=v_subject for update;
    if not found or v_access.account_plan_revision is distinct from v_plan_revision
      or v_access.expiry_applied_at is not null or v_access.end_reason='renewal_pending' then
      continue;
    end if;
    perform public.lock_effective_feature_entitlement_v1(v_subject,'classrooms.create');
    select revision into v_entitlement_revision from public.effective_feature_entitlements
      where subject_user_id=v_subject and feature_key='classrooms.create';
    if v_entitlement_revision is null or v_entitlement_revision is distinct from v_access.entitlement_revision
      or v_access.access_ends_at>clock_timestamp() then
      continue;
    end if;
    perform private.billing_write_access_v1(v_subject,v_plan_revision,'subscription_expired');
    insert into public.billing_lifecycle_audit(subject_user_id,subscription_id,operation_id,reason,next_state)
      values(v_subject,v_access.subscription_id,gen_random_uuid(),'subscription_expired',
        public.billing_get_access_status_v1(jsonb_build_object('subject_user_id',v_subject)));
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('processed',v_count);
end; $$;
