-- Dormant service-only boundary. No account, enrollment, policy or rollout changes.
-- Identity is supplied by Pika's authenticated server, not a browser JWT.
begin;

create function public.save_daily_log_for_member_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_text text,
  p_rich_content jsonb,
  p_on_time boolean,
  p_pal_event jsonb default null,
  p_minutes_reported integer default null,
  p_mood text default null,
  p_expected_version integer default null,
  p_expected_entry_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_entry public.entries%rowtype;
  v_result jsonb;
  v_event_time timestamptz;
  v_period_key text;
begin
  if p_actor_id is null or p_classroom_id is null or p_date is null
    or not isfinite(p_date) or p_text is null or p_rich_content is null
    or jsonb_typeof(p_rich_content) is distinct from 'object'
    or p_rich_content->>'type' is distinct from 'doc' or p_on_time is null
    or (p_expected_version is null) <> (p_expected_entry_id is null)
    or p_expected_version < 1
  then
    raise exception using errcode = '22023', message = 'Invalid daily log save request';
  end if;

  -- Match the legacy atomic writer before taking broader lifecycle fences.
  perform pg_advisory_xact_lock(hashtextextended(
    'pal_daily_log:' || p_actor_id::text || ':' || p_classroom_id::text || ':' || p_date::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'pika-classroom-operation:' || p_classroom_id::text, 0
  ));
  perform private.try_lock_classroom_membership_change(p_classroom_id, p_actor_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);

  -- Legacy direct writers may already hold row locks when their triggers try
  -- lifecycle fences. Never wait for those rows while holding their fences.
  -- 55P03 is retryable; no fallback to an unguarded write is permitted.
  select classroom.teacher_id, classroom.archived_at
  into v_teacher_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update nowait;
  if not found or v_archived_at is not null then
    raise exception using errcode = 'P0002', message = 'Classroom not found';
  end if;
  if v_teacher_id = p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  perform 1 from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = p_classroom_id and enrollment.student_id = p_actor_id
  for share nowait;
  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  if p_date > (clock_timestamp() at time zone 'America/Toronto')::date then
    raise exception using errcode = '22023', message = 'Cannot save a future daily log';
  end if;
  perform 1 from public.class_days as class_day
  where class_day.classroom_id = p_classroom_id and class_day.date = p_date
    and class_day.is_class_day
  for share nowait;
  if not found then
    raise exception using errcode = '22023', message = 'Not a class day';
  end if;

  select entry.* into v_entry from public.entries as entry
  where entry.student_id = p_actor_id and entry.classroom_id = p_classroom_id
    and entry.date = p_date
  for update nowait;
  -- Null revision means create-only, unlike the historical Pal upsert. This
  -- also prevents delete/recreate ABA writes from matching an old version.
  if (found and (p_expected_version is null
      or coalesce(v_entry.version, 1) <> p_expected_version
      or v_entry.id is distinct from p_expected_entry_id))
    or (not found and p_expected_version is not null)
  then
    return jsonb_build_object('ok', false, 'status', 409,
      'error', 'Entry has been updated elsewhere',
      'entry', case when v_entry.id is null then 'null'::jsonb else to_jsonb(v_entry) end);
  end if;

  -- Optional server-built Pal facts must match this day. Pseudonyms remain
  -- opaque HMAC values; their identity proof stays in the trusted server.
  if p_pal_event is not null then
    v_period_key := 'pika-week-' || to_char(
      p_date - (extract(isodow from p_date)::integer - 1), 'YYYY-MM-DD');
    if jsonb_typeof(p_pal_event) is distinct from 'object'
      or not p_pal_event ?& array['schema_version', 'idempotency_key', 'learner_id', 'event_type', 'occurred_at', 'metadata']
      or p_pal_event - array['schema_version', 'idempotency_key', 'learner_id', 'event_type', 'occurred_at', 'metadata'] <> '{}'::jsonb
      or p_pal_event->'schema_version' is distinct from '1'::jsonb
      or p_pal_event->>'event_type' is distinct from 'daily_log.completed'
      or coalesce(p_pal_event->>'idempotency_key', '') !~ '^pika:v1:pika-fact-[A-Za-z0-9_-]{43}$'
      or coalesce(p_pal_event->>'learner_id', '') !~ '^pika-learner-[A-Za-z0-9_-]{43}$'
      or jsonb_typeof(p_pal_event->'occurred_at') is distinct from 'string'
      or jsonb_typeof(p_pal_event->'metadata') is distinct from 'object'
      or (p_pal_event->'metadata') - array['activity_day', 'period_key'] <> '{}'::jsonb
      or p_pal_event->'metadata'->>'activity_day' is distinct from p_date::text
      or p_pal_event->'metadata'->>'period_key' is distinct from v_period_key
    then
      raise exception using errcode = '22023', message = 'Invalid daily log event';
    end if;
    begin
      v_event_time := (p_pal_event->>'occurred_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'Invalid daily log event';
    end;
    if v_event_time is null or not isfinite(v_event_time) then
      raise exception using errcode = '22023', message = 'Invalid daily log event';
    end if;
  end if;

  -- Reuse the established academic-write/outbox transaction and all purge,
  -- tombstone, archive-revision and membership-Pal triggers without disabling any.
  v_result := public.upsert_student_entry_with_pal_event_atomic(
    p_actor_id, p_classroom_id, p_date, p_text, p_rich_content, p_on_time,
    p_pal_event, p_minutes_reported, p_mood, p_expected_version
  );
  if jsonb_typeof(v_result) is distinct from 'object'
    or v_result->'ok' is distinct from 'true'::jsonb
    or v_result->'entry'->>'student_id' is distinct from p_actor_id::text
    or v_result->'entry'->>'classroom_id' is distinct from p_classroom_id::text
    or v_result->'entry'->>'date' is distinct from p_date::text
    or (p_expected_entry_id is not null
      and v_result->'entry'->>'id' is distinct from p_expected_entry_id::text)
  then
    raise exception using errcode = '40001', message = 'Daily log binding changed';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.save_daily_log_for_member_v1(
  uuid, uuid, date, text, jsonb, boolean, jsonb, integer, text, integer, uuid
) from public, anon, authenticated;
grant execute on function public.save_daily_log_for_member_v1(
  uuid, uuid, date, text, jsonb, boolean, jsonb, integer, text, integer, uuid
) to service_role;
comment on function public.save_daily_log_for_member_v1(
  uuid, uuid, date, text, jsonb, boolean, jsonb, integer, text, integer, uuid
) is 'Dormant server-authenticated member Daily Log save; exact live membership, owner precedence, class day, revision and Pal outbox transaction.';
commit;
