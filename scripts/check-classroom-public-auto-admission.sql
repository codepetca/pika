-- Synthetic fixture only: run in a disposable database after migrations 294 and 297.
-- Never run against a shared database.
begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
insert into public.users(id,email_verified_at)
select ('e2970000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  case when n = 74 then null else now() end
from generate_series(1,75) n;
create function pg_temp.batch(kind text, operation_id uuid, expected bigint, users uuid[], excluded uuid[])
returns jsonb language sql as $$
 select public.commit_classroom_experience_admission_batch_v2(operation_id, expected,kind,users,excluded,
 private.classroom_experience_admission_manifest_v2(kind,users,excluded),'synthetic-test')
$$;
select pg_temp.batch('bootstrap','00000000-0000-4000-8000-000000000001',0,
  array(select ('e2970000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,70) n),
  array['e2970000-0000-4000-8000-000000000071'::uuid]);
do $test$
declare r jsonb; rev bigint;
begin
  if (select enabled from private.classroom_public_auto_admission_policy where singleton) then raise exception 'auto must default off'; end if;
  if has_function_privilege('anon','public.read_verified_classroom_auto_admission_eligibility_v1(uuid,text)','execute')
    or has_function_privilege('authenticated','public.read_verified_classroom_auto_admission_eligibility_v1(uuid,text)','execute')
    or not has_function_privilege('service_role','public.read_verified_classroom_auto_admission_eligibility_v1(uuid,text)','execute')
    or has_function_privilege('anon','public.ensure_verified_classroom_admission_v1(uuid,text)','execute')
    or has_function_privilege('authenticated','public.ensure_verified_classroom_admission_v1(uuid,text)','execute')
    or not has_function_privilege('service_role','public.ensure_verified_classroom_admission_v1(uuid,text)','execute')
    or has_function_privilege('anon','public.set_classroom_auto_admission_enabled_v1(boolean)','execute')
    or has_function_privilege('authenticated','public.set_classroom_auto_admission_enabled_v1(boolean)','execute')
    or not has_function_privilege('service_role','public.set_classroom_auto_admission_enabled_v1(boolean)','execute')
    or has_table_privilege('service_role','private.classroom_public_auto_admission_policy','select') then
    raise exception 'auto ACL mismatch';
  end if;
  if (public.read_verified_classroom_auto_admission_eligibility_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'eligible')::boolean then raise exception 'disabled offer'; end if;
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'growth_stopped' then raise exception 'master stop failed'; end if;
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000071', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'excluded' then raise exception 'exclusion failed'; end if;
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000074', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'unverified' then raise exception 'verification failed'; end if;
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000001', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'already_admitted' then raise exception 'retained bootstrap failed'; end if;
  begin
    perform public.set_classroom_auto_admission_enabled_v1(true);
    raise exception 'enabled while stopped';
  exception when sqlstate '55000' then null; end;
  perform pg_temp.batch('growth_on','00000000-0000-4000-8000-000000000002',1,'{}','{}');
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'growth_stopped' then raise exception 'operator growth enabled auto'; end if;
  perform public.set_classroom_auto_admission_enabled_v1(true);
  perform public.set_classroom_auto_admission_enabled_v1(true); -- idempotent
  begin
    perform public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072',repeat('f',64));
    raise exception 'mismatched manifest admitted';
  exception when sqlstate 'PT503' then null; end;
  begin
    perform public.read_verified_classroom_auto_admission_eligibility_v1('e2970000-0000-4000-8000-000000000072',repeat('f',64));
    raise exception 'mismatched eligibility returned';
  exception when sqlstate 'PT503' then null; end;
  if (select count(*) from private.classroom_experience_admission_grants) <> 70 then raise exception 'mismatch changed grant set'; end if;
  if not (public.read_verified_classroom_auto_admission_eligibility_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'eligible')::boolean
    or (public.read_verified_classroom_auto_admission_eligibility_v1('e2970000-0000-4000-8000-000000000071', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'eligible')::boolean
    or (public.read_verified_classroom_auto_admission_eligibility_v1('e2970000-0000-4000-8000-000000000074', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'eligible')::boolean
    or (public.read_verified_classroom_auto_admission_eligibility_v1('e2970000-0000-4000-8000-000000000001', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'eligible')::boolean then
    raise exception 'eligibility incorrectly exposed';
  end if;
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'admitted' or (r->>'registry_revision')::int <> 3 then raise exception 'grant failed'; end if;
  if (public.read_verified_classroom_auto_admission_eligibility_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton))->>'eligible')::boolean then raise exception 'granted offer'; end if;
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'already_admitted' or (r->>'registry_revision')::int <> 3 then raise exception 'duplicate failed'; end if;
  if (select count(*) from private.classroom_experience_admission_grants) <> 71
    or (public.read_classroom_experience_admission_v2('e2970000-0000-4000-8000-000000000072')->>'bootstrap_member')::boolean
    or not (public.read_classroom_experience_admission_v2('e2970000-0000-4000-8000-000000000001')->>'bootstrap_member')::boolean then
    raise exception 'origin or retained grants changed';
  end if;
  perform pg_temp.batch('growth_off','00000000-0000-4000-8000-000000000003',3,'{}','{}');
  if (select enabled from private.classroom_public_auto_admission_policy) then raise exception 'master stop failed to clear auto'; end if;
  perform pg_temp.batch('growth_on','00000000-0000-4000-8000-000000000004',4,'{}','{}');
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000073', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'growth_stopped' then raise exception 'operator reopen re-enabled auto'; end if;
  r := public.ensure_verified_classroom_admission_v1('e2970000-0000-4000-8000-000000000072', (select bootstrap_manifest_sha256 from private.classroom_experience_admission_policy where singleton));
  if r->>'outcome' <> 'already_admitted' then raise exception 'stop removed prior access'; end if;
end
$test$;
rollback;
