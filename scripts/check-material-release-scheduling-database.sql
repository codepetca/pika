-- Disposable or rollback-only proof; never applies a migration to a shared database.
begin;
set local statement_timeout = '30s';
-- Schema-only clones contain no activation/settings seed rows.
insert into private.classroom_creation_entitlement_settings(singleton) values(true) on conflict do nothing;
insert into public.users(id,email,role) values
 ('c2830000-0000-4000-8000-000000000001','material-schedule-owner@example.invalid','teacher'),
 ('c2830000-0000-4000-8000-000000000002','material-schedule-other@example.invalid','teacher');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),
 'c2830000-0000-4000-8000-000000000001', 'classrooms.create',
 'manual', true, clock_timestamp(), null, 10, 'test:material-scheduling', 'material_scheduling_rollback', 0);
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('c2830000-0000-4000-8000-000000000010','c2830000-0000-4000-8000-000000000001','Material scheduling','C283TEST');
create function pg_temp.reject_material_schedule() returns trigger language plpgsql as $hook$
begin
 if new.title = 'Rollback create' and new.released_at > clock_timestamp() then
   raise exception using errcode = '22023', message = 'Forced schedule failure';
 end if;
 return new;
end;
$hook$;
create trigger material_schedule_forced_failure before update on public.classwork_materials
for each row execute function pg_temp.reject_material_schedule();
set local role service_role;
do $proof$
declare
 actor uuid := 'c2830000-0000-4000-8000-000000000001';
 classroom uuid := 'c2830000-0000-4000-8000-000000000010';
 schedule timestamptz := clock_timestamp() + interval '2 days';
 result jsonb;
 material uuid;
 original jsonb;
begin
 if has_function_privilege('anon', 'public.create_classwork_material_for_owner_v3(uuid,uuid,text,jsonb,boolean,timestamptz)', 'execute')
   or has_function_privilege('authenticated', 'public.create_classwork_material_for_owner_v3(uuid,uuid,text,jsonb,boolean,timestamptz)', 'execute') then
   raise exception 'Scheduling RPC exposed to browser roles';
 end if;
 result := public.create_classwork_material_for_owner_v3(actor,classroom,'Reference','{"type":"doc","content":[]}',false,schedule);
 original := result->'material';
 material := (original->>'id')::uuid;
 if (original->>'released_at')::timestamptz is distinct from schedule or (original->>'is_draft')::boolean then
   raise exception 'Create schedule failed';
 end if;
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"title":"Edited"}');
 if (result->'material'->>'released_at')::timestamptz is distinct from schedule then raise exception 'Edit lost schedule'; end if;
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"is_draft":true}');
 if result->'material'->'released_at' <> 'null'::jsonb or not (result->'material'->>'is_draft')::boolean then raise exception 'Draft did not cancel'; end if;
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,jsonb_build_object('scheduled_for',schedule));
 if (result->'material'->>'released_at')::timestamptz is distinct from schedule or (result->'material'->>'is_draft')::boolean then raise exception 'Reschedule failed'; end if;
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"scheduled_for":null}');
 if (result->'material'->>'released_at')::timestamptz > clock_timestamp() or (result->'material'->>'is_draft')::boolean then raise exception 'Post now failed'; end if;
 if result->'material'->'artifact_id' is distinct from original->'artifact_id'
   or result->'material'->'position' is distinct from original->'position'
   or result->'material'->'created_by' is distinct from original->'created_by' then raise exception 'Immutable identity drift'; end if;
 begin
   perform public.update_classwork_material_for_owner_v1('c2830000-0000-4000-8000-000000000002',classroom,material,jsonb_build_object('scheduled_for',schedule));
   raise exception 'Nonowner schedule accepted';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"scheduled_for":"2020-01-01T00:00:00Z"}');
   raise exception 'Past schedule accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.create_classwork_material_for_owner_v3(actor,classroom,'Invalid draft','{"type":"doc"}',true,schedule);
   raise exception 'Draft schedule accepted';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.create_classwork_material_for_owner_v3(actor,classroom,'Rollback create','{"type":"doc"}',false,schedule);
   raise exception 'Forced schedule failure was ignored';
 exception when invalid_parameter_value then null;
 end;
 if exists(select 1 from public.classwork_materials where classroom_id=classroom and title='Rollback create') then
   raise exception 'Failed nested publication left its created row';
 end if;
 -- A forced publication failure must roll back the nested successful creator.
 begin
   perform public.create_classwork_material_for_owner_v3(actor,classroom,'Past create','{"type":"doc"}',false,clock_timestamp() - interval '1 day');
   raise exception 'Past creation accepted';
 exception when invalid_parameter_value then null;
 end;
 if exists(select 1 from public.classwork_materials where classroom_id=classroom and title in ('Past create','Invalid draft')) then
   raise exception 'Invalid creation left a durable row';
 end if;
end;
$proof$;
reset role;
rollback;
