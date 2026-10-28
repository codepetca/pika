-- Isolated replay/rollback-only migration 294 contract. Synthetic accounts only.
-- Must run as postgres in a disposable replay database, never a shared database.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- A deliberately independent digest implementation verifies the wire format.
create function pg_temp.admission_digest(kind text, ids uuid[], exclusions uuid[] default '{}'::uuid[])
returns text language sql immutable set search_path = '' as $$
 select encode(extensions.digest(convert_to('classroom-admission-v2' || chr(10) || kind || chr(10) ||
   array_to_string(array(select id::text from unnest(ids) id order by id::text collate "C"),chr(10)) ||
   chr(10) || '--excluded--' || chr(10) ||
   array_to_string(array(select id::text from unnest(exclusions) id order by id::text collate "C"),chr(10)),
   'UTF8'),'sha256'),'hex')
$$;

-- Run arbitrary calls in exception subtransactions and prove complete rejection.
create function pg_temp.refuses(statement text, expected_state text, expected_message text)
returns void language plpgsql as $$
declare before_revision bigint; before_grants bigint; before_batches bigint; before_exclusions bigint;
begin
 select registry_revision into before_revision from private.classroom_experience_admission_policy;
 select count(*) into before_grants from private.classroom_experience_admission_grants;
 select count(*) into before_batches from private.classroom_experience_admission_batches;
 select count(*) into before_exclusions from private.classroom_experience_admission_exclusions;
 begin
   execute statement;
   raise exception 'Fixture expected rejection: %', statement;
 exception when others then
   if sqlstate <> expected_state or (expected_message is not null and sqlerrm <> expected_message) then
     raise exception 'Fixture expected %/%, got %/%', expected_state, expected_message, sqlstate, sqlerrm;
   end if;
 end;
 if before_revision <> (select registry_revision from private.classroom_experience_admission_policy)
   or before_grants <> (select count(*) from private.classroom_experience_admission_grants)
   or before_batches <> (select count(*) from private.classroom_experience_admission_batches)
   or before_exclusions <> (select count(*) from private.classroom_experience_admission_exclusions) then
   raise exception 'Rejected batch changed registry';
 end if;
end
$$;

-- Metadata/ACL contract: PUBLIC has no execute, service has only the reviewed RPCs.
do $acl$
declare item text; role_name text; routine text; proc record;
begin
 foreach item in array array['policy','batches','grants','exclusions'] loop
   if not exists(select 1 from pg_class where oid = ('private.classroom_experience_admission_' || item)::regclass and relrowsecurity) then
     raise exception 'Registry RLS missing: %',item;
   end if;
   foreach role_name in array array['anon','authenticated','service_role'] loop
     if has_table_privilege(role_name,'private.classroom_experience_admission_' || item,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
       raise exception 'Unexpected registry table privilege: % %',item,role_name;
     end if;
   end loop;
   if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid = ('private.classroom_experience_admission_' || item)::regclass and a.grantee = 0) then
     raise exception 'PUBLIC registry table ACL: %',item;
   end if;
 end loop;
 foreach routine in array array[
   'public.read_classroom_experience_admission_v2(uuid)',
   'public.commit_classroom_experience_admission_batch_v2(uuid,bigint,text,uuid[],uuid[],text,text)',
   'public.read_classroom_experience_admission_operation_v2(uuid)'] loop
   select p.*, r.rolname into proc from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = routine::regprocedure;
   if not proc.prosecdef or proc.rolname <> 'postgres' or not proc.proconfig @> array['search_path=""']::text[]
     or has_function_privilege('anon',routine,'execute')
     or has_function_privilege('authenticated',routine,'execute')
     or not has_function_privilege('service_role',routine,'execute')
     or exists(select 1 from aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) where grantee = 0) then
     raise exception 'Registry RPC metadata/ACL invalid: %',routine;
   end if;
   if routine not like '%commit_%' and proc.provolatile <> 's' then raise exception 'Read RPC must be STABLE'; end if;
 end loop;
 if has_function_privilege('service_role','private.classroom_experience_admission_manifest_v2(text,uuid[],uuid[])','execute')
   or has_function_privilege('anon','private.classroom_experience_admission_manifest_v2(text,uuid[],uuid[])','execute') then
   raise exception 'Private helper is callable';
 end if;
 if (select count(*) from private.classroom_experience_admission_grants) <> 0
   or (select count(*) from private.classroom_experience_admission_batches) <> 0
   or (select count(*) from private.classroom_experience_admission_exclusions) <> 0
   or not exists(select 1 from private.classroom_experience_admission_policy
     where singleton and registry_revision = 0 and not growth_enabled and not bootstrap_initialized and bootstrap_manifest_sha256 is null) then
   raise exception 'Migration must start inactive and empty';
 end if;
end
$acl$;

insert into public.users(id,email,role)
select ('e2940000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'admission-294-' || n || '@example.invalid', 'student'
from generate_series(1,150) n;

create temp table admission_fixture as
select array_agg(id order by id) filter(where n <= 70) bootstrap,
       array_agg(id order by id) filter(where n between 71 and 110) expansion,
       array_agg(id order by id) filter(where n between 111 and 112) excluded,
       array_agg(id order by id) filter(where n between 113 and 114) unused
from (select n, ('e2940000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid id from generate_series(1,150) n) s;

-- Fail-closed before initialization, including unknown outcomes (no row created).
select pg_temp.refuses($$select public.read_classroom_experience_admission_v2('e2940000-0000-4000-8000-000000000001')$$,
 'PT503','classroom_admission_registry_uninitialized');
select pg_temp.refuses($$select public.read_classroom_experience_admission_v2(null)$$,
 '22023','classroom_admission_actor_required');
do $$begin
 if public.read_classroom_experience_admission_operation_v2('e2949999-0000-4000-8000-000000000001') is not null then
   raise exception 'Unknown operation reconciliation must be null';
 end if;
end $$;

-- Invalid bootstrap manifests must not initialize policy or insert a partial grant.
do $invalid_bootstrap$
declare f record; ids uuid[]; excluded uuid[];
begin
 select * into f from admission_fixture;
 ids := f.bootstrap[1:69];
   -- A 69-account manifest is well-formed but cannot initialize the registry.
   perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,0,%L,%L::uuid[],%L::uuid[],%L,%L)',
     'e2942000-0000-4000-8000-000000000001','bootstrap',ids,'{}',pg_temp.admission_digest('bootstrap',ids),'fixture/count'),
     '22023','classroom_admission_manifest_invalid');
 excluded := array[f.bootstrap[1]];
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,0,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2942000-0000-4000-8000-000000000001','bootstrap',f.bootstrap,excluded,pg_temp.admission_digest('bootstrap',f.bootstrap,excluded),'fixture/overlap'),
   '22023','classroom_admission_manifest_invalid');
end
$invalid_bootstrap$;

-- Bootstrap exact 70, with exclusions, is the only initializer; growth stays stopped.
do $bootstrap$
declare f record; actual jsonb; replay jsonb; digest text;
begin
 select * into f from admission_fixture;
 digest := pg_temp.admission_digest('bootstrap',f.bootstrap,f.excluded);
 actual := public.commit_classroom_experience_admission_batch_v2(
   'e2941000-0000-4000-8000-000000000001',0,'bootstrap',f.bootstrap,f.excluded,digest,'fixture/bootstrap-294');
 if actual->>'registry_revision' <> '1' or actual->>'growth_enabled' <> 'false' or actual->>'admitted_count' <> '70' then
   raise exception 'Bootstrap result invalid: %',actual;
 end if;
 replay := public.commit_classroom_experience_admission_batch_v2(
   'e2941000-0000-4000-8000-000000000001',0,'bootstrap',f.bootstrap,f.excluded,digest,'fixture/bootstrap-294');
 if replay <> actual or public.read_classroom_experience_admission_operation_v2('e2941000-0000-4000-8000-000000000001') <> actual then
   raise exception 'Bootstrap replay/reconciliation differs';
 end if;
end
$bootstrap$;

-- Whole-operation failure: each rejected mixed batch leaves no partial first grant.
do $rejects$
declare f record; ids uuid[]; exclusions uuid[] := '{}'; op uuid := 'e2942000-0000-4000-8000-000000000001';
begin
 select * into f from admission_fixture;
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,1,%L,%L::uuid[],%L::uuid[],%L,%L)',
   op,'operator',f.expansion,exclusions,pg_temp.admission_digest('operator',f.expansion),'fixture/stopped'),
   '55000','classroom_admission_growth_stopped');
 perform public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000002',1,'growth_on','{}','{}',pg_temp.admission_digest('growth_on','{}'),'fixture/growth-on');
 -- Unknown ID, including an otherwise valid first member.
 ids := f.unused || 'e294ffff-0000-4000-8000-000000000001'::uuid;
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,2,%L,%L::uuid[],%L::uuid[],%L,%L)',op,'operator',ids,exclusions,pg_temp.admission_digest('operator',ids),'fixture/unknown'),'23503','classroom_admission_unknown_user');
 ids := f.unused || f.excluded[1];
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,2,%L,%L::uuid[],%L::uuid[],%L,%L)',op,'operator',ids,exclusions,pg_temp.admission_digest('operator',ids),'fixture/excluded'),'23505','classroom_admission_identity_conflict');
 ids := f.unused || f.bootstrap[1];
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,2,%L,%L::uuid[],%L::uuid[],%L,%L)',op,'operator',ids,exclusions,pg_temp.admission_digest('operator',ids),'fixture/existing'),'23505','classroom_admission_identity_conflict');
 ids := f.unused || f.unused[1];
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,2,%L,%L::uuid[],%L::uuid[],%L,%L)',op,'operator',ids,exclusions,pg_temp.admission_digest('operator',ids),'fixture/duplicate'),'22023','classroom_admission_manifest_invalid');
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,1,%L,%L::uuid[],%L::uuid[],%L,%L)',op,'operator',f.unused,exclusions,pg_temp.admission_digest('operator',f.unused),'fixture/stale'),'40001','classroom_admission_revision_conflict');
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,2,%L,%L::uuid[],%L::uuid[],%L,%L)',op,'operator',f.unused,exclusions,repeat('0',64),'fixture/digest'),'22023','classroom_admission_manifest_invalid');
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,2,%L,%L::uuid[],%L::uuid[],%L,%L)',op,'operator',f.unused,exclusions,pg_temp.admission_digest('operator',f.unused),'email@example.invalid'),'22023','classroom_admission_batch_invalid');
 -- Every request field, including approval, remains bound on replay.
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,0,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000001','bootstrap',f.bootstrap,f.excluded,pg_temp.admission_digest('bootstrap',f.bootstrap,f.excluded),'fixture/changed-approval'),'23505','classroom_admission_operation_conflict');
end
$rejects$;

select pg_temp.refuses($$select public.commit_classroom_experience_admission_batch_v2('e2942000-0000-4000-8000-000000000002',2,'operator',array[null]::uuid[],'{}',repeat('0',64),'fixture/null')$$,'22023','classroom_admission_manifest_invalid');
select pg_temp.refuses($$select public.commit_classroom_experience_admission_batch_v2('e2942000-0000-4000-8000-000000000002',2,'operator',array[['e2940000-0000-4000-8000-000000000113','e2940000-0000-4000-8000-000000000114']]::uuid[],'{}',repeat('0',64),'fixture/dimensions')$$,'22023','classroom_admission_batch_invalid');
select pg_temp.refuses($$select public.read_classroom_experience_admission_v2('malformed')$$,'22P02',null);

select pg_temp.refuses($$select public.commit_classroom_experience_admission_batch_v2('e2942000-0000-4000-8000-000000000002',2,'operator',null,'{}',repeat('0',64),'fixture/null-array')$$,'22023','classroom_admission_batch_invalid');
select pg_temp.refuses($$select public.commit_classroom_experience_admission_batch_v2('e2942000-0000-4000-8000-000000000002',2,'operator',array[]::uuid[],'{}',repeat('F',64),'fixture/uppercase-digest')$$,'22023','classroom_admission_batch_invalid');
select pg_temp.refuses($$select public.commit_classroom_experience_admission_batch_v2('e2942000-0000-4000-8000-000000000002',2,'growth_off',array['e2940000-0000-4000-8000-000000000113']::uuid[],'{}',repeat('0',64),'fixture/control-grant')$$,'22023','classroom_admission_manifest_invalid');
select pg_temp.refuses($$select public.commit_classroom_experience_admission_batch_v2('e2942000-0000-4000-8000-000000000002',2,'operator',array_fill('e2940000-0000-4000-8000-000000000113'::uuid,array[5001]),'{}',repeat('0',64),'fixture/oversized')$$,'22023','classroom_admission_manifest_invalid');

-- Beyond 100 is retained; operator grants never enter the bootstrap provider set.
do $expansion$
declare f record; actual jsonb; decision jsonb; actor uuid; original_digest text;
begin
 select * into f from admission_fixture;
 original_digest := pg_temp.admission_digest('bootstrap',f.bootstrap,f.excluded);
 actual := public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000003',2,'operator',f.expansion,'{}',pg_temp.admission_digest('operator',f.expansion),'fixture/expansion');
 if actual->>'registry_revision' <> '3' or (select count(*) from private.classroom_experience_admission_grants) <> 110 then raise exception 'Expansion truncated'; end if;
 -- Stop was prepared at revision2 before the winning operator batch committed.
 actual := public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000004',2,'growth_off','{}','{}',pg_temp.admission_digest('growth_off','{}'),'fixture/growth-off');
 if actual->>'requested_revision' <> '2' or actual->>'predecessor_revision' <> '3' or actual->>'registry_revision' <> '4'
   or actual->>'growth_enabled' <> 'false' then raise exception 'Old-observed stop lost to committed batch: %',actual; end if;
 if not exists(select 1 from private.classroom_experience_admission_batches where operation_id = 'e2941000-0000-4000-8000-000000000004'
   and expected_revision = 2 and predecessor_revision = 3 and registry_revision = 4) then raise exception 'Stop ledger conflated requested and actual revisions'; end if;
 foreach actor in array f.bootstrap || f.expansion || f.excluded || f.unused loop
   decision := public.read_classroom_experience_admission_v2(actor);
   if decision <> jsonb_build_object('version',2,'registry_revision',4,'bootstrap_manifest_sha256',original_digest,
      'actor_id',actor,'admitted',actor = any(f.bootstrap || f.expansion),'bootstrap_member',actor = any(f.bootstrap)) then
      raise exception 'Actor decision differs after growth stop: %',decision;
   end if;
 end loop;
 decision := public.read_classroom_experience_admission_v2('e294ffff-0000-4000-8000-000000000001');
 if decision->>'admitted' <> 'false' or decision->>'bootstrap_member' <> 'false' then raise exception 'Unknown actor admitted'; end if;
 -- The bootstrap idempotency result survives subsequent revisions and policy stop.
 if public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000001',0,'bootstrap',f.bootstrap,f.excluded,original_digest,'fixture/bootstrap-294')->>'registry_revision' <> '1' then raise exception 'Old replay changed'; end if;
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,4,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000005','operator',f.unused,'{}',pg_temp.admission_digest('operator',f.unused),'fixture/still-stopped'),'55000','classroom_admission_growth_stopped');
end
$expansion$;

-- Historical stop retries reconcile without stopping a later explicit resume.
-- A fresh restrictive operation may intentionally stop that resumed policy using
-- an old observed revision; enable/admission retain strict compare-and-swap.
do $stop_priority$
declare saved jsonb; replay jsonb; stopped jsonb; f record;
begin
 select * into f from admission_fixture;
 saved := public.read_classroom_experience_admission_operation_v2('e2941000-0000-4000-8000-000000000004');
 perform public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000006',4,'growth_on','{}','{}',pg_temp.admission_digest('growth_on','{}'),'fixture/resume');
 replay := public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000004',2,'growth_off','{}','{}',pg_temp.admission_digest('growth_off','{}'),'fixture/growth-off');
 if replay <> saved or not exists(select 1 from private.classroom_experience_admission_policy where registry_revision = 5 and growth_enabled) then
   raise exception 'Historical stop replay changed resumed growth';
 end if;
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,3,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000004','growth_off','{}','{}',pg_temp.admission_digest('growth_off','{}'),'fixture/growth-off'),
   '23505','classroom_admission_operation_conflict');
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,4,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000008','growth_on','{}','{}',pg_temp.admission_digest('growth_on','{}'),'fixture/stale-enable'),
   '40001','classroom_admission_revision_conflict');
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,4,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000008','operator',f.unused,'{}',pg_temp.admission_digest('operator',f.unused),'fixture/stale-admit'),
   '40001','classroom_admission_revision_conflict');
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,6,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000008','growth_off','{}','{}',pg_temp.admission_digest('growth_off','{}'),'fixture/future-stop'),
   '40001','classroom_admission_revision_conflict');
 stopped := public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000007',2,'growth_off','{}','{}',pg_temp.admission_digest('growth_off','{}'),'fixture/distinct-old-stop');
 if stopped->>'requested_revision' <> '2' or stopped->>'predecessor_revision' <> '5' or stopped->>'registry_revision' <> '6'
   or stopped->>'growth_enabled' <> 'false' or not exists(select 1 from private.classroom_experience_admission_policy where registry_revision = 6 and not growth_enabled)
   or (select count(*) from private.classroom_experience_admission_grants) <> 110 then
   raise exception 'Distinct old-observed stop failed or removed retained grants';
 end if;
 if public.read_classroom_experience_admission_v2(f.expansion[40])->>'admitted' <> 'true'
   or public.read_classroom_experience_admission_v2(f.expansion[40])->>'bootstrap_member' <> 'false' then
   raise exception 'Stop changed retained non-bootstrap compatibility';
 end if;
end
$stop_priority$;

-- Synthetic owner setup is confined to this fixture savepoint and rolled back.
-- Production cannot reach the last safe revision while growth remains enabled.
savepoint admission_revision_ceiling;
alter table private.classroom_experience_admission_policy disable trigger classroom_admission_policy_guard;
update private.classroom_experience_admission_policy set registry_revision = 9007199254740990, growth_enabled = true;
alter table private.classroom_experience_admission_policy enable trigger classroom_admission_policy_guard;
do $revision_ceiling$
declare stopped jsonb;
begin
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,9007199254740990,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000009','growth_on','{}','{}',pg_temp.admission_digest('growth_on','{}'),'fixture/ceiling-enable'),
   '55000','classroom_admission_revision_exhausted');
 perform pg_temp.refuses($sql$update private.classroom_experience_admission_policy set registry_revision = registry_revision + 1, growth_enabled = true$sql$,
   '23514',null);
 stopped := public.commit_classroom_experience_admission_batch_v2('e2941000-0000-4000-8000-000000000010',6,'growth_off','{}','{}',pg_temp.admission_digest('growth_off','{}'),'fixture/ceiling-stop');
 if stopped->>'requested_revision' <> '6' or stopped->>'predecessor_revision' <> '9007199254740990'
   or stopped->>'registry_revision' <> '9007199254740991' or stopped->>'growth_enabled' <> 'false'
   or not exists(select 1 from private.classroom_experience_admission_policy where registry_revision = 9007199254740991 and not growth_enabled)
   or (select count(*) from private.classroom_experience_admission_grants) <> 110 then
   raise exception 'Last safe increment did not preserve restrictive stop';
 end if;
 perform pg_temp.refuses(format('select public.commit_classroom_experience_admission_batch_v2(%L,9007199254740991,%L,%L::uuid[],%L::uuid[],%L,%L)',
   'e2941000-0000-4000-8000-000000000011','growth_on','{}','{}',pg_temp.admission_digest('growth_on','{}'),'fixture/exhausted-enable'),
   '55000','classroom_admission_revision_exhausted');
 if public.read_classroom_experience_admission_v2('e2940000-0000-4000-8000-000000000110')->>'admitted' <> 'true' then
   raise exception 'Revision ceiling changed retained admission';
 end if;
end
$revision_ceiling$;
rollback to savepoint admission_revision_ceiling;
release savepoint admission_revision_ceiling;

select pg_temp.refuses($$update private.classroom_experience_admission_grants set origin_operation_id = 'e2941000-0000-4000-8000-000000000003'$$,'55000','classroom_admission_record_immutable');
select pg_temp.refuses($$delete from private.classroom_experience_admission_grants$$,'55000','classroom_admission_record_immutable');
select pg_temp.refuses($$delete from private.classroom_experience_admission_batches$$,'55000','classroom_admission_record_immutable');
select pg_temp.refuses($$delete from private.classroom_experience_admission_exclusions$$,'55000','classroom_admission_record_immutable');

select pg_temp.refuses($$update private.classroom_experience_admission_policy set registry_revision = registry_revision + 1, bootstrap_manifest_sha256 = repeat('0',64)$$,'55000','classroom_admission_policy_immutable');
select pg_temp.refuses($$delete from private.classroom_experience_admission_policy$$,'55000','classroom_admission_policy_immutable');

-- Actual role execution supplements catalog checks (all rolled back).
set local role anon;
do $denied$ begin
 begin
   perform public.read_classroom_experience_admission_v2('e2940000-0000-4000-8000-000000000001');
   raise exception 'anon could execute admission read';
 exception when insufficient_privilege then null; end;
 begin
   perform public.commit_classroom_experience_admission_batch_v2(null,null,null,null,null,null,null);
   raise exception 'anon could execute admission writer';
 exception when insufficient_privilege then null; end;
end $denied$;
reset role;
set local role authenticated;
do $denied$ begin
 begin
   perform public.read_classroom_experience_admission_operation_v2('e2941000-0000-4000-8000-000000000003');
   raise exception 'authenticated could reconcile admissions';
 exception when insufficient_privilege then null; end;
 begin
   perform public.commit_classroom_experience_admission_batch_v2(null,null,null,null,null,null,null);
   raise exception 'authenticated could execute admission writer';
 exception when insufficient_privilege then null; end;
end $denied$;
reset role;
set local role service_role;
select public.read_classroom_experience_admission_v2('e2940000-0000-4000-8000-000000000001');
select public.read_classroom_experience_admission_operation_v2('e2941000-0000-4000-8000-000000000003');
reset role;

select 'classroom admission registry native contract PASS' as result;
rollback;
