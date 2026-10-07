-- Migration253: dormant classroom Test quota foundation.
-- Prepared enforcement only. Applying this migration does not activate quotas,
-- assign accounts, change purchased offerings, or rewrite existing Test rows.
begin;

create table private.classroom_test_quota_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into private.classroom_test_quota_settings(singleton) values(true);
alter table private.classroom_test_quota_settings enable row level security;
revoke all on table private.classroom_test_quota_settings
  from public, anon, authenticated, service_role;

create function private.enforce_classroom_test_quota_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $guard$
declare
  v_enabled boolean;
  v_owner_id uuid;
  v_locked_owner_id uuid;
  v_plan public.account_plans%rowtype;
  v_features jsonb;
  v_offering_plan text;
  v_limit numeric;
  v_count bigint;
  v_invoker_role text := pg_catalog.current_setting('role', true);
begin
  -- Existing-work edits remain possible after downgrade and while over quota.
  if tg_op = 'UPDATE' and old.classroom_id is not distinct from new.classroom_id then
    return new;
  end if;
  select settings.enabled into v_enabled
    from private.classroom_test_quota_settings settings where singleton
    for share nowait;
  if not found then
    raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
  end if;
  if not v_enabled then return new; end if;

  -- SECURITY DEFINER changes current_user. Preserve the actual SET ROLE caller
  -- boundary as well as the established privileged restore-context helper.
  -- Restore reconstitutes retained work; identity-mapping imports do not.
  if public.is_classroom_archive_maintenance_mode('restore')
    and (v_invoker_role in ('postgres', 'service_role', 'supabase_admin')
      or (coalesce(v_invoker_role, 'none') = 'none'
        and session_user in ('postgres', 'service_role', 'supabase_admin'))) then
    return new;
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
  end if;

  -- Existing-row INSERT retries cannot increase consumption. Any ON CONFLICT
  -- UPDATE which actually moves the row still runs this trigger as UPDATE.
  if tg_op = 'INSERT' and exists(select 1 from public.tests existing
    where existing.id = new.id and existing.classroom_id = new.classroom_id) then
    return new;
  end if;
  select classroom.teacher_id into v_owner_id from public.classrooms classroom
    where classroom.id = new.classroom_id;
  if not found then
    raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
  end if;
  -- Plan writers use this exact namespace. TRY/NOWAIT avoids cycles with
  -- authoring RPCs which already hold the parent row. No waits or retries.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'account-plan-subject:' || v_owner_id::text, 20620260924)) then
    raise exception using errcode = 'PTC03', message = 'classroom_test_quota_busy';
  end if;
  select classroom.teacher_id into v_locked_owner_id from public.classrooms classroom
    where classroom.id = new.classroom_id for update nowait;
  if not found then
    raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
  end if;
  if v_locked_owner_id is distinct from v_owner_id then
    raise exception using errcode = 'PTC03', message = 'classroom_test_quota_busy';
  end if;
  select plan.* into v_plan from public.account_plans plan
    where plan.subject_user_id = v_owner_id for share nowait;
  if not found then
    raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
  end if;

  if v_plan.management_source = 'legacy' and v_plan.billing_offering_version_id is null then
    v_limit := case v_plan.plan_key
      when 'free' then 0 when 'basic' then 20 when 'plus' then 50 when 'pro' then 100
      else null end;
  elsif v_plan.management_source = 'billing' and v_plan.billing_offering_version_id is not null then
    select version.features, offering.plan_key into v_features, v_offering_plan
      from public.stripe_billing_offering_versions version
      join public.stripe_billing_offerings offering on offering.id = version.offering_id
      where version.id = v_plan.billing_offering_version_id;
    if not found or v_offering_plan is distinct from v_plan.plan_key
      or pg_catalog.jsonb_typeof(v_features) is distinct from 'object' then
      raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
    end if;
    -- Missing benefit metadata preserves the purchased historical version.
    -- A present malformed value is not an unlimited grant.
    if not v_features ? 'tests_per_classroom' then return new; end if;
    if pg_catalog.jsonb_typeof(v_features->'tests_per_classroom') is distinct from 'number' then
      raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
    end if;
    v_limit := (v_features->>'tests_per_classroom')::numeric;
    if v_limit < 0 or v_limit > 2147483647 or v_limit <> pg_catalog.trunc(v_limit) then
      raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
    end if;
  else
    raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
  end if;
  if v_limit is null then
    raise exception using errcode = 'PTC02', message = 'classroom_test_quota_unavailable';
  end if;
  -- Every physical Test counts: preparation, published work, and retained
  -- Blueprint replacements. Existing classroom indexes support this count.
  select count(*) into v_count
    from public.tests test where test.classroom_id = new.classroom_id;
  if v_count >= v_limit then
    raise exception using errcode = 'PTC01', message = 'classroom_test_quota_exhausted';
  end if;
  return new;
exception when lock_not_available then
  raise exception using errcode = 'PTC03', message = 'classroom_test_quota_busy';
end;
$guard$;
revoke all on function private.enforce_classroom_test_quota_v1()
  from public, anon, authenticated, service_role;

create trigger enforce_classroom_test_quota
before insert or update of classroom_id on public.tests
for each row execute function private.enforce_classroom_test_quota_v1();

commit;
