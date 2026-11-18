-- Shared admission boundary for new classroom work. Dormant until the complete
-- subscription cutoff rollout is ready. Started work keeps its own rules.
begin;

alter table private.stripe_billing_settings
  add column classroom_new_work_cutoff_enabled boolean not null default false;

create function private.billing_classroom_can_start_work_v1(p_classroom_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid;
  v_plan public.account_plans%rowtype;
  v_access public.billing_account_access%rowtype;
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_now timestamptz;
begin
  if not exists(select 1 from private.stripe_billing_settings where singleton and classroom_new_work_cutoff_enabled) then
    return true;
  end if;
  -- The caller has already bound the resource and locked its classroom.
  select teacher_id into v_owner from public.classrooms where id=p_classroom_id;
  if not found then return false; end if;
  -- The billing writer takes this same lock before changing plan and access.
  -- It does not take classroom locks. Read time after all entitlement waits.
  perform pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||v_owner::text,20620260924));
  select * into v_plan from public.account_plans where subject_user_id=v_owner;
  if v_plan.management_source='legacy' then return true; end if;
  select * into v_access from public.billing_account_access where subject_user_id=v_owner;
  if v_plan.subject_user_id is null then return v_access.subject_user_id is null; end if;
  perform public.lock_effective_feature_entitlement_v1(v_owner,'classrooms.create');
  select * into v_entitlement from public.effective_feature_entitlements
    where subject_user_id=v_owner and feature_key='classrooms.create';
  v_now:=clock_timestamp();
  return coalesce(
    v_plan.plan_key<>'free'
    and v_access.account_plan_revision=v_plan.revision
    and v_access.entitlement_revision=v_entitlement.revision
    and v_access.expiry_applied_at is null
    and v_entitlement.enabled and v_entitlement.quota_limit>0
    and v_entitlement.starts_at=v_access.starts_at and v_entitlement.expires_at=v_access.access_ends_at
    and v_now>=v_access.starts_at and v_now<v_access.access_ends_at
    and (
      (v_plan.management_source='trial' and v_access.source='trial' and v_entitlement.source='trial'
        and v_access.trial_subject_user_id=v_owner)
      or (v_plan.management_source='billing' and v_access.source='paid' and v_entitlement.source='plan'
        and v_plan.billing_offering_version_id=v_access.offering_version_id
        and exists(select 1 from public.stripe_billing_subscription_bindings binding
          where binding.id=v_access.subscription_id and binding.subject_user_id=v_owner and binding.is_current
            and binding.offering_version_id=v_access.offering_version_id))
    ),false);
end;
$$;

revoke all on function private.billing_classroom_can_start_work_v1(uuid) from public,anon,authenticated,service_role;

create or replace function public.start_test_attempt_revision_atomic(p_test_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_test public.tests%rowtype;
  v_result jsonb;
  v_revision bigint;
begin
  v_test:=private.lock_test_lifecycle(p_test_id);
  v_result:=private.save_test_attempt_v143(p_test_id,p_student_id,null);
  -- Keep the established membership/visibility check ahead of billing. A
  -- rejection rolls back the tentative attempt and its question lock together.
  -- Resuming an existing attempt continues through the original path.
  if v_result->'created'='true'::jsonb and not private.billing_classroom_can_start_work_v1(v_test.classroom_id) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  select draft_revision into v_revision from public.test_attempts where test_id=p_test_id and student_id=p_student_id;
  return jsonb_set(v_result,'{attempt,draft_revision}',to_jsonb(v_revision));
end;
$$;

create function private.guard_billing_test_publication_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.billing_classroom_can_start_work_v1(new.classroom_id) then
    raise exception using errcode='PT403',message='billing_classroom_new_work_unavailable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_billing_test_publication_v1() from public,anon,authenticated,service_role;

-- The legacy and contextual publishers both materialize questions, activate
-- the draft and close it in one transaction. Denial rolls back materialization.
create trigger billing_test_publication_cutoff before update of status on public.tests
for each row when (old.status='draft' and new.status='active')
execute function private.guard_billing_test_publication_v1();

commit;
