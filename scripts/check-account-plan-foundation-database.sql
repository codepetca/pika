begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $contract$
declare
  v_setter text := 'public.set_account_plan_v1(uuid,uuid,text,text,text,bigint)';
begin
  if to_regprocedure(v_setter) is null
    or has_function_privilege('anon', v_setter, 'execute')
    or has_function_privilege('authenticated', v_setter, 'execute')
    or not has_function_privilege('service_role', v_setter, 'execute')
    or has_table_privilege('anon', 'public.account_plans', 'select')
    or has_table_privilege('authenticated', 'public.account_plans', 'select')
    or has_table_privilege('service_role', 'public.account_plans', 'insert')
    or not has_table_privilege('service_role', 'public.account_plans', 'select')
    or has_table_privilege('service_role', 'public.account_plan_audit', 'insert')
  then
    raise exception 'Account plan privileges are incorrect';
  end if;

  if not exists (
    select 1 from pg_proc procedure
    where procedure.oid = to_regprocedure(v_setter)
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'Account plan setter security metadata is incorrect';
  end if;
end;
$contract$;

insert into public.users (id, email, role) values (
  'f2060000-0000-4000-8000-000000000001',
  'account-plan-206@example.invalid',
  'teacher'
);

do $signup$
declare
  v_strict boolean;
begin
  select strict_enforcement_enabled into v_strict
  from private.classroom_creation_entitlement_settings where singleton;

  if v_strict then
    if not exists (
      select 1 from public.account_plans
      where subject_user_id = 'f2060000-0000-4000-8000-000000000001'
        and plan_key = 'free' and revision = 1
    ) or not exists (
      select 1 from public.effective_feature_entitlements
      where subject_user_id = 'f2060000-0000-4000-8000-000000000001'
        and feature_key = 'classrooms.create'
        and source = 'plan' and not enabled and quota_limit = 0
    ) then
      raise exception 'Post-cutover signup did not atomically provision Free';
    end if;
  elsif exists (
    select 1 from public.account_plans
    where subject_user_id = 'f2060000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Pre-cutover signup unexpectedly assigned a plan';
  end if;
end;
$signup$;

set local role service_role;

do $plans$
declare
  v_result jsonb;
  v_plan text;
  v_limit integer;
  v_revision bigint;
  v_initial_audit bigint;
  v_operation uuid;
begin
  select coalesce(max(revision), 0) into v_revision
  from public.account_plans
  where subject_user_id = 'f2060000-0000-4000-8000-000000000001';
  select count(*) into v_initial_audit from public.account_plan_audit
  where subject_user_id = 'f2060000-0000-4000-8000-000000000001';

  for v_plan, v_limit in
    select * from (values ('free', 0), ('basic', 2), ('plus', 5), ('pro', 10))
      as tiers(plan_key, classroom_limit)
  loop
    v_operation := gen_random_uuid();
    v_result := public.set_account_plan_v1(
      v_operation, 'f2060000-0000-4000-8000-000000000001',
      v_plan, 'test:migration-206', 'tier_mapping_contract', v_revision
    );
    v_revision := v_revision + 1;
    if (v_result->>'revision')::bigint <> v_revision
      or (v_result->>'classroom_limit')::integer <> v_limit
      or (v_result->>'duplicate')::boolean
      or not exists (
        select 1 from public.effective_feature_entitlements
        where subject_user_id = 'f2060000-0000-4000-8000-000000000001'
          and feature_key = 'classrooms.create'
          and source = 'plan'
          and enabled = (v_limit > 0)
          and quota_limit = v_limit
      )
    then
      raise exception 'Plan % did not derive its expected entitlement', v_plan;
    end if;

    if (public.set_account_plan_v1(
      v_operation, 'f2060000-0000-4000-8000-000000000001',
      v_plan, 'test:migration-206', 'tier_mapping_contract', v_revision - 1
    ) ->> 'duplicate') <> 'true' then
      raise exception 'Plan operation did not replay idempotently';
    end if;
  end loop;

  if (select count(*) from public.account_plan_audit
      where subject_user_id = 'f2060000-0000-4000-8000-000000000001') <> v_initial_audit + 4
    or (select count(*) from public.effective_feature_entitlement_audit
      where subject_user_id = 'f2060000-0000-4000-8000-000000000001'
        and feature_key = 'classrooms.create') <> v_initial_audit + 4
  then
    raise exception 'Plan operation replay wrote an extra audit record';
  end if;

  begin
    perform public.set_account_plan_v1(
      v_operation, 'f2060000-0000-4000-8000-000000000001',
      'free', 'test:migration-206', 'tier_mapping_contract', v_revision - 1
    );
    raise exception 'Conflicting operation ID was accepted';
  exception when unique_violation then
    if sqlerrm <> 'account_plan_operation_conflict' then raise; end if;
  end;

  begin
    perform public.set_account_plan_v1(
      gen_random_uuid(), 'f2060000-0000-4000-8000-000000000001',
      'free', 'test:migration-206', 'tier_mapping_contract', v_revision - 1
    );
    raise exception 'Stale revision was accepted';
  exception when serialization_failure then
    if sqlerrm <> 'account_plan_revision_conflict' then raise; end if;
  end;
end;
$plans$;

-- Pro creates; a later Free assignment never deletes or archives the class.
reset role;
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'f2060000-0000-4000-8000-000000000011',
  'f2060000-0000-4000-8000-000000000001',
  'Plan contract classroom',
  'F206ONE'
);
set local role service_role;
select public.set_account_plan_v1(
  'f2060000-0000-4000-8000-000000000012',
  'f2060000-0000-4000-8000-000000000001',
  'free', 'test:migration-206', 'downgrade_preserves_classes',
  (select revision from public.account_plans
   where subject_user_id = 'f2060000-0000-4000-8000-000000000001')
);
reset role;

do $downgrade$
begin
  if not exists (
    select 1 from public.classrooms
    where id = 'f2060000-0000-4000-8000-000000000011'
      and archived_at is null
  ) then
    raise exception 'Downgrade changed an existing classroom';
  end if;

  begin
    insert into public.classrooms (id, teacher_id, title, class_code) values (
      'f2060000-0000-4000-8000-000000000013',
      'f2060000-0000-4000-8000-000000000001',
      'Denied after downgrade',
      'F206TWO'
    );
    raise exception 'Downgrade allowed new classroom consumption';
  exception when insufficient_privilege then
    if sqlerrm <> 'classroom_creation_entitlement_disabled' then raise; end if;
  end;
end;
$downgrade$;

rollback;
