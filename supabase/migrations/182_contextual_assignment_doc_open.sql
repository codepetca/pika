-- Add the dormant transactional boundary for a classroom member opening an
-- assignment document. Applying this migration changes no rows and does not
-- route any request through this function; API admission is a later slice.

begin;

create function public.open_assignment_doc_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_viewed_at timestamptz,
  p_pal_event jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_classroom_id uuid;
  v_assignment jsonb;
  v_assignment_classroom_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_assignment_created_at timestamptz;
  v_archived_at timestamptz;
  v_doc public.assignment_docs%rowtype;
  v_created boolean := false;
  v_viewed_at_changed boolean := false;
  v_event_occurred_at timestamptz;
  v_activity_day date;
  v_expected_period_key text;
  v_expected_timing text;
begin
  if p_actor_id is null or p_assignment_id is null or p_viewed_at is null then
    raise exception using errcode = '22023', message = 'Invalid assignment open request';
  end if;

  -- This unlocked lookup discovers only the advisory-lock namespace. The
  -- assignment and classroom are read again under locks before authorization.
  select assignment.classroom_id
  into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  -- Queue ordinary assignment opens briefly instead of rejecting simultaneous
  -- classmates. The existing helper then acquires the subject/pair fences
  -- nonblockingly, preserving the student-purge lock order and avoiding cycles.
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    p_actor_id
  );

  -- Lock both authorization parents after the shared advisory fences. A move to
  -- another classroom between discovery and this read is retryable, never
  -- authorized from a stale classroom binding.
  select
    to_jsonb(assignment),
    assignment.classroom_id,
    assignment.is_draft,
    assignment.released_at,
    assignment.created_at,
    classroom.archived_at
  into
    v_assignment,
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_assignment_created_at,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Draft, scheduled, archived, and deleted assignments share the same not-found
  -- result so this learner boundary does not disclose unpublished material.
  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
  then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform 1
  from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = p_actor_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  -- The legacy Pal event is produced only by trusted server code. Constrain its
  -- complete v1 shape and bind all database-verifiable fields to this open. The
  -- HMAC pseudonyms themselves remain application-secret-derived and opaque to
  -- PostgreSQL. A null event remains valid when Pal is disabled or membership
  -- scoped signals own delivery.
  if p_pal_event is not null then
    if jsonb_typeof(p_pal_event) <> 'object'
      or not p_pal_event ?& array[
        'schema_version', 'idempotency_key', 'learner_id', 'event_type',
        'occurred_at', 'metadata'
      ]
      or p_pal_event - array[
        'schema_version', 'idempotency_key', 'learner_id', 'event_type',
        'occurred_at', 'metadata'
      ] <> '{}'::jsonb
      or p_pal_event->>'schema_version' <> '1'
      or p_pal_event->>'event_type' <> 'learning_item.viewed'
      or coalesce(p_pal_event->>'idempotency_key', '') !~ '^pika:v1:pika-fact-[A-Za-z0-9_-]{43}$'
      or coalesce(p_pal_event->>'learner_id', '') !~ '^pika-learner-[A-Za-z0-9_-]{43}$'
      or jsonb_typeof(p_pal_event->'metadata') <> 'object'
      or not (p_pal_event->'metadata') ?& array['item_token', 'kind', 'period_key', 'timing']
      or (p_pal_event->'metadata') - array['item_token', 'kind', 'period_key', 'timing'] <> '{}'::jsonb
      or p_pal_event->'metadata'->>'kind' <> 'assignment'
      or coalesce(p_pal_event->'metadata'->>'item_token', '') !~ '^pika-item-[A-Za-z0-9_-]{43}$'
    then
      raise exception using errcode = '22023', message = 'Invalid assignment view event';
    end if;

    begin
      v_event_occurred_at := (p_pal_event->>'occurred_at')::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode = '22023', message = 'Invalid assignment view event timestamp';
    end;

    v_activity_day := (p_viewed_at at time zone 'America/Toronto')::date;
    v_expected_period_key := 'pika-week-' || to_char(
      v_activity_day - (extract(isodow from v_activity_day)::integer - 1),
      'YYYY-MM-DD'
    );
    v_expected_timing := case
      when p_viewed_at <= coalesce(v_assignment_released_at, v_assignment_created_at) + interval '24 hours'
        then 'within_24h_of_release'
      else 'later'
    end;

    if v_event_occurred_at is distinct from p_viewed_at
      or p_pal_event->'metadata'->>'period_key' is distinct from v_expected_period_key
      or p_pal_event->'metadata'->>'timing' is distinct from v_expected_timing
    then
      raise exception using errcode = '22023', message = 'Assignment view event does not match request';
    end if;
  end if;

  select document.*
  into v_doc
  from public.assignment_docs as document
  where document.assignment_id = p_assignment_id
    and document.student_id = p_actor_id
  for update;

  if not found then
    insert into public.assignment_docs (
      assignment_id,
      student_id,
      content,
      repo_url,
      github_username,
      is_submitted,
      submitted_at,
      viewed_at
    ) values (
      p_assignment_id,
      p_actor_id,
      '{"type":"doc","content":[]}'::jsonb,
      null,
      null,
      false,
      null,
      p_viewed_at
    )
    returning * into v_doc;
    v_created := true;
    v_viewed_at_changed := true;

    perform private.enqueue_pal_event(
      p_actor_id,
      'assignment_first_view',
      p_assignment_id::text,
      p_pal_event
    );
  elsif v_doc.viewed_at is null
    or coalesce(
      greatest(v_doc.returned_at, v_doc.feedback_returned_at),
      '-infinity'::timestamptz
    ) > v_doc.viewed_at
  then
    update public.assignment_docs as document
    set viewed_at = p_viewed_at
    where document.id = v_doc.id
    returning * into v_doc;
    v_viewed_at_changed := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'viewed_at_changed', v_viewed_at_changed,
    'assignment', v_assignment,
    'doc', to_jsonb(v_doc)
  );
end;
$function$;

revoke all on function public.open_assignment_doc_for_member_v1(uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.open_assignment_doc_for_member_v1(uuid, uuid, timestamptz, jsonb)
  to service_role;

comment on function public.open_assignment_doc_for_member_v1(uuid, uuid, timestamptz, jsonb) is
  'Dormant service-only assignment open boundary: locks current membership and visibility before creating or refreshing a learner document.';

commit;
