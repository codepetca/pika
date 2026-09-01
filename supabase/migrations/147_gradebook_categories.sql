-- Teacher-defined gradebook categories with per-category course percentages.
-- Assessment weights remain relative within a category; deleting a category
-- intentionally leaves its assignments and tests uncategorized.

create table public.gradebook_categories (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  percentage numeric(5,2) not null check (percentage >= 0 and percentage <= 100),
  default_assessment_weight integer not null default 10
    check (default_assessment_weight between 1 and 999),
  position integer not null default 0 check (position >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, classroom_id)
);

create unique index gradebook_categories_classroom_name_unique
  on public.gradebook_categories (classroom_id, lower(btrim(name)));

create unique index gradebook_categories_one_default_per_classroom
  on public.gradebook_categories (classroom_id)
  where is_default;

create index gradebook_categories_classroom_position_idx
  on public.gradebook_categories (classroom_id, position, id);

alter table public.assignments
  add column gradebook_category_id uuid references public.gradebook_categories (id) on delete set null;

alter table public.tests
  add column gradebook_category_id uuid references public.gradebook_categories (id) on delete set null;

-- Zero is an insert-only sentinel that lets the trigger distinguish an omitted
-- weight from an explicitly supplied valid weight. The trigger replaces it
-- before constraints are checked, so stored rows remain in the 1-999 range.
alter table public.assignments alter column gradebook_weight set default 0;
alter table public.tests alter column gradebook_weight set default 0;

create index assignments_gradebook_category_id_idx
  on public.assignments (gradebook_category_id);

create index tests_gradebook_category_id_idx
  on public.tests (gradebook_category_id);

create or replace function public.set_gradebook_category_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_gradebook_category_updated_at
  before update on public.gradebook_categories
  for each row execute function public.set_gradebook_category_updated_at();

insert into public.gradebook_categories (
  classroom_id,
  name,
  percentage,
  default_assessment_weight,
  position,
  is_default
)
select
  classrooms.id,
  defaults.name,
  defaults.percentage,
  10,
  defaults.position,
  defaults.name = 'Term'
from public.classrooms
cross join (
  values
    ('Attendance'::text, 10::numeric, 0),
    ('Term'::text, 65::numeric, 1),
    ('Final'::text, 25::numeric, 2)
) as defaults(name, percentage, position);

create or replace function public.create_default_gradebook_categories()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Current-format restores stage category rows before inserting the classroom.
  -- Let those archived rows restore with their stable IDs instead of creating
  -- conflicting random defaults. Legacy archives have no staged category rows
  -- and safely receive the standard defaults.
  if current_setting('pika.classroom_archive_restore', true) = 'on'
    and exists (
      select 1
      from public.classroom_archive_restore_staging as staged
      where staged.table_name = 'gradebook_categories'
        and staged.row_data->>'classroom_id' = new.id::text
    )
  then
    return new;
  end if;

  insert into public.gradebook_categories (
    classroom_id,
    name,
    percentage,
    default_assessment_weight,
    position,
    is_default
  ) values
    (new.id, 'Attendance', 10, 10, 0, false),
    (new.id, 'Term', 65, 10, 1, true),
    (new.id, 'Final', 25, 10, 2, false);
  return new;
end;
$$;

create trigger create_default_gradebook_categories
  after insert on public.classrooms
  for each row execute function public.create_default_gradebook_categories();

update public.assignments as assignments
set gradebook_category_id = categories.id
from public.gradebook_categories as categories
where categories.classroom_id = assignments.classroom_id
  and categories.is_default;

update public.tests as tests
set gradebook_category_id = categories.id
from public.gradebook_categories as categories
where categories.classroom_id = tests.classroom_id
  and categories.is_default;

create or replace function public.assign_default_gradebook_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.gradebook_category_id is null then
    select categories.id
    into new.gradebook_category_id
    from public.gradebook_categories as categories
    where categories.classroom_id = new.classroom_id
    order by categories.is_default desc, categories.position, categories.id
    limit 1;
  end if;

  if tg_op = 'INSERT' and new.gradebook_weight = 0 then
    select categories.default_assessment_weight
    into new.gradebook_weight
    from public.gradebook_categories as categories
    where categories.id = new.gradebook_category_id;
  end if;

  if new.gradebook_category_id is not null and not exists (
    select 1
    from public.gradebook_categories as categories
    where categories.id = new.gradebook_category_id
      and categories.classroom_id = new.classroom_id
  ) then
    raise exception 'gradebook category must belong to the assessment classroom';
  end if;

  return new;
end;
$$;

create trigger assign_assignment_default_gradebook_category
  before insert or update of gradebook_category_id, classroom_id on public.assignments
  for each row execute function public.assign_default_gradebook_category();

create trigger assign_test_default_gradebook_category
  before insert or update of gradebook_category_id, classroom_id on public.tests
  for each row execute function public.assign_default_gradebook_category();

create or replace function public.replace_gradebook_categories(
  p_classroom_id uuid,
  p_categories jsonb
)
returns setof public.gradebook_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  category_count integer;
  default_count integer;
  percentage_total numeric;
begin
  if jsonb_typeof(p_categories) <> 'array' then
    raise exception 'categories must be an array';
  end if;

  category_count := jsonb_array_length(p_categories);
  if category_count < 1 or category_count > 20 then
    raise exception 'gradebook must have between 1 and 20 categories';
  end if;

  select
    count(*) filter (where coalesce((category.value->>'is_default')::boolean, false)),
    coalesce(sum((category.value->>'percentage')::numeric), 0)
  into default_count, percentage_total
  from jsonb_array_elements(p_categories) as category(value);

  if default_count <> 1 then
    raise exception 'gradebook must have exactly one default category';
  end if;

  if percentage_total <> 100 then
    raise exception 'gradebook category percentages must total 100';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_categories) as category(value)
    group by lower(btrim(category.value->>'name'))
    having count(*) > 1
  ) then
    raise exception 'gradebook category names must be unique';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_categories) as category(value)
    group by category.value->>'id'
    having count(*) > 1
  ) then
    raise exception 'gradebook category ids must be unique';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_categories) as category(value)
    where nullif(category.value->>'id', '') is null
      or char_length(btrim(coalesce(category.value->>'name', ''))) not between 1 and 80
      or starts_with(lower(btrim(category.value->>'name')), '__pika_replacing__')
      or (category.value->>'percentage')::numeric not between 0 and 100
      or scale((category.value->>'percentage')::numeric) > 2
      or (category.value->>'default_assessment_weight')::integer not between 1 and 999
      or (category.value->>'position')::integer < 0
  ) then
    raise exception 'invalid gradebook category';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_categories) as category(value)
    join public.gradebook_categories as existing
      on existing.id = (category.value->>'id')::uuid
    where existing.classroom_id <> p_classroom_id
  ) then
    raise exception 'gradebook category belongs to another classroom';
  end if;

  perform 1
  from public.gradebook_categories
  where classroom_id = p_classroom_id
  for update;

  update public.gradebook_categories
  set
    is_default = false,
    name = '__pika_replacing__' || replace(id::text, '-', '')
  where classroom_id = p_classroom_id;

  delete from public.gradebook_categories as existing
  where existing.classroom_id = p_classroom_id
    and not exists (
      select 1
      from jsonb_array_elements(p_categories) as category(value)
      where (category.value->>'id')::uuid = existing.id
    );

  insert into public.gradebook_categories (
    id,
    classroom_id,
    name,
    percentage,
    default_assessment_weight,
    position,
    is_default
  )
  select
    (category.value->>'id')::uuid,
    p_classroom_id,
    btrim(category.value->>'name'),
    (category.value->>'percentage')::numeric,
    (category.value->>'default_assessment_weight')::integer,
    (category.value->>'position')::integer,
    (category.value->>'is_default')::boolean
  from jsonb_array_elements(p_categories) as category(value)
  on conflict (id) do update set
    name = excluded.name,
    percentage = excluded.percentage,
    default_assessment_weight = excluded.default_assessment_weight,
    position = excluded.position,
    is_default = excluded.is_default;

  return query
  select categories.*
  from public.gradebook_categories as categories
  where categories.classroom_id = p_classroom_id
  order by categories.position, categories.id;
end;
$$;

-- Gradebook categories are portable classroom state. Extend the active v2
-- resource contract additively; legacy v2 archives are restored with an empty
-- category resource and the defaults above.
update public.classroom_archive_resource_contract_versions
set export_position = export_position + 1000
where format_version = 2;

update public.classroom_archive_resource_contract_versions
set export_position = case
  when export_position >= 1003 then export_position - 999
  else export_position - 1000
end
where format_version = 2;

insert into public.classroom_archive_resource_contract_versions (
  format_version,
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
) values (
  2,
  'gradebook_categories',
  array['id'],
  'classrooms',
  'classroom_id',
  array[]::text[],
  array['classrooms'],
  3
);

update public.classroom_archive_resource_contract_versions
set restore_after = array_append(restore_after, 'gradebook_categories')
where format_version = 2
  and table_name in ('assignments', 'tests')
  and not restore_after @> array['gradebook_categories'];

update public.classroom_archive_resource_contract
set export_position = export_position + 1000;

update public.classroom_archive_resource_contract
set export_position = case
  when export_position >= 1003 then export_position - 999
  else export_position - 1000
end;

insert into public.classroom_archive_resource_contract (
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
) values (
  'gradebook_categories',
  array['id'],
  'classrooms',
  'classroom_id',
  array[]::text[],
  array['classrooms'],
  3
);

update public.classroom_archive_resource_contract
set restore_after = array_append(restore_after, 'gradebook_categories')
where table_name in ('assignments', 'tests')
  and not restore_after @> array['gradebook_categories'];

create trigger car_gradebook_categories
  before insert or delete or update on public.gradebook_categories
  for each row execute function public.bump_classroom_archive_revision_from_resource(
    'classrooms',
    'classroom_id'
  );

create trigger classroom_purge_fence_gradebook_categories
  before insert or delete or update on public.gradebook_categories
  for each row execute function public.reject_classroom_resource_change_during_purge(
    'classrooms',
    'classroom_id'
  );

alter function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  rename to normalize_classroom_archive_restore_row_v143;

revoke all on function public.normalize_classroom_archive_restore_row_v143(uuid, text, jsonb)
  from public, anon, authenticated;

create function public.normalize_classroom_archive_restore_row(
  p_operation_id uuid,
  p_table_name text,
  p_row jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  p_row := public.normalize_classroom_archive_restore_row_v143(
    p_operation_id,
    p_table_name,
    p_row
  );

  if p_table_name in ('assignments', 'tests')
    and not (p_row ? 'gradebook_category_id')
  then
    p_row := p_row || jsonb_build_object('gradebook_category_id', null);
  end if;

  return p_row;
end;
$$;

revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  to service_role;

alter table public.gradebook_categories enable row level security;

create policy "No direct access to gradebook_categories"
  on public.gradebook_categories
  for all
  using (false)
  with check (false);

revoke all on table public.gradebook_categories from anon, authenticated;
revoke all on function public.replace_gradebook_categories(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_gradebook_categories(uuid, jsonb) to service_role;

comment on table public.gradebook_categories is
  'Teacher-defined gradebook categories whose percentages total 100 per classroom.';

comment on column public.gradebook_categories.default_assessment_weight is
  'Default relative weight assigned to new assessments in this category.';

comment on column public.assignments.gradebook_category_id is
  'Nullable category membership; null is intentionally displayed as Uncategorized.';

comment on column public.tests.gradebook_category_id is
  'Nullable category membership; null is intentionally displayed as Uncategorized.';
