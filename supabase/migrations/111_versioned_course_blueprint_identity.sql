-- Stable reusable-artifact identity, immutable Blueprint Versions, and
-- stale-safe change proposal foundations.

alter table public.course_blueprints
  add column if not exists authority_mode text not null default 'pika'
    check (authority_mode in ('pika', 'repository')),
  add column if not exists latest_version_number bigint not null default 0
    check (latest_version_number >= 0),
  add column if not exists gradebook_use_weights boolean not null default false,
  add column if not exists gradebook_assignments_weight smallint not null default 70
    check (gradebook_assignments_weight between 0 and 100),
  add column if not exists gradebook_tests_weight smallint not null default 30
    check (gradebook_tests_weight between 0 and 100);
alter table public.course_blueprints
  drop constraint if exists course_blueprints_gradebook_weights_total_check;
alter table public.course_blueprints
  add constraint course_blueprints_gradebook_weights_total_check
    check (
      not gradebook_use_weights
      or gradebook_assignments_weight + gradebook_tests_weight = 100
    );

create table if not exists public.course_blueprint_materials (
  id uuid primary key default gen_random_uuid(),
  course_blueprint_id uuid not null
    references public.course_blueprints (id) on delete cascade,
  artifact_id uuid not null default gen_random_uuid(),
  title text not null,
  content_markdown text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_blueprint_id, artifact_id)
);

create table if not exists public.course_blueprint_surveys (
  id uuid primary key default gen_random_uuid(),
  course_blueprint_id uuid not null
    references public.course_blueprints (id) on delete cascade,
  artifact_id uuid not null default gen_random_uuid(),
  title text not null,
  show_results boolean not null default true,
  dynamic_responses boolean not null default false,
  questions_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(questions_json) = 'array'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_blueprint_id, artifact_id)
);

create index if not exists idx_course_blueprint_materials_position
  on public.course_blueprint_materials (course_blueprint_id, position);
create index if not exists idx_course_blueprint_surveys_position
  on public.course_blueprint_surveys (course_blueprint_id, position);

drop trigger if exists update_course_blueprint_materials_updated_at
  on public.course_blueprint_materials;
create trigger update_course_blueprint_materials_updated_at
  before update on public.course_blueprint_materials
  for each row execute function public.update_course_blueprints_updated_at();
drop trigger if exists update_course_blueprint_surveys_updated_at
  on public.course_blueprint_surveys;
create trigger update_course_blueprint_surveys_updated_at
  before update on public.course_blueprint_surveys
  for each row execute function public.update_course_blueprints_updated_at();

alter table public.course_blueprint_materials enable row level security;
alter table public.course_blueprint_surveys enable row level security;

drop policy if exists "Teachers can manage blueprint materials"
  on public.course_blueprint_materials;
create policy "Teachers can manage blueprint materials"
  on public.course_blueprint_materials for all
  using (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_materials.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_materials.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  );

drop policy if exists "Teachers can manage blueprint surveys"
  on public.course_blueprint_surveys;
create policy "Teachers can manage blueprint surveys"
  on public.course_blueprint_surveys for all
  using (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_surveys.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_surveys.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  );

alter table public.course_blueprint_assignments
  add column if not exists artifact_id uuid,
  add column if not exists track_authenticity boolean not null default false;
update public.course_blueprint_assignments
set artifact_id = id
where artifact_id is null;
alter table public.course_blueprint_assignments
  alter column artifact_id set default gen_random_uuid(),
  alter column artifact_id set not null;
create unique index if not exists course_blueprint_assignments_artifact_unique
  on public.course_blueprint_assignments (course_blueprint_id, artifact_id);

alter table public.course_blueprint_assessments
  add column if not exists artifact_id uuid;
update public.course_blueprint_assessments
set artifact_id = id
where artifact_id is null;
alter table public.course_blueprint_assessments
  alter column artifact_id set default gen_random_uuid(),
  alter column artifact_id set not null;
create unique index if not exists course_blueprint_assessments_artifact_unique
  on public.course_blueprint_assessments (course_blueprint_id, artifact_id);

alter table public.course_blueprint_lesson_templates
  add column if not exists artifact_id uuid;
update public.course_blueprint_lesson_templates
set artifact_id = id
where artifact_id is null;
alter table public.course_blueprint_lesson_templates
  alter column artifact_id set default gen_random_uuid(),
  alter column artifact_id set not null;
create unique index if not exists course_blueprint_lessons_artifact_unique
  on public.course_blueprint_lesson_templates (course_blueprint_id, artifact_id);

create or replace function public.ensure_blueprint_json_artifact_ids(p_items jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_item jsonb;
  v_id text;
  v_seen text[] := array[]::text[];
  v_result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_id := v_item->>'id';
    if v_id is null
      or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_id = any(v_seen)
    then
      v_id := gen_random_uuid()::text;
    end if;
    v_seen := array_append(v_seen, v_id);
    v_result := v_result || jsonb_build_array(v_item || jsonb_build_object('id', v_id));
  end loop;

  return v_result;
end;
$$;

update public.course_blueprint_assignments
set submission_requirements_json =
  public.ensure_blueprint_json_artifact_ids(submission_requirements_json);

update public.course_blueprint_assessments
set
  content = jsonb_set(
    content,
    '{questions}',
    public.ensure_blueprint_json_artifact_ids(coalesce(content->'questions', '[]'::jsonb)),
    true
  ),
  documents = public.ensure_blueprint_json_artifact_ids(documents);

create table if not exists public.course_blueprint_versions (
  id uuid primary key default gen_random_uuid(),
  course_blueprint_id uuid not null
    references public.course_blueprints (id) on delete cascade,
  version_number bigint not null check (version_number > 0),
  source_draft_revision bigint not null check (source_draft_revision > 0),
  snapshot_schema_version integer not null default 1
    check (snapshot_schema_version > 0),
  snapshot_json jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_kind text not null default 'pika'
    check (source_kind in ('pika', 'classroom', 'package', 'repository', 'ai')),
  source_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_blueprint_id, version_number),
  unique (course_blueprint_id, source_draft_revision, snapshot_sha256)
);

alter table public.course_blueprint_versions
  drop constraint if exists course_blueprint_versions_created_by_fkey;
alter table public.course_blueprint_versions
  add constraint course_blueprint_versions_created_by_fkey
  foreign key (created_by) references public.users (id) on delete cascade;

create index if not exists idx_course_blueprint_versions_blueprint_created
  on public.course_blueprint_versions (course_blueprint_id, version_number desc);

create or replace function public.prevent_blueprint_version_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Direct Version deletion remains forbidden, while an FK cascade from an
  -- intentional Blueprint (or owning user) deletion may erase the whole graph.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'Blueprint Versions are immutable' using errcode = '55000';
end;
$$;

drop trigger if exists prevent_blueprint_version_update on public.course_blueprint_versions;
create trigger prevent_blueprint_version_update
  before update or delete on public.course_blueprint_versions
  for each row execute function public.prevent_blueprint_version_mutation();

alter table public.course_blueprint_versions enable row level security;

drop policy if exists "Teachers can view their blueprint versions"
  on public.course_blueprint_versions;
create policy "Teachers can view their blueprint versions"
  on public.course_blueprint_versions for select
  using (
    exists (
      select 1
      from public.course_blueprints
      where course_blueprints.id = course_blueprint_versions.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  );

alter table public.classrooms
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;

create index if not exists idx_classrooms_source_blueprint_version
  on public.classrooms (source_blueprint_version_id);

alter table public.assignments
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists blueprint_archived_at timestamptz,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists assignments_classroom_artifact_unique
  on public.assignments (classroom_id, artifact_id);
create unique index if not exists assignments_active_blueprint_source_unique
  on public.assignments (classroom_id, source_artifact_id)
  where source_artifact_id is not null and blueprint_archived_at is null;

alter table public.tests
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists blueprint_archived_at timestamptz,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists tests_classroom_artifact_unique
  on public.tests (classroom_id, artifact_id);
create unique index if not exists tests_active_blueprint_source_unique
  on public.tests (classroom_id, source_artifact_id)
  where source_artifact_id is not null and blueprint_archived_at is null;

alter table public.test_questions
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists test_questions_test_artifact_unique
  on public.test_questions (test_id, artifact_id);

alter table public.assignment_submission_requirements
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists assignment_requirements_artifact_unique
  on public.assignment_submission_requirements (assignment_id, artifact_id);

alter table public.lesson_plans
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists blueprint_archived_at timestamptz,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists lesson_plans_classroom_artifact_unique
  on public.lesson_plans (classroom_id, artifact_id);
create unique index if not exists lessons_active_blueprint_source_unique
  on public.lesson_plans (classroom_id, source_artifact_id)
  where source_artifact_id is not null and blueprint_archived_at is null;

alter table public.classwork_materials
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists blueprint_archived_at timestamptz,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists classwork_materials_classroom_artifact_unique
  on public.classwork_materials (classroom_id, artifact_id);
create unique index if not exists materials_active_blueprint_source_unique
  on public.classwork_materials (classroom_id, source_artifact_id)
  where source_artifact_id is not null and blueprint_archived_at is null;

alter table public.surveys
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists blueprint_archived_at timestamptz,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists surveys_classroom_artifact_unique
  on public.surveys (classroom_id, artifact_id);
create unique index if not exists surveys_active_blueprint_source_unique
  on public.surveys (classroom_id, source_artifact_id)
  where source_artifact_id is not null and blueprint_archived_at is null;

alter table public.survey_questions
  add column if not exists artifact_id uuid not null default gen_random_uuid(),
  add column if not exists source_artifact_id uuid,
  add column if not exists source_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null;
create unique index if not exists survey_questions_survey_artifact_unique
  on public.survey_questions (survey_id, artifact_id);

create table if not exists public.course_blueprint_change_proposals (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users (id) on delete cascade,
  course_blueprint_id uuid not null
    references public.course_blueprints (id) on delete cascade,
  source_classroom_id uuid references public.classrooms (id) on delete set null,
  target_classroom_id uuid references public.classrooms (id) on delete cascade,
  target_kind text not null check (target_kind in ('blueprint', 'classroom')),
  source_kind text not null
    check (source_kind in ('classroom', 'package', 'repository', 'ai', 'blueprint')),
  status text not null default 'needs_review'
    check (status in (
      'ready',
      'needs_review',
      'conflicted',
      'stale',
      'applied',
      'rejected'
    )),
  base_blueprint_revision bigint not null check (base_blueprint_revision > 0),
  base_classroom_revision bigint check (base_classroom_revision > 0),
  base_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null,
  payload_schema_version integer not null default 1
    check (payload_schema_version > 0),
  operations_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(operations_json) = 'array'),
  diff_json jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(validation_errors) = 'array'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  applied_blueprint_revision bigint,
  applied_classroom_revision bigint,
  applied_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, idempotency_key),
  check (
    (target_kind = 'blueprint' and target_classroom_id is null)
    or (target_kind = 'classroom' and target_classroom_id is not null)
  )
);

create index if not exists idx_blueprint_proposals_review_queue
  on public.course_blueprint_change_proposals
    (course_blueprint_id, status, created_at desc);

alter table public.course_blueprint_change_proposals enable row level security;

drop policy if exists "Teachers can manage their blueprint proposals"
  on public.course_blueprint_change_proposals;
create policy "Teachers can manage their blueprint proposals"
  on public.course_blueprint_change_proposals for all
  using (teacher_id = auth.uid())
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from public.course_blueprints
      where course_blueprints.id = course_blueprint_change_proposals.course_blueprint_id
        and course_blueprints.teacher_id = auth.uid()
    )
  );

create table if not exists public.course_blueprint_editing_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.users (id) on delete cascade,
  course_blueprint_id uuid not null
    references public.course_blueprints (id) on delete cascade,
  classroom_id uuid references public.classrooms (id) on delete set null,
  base_blueprint_version_id uuid
    references public.course_blueprint_versions (id) on delete set null,
  base_blueprint_revision bigint not null check (base_blueprint_revision > 0),
  base_classroom_revision bigint check (base_classroom_revision > 0),
  package_sha256 text not null check (package_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'ready'
    check (status in ('ready', 'closed', 'expired')),
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_blueprint_editing_sessions_active
  on public.course_blueprint_editing_sessions
    (course_blueprint_id, status, expires_at);

alter table public.course_blueprint_editing_sessions enable row level security;

drop policy if exists "Teachers can manage their blueprint editing sessions"
  on public.course_blueprint_editing_sessions;
create policy "Teachers can manage their blueprint editing sessions"
  on public.course_blueprint_editing_sessions for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

-- Classroom structural revisions must ignore runtime-only changes.
create or replace function public.bump_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.blueprint_source_revision = old.blueprint_source_revision
    and (
      new.course_overview_markdown is distinct from old.course_overview_markdown
      or new.course_outline_markdown is distinct from old.course_outline_markdown
    )
  then
    new.blueprint_source_revision := old.blueprint_source_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists touch_classroom_blueprint_source_from_announcements
  on public.announcements;

create or replace function public.touch_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.identity_mapping', true) = 'on'
    or current_setting('pika.classroom_archive_restore', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then v_old_classroom_id := old.classroom_id; end if;
  if tg_op <> 'DELETE' then v_new_classroom_id := new.classroom_id; end if;

  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_from_test_question()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.identity_mapping', true) = 'on'
    or current_setting('pika.classroom_archive_restore', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id
    from public.tests where id = old.test_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id
    from public.tests where id = new.test_id;
  end if;

  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_from_requirement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.identity_mapping', true) = 'on'
    or current_setting('pika.classroom_archive_restore', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id
    from public.assignments where id = old.assignment_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id
    from public.assignments where id = new.assignment_id;
  end if;

  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_from_survey_question()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.identity_mapping', true) = 'on'
    or current_setting('pika.classroom_archive_restore', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id
    from public.surveys where id = old.survey_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id
    from public.surveys where id = new.survey_id;
  end if;

  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Use column-specific triggers for reusable fields. Release/runtime edits do
-- not invalidate external editing sessions; due and lesson date edits do,
-- because the classroom projection turns them into reusable relative pacing.
drop trigger if exists touch_classroom_blueprint_source_from_assignments
  on public.assignments;
create trigger touch_classroom_blueprint_source_from_assignments_insert_delete
  after insert or delete on public.assignments
  for each row execute function public.touch_classroom_blueprint_source_revision();
create trigger touch_classroom_blueprint_source_from_assignments_update
  after update of
    title,
    description,
    instructions_markdown,
    rich_instructions,
    due_at,
    position,
    track_authenticity,
    points_possible,
    include_in_final,
    gradebook_weight,
    artifact_id,
    source_artifact_id
  on public.assignments
  for each row
  when (
    old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.instructions_markdown is distinct from new.instructions_markdown
    or old.rich_instructions is distinct from new.rich_instructions
    or old.due_at is distinct from new.due_at
    or old.position is distinct from new.position
    or old.track_authenticity is distinct from new.track_authenticity
    or old.points_possible is distinct from new.points_possible
    or old.include_in_final is distinct from new.include_in_final
    or old.gradebook_weight is distinct from new.gradebook_weight
    or old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
  )
  execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_tests
  on public.tests;
create trigger touch_classroom_blueprint_source_from_tests_insert_delete
  after insert or delete on public.tests
  for each row execute function public.touch_classroom_blueprint_source_revision();
create trigger touch_classroom_blueprint_source_from_tests_update
  after update of
    title,
    show_results,
    documents,
    position,
    points_possible,
    include_in_final,
    gradebook_weight,
    artifact_id,
    source_artifact_id
  on public.tests
  for each row
  when (
    old.title is distinct from new.title
    or old.show_results is distinct from new.show_results
    or old.documents is distinct from new.documents
    or old.position is distinct from new.position
    or old.points_possible is distinct from new.points_possible
    or old.include_in_final is distinct from new.include_in_final
    or old.gradebook_weight is distinct from new.gradebook_weight
    or old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
  )
  execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_lessons
  on public.lesson_plans;
create trigger touch_classroom_blueprint_source_from_lessons_insert_delete
  after insert or delete on public.lesson_plans
  for each row execute function public.touch_classroom_blueprint_source_revision();
create trigger touch_classroom_blueprint_source_from_lessons_update
  after update of
    date,
    content,
    content_markdown,
    artifact_id,
    source_artifact_id
  on public.lesson_plans
  for each row
  when (
    old.date is distinct from new.date
    or old.content is distinct from new.content
    or old.content_markdown is distinct from new.content_markdown
    or old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
  )
  execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_materials
  on public.classwork_materials;
create trigger touch_classroom_blueprint_source_from_materials_insert_delete
  after insert or delete on public.classwork_materials
  for each row execute function public.touch_classroom_blueprint_source_revision();
create trigger touch_classroom_blueprint_source_from_materials_update
  after update of title, content, position, artifact_id, source_artifact_id
  on public.classwork_materials
  for each row
  when (
    old.title is distinct from new.title
    or old.content is distinct from new.content
    or old.position is distinct from new.position
    or old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
  )
  execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_surveys
  on public.surveys;
create trigger touch_classroom_blueprint_source_from_surveys_insert_delete
  after insert or delete on public.surveys
  for each row execute function public.touch_classroom_blueprint_source_revision();
create trigger touch_classroom_blueprint_source_from_surveys_update
  after update of
    title,
    show_results,
    dynamic_responses,
    position,
    artifact_id,
    source_artifact_id
  on public.surveys
  for each row
  when (
    old.title is distinct from new.title
    or old.show_results is distinct from new.show_results
    or old.dynamic_responses is distinct from new.dynamic_responses
    or old.position is distinct from new.position
    or old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
  )
  execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_survey_questions
  on public.survey_questions;
create trigger touch_classroom_blueprint_source_from_survey_questions_insert_delete
  after insert or delete on public.survey_questions
  for each row
  execute function public.touch_classroom_blueprint_source_from_survey_question();
create trigger touch_classroom_blueprint_source_from_survey_questions_update
  after update of
    artifact_id,
    source_artifact_id,
    question_type,
    question_text,
    options,
    response_max_chars,
    position
  on public.survey_questions
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
    or old.question_type is distinct from new.question_type
    or old.question_text is distinct from new.question_text
    or old.options is distinct from new.options
    or old.response_max_chars is distinct from new.response_max_chars
    or old.position is distinct from new.position
  )
  execute function public.touch_classroom_blueprint_source_from_survey_question();

drop trigger if exists touch_classroom_blueprint_source_from_gradebook
  on public.gradebook_settings;
create trigger touch_classroom_blueprint_source_from_gradebook_insert_delete
  after insert or delete on public.gradebook_settings
  for each row execute function public.touch_classroom_blueprint_source_revision();
create trigger touch_classroom_blueprint_source_from_gradebook_update
  after update of use_weights, assignments_weight, tests_weight
  on public.gradebook_settings
  for each row
  when (
    old.use_weights is distinct from new.use_weights
    or old.assignments_weight is distinct from new.assignments_weight
    or old.tests_weight is distinct from new.tests_weight
  )
  execute function public.touch_classroom_blueprint_source_revision();

create or replace function public.touch_classroom_blueprint_source_from_assessment_draft()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
  v_old_type text;
  v_new_type text;
begin
  if current_setting('pika.identity_mapping', true) = 'on'
    or current_setting('pika.classroom_archive_restore', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    v_old_classroom_id := old.classroom_id;
    v_old_type := old.assessment_type;
  end if;
  if tg_op <> 'DELETE' then
    v_new_classroom_id := new.classroom_id;
    v_new_type := new.assessment_type;
  end if;

  if v_old_type = 'test' then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_old_classroom_id;
  end if;
  if v_new_type = 'test'
    and v_new_classroom_id is distinct from v_old_classroom_id
  then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  elsif tg_op = 'UPDATE'
    and v_new_type = 'test'
    and v_old_type is distinct from 'test'
  then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists touch_classroom_blueprint_source_from_drafts
  on public.assessment_drafts;
create trigger touch_classroom_blueprint_source_from_drafts
  after insert or delete or update of content, assessment_type, classroom_id
  on public.assessment_drafts
  for each row execute function public.touch_classroom_blueprint_source_from_assessment_draft();

drop trigger if exists touch_classroom_blueprint_source_from_resources
  on public.classroom_resources;
create trigger touch_classroom_blueprint_source_from_resources_insert_delete
  after insert or delete on public.classroom_resources
  for each row execute function public.touch_classroom_blueprint_source_revision();
create trigger touch_classroom_blueprint_source_from_resources_update
  after update of content on public.classroom_resources
  for each row
  when (old.content is distinct from new.content)
  execute function public.touch_classroom_blueprint_source_revision();

drop trigger if exists touch_classroom_blueprint_source_from_test_questions
  on public.test_questions;
create trigger touch_classroom_blueprint_source_from_test_questions_insert_delete
  after insert or delete on public.test_questions
  for each row execute function public.touch_classroom_blueprint_source_from_test_question();
create trigger touch_classroom_blueprint_source_from_test_questions_update
  after update of
    artifact_id,
    source_artifact_id,
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
  on public.test_questions
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
    or old.question_type is distinct from new.question_type
    or old.question_text is distinct from new.question_text
    or old.options is distinct from new.options
    or old.correct_option is distinct from new.correct_option
    or old.answer_key is distinct from new.answer_key
    or old.sample_solution is distinct from new.sample_solution
    or old.points is distinct from new.points
    or old.response_max_chars is distinct from new.response_max_chars
    or old.response_monospace is distinct from new.response_monospace
    or old.position is distinct from new.position
  )
  execute function public.touch_classroom_blueprint_source_from_test_question();

drop trigger if exists touch_classroom_blueprint_source_from_requirements
  on public.assignment_submission_requirements;
create trigger touch_classroom_blueprint_source_from_requirements_insert_delete
  after insert or delete on public.assignment_submission_requirements
  for each row execute function public.touch_classroom_blueprint_source_from_requirement();
create trigger touch_classroom_blueprint_source_from_requirements_update
  after update of
    artifact_id,
    source_artifact_id,
    type,
    label,
    instructions,
    required,
    position,
    validation_policy_json
  on public.assignment_submission_requirements
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.source_artifact_id is distinct from new.source_artifact_id
    or old.type is distinct from new.type
    or old.label is distinct from new.label
    or old.instructions is distinct from new.instructions
    or old.required is distinct from new.required
    or old.position is distinct from new.position
    or old.validation_policy_json is distinct from new.validation_policy_json
  )
  execute function public.touch_classroom_blueprint_source_from_requirement();

alter table public.course_blueprint_operations
  drop constraint if exists course_blueprint_operations_operation_type_check;
alter table public.course_blueprint_operations
  add constraint course_blueprint_operations_operation_type_check
  check (operation_type in (
    'import',
    'capture',
    'instantiate',
    'version',
    'propose',
    'apply'
  ));

comment on table public.course_blueprint_versions is
  'Immutable, content-addressed snapshots of complete reusable Blueprint Drafts.';
comment on table public.course_blueprint_change_proposals is
  'Reviewable, stale-safe structured changes from classrooms, packages, repositories, or AI.';
comment on table public.course_blueprint_editing_sessions is
  'Exact-revision leases for pull-edit-propose external course editing.';

-- Blueprint Draft revisions also exclude ordering in the teacher's Blueprint
-- list, authority bookkeeping, and saved-version bookkeeping.
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

create or replace function public.touch_parent_course_blueprint_revision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_blueprint_id uuid;
  v_new_blueprint_id uuid;
begin
  if current_setting('pika.identity_mapping', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then v_old_blueprint_id := old.course_blueprint_id; end if;
  if tg_op <> 'DELETE' then v_new_blueprint_id := new.course_blueprint_id; end if;

  update public.course_blueprints
  set content_revision = content_revision + 1
  where id = v_old_blueprint_id;
  if v_new_blueprint_id is distinct from v_old_blueprint_id then
    update public.course_blueprints
    set content_revision = content_revision + 1
    where id = v_new_blueprint_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists touch_blueprint_revision_from_assignments
  on public.course_blueprint_assignments;
create trigger touch_blueprint_revision_from_assignments_insert_delete
  after insert or delete on public.course_blueprint_assignments
  for each row execute function public.touch_parent_course_blueprint_revision();
create trigger touch_blueprint_revision_from_assignments_update
  after update of
    artifact_id,
    title,
    instructions_markdown,
    submission_requirements_json,
    default_due_days,
    default_due_time,
    points_possible,
    gradebook_weight,
    include_in_final,
    is_draft,
    track_authenticity,
    position
  on public.course_blueprint_assignments
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.title is distinct from new.title
    or old.instructions_markdown is distinct from new.instructions_markdown
    or old.submission_requirements_json is distinct from new.submission_requirements_json
    or old.default_due_days is distinct from new.default_due_days
    or old.default_due_time is distinct from new.default_due_time
    or old.points_possible is distinct from new.points_possible
    or old.gradebook_weight is distinct from new.gradebook_weight
    or old.include_in_final is distinct from new.include_in_final
    or old.is_draft is distinct from new.is_draft
    or old.track_authenticity is distinct from new.track_authenticity
    or old.position is distinct from new.position
  )
  execute function public.touch_parent_course_blueprint_revision();

drop trigger if exists touch_blueprint_revision_from_assessments
  on public.course_blueprint_assessments;
create trigger touch_blueprint_revision_from_assessments_insert_delete
  after insert or delete on public.course_blueprint_assessments
  for each row execute function public.touch_parent_course_blueprint_revision();
create trigger touch_blueprint_revision_from_assessments_update
  after update of
    artifact_id,
    assessment_type,
    title,
    content,
    documents,
    points_possible,
    gradebook_weight,
    include_in_final,
    position
  on public.course_blueprint_assessments
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.assessment_type is distinct from new.assessment_type
    or old.title is distinct from new.title
    or old.content is distinct from new.content
    or old.documents is distinct from new.documents
    or old.points_possible is distinct from new.points_possible
    or old.gradebook_weight is distinct from new.gradebook_weight
    or old.include_in_final is distinct from new.include_in_final
    or old.position is distinct from new.position
  )
  execute function public.touch_parent_course_blueprint_revision();

drop trigger if exists touch_blueprint_revision_from_lessons
  on public.course_blueprint_lesson_templates;
create trigger touch_blueprint_revision_from_lessons_insert_delete
  after insert or delete on public.course_blueprint_lesson_templates
  for each row execute function public.touch_parent_course_blueprint_revision();
create trigger touch_blueprint_revision_from_lessons_update
  after update of artifact_id, title, content_markdown, position
  on public.course_blueprint_lesson_templates
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.title is distinct from new.title
    or old.content_markdown is distinct from new.content_markdown
    or old.position is distinct from new.position
  )
  execute function public.touch_parent_course_blueprint_revision();

drop trigger if exists touch_blueprint_revision_from_materials
  on public.course_blueprint_materials;
create trigger touch_blueprint_revision_from_materials_insert_delete
  after insert or delete on public.course_blueprint_materials
  for each row execute function public.touch_parent_course_blueprint_revision();
create trigger touch_blueprint_revision_from_materials_update
  after update of artifact_id, title, content_markdown, position
  on public.course_blueprint_materials
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.title is distinct from new.title
    or old.content_markdown is distinct from new.content_markdown
    or old.position is distinct from new.position
  )
  execute function public.touch_parent_course_blueprint_revision();

drop trigger if exists touch_blueprint_revision_from_surveys
  on public.course_blueprint_surveys;
create trigger touch_blueprint_revision_from_surveys_insert_delete
  after insert or delete on public.course_blueprint_surveys
  for each row execute function public.touch_parent_course_blueprint_revision();
create trigger touch_blueprint_revision_from_surveys_update
  after update of
    artifact_id,
    title,
    show_results,
    dynamic_responses,
    questions_json,
    position
  on public.course_blueprint_surveys
  for each row
  when (
    old.artifact_id is distinct from new.artifact_id
    or old.title is distinct from new.title
    or old.show_results is distinct from new.show_results
    or old.dynamic_responses is distinct from new.dynamic_responses
    or old.questions_json is distinct from new.questions_json
    or old.position is distinct from new.position
  )
  execute function public.touch_parent_course_blueprint_revision();

create or replace function public.save_course_blueprint_version_atomic(
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_expected_draft_revision bigint,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_snapshot_sha256 text,
  p_source_kind text,
  p_source_metadata jsonb
)
returns public.course_blueprint_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blueprint public.course_blueprints;
  v_version public.course_blueprint_versions;
  v_next_version bigint;
begin
  if p_snapshot_schema_version < 1
    or jsonb_typeof(p_snapshot) is distinct from 'object'
    or p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    or p_source_kind not in ('pika', 'classroom', 'package', 'repository', 'ai')
  then
    raise exception 'Invalid Blueprint Version payload' using errcode = '22023';
  end if;

  select *
  into v_blueprint
  from public.course_blueprints
  where id = p_blueprint_id
    and teacher_id = p_teacher_id
  for update;

  if not found then
    raise exception 'Course Blueprint not found' using errcode = 'P0002';
  end if;
  if v_blueprint.content_revision <> p_expected_draft_revision then
    raise exception 'Blueprint Draft changed; rebuild the Version'
      using errcode = '40001';
  end if;
  if (p_snapshot->>'blueprint_id')::uuid <> p_blueprint_id
    or (p_snapshot->>'draft_revision')::bigint <> p_expected_draft_revision
  then
    raise exception 'Blueprint Version snapshot provenance is invalid'
      using errcode = '22023';
  end if;

  select *
  into v_version
  from public.course_blueprint_versions
  where course_blueprint_id = p_blueprint_id
    and source_draft_revision = p_expected_draft_revision
    and snapshot_sha256 = p_snapshot_sha256;
  if found then
    return v_version;
  end if;

  v_next_version := v_blueprint.latest_version_number + 1;
  insert into public.course_blueprint_versions (
    course_blueprint_id,
    version_number,
    source_draft_revision,
    snapshot_schema_version,
    snapshot_json,
    snapshot_sha256,
    source_kind,
    source_metadata,
    created_by
  )
  values (
    p_blueprint_id,
    v_next_version,
    p_expected_draft_revision,
    p_snapshot_schema_version,
    p_snapshot,
    p_snapshot_sha256,
    p_source_kind,
    coalesce(p_source_metadata, '{}'::jsonb),
    p_teacher_id
  )
  returning * into v_version;

  update public.course_blueprints
  set latest_version_number = v_next_version
  where id = p_blueprint_id;

  return v_version;
end;
$$;

revoke all on function public.save_course_blueprint_version_atomic(
  uuid,
  uuid,
  bigint,
  integer,
  jsonb,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.save_course_blueprint_version_atomic(
  uuid,
  uuid,
  bigint,
  integer,
  jsonb,
  text,
  text,
  jsonb
) to service_role;

-- Preserve the already-deployed migration 081 transactions while layering
-- identity-aware writes into the same outer transaction.
create or replace function public.create_course_blueprint_atomic_v2(
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
  v_blueprint_id uuid;
  v_item jsonb;
  v_child jsonb;
  v_parent_id uuid;
  v_position integer;
  v_updated integer;
begin
  perform set_config('pika.identity_mapping', 'on', true);
  v_result := public.create_course_blueprint_atomic(
    p_operation_id,
    p_teacher_id,
    p_operation_type,
    p_request_sha256,
    p_source_classroom_id,
    p_expected_source_revision,
    p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;
  if coalesce((v_result->>'replayed')::boolean, false) then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;

  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  update public.course_blueprints
  set
    gradebook_use_weights = coalesce(
      (p_plan->'blueprint'->>'gradebook_use_weights')::boolean,
      false
    ),
    gradebook_assignments_weight = coalesce(
      (p_plan->'blueprint'->>'gradebook_assignments_weight')::smallint,
      70
    ),
    gradebook_tests_weight = coalesce(
      (p_plan->'blueprint'->>'gradebook_tests_weight')::smallint,
      30
    )
  where id = v_blueprint_id;

  for v_item in select value from jsonb_array_elements(p_plan->'assignments')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_assignments
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      track_authenticity = coalesce(
        (v_item->>'track_authenticity')::boolean,
        false
      )
    where course_blueprint_id = v_blueprint_id
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Assignment positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      update public.assignments
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and position = v_position
      returning id into v_parent_id;
      if not found then
        raise exception 'Captured assignment identity mapping failed'
          using errcode = '22023';
      end if;
      for v_child in
        select value
        from jsonb_array_elements(
          coalesce(v_item->'submission_requirements_json', '[]'::jsonb)
        )
      loop
        update public.assignment_submission_requirements
        set
          artifact_id = (v_child->>'id')::uuid,
          source_artifact_id = (v_child->>'id')::uuid
        where assignment_id = v_parent_id
          and position = coalesce((v_child->>'position')::integer, 0);
        get diagnostics v_updated = row_count;
        if v_updated <> 1 then
          raise exception 'Captured assignment requirement identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'assessments')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_assessments
    set artifact_id = (v_item->>'artifact_id')::uuid
    where course_blueprint_id = v_blueprint_id
      and assessment_type = 'test'
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Test positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      update public.tests
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and position = v_position
      returning id into v_parent_id;
      if not found then
        raise exception 'Captured Test identity mapping failed'
          using errcode = '22023';
      end if;
      for v_child in
        select value
        from jsonb_array_elements(
          coalesce(v_item->'content'->'questions', '[]'::jsonb)
        )
      loop
        update public.test_questions
        set
          artifact_id = (v_child->>'id')::uuid,
          source_artifact_id = (v_child->>'id')::uuid
        where test_id = v_parent_id
          and position = coalesce((v_child->>'position')::integer, 0);
        get diagnostics v_updated = row_count;
        if v_updated <> 1 then
          raise exception 'Captured Test question identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'lesson_templates')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.course_blueprint_lesson_templates
    set artifact_id = (v_item->>'artifact_id')::uuid
    where course_blueprint_id = v_blueprint_id
      and position = v_position;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Lesson positions must be unique for identity mapping'
        using errcode = '22023';
    end if;
    if p_operation_type = 'capture' then
      update public.lesson_plans
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where id = (
        select lesson.id
        from public.lesson_plans lesson
        where lesson.classroom_id = p_source_classroom_id
        order by lesson.date, lesson.id
        offset v_position
        limit 1
      );
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Captured lesson identity mapping failed'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb))
  loop
    insert into public.course_blueprint_materials (
      course_blueprint_id,
      artifact_id,
      title,
      content_markdown,
      position
    )
    values (
      v_blueprint_id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce(v_item->>'content_markdown', ''),
      coalesce((v_item->>'position')::integer, 0)
    );
    if p_operation_type = 'capture' then
      update public.classwork_materials
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and position = coalesce((v_item->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Captured material identity mapping failed'
          using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'surveys', '[]'::jsonb))
  loop
    insert into public.course_blueprint_surveys (
      course_blueprint_id,
      artifact_id,
      title,
      show_results,
      dynamic_responses,
      questions_json,
      position
    )
    values (
      v_blueprint_id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce((v_item->>'show_results')::boolean, true),
      coalesce((v_item->>'dynamic_responses')::boolean, false),
      coalesce(v_item->'questions_json', '[]'::jsonb),
      coalesce((v_item->>'position')::integer, 0)
    );
    if p_operation_type = 'capture' then
      update public.surveys
      set
        artifact_id = (v_item->>'artifact_id')::uuid,
        source_artifact_id = (v_item->>'artifact_id')::uuid
      where classroom_id = p_source_classroom_id
        and position = coalesce((v_item->>'position')::integer, 0)
      returning id into v_parent_id;
      if not found then
        raise exception 'Captured survey identity mapping failed'
          using errcode = '22023';
      end if;
      for v_child in
        select value
        from jsonb_array_elements(coalesce(v_item->'questions_json', '[]'::jsonb))
      loop
        update public.survey_questions
        set
          artifact_id = (v_child->>'id')::uuid,
          source_artifact_id = (v_child->>'id')::uuid
        where survey_id = v_parent_id
          and position = coalesce((v_child->>'position')::integer, 0);
        get diagnostics v_updated = row_count;
        if v_updated <> 1 then
          raise exception 'Captured survey question identity mapping failed'
            using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  v_result := jsonb_set(
    v_result,
    '{counts}',
    coalesce(v_result->'counts', '{}'::jsonb) || jsonb_build_object(
      'materials', jsonb_array_length(coalesce(p_plan->'materials', '[]'::jsonb)),
      'surveys', jsonb_array_length(coalesce(p_plan->'surveys', '[]'::jsonb))
    ),
    true
  );
  update public.course_blueprint_operations
  set
    result = v_result,
    resource_counts = v_result->'counts',
    updated_at = now()
  where id = p_operation_id;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
end;
$$;

create or replace function public.instantiate_course_blueprint_atomic_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_blueprint_version_id uuid,
  p_request_sha256 text,
  p_expected_content_revision bigint,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_classroom_id uuid;
  v_parent_id uuid;
  v_item jsonb;
  v_child jsonb;
  v_position integer;
  v_updated integer;
begin
  if not exists (
    select 1
    from public.course_blueprint_versions
    where id = p_blueprint_version_id
      and course_blueprint_id = p_blueprint_id
      and source_draft_revision = p_expected_content_revision
  ) then
    raise exception 'Blueprint Version does not match the requested Draft revision'
      using errcode = '40001';
  end if;

  perform set_config('pika.identity_mapping', 'on', true);
  v_result := public.instantiate_course_blueprint_atomic(
    p_operation_id,
    p_teacher_id,
    p_blueprint_id,
    p_request_sha256,
    p_expected_content_revision,
    p_plan
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;
  if coalesce((v_result->>'replayed')::boolean, false) then
    perform set_config('pika.identity_mapping', 'off', true);
    return v_result;
  end if;

  v_classroom_id := (v_result->>'classroom_id')::uuid;
  update public.classrooms
  set
    source_blueprint_version_id = p_blueprint_version_id,
    source_blueprint_origin = coalesce(source_blueprint_origin, '{}'::jsonb)
      || jsonb_build_object(
      'blueprint_version_id', p_blueprint_version_id,
      'blueprint_version_number', (
        select version_number
        from public.course_blueprint_versions
        where id = p_blueprint_version_id
      )
    )
  where id = v_classroom_id;

  for v_item in select value from jsonb_array_elements(p_plan->'assignments')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.assignments
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid,
      source_blueprint_version_id = p_blueprint_version_id,
      track_authenticity = coalesce(
        (v_item->>'track_authenticity')::boolean,
        false
      )
    where classroom_id = v_classroom_id
      and position = v_position
    returning id into v_parent_id;
    if not found then
      raise exception 'Assignment identity mapping failed' using errcode = '22023';
    end if;

    for v_child in
      select value
      from jsonb_array_elements(coalesce(v_item->'submission_requirements', '[]'::jsonb))
    loop
      update public.assignment_submission_requirements
      set
        artifact_id = (v_child->>'artifact_id')::uuid,
        source_artifact_id = (v_child->>'artifact_id')::uuid,
        source_blueprint_version_id = p_blueprint_version_id
      where assignment_id = v_parent_id
        and position = coalesce((v_child->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Submission requirement identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'tests')
  loop
    v_position := coalesce((v_item->>'position')::integer, 0);
    update public.tests
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid,
      source_blueprint_version_id = p_blueprint_version_id
    where classroom_id = v_classroom_id
      and position = v_position
    returning id into v_parent_id;
    if not found then
      raise exception 'Test identity mapping failed' using errcode = '22023';
    end if;

    for v_child in
      select value
      from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
    loop
      update public.test_questions
      set
        artifact_id = (v_child->>'artifact_id')::uuid,
        source_artifact_id = (v_child->>'artifact_id')::uuid,
        source_blueprint_version_id = p_blueprint_version_id
      where test_id = v_parent_id
        and position = coalesce((v_child->>'position')::integer, 0);
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Test question identity mapping failed'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  for v_item in select value from jsonb_array_elements(p_plan->'lesson_plans')
  loop
    update public.lesson_plans
    set
      artifact_id = (v_item->>'artifact_id')::uuid,
      source_artifact_id = (v_item->>'artifact_id')::uuid,
      source_blueprint_version_id = p_blueprint_version_id
    where classroom_id = v_classroom_id
      and date = (v_item->>'date')::date;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Lesson identity mapping failed' using errcode = '22023';
    end if;
  end loop;

  insert into public.gradebook_settings (
    classroom_id,
    use_weights,
    assignments_weight,
    tests_weight
  )
  values (
    v_classroom_id,
    coalesce((p_plan->'grading'->>'use_weights')::boolean, false),
    coalesce((p_plan->'grading'->>'assignments_weight')::smallint, 70),
    coalesce((p_plan->'grading'->>'tests_weight')::smallint, 30)
  )
  on conflict (classroom_id) do update set
    use_weights = excluded.use_weights,
    assignments_weight = excluded.assignments_weight,
    tests_weight = excluded.tests_weight;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb))
  loop
    insert into public.classwork_materials (
      classroom_id,
      artifact_id,
      source_artifact_id,
      source_blueprint_version_id,
      title,
      content,
      is_draft,
      released_at,
      position,
      created_by
    )
    values (
      v_classroom_id,
      (v_item->>'artifact_id')::uuid,
      (v_item->>'artifact_id')::uuid,
      p_blueprint_version_id,
      v_item->>'title',
      coalesce(v_item->'content', '{"type":"doc","content":[]}'::jsonb),
      true,
      null,
      coalesce((v_item->>'position')::integer, 0),
      p_teacher_id
    );
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'surveys', '[]'::jsonb))
  loop
    insert into public.surveys (
      classroom_id,
      artifact_id,
      source_artifact_id,
      source_blueprint_version_id,
      title,
      status,
      opens_at,
      show_results,
      dynamic_responses,
      position,
      created_by
    )
    values (
      v_classroom_id,
      (v_item->>'artifact_id')::uuid,
      (v_item->>'artifact_id')::uuid,
      p_blueprint_version_id,
      v_item->>'title',
      'draft',
      null,
      coalesce((v_item->>'show_results')::boolean, true),
      coalesce((v_item->>'dynamic_responses')::boolean, false),
      coalesce((v_item->>'position')::integer, 0),
      p_teacher_id
    )
    returning id into v_parent_id;

    for v_child in
      select value
      from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
    loop
      insert into public.survey_questions (
        survey_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
        question_type,
        question_text,
        options,
        response_max_chars,
        position
      )
      values (
        v_parent_id,
        (v_child->>'artifact_id')::uuid,
        (v_child->>'artifact_id')::uuid,
        p_blueprint_version_id,
        v_child->>'question_type',
        v_child->>'question_text',
        coalesce(v_child->'options', '[]'::jsonb),
        coalesce((v_child->>'response_max_chars')::integer, 500),
        coalesce((v_child->>'position')::integer, 0)
      );
    end loop;
  end loop;

  v_result := v_result || jsonb_build_object(
    'source_blueprint_version_id',
    p_blueprint_version_id
  );
  v_result := jsonb_set(
    v_result,
    '{counts}',
    coalesce(v_result->'counts', '{}'::jsonb) || jsonb_build_object(
      'materials', jsonb_array_length(coalesce(p_plan->'materials', '[]'::jsonb)),
      'surveys', jsonb_array_length(coalesce(p_plan->'surveys', '[]'::jsonb)),
      'survey_questions', (
        select coalesce(sum(jsonb_array_length(coalesce(value->'questions', '[]'::jsonb))), 0)
        from jsonb_array_elements(coalesce(p_plan->'surveys', '[]'::jsonb))
      )
    ),
    true
  );
  update public.course_blueprint_operations
  set
    result = v_result,
    resource_counts = v_result->'counts',
    updated_at = now()
  where id = p_operation_id;

  perform set_config('pika.identity_mapping', 'off', true);
  return v_result;
end;
$$;

revoke all on function public.create_course_blueprint_atomic_v2(
  uuid,
  uuid,
  text,
  text,
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated;
grant execute on function public.create_course_blueprint_atomic_v2(
  uuid,
  uuid,
  text,
  text,
  uuid,
  bigint,
  jsonb
) to service_role;

revoke all on function public.instantiate_course_blueprint_atomic_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) from public, anon, authenticated;
grant execute on function public.instantiate_course_blueprint_atomic_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  jsonb
) to service_role;

create or replace function public.create_course_blueprint_proposal_atomic(
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_idempotency_key uuid,
  p_source_kind text,
  p_expected_blueprint_revision bigint,
  p_base_blueprint_version_id uuid,
  p_source_classroom_id uuid,
  p_base_classroom_revision bigint,
  p_operations jsonb,
  p_diff jsonb,
  p_request_sha256 text
)
returns public.course_blueprint_change_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blueprint public.course_blueprints;
  v_classroom public.classrooms;
  v_proposal public.course_blueprint_change_proposals;
  v_status text;
begin
  if p_source_kind not in ('classroom', 'package', 'repository', 'ai')
    or (
      p_source_kind = 'classroom'
      and (p_source_classroom_id is null or p_base_classroom_revision is null)
    )
    or (
      p_source_kind <> 'classroom'
      and (p_source_classroom_id is not null or p_base_classroom_revision is not null)
    )
    or jsonb_typeof(p_operations) is distinct from 'array'
    or jsonb_typeof(p_diff) is distinct from 'object'
    or p_request_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid Blueprint proposal payload' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_teacher_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select *
  into v_proposal
  from public.course_blueprint_change_proposals
  where teacher_id = p_teacher_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_proposal.course_blueprint_id <> p_blueprint_id
      or v_proposal.request_sha256 <> p_request_sha256
    then
      raise exception 'Proposal idempotency key conflict' using errcode = '23505';
    end if;
    return v_proposal;
  end if;

  select *
  into v_blueprint
  from public.course_blueprints
  where id = p_blueprint_id
    and teacher_id = p_teacher_id
  for share;
  if not found then
    raise exception 'Course Blueprint not found' using errcode = 'P0002';
  end if;

  if p_source_kind = 'classroom' then
    select *
    into v_classroom
    from public.classrooms
    where id = p_source_classroom_id
      and teacher_id = p_teacher_id
      and source_blueprint_id = p_blueprint_id
    for share;
    if not found then
      raise exception 'Source classroom not found' using errcode = 'P0002';
    end if;
  end if;

  v_status := case
    when v_blueprint.content_revision <> p_expected_blueprint_revision then 'stale'
    when p_source_kind = 'classroom'
      and v_classroom.blueprint_source_revision <> p_base_classroom_revision then 'stale'
    when jsonb_array_length(p_operations) = 0 then 'ready'
    else 'needs_review'
  end;

  insert into public.course_blueprint_change_proposals (
    teacher_id,
    course_blueprint_id,
    source_classroom_id,
    target_kind,
    source_kind,
    status,
    base_blueprint_revision,
    base_classroom_revision,
    base_blueprint_version_id,
    operations_json,
    diff_json,
    request_sha256,
    idempotency_key
  )
  values (
    p_teacher_id,
    p_blueprint_id,
    p_source_classroom_id,
    'blueprint',
    p_source_kind,
    v_status,
    p_expected_blueprint_revision,
    p_base_classroom_revision,
    p_base_blueprint_version_id,
    p_operations,
    p_diff,
    p_request_sha256,
    p_idempotency_key
  )
  returning * into v_proposal;

  return v_proposal;
end;
$$;

create or replace function public.apply_course_blueprint_proposal_atomic(
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
  v_proposal public.course_blueprint_change_proposals;
  v_blueprint public.course_blueprints;
  v_source_classroom public.classrooms;
  v_item jsonb;
  v_candidate_ids uuid[];
  v_result_revision bigint;
begin
  if jsonb_typeof(p_candidate_snapshot) is distinct from 'object'
    or p_candidate_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid proposal candidate snapshot' using errcode = '22023';
  end if;

  select *
  into v_proposal
  from public.course_blueprint_change_proposals
  where id = p_proposal_id
    and teacher_id = p_teacher_id
  for update;
  if not found then
    raise exception 'Blueprint proposal not found' using errcode = 'P0002';
  end if;
  if p_candidate_sha256 is distinct from
    v_proposal.diff_json->>'candidate_sha256'
  then
    raise exception 'Proposal candidate digest changed' using errcode = '22023';
  end if;
  if v_proposal.status = 'applied' then return v_proposal; end if;
  if v_proposal.status in ('rejected', 'conflicted') then
    raise exception 'Blueprint proposal is not applicable' using errcode = '55000';
  end if;

  select *
  into v_blueprint
  from public.course_blueprints
  where id = v_proposal.course_blueprint_id
    and teacher_id = p_teacher_id
  for update;
  if not found then
    raise exception 'Course Blueprint not found' using errcode = 'P0002';
  end if;

  if v_blueprint.content_revision <> v_proposal.base_blueprint_revision then
    update public.course_blueprint_change_proposals
    set status = 'stale', updated_at = now()
    where id = p_proposal_id
    returning * into v_proposal;
    return v_proposal;
  end if;
  if v_proposal.source_kind = 'classroom' then
    select *
    into v_source_classroom
    from public.classrooms
    where id = v_proposal.source_classroom_id
      and teacher_id = p_teacher_id
      and source_blueprint_id = v_proposal.course_blueprint_id
    for share;
    if not found
      or v_source_classroom.blueprint_source_revision
        <> v_proposal.base_classroom_revision
    then
      update public.course_blueprint_change_proposals
      set status = 'stale', updated_at = now()
      where id = p_proposal_id
      returning * into v_proposal;
      return v_proposal;
    end if;
  end if;
  if (p_candidate_snapshot->>'blueprint_id')::uuid <> v_blueprint.id
    or (p_candidate_snapshot->>'draft_revision')::bigint
      <> v_proposal.base_blueprint_revision
  then
    raise exception 'Proposal candidate provenance is invalid' using errcode = '22023';
  end if;
  if (
    v_blueprint.authority_mode = 'repository'
    and v_proposal.source_kind <> 'repository'
  ) or (
    v_blueprint.authority_mode = 'pika'
    and v_proposal.source_kind = 'repository'
  )
  then
    raise exception 'Proposal source does not match Blueprint authority'
      using errcode = '55000';
  end if;

  perform set_config('pika.identity_mapping', 'on', true);

  update public.course_blueprints
  set
    title = p_candidate_snapshot->'metadata'->>'title',
    subject = coalesce(p_candidate_snapshot->'metadata'->>'subject', ''),
    grade_level = coalesce(p_candidate_snapshot->'metadata'->>'grade_level', ''),
    course_code = coalesce(p_candidate_snapshot->'metadata'->>'course_code', ''),
    term_template = coalesce(p_candidate_snapshot->'metadata'->>'term_template', ''),
    overview_markdown = coalesce(
      p_candidate_snapshot->'sections'->>'overview_markdown',
      ''
    ),
    outline_markdown = coalesce(
      p_candidate_snapshot->'sections'->>'outline_markdown',
      ''
    ),
    resources_markdown = coalesce(
      p_candidate_snapshot->'sections'->>'resources_markdown',
      ''
    ),
    gradebook_use_weights = coalesce(
      (p_candidate_snapshot->'grading'->>'use_weights')::boolean,
      false
    ),
    gradebook_assignments_weight = coalesce(
      (p_candidate_snapshot->'grading'->>'assignments_weight')::smallint,
      70
    ),
    gradebook_tests_weight = coalesce(
      (p_candidate_snapshot->'grading'->>'tests_weight')::smallint,
      30
    ),
    planned_site_slug = nullif(p_candidate_snapshot->'planned_site'->>'slug', ''),
    planned_site_published = coalesce(
      (p_candidate_snapshot->'planned_site'->>'published')::boolean,
      false
    ),
    planned_site_config = coalesce(
      p_candidate_snapshot->'planned_site'->'config',
      '{}'::jsonb
    )
  where id = v_blueprint.id;

  v_candidate_ids := array[]::uuid[];
  for v_item in
    select value from jsonb_array_elements(p_candidate_snapshot->'assignments')
  loop
    v_candidate_ids := array_append(v_candidate_ids, (v_item->>'artifact_id')::uuid);
    insert into public.course_blueprint_assignments (
      course_blueprint_id,
      artifact_id,
      title,
      instructions_markdown,
      submission_requirements_json,
      default_due_days,
      default_due_time,
      points_possible,
      gradebook_weight,
      include_in_final,
      is_draft,
      track_authenticity,
      position
    )
    values (
      v_blueprint.id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce(v_item->>'instructions_markdown', ''),
      coalesce(v_item->'submission_requirements', '[]'::jsonb),
      coalesce((v_item->>'default_due_days')::integer, 0),
      coalesce(v_item->>'default_due_time', '23:59'),
      (v_item->>'points_possible')::numeric,
      coalesce((v_item->>'gradebook_weight')::integer, 10),
      coalesce((v_item->>'include_in_final')::boolean, true),
      coalesce((v_item->>'is_draft')::boolean, true),
      coalesce((v_item->>'track_authenticity')::boolean, false),
      coalesce((v_item->>'position')::integer, 0)
    )
    on conflict (course_blueprint_id, artifact_id)
    do update set
      title = excluded.title,
      instructions_markdown = excluded.instructions_markdown,
      submission_requirements_json = excluded.submission_requirements_json,
      default_due_days = excluded.default_due_days,
      default_due_time = excluded.default_due_time,
      points_possible = excluded.points_possible,
      gradebook_weight = excluded.gradebook_weight,
      include_in_final = excluded.include_in_final,
      is_draft = excluded.is_draft,
      track_authenticity = excluded.track_authenticity,
      position = excluded.position;
  end loop;
  delete from public.course_blueprint_assignments
  where course_blueprint_id = v_blueprint.id
    and not (artifact_id = any(v_candidate_ids));

  v_candidate_ids := array[]::uuid[];
  for v_item in
    select value from jsonb_array_elements(p_candidate_snapshot->'assessments')
  loop
    v_candidate_ids := array_append(v_candidate_ids, (v_item->>'artifact_id')::uuid);
    insert into public.course_blueprint_assessments (
      course_blueprint_id,
      artifact_id,
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
      v_blueprint.id,
      (v_item->>'artifact_id')::uuid,
      'test',
      v_item->>'title',
      coalesce(v_item->'content', '{}'::jsonb),
      coalesce(v_item->'documents', '[]'::jsonb),
      (v_item->>'points_possible')::numeric,
      coalesce((v_item->>'gradebook_weight')::integer, 10),
      coalesce((v_item->>'include_in_final')::boolean, true),
      coalesce((v_item->>'position')::integer, 0)
    )
    on conflict (course_blueprint_id, artifact_id)
    do update set
      assessment_type = excluded.assessment_type,
      title = excluded.title,
      content = excluded.content,
      documents = excluded.documents,
      points_possible = excluded.points_possible,
      gradebook_weight = excluded.gradebook_weight,
      include_in_final = excluded.include_in_final,
      position = excluded.position;
  end loop;
  delete from public.course_blueprint_assessments
  where course_blueprint_id = v_blueprint.id
    and not (artifact_id = any(v_candidate_ids));

  v_candidate_ids := array[]::uuid[];
  for v_item in
    select value from jsonb_array_elements(p_candidate_snapshot->'lesson_templates')
  loop
    v_candidate_ids := array_append(v_candidate_ids, (v_item->>'artifact_id')::uuid);
    insert into public.course_blueprint_lesson_templates (
      course_blueprint_id,
      artifact_id,
      title,
      content_markdown,
      position
    )
    values (
      v_blueprint.id,
      (v_item->>'artifact_id')::uuid,
      coalesce(v_item->>'title', ''),
      coalesce(v_item->>'content_markdown', ''),
      coalesce((v_item->>'position')::integer, 0)
    )
    on conflict (course_blueprint_id, artifact_id)
    do update set
      title = excluded.title,
      content_markdown = excluded.content_markdown,
      position = excluded.position;
  end loop;
  delete from public.course_blueprint_lesson_templates
  where course_blueprint_id = v_blueprint.id
    and not (artifact_id = any(v_candidate_ids));

  v_candidate_ids := array[]::uuid[];
  for v_item in
    select value from jsonb_array_elements(p_candidate_snapshot->'materials')
  loop
    v_candidate_ids := array_append(v_candidate_ids, (v_item->>'artifact_id')::uuid);
    insert into public.course_blueprint_materials (
      course_blueprint_id,
      artifact_id,
      title,
      content_markdown,
      position
    )
    values (
      v_blueprint.id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce(v_item->>'content_markdown', ''),
      coalesce((v_item->>'position')::integer, 0)
    )
    on conflict (course_blueprint_id, artifact_id)
    do update set
      title = excluded.title,
      content_markdown = excluded.content_markdown,
      position = excluded.position;
  end loop;
  delete from public.course_blueprint_materials
  where course_blueprint_id = v_blueprint.id
    and not (artifact_id = any(v_candidate_ids));

  v_candidate_ids := array[]::uuid[];
  for v_item in
    select value from jsonb_array_elements(p_candidate_snapshot->'surveys')
  loop
    v_candidate_ids := array_append(v_candidate_ids, (v_item->>'artifact_id')::uuid);
    insert into public.course_blueprint_surveys (
      course_blueprint_id,
      artifact_id,
      title,
      show_results,
      dynamic_responses,
      questions_json,
      position
    )
    values (
      v_blueprint.id,
      (v_item->>'artifact_id')::uuid,
      v_item->>'title',
      coalesce((v_item->>'show_results')::boolean, true),
      coalesce((v_item->>'dynamic_responses')::boolean, false),
      coalesce(
        (
          select jsonb_agg(
            (question.value - 'artifact_id')
              || jsonb_build_object('id', question.value->>'artifact_id')
            order by question.ordinality
          )
          from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
            with ordinality as question(value, ordinality)
        ),
        '[]'::jsonb
      ),
      coalesce((v_item->>'position')::integer, 0)
    )
    on conflict (course_blueprint_id, artifact_id)
    do update set
      title = excluded.title,
      show_results = excluded.show_results,
      dynamic_responses = excluded.dynamic_responses,
      questions_json = excluded.questions_json,
      position = excluded.position;
  end loop;
  delete from public.course_blueprint_surveys
  where course_blueprint_id = v_blueprint.id
    and not (artifact_id = any(v_candidate_ids));

  update public.course_blueprints
  set content_revision = v_proposal.base_blueprint_revision + 1
  where id = v_blueprint.id
  returning content_revision into v_result_revision;

  perform set_config('pika.identity_mapping', 'off', true);
  update public.course_blueprint_change_proposals
  set
    status = 'applied',
    applied_blueprint_revision = v_result_revision,
    applied_at = now(),
    updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;
  return v_proposal;
end;
$$;

create or replace function public.create_course_blueprint_classroom_proposal_atomic(
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_blueprint_version_id uuid,
  p_target_classroom_id uuid,
  p_expected_blueprint_revision bigint,
  p_expected_classroom_revision bigint,
  p_idempotency_key uuid,
  p_operations jsonb,
  p_diff jsonb,
  p_request_sha256 text
)
returns public.course_blueprint_change_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blueprint public.course_blueprints;
  v_classroom public.classrooms;
  v_proposal public.course_blueprint_change_proposals;
  v_status text;
begin
  if jsonb_typeof(p_operations) is distinct from 'array'
    or jsonb_typeof(p_diff) is distinct from 'object'
    or p_request_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid classroom Blueprint proposal payload'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_teacher_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select *
  into v_proposal
  from public.course_blueprint_change_proposals
  where teacher_id = p_teacher_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_proposal.course_blueprint_id <> p_blueprint_id
      or v_proposal.target_classroom_id <> p_target_classroom_id
      or v_proposal.request_sha256 <> p_request_sha256
    then
      raise exception 'Proposal idempotency key conflict' using errcode = '23505';
    end if;
    return v_proposal;
  end if;

  select *
  into v_blueprint
  from public.course_blueprints
  where id = p_blueprint_id
    and teacher_id = p_teacher_id
  for share;
  if not found then
    raise exception 'Course Blueprint not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.course_blueprint_versions
    where id = p_blueprint_version_id
      and course_blueprint_id = p_blueprint_id
      and source_draft_revision = p_expected_blueprint_revision
  ) then
    raise exception 'Blueprint Version does not match the proposal'
      using errcode = '40001';
  end if;

  select *
  into v_classroom
  from public.classrooms
  where id = p_target_classroom_id
    and teacher_id = p_teacher_id
    and source_blueprint_id = p_blueprint_id
  for share;
  if not found then
    raise exception 'Target classroom not found' using errcode = 'P0002';
  end if;

  v_status := case
    when v_blueprint.content_revision <> p_expected_blueprint_revision then 'stale'
    when v_classroom.blueprint_source_revision
      <> p_expected_classroom_revision then 'stale'
    when jsonb_array_length(p_operations) = 0 then 'ready'
    else 'needs_review'
  end;

  insert into public.course_blueprint_change_proposals (
    teacher_id,
    course_blueprint_id,
    target_classroom_id,
    target_kind,
    source_kind,
    status,
    base_blueprint_revision,
    base_classroom_revision,
    base_blueprint_version_id,
    operations_json,
    diff_json,
    request_sha256,
    idempotency_key
  )
  values (
    p_teacher_id,
    p_blueprint_id,
    p_target_classroom_id,
    'classroom',
    'blueprint',
    v_status,
    p_expected_blueprint_revision,
    p_expected_classroom_revision,
    p_blueprint_version_id,
    p_operations,
    p_diff,
    p_request_sha256,
    p_idempotency_key
  )
  returning * into v_proposal;

  return v_proposal;
end;
$$;

create or replace function public.apply_course_blueprint_classroom_proposal_atomic(
  p_teacher_id uuid,
  p_proposal_id uuid,
  p_classroom_plan jsonb,
  p_classroom_plan_sha256 text
)
returns public.course_blueprint_change_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.course_blueprint_change_proposals;
  v_classroom public.classrooms;
  v_item jsonb;
  v_child jsonb;
  v_parent_id uuid;
  v_existing_artifact_id uuid;
  v_logical_id uuid;
  v_has_runtime boolean;
  v_content_update boolean;
  v_rewrite_children boolean;
  v_result_revision bigint;
begin
  if jsonb_typeof(p_classroom_plan) is distinct from 'object'
    or p_classroom_plan_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid classroom Blueprint write plan'
      using errcode = '22023';
  end if;

  select *
  into v_proposal
  from public.course_blueprint_change_proposals
  where id = p_proposal_id
    and teacher_id = p_teacher_id
  for update;
  if not found then
    raise exception 'Classroom Blueprint proposal not found'
      using errcode = 'P0002';
  end if;
  if v_proposal.target_kind <> 'classroom'
    or v_proposal.target_classroom_id is null
  then
    raise exception 'Proposal does not target a classroom' using errcode = '22023';
  end if;
  if p_classroom_plan_sha256 is distinct from
    v_proposal.diff_json->>'classroom_plan_sha256'
  then
    raise exception 'Classroom write plan digest changed' using errcode = '22023';
  end if;
  if v_proposal.status = 'applied' then return v_proposal; end if;
  if v_proposal.status in ('rejected', 'conflicted') then
    raise exception 'Classroom proposal is not applicable' using errcode = '55000';
  end if;

  select *
  into v_classroom
  from public.classrooms
  where id = v_proposal.target_classroom_id
    and teacher_id = p_teacher_id
    and source_blueprint_id = v_proposal.course_blueprint_id
  for update;
  if not found then
    raise exception 'Target classroom not found' using errcode = 'P0002';
  end if;
  if v_classroom.blueprint_source_revision
    <> v_proposal.base_classroom_revision
  then
    update public.course_blueprint_change_proposals
    set status = 'stale', updated_at = now()
    where id = p_proposal_id
    returning * into v_proposal;
    return v_proposal;
  end if;
  if v_classroom.start_date::text
      is distinct from p_classroom_plan->'calendar_guard'->>'start_date'
    or coalesce(
      (
        select jsonb_agg(class_day.date::text order by class_day.date)
        from public.class_days class_day
        where class_day.classroom_id = v_classroom.id
      ),
      '[]'::jsonb
    ) is distinct from coalesce(
      p_classroom_plan->'calendar_guard'->'class_day_dates',
      '[]'::jsonb
    )
  then
    update public.course_blueprint_change_proposals
    set status = 'stale', updated_at = now()
    where id = p_proposal_id
    returning * into v_proposal;
    return v_proposal;
  end if;
  if not exists (
    select 1
    from public.course_blueprint_versions
    where id = v_proposal.base_blueprint_version_id
      and course_blueprint_id = v_proposal.course_blueprint_id
      and source_draft_revision = v_proposal.base_blueprint_revision
  ) then
    raise exception 'Proposal Blueprint Version is invalid' using errcode = '40001';
  end if;

  perform set_config('pika.identity_mapping', 'on', true);

  update public.classrooms
  set
    course_overview_markdown = coalesce(
      p_classroom_plan->'sections'->>'overview_markdown',
      ''
    ),
    course_outline_markdown = coalesce(
      p_classroom_plan->'sections'->>'outline_markdown',
      ''
    ),
    actual_site_config = coalesce(actual_site_config, '{}'::jsonb)
      || coalesce(
        p_classroom_plan->'site_visibility_defaults',
        '{}'::jsonb
      ),
    source_blueprint_version_id = v_proposal.base_blueprint_version_id,
    source_blueprint_origin = source_blueprint_origin || jsonb_build_object(
      'blueprint_version_id', v_proposal.base_blueprint_version_id,
      'updated_from_proposal_id', v_proposal.id
    ),
    blueprint_source_revision = blueprint_source_revision + 1
  where id = v_classroom.id
  returning blueprint_source_revision into v_result_revision;

  insert into public.classroom_resources (classroom_id, content)
  values (
    v_classroom.id,
    coalesce(
      p_classroom_plan->'resources_content',
      '{"type":"doc","content":[]}'::jsonb
    )
  )
  on conflict (classroom_id) do update
  set content = excluded.content;

  insert into public.gradebook_settings (
    classroom_id,
    use_weights,
    assignments_weight,
    tests_weight
  )
  values (
    v_classroom.id,
    coalesce((p_classroom_plan->'grading'->>'use_weights')::boolean, false),
    coalesce((p_classroom_plan->'grading'->>'assignments_weight')::smallint, 70),
    coalesce((p_classroom_plan->'grading'->>'tests_weight')::smallint, 30)
  )
  on conflict (classroom_id) do update set
    use_weights = excluded.use_weights,
    assignments_weight = excluded.assignments_weight,
    tests_weight = excluded.tests_weight;

  update public.assignments
  set blueprint_archived_at = now()
  where classroom_id = v_classroom.id
    and source_artifact_id is not null
    and blueprint_archived_at is null
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_classroom_plan->'assignments', '[]'::jsonb)
      ) candidate
      where (candidate->>'artifact_id')::uuid
        = assignments.source_artifact_id
    );

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_classroom_plan->'assignments', '[]'::jsonb))
  loop
    v_logical_id := (v_item->>'artifact_id')::uuid;
    v_parent_id := null;
    v_existing_artifact_id := null;
    v_rewrite_children := false;
    select id, artifact_id
    into v_parent_id, v_existing_artifact_id
    from public.assignments
    where classroom_id = v_classroom.id
      and source_artifact_id = v_logical_id
      and blueprint_archived_at is null
    for update;

    v_content_update := exists (
      select 1
      from jsonb_array_elements(v_proposal.operations_json) operation
      where operation->>'collection' = 'assignments'
        and operation->>'artifact_id' = v_logical_id::text
        and operation->>'action' = 'update'
    );
    v_has_runtime := v_parent_id is not null and exists (
      select 1 from public.assignment_docs
      where assignment_id = v_parent_id
    );

    if v_parent_id is not null and v_content_update and v_has_runtime then
      update public.assignments
      set blueprint_archived_at = now()
      where id = v_parent_id;
      v_parent_id := null;
      v_existing_artifact_id := gen_random_uuid();
    end if;

    if v_parent_id is null then
      v_rewrite_children := true;
      insert into public.assignments (
        classroom_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
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
        track_authenticity,
        created_by
      )
      values (
        v_classroom.id,
        coalesce(v_existing_artifact_id, v_logical_id),
        v_logical_id,
        v_proposal.base_blueprint_version_id,
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
        coalesce((v_item->>'track_authenticity')::boolean, false),
        p_teacher_id
      )
      returning id into v_parent_id;
    else
      v_rewrite_children := v_content_update;
      update public.assignments
      set
        source_blueprint_version_id = v_proposal.base_blueprint_version_id,
        title = v_item->>'title',
        instructions_markdown = coalesce(v_item->>'instructions_markdown', ''),
        description = coalesce(v_item->>'description', ''),
        rich_instructions = v_item->'rich_instructions',
        due_at = (v_item->>'due_at')::timestamptz,
        position = coalesce((v_item->>'position')::integer, 0),
        points_possible = coalesce((v_item->>'points_possible')::numeric, 30),
        gradebook_weight = coalesce((v_item->>'gradebook_weight')::integer, 10),
        include_in_final = coalesce((v_item->>'include_in_final')::boolean, true),
        track_authenticity = coalesce(
          (v_item->>'track_authenticity')::boolean,
          false
        )
      where id = v_parent_id;
      if v_rewrite_children then
        delete from public.assignment_submission_requirements
        where assignment_id = v_parent_id;
      else
        update public.assignment_submission_requirements
        set source_blueprint_version_id = v_proposal.base_blueprint_version_id
        where assignment_id = v_parent_id;
      end if;
    end if;

    if v_rewrite_children then
      for v_child in
        select value
        from jsonb_array_elements(
          coalesce(v_item->'submission_requirements', '[]'::jsonb)
        )
      loop
        insert into public.assignment_submission_requirements (
          assignment_id,
          artifact_id,
          source_artifact_id,
          source_blueprint_version_id,
          type,
          label,
          instructions,
          required,
          position,
          validation_policy_json
        )
        values (
          v_parent_id,
          (v_child->>'artifact_id')::uuid,
          (v_child->>'artifact_id')::uuid,
          v_proposal.base_blueprint_version_id,
          v_child->>'type',
          v_child->>'label',
          coalesce(v_child->>'instructions', ''),
          coalesce((v_child->>'required')::boolean, true),
          coalesce((v_child->>'position')::integer, 0),
          coalesce(v_child->'validation_policy_json', '{}'::jsonb)
        );
      end loop;
    end if;
  end loop;

  update public.tests
  set blueprint_archived_at = now()
  where classroom_id = v_classroom.id
    and source_artifact_id is not null
    and blueprint_archived_at is null
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_classroom_plan->'tests', '[]'::jsonb))
        candidate
      where (candidate->>'artifact_id')::uuid = tests.source_artifact_id
    );

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_classroom_plan->'tests', '[]'::jsonb))
  loop
    v_logical_id := (v_item->>'artifact_id')::uuid;
    v_parent_id := null;
    v_existing_artifact_id := null;
    v_rewrite_children := false;
    select id, artifact_id
    into v_parent_id, v_existing_artifact_id
    from public.tests
    where classroom_id = v_classroom.id
      and source_artifact_id = v_logical_id
      and blueprint_archived_at is null
    for update;
    v_content_update := exists (
      select 1
      from jsonb_array_elements(v_proposal.operations_json) operation
      where operation->>'collection' = 'assessments'
        and operation->>'artifact_id' = v_logical_id::text
        and operation->>'action' = 'update'
    );
    v_has_runtime := v_parent_id is not null and exists (
      select 1 from public.test_attempts where test_id = v_parent_id
    );
    if v_parent_id is not null and v_content_update and v_has_runtime then
      update public.tests set blueprint_archived_at = now() where id = v_parent_id;
      v_parent_id := null;
      v_existing_artifact_id := gen_random_uuid();
    end if;

    if v_parent_id is null then
      v_rewrite_children := true;
      insert into public.tests (
        classroom_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
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
        v_classroom.id,
        coalesce(v_existing_artifact_id, v_logical_id),
        v_logical_id,
        v_proposal.base_blueprint_version_id,
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
      returning id into v_parent_id;
    else
      v_rewrite_children := v_content_update;
      update public.tests
      set
        source_blueprint_version_id = v_proposal.base_blueprint_version_id,
        title = v_item->>'title',
        position = coalesce((v_item->>'position')::integer, 0),
        show_results = coalesce((v_item->>'show_results')::boolean, false),
        documents = coalesce(v_item->'documents', '[]'::jsonb),
        points_possible = coalesce((v_item->>'points_possible')::numeric, 100),
        gradebook_weight = coalesce((v_item->>'gradebook_weight')::integer, 10),
        include_in_final = coalesce((v_item->>'include_in_final')::boolean, true)
      where id = v_parent_id;
      if v_rewrite_children then
        delete from public.test_questions where test_id = v_parent_id;
      else
        update public.test_questions
        set source_blueprint_version_id = v_proposal.base_blueprint_version_id
        where test_id = v_parent_id;
      end if;
    end if;

    if v_rewrite_children then
      for v_child in
        select value
        from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
      loop
        insert into public.test_questions (
        test_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
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
        v_parent_id,
        (v_child->>'artifact_id')::uuid,
        (v_child->>'artifact_id')::uuid,
        v_proposal.base_blueprint_version_id,
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
      v_classroom.id,
      v_parent_id,
      coalesce(v_item->'draft_content', '{}'::jsonb),
      1,
      p_teacher_id,
      p_teacher_id
    )
      on conflict (assessment_type, assessment_id) do update
      set
        content = excluded.content,
        version = public.assessment_drafts.version + 1,
        updated_by = p_teacher_id;
    end if;
  end loop;

  update public.classwork_materials
  set blueprint_archived_at = now()
  where classroom_id = v_classroom.id
    and source_artifact_id is not null
    and blueprint_archived_at is null
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_classroom_plan->'materials', '[]'::jsonb)
      ) candidate
      where (candidate->>'artifact_id')::uuid
        = classwork_materials.source_artifact_id
    );
  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_classroom_plan->'materials', '[]'::jsonb))
  loop
    v_logical_id := (v_item->>'artifact_id')::uuid;
    insert into public.classwork_materials (
      classroom_id,
      artifact_id,
      source_artifact_id,
      source_blueprint_version_id,
      title,
      content,
      is_draft,
      released_at,
      position,
      created_by
    )
    values (
      v_classroom.id,
      v_logical_id,
      v_logical_id,
      v_proposal.base_blueprint_version_id,
      v_item->>'title',
      coalesce(v_item->'content', '{"type":"doc","content":[]}'::jsonb),
      true,
      null,
      coalesce((v_item->>'position')::integer, 0),
      p_teacher_id
    )
    on conflict (classroom_id, artifact_id) do update set
      source_blueprint_version_id = excluded.source_blueprint_version_id,
      title = excluded.title,
      content = excluded.content,
      position = excluded.position,
      blueprint_archived_at = null;
  end loop;

  update public.surveys
  set blueprint_archived_at = now()
  where classroom_id = v_classroom.id
    and source_artifact_id is not null
    and blueprint_archived_at is null
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_classroom_plan->'surveys', '[]'::jsonb))
        candidate
      where (candidate->>'artifact_id')::uuid = surveys.source_artifact_id
    );
  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_classroom_plan->'surveys', '[]'::jsonb))
  loop
    v_logical_id := (v_item->>'artifact_id')::uuid;
    v_parent_id := null;
    v_existing_artifact_id := null;
    v_rewrite_children := false;
    select id, artifact_id
    into v_parent_id, v_existing_artifact_id
    from public.surveys
    where classroom_id = v_classroom.id
      and source_artifact_id = v_logical_id
      and blueprint_archived_at is null
    for update;
    v_content_update := exists (
      select 1
      from jsonb_array_elements(v_proposal.operations_json) operation
      where operation->>'collection' = 'surveys'
        and operation->>'artifact_id' = v_logical_id::text
        and operation->>'action' = 'update'
    );
    v_has_runtime := v_parent_id is not null and exists (
      select 1 from public.survey_responses where survey_id = v_parent_id
    );
    if v_parent_id is not null and v_content_update and v_has_runtime then
      update public.surveys set blueprint_archived_at = now() where id = v_parent_id;
      v_parent_id := null;
      v_existing_artifact_id := gen_random_uuid();
    end if;
    if v_parent_id is null then
      v_rewrite_children := true;
      insert into public.surveys (
        classroom_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
        title,
        status,
        opens_at,
        show_results,
        dynamic_responses,
        position,
        created_by
      )
      values (
        v_classroom.id,
        coalesce(v_existing_artifact_id, v_logical_id),
        v_logical_id,
        v_proposal.base_blueprint_version_id,
        v_item->>'title',
        'draft',
        null,
        coalesce((v_item->>'show_results')::boolean, true),
        coalesce((v_item->>'dynamic_responses')::boolean, false),
        coalesce((v_item->>'position')::integer, 0),
        p_teacher_id
      )
      returning id into v_parent_id;
    else
      v_rewrite_children := v_content_update;
      update public.surveys
      set
        source_blueprint_version_id = v_proposal.base_blueprint_version_id,
        title = v_item->>'title',
        show_results = coalesce((v_item->>'show_results')::boolean, true),
        dynamic_responses = coalesce(
          (v_item->>'dynamic_responses')::boolean,
          false
        ),
        position = coalesce((v_item->>'position')::integer, 0)
      where id = v_parent_id;
      if v_rewrite_children then
        delete from public.survey_questions where survey_id = v_parent_id;
      else
        update public.survey_questions
        set source_blueprint_version_id = v_proposal.base_blueprint_version_id
        where survey_id = v_parent_id;
      end if;
    end if;
    if v_rewrite_children then
      for v_child in
        select value
        from jsonb_array_elements(coalesce(v_item->'questions', '[]'::jsonb))
      loop
        insert into public.survey_questions (
        survey_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
        question_type,
        question_text,
        options,
        response_max_chars,
        position
      )
      values (
        v_parent_id,
        (v_child->>'artifact_id')::uuid,
        (v_child->>'artifact_id')::uuid,
        v_proposal.base_blueprint_version_id,
        v_child->>'question_type',
        v_child->>'question_text',
        coalesce(v_child->'options', '[]'::jsonb),
        coalesce((v_child->>'response_max_chars')::integer, 500),
        coalesce((v_child->>'position')::integer, 0)
        );
      end loop;
    end if;
  end loop;

  update public.lesson_plans
  set blueprint_archived_at = now()
  where classroom_id = v_classroom.id
    and source_artifact_id is not null
    and blueprint_archived_at is null
    and not exists (
      select 1
      from jsonb_array_elements(
        coalesce(p_classroom_plan->'lesson_plans', '[]'::jsonb)
      ) candidate
      where (candidate->>'artifact_id')::uuid
        = lesson_plans.source_artifact_id
    );
  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_classroom_plan->'lesson_plans', '[]'::jsonb))
  loop
    v_logical_id := (v_item->>'artifact_id')::uuid;
    v_parent_id := null;
    select id into v_parent_id
    from public.lesson_plans
    where classroom_id = v_classroom.id
      and source_artifact_id = v_logical_id
      and blueprint_archived_at is null
    for update;
    if v_parent_id is null then
      select id into v_parent_id
      from public.lesson_plans
      where classroom_id = v_classroom.id
        and date = (v_item->>'date')::date
        and blueprint_archived_at is not null
      for update;
    end if;
    if v_parent_id is null then
      insert into public.lesson_plans (
        classroom_id,
        artifact_id,
        source_artifact_id,
        source_blueprint_version_id,
        date,
        content_markdown,
        content
      )
      values (
        v_classroom.id,
        v_logical_id,
        v_logical_id,
        v_proposal.base_blueprint_version_id,
        (v_item->>'date')::date,
        coalesce(v_item->>'content_markdown', ''),
        coalesce(v_item->'content', '{}'::jsonb)
      );
    else
      update public.lesson_plans
      set
        source_artifact_id = v_logical_id,
        source_blueprint_version_id = v_proposal.base_blueprint_version_id,
        blueprint_archived_at = null,
        date = (v_item->>'date')::date,
        content_markdown = coalesce(v_item->>'content_markdown', ''),
        content = coalesce(v_item->'content', '{}'::jsonb)
      where id = v_parent_id;
    end if;
  end loop;

  perform set_config('pika.identity_mapping', 'off', true);
  update public.course_blueprint_change_proposals
  set
    status = 'applied',
    applied_classroom_revision = v_result_revision,
    applied_at = now(),
    updated_at = now()
  where id = p_proposal_id
  returning * into v_proposal;
  return v_proposal;
end;
$$;

revoke all on function public.create_course_blueprint_proposal_atomic(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  uuid,
  uuid,
  bigint,
  jsonb,
  jsonb,
  text
) from public, anon, authenticated;
grant execute on function public.create_course_blueprint_proposal_atomic(
  uuid,
  uuid,
  uuid,
  text,
  bigint,
  uuid,
  uuid,
  bigint,
  jsonb,
  jsonb,
  text
) to service_role;

revoke all on function public.apply_course_blueprint_proposal_atomic(
  uuid,
  uuid,
  jsonb,
  text
) from public, anon, authenticated;
grant execute on function public.apply_course_blueprint_proposal_atomic(
  uuid,
  uuid,
  jsonb,
  text
) to service_role;

revoke all on function public.create_course_blueprint_classroom_proposal_atomic(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint,
  uuid,
  jsonb,
  jsonb,
  text
) from public, anon, authenticated;
grant execute on function public.create_course_blueprint_classroom_proposal_atomic(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint,
  uuid,
  jsonb,
  jsonb,
  text
) to service_role;

revoke all on function public.apply_course_blueprint_classroom_proposal_atomic(
  uuid,
  uuid,
  jsonb,
  text
) from public, anon, authenticated;
grant execute on function public.apply_course_blueprint_classroom_proposal_atomic(
  uuid,
  uuid,
  jsonb,
  text
) to service_role;
