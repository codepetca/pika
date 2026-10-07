-- Run ONLY on a separately migrated disposable database. No migration is applied
-- here. This entire fixture, including local activation, rolls back.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '30s';

do $privileges$
declare v_role text;
begin
  if (select enabled from private.classroom_test_quota_settings where singleton) then
    raise exception 'Fixture requires the dormant default';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role, 'private.classroom_test_quota_settings', 'SELECT')
      or has_table_privilege(v_role, 'private.classroom_test_quota_settings', 'UPDATE')
      or has_function_privilege(v_role, 'private.enforce_classroom_test_quota_v1()', 'EXECUTE') then
      raise exception 'Incorrect quota privileges for %', v_role;
    end if;
  end loop;
end;
$privileges$;

create function pg_temp.expect_test_error(p_classroom uuid, p_code text)
returns void language plpgsql as $$
begin
  begin
    insert into public.tests(classroom_id,title) values(p_classroom,'must fail');
    raise exception 'Expected % but insert succeeded', p_code;
  exception when others then
    if sqlstate <> p_code then raise; end if;
  end;
end;
$$;

do $behavior$
declare
  v_owner uuid := gen_random_uuid();
  v_class uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
  v_test uuid;
  v_revision bigint;
  v_plan text;
  v_cap integer;
  v_count bigint;
  v_offering uuid := gen_random_uuid();
  v_version uuid;
  v_features jsonb;
begin
  insert into public.users(id,email,role) values(v_owner,v_owner::text || '@quota253.example.invalid','teacher');
  select coalesce(max(revision),0) into v_revision from public.account_plans where subject_user_id=v_owner;
  perform public.set_account_plan_v1(gen_random_uuid(),v_owner,'pro','test:quota253','quota_fixture',v_revision);
  insert into public.classrooms(id,teacher_id,title,class_code) values
    (v_class,v_owner,'quota fixture',substr(v_class::text,1,8)),
    (v_target,v_owner,'transfer target',substr(v_target::text,1,8));

  -- Disabled compatibility permits more than the lowest future cap.
  insert into public.tests(classroom_id,title) select v_class,'old ' || n from generate_series(1,21) n;
  update private.classroom_test_quota_settings set enabled=true where singleton;

  -- tier boundaries: exact cap allowed, next row denied; all states count.
  for v_plan,v_cap in select * from (values('basic',20),('plus',50),('pro',100),('free',0)) tiers(plan,cap) loop
    update public.account_plans set plan_key=v_plan where subject_user_id=v_owner;
    delete from public.tests where classroom_id=v_class;
    insert into public.tests(classroom_id,title,status,blueprint_archived_at)
      select v_class,'tier ' || n,case n % 3 when 0 then 'draft' when 1 then 'active' else 'closed' end,
        case when n % 4=0 then now() else null end from generate_series(1,v_cap) n;
    perform pg_temp.expect_test_error(v_class,'PTC01');
    select count(*) into v_count from public.tests where classroom_id=v_class;
    if v_count <> v_cap then raise exception 'Incorrect boundary for %',v_plan; end if;
  end loop;

  update public.account_plans set plan_key='basic' where subject_user_id=v_owner;
  insert into public.tests(classroom_id,title) select v_class,'preserved ' || n from generate_series(1,20) n;
  select id into v_test from public.tests where classroom_id=v_class limit 1;
  -- grandfathered edits: lowering below 20 does not rewrite or block old rows.
  update public.account_plans set plan_key='free' where subject_user_id=v_owner;
  update public.tests set classroom_id=v_class,title='still editable',status='closed' where id=v_test;
  insert into public.tests(id,classroom_id,title) values(v_test,v_class,'replay') on conflict(id) do nothing;
  if (select count(*) from public.tests where classroom_id=v_class) <> 20 then raise exception 'Existing work changed'; end if;
  perform pg_temp.expect_test_error(v_class,'PTC01');

  -- identity mapping is not an exemption; privileged restore retains old rows.
  perform set_config('pika.identity_mapping','on',true);
  perform pg_temp.expect_test_error(v_class,'PTC01');
  perform set_config('pika.identity_mapping','off',true);
  perform set_config('pika.classroom_archive_restore','on',true);
  insert into public.tests(classroom_id,title) values(v_class,'retained restoration');
  perform set_config('pika.classroom_archive_restore','off',true);
  perform pg_temp.expect_test_error(v_class,'PTC01');

  -- bulk rollback: a statement crossing the limit leaves no partial rows.
  update public.account_plans set plan_key='basic' where subject_user_id=v_owner;
  insert into public.tests(classroom_id,title) select v_target,'target ' || n from generate_series(1,19) n;
  begin
    insert into public.tests(classroom_id,title) select v_target,'bulk ' || n from generate_series(1,2) n;
    raise exception 'Bulk exceeded cap';
  exception when sqlstate 'PTC01' then null; end;
  if (select count(*) from public.tests where classroom_id=v_target) <> 19 then raise exception 'Partial bulk survived'; end if;
  -- target transfer consumes destination capacity even when source is over cap.
  update public.tests set classroom_id=v_target where id=v_test;
  select id into v_test from public.tests where classroom_id=v_class limit 1;
  begin
    update public.tests set classroom_id=v_target where id=v_test;
    raise exception 'Transfer exceeded cap';
  exception when sqlstate 'PTC01' then null; end;
  if not exists(select 1 from public.tests where id=v_test and classroom_id=v_class) then raise exception 'Failed transfer lost source'; end if;

  -- unknown plan: no fallback to a label or classroom entitlement quantity.
  delete from public.account_plans where subject_user_id=v_owner;
  perform pg_temp.expect_test_error(v_class,'PTC02');
  insert into public.account_plans(subject_user_id,plan_key,revision) values(v_owner,'basic',1);

  -- billing terms: immutable old offerings remain unlimited; explicit valid
  -- limits bind the purchased version; null/string/negative/fraction fail closed.
  select id into v_offering from public.stripe_billing_offerings where plan_key='plus';
  if not found then
    v_offering := gen_random_uuid();
    insert into public.stripe_billing_offerings(id,plan_key) values(v_offering,'plus');
  end if;
  for v_features in select features from (values('{}'::jsonb),('{"tests_per_classroom":1}'),
    ('{"tests_per_classroom":null}'),('{"tests_per_classroom":"50"}'),
    ('{"tests_per_classroom":-1}'),('{"tests_per_classroom":1.5}')) inputs(features) loop
    v_version := gen_random_uuid();
    insert into public.stripe_billing_offering_versions(id,offering_id,version,stripe_account,stripe_product_id,stripe_price_id,currency,unit_amount,interval,classroom_limit,features)
      values(v_version,v_offering,(select coalesce(max(version),0)+1 from public.stripe_billing_offering_versions where offering_id=v_offering),
        'acct_quota253','prod_quota253','price_' || replace(v_version::text,'-',''),'usd',1,'month',5,v_features);
    update public.account_plans set plan_key='plus',management_source='billing',billing_offering_version_id=v_version where subject_user_id=v_owner;
    if not v_features ? 'tests_per_classroom' then
      insert into public.tests(classroom_id,title) values(v_class,'historical unlimited');
    elsif v_features->'tests_per_classroom' = '1'::jsonb then
      perform pg_temp.expect_test_error(v_class,'PTC01');
    else
      perform pg_temp.expect_test_error(v_class,'PTC02');
    end if;
  end loop;
  update public.account_plans set plan_key='basic',management_source='legacy',billing_offering_version_id=null where subject_user_id=v_owner;
  perform set_config('quota253.fixture_classroom',v_class::text,true);
end;
$behavior$;

-- Browser-role GUC spoofing remains denied even inside the SECURITY DEFINER
-- trigger. A disposable probe table isolates this check from unrelated RLS.
create temporary table quota253_probe(id uuid, classroom_id uuid);
create trigger quota253_probe_guard before insert on quota253_probe
for each row execute function private.enforce_classroom_test_quota_v1();
grant insert on quota253_probe to authenticated;
set local role authenticated;
select set_config('pika.classroom_archive_restore','on',true);
do $spoof$
begin
  begin
    insert into pg_temp.quota253_probe(id,classroom_id)
      values(gen_random_uuid(),current_setting('quota253.fixture_classroom')::uuid);
    raise exception 'Unprivileged restore GUC bypassed quota';
  exception when sqlstate 'PTC01' then null; end;
end;
$spoof$;
reset role;
select set_config('pika.classroom_archive_restore','off',true);

rollback;
