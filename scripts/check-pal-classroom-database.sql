-- Rollback-only synthetic Phase 2 contract. Requires separately approved 169.
-- No migration application, external provider calls, permanent gates or cleanup.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare f text;
begin
  foreach f in array array['resolve_pal_classroom_context(uuid,uuid)',
    'record_pal_classroom_visit(uuid,uuid)', 'authorize_pal_membership_delivery(uuid,uuid)',
    'claim_pal_membership_outbox(integer,integer,uuid,uuid)', 'count_pal_membership_outbox_ready()',
    'sync_pal_membership_weeks(integer)'] loop
    if to_regprocedure('public.' || f) is null then raise exception 'Migration 169 is required'; end if;
    if has_function_privilege('anon', 'public.' || f, 'execute')
      or has_function_privilege('authenticated', 'public.' || f, 'execute')
      or not has_function_privilege('service_role', 'public.' || f, 'execute')
    then raise exception 'Membership Pal public privilege boundary failed: %', f; end if;
  end loop;
  if private.pal_classroom_signals_enabled() then raise exception 'Fixture requires disabled gates'; end if;
end;
$$;

insert into public.users(id,email,role) values
  ('c1690000-0000-4000-8000-000000000001','teacher-169@example.invalid','teacher'),
  ('c1690000-0000-4000-8000-000000000002','student-169@example.invalid','student'),
  ('c1690000-0000-4000-8000-000000000003','other-169@example.invalid','student');
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('c1690000-0000-4000-8000-000000000010','c1690000-0000-4000-8000-000000000001','Pal A','C169A'),
  ('c1690000-0000-4000-8000-000000000011','c1690000-0000-4000-8000-000000000001','Pal B','C169B');
insert into public.classroom_roster(id,classroom_id,email) values
  ('c1690000-0000-4000-8000-000000000030','c1690000-0000-4000-8000-000000000010','student-169@example.invalid'),
  ('c1690000-0000-4000-8000-000000000031','c1690000-0000-4000-8000-000000000011','student-169@example.invalid');

do $$
declare
  student uuid := 'c1690000-0000-4000-8000-000000000002';
  teacher uuid := 'c1690000-0000-4000-8000-000000000001';
  course_a uuid := 'c1690000-0000-4000-8000-000000000010';
  course_b uuid := 'c1690000-0000-4000-8000-000000000011';
  generation_a uuid := 'c1690000-0000-4000-8000-000000000020';
  generation_b uuid := 'c1690000-0000-4000-8000-000000000021';
  day date := (now() at time zone 'America/Toronto')::date;
  monday date := date_trunc('week', now() at time zone 'America/Toronto')::date;
  activation timestamptz := date_trunc('week', now() at time zone 'America/Toronto') at time zone 'America/Toronto';
  ref_a text; ref_b text; result jsonb; claimed jsonb; claim jsonb;
  legacy public.pal_event_outbox; prior_payload jsonb;
  assignment uuid := 'c1690000-0000-4000-8000-000000000040';
  doc uuid := 'c1690000-0000-4000-8000-000000000041';
  historical_doc uuid := 'c1690000-0000-4000-8000-000000000042';
  entry_a uuid; entry_b uuid; count_before bigint; bound record;
begin
  if public.resolve_pal_classroom_context(student,course_a) <> '{"status":"disabled"}'::jsonb then
    raise exception 'Disabled context resolved'; end if;
  prior_payload := jsonb_build_object('schema_version',1,'idempotency_key','pika:v1:fixture-169',
    'learner_id','pika-learner-legacy-fixture-169','event_type','platform.session.started',
    'occurred_at','2026-01-01T00:00:00Z','metadata','{}'::jsonb);
  legacy := private.enqueue_pal_event(student,'authenticated_session','legacy-169',prior_payload);
  if legacy.id is null then raise exception 'Disabled legacy behavior changed'; end if;
  update private.pal_membership_settings set enabled = true;
  -- Transaction-local fixture settings remain invisible to other sessions.
  update private.pal_classroom_signal_settings set enabled = true, activated_at = activation;
  insert into public.classroom_enrollments(id,classroom_id,student_id,created_at) values
    (generation_a,course_a,student,activation), (generation_b,course_b,student,activation);
  ref_a := public.resolve_pal_classroom_context(student,course_a)->>'learner_id';
  ref_b := public.resolve_pal_classroom_context(student,course_b)->>'learner_id';
  if ref_a is null or ref_b is null or ref_a = ref_b then raise exception 'Two-course identity isolation failed'; end if;
  if (select count(*) from private.pal_membership_outbox where student_id = student) <> 2 then
    raise exception 'Each new join must capture its own fact'; end if;
  if public.resolve_pal_classroom_context(teacher,course_a)->>'status' <> 'forbidden'
    or public.resolve_pal_classroom_context('c1690000-0000-4000-8000-000000000003',course_a)->>'status' <> 'forbidden'
  then raise exception 'Wrong actor gained membership context'; end if;
  perform public.record_pal_classroom_visit(student,course_a);
  perform public.record_pal_classroom_visit(student,course_a);
  if (select count(*) from public.pal_event_outbox where payload->>'learner_id' = ref_a
    and event_type = 'platform.session.started') <> 1
    or exists(select 1 from public.pal_event_outbox where payload->>'learner_id' = ref_b
      and event_type = 'platform.session.started') then raise exception 'Visit broadcast/dedup failed'; end if;

  insert into public.class_days(classroom_id,date,is_class_day)
    select course_a,monday + n,true from generate_series(0,1) n
    union all select course_b,monday + n,true from generate_series(0,3) n;
  -- The real daily log date is Toronto's current day, including boundary days.
  insert into public.class_days(classroom_id,date,is_class_day) values (course_a,day,true),(course_b,day,true)
    on conflict (classroom_id,date) do update set is_class_day = true;
  insert into public.entries(student_id,classroom_id,date,text,rich_content,on_time)
    values (student,course_a,day,'Class A work','{"type":"doc","content":[]}',true) returning id into entry_a;
  insert into public.entries(student_id,classroom_id,date,text,rich_content,on_time)
    values (student,course_b,day,'Class B work','{"type":"doc","content":[]}',true) returning id into entry_b;
  update public.entries set text = 'Class A edit' where id = entry_a;
  if (select count(*) from public.pal_event_outbox where payload->>'learner_id' = ref_a
      and event_type = 'daily_log.completed') <> 1
    or (select count(*) from public.pal_event_outbox where payload->>'learner_id' = ref_b
      and event_type = 'daily_log.completed') <> 1 then raise exception 'Daily dedup crosses courses'; end if;

  -- Capture only fresh authoring/view transitions. Historical rows are not replayed.
  insert into public.assignments(id,classroom_id,title,description,due_at,released_at,created_by,is_draft)
    values (assignment,course_a,'Fixture assignment','fixture',now()+interval '1 day',now()-interval '1 hour',teacher,false);
  insert into public.assignment_docs(id,assignment_id,student_id,content,viewed_at)
    values (doc,assignment,student,'{"type":"doc","content":[]}',clock_timestamp());
  update public.assignment_docs set is_submitted=true,submitted_at=clock_timestamp() where id=doc;
  update public.assignment_docs set is_submitted=false,submitted_at=null where id=doc;
  update public.assignment_docs set is_submitted=true,submitted_at=clock_timestamp() where id=doc;
  if (select count(*) from public.pal_event_outbox where payload->>'learner_id'=ref_a
      and event_type in ('learning_item.viewed','learning_item.completed')) <> 2
    or exists (select 1 from public.pal_event_outbox where payload->>'learner_id'=ref_b
      and event_type in ('learning_item.viewed','learning_item.completed'))
  then raise exception 'Assignment scope or first-completion dedup failed'; end if;

  select count(*) into count_before from private.pal_membership_outbox where student_id=student;
  insert into public.assignments(id,classroom_id,title,description,released_at,created_by,is_draft,due_at)
    values ('c1690000-0000-4000-8000-000000000043',course_a,'Historical fixture','fixture',activation-interval '1 day',teacher,false,now()+interval '1 day');
  insert into public.assignment_docs(id,assignment_id,student_id,content,created_at,viewed_at)
    values (historical_doc,'c1690000-0000-4000-8000-000000000043',student,
      '{"type":"doc","content":[]}',activation-interval '1 day',activation-interval '1 day');
  update public.assignment_docs set is_submitted=true,submitted_at=clock_timestamp() where id=historical_doc;
  if (select count(*) from private.pal_membership_outbox where student_id=student) <> count_before then
    raise exception 'Pre-activation academic history was relabeled'; end if;

  -- Live legacy assignments may have no release timestamp; drafts stay private.
  insert into public.assignments(id,classroom_id,title,created_by,is_draft,due_at)
    values ('c1690000-0000-4000-8000-000000000044',course_a,'Legacy live',teacher,false,now()+interval '1 day'),
      ('c1690000-0000-4000-8000-000000000045',course_a,'Draft',teacher,true,now()+interval '1 day');
  insert into public.assignment_docs(assignment_id,student_id,content,viewed_at)
    values ('c1690000-0000-4000-8000-000000000044',student,'{"type":"doc","content":[]}',clock_timestamp()),
      ('c1690000-0000-4000-8000-000000000045',student,'{"type":"doc","content":[]}',clock_timestamp());
  if (select count(*) from private.pal_membership_outbox where student_id=student) <> count_before + 1 then
    raise exception 'Assignment signal visibility differs from academic visibility'; end if;

  -- Bound the real planner to exactly these adjacent synthetic generations.
  update private.pal_membership_week_sync_cursor set after_generation='c1690000-0000-4000-8000-00000000001f';
  result := public.sync_pal_membership_weeks(2);
  if result->>'configured' <> '2' then raise exception 'Both memberships need independent weekly configuration: %',result; end if;
  if (select count(*) from private.pal_membership_week_configurations where generation_id in (generation_a,generation_b)) <> 2 then
    raise exception 'Weekly versions are not generation-scoped'; end if;
  update private.pal_membership_week_sync_cursor set after_generation='c1690000-0000-4000-8000-00000000001f';
  result := public.sync_pal_membership_weeks(2);
  if result->>'configured' <> '0' then raise exception 'Unchanged retry created a configuration revision'; end if;
  update public.class_days set is_class_day=false where classroom_id=course_a and date<>day;
  update private.pal_membership_week_sync_cursor set after_generation='c1690000-0000-4000-8000-00000000001f';
  result := public.sync_pal_membership_weeks(2);
  if result->>'configured' <> '1'
    or (select max(config_version) from private.pal_membership_week_configurations where generation_id=generation_a) <> 2
    or (select max(config_version) from private.pal_membership_week_configurations where generation_id=generation_b) <> 1
    or (select eligible_days from private.pal_membership_week_configurations where generation_id=generation_a order by config_version desc limit 1) <> 1
  then raise exception 'One course schedule changed another course or ignored its completion floor'; end if;
  if exists(select 1 from public.pal_daily_log_week_configurations where student_id=student) then
    raise exception 'New planner wrote legacy configurations'; end if;

  if exists(select 1 from public.claim_pal_event_outbox(100,60)) then raise exception 'Legacy claims were not quiesced'; end if;
  if (select payload from public.pal_event_outbox where id=legacy.id) <> prior_payload then
    raise exception 'Legacy payload was rewritten'; end if;
  claimed := public.claim_pal_membership_outbox(100,60);
  for claim in select value from jsonb_array_elements(claimed) loop
    if (claim->'payload'->>'learner_id') not in (ref_a,ref_b) then
      raise exception 'Membership claims included a legacy/other profile'; end if;
    if public.authorize_pal_membership_delivery((claim->>'id')::uuid,(claim->>'lease_token')::uuid)->>'status' <> 'active' then
      raise exception 'Current membership delivery was denied'; end if;
    if public.complete_pal_event_outbox((claim->>'id')::uuid,gen_random_uuid()) then
      raise exception 'Foreign lease token completed delivery'; end if;
  end loop;
  if jsonb_array_length(public.claim_pal_membership_outbox(100,60)) <> 0 then
    raise exception 'Concurrent claim duplicated an unexpired lease'; end if;

  -- Remove A while B stays active; both new token/visit and queued delivery deny.
  delete from public.classroom_enrollments where id=generation_a;
  if public.resolve_pal_classroom_context(student,course_a)->>'status' <> 'forbidden'
    or public.record_pal_classroom_visit(student,course_a)->>'status' <> 'forbidden'
    or public.resolve_pal_classroom_context(student,course_b)->>'status' <> 'active'
  then raise exception 'Removal did not isolate token/visit access'; end if;
  for claim in select value from jsonb_array_elements(claimed) loop
    result := public.authorize_pal_membership_delivery((claim->>'id')::uuid,(claim->>'lease_token')::uuid);
    if (claim->'payload'->>'learner_id'=ref_a and result->>'status'<>'forbidden')
      or (claim->'payload'->>'learner_id'=ref_b and result->>'status'<>'active') then
      raise exception 'Queued delivery did not retain its original generation'; end if;
  end loop;
  insert into public.classroom_enrollments(id,classroom_id,student_id,created_at)
    values ('c1690000-0000-4000-8000-000000000022',course_a,student,clock_timestamp());
  update public.entries set text='Old generation edit' where id=entry_a;
  update public.assignment_docs set is_submitted=false,submitted_at=null where id=doc;
  update public.assignment_docs set is_submitted=true,submitted_at=clock_timestamp() where id=doc;
  if public.resolve_pal_classroom_context(student,course_a)->>'learner_id' = ref_a
    or exists(select 1 from public.pal_event_outbox where payload->>'learner_id' =
      public.resolve_pal_classroom_context(student,course_a)->>'learner_id'
      and event_type <> 'classroom.joined') then
    raise exception 'Modeled fresh re-add inherited old rewards or evidence'; end if;
  raise notice 'Phase 2 synthetic signal, namespace, week, lease and removal contracts passed';
end;
$$;

-- Deliberate enqueue failure must roll back the corresponding academic edit.
create function pg_temp.reject_fixture_pal_outbox() returns trigger language plpgsql as $$
begin raise exception using errcode='P0001',message='fixture_outbox_failure'; end;
$$;
create trigger reject_fixture_pal_outbox before insert on public.pal_event_outbox
  for each row when (new.source_kind='membership_v1') execute function pg_temp.reject_fixture_pal_outbox();
do $$
declare before_text text;
begin
  select text into before_text from public.entries where classroom_id='c1690000-0000-4000-8000-000000000011'
    and student_id='c1690000-0000-4000-8000-000000000002';
  begin
    update public.entries set text='must roll back' where classroom_id='c1690000-0000-4000-8000-000000000011'
      and student_id='c1690000-0000-4000-8000-000000000002';
    raise exception 'Expected outbox rejection';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'fixture_outbox_failure' then raise; end if;
  end;
  if (select text from public.entries where classroom_id='c1690000-0000-4000-8000-000000000011'
    and student_id='c1690000-0000-4000-8000-000000000002') is distinct from before_text
  then raise exception 'Academic write escaped outbox rollback'; end if;
end;
$$;
select 'PAL_EVENT:' || payload::text from public.pal_event_outbox
  where student_id='c1690000-0000-4000-8000-000000000002' and source_kind='membership_v1';
rollback;
