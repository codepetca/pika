-- Phase 2. Installation captures no history and enables no profiles or signals.
-- The existing outbox owns leases/retries; these private rows bind fresh facts
-- and weekly opportunity versions to immutable membership generations.
begin;
set local lock_timeout = '5s';

create table private.pal_classroom_signal_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  activated_at timestamptz,
  check (not enabled or activated_at is not null)
);
insert into private.pal_classroom_signal_settings(singleton) values (true);

create table private.pal_membership_outbox (
  outbox_id uuid primary key,
  generation_id uuid not null,
  classroom_id uuid not null,
  student_id uuid not null,
  learner_id text not null,
  unique (outbox_id, generation_id)
);
create index pal_membership_outbox_generation on private.pal_membership_outbox(generation_id);

create table private.pal_membership_week_configurations (
  generation_id uuid not null,
  period_key text not null,
  config_version integer not null check (config_version > 0),
  period_status text not null check (period_status in ('open', 'closed')),
  eligible_days integer not null check (eligible_days between 0 and 5),
  primary key (generation_id, period_key, config_version)
);

alter table private.pal_classroom_signal_settings enable row level security;
alter table private.pal_membership_outbox enable row level security;
alter table private.pal_membership_week_configurations enable row level security;
revoke all on private.pal_classroom_signal_settings, private.pal_membership_outbox,
  private.pal_membership_week_configurations from public, anon, authenticated, service_role;

create function private.guard_pal_signal_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception using errcode = '55000', message = 'pal_activation_boundary_immutable';
  end if;
  return new;
end;
$$;
create trigger guard_pal_signal_activation before update on private.pal_classroom_signal_settings
  for each row execute function private.guard_pal_signal_activation();

create function private.pal_classroom_signals_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled and activated_at <= now()
    from private.pal_classroom_signal_settings where singleton), false)
    and coalesce((select enabled from private.pal_membership_settings where singleton), false);
$$;

-- Server-only snapshot. Rechecked before and after network calls by the caller.
create function public.resolve_pal_classroom_context(p_student_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_resolution jsonb; v_generation uuid;
begin
  if not private.pal_classroom_signals_enabled() then
    return jsonb_build_object('status', 'disabled');
  end if;
  v_resolution := public.resolve_pal_membership(p_student_id, p_classroom_id);
  if v_resolution->>'status' <> 'active' then return v_resolution; end if;
  select id into strict v_generation from public.classroom_enrollments
    where student_id = p_student_id and classroom_id = p_classroom_id;
  return v_resolution || jsonb_build_object('generation_id', v_generation,
    'scope_key', 'pika-classroom-v1-' || encode(extensions.digest(
      'widget:' || (v_resolution->>'learner_id'), 'sha256'), 'hex'));
end;
$$;

-- Preserve legacy wire data byte-for-byte. Never relabel an old event. Once the
-- database cutover gate is on, legacy producers are quiesced even on old servers.
create function private.enqueue_legacy_pal_event(
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

create or replace function private.enqueue_pal_event(p_student_id uuid, p_source_kind text, p_source_id text, p_event jsonb)
returns public.pal_event_outbox language plpgsql security definer set search_path = '' as $$
begin
  if private.pal_classroom_signals_enabled() then return null; end if;
  return private.enqueue_legacy_pal_event(p_student_id, p_source_kind, p_source_id, p_event);
end;
$$;

create function private.enqueue_membership_pal_fact(
  p_student_id uuid, p_classroom_id uuid, p_event_type text,
  p_fact_key text, p_occurred_at timestamptz, p_metadata jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_event jsonb; v_outbox public.pal_event_outbox;
begin
  v_context := public.resolve_pal_classroom_context(p_student_id, p_classroom_id);
  if v_context->>'status' <> 'active' then return null; end if;
  if p_occurred_at < (select activated_at from private.pal_classroom_signal_settings where singleton)
    or p_occurred_at > clock_timestamp() then return null; end if;
  v_event := jsonb_build_object(
    'schema_version', 1, 'learner_id', v_context->>'learner_id',
    'idempotency_key', 'pika:membership:v1:' || encode(extensions.digest(
      (v_context->>'learner_id') || ':' || p_event_type || ':' || p_fact_key, 'sha256'), 'hex'),
    'event_type', p_event_type,
    'occurred_at', to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'metadata', p_metadata);
  v_outbox := private.enqueue_legacy_pal_event(p_student_id, 'membership_v1',
    v_context->>'generation_id', v_event);
  insert into private.pal_membership_outbox(outbox_id, generation_id, classroom_id, student_id, learner_id)
    values (v_outbox.id, (v_context->>'generation_id')::uuid, p_classroom_id, p_student_id,
      v_context->>'learner_id') on conflict (outbox_id) do nothing;
  return v_outbox.id;
end;
$$;

create function private.pal_membership_token(p_reference text, p_kind text, p_value text)
returns text language sql immutable strict set search_path = '' as $$
  select 'pika-' || p_kind || '-' || encode(extensions.digest(
    p_reference || ':' || p_kind || ':' || p_value, 'sha256'), 'hex');
$$;

create function private.capture_membership_pal_source()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz; v_now timestamptz := clock_timestamp();
  v_classroom uuid; v_context jsonb; v_assignment public.assignments;
  v_day date := (v_now at time zone 'America/Toronto')::date;
  v_period text := 'pika-week-' || to_char(date_trunc('week', v_day::timestamp), 'YYYY-MM-DD');
  v_item text; v_release timestamptz;
begin
  if not private.pal_classroom_signals_enabled()
    or coalesce(public.is_classroom_archive_maintenance_mode('restore'), false) then return new; end if;
  select activated_at into v_start from private.pal_classroom_signal_settings where singleton;
  -- Imported/restored/previously authored source rows are never fresh activity.
  if new.created_at < v_start then return new; end if;
  if tg_table_name = 'classroom_enrollments' then
    v_context := public.resolve_pal_classroom_context(new.student_id, new.classroom_id);
    if v_context->>'status' <> 'active' then return new; end if;
    perform private.enqueue_membership_pal_fact(new.student_id, new.classroom_id,
      'classroom.joined', 'joined', v_now, jsonb_build_object('classroom_token',
        private.pal_membership_token(v_context->>'learner_id', 'classroom', new.classroom_id::text)));
  elsif tg_table_name = 'entries' then
    -- Only an actual current-day log, including a newly filled empty draft.
    if new.date <> v_day or nullif(btrim(new.text), '') is null then return new; end if;
    if not exists (select 1 from public.classroom_enrollments
      where student_id = new.student_id and classroom_id = new.classroom_id
        and created_at <= new.created_at) then return new; end if;
    if not exists (select 1 from public.class_days where classroom_id = new.classroom_id
      and date = new.date and is_class_day) then return new; end if;
    perform private.enqueue_membership_pal_fact(new.student_id, new.classroom_id,
      'daily_log.completed', new.date::text, v_now,
      jsonb_build_object('period_key', v_period, 'activity_day', new.date::text));
  elsif tg_table_name = 'assignment_docs' then
    select * into v_assignment from public.assignments where id = new.assignment_id;
    v_classroom := v_assignment.classroom_id;
    -- Match the academic visibility contract, including legacy live assignments.
    if v_assignment.is_draft or v_assignment.released_at > v_now then return new; end if;
    v_release := coalesce(v_assignment.released_at, v_assignment.created_at);
    v_context := public.resolve_pal_classroom_context(new.student_id, v_classroom);
    if v_context->>'status' <> 'active' then return new; end if;
    if not exists (select 1 from public.classroom_enrollments
      where id = (v_context->>'generation_id')::uuid and created_at <= new.created_at)
    then return new; end if;
    v_item := private.pal_membership_token(v_context->>'learner_id', 'item', new.assignment_id::text);
    if new.viewed_at is not null and new.viewed_at >= v_start
      and (tg_op = 'INSERT' or old.viewed_at is null) then
      perform private.enqueue_membership_pal_fact(new.student_id, v_classroom,
        'learning_item.viewed', new.assignment_id::text, v_now,
        jsonb_build_object('kind', 'assignment', 'item_token', v_item, 'period_key', v_period,
          'timing', case when v_now <= v_release + interval '24 hours'
            then 'within_24h_of_release' else 'later' end));
    end if;
    if new.is_submitted and new.submitted_at >= v_start
      and (tg_op = 'INSERT' or not old.is_submitted) then
      perform private.enqueue_membership_pal_fact(new.student_id, v_classroom,
        'learning_item.completed', new.assignment_id::text, new.submitted_at,
        jsonb_build_object('kind', 'assignment', 'item_token', v_item, 'period_key', v_period,
          'timing', case when v_assignment.due_at is null or new.submitted_at <= v_assignment.due_at
            then 'on_time' else 'late' end));
    end if;
  end if;
  return new;
end;
$$;

-- Alphabetic AFTER INSERT order ensures Phase 1 registers the generation first.
create trigger z_capture_membership_pal_join after insert on public.classroom_enrollments
  for each row execute function private.capture_membership_pal_source();
create trigger capture_membership_pal_daily_log after insert or update on public.entries
  for each row execute function private.capture_membership_pal_source();
create trigger capture_membership_pal_assignment after insert or update on public.assignment_docs
  for each row execute function private.capture_membership_pal_source();

-- A visit is a same-origin authenticated browser POST, never a login fan-out.
-- Daily dedup is per generation, including across reloads and sessions.
create function public.record_pal_classroom_visit(p_student_id uuid, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_outbox uuid; v_now timestamptz := clock_timestamp();
begin
  v_context := public.resolve_pal_classroom_context(p_student_id, p_classroom_id);
  if v_context->>'status' <> 'active' then return jsonb_build_object('status', v_context->>'status'); end if;
  v_outbox := private.enqueue_membership_pal_fact(p_student_id, p_classroom_id,
    'platform.session.started', (v_now at time zone 'America/Toronto')::date::text,
    v_now, '{}'::jsonb);
  return jsonb_build_object('status', 'recorded');
end;
$$;

-- Network authorization is a snapshot. Provider-side token/event fencing and
-- revocation remain Phase 3; no database lock is held across an HTTP request.
create function public.authorize_pal_membership_delivery(p_outbox_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_binding private.pal_membership_outbox; v_context jsonb;
begin
  select * into v_binding from private.pal_membership_outbox where outbox_id = p_outbox_id;
  if not found then return jsonb_build_object('status', 'legacy'); end if;
  v_context := public.resolve_pal_classroom_context(v_binding.student_id, v_binding.classroom_id);
  if v_context->>'status' = 'disabled' then return jsonb_build_object('status', 'disabled'); end if;
  if v_context->>'status' <> 'active'
    or v_context->>'generation_id' is distinct from v_binding.generation_id::text
    or v_context->>'learner_id' is distinct from v_binding.learner_id
    or not exists (select 1 from public.pal_event_outbox where id = p_outbox_id
      and status = 'processing' and lease_token = p_lease_token and lease_expires_at > now()
      and payload->>'learner_id' = v_binding.learner_id)
  then return jsonb_build_object('status', 'forbidden'); end if;
  return jsonb_build_object('status', 'active');
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
    where not private.pal_classroom_signals_enabled()
      and not exists (select 1 from private.pal_membership_outbox m where m.outbox_id = pal_event_outbox.id)
      and ((
      status = 'pending' and next_attempt_at <= now()
    ) or (
      status = 'processing' and lease_expires_at <= now()
    ))
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
  where not private.pal_classroom_signals_enabled()
    and not exists (select 1 from private.pal_membership_outbox m where m.outbox_id = pal_event_outbox.id)
    and ((
    status = 'pending' and next_attempt_at <= now()
  ) or (
    status = 'processing' and lease_expires_at <= now()
  ));
$$;


-- Scoped opportunity planner and namespaced claims.

create function public.claim_pal_membership_outbox(p_limit integer default 25, p_lease_seconds integer default 60,
  p_student_id uuid default null, p_classroom_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb; v_context jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 10 and 600 then
    raise exception using errcode = '22023', message = 'invalid_pal_claim';
  end if;
  if not private.pal_classroom_signals_enabled() then return '[]'::jsonb; end if;
  if (p_student_id is null) <> (p_classroom_id is null) then
    raise exception using errcode = '22023', message = 'invalid_pal_action_scope';
  end if;
  if p_student_id is not null then
    v_context := public.resolve_pal_classroom_context(p_student_id, p_classroom_id);
    if v_context->>'status' <> 'active' then return '[]'::jsonb; end if;
  end if;
  with candidates as (
    select o.id from public.pal_event_outbox o
    join private.pal_membership_outbox m on m.outbox_id = o.id
    where (p_student_id is null or (m.generation_id = (v_context->>'generation_id')::uuid
      and m.student_id = p_student_id and m.classroom_id = p_classroom_id))
      and ((o.status = 'pending' and o.next_attempt_at <= now())
      or (o.status = 'processing' and o.lease_expires_at <= now()))
    order by o.next_attempt_at, o.created_at, o.id limit p_limit for update of o skip locked
  ), claimed as (
    update public.pal_event_outbox o set status = 'processing', attempts = o.attempts + 1,
      lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_attempt_at = now(), updated_at = now()
    from candidates c where o.id = c.id
    returning o.id, o.payload, o.attempts, o.lease_token
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_rows from claimed;
  return v_rows;
end;
$$;

create function public.count_pal_membership_outbox_ready()
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.pal_event_outbox o
  join private.pal_membership_outbox m on m.outbox_id = o.id
  where private.pal_classroom_signals_enabled() and
    ((o.status = 'pending' and o.next_attempt_at <= now())
      or (o.status = 'processing' and o.lease_expires_at <= now()));
$$;

-- Same Monday-aligned Toronto term calendar as pal-term-calendar.ts. Tokens are
-- salted by the random profile reference so no term/progress crosses profiles.
create function private.pal_membership_term_calendar(p_reference text, p_monday date)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_start date; v_next date;
begin
  with starts as (
    select date_trunc('week', make_date(y, m, 1)::timestamp)::date as day
    from generate_series(extract(year from p_monday)::integer - 1,
      extract(year from p_monday)::integer + 1) y cross join (values (2), (7), (9)) months(m)
  ) select max(day) filter (where day <= p_monday), min(day) filter (where day > p_monday)
    into v_start, v_next from starts;
  return jsonb_build_object(
    'term_token', private.pal_membership_token(p_reference, 'term', v_start::text || ':' || (v_next - 1)::text),
    'term_start_day', v_start::text, 'term_end_day', (v_next - 1)::text,
    'term_timezone', 'America/Toronto', 'term_week_count', (v_next - v_start) / 7,
    'week_start_day', p_monday::text, 'week_index', (p_monday - v_start) / 7 + 1);
end;
$$;

-- A durable cursor makes bounded daily work fair across membership generations.
create table private.pal_membership_week_sync_cursor (
  singleton boolean primary key default true check (singleton), after_generation uuid
);
insert into private.pal_membership_week_sync_cursor(singleton) values (true);
alter table private.pal_membership_week_sync_cursor enable row level security;
revoke all on private.pal_membership_week_sync_cursor from public, anon, authenticated, service_role;

create function public.sync_pal_membership_weeks(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_after uuid; v_member record; v_period date; v_key text; v_context jsonb;
  v_previous private.pal_membership_week_configurations;
  v_eligible integer; v_floor integer; v_version integer; v_status text;
  v_now timestamptz := clock_timestamp(); v_start timestamptz;
  v_current date := date_trunc('week', v_now at time zone 'America/Toronto')::date;
  v_scanned integer := 0; v_configured integer := 0; v_closed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_pal_sync_limit';
  end if;
  if not private.pal_classroom_signals_enabled() then return jsonb_build_object('status', 'disabled'); end if;
  if not pg_try_advisory_xact_lock(hashtextextended('pal_membership_week_sync_v1', 0)) then
    return jsonb_build_object('status', 'busy');
  end if;
  select after_generation into v_after from private.pal_membership_week_sync_cursor where singleton for update;
  select activated_at into v_start from private.pal_classroom_signal_settings where singleton;
  for v_member in select e.id, e.student_id, e.classroom_id, e.created_at, c.start_date, c.end_date
    from public.classroom_enrollments e join public.classrooms c on c.id = e.classroom_id
    where (v_after is null or e.id > v_after) order by e.id limit p_limit
  loop
    v_scanned := v_scanned + 1; v_after := v_member.id;
    v_context := public.resolve_pal_classroom_context(v_member.student_id, v_member.classroom_id);
    if v_context->>'status' <> 'active' then continue; end if;
    -- Never invent old weeks from academic history: close only previously
    -- captured membership weeks, and create only the current week.
    for v_period in
      select v_current union
      (select distinct substring(period_key from 11)::date
        from private.pal_membership_week_configurations
        where generation_id = v_member.id and period_status = 'open'
          and period_key < 'pika-week-' || v_current::text
          and not exists (select 1 from private.pal_membership_week_configurations closed
            where closed.generation_id = v_member.id
              and closed.period_key = pal_membership_week_configurations.period_key
              and closed.period_status = 'closed')
        order by 1 limit 12)
    loop
      v_key := 'pika-week-' || v_period::text;
      v_status := case when v_period < v_current then 'closed' else 'open' end;
      select * into v_previous from private.pal_membership_week_configurations
        where generation_id = v_member.id and period_key = v_key order by config_version desc limit 1;
      if v_previous.period_status = 'closed' then continue; end if;
      select count(distinct date)::integer into v_eligible from public.class_days
        where classroom_id = v_member.classroom_id and is_class_day
          and date between v_period and v_period + 4
          and date >= greatest((v_start at time zone 'America/Toronto')::date,
            (v_member.created_at at time zone 'America/Toronto')::date, v_member.start_date)
          and (v_member.end_date is null or date <= v_member.end_date);
      select count(distinct o.payload->'metadata'->>'activity_day')::integer into v_floor
        from private.pal_membership_outbox m join public.pal_event_outbox o on o.id = m.outbox_id
        where m.generation_id = v_member.id and o.event_type = 'daily_log.completed'
          and o.payload->'metadata'->>'period_key' = v_key;
      v_eligible := greatest(v_eligible, v_floor);
      if v_previous.eligible_days = v_eligible and v_previous.period_status = v_status then continue; end if;
      v_version := coalesce(v_previous.config_version, 0) + 1;
      insert into private.pal_membership_week_configurations values
        (v_member.id, v_key, v_version, v_status, v_eligible);
      perform private.enqueue_membership_pal_fact(v_member.student_id, v_member.classroom_id,
        'daily_log_week.configured', v_key || ':' || v_version::text, v_now,
        jsonb_build_object('period_key', v_key, 'config_version', v_version,
          'period_status', v_status, 'eligible_days', v_eligible)
          || private.pal_membership_term_calendar(v_context->>'learner_id', v_period));
      if v_status = 'closed' then v_closed := v_closed + 1; else v_configured := v_configured + 1; end if;
    end loop;
  end loop;
  update private.pal_membership_week_sync_cursor set after_generation =
    case when v_scanned < p_limit then null else v_after end where singleton;
  return jsonb_build_object('status', 'ok', 'scanned', v_scanned,
    'configured', v_configured, 'closed', v_closed, 'remaining', v_scanned = p_limit);
end;
$$;

revoke all on function private.pal_membership_term_calendar(text,date) from public, anon, authenticated, service_role;
revoke all on function public.claim_pal_membership_outbox(integer,integer,uuid,uuid),
  public.count_pal_membership_outbox_ready(), public.sync_pal_membership_weeks(integer)
  from public, anon, authenticated;
grant execute on function public.claim_pal_membership_outbox(integer,integer,uuid,uuid),
  public.count_pal_membership_outbox_ready(), public.sync_pal_membership_weeks(integer) to service_role;


revoke all on function private.guard_pal_signal_activation(), private.pal_classroom_signals_enabled(),
  private.enqueue_pal_event(uuid,text,text,jsonb), private.enqueue_legacy_pal_event(uuid,text,text,jsonb),
  private.enqueue_membership_pal_fact(uuid,uuid,text,text,timestamptz,jsonb),
  private.pal_membership_token(text,text,text), private.capture_membership_pal_source()
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_pal_classroom_context(uuid,uuid),
  public.record_pal_classroom_visit(uuid,uuid), public.authorize_pal_membership_delivery(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_pal_classroom_context(uuid,uuid),
  public.record_pal_classroom_visit(uuid,uuid), public.authorize_pal_membership_delivery(uuid,uuid)
  to service_role;

commit;
