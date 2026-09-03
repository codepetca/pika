-- Dormant mixed-role enrollment foundation. No live route calls this function.
-- The service-only RPC rate-limits invitation guesses, revalidates the exact
-- classroom/code pair under lock, and commits every membership side effect as
-- one transaction.

create table public.classroom_join_rate_limits (
  scope text not null check (scope in ('actor', 'invitation')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  attempt_timestamps timestamptz[] not null default array[]::timestamptz[],
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, key_hash),
  check (cardinality(attempt_timestamps) between 0 and 30)
);

create index classroom_join_rate_limits_updated_at_idx
  on public.classroom_join_rate_limits (updated_at);

alter table public.classroom_join_rate_limits enable row level security;
revoke all on table public.classroom_join_rate_limits from public, anon, authenticated, service_role;

create function private.consume_classroom_join_rate_limits_v1(
  p_actor_key_hash text,
  p_invitation_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval := interval '10 minutes';
  v_actor_max_attempts constant integer := 12;
  v_invitation_max_attempts constant integer := 3;
  v_actor_attempts timestamptz[];
  v_invitation_attempts timestamptz[];
  v_retry_after_seconds integer := 1;
begin
  if p_actor_key_hash !~ '^[0-9a-f]{64}$'
    or p_invitation_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid_classroom_join_rate_limit_input';
  end if;

  -- Consume the actor budget first. A blocked actor must not be able to create
  -- an unbounded number of invitation rows by rotating guessed codes.
  insert into public.classroom_join_rate_limits (scope, key_hash, updated_at)
  values ('actor', p_actor_key_hash, v_now)
  on conflict (scope, key_hash) do nothing;

  select array(
    select attempted_at
    from unnest(attempt_timestamps) attempted_at
    where attempted_at > v_now - v_window
    order by attempted_at
  ) into v_actor_attempts
  from public.classroom_join_rate_limits
  where scope = 'actor' and key_hash = p_actor_key_hash
  for update;

  if cardinality(v_actor_attempts) >= v_actor_max_attempts then
    v_retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (v_actor_attempts[1] + v_window - v_now)))::integer
    );
    update public.classroom_join_rate_limits
    set attempt_timestamps = v_actor_attempts,
        updated_at = v_now
    where scope = 'actor' and key_hash = p_actor_key_hash;
    return jsonb_build_object(
      'ok', false,
      'retry_after_seconds', v_retry_after_seconds
    );
  end if;

  update public.classroom_join_rate_limits
  set attempt_timestamps = array_append(v_actor_attempts, v_now),
      updated_at = v_now
  where scope = 'actor' and key_hash = p_actor_key_hash;

  insert into public.classroom_join_rate_limits (scope, key_hash, updated_at)
  values ('invitation', p_invitation_key_hash, v_now)
  on conflict (scope, key_hash) do nothing;

  select array(
    select attempted_at
    from unnest(attempt_timestamps) attempted_at
    where attempted_at > v_now - v_window
    order by attempted_at
  ) into v_invitation_attempts
  from public.classroom_join_rate_limits
  where scope = 'invitation' and key_hash = p_invitation_key_hash
  for update;

  if cardinality(v_invitation_attempts) >= v_invitation_max_attempts then
    v_retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (v_invitation_attempts[1] + v_window - v_now)))::integer
    );
    update public.classroom_join_rate_limits
    set attempt_timestamps = v_invitation_attempts,
        updated_at = v_now
    where scope = 'invitation' and key_hash = p_invitation_key_hash;

    return jsonb_build_object(
      'ok', false,
      'retry_after_seconds', v_retry_after_seconds
    );
  end if;

  update public.classroom_join_rate_limits
  set attempt_timestamps = array_append(v_invitation_attempts, v_now),
      updated_at = v_now
  where scope = 'invitation' and key_hash = p_invitation_key_hash;

  return jsonb_build_object('ok', true);
end;
$$;

create function public.cleanup_classroom_join_rate_limits_v1(
  p_batch_size integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_batch_size not between 1 and 10000 then
    raise exception using
      errcode = '22023',
      message = 'invalid_classroom_join_rate_limit_cleanup_input';
  end if;

  -- Cleanup stays off the request path. SKIP LOCKED makes a maintenance run
  -- harmless alongside active joins and bounds each invocation.
  delete from public.classroom_join_rate_limits stale
  where (stale.scope, stale.key_hash) in (
    select candidate.scope, candidate.key_hash
    from public.classroom_join_rate_limits candidate
    where candidate.updated_at < clock_timestamp() - interval '1 day'
    order by candidate.scope, candidate.key_hash
    limit p_batch_size
    for update skip locked
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create function public.join_classroom_by_code_atomic_v1(
  p_actor_id uuid,
  p_expected_classroom_id uuid,
  p_class_code text,
  p_actor_key_hash text,
  p_invitation_key_hash text,
  p_first_name text default null,
  p_last_name text default null,
  p_student_number text default null,
  p_pal_event jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.users%rowtype;
  v_classroom public.classrooms%rowtype;
  v_enrollment public.classroom_enrollments%rowtype;
  v_roster public.classroom_roster%rowtype;
  v_binding public.classroom_roster_student_bindings%rowtype;
  v_outbox public.pal_event_outbox%rowtype;
  v_rate_limit jsonb;
  v_normalized_code text := upper(btrim(p_class_code));
  v_normalized_email text;
  v_first_name text := nullif(btrim(p_first_name), '');
  v_last_name text := nullif(btrim(p_last_name), '');
  v_student_number text := nullif(btrim(p_student_number), '');
  v_roster_count integer := 0;
  v_created boolean := false;
begin
  if p_actor_id is null
    or p_expected_classroom_id is null
    or p_class_code is null
    or v_normalized_code = ''
    or length(v_normalized_code) > 64
    or (v_first_name is not null and length(v_first_name) > 100)
    or (v_last_name is not null and length(v_last_name) > 100)
    or (v_student_number is not null and length(v_student_number) > 100)
    or (p_pal_event is not null and (
      jsonb_typeof(p_pal_event) <> 'object' or pg_column_size(p_pal_event) > 32768
    )) then
    raise exception using
      errcode = '22023',
      message = 'invalid_classroom_join_input';
  end if;

  if p_pal_event is not null and (
    p_pal_event <> jsonb_build_object(
      'schema_version', p_pal_event->'schema_version',
      'idempotency_key', p_pal_event->'idempotency_key',
      'learner_id', p_pal_event->'learner_id',
      'event_type', p_pal_event->'event_type',
      'occurred_at', p_pal_event->'occurred_at',
      'metadata', p_pal_event->'metadata'
    )
    or p_pal_event->'schema_version' is distinct from '1'::jsonb
    or p_pal_event->>'event_type' <> 'classroom.joined'
    or p_pal_event->>'idempotency_key' !~ '^pika:v1:pika-fact-[A-Za-z0-9_-]{43}$'
    or p_pal_event->>'learner_id' !~ '^pika-learner-[A-Za-z0-9_-]{43}$'
    or p_pal_event->>'occurred_at' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or jsonb_typeof(p_pal_event->'metadata') <> 'object'
  ) then
    raise exception using errcode = '22023', message = 'invalid_classroom_join_pal_event';
  end if;

  if p_pal_event is not null and (
    p_pal_event->'metadata' <> jsonb_build_object(
      'classroom_token', p_pal_event->'metadata'->'classroom_token'
    )
    or jsonb_typeof(p_pal_event->'metadata'->'classroom_token') <> 'string'
    or p_pal_event->'metadata'->>'classroom_token' !~
      '^pika-classroom-[A-Za-z0-9_-]{43}$'
  ) then
    raise exception using errcode = '22023', message = 'invalid_classroom_join_pal_metadata';
  end if;

  -- Consume both budgets before looking up an actor or invitation. The trusted
  -- server adapter derives invitation keys from actor ID + normalized code so
  -- one attacker cannot exhaust a classroom-wide budget.
  v_rate_limit := private.consume_classroom_join_rate_limits_v1(
    p_actor_key_hash,
    p_invitation_key_hash
  );
  if not coalesce((v_rate_limit->>'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'status', 429,
      'error_code', 'rate_limited',
      'retry_after_seconds', (v_rate_limit->>'retry_after_seconds')::integer
    );
  end if;

  -- The limiter lives outside this subtransaction. Any later database failure
  -- rolls back every membership side effect while preserving the charged
  -- attempt, so repeated failing requests still reach the abuse ceiling.
  begin

  select actor.* into v_actor
  from public.users actor
  where actor.id = p_actor_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error_code', 'actor_not_found');
  end if;
  v_normalized_email := lower(btrim(v_actor.email));
  if v_normalized_email = '' or length(v_normalized_email) > 320 then
    raise exception using errcode = '22023', message = 'invalid_classroom_join_actor';
  end if;

  -- Binding both values prevents a valid code outside the caller's prechecked
  -- classroom scope from being used as an oracle or as membership authority.
  select classroom.* into v_classroom
  from public.classrooms classroom
  where classroom.id = p_expected_classroom_id
    and upper(btrim(classroom.class_code)) = v_normalized_code
  for update;

  if not found or v_classroom.archived_at is not null then
    return jsonb_build_object('ok', false, 'status', 404, 'error_code', 'classroom_not_found');
  end if;
  if v_classroom.teacher_id = p_actor_id then
    return jsonb_build_object('ok', false, 'status', 403, 'error_code', 'owner_self_join');
  end if;

  select enrollment.* into v_enrollment
  from public.classroom_enrollments enrollment
  where enrollment.classroom_id = v_classroom.id
    and enrollment.student_id = p_actor_id
  for update;

  -- Lock all case-normalized matches. Current roster writers normalize email,
  -- while the count also fails closed if legacy casing produced duplicates.
  perform 1
  from public.classroom_roster roster
  where roster.classroom_id = v_classroom.id
    and lower(btrim(roster.email)) = v_normalized_email
  order by roster.id
  for update;

  select count(*)::integer into v_roster_count
  from public.classroom_roster roster
  where roster.classroom_id = v_classroom.id
    and lower(btrim(roster.email)) = v_normalized_email;
  if v_roster_count > 1 then
    return jsonb_build_object('ok', false, 'status', 409, 'error_code', 'roster_ambiguous');
  elsif v_roster_count = 1 then
    select roster.* into v_roster
    from public.classroom_roster roster
    where roster.classroom_id = v_classroom.id
      and lower(btrim(roster.email)) = v_normalized_email
    order by roster.id
    limit 1;
  end if;

  if v_roster.id is not null then
    select binding.* into v_binding
    from public.classroom_roster_student_bindings binding
    where binding.roster_id = v_roster.id
    for update;
    if found and v_binding.student_id <> p_actor_id then
      return jsonb_build_object('ok', false, 'status', 409, 'error_code', 'roster_binding_conflict');
    end if;
  end if;

  if v_enrollment.id is null then
    if not v_classroom.allow_enrollment then
      return jsonb_build_object('ok', false, 'status', 403, 'error_code', 'enrollment_closed');
    end if;
    if v_classroom.join_policy = 'roster' and v_roster.id is null then
      return jsonb_build_object('ok', false, 'status', 403, 'error_code', 'not_on_roster');
    end if;
    if v_classroom.join_policy = 'open_join' and v_roster.id is null then
      if v_first_name is null or v_last_name is null then
        return jsonb_build_object(
          'ok', false,
          'status', 400,
          'error_code', 'profile_required',
          'required_fields', jsonb_build_array('firstName', 'lastName')
        );
      end if;

      insert into public.classroom_roster (
        classroom_id,
        email,
        student_number,
        first_name,
        last_name,
        counselor_email,
        join_source
      ) values (
        v_classroom.id,
        v_normalized_email,
        v_student_number,
        v_first_name,
        v_last_name,
        null,
        'open_join'
      )
      on conflict (classroom_id, email) do nothing
      returning * into v_roster;

      if v_roster.id is null then
        select roster.* into v_roster
        from public.classroom_roster roster
        where roster.classroom_id = v_classroom.id
          and roster.email = v_normalized_email
        for update;
      end if;
    end if;

    insert into public.classroom_enrollments (classroom_id, student_id)
    values (v_classroom.id, p_actor_id)
    on conflict (classroom_id, student_id) do nothing
    returning * into v_enrollment;
    v_created := found;

    if not v_created then
      select enrollment.* into v_enrollment
      from public.classroom_enrollments enrollment
      where enrollment.classroom_id = v_classroom.id
        and enrollment.student_id = p_actor_id
      for update;
    end if;
  end if;

  if v_roster.id is not null then
    insert into public.classroom_roster_student_bindings (
      roster_id,
      classroom_id,
      student_id
    ) values (
      v_roster.id,
      v_classroom.id,
      p_actor_id
    )
    on conflict (roster_id) do nothing;

    select binding.* into v_binding
    from public.classroom_roster_student_bindings binding
    where binding.roster_id = v_roster.id
    for update;
    if not found
      or v_binding.classroom_id <> v_classroom.id
      or v_binding.student_id <> p_actor_id then
      raise exception using errcode = '23505', message = 'classroom_roster_binding_conflict';
    end if;

    if v_roster.first_name is not null and v_roster.last_name is not null then
      insert into public.student_profiles (
        user_id,
        student_number,
        first_name,
        last_name
      ) values (
        p_actor_id,
        v_roster.student_number,
        v_roster.first_name,
        v_roster.last_name
      )
      on conflict (user_id) do nothing;
    end if;
  end if;

  if v_created and p_pal_event is not null then
    v_outbox := private.enqueue_pal_event(
      p_actor_id,
      'classroom_enrollment',
      v_classroom.id::text,
      p_pal_event
    );
    if v_outbox.id is null
      or v_outbox.student_id is distinct from p_actor_id
      or v_outbox.event_type is distinct from 'classroom.joined'
      or v_outbox.source_kind is distinct from 'classroom_enrollment'
      or v_outbox.source_id is distinct from v_classroom.id::text
      or v_outbox.payload->>'idempotency_key' is distinct from p_pal_event->>'idempotency_key'
      or v_outbox.payload->>'learner_id' is distinct from p_pal_event->>'learner_id'
      or v_outbox.payload->'metadata'->>'classroom_token'
        is distinct from p_pal_event->'metadata'->>'classroom_token' then
      raise exception using errcode = '23505', message = 'classroom_join_pal_evidence_conflict';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', case when v_created then 201 else 200 end,
    'created', v_created,
    'already_enrolled', not v_created,
    'classroom', jsonb_build_object(
      'id', v_classroom.id,
      'title', v_classroom.title,
      'term_label', v_classroom.term_label
    ),
    'enrollment', jsonb_build_object(
      'id', v_enrollment.id,
      'created_at', v_enrollment.created_at
    )
  );
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'status', 500,
      'error_code', 'join_failed'
    );
  end;
end;
$$;

revoke all on function private.consume_classroom_join_rate_limits_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_classroom_join_rate_limits_v1(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.join_classroom_by_code_atomic_v1(uuid, uuid, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_classroom_join_rate_limits_v1(integer)
  to service_role;
grant execute on function public.join_classroom_by_code_atomic_v1(uuid, uuid, text, text, text, text, text, text, jsonb)
  to service_role;

comment on table public.classroom_join_rate_limits is
  'Private rolling windows for contextual classroom join actor and actor-invitation guesses.';
comment on function public.join_classroom_by_code_atomic_v1(uuid, uuid, text, text, text, text, text, text, jsonb) is
  'Dormant service-only atomic classroom join primitive; no live route adopts it in migration 157.';
