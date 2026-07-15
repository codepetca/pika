-- Atomic, idempotent, and observable course-blueprint round trips.

alter table public.course_blueprints
  add column if not exists content_revision bigint not null default 1
  check (content_revision > 0);

create or replace function public.bump_course_blueprint_content_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.content_revision = old.content_revision then
    new.content_revision := old.content_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_course_blueprint_content_revision on public.course_blueprints;
create trigger bump_course_blueprint_content_revision
  before update on public.course_blueprints
  for each row
  execute function public.bump_course_blueprint_content_revision();

create or replace function public.touch_parent_course_blueprint_revision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_blueprint_id uuid;
  v_new_blueprint_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_blueprint_id := old.course_blueprint_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_blueprint_id := new.course_blueprint_id;
  end if;

  update public.course_blueprints
  set content_revision = content_revision + 1
  where id = v_old_blueprint_id;

  if v_new_blueprint_id is distinct from v_old_blueprint_id then
    update public.course_blueprints
    set content_revision = content_revision + 1
    where id = v_new_blueprint_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_blueprint_revision_from_assignments on public.course_blueprint_assignments;
create trigger touch_blueprint_revision_from_assignments
  after insert or update or delete on public.course_blueprint_assignments
  for each row
  execute function public.touch_parent_course_blueprint_revision();

drop trigger if exists touch_blueprint_revision_from_assessments on public.course_blueprint_assessments;
create trigger touch_blueprint_revision_from_assessments
  after insert or update or delete on public.course_blueprint_assessments
  for each row
  execute function public.touch_parent_course_blueprint_revision();

drop trigger if exists touch_blueprint_revision_from_lessons on public.course_blueprint_lesson_templates;
create trigger touch_blueprint_revision_from_lessons
  after insert or update or delete on public.course_blueprint_lesson_templates
  for each row
  execute function public.touch_parent_course_blueprint_revision();

alter table public.classrooms
  add column if not exists blueprint_source_revision bigint not null default 1
  check (blueprint_source_revision > 0);

create or replace function public.bump_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.blueprint_source_revision = old.blueprint_source_revision then
    new.blueprint_source_revision := old.blueprint_source_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_classroom_blueprint_source_revision on public.classrooms;
create trigger bump_classroom_blueprint_source_revision
  before update on public.classrooms
  for each row
  execute function public.bump_classroom_blueprint_source_revision();

create or replace function public.touch_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_classroom_id := old.classroom_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_classroom_id := new.classroom_id;
  end if;

  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;

  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_classroom_blueprint_source_from_resources on public.classroom_resources;
create trigger touch_classroom_blueprint_source_from_resources
  after insert or update or delete on public.classroom_resources
  for each row execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_assignments on public.assignments;
create trigger touch_classroom_blueprint_source_from_assignments
  after insert or update or delete on public.assignments
  for each row execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_tests on public.tests;
create trigger touch_classroom_blueprint_source_from_tests
  after insert or update or delete on public.tests
  for each row execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_drafts on public.assessment_drafts;
create trigger touch_classroom_blueprint_source_from_drafts
  after insert or update or delete on public.assessment_drafts
  for each row execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_lessons on public.lesson_plans;
create trigger touch_classroom_blueprint_source_from_lessons
  after insert or update or delete on public.lesson_plans
  for each row execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_announcements on public.announcements;
create trigger touch_classroom_blueprint_source_from_announcements
  after insert or update or delete on public.announcements
  for each row execute function public.touch_classroom_blueprint_source_revision();

create or replace function public.touch_classroom_blueprint_source_from_test_question()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id
    from public.tests
    where id = old.test_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id
    from public.tests
    where id = new.test_id;
  end if;

  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;

  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_classroom_blueprint_source_from_test_questions on public.test_questions;
create trigger touch_classroom_blueprint_source_from_test_questions
  after insert or update or delete on public.test_questions
  for each row execute function public.touch_classroom_blueprint_source_from_test_question();

create or replace function public.touch_classroom_blueprint_source_from_requirement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id
    from public.assignments
    where id = old.assignment_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id
    from public.assignments
    where id = new.assignment_id;
  end if;

  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;

  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_classroom_blueprint_source_from_requirements on public.assignment_submission_requirements;
create trigger touch_classroom_blueprint_source_from_requirements
  after insert or update or delete on public.assignment_submission_requirements
  for each row execute function public.touch_classroom_blueprint_source_from_requirement();

create table if not exists public.course_blueprint_operations (
  id uuid primary key,
  teacher_id uuid not null references public.users (id) on delete cascade,
  operation_type text not null check (operation_type in ('import', 'capture', 'instantiate')),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('running', 'completed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  source_blueprint_id uuid,
  source_classroom_id uuid,
  result_blueprint_id uuid,
  result_classroom_id uuid,
  result jsonb,
  resource_counts jsonb not null default '{}'::jsonb,
  error_code text,
  error_sqlstate text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_course_blueprint_operations_teacher_created
  on public.course_blueprint_operations (teacher_id, started_at desc);

create index if not exists idx_course_blueprint_operations_status_updated
  on public.course_blueprint_operations (status, updated_at);

alter table public.course_blueprint_operations enable row level security;

comment on table public.course_blueprint_operations is
  'Idempotency and recovery ledger for atomic package import, classroom capture, and blueprint instantiation.';

create or replace function public.create_course_blueprint_atomic(
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
set search_path = public
as $$
declare
  v_operation public.course_blueprint_operations;
  v_blueprint_id uuid;
  v_blueprint_revision bigint;
  v_source_revision bigint;
  v_position integer;
  v_item jsonb;
  v_result jsonb;
  v_error_code text := 'atomic_blueprint_create_failed';
  v_error_sqlstate text;
  v_status integer := 500;
  v_assignment_count integer := 0;
  v_assessment_count integer := 0;
  v_lesson_count integer := 0;
  v_updated_count integer := 0;
begin
  if p_operation_type not in ('import', 'capture') then
    raise exception 'Invalid blueprint creation operation type'
      using errcode = '22023';
  end if;

  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_classroom_id
  )
  values (
    p_operation_id,
    p_teacher_id,
    p_operation_type,
    p_request_sha256,
    'running',
    p_source_classroom_id
  )
  on conflict (id) do nothing;

  select *
  into v_operation
  from public.course_blueprint_operations
  where id = p_operation_id
  for update;

  if v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> p_operation_type
    or v_operation.request_sha256 <> p_request_sha256
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', p_operation_type,
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different blueprint request',
      'retryable', false
    );
  end if;

  if v_operation.status = 'completed' and v_operation.result is not null then
    return jsonb_set(v_operation.result, '{replayed}', 'true'::jsonb, true);
  end if;

  update public.course_blueprint_operations
  set
    status = 'running',
    attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
    error_code = null,
    error_sqlstate = null,
    completed_at = null,
    updated_at = now()
  where id = p_operation_id;

  begin
    if jsonb_typeof(p_plan) is distinct from 'object'
      or jsonb_typeof(p_plan->'blueprint') is distinct from 'object'
      or jsonb_typeof(p_plan->'assignments') is distinct from 'array'
      or jsonb_typeof(p_plan->'assessments') is distinct from 'array'
      or jsonb_typeof(p_plan->'lesson_templates') is distinct from 'array'
    then
      v_error_code := 'invalid_blueprint_plan';
      raise exception 'Invalid blueprint write plan' using errcode = '22023';
    end if;

    v_assignment_count := jsonb_array_length(p_plan->'assignments');
    v_assessment_count := jsonb_array_length(p_plan->'assessments');
    v_lesson_count := jsonb_array_length(p_plan->'lesson_templates');

    if (p_operation_type = 'capture') <> (
      p_source_classroom_id is not null and p_expected_source_revision is not null
    ) then
      v_error_code := 'invalid_blueprint_source';
      raise exception 'Capture requires a source classroom and revision; import requires neither'
        using errcode = '22023';
    end if;

    if p_source_classroom_id is not null then
      v_error_code := 'source_classroom_changed';
      select blueprint_source_revision
      into v_source_revision
      from public.classrooms
      where id = p_source_classroom_id
        and teacher_id = p_teacher_id
        and archived_at is null
      for update;

      if not found or v_source_revision <> p_expected_source_revision then
        raise exception 'Source classroom revision changed' using errcode = 'P0001';
      end if;
    end if;

    select coalesce(min(position) - 1, 0)
    into v_position
    from public.course_blueprints
    where teacher_id = p_teacher_id;

    v_error_code := 'create_blueprint_failed';
    insert into public.course_blueprints (
      teacher_id,
      title,
      subject,
      grade_level,
      course_code,
      term_template,
      overview_markdown,
      outline_markdown,
      resources_markdown,
      planned_site_slug,
      planned_site_published,
      planned_site_config,
      position
    )
    values (
      p_teacher_id,
      p_plan->'blueprint'->>'title',
      coalesce(p_plan->'blueprint'->>'subject', ''),
      coalesce(p_plan->'blueprint'->>'grade_level', ''),
      coalesce(p_plan->'blueprint'->>'course_code', ''),
      coalesce(p_plan->'blueprint'->>'term_template', ''),
      coalesce(p_plan->'blueprint'->>'overview_markdown', ''),
      coalesce(p_plan->'blueprint'->>'outline_markdown', ''),
      coalesce(p_plan->'blueprint'->>'resources_markdown', ''),
      nullif(p_plan->'blueprint'->>'planned_site_slug', ''),
      coalesce((p_plan->'blueprint'->>'planned_site_published')::boolean, false),
      coalesce(p_plan->'blueprint'->'planned_site_config', '{}'::jsonb),
      v_position
    )
    returning id into v_blueprint_id;

    v_error_code := 'create_blueprint_assignments_failed';
    for v_item in select value from jsonb_array_elements(p_plan->'assignments')
    loop
      insert into public.course_blueprint_assignments (
        course_blueprint_id,
        title,
        instructions_markdown,
        submission_requirements_json,
        default_due_days,
        default_due_time,
        points_possible,
        gradebook_weight,
        include_in_final,
        is_draft,
        position
      )
      values (
        v_blueprint_id,
        v_item->>'title',
        coalesce(v_item->>'instructions_markdown', ''),
        coalesce(v_item->'submission_requirements_json', '[]'::jsonb),
        coalesce((v_item->>'default_due_days')::integer, 0),
        coalesce(v_item->>'default_due_time', '23:59'),
        (v_item->>'points_possible')::numeric,
        coalesce((v_item->>'gradebook_weight')::integer, 10),
        coalesce((v_item->>'include_in_final')::boolean, true),
        true,
        coalesce((v_item->>'position')::integer, 0)
      );
    end loop;

    v_error_code := 'create_blueprint_assessments_failed';
    for v_item in select value from jsonb_array_elements(p_plan->'assessments')
    loop
      insert into public.course_blueprint_assessments (
        course_blueprint_id,
        assessment_type,
        title,
        content,
        documents,
        points_possible,
        gradebook_weight,
        include_in_final,
        position
      )
      values (
        v_blueprint_id,
        'test',
        v_item->>'title',
        coalesce(v_item->'content', '{}'::jsonb),
        coalesce(v_item->'documents', '[]'::jsonb),
        (v_item->>'points_possible')::numeric,
        coalesce((v_item->>'gradebook_weight')::integer, 10),
        coalesce((v_item->>'include_in_final')::boolean, true),
        coalesce((v_item->>'position')::integer, 0)
      );
    end loop;

    v_error_code := 'create_blueprint_lessons_failed';
    for v_item in select value from jsonb_array_elements(p_plan->'lesson_templates')
    loop
      insert into public.course_blueprint_lesson_templates (
        course_blueprint_id,
        title,
        content_markdown,
        position
      )
      values (
        v_blueprint_id,
        coalesce(v_item->>'title', ''),
        coalesce(v_item->>'content_markdown', ''),
        coalesce((v_item->>'position')::integer, 0)
      );
    end loop;

    if p_source_classroom_id is not null then
      v_error_code := 'link_source_classroom_failed';
      update public.classrooms
      set
        source_blueprint_id = v_blueprint_id,
        source_blueprint_origin = jsonb_build_object(
          'blueprint_id', v_blueprint_id,
          'blueprint_title', p_plan->'blueprint'->>'title',
          'package_manifest_version', p_plan->>'manifest_version',
          'package_exported_at', coalesce(
            nullif(p_plan->>'source_package_exported_at', '')::timestamptz,
            now()
          ),
          'operation_id', p_operation_id
        )
      where id = p_source_classroom_id
        and teacher_id = p_teacher_id
        and archived_at is null
        and blueprint_source_revision = p_expected_source_revision;

      get diagnostics v_updated_count = row_count;
      if v_updated_count <> 1 then
        v_error_code := 'source_classroom_changed';
        raise exception 'Source classroom is no longer mutable' using errcode = 'P0001';
      end if;
    end if;

    select content_revision
    into v_blueprint_revision
    from public.course_blueprints
    where id = v_blueprint_id;

    v_result := jsonb_build_object(
      'ok', true,
      'status', 201,
      'operation_id', p_operation_id,
      'operation_type', p_operation_type,
      'replayed', false,
      'blueprint_id', v_blueprint_id,
      'result_content_revision', v_blueprint_revision,
      'counts', jsonb_build_object(
        'assignments', v_assignment_count,
        'assessments', v_assessment_count,
        'lesson_templates', v_lesson_count
      )
    ) || case
      when v_source_revision is null then '{}'::jsonb
      else jsonb_build_object('source_revision', v_source_revision)
    end;

    update public.course_blueprint_operations
    set
      status = 'completed',
      result_blueprint_id = v_blueprint_id,
      result = v_result,
      resource_counts = v_result->'counts',
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
  exception when others then
    get stacked diagnostics v_error_sqlstate = returned_sqlstate;
    v_status := case
      when v_error_code in ('source_classroom_changed', 'planned_site_slug_conflict') then 409
      when v_error_code in ('invalid_blueprint_plan', 'invalid_blueprint_source') then 400
      when v_error_sqlstate = '23505' then 409
      else 500
    end;
    if v_error_sqlstate = '23505' then
      v_error_code := 'blueprint_conflict';
    end if;

    v_result := jsonb_build_object(
      'ok', false,
      'status', v_status,
      'operation_id', p_operation_id,
      'operation_type', p_operation_type,
      'error_code', v_error_code,
      'error', case
        when v_error_code = 'source_classroom_changed' then 'Source classroom changed before the blueprint could be saved'
        when v_error_code = 'blueprint_conflict' then 'Blueprint conflicts with an existing record'
        when v_error_code = 'invalid_blueprint_plan' then 'Blueprint write plan is invalid'
        when v_error_code = 'invalid_blueprint_source' then 'Blueprint source revision is invalid'
        else 'Atomic blueprint creation failed'
      end,
      'retryable', v_status >= 500 or v_error_code = 'source_classroom_changed'
    );

    update public.course_blueprint_operations
    set
      status = 'failed',
      result = v_result,
      resource_counts = jsonb_build_object(
        'assignments', v_assignment_count,
        'assessments', v_assessment_count,
        'lesson_templates', v_lesson_count
      ),
      error_code = v_error_code,
      error_sqlstate = v_error_sqlstate,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
  end;

  return v_result;
end;
$$;

create or replace function public.instantiate_course_blueprint_atomic(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_request_sha256 text,
  p_expected_content_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.course_blueprint_operations;
  v_blueprint_title text;
  v_blueprint_revision bigint;
  v_classroom_id uuid;
  v_classroom_position integer;
  v_assignment_id uuid;
  v_test_id uuid;
  v_item jsonb;
  v_child jsonb;
  v_result jsonb;
  v_error_code text := 'atomic_blueprint_instantiate_failed';
  v_error_sqlstate text;
  v_status integer := 500;
  v_assignment_count integer := 0;
  v_test_count integer := 0;
  v_lesson_count integer := 0;
  v_class_day_count integer := 0;
  v_requirement_count integer := 0;
  v_question_count integer := 0;
begin
  insert into public.course_blueprint_operations (
    id,
    teacher_id,
    operation_type,
    request_sha256,
    status,
    source_blueprint_id
  )
  values (
    p_operation_id,
    p_teacher_id,
    'instantiate',
    p_request_sha256,
    'running',
    p_blueprint_id
  )
  on conflict (id) do nothing;

  select *
  into v_operation
  from public.course_blueprint_operations
  where id = p_operation_id
  for update;

  if v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> 'instantiate'
    or v_operation.request_sha256 <> p_request_sha256
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'operation_type', 'instantiate',
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different blueprint request',
      'retryable', false
    );
  end if;

  if v_operation.status = 'completed' and v_operation.result is not null then
    return jsonb_set(v_operation.result, '{replayed}', 'true'::jsonb, true);
  end if;

  update public.course_blueprint_operations
  set
    status = 'running',
    attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
    error_code = null,
    error_sqlstate = null,
    completed_at = null,
    updated_at = now()
  where id = p_operation_id;

  begin
    if jsonb_typeof(p_plan) is distinct from 'object'
      or jsonb_typeof(p_plan->'classroom') is distinct from 'object'
      or jsonb_typeof(p_plan->'class_days') is distinct from 'array'
      or jsonb_typeof(p_plan->'assignments') is distinct from 'array'
      or jsonb_typeof(p_plan->'tests') is distinct from 'array'
      or jsonb_typeof(p_plan->'lesson_plans') is distinct from 'array'
    then
      v_error_code := 'invalid_instantiation_plan';
      raise exception 'Invalid blueprint instantiation plan' using errcode = '22023';
    end if;

    v_assignment_count := jsonb_array_length(p_plan->'assignments');
    v_test_count := jsonb_array_length(p_plan->'tests');
    v_lesson_count := jsonb_array_length(p_plan->'lesson_plans');
    v_class_day_count := jsonb_array_length(p_plan->'class_days');

    v_error_code := 'source_blueprint_changed';
    select title, content_revision
    into v_blueprint_title, v_blueprint_revision
    from public.course_blueprints
    where id = p_blueprint_id
      and teacher_id = p_teacher_id
    for share;

    if not found or v_blueprint_revision <> p_expected_content_revision then
      raise exception 'Blueprint content revision changed' using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('pika-class-code:' || lower(p_plan->'classroom'->>'class_code'), 0)
    );

    if exists (
      select 1
      from public.classrooms
      where lower(class_code) = lower(p_plan->'classroom'->>'class_code')
    ) then
      v_error_code := 'class_code_conflict';
      raise exception 'Class code already in use' using errcode = 'P0001';
    end if;

    select coalesce(min(position) - 1, 0)
    into v_classroom_position
    from public.classrooms
    where teacher_id = p_teacher_id
      and archived_at is null;

    v_error_code := 'create_classroom_failed';
    insert into public.classrooms (
      teacher_id,
      title,
      class_code,
      term_label,
      theme_color,
      position,
      start_date,
      end_date,
      source_blueprint_id,
      source_blueprint_origin,
      course_overview_markdown,
      course_outline_markdown,
      actual_site_config
    )
    values (
      p_teacher_id,
      p_plan->'classroom'->>'title',
      p_plan->'classroom'->>'class_code',
      nullif(p_plan->'classroom'->>'term_label', ''),
      p_plan->'classroom'->>'theme_color',
      v_classroom_position,
      (p_plan->'classroom'->>'start_date')::date,
      (p_plan->'classroom'->>'end_date')::date,
      p_blueprint_id,
      jsonb_build_object(
        'blueprint_id', p_blueprint_id,
        'blueprint_title', v_blueprint_title,
        'blueprint_content_revision', v_blueprint_revision,
        'package_manifest_version', p_plan->>'manifest_version',
        'package_exported_at', now(),
        'operation_id', p_operation_id
      ),
      coalesce(p_plan->'classroom'->>'course_overview_markdown', ''),
      coalesce(p_plan->'classroom'->>'course_outline_markdown', ''),
      coalesce(p_plan->'classroom'->'actual_site_config', '{}'::jsonb)
    )
    returning id into v_classroom_id;

    v_error_code := 'create_class_days_failed';
    for v_item in select value from jsonb_array_elements(p_plan->'class_days')
    loop
      insert into public.class_days (classroom_id, date, is_class_day, prompt_text)
      values (v_classroom_id, (v_item->>'date')::date, true, null);
    end loop;

    if p_plan->'resources_content' is not null
      and p_plan->'resources_content' <> 'null'::jsonb
    then
      v_error_code := 'create_classroom_resources_failed';
      insert into public.classroom_resources (classroom_id, content, updated_by)
      values (v_classroom_id, p_plan->'resources_content', p_teacher_id);
    end if;

    v_error_code := 'create_assignments_failed';
    for v_item in select value from jsonb_array_elements(p_plan->'assignments')
    loop
      insert into public.assignments (
        classroom_id,
        title,
        instructions_markdown,
        description,
        rich_instructions,
        due_at,
        position,
        is_draft,
        released_at,
        points_possible,
        gradebook_weight,
        include_in_final,
        created_by
      )
      values (
        v_classroom_id,
        v_item->>'title',
        coalesce(v_item->>'instructions_markdown', ''),
        coalesce(v_item->>'description', ''),
        v_item->'rich_instructions',
        (v_item->>'due_at')::timestamptz,
        coalesce((v_item->>'position')::integer, 0),
        true,
        null,
        coalesce((v_item->>'points_possible')::numeric, 30),
        coalesce((v_item->>'gradebook_weight')::integer, 10),
        coalesce((v_item->>'include_in_final')::boolean, true),
        p_teacher_id
      )
      returning id into v_assignment_id;

      for v_child in
        select value from jsonb_array_elements(coalesce(v_item->'submission_requirements', '[]'::jsonb))
      loop
        insert into public.assignment_submission_requirements (
          assignment_id,
          type,
          label,
          instructions,
          required,
          position,
          validation_policy_json
        )
        values (
          v_assignment_id,
          v_child->>'type',
          v_child->>'label',
          coalesce(v_child->>'instructions', ''),
          coalesce((v_child->>'required')::boolean, true),
          coalesce((v_child->>'position')::integer, 0),
          coalesce(v_child->'validation_policy_json', '{}'::jsonb)
        );
        v_requirement_count := v_requirement_count + 1;
      end loop;
    end loop;

    v_error_code := 'create_tests_failed';
    for v_item in select value from jsonb_array_elements(p_plan->'tests')
    loop
      insert into public.tests (
        classroom_id,
        title,
        created_by,
        position,
        status,
        show_results,
        documents,
        points_possible,
        gradebook_weight,
        include_in_final
      )
      values (
        v_classroom_id,
        v_item->>'title',
        p_teacher_id,
        coalesce((v_item->>'position')::integer, 0),
        'draft',
        coalesce((v_item->>'show_results')::boolean, false),
        coalesce(v_item->'documents', '[]'::jsonb),
        coalesce((v_item->>'points_possible')::numeric, 100),
        coalesce((v_item->>'gradebook_weight')::integer, 10),
        coalesce((v_item->>'include_in_final')::boolean, true)
      )
      returning id into v_test_id;

      for v_child in
        select value from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
      loop
        insert into public.test_questions (
          test_id,
          question_type,
          question_text,
          options,
          correct_option,
          answer_key,
          sample_solution,
          points,
          response_max_chars,
          response_monospace,
          position
        )
        values (
          v_test_id,
          v_child->>'question_type',
          coalesce(v_child->>'question_text', ''),
          coalesce(v_child->'options', '[]'::jsonb),
          (v_child->>'correct_option')::integer,
          v_child->>'answer_key',
          v_child->>'sample_solution',
          coalesce((v_child->>'points')::numeric, 1),
          coalesce((v_child->>'response_max_chars')::integer, 5000),
          coalesce((v_child->>'response_monospace')::boolean, false),
          coalesce((v_child->>'position')::integer, 0)
        );
        v_question_count := v_question_count + 1;
      end loop;

      insert into public.assessment_drafts (
        assessment_type,
        classroom_id,
        assessment_id,
        content,
        version,
        created_by,
        updated_by
      )
      values (
        'test',
        v_classroom_id,
        v_test_id,
        coalesce(v_item->'draft_content', '{}'::jsonb),
        1,
        p_teacher_id,
        p_teacher_id
      );
    end loop;

    v_error_code := 'create_lesson_plans_failed';
    for v_item in select value from jsonb_array_elements(p_plan->'lesson_plans')
    loop
      insert into public.lesson_plans (
        classroom_id,
        date,
        content_markdown,
        content
      )
      values (
        v_classroom_id,
        (v_item->>'date')::date,
        coalesce(v_item->>'content_markdown', ''),
        coalesce(v_item->'content', '{}'::jsonb)
      );
    end loop;

    v_result := jsonb_build_object(
      'ok', true,
      'status', 201,
      'operation_id', p_operation_id,
      'operation_type', 'instantiate',
      'replayed', false,
      'classroom_id', v_classroom_id,
      'source_revision', v_blueprint_revision,
      'counts', jsonb_build_object(
        'assignments', v_assignment_count,
        'assessments', v_test_count,
        'lesson_templates', v_lesson_count,
        'class_days', v_class_day_count,
        'submission_requirements', v_requirement_count,
        'questions', v_question_count
      ),
      'lesson_mapping', jsonb_build_object(
        'applied_lesson_templates', v_lesson_count,
        'overflow_lesson_templates', coalesce(p_plan->'overflow_lesson_templates', '[]'::jsonb)
      )
    );

    update public.course_blueprint_operations
    set
      status = 'completed',
      result_classroom_id = v_classroom_id,
      result = v_result,
      resource_counts = v_result->'counts',
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
  exception when others then
    get stacked diagnostics v_error_sqlstate = returned_sqlstate;
    v_status := case
      when v_error_code in ('source_blueprint_changed', 'class_code_conflict') then 409
      when v_error_code = 'invalid_instantiation_plan' then 400
      when v_error_sqlstate = '23505' then 409
      else 500
    end;
    if v_error_sqlstate = '23505' and v_error_code <> 'class_code_conflict' then
      v_error_code := 'classroom_content_conflict';
    end if;

    v_result := jsonb_build_object(
      'ok', false,
      'status', v_status,
      'operation_id', p_operation_id,
      'operation_type', 'instantiate',
      'error_code', v_error_code,
      'error', case
        when v_error_code = 'source_blueprint_changed' then 'Blueprint changed while the classroom was being prepared; review and retry'
        when v_error_code = 'class_code_conflict' then 'Class code already in use'
        when v_error_code = 'invalid_instantiation_plan' then 'Blueprint instantiation plan is invalid'
        when v_error_code = 'classroom_content_conflict' then 'Classroom content conflicts with an existing record'
        else 'Atomic blueprint instantiation failed'
      end,
      'retryable', v_status >= 500 or v_error_code = 'source_blueprint_changed'
    );

    update public.course_blueprint_operations
    set
      status = 'failed',
      result = v_result,
      resource_counts = jsonb_build_object(
        'assignments', v_assignment_count,
        'assessments', v_test_count,
        'lesson_templates', v_lesson_count,
        'class_days', v_class_day_count,
        'submission_requirements', v_requirement_count,
        'questions', v_question_count
      ),
      error_code = v_error_code,
      error_sqlstate = v_error_sqlstate,
      completed_at = now(),
      updated_at = now()
    where id = p_operation_id;
  end;

  return v_result;
end;
$$;

revoke all on table public.course_blueprint_operations from public, anon, authenticated;
grant select, insert, update on table public.course_blueprint_operations to service_role;

revoke all on function public.create_course_blueprint_atomic(
  uuid,
  uuid,
  text,
  text,
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated;
grant execute on function public.create_course_blueprint_atomic(
  uuid,
  uuid,
  text,
  text,
  uuid,
  bigint,
  jsonb
) to service_role;

revoke all on function public.instantiate_course_blueprint_atomic(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) from public, anon, authenticated;
grant execute on function public.instantiate_course_blueprint_atomic(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) to service_role;
