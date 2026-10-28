-- Disposable-clone proof only. Every fixture and adversarial trigger rolls back.
begin;
set local statement_timeout = '30s';
set local timezone = 'UTC';
insert into public.users(id,email,role) values
 ('c2900000-0000-4000-8000-000000000001','announcement-post-owner@example.invalid','teacher'),
 ('c2900000-0000-4000-8000-000000000002','announcement-post-other@example.invalid','teacher');
select public.set_effective_feature_entitlement_v1(gen_random_uuid(),
 'c2900000-0000-4000-8000-000000000001', 'classrooms.create',
 'manual', true, clock_timestamp(), null, 10, 'test:announcement-post-date', 'announcement_post_date_rollback', 0);
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('c2900000-0000-4000-8000-000000000010','c2900000-0000-4000-8000-000000000001','Announcement post date','C290TEST');
create function pg_temp.announcement_post_date_tamper() returns trigger language plpgsql as $hook$
begin
 if new.title = 'Tampered author' then new.created_by := 'c2900000-0000-4000-8000-000000000002'; end if;
 if new.title = 'Tampered creation' then new.created_at := old.created_at - interval '1 day'; end if;
 return new;
end;
$hook$;
create trigger announcement_post_date_tamper before update on public.announcements
for each row execute function pg_temp.announcement_post_date_tamper();
create function pg_temp.announcement_post_date_after_tamper() returns trigger language plpgsql as $hook$
begin
 if new.title = 'Tampered after row' and pg_trigger_depth() = 1 then
   update public.announcements set content = content || ' tampered' where id = new.id;
 end if;
 return new;
end;
$hook$;
create trigger announcement_post_date_after_tamper after update on public.announcements
for each row execute function pg_temp.announcement_post_date_after_tamper();
-- The announcement creator retains its original create/scheduling contract.
select public.create_announcement_for_owner_v1('c2900000-0000-4000-8000-000000000001','c2900000-0000-4000-8000-000000000010','Posted content',false,null,'Posted');
select public.create_announcement_for_owner_v1('c2900000-0000-4000-8000-000000000001','c2900000-0000-4000-8000-000000000010','Draft content',true,null,'Draft');
select public.create_announcement_for_owner_v1('c2900000-0000-4000-8000-000000000001','c2900000-0000-4000-8000-000000000010','Scheduled content',false,clock_timestamp()+interval '2 days','Scheduled');
select public.create_announcement_for_owner_v1('c2900000-0000-4000-8000-000000000001','c2900000-0000-4000-8000-000000000010','Historical content',false,'2020-01-01T05:00:00Z','Historical schedule');
select public.create_announcement_for_owner_v1('c2900000-0000-4000-8000-000000000001','c2900000-0000-4000-8000-000000000010','Future content',false,clock_timestamp()+interval '2 days','Future publication');
update public.announcements set scheduled_for=null where classroom_id='c2900000-0000-4000-8000-000000000010' and title='Future publication';
insert into public.announcement_reads(announcement_id,user_id)
 select id,'c2900000-0000-4000-8000-000000000002' from public.announcements
 where classroom_id='c2900000-0000-4000-8000-000000000010' and title='Posted';
set local role service_role;
do $proof$
declare
 actor uuid := 'c2900000-0000-4000-8000-000000000001';
 classroom uuid := 'c2900000-0000-4000-8000-000000000010';
 announcement uuid;
 receipt jsonb;
 revision bigint;
 result jsonb;
 original jsonb;
 before_rejection jsonb;
 patch jsonb;
 day text;
 expected timestamptz;
 future_day text := ((clock_timestamp() at time zone 'America/Toronto')::date + 1)::text;
begin
 if has_function_privilege('anon','public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb)','execute')
   or has_function_privilege('authenticated','public.update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb)','execute') then
   raise exception 'Owner RPC exposed to browser roles';
 end if;
 select to_jsonb(m) into original from public.announcements m where classroom_id=classroom and title='Posted';
 select to_jsonb(r) into receipt from public.announcement_reads r where r.announcement_id=(original->>'id')::uuid;
 announcement := (original->>'id')::uuid;
 -- Calendar labels, including future dates and DST days, never change availability.
 foreach day in array array['2020-01-15','2020-07-15','2020-03-08','2020-11-01','2024-02-29','0001-01-01','9999-12-31',future_day,((clock_timestamp() at time zone 'America/Toronto')::date)::text] loop
   expected := day::date::timestamp at time zone 'America/Toronto';
   result := public.update_announcement_for_owner_v1(actor,classroom,announcement,jsonb_build_object('posted_on',day));
   if result->'announcement'->>'posted_on' is distinct from day then raise exception 'Post date failed for %',day; end if;
   if ((result->'announcement') - 'posted_on' - 'updated_at') is distinct from (original - 'posted_on' - 'updated_at') then
     raise exception 'Post date changed an unrelated field';
   end if;
 end loop;
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"posted_on":"2020-01-15","title":"Edited","content":"Edited content","is_draft":false}');
 if result->'announcement'->>'title' <> 'Edited' or result->'announcement'->>'posted_on' <> '2020-01-15' then raise exception 'Combined edit failed'; end if;
 select to_jsonb(m) into before_rejection from public.announcements m where id=announcement;
 for patch in select value from jsonb_array_elements(jsonb_build_array(
   '{"posted_on":null}'::jsonb,'{"posted_on":true}'::jsonb,'{"posted_on":1}'::jsonb,'{"posted_on":{}}'::jsonb,
   '{"posted_on":""}'::jsonb,'{"posted_on":"2024-2-01"}'::jsonb,'{"posted_on":"2024-02-30"}'::jsonb,
   '{"posted_on":"2023-02-29"}'::jsonb,'{"posted_on":"0000-01-01"}'::jsonb,'{"posted_on":"10000-01-01"}'::jsonb,
   '{"posted_on":"2024-13-01"}'::jsonb,'{"posted_on":"2024-01-00"}'::jsonb,'{"posted_on":"infinity"}'::jsonb,
   '{"posted_on":"2024-01-01T00:00:00Z"}'::jsonb,'{"posted_on":"2024-01-01 "}'::jsonb,
   '{"posted_on":"2024-01-01","created_by":"c2900000-0000-4000-8000-000000000002"}'::jsonb)) loop
   begin
     perform public.update_announcement_for_owner_v1(actor,classroom,announcement,patch);
     raise exception 'Invalid post date accepted: %',patch;
   exception when invalid_parameter_value then null;
   end;
   if (select to_jsonb(m) from public.announcements m where id=announcement) is distinct from before_rejection then
     raise exception 'Rejected patch changed a row';
   end if;
 end loop;
 begin
   perform public.update_announcement_for_owner_v1('c2900000-0000-4000-8000-000000000002',classroom,announcement,'{"posted_on":"2024-01-01"}');
   raise exception 'Nonowner post date accepted';
 exception when insufficient_privilege then null;
 end;
 for day in select unnest(array['Tampered author','Tampered creation','Tampered after row']) loop
 begin
   perform public.update_announcement_for_owner_v1(actor,classroom,announcement,jsonb_build_object('posted_on','2024-01-01','title',day));
   raise exception 'Immutable trigger tampering accepted';
 exception when sqlstate 'PT409' then null;
 end;
 if (select to_jsonb(m) from public.announcements m where id=announcement) is distinct from before_rejection then raise exception 'Tamper rejection did not roll back'; end if;
 end loop;
 for announcement in select id from public.announcements where classroom_id=classroom and title in ('Draft','Scheduled','Future publication') loop
   select to_jsonb(m) into before_rejection from public.announcements m where id=announcement;
   result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"posted_on":"9999-12-31"}');
   if ((result->'announcement') - 'posted_on' - 'updated_at') is distinct from (before_rejection - 'posted_on' - 'updated_at') then
     raise exception 'Draft/scheduled metadata edit changed publication';
   end if;
 end loop;
 select id into announcement from public.announcements where classroom_id=classroom and title='Historical schedule';
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"posted_on":"2024-01-01"}');
 if result->'announcement'->>'posted_on' <> '2024-01-01' or (result->'announcement'->>'published_at')::timestamptz <> '2020-01-01T05:00:00Z'::timestamptz or (result->'announcement'->>'scheduled_for')::timestamptz <> '2020-01-01T05:00:00Z'::timestamptz then raise exception 'Calendar edit changed historical scheduling'; end if;
 -- Existing publication no-ops preserve both the row and archive revision.
 select to_jsonb(m) into original from public.announcements m where id=announcement;
 select r.revision into revision from public.classroom_archive_revisions r where r.classroom_id=classroom;
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"is_draft":false}');
 if result->'announcement' is distinct from original
   or (select r.revision from public.classroom_archive_revisions r where r.classroom_id=classroom) is distinct from revision then
   raise exception 'Publication no-op changed row or archive revision';
 end if;
 -- Existing content edits, rescheduling, draft cancellation and post-now remain supported.
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"content":"Still editable"}');
 if result->'announcement'->>'content' <> 'Still editable' or (result->'announcement'->>'published_at')::timestamptz <> '2020-01-01T05:00:00Z'::timestamptz then raise exception 'Content edit changed publication'; end if;
 expected := clock_timestamp()+interval '2 days';
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,jsonb_build_object('scheduled_for',expected));
 if (result->'announcement'->>'published_at')::timestamptz is distinct from expected or (result->'announcement'->>'scheduled_for')::timestamptz is distinct from expected then raise exception 'Reschedule changed'; end if;
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"is_draft":true}');
 if not (result->'announcement'->>'is_draft')::boolean or result->'announcement'->'published_at' <> 'null'::jsonb or result->'announcement'->'scheduled_for' <> 'null'::jsonb then raise exception 'Draft cancellation changed'; end if;
 result := public.update_announcement_for_owner_v1(actor,classroom,announcement,'{"scheduled_for":null}');
 if (result->'announcement'->>'is_draft')::boolean or (result->'announcement'->>'published_at')::timestamptz > clock_timestamp() or result->'announcement'->'scheduled_for' <> 'null'::jsonb then raise exception 'Post now changed'; end if;
 if (select to_jsonb(r) from public.announcement_reads r where r.announcement_id=(select id from public.announcements where classroom_id=classroom and title='Edited')) is distinct from receipt then raise exception 'Post date changed read receipt'; end if;

end;
$proof$;
reset role;
update public.classrooms set archived_at=clock_timestamp() where id='c2900000-0000-4000-8000-000000000010';
set local role service_role;
do $proof$
begin
 begin
   perform public.update_announcement_for_owner_v1('c2900000-0000-4000-8000-000000000001','c2900000-0000-4000-8000-000000000010',
     (select id from public.announcements where classroom_id='c2900000-0000-4000-8000-000000000010' and title='Historical schedule'),'{"posted_on":"2024-01-01"}');
   raise exception 'Archived classroom post date accepted';
 exception when insufficient_privilege then null;
 end;
end;
$proof$;
reset role;
rollback;
