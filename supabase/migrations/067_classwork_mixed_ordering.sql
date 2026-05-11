-- Add ordering for ungraded classwork materials so assignments and materials
-- can share one classroom classwork stream.

alter table public.classwork_materials
  add column if not exists position integer;

with material_positions as (
  select
    material.id,
    coalesce(
      (
        select max(assignment.position) + 1
        from public.assignments assignment
        where assignment.classroom_id = material.classroom_id
      ),
      0
    )
    + row_number() over (
      partition by material.classroom_id
      order by material.created_at asc, material.id asc
    )
    - 1 as position
  from public.classwork_materials material
  where material.position is null
)
update public.classwork_materials material
set position = material_positions.position
from material_positions
where material.id = material_positions.id;

alter table public.classwork_materials
  alter column position set not null;

create index if not exists idx_classwork_materials_classroom_position
  on public.classwork_materials (classroom_id, position, created_at);

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
    ) existing;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists set_classwork_material_position on public.classwork_materials;
create trigger set_classwork_material_position
  before insert on public.classwork_materials
  for each row
  execute function public.set_classwork_material_position();

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
    where item_type not in ('assignment', 'material')
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
end;
$$ language plpgsql;

revoke all on function public.reorder_classwork_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reorder_classwork_items(uuid, jsonb) to service_role;

create or replace function public.reorder_assignments_preserve_materials(
  p_classroom_id uuid,
  p_assignment_ids jsonb
)
returns void as $$
declare
  submitted_count integer;
  current_count integer;
  next_position integer := 0;
  submitted_assignment record;
begin
  if p_assignment_ids is null or jsonb_typeof(p_assignment_ids) <> 'array' then
    raise exception 'assignment_ids must be an array' using errcode = '22023';
  end if;

  with submitted as (
    select
      (entry.ordinality - 1)::integer as submitted_position,
      entry.value #>> '{}' as assignment_id,
      jsonb_typeof(entry.value) as value_type
    from jsonb_array_elements(p_assignment_ids) with ordinality as entry(value, ordinality)
  )
  select count(*) into submitted_count
  from submitted;

  if exists (
    with submitted as (
      select
        entry.value #>> '{}' as assignment_id,
        jsonb_typeof(entry.value) as value_type
      from jsonb_array_elements(p_assignment_ids) with ordinality as entry(value, ordinality)
    )
    select 1
    from submitted
    where value_type <> 'string'
      or assignment_id is null
      or assignment_id = ''
  ) then
    raise exception 'assignment_ids must include strings' using errcode = '22023';
  end if;

  if exists (
    with submitted as (
      select entry.value #>> '{}' as assignment_id
      from jsonb_array_elements(p_assignment_ids) with ordinality as entry(value, ordinality)
    )
    select 1
    from submitted
    group by assignment_id
    having count(*) > 1
  ) then
    raise exception 'assignment_ids must be unique' using errcode = '22023';
  end if;

  select count(*) into current_count
  from public.assignments assignment
  where assignment.classroom_id = p_classroom_id;

  if submitted_count <> current_count then
    raise exception 'Assignment list changed. Refresh and try again.' using errcode = 'P0001';
  end if;

  if exists (
    with submitted as (
      select entry.value #>> '{}' as assignment_id
      from jsonb_array_elements(p_assignment_ids) with ordinality as entry(value, ordinality)
    )
    select 1
    from submitted
    where not exists (
      select 1
      from public.assignments assignment
      where assignment.classroom_id = p_classroom_id
        and assignment.id::text = submitted.assignment_id
    )
  ) then
    raise exception 'One or more assignments not found in classroom' using errcode = 'P0001';
  end if;

  if exists (
    with submitted as (
      select entry.value #>> '{}' as assignment_id
      from jsonb_array_elements(p_assignment_ids) with ordinality as entry(value, ordinality)
    )
    select 1
    from public.assignments assignment
    where assignment.classroom_id = p_classroom_id
      and not exists (
        select 1
        from submitted
        where submitted.assignment_id = assignment.id::text
      )
  ) then
    raise exception 'Assignment list changed. Refresh and try again.' using errcode = 'P0001';
  end if;

  for submitted_assignment in
    select
      entry.value #>> '{}' as assignment_id
    from jsonb_array_elements(p_assignment_ids) with ordinality as entry(value, ordinality)
    order by entry.ordinality
  loop
    while exists (
      select 1
      from public.classwork_materials material
      where material.classroom_id = p_classroom_id
        and material.position = next_position
    ) loop
      next_position := next_position + 1;
    end loop;

    update public.assignments assignment
    set position = next_position
    where assignment.classroom_id = p_classroom_id
      and assignment.id::text = submitted_assignment.assignment_id;

    next_position := next_position + 1;
  end loop;
end;
$$ language plpgsql;

revoke all on function public.reorder_assignments_preserve_materials(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reorder_assignments_preserve_materials(uuid, jsonb) to service_role;
