-- Pal achievement pilot: durable, privacy-safe delivery outbox.
--
-- Pika remains the academic source of truth. These tables are an internal
-- delivery ledger; only the JSON payload crosses the Pal boundary.

create table public.pal_event_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  student_id uuid not null,
  event_type text not null,
  source_kind text not null,
  source_id text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pal_event_outbox_event_type_check check (
    event_type in (
      'platform.session.started',
      'classroom.joined',
      'daily_log_week.configured',
      'daily_log.completed',
      'learning_item.viewed',
      'learning_item.completed'
    )
  ),
  constraint pal_event_outbox_status_check check (
    status in ('pending', 'processing', 'delivered', 'non_retryable')
  ),
  constraint pal_event_outbox_attempts_check check (attempts >= 0),
  constraint pal_event_outbox_payload_check check (
    jsonb_typeof(payload) = 'object'
    and payload->>'idempotency_key' = idempotency_key
    and payload->>'event_type' = event_type
    and payload->>'schema_version' = '1'
    and jsonb_typeof(payload->'metadata') = 'object'
  )
);

create index pal_event_outbox_delivery_idx
  on public.pal_event_outbox (next_attempt_at, created_at)
  where status in ('pending', 'processing');

create index pal_event_outbox_student_created_idx
  on public.pal_event_outbox (student_id, created_at desc);

create table public.pal_daily_log_week_configurations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  period_key text not null,
  config_version integer not null,
  period_status text not null,
  eligible_days integer not null,
  configured_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pal_daily_log_week_config_version_check check (config_version >= 1),
  constraint pal_daily_log_week_period_status_check check (
    period_status in ('open', 'closed')
  ),
  constraint pal_daily_log_week_eligible_days_check check (
    eligible_days between 0 and 5
  ),
  unique (student_id, period_key, config_version)
);

create index pal_daily_log_week_latest_idx
  on public.pal_daily_log_week_configurations (
    student_id,
    period_key,
    config_version desc
  );

alter table public.pal_event_outbox enable row level security;
alter table public.pal_daily_log_week_configurations enable row level security;

revoke all on table public.pal_event_outbox from public, anon, authenticated;
revoke all on table public.pal_daily_log_week_configurations from public, anon, authenticated;
grant select, insert, update on table public.pal_event_outbox to service_role;
grant select, insert on table public.pal_daily_log_week_configurations to service_role;

create or replace function private.enqueue_pal_event(
  p_student_id uuid,
  p_source_kind text,
  p_source_id text,
  p_event jsonb
)
returns public.pal_event_outbox
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_outbox public.pal_event_outbox;
  v_idempotency_key text;
  v_event_type text;
begin
  if p_event is null then
    return null;
  end if;

  v_idempotency_key := p_event->>'idempotency_key';
  v_event_type := p_event->>'event_type';

  if p_student_id is null
    or nullif(btrim(p_source_kind), '') is null
    or nullif(btrim(p_source_id), '') is null
    or nullif(v_idempotency_key, '') is null
    or length(v_idempotency_key) > 200
    or nullif(p_event->>'learner_id', '') is null
    or nullif(p_event->>'occurred_at', '') is null
    or jsonb_typeof(p_event->'metadata') <> 'object'
    or p_event->>'schema_version' <> '1'
    or v_event_type not in (
      'platform.session.started',
      'classroom.joined',
      'daily_log_week.configured',
      'daily_log.completed',
      'learning_item.viewed',
      'learning_item.completed'
    ) then
    raise exception 'Invalid Pal v1 outbox event' using errcode = '22023';
  end if;

  insert into public.pal_event_outbox (
    idempotency_key,
    student_id,
    event_type,
    source_kind,
    source_id,
    payload
  ) values (
    v_idempotency_key,
    p_student_id,
    v_event_type,
    p_source_kind,
    p_source_id,
    p_event
  )
  on conflict (idempotency_key) do nothing
  returning * into v_outbox;

  if not found then
    select * into v_outbox
    from public.pal_event_outbox
    where idempotency_key = v_idempotency_key;
  end if;

  return v_outbox;
end;
$$;

create or replace function public.enqueue_pal_event(
  p_student_id uuid,
  p_source_kind text,
  p_source_id text,
  p_event jsonb
)
returns public.pal_event_outbox
language sql
security definer
set search_path = public, private
as $$
  select private.enqueue_pal_event(
    p_student_id,
    p_source_kind,
    p_source_id,
    p_event
  );
$$;

create or replace function public.create_classroom_enrollment_with_pal_event_atomic(
  p_classroom_id uuid,
  p_student_id uuid,
  p_pal_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_enrollment public.classroom_enrollments;
  v_created boolean := false;
begin
  if p_classroom_id is null or p_student_id is null then
    raise exception 'Invalid classroom enrollment request' using errcode = '22023';
  end if;

  insert into public.classroom_enrollments (classroom_id, student_id)
  values (p_classroom_id, p_student_id)
  on conflict (classroom_id, student_id) do nothing
  returning * into v_enrollment;

  if found then
    v_created := true;
    perform private.enqueue_pal_event(
      p_student_id,
      'classroom_enrollment',
      p_classroom_id::text,
      p_pal_event
    );
  else
    select * into v_enrollment
    from public.classroom_enrollments
    where classroom_id = p_classroom_id and student_id = p_student_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'enrollment', to_jsonb(v_enrollment)
  );
end;
$$;

create or replace function public.upsert_student_entry_with_pal_event_atomic(
  p_student_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_text text,
  p_rich_content jsonb,
  p_minutes_reported integer,
  p_mood text,
  p_on_time boolean,
  p_expected_version integer,
  p_pal_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_entry public.entries;
  v_created boolean := false;
begin
  if p_student_id is null
    or p_classroom_id is null
    or p_date is null
    or p_text is null
    or p_rich_content is null
    or p_on_time is null then
    raise exception 'Invalid student entry request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'pal_daily_log:' || p_student_id::text || ':' || p_classroom_id::text || ':' || p_date::text,
      0
    )
  );

  select * into v_entry
  from public.entries
  where student_id = p_student_id
    and classroom_id = p_classroom_id
    and date = p_date
  for update;

  if found then
    if p_expected_version is not null
      and coalesce(v_entry.version, 1) <> p_expected_version then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'error', 'Entry has been updated elsewhere',
        'entry', to_jsonb(v_entry)
      );
    end if;

    update public.entries
    set text = p_text,
        rich_content = p_rich_content,
        minutes_reported = p_minutes_reported,
        mood = p_mood,
        on_time = p_on_time,
        version = coalesce(version, 1) + 1
    where id = v_entry.id
    returning * into v_entry;
  else
    if p_expected_version is not null then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'error', 'Entry has been updated elsewhere',
        'entry', null
      );
    end if;

    insert into public.entries (
      student_id,
      classroom_id,
      date,
      text,
      rich_content,
      minutes_reported,
      mood,
      on_time
    ) values (
      p_student_id,
      p_classroom_id,
      p_date,
      p_text,
      p_rich_content,
      p_minutes_reported,
      p_mood,
      p_on_time
    )
    returning * into v_entry;
    v_created := true;
  end if;

  perform private.enqueue_pal_event(
    p_student_id,
    'daily_log',
    p_date::text,
    p_pal_event
  );

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'entry', to_jsonb(v_entry)
  );
end;
$$;

create or replace function public.create_assignment_doc_with_pal_event_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_viewed_at timestamptz,
  p_pal_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_doc public.assignment_docs;
  v_created boolean := false;
begin
  if p_assignment_id is null or p_student_id is null or p_viewed_at is null then
    raise exception 'Invalid assignment view request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'pal_assignment_view:' || p_assignment_id::text || ':' || p_student_id::text,
      0
    )
  );

  select * into v_doc
  from public.assignment_docs
  where assignment_id = p_assignment_id and student_id = p_student_id
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
      p_student_id,
      '{"type":"doc","content":[]}'::jsonb,
      null,
      null,
      false,
      null,
      p_viewed_at
    )
    returning * into v_doc;
    v_created := true;

    perform private.enqueue_pal_event(
      p_student_id,
      'assignment_first_view',
      p_assignment_id::text,
      p_pal_event
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'doc', to_jsonb(v_doc)
  );
end;
$$;

create or replace function public.submit_assignment_doc_with_pal_event_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer,
  p_pal_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_doc public.assignment_docs;
  v_history public.assignment_doc_history;
begin
  if p_assignment_id is null or p_student_id is null or p_content is null
    or p_expected_updated_at is null then
    raise exception 'Invalid assignment document submission request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select * into v_doc
  from public.assignment_docs
  where assignment_id = p_assignment_id and student_id = p_student_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 400, 'error_code', 'assignment_doc_missing',
      'error', 'No work to submit. Please save your work first.'
    );
  end if;

  if v_doc.is_submitted then
    if v_doc.content = p_content then
      select * into v_history
      from public.assignment_doc_history
      where assignment_doc_id = v_doc.id
        and trigger = 'submit'
        and created_at >= coalesce(v_doc.submitted_at, '-infinity'::timestamptz)
        and patch is null
        and snapshot = v_doc.content
      order by created_at desc, id desc
      limit 1;

      if not found then
        insert into public.assignment_doc_history (
          assignment_doc_id, patch, snapshot, word_count, char_count,
          paste_word_count, keystroke_count, trigger, created_at
        ) values (
          v_doc.id, null, v_doc.content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
          0, 0, 'submit', clock_timestamp()
        ) returning * into v_history;
      end if;

      return jsonb_build_object(
        'ok', true, 'idempotent', true, 'doc', to_jsonb(v_doc),
        'history_entry', to_jsonb(v_history)
      );
    end if;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_submitted',
      'error', 'This assignment is already submitted and cannot be changed.'
    );
  end if;

  if v_doc.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'assignment_doc_revision_conflict',
      'error', 'Your saved draft changed before submission. Review it and try again.'
    );
  end if;

  perform private.validate_assignment_submission_requirements(v_doc);

  update public.assignment_docs
  set content = p_content,
      is_submitted = true,
      submitted_at = clock_timestamp()
  where id = v_doc.id and is_submitted is false
  returning * into v_doc;

  insert into public.assignment_doc_history (
    assignment_doc_id, patch, snapshot, word_count, char_count,
    paste_word_count, keystroke_count, trigger, created_at
  ) values (
    v_doc.id, null, p_content, coalesce(p_word_count, 0), coalesce(p_char_count, 0),
    0, 0, 'submit', clock_timestamp()
  ) returning * into v_history;

  perform private.enqueue_pal_event(
    p_student_id,
    'assignment_first_completion',
    p_assignment_id::text,
    p_pal_event
  );

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'doc', to_jsonb(v_doc), 'history_entry', to_jsonb(v_history)
  );
end;
$$;

create or replace function public.record_pal_daily_log_week_configuration_atomic(
  p_student_id uuid,
  p_period_key text,
  p_config_version integer,
  p_period_status text,
  p_eligible_days integer,
  p_configured_at timestamptz,
  p_pal_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_existing public.pal_daily_log_week_configurations;
  v_previous public.pal_daily_log_week_configurations;
begin
  if p_student_id is null
    or nullif(btrim(p_period_key), '') is null
    or p_config_version < 1
    or p_period_status not in ('open', 'closed')
    or p_eligible_days not between 0 and 5
    or p_configured_at is null then
    raise exception 'Invalid Pal weekly configuration' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'pal_daily_log_week:' || p_student_id::text || ':' || p_period_key,
      0
    )
  );

  select * into v_existing
  from public.pal_daily_log_week_configurations
  where student_id = p_student_id
    and period_key = p_period_key
    and config_version = p_config_version;

  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'configuration', to_jsonb(v_existing)
    );
  end if;

  select * into v_previous
  from public.pal_daily_log_week_configurations
  where student_id = p_student_id and period_key = p_period_key
  order by config_version desc
  limit 1
  for update;

  if found and v_previous.period_status = 'closed' then
    raise exception 'Pal weekly configuration is already closed' using errcode = '23514';
  end if;

  if found and p_config_version <> v_previous.config_version + 1 then
    raise exception 'Pal weekly configuration version must be monotonic' using errcode = '23514';
  end if;

  if not found and p_config_version <> 1 then
    raise exception 'First Pal weekly configuration version must be 1' using errcode = '23514';
  end if;

  insert into public.pal_daily_log_week_configurations (
    student_id,
    period_key,
    config_version,
    period_status,
    eligible_days,
    configured_at
  ) values (
    p_student_id,
    p_period_key,
    p_config_version,
    p_period_status,
    p_eligible_days,
    p_configured_at
  )
  returning * into v_existing;

  perform private.enqueue_pal_event(
    p_student_id,
    'daily_log_week_configuration',
    p_period_key || ':' || p_config_version::text,
    p_pal_event
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'configuration', to_jsonb(v_existing)
  );
end;
$$;

create or replace function public.claim_pal_event_outbox(
  p_limit integer default 25,
  p_lease_seconds integer default 60
)
returns setof public.pal_event_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 10 and 600 then
    raise exception 'Invalid Pal outbox claim options' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select id
    from public.pal_event_outbox
    where (
      status = 'pending' and next_attempt_at <= now()
    ) or (
      status = 'processing' and lease_expires_at <= now()
    )
    order by next_attempt_at, created_at
    limit p_limit
    for update skip locked
  )
  update public.pal_event_outbox outbox
  set status = 'processing',
      attempts = outbox.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_attempt_at = now(),
      updated_at = now()
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

create or replace function public.count_pal_event_outbox_ready()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*)
  from public.pal_event_outbox
  where (
    status = 'pending' and next_attempt_at <= now()
  ) or (
    status = 'processing' and lease_expires_at <= now()
  );
$$;

create or replace function public.complete_pal_event_outbox(
  p_outbox_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pal_event_outbox
  set status = 'delivered',
      delivered_at = now(),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      last_error_detail = null,
      updated_at = now()
  where id = p_outbox_id
    and status = 'processing'
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.retry_pal_event_outbox(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_next_attempt_at timestamptz,
  p_error_code text,
  p_error_detail text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pal_event_outbox
  set status = 'pending',
      next_attempt_at = greatest(p_next_attempt_at, now()),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = left(nullif(p_error_code, ''), 100),
      last_error_detail = left(nullif(p_error_detail, ''), 500),
      updated_at = now()
  where id = p_outbox_id
    and status = 'processing'
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.fail_pal_event_outbox(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_detail text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pal_event_outbox
  set status = 'non_retryable',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = left(nullif(p_error_code, ''), 100),
      last_error_detail = left(nullif(p_error_detail, ''), 500),
      updated_at = now()
  where id = p_outbox_id
    and status = 'processing'
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.requeue_pal_event_outbox(
  p_outbox_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pal_event_outbox
  set status = 'pending',
      next_attempt_at = now(),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      last_error_detail = null,
      updated_at = now()
  where id = p_outbox_id
    and status = 'non_retryable';
  return found;
end;
$$;

revoke all on function private.enqueue_pal_event(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.enqueue_pal_event(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_classroom_enrollment_with_pal_event_atomic(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.upsert_student_entry_with_pal_event_atomic(uuid, uuid, date, text, jsonb, integer, text, boolean, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_assignment_doc_with_pal_event_atomic(uuid, uuid, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.submit_assignment_doc_with_pal_event_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_pal_daily_log_week_configuration_atomic(uuid, text, integer, text, integer, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_pal_event_outbox(integer, integer)
  from public, anon, authenticated;
revoke all on function public.count_pal_event_outbox_ready()
  from public, anon, authenticated;
revoke all on function public.complete_pal_event_outbox(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.retry_pal_event_outbox(uuid, uuid, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_pal_event_outbox(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.requeue_pal_event_outbox(uuid)
  from public, anon, authenticated;

grant execute on function public.enqueue_pal_event(uuid, text, text, jsonb)
  to service_role;
grant execute on function public.create_classroom_enrollment_with_pal_event_atomic(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.upsert_student_entry_with_pal_event_atomic(uuid, uuid, date, text, jsonb, integer, text, boolean, integer, jsonb)
  to service_role;
grant execute on function public.create_assignment_doc_with_pal_event_atomic(uuid, uuid, timestamptz, jsonb)
  to service_role;
grant execute on function public.submit_assignment_doc_with_pal_event_atomic(uuid, uuid, jsonb, timestamptz, integer, integer, jsonb)
  to service_role;
grant execute on function public.record_pal_daily_log_week_configuration_atomic(uuid, text, integer, text, integer, timestamptz, jsonb)
  to service_role;
grant execute on function public.claim_pal_event_outbox(integer, integer)
  to service_role;
grant execute on function public.count_pal_event_outbox_ready()
  to service_role;
grant execute on function public.complete_pal_event_outbox(uuid, uuid)
  to service_role;
grant execute on function public.retry_pal_event_outbox(uuid, uuid, timestamptz, text, text)
  to service_role;
grant execute on function public.fail_pal_event_outbox(uuid, uuid, text, text)
  to service_role;
grant execute on function public.requeue_pal_event_outbox(uuid)
  to service_role;

comment on table public.pal_event_outbox is
  'Internal Pika delivery ledger for privacy-safe Pal facts; payload is the only outbound data.';
comment on table public.pal_daily_log_week_configurations is
  'Pika-owned learner/week opportunity revisions used to reconcile Weekly Rhythm facts.';
