-- Owned disposable clone only. Atomic create, compatibility, and adversarial
-- date-update checks supplement the historical owner/scheduling proof matrices.
begin;
set local statement_timeout = '30s';
insert into public.users(id,email,role) values
 ('c2940000-0000-4000-8000-000000000001','calendar-owner@example.invalid','teacher'),
 ('c2940000-0000-4000-8000-000000000002','calendar-other@example.invalid','teacher');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),
 'c2940000-0000-4000-8000-000000000001', 'classrooms.create',
 'manual',true,clock_timestamp(),null,10,'test:calendar','calendar_rollback',0);
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('c2940000-0000-4000-8000-000000000010','c2940000-0000-4000-8000-000000000001','Calendar labels','C294TEST');
create function pg_temp.calendar_before_tamper() returns trigger language plpgsql as $hook$
begin
 if new.posted_on = date '2094-01-01' then new.posted_on := date '2094-01-02'; end if;
 return new;
end;
$hook$;
create function pg_temp.calendar_after_tamper() returns trigger language plpgsql as $hook$
begin
 if new.posted_on = date '2094-02-01' and pg_trigger_depth() = 1 then
   if tg_table_name = 'announcements' then
     update public.announcements set posted_on = date '2094-02-02' where id = new.id;
   else
     update public.classwork_materials set posted_on = date '2094-02-02' where id = new.id;
   end if;
 end if;
 return new;
end;
$hook$;
create trigger calendar_before_tamper before update on public.announcements for each row execute function pg_temp.calendar_before_tamper();
create trigger calendar_before_tamper before update on public.classwork_materials for each row execute function pg_temp.calendar_before_tamper();
create trigger calendar_after_tamper after update on public.announcements for each row execute function pg_temp.calendar_after_tamper();
create trigger calendar_after_tamper after update on public.classwork_materials for each row execute function pg_temp.calendar_after_tamper();
set local role service_role;
do $proof$
declare
 actor uuid := 'c2940000-0000-4000-8000-000000000001';
 classroom uuid := 'c2940000-0000-4000-8000-000000000010';
 result jsonb;
 material uuid;
 announcement uuid;
 schedule timestamptz := clock_timestamp()+interval '3 days';
 before_row jsonb;
 original_revision bigint;
 day date;
 rpc text;
 n bigint;
begin
 foreach rpc in array array['public.create_announcement_for_owner_v2(uuid,uuid,text,boolean,timestamptz,text,date)',
 'public.create_classwork_material_for_owner_v4(uuid,uuid,text,jsonb,boolean,timestamptz,date)'] loop
   if has_function_privilege('anon',rpc,'execute') or has_function_privilege('authenticated',rpc,'execute')
     or not has_function_privilege('service_role',rpc,'execute') then raise exception 'Wrong new RPC ACL: %',rpc; end if;
 end loop;
 result := public.create_classwork_material_for_owner_v3(actor,classroom,'Legacy','{"type":"doc","content":[]}',false);
 if result->'material' ? 'posted_on' then raise exception 'Legacy null material result widened'; end if;
 material := (result->'material'->>'id')::uuid;
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"title":"Legacy saved"}');
 if result->'material' ? 'posted_on' then raise exception 'Legacy null update result widened'; end if;
 result := public.create_announcement_for_owner_v1(actor,classroom,'Legacy',false,null,'Legacy');
 announcement := (result->'announcement'->>'id')::uuid;
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"title":"Legacy saved"}');
 if result->'announcement' ? 'posted_on' then raise exception 'Legacy null announcement update result widened'; end if;
 result := public.create_classwork_material_for_owner_v4(actor,classroom,'Future calendar','{"type":"doc","content":[]}',false,null,'9999-12-31');
 material := (result->'material'->>'id')::uuid;
 if result->'material'->>'posted_on' <> '9999-12-31' or (result->'material'->>'released_at')::timestamptz > clock_timestamp() then raise exception 'Calendar future material hidden'; end if;
 result := public.create_announcement_for_owner_v2(actor,classroom,'Future calendar',false,null,'Calendar','9999-12-31');
 announcement := (result->'announcement'->>'id')::uuid;
 if result->'announcement'->>'posted_on' <> '9999-12-31' or (result->'announcement'->>'published_at')::timestamptz > clock_timestamp()
   or result->'announcement'->'scheduled_for' is distinct from 'null'::jsonb then raise exception 'Calendar future announcement hidden'; end if;
 result := public.create_classwork_material_for_owner_v4(actor,classroom,'Scheduled calendar','{"type":"doc","content":[]}',false,schedule,'0001-01-01');
 if (result->'material'->>'released_at')::timestamptz is distinct from schedule or result->'material'->>'posted_on' <> '0001-01-01' then raise exception 'Scheduled material changed'; end if;
 result := public.create_announcement_for_owner_v2(actor,classroom,'Scheduled calendar',false,schedule,'Scheduled calendar','0001-01-01');
 if (result->'announcement'->>'published_at')::timestamptz is distinct from schedule or (result->'announcement'->>'scheduled_for')::timestamptz is distinct from schedule then raise exception 'Scheduled announcement changed'; end if;
 result := public.create_classwork_material_for_owner_v4(actor,classroom,'Draft calendar','{"type":"doc","content":[]}',true,null,'9999-12-31');
 if not (result->'material'->>'is_draft')::boolean or result->'material'->'released_at' <> 'null'::jsonb then raise exception 'Draft material published'; end if;
 result := public.create_announcement_for_owner_v2(actor,classroom,'Draft calendar',true,null,'Draft calendar','9999-12-31');
 if not (result->'announcement'->>'is_draft')::boolean or result->'announcement'->'published_at' <> 'null'::jsonb then raise exception 'Draft announcement published'; end if;
 -- Calendar metadata can accompany ordinary publication edits independently.
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,'{"posted_on":"2030-01-01","is_draft":true}');
 if not (result->'material'->>'is_draft')::boolean or result->'material'->'released_at' <> 'null'::jsonb or result->'material'->>'posted_on' <> '2030-01-01' then raise exception 'Combined material draft failed'; end if;
 result := public.update_classwork_material_for_owner_v1(actor,classroom,material,jsonb_build_object('posted_on','2031-01-01','scheduled_for',schedule));
 if (result->'material'->>'released_at')::timestamptz is distinct from schedule or result->'material'->>'posted_on' <> '2031-01-01' then raise exception 'Combined material scheduling failed'; end if;
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"posted_on":"2030-01-01","is_draft":true}');
 if not (result->'announcement'->>'is_draft')::boolean or result->'announcement'->'published_at' <> 'null'::jsonb or result->'announcement'->>'posted_on' <> '2030-01-01' then raise exception 'Combined announcement draft failed'; end if;
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,jsonb_build_object('posted_on','2031-01-01','scheduled_for',schedule));
 if (result->'announcement'->>'published_at')::timestamptz is distinct from schedule or (result->'announcement'->>'scheduled_for')::timestamptz is distinct from schedule or result->'announcement'->>'posted_on' <> '2031-01-01' then raise exception 'Combined announcement scheduling failed'; end if;
 begin
   perform public.create_classwork_material_for_owner_v4('c2940000-0000-4000-8000-000000000002',classroom,'Forbidden','{"type":"doc","content":[]}',false,null,'2030-01-01');
   raise exception 'Nonowner material create accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform public.create_announcement_for_owner_v2('c2940000-0000-4000-8000-000000000002',classroom,'Forbidden',false,null,'Forbidden','2030-01-01');
   raise exception 'Nonowner announcement create accepted';
 exception when insufficient_privilege then null; end;
 -- Before/after trigger corruption must reject and roll back the date mutation
 -- and every nested creator write, including position allocation and revision.
 foreach day in array array[date '2094-01-01', date '2094-02-01'] loop
   select to_jsonb(m) into before_row from public.classwork_materials m where id=material;
   begin
     perform public.update_classwork_material_for_owner_v1(actor,classroom,material,jsonb_build_object('posted_on',day));
     raise exception 'Material date tamper accepted';
   exception when sqlstate 'PT409' then null; end;
   if before_row is distinct from (select to_jsonb(m) from public.classwork_materials m where id=material) then raise exception 'Material tamper leaked'; end if;
   select to_jsonb(a) into before_row from public.announcements a where id=announcement;
   begin
     perform public.update_announcement_for_owner_v1(actor,classroom,announcement,jsonb_build_object('posted_on',day));
     raise exception 'Announcement date tamper accepted';
   exception when sqlstate 'PT409' then null; end;
   if before_row is distinct from (select to_jsonb(a) from public.announcements a where id=announcement) then raise exception 'Announcement tamper leaked'; end if;
   select revision into original_revision from public.classroom_archive_revisions where classroom_id=classroom;
   select count(*) into n from public.classwork_materials where classroom_id=classroom;
   begin
     perform public.create_classwork_material_for_owner_v4(actor,classroom,'Atomic rejected','{"type":"doc","content":[]}',false,null,day);
     raise exception 'Atomic material tamper accepted';
   exception when sqlstate 'PT409' then null; end;
   if n <> (select count(*) from public.classwork_materials where classroom_id=classroom) or original_revision is distinct from (select revision from public.classroom_archive_revisions where classroom_id=classroom) then raise exception 'Atomic material creation leaked'; end if;
   select count(*) into n from public.announcements where classroom_id=classroom;
   begin
     perform public.create_announcement_for_owner_v2(actor,classroom,'Atomic rejected',false,null,'Atomic rejected',day);
     raise exception 'Atomic announcement tamper accepted';
   exception when sqlstate 'PT409' then null; end;
   if n <> (select count(*) from public.announcements where classroom_id=classroom) or original_revision is distinct from (select revision from public.classroom_archive_revisions where classroom_id=classroom) then raise exception 'Atomic announcement creation leaked'; end if;
 end loop;
 foreach day in array array[date 'infinity', date '-infinity', date '10000-01-01', date '0001-01-01 BC'] loop
   begin
     perform public.create_classwork_material_for_owner_v4(actor,classroom,'Invalid','{"type":"doc","content":[]}',false,null,day);
     raise exception 'Invalid create material day accepted';
   exception when invalid_parameter_value then null; end;
   begin
     perform public.create_announcement_for_owner_v2(actor,classroom,'Invalid',false,null,'Invalid',day);
     raise exception 'Invalid create announcement day accepted';
   exception when invalid_parameter_value then null; end;
 end loop;
end;
$proof$;
reset role;
update public.classrooms set archived_at=clock_timestamp() where id='c2940000-0000-4000-8000-000000000010';
set local role service_role;
do $proof$
begin
 begin
   perform public.create_classwork_material_for_owner_v4('c2940000-0000-4000-8000-000000000001','c2940000-0000-4000-8000-000000000010','Forbidden','{"type":"doc","content":[]}',false,null,'2030-01-01');
   raise exception 'Archived material create accepted';
 exception when insufficient_privilege then null; end;
 begin
   perform public.create_announcement_for_owner_v2('c2940000-0000-4000-8000-000000000001','c2940000-0000-4000-8000-000000000010','Forbidden',false,null,'Forbidden','2030-01-01');
   raise exception 'Archived announcement create accepted';
 exception when insufficient_privilege then null; end;
end;
$proof$;
reset role;
rollback;
