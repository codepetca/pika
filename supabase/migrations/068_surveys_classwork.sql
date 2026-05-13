-- Add ungraded classwork surveys.
-- Surveys live in the classwork stream beside assignments and materials, but
-- they do not create gradebook records or correctness data.

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  opens_at timestamptz,
  show_results boolean not null default true,
  dynamic_responses boolean not null default false,
  position integer not null,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_surveys_classroom_position
  on public.surveys (classroom_id, position, created_at);

create index if not exists idx_surveys_student_visible
  on public.surveys (classroom_id, status, opens_at);

create or replace function public.update_surveys_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_surveys_updated_at on public.surveys;
create trigger update_surveys_updated_at
  before update on public.surveys
  for each row
  execute function public.update_surveys_updated_at();

create table if not exists public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  question_type text not null default 'multiple_choice'
    check (question_type in ('multiple_choice', 'short_text', 'link')),
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  response_max_chars integer not null default 500
    check (response_max_chars >= 1 and response_max_chars <= 5000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (
      question_type = 'multiple_choice'
      and jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) >= 2
    )
    or (
      question_type in ('short_text', 'link')
      and jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) = 0
    )
  )
);

create index if not exists idx_survey_questions_survey_position
  on public.survey_questions (survey_id, position);

create or replace function public.update_survey_questions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_survey_questions_updated_at on public.survey_questions;
create trigger update_survey_questions_updated_at
  before update on public.survey_questions
  for each row
  execute function public.update_survey_questions_updated_at();

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  selected_option integer check (selected_option is null or selected_option >= 0),
  response_text text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, student_id),
  check (
    selected_option is not null
    or (response_text is not null and length(btrim(response_text)) > 0)
  )
);

create index if not exists idx_survey_responses_survey_student
  on public.survey_responses (survey_id, student_id);

create index if not exists idx_survey_responses_question
  on public.survey_responses (question_id);

create or replace function public.update_survey_responses_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_survey_responses_updated_at on public.survey_responses;
create trigger update_survey_responses_updated_at
  before update on public.survey_responses
  for each row
  execute function public.update_survey_responses_updated_at();

create or replace function public.set_survey_position()
returns trigger as $$
begin
  if new.position is null then
    select coalesce(max(existing.position), -1) + 1
    into new.position
    from (
      select position
      from public.assignments
      where classroom_id = new.classroom_id

      union all

      select position
      from public.classwork_materials
      where classroom_id = new.classroom_id

      union all

      select position
      from public.surveys
      where classroom_id = new.classroom_id
    ) existing;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists set_survey_position on public.surveys;
create trigger set_survey_position
  before insert on public.surveys
  for each row
  execute function public.set_survey_position();

create or replace function public.set_classwork_material_position()
returns trigger as $$
begin
  if new.position is null then
    select coalesce(max(existing.position), -1) + 1
    into new.position
    from (
      select position
      from public.assignments
      where classroom_id = new.classroom_id

      union all

      select position
      from public.classwork_materials
      where classroom_id = new.classroom_id

      union all

      select position
      from public.surveys
      where classroom_id = new.classroom_id
    ) existing;
  end if;

  return new;
end;
$$ language plpgsql;

create or replace function public.reorder_classwork_items(
  p_classroom_id uuid,
  p_items jsonb
)
returns void as $$
declare
  submitted_count integer;
  current_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;

  with submitted as (
    select
      (entry.ordinality - 1)::integer as position,
      entry.item->>'type' as item_type,
      entry.item->>'id' as item_id
    from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
  )
  select count(*) into submitted_count
  from submitted;

  if exists (
    with submitted as (
      select
        entry.item->>'type' as item_type,
        entry.item->>'id' as item_id
      from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
    )
    select 1
    from submitted
    where item_type not in ('assignment', 'material', 'survey')
      or item_id is null
      or item_id = ''
  ) then
    raise exception 'items must include type and id' using errcode = '22023';
  end if;

  if exists (
    with submitted as (
      select
        entry.item->>'type' as item_type,
        entry.item->>'id' as item_id
      from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
    )
    select 1
    from submitted
    group by item_type, item_id
    having count(*) > 1
  ) then
    raise exception 'items must be unique' using errcode = '22023';
  end if;

  with current_items as (
    select 'assignment'::text as item_type, assignment.id::text as item_id
    from public.assignments assignment
    where assignment.classroom_id = p_classroom_id

    union all

    select 'material'::text as item_type, material.id::text as item_id
    from public.classwork_materials material
    where material.classroom_id = p_classroom_id

    union all

    select 'survey'::text as item_type, survey.id::text as item_id
    from public.surveys survey
    where survey.classroom_id = p_classroom_id
  )
  select count(*) into current_count
  from current_items;

  if submitted_count <> current_count then
    raise exception 'Classwork list changed. Refresh and try again.' using errcode = 'P0001';
  end if;

  if exists (
    with submitted as (
      select
        entry.item->>'type' as item_type,
        entry.item->>'id' as item_id
      from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
    ),
    current_items as (
      select 'assignment'::text as item_type, assignment.id::text as item_id
      from public.assignments assignment
      where assignment.classroom_id = p_classroom_id

      union all

      select 'material'::text as item_type, material.id::text as item_id
      from public.classwork_materials material
      where material.classroom_id = p_classroom_id

      union all

      select 'survey'::text as item_type, survey.id::text as item_id
      from public.surveys survey
      where survey.classroom_id = p_classroom_id
    )
    select 1
    from submitted
    left join current_items using (item_type, item_id)
    where current_items.item_id is null
  ) then
    raise exception 'One or more classwork items not found in classroom' using errcode = 'P0001';
  end if;

  if exists (
    with submitted as (
      select
        entry.item->>'type' as item_type,
        entry.item->>'id' as item_id
      from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
    ),
    current_items as (
      select 'assignment'::text as item_type, assignment.id::text as item_id
      from public.assignments assignment
      where assignment.classroom_id = p_classroom_id

      union all

      select 'material'::text as item_type, material.id::text as item_id
      from public.classwork_materials material
      where material.classroom_id = p_classroom_id

      union all

      select 'survey'::text as item_type, survey.id::text as item_id
      from public.surveys survey
      where survey.classroom_id = p_classroom_id
    )
    select 1
    from current_items
    left join submitted using (item_type, item_id)
    where submitted.item_id is null
  ) then
    raise exception 'Classwork list changed. Refresh and try again.' using errcode = 'P0001';
  end if;

  with submitted as (
    select
      (entry.ordinality - 1)::integer as position,
      entry.item->>'type' as item_type,
      entry.item->>'id' as item_id
    from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
  )
  update public.assignments assignment
  set position = submitted.position
  from submitted
  where submitted.item_type = 'assignment'
    and assignment.classroom_id = p_classroom_id
    and assignment.id::text = submitted.item_id;

  with submitted as (
    select
      (entry.ordinality - 1)::integer as position,
      entry.item->>'type' as item_type,
      entry.item->>'id' as item_id
    from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
  )
  update public.classwork_materials material
  set position = submitted.position
  from submitted
  where submitted.item_type = 'material'
    and material.classroom_id = p_classroom_id
    and material.id::text = submitted.item_id;

  with submitted as (
    select
      (entry.ordinality - 1)::integer as position,
      entry.item->>'type' as item_type,
      entry.item->>'id' as item_id
    from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
  )
  update public.surveys survey
  set position = submitted.position
  from submitted
  where submitted.item_type = 'survey'
    and survey.classroom_id = p_classroom_id
    and survey.id::text = submitted.item_id;
end;
$$ language plpgsql;

revoke all on function public.reorder_classwork_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reorder_classwork_items(uuid, jsonb) to service_role;

alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_responses enable row level security;

drop policy if exists "Teachers can manage surveys" on public.surveys;
create policy "Teachers can manage surveys"
  on public.surveys for all
  using (
    exists (
      select 1
      from public.classrooms
      where classrooms.id = surveys.classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.classrooms
      where classrooms.id = surveys.classroom_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view open or answered surveys" on public.surveys;
create policy "Students can view open or answered surveys"
  on public.surveys for select
  using (
    exists (
      select 1
      from public.classroom_enrollments
      where classroom_enrollments.classroom_id = surveys.classroom_id
        and classroom_enrollments.student_id = auth.uid()
    )
    and (
      status = 'active'
      or exists (
        select 1
        from public.survey_responses
        where survey_responses.survey_id = surveys.id
          and survey_responses.student_id = auth.uid()
      )
    )
  );

drop policy if exists "Teachers can manage survey questions" on public.survey_questions;
create policy "Teachers can manage survey questions"
  on public.survey_questions for all
  using (
    exists (
      select 1
      from public.surveys
      join public.classrooms on classrooms.id = surveys.classroom_id
      where surveys.id = survey_questions.survey_id
        and classrooms.teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.surveys
      join public.classrooms on classrooms.id = surveys.classroom_id
      where surveys.id = survey_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view survey questions" on public.survey_questions;
create policy "Students can view survey questions"
  on public.survey_questions for select
  using (
    exists (
      select 1
      from public.surveys
      join public.classroom_enrollments on classroom_enrollments.classroom_id = surveys.classroom_id
      where surveys.id = survey_questions.survey_id
        and classroom_enrollments.student_id = auth.uid()
        and (
          surveys.status = 'active'
          or exists (
            select 1
            from public.survey_responses
            where survey_responses.survey_id = surveys.id
              and survey_responses.student_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "Teachers can view survey responses" on public.survey_responses;
create policy "Teachers can view survey responses"
  on public.survey_responses for select
  using (
    exists (
      select 1
      from public.surveys
      join public.classrooms on classrooms.id = surveys.classroom_id
      where surveys.id = survey_responses.survey_id
        and classrooms.teacher_id = auth.uid()
    )
  );

drop policy if exists "Students can view their own survey responses" on public.survey_responses;
create policy "Students can view their own survey responses"
  on public.survey_responses for select
  using (student_id = auth.uid());

drop policy if exists "Students can create survey responses" on public.survey_responses;
create policy "Students can create survey responses"
  on public.survey_responses for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1
      from public.surveys
      join public.classroom_enrollments on classroom_enrollments.classroom_id = surveys.classroom_id
      where surveys.id = survey_id
        and classroom_enrollments.student_id = auth.uid()
        and surveys.status = 'active'
    )
  );

drop policy if exists "Students can update dynamic survey responses" on public.survey_responses;
create policy "Students can update dynamic survey responses"
  on public.survey_responses for update
  using (
    student_id = auth.uid()
    and exists (
      select 1
      from public.surveys
      where surveys.id = survey_responses.survey_id
        and surveys.status = 'active'
        and surveys.dynamic_responses
    )
  )
  with check (
    student_id = auth.uid()
    and exists (
      select 1
      from public.surveys
      where surveys.id = survey_id
        and surveys.status = 'active'
        and surveys.dynamic_responses
    )
  );
