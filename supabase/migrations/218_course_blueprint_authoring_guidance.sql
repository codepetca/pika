-- Private teacher-owned rules travel with the Blueprint and inherit its
-- content_revision trigger, teacher ownership, and version snapshot lifecycle.
create function public.is_course_blueprint_authoring_guidance(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  unit jsonb;
  unit_id text;
  seen_ids text[] := '{}';
  field text;
begin
  if jsonb_typeof(value) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(value)) <> 4
    or not (value ?& array[
      'course_expectations_markdown', 'assignment_guidance_markdown',
      'test_guidance_markdown', 'unit_exceptions'
    ])
  then
    return false;
  end if;

  foreach field in array array[
    'course_expectations_markdown', 'assignment_guidance_markdown',
    'test_guidance_markdown'
  ] loop
    if jsonb_typeof(value->field) is distinct from 'string'
      or length(value->>field) > 20000
    then
      return false;
    end if;
  end loop;

  if jsonb_typeof(value->'unit_exceptions') is distinct from 'array'
    or jsonb_array_length(value->'unit_exceptions') > 100
  then
    return false;
  end if;

  for unit in select jsonb_array_elements(value->'unit_exceptions') loop
    if jsonb_typeof(unit) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(unit)) <> 4
      or not (unit ?& array[
        'id', 'unit_label', 'assignment_guidance_markdown',
        'test_guidance_markdown'
      ])
    then
      return false;
    end if;
    foreach field in array array[
      'id', 'unit_label', 'assignment_guidance_markdown',
      'test_guidance_markdown'
    ] loop
      if jsonb_typeof(unit->field) is distinct from 'string' then
        return false;
      end if;
    end loop;
    unit_id := lower(unit->>'id');
    if unit_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or unit_id = any(seen_ids)
      or length(btrim(unit->>'unit_label')) not between 1 and 160
      or length(unit->>'assignment_guidance_markdown') > 20000
      or length(unit->>'test_guidance_markdown') > 20000
    then
      return false;
    end if;
    seen_ids := array_append(seen_ids, unit_id);
  end loop;
  return true;
end;
$$;

alter table public.course_blueprints
  add column authoring_guidance jsonb not null default '{"course_expectations_markdown":"","assignment_guidance_markdown":"","test_guidance_markdown":"","unit_exceptions":[]}'::jsonb
  constraint course_blueprints_authoring_guidance_valid
    check (public.is_course_blueprint_authoring_guidance(authoring_guidance));

-- Keep the existing content-only revision semantics from migration 112 while
-- counting changes to guidance as Blueprint content edits.
create or replace function public.bump_course_blueprint_content_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('pika.identity_mapping', true) = 'on' then
    return new;
  end if;
  if new.content_revision = old.content_revision
    and (
      new.title is distinct from old.title
      or new.subject is distinct from old.subject
      or new.grade_level is distinct from old.grade_level
      or new.course_code is distinct from old.course_code
      or new.term_template is distinct from old.term_template
      or new.overview_markdown is distinct from old.overview_markdown
      or new.outline_markdown is distinct from old.outline_markdown
      or new.resources_markdown is distinct from old.resources_markdown
      or new.authoring_guidance is distinct from old.authoring_guidance
      or new.gradebook_use_weights is distinct from old.gradebook_use_weights
      or new.gradebook_assignments_weight is distinct from old.gradebook_assignments_weight
      or new.gradebook_tests_weight is distinct from old.gradebook_tests_weight
      or new.planned_site_slug is distinct from old.planned_site_slug
      or new.planned_site_published is distinct from old.planned_site_published
      or new.planned_site_config is distinct from old.planned_site_config
    )
  then
    new.content_revision := old.content_revision + 1;
  end if;
  return new;
end;
$$;

-- Every guidance change is retained even when a teacher has not yet saved a
-- full Blueprint Version. The public table grants stay closed to students.
create table public.course_blueprint_authoring_guidance_revisions (
  id uuid primary key default gen_random_uuid(),
  course_blueprint_id uuid not null
    references public.course_blueprints (id) on delete cascade,
  content_revision bigint not null check (content_revision > 0),
  guidance jsonb not null check (public.is_course_blueprint_authoring_guidance(guidance)),
  source_kind text not null check (source_kind in ('direct', 'package', 'proposal', 'import')),
  created_by uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_blueprint_id, content_revision)
);

create index idx_blueprint_guidance_revisions_recent
  on public.course_blueprint_authoring_guidance_revisions
  (course_blueprint_id, content_revision desc);

alter table public.course_blueprint_authoring_guidance_revisions
  enable row level security;
revoke all on public.course_blueprint_authoring_guidance_revisions
  from public, anon, authenticated;
grant select, insert on public.course_blueprint_authoring_guidance_revisions
  to service_role;

create function public.record_course_blueprint_authoring_guidance_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.authoring_guidance is distinct from old.authoring_guidance then
    insert into public.course_blueprint_authoring_guidance_revisions (
      course_blueprint_id, content_revision, guidance, source_kind, created_by
    ) values (
      new.id,
      new.content_revision,
      new.authoring_guidance,
      coalesce(
        nullif(current_setting('pika.authoring_guidance_source', true), ''),
        'direct'
      ),
      new.teacher_id
    );
  end if;
  return new;
end;
$$;

create trigger record_course_blueprint_authoring_guidance_revision
  after update of authoring_guidance on public.course_blueprints
  for each row when (old.authoring_guidance is distinct from new.authoring_guidance)
  execute function public.record_course_blueprint_authoring_guidance_revision();

-- Keep the deployed v2 operation available during the application rollout.
-- The v3 wrapper persists private guidance inside the same operation transaction;
-- a replay never changes the Blueprint again.
create function public.create_course_blueprint_atomic_v3(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_operation_type text,
  p_request_sha256 text,
  p_source_classroom_id uuid,
  p_expected_source_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_guidance jsonb;
begin
  v_guidance := p_plan->'blueprint'->'authoring_guidance';
  if jsonb_typeof(v_guidance) is distinct from 'object' then
    raise exception 'Blueprint authoring guidance is required'
      using errcode = '22023';
  end if;

  v_result := public.create_course_blueprint_atomic_v2(
    p_operation_id, p_teacher_id, p_operation_type, p_request_sha256,
    p_source_classroom_id, p_expected_source_revision, p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false)
    and not coalesce((v_result->>'replayed')::boolean, false)
  then
    perform set_config('pika.identity_mapping', 'on', true);
    perform set_config('pika.authoring_guidance_source', 'import', true);
    update public.course_blueprints
    set authoring_guidance = v_guidance
    where id = (v_result->>'blueprint_id')::uuid
      and teacher_id = p_teacher_id;
    if not found then
      raise exception 'Created Blueprint is missing'
        using errcode = 'P0002';
    end if;
    perform set_config('pika.identity_mapping', 'off', true);
    perform set_config('pika.authoring_guidance_source', '', true);
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_course_blueprint_atomic_v3(
  uuid, uuid, text, text, uuid, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.create_course_blueprint_atomic_v3(
  uuid, uuid, text, text, uuid, bigint, jsonb
) to service_role;

-- The existing proposal RPC applies the reusable content and advances the
-- revision. This wrapper writes guidance in that same transaction. The revision
-- guard also makes a replay after later edits side-effect free.
create function public.apply_course_blueprint_proposal_with_guidance_atomic(
  p_teacher_id uuid,
  p_proposal_id uuid,
  p_candidate_snapshot jsonb,
  p_candidate_sha256 text
)
returns public.course_blueprint_change_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.course_blueprint_change_proposals;
  v_guidance jsonb;
begin
  v_guidance := p_candidate_snapshot->'authoring_guidance';
  if (p_candidate_snapshot->>'schema_version')::integer >= 3
    and jsonb_typeof(v_guidance) is distinct from 'object'
  then
    raise exception 'Proposal authoring guidance is required'
      using errcode = '22023';
  end if;

  v_result := public.apply_course_blueprint_proposal_atomic(
    p_teacher_id, p_proposal_id, p_candidate_snapshot, p_candidate_sha256
  );
  if v_result.status = 'applied' and v_guidance is not null then
    perform set_config('pika.identity_mapping', 'on', true);
    perform set_config('pika.authoring_guidance_source', 'proposal', true);
    update public.course_blueprints
    set authoring_guidance = v_guidance
    where id = v_result.course_blueprint_id
      and teacher_id = p_teacher_id
      and content_revision = v_result.applied_blueprint_revision
      and authoring_guidance is distinct from v_guidance;
    perform set_config('pika.identity_mapping', 'off', true);
    perform set_config('pika.authoring_guidance_source', '', true);
  end if;
  return v_result;
end;
$$;

revoke all on function public.apply_course_blueprint_proposal_with_guidance_atomic(
  uuid, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.apply_course_blueprint_proposal_with_guidance_atomic(
  uuid, uuid, jsonb, text
) to service_role;

-- Provider-backed Blueprint drafts need one shared per-teacher lease and a
-- bounded rolling attempt budget across every application instance. The
-- reservation is made before the provider call and retained when it fails.
create table public.course_blueprint_draft_admissions (
  teacher_id uuid primary key references public.users (id) on delete cascade,
  attempt_timestamps timestamptz[] not null,
  active_lease_token uuid,
  active_lease_expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint course_blueprint_draft_admissions_attempts_valid check (
    cardinality(attempt_timestamps) between 1 and 3
  ),
  constraint course_blueprint_draft_admissions_lease_pair check (
    (active_lease_token is null and active_lease_expires_at is null)
    or (active_lease_token is not null and active_lease_expires_at is not null)
  )
);

alter table public.course_blueprint_draft_admissions enable row level security;
revoke all on public.course_blueprint_draft_admissions
  from public, anon, authenticated, service_role;

create function public.acquire_course_blueprint_draft_slot(p_teacher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_token uuid := gen_random_uuid();
  v_recent_attempts timestamptz[];
  v_admission public.course_blueprint_draft_admissions%rowtype;
begin
  if p_teacher_id is null or not exists (
    select 1 from public.users
    where id = p_teacher_id and role = 'teacher'
  ) then
    raise exception using errcode = '42501', message = 'course_blueprint_draft_teacher_required';
  end if;

  insert into public.course_blueprint_draft_admissions (
    teacher_id, attempt_timestamps, active_lease_token,
    active_lease_expires_at, updated_at
  ) values (
    p_teacher_id, array[v_now], v_lease_token,
    v_now + interval '90 seconds', v_now
  )
  on conflict (teacher_id) do nothing
  returning * into v_admission;

  if found then
    return jsonb_build_object(
      'ok', true,
      'lease_token', v_admission.active_lease_token,
      'lease_expires_at', v_admission.active_lease_expires_at
    );
  end if;

  select * into v_admission
  from public.course_blueprint_draft_admissions
  where teacher_id = p_teacher_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'course_blueprint_draft_admission_missing';
  end if;

  if v_admission.active_lease_token is not null
    and v_admission.active_lease_expires_at > v_now then
    return jsonb_build_object('ok', false, 'reason', 'active');
  end if;

  v_recent_attempts := array(
    select attempted_at
    from unnest(v_admission.attempt_timestamps) as attempted_at
    where attempted_at > v_now - interval '10 minutes'
    order by attempted_at
  );

  if cardinality(v_recent_attempts) >= 3 then
    update public.course_blueprint_draft_admissions
    set attempt_timestamps = v_recent_attempts,
        active_lease_token = null,
        active_lease_expires_at = null,
        updated_at = v_now
    where teacher_id = p_teacher_id;
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_recent_attempts := array_append(v_recent_attempts, v_now);
  update public.course_blueprint_draft_admissions
  set attempt_timestamps = v_recent_attempts,
      active_lease_token = v_lease_token,
      active_lease_expires_at = v_now + interval '90 seconds',
      updated_at = v_now
  where teacher_id = p_teacher_id
  returning * into v_admission;

  return jsonb_build_object(
    'ok', true,
    'lease_token', v_admission.active_lease_token,
    'lease_expires_at', v_admission.active_lease_expires_at
  );
end;
$$;

create function public.release_course_blueprint_draft_slot(
  p_teacher_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.course_blueprint_draft_admissions
  set active_lease_token = null,
      active_lease_expires_at = null,
      updated_at = clock_timestamp()
  where teacher_id = p_teacher_id
    and active_lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.acquire_course_blueprint_draft_slot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.release_course_blueprint_draft_slot(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.acquire_course_blueprint_draft_slot(uuid)
  to service_role;
grant execute on function public.release_course_blueprint_draft_slot(uuid, uuid)
  to service_role;
