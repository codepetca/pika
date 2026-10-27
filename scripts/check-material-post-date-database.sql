-- Disposable-clone proof only. Every fixture and adversarial trigger rolls back.
begin;
set local statement_timeout = '30s';
set local timezone = 'UTC';
insert into public.users(id,email,role) values
 ('c2890000-0000-4000-8000-000000000001','material-post-owner@example.invalid','teacher'),
 ('c2890000-0000-4000-8000-000000000002','material-post-other@example.invalid','teacher');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),
 'c2890000-0000-4000-8000-000000000001', 'classrooms.create',
 'manual', true, clock_timestamp(), null, 10, 'test:material-post-date', 'material_post_date_rollback', 0);
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('c2890000-0000-4000-8000-000000000010','c2890000-0000-4000-8000-000000000001','Material post date','C289TEST');
create function pg_temp.material_post_date_tamper() returns trigger language plpgsql as $hook$
begin
 if new.title = 'Tampered' then new.position := old.position + 1; end if;
 return new;
end;
$hook$;
create trigger material_post_date_tamper before update on public.classwork_materials
for each row execute function pg_temp.material_post_date_tamper();
-- Create normal, draft, scheduled and historical-null fixtures through owner RPCs.
select public.create_classwork_material_for_owner_v3('c2890000-0000-4000-8000-000000000001','c2890000-0000-4000-8000-000000000010','Posted','{"type":"doc","content":[]}',false);
select public.create_classwork_material_for_owner_v3('c2890000-0000-4000-8000-000000000001','c2890000-0000-4000-8000-000000000010','Draft','{"type":"doc","content":[]}',true);
select public.create_classwork_material_for_owner_v3('c2890000-0000-4000-8000-000000000001','c2890000-0000-4000-8000-000000000010','Scheduled','{"type":"doc","content":[]}',false,clock_timestamp()+interval '2 days');
select public.create_classwork_material_for_owner_v3('c2890000-0000-4000-8000-000000000001','c2890000-0000-4000-8000-000000000010','Historical','{"type":"doc","content":[]}',false);
update public.classwork_materials set released_at=null where classroom_id='c2890000-0000-4000-8000-000000000010' and title='Historical';
set local role service_role;
do $proof$
declare
 actor uuid := 'c2890000-0000-4000-8000-000000000001';
 classroom uuid := 'c2890000-0000-4000-8000-000000000010';
 material uuid;
 result jsonb;
 original jsonb;
 before_rejection jsonb;
 patch jsonb;
 day text;
 expected timestamptz;
 future_day text := ((clock_timestamp() at time zone 'America/Toronto')::date + 1)::text;
begin
 if has_function_privilege('anon','public.update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb)','execute')
   or has_function_privilege('authenticated','public.update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb)','execute') then
   raise exception 'Owner RPC exposed to browser roles';
 end if;
 select to_jsonb(m) into original from public.classwork_materials m where classroom_id=classroom and title='Posted';
 material := (original->>'id')::uuid;
 -- Calendar labels, including future dates and DST days, never change availability.
 foreach day in array array['2020-01-15','2020-07-15','2020-03-08','2020-11-01','2024-02-29','0001-01-01','9999-12-31',future_day,((clock_timestamp() at time zone 'America/Toronto')::date)::text] loop
   expected := day::date::timestamp at time zone 'America/Toronto';
   result := public.update_classwork_material_for_owner_v1(actor,classroom,material,jsonb_build_object('posted_on',day));
   if result->'material'->>'posted_on' is distinct from day then raise exception 'Post date failed for %',day; end if;
   if ((result->'material') - 'posted_on' - 'updated_at') is distinct from (original - 'posted_on' - 'updated_at') then
     raise exception 'Post date changed an unrelated field';
   end if;
 end loop;
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"posted_on":"2020-01-15","title":"Edited","content":{"type":"doc","content":[]},"is_draft":false}');
 if result->'material'->>'title' <> 'Edited' or result->'material'->>'posted_on' <> '2020-01-15' then raise exception 'Combined edit failed'; end if;
 select to_jsonb(m) into before_rejection from public.classwork_materials m where id=material;
 for patch in select value from jsonb_array_elements(jsonb_build_array(
   '{"posted_on":null}'::jsonb,'{"posted_on":true}'::jsonb,'{"posted_on":1}'::jsonb,'{"posted_on":{}}'::jsonb,
   '{"posted_on":""}'::jsonb,'{"posted_on":"2024-2-01"}'::jsonb,'{"posted_on":"2024-02-30"}'::jsonb,
   '{"posted_on":"2023-02-29"}'::jsonb,'{"posted_on":"0000-01-01"}'::jsonb,'{"posted_on":"10000-01-01"}'::jsonb,
   '{"posted_on":"2024-13-01"}'::jsonb,'{"posted_on":"2024-01-00"}'::jsonb,'{"posted_on":"infinity"}'::jsonb,
   '{"posted_on":"2024-01-01T00:00:00Z"}'::jsonb,'{"posted_on":"2024-01-01 "}'::jsonb,
   '{"posted_on":"2024-01-01","position":2}'::jsonb)) loop
   begin
     perform public.update_classwork_material_for_owner_v1(actor,classroom,material,patch);
     raise exception 'Invalid post date accepted: %',patch;
   exception when invalid_parameter_value then null;
   end;
   if (select to_jsonb(m) from public.classwork_materials m where id=material) is distinct from before_rejection then
     raise exception 'Rejected patch changed a row';
   end if;
 end loop;
 begin
   perform public.update_classwork_material_for_owner_v1('c2890000-0000-4000-8000-000000000002',classroom,material,'{"posted_on":"2024-01-01"}');
   raise exception 'Nonowner post date accepted';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"posted_on":"2024-01-01","title":"Tampered"}');
   raise exception 'Immutable trigger tampering accepted';
 exception when sqlstate 'PT409' then null;
 end;
 if (select to_jsonb(m) from public.classwork_materials m where id=material) is distinct from before_rejection then raise exception 'Tamper rejection did not roll back'; end if;
 for material in select id from public.classwork_materials where classroom_id=classroom and title in ('Draft','Scheduled') loop
   select to_jsonb(m) into before_rejection from public.classwork_materials m where id=material;
   result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"posted_on":"9999-12-31"}');
   if ((result->'material') - 'posted_on' - 'updated_at') is distinct from (before_rejection - 'posted_on' - 'updated_at') then
     raise exception 'Draft/scheduled metadata edit changed publication';
   end if;
 end loop;
 select id into material from public.classwork_materials where classroom_id=classroom and title='Historical';
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"posted_on":"2024-01-01"}');
 if result->'material'->>'posted_on' <> '2024-01-01' or result->'material'->'released_at' is distinct from 'null'::jsonb then raise exception 'Historical-null date changed release'; end if;
end;
$proof$;
reset role;
update public.classrooms set archived_at=clock_timestamp() where id='c2890000-0000-4000-8000-000000000010';
set local role service_role;
do $proof$
begin
 begin
   perform public.update_classwork_material_for_owner_v1('c2890000-0000-4000-8000-000000000001','c2890000-0000-4000-8000-000000000010',
     (select id from public.classwork_materials where classroom_id='c2890000-0000-4000-8000-000000000010' and title='Historical'),'{"posted_on":"2024-01-01"}');
   raise exception 'Archived classroom post date accepted';
 exception when insufficient_privilege then null;
 end;
end;
$proof$;
reset role;
rollback;
