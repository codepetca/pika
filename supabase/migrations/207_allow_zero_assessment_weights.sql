-- A zero assessment weight excludes that assessment from final-grade calculations.
-- A -1 default keeps inserts optional in generated types. The before-insert
-- trigger replaces it with the category default; explicit zero is preserved.
alter table public.assignments alter column gradebook_weight set default -1;
alter table public.tests alter column gradebook_weight set default -1;

alter table public.assignments
  drop constraint if exists assignments_gradebook_weight_check,
  add constraint assignments_gradebook_weight_range_check
    check (gradebook_weight between 0 and 999);

alter table public.tests
  drop constraint if exists tests_gradebook_weight_check,
  add constraint tests_gradebook_weight_range_check
    check (gradebook_weight between 0 and 999);

alter table public.course_blueprint_assignments
  drop constraint if exists course_blueprint_assignments_gradebook_weight_check,
  add constraint course_blueprint_assignments_gradebook_weight_range_check
    check (gradebook_weight between 0 and 999);

alter table public.course_blueprint_assessments
  drop constraint if exists course_blueprint_assessments_gradebook_weight_check,
  add constraint course_blueprint_assessments_gradebook_weight_range_check
    check (gradebook_weight between 0 and 999);

alter table public.gradebook_items
  drop constraint if exists gradebook_items_gradebook_weight_check,
  add constraint gradebook_items_gradebook_weight_range_check
    check (gradebook_weight between 0 and 999);

-- Omitted weights inherit the category default; an explicit zero is retained.
create or replace function public.assign_default_gradebook_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
    and new.gradebook_category_id is null
    and not (
      current_setting('pika.classroom_archive_restore', true) = 'on'
      and exists (
        select 1
        from public.classroom_archive_restore_staging as staged
        where staged.table_name = 'gradebook_categories'
          and staged.row_data->>'classroom_id' = new.classroom_id::text
      )
    )
  then
    select categories.id
    into new.gradebook_category_id
    from public.gradebook_categories as categories
    where categories.classroom_id = new.classroom_id
    order by categories.is_default desc, categories.position, categories.id
    limit 1;
  end if;

  if tg_op = 'INSERT' and new.gradebook_weight = -1 then
    select coalesce(categories.default_assessment_weight, 10)
    into new.gradebook_weight
    from public.gradebook_categories as categories
    where categories.id = new.gradebook_category_id;
    new.gradebook_weight := coalesce(new.gradebook_weight, 10);
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

-- Keep standalone item mutations aligned with the column constraint.
create or replace function public.mutate_gradebook_item(
  p_teacher_id uuid, p_classroom_id uuid, p_action text, p_item_id uuid default null,
  p_title text default null, p_points_possible numeric default null,
  p_gradebook_category_id uuid default null, p_gradebook_weight integer default null,
  p_include_in_final boolean default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_classroom public.classrooms;
  v_item public.gradebook_items;
  v_returned integer;
begin
  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  if not found or v_classroom.teacher_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'gradebook_classroom_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '55000', message = 'gradebook_classroom_archived';
  end if;
  if p_action is null or p_action not in ('create','update','weight','delete','return_marks') then
    raise exception using errcode = '22023', message = 'invalid_gradebook_item_action';
  end if;
  if p_action in ('create','update') and (
    p_title is null or char_length(btrim(p_title)) not between 1 and 200
    or p_points_possible is null or p_points_possible <= 0 or p_points_possible > 999999.9
    or scale(p_points_possible) > 1 or p_include_in_final is null
  ) then raise exception using errcode = '22023', message = 'invalid_gradebook_item'; end if;
  if p_action in ('create','update','weight') and (p_gradebook_weight is null or p_gradebook_weight not between 0 and 999) then
    raise exception using errcode = '22023', message = 'invalid_gradebook_item_weight';
  end if;
  if p_action = 'create' then
    insert into public.gradebook_items(id,classroom_id,title,points_possible,gradebook_category_id,gradebook_weight,include_in_final,created_by)
    values(coalesce(p_item_id,gen_random_uuid()),p_classroom_id,btrim(p_title),p_points_possible,p_gradebook_category_id,p_gradebook_weight,p_include_in_final,p_teacher_id)
    on conflict (id) do nothing returning * into v_item;
    if not found then
      select * into v_item from public.gradebook_items where id = p_item_id;
      if v_item.classroom_id is distinct from p_classroom_id or v_item.created_by is distinct from p_teacher_id
        or v_item.title is distinct from btrim(p_title) or v_item.points_possible is distinct from p_points_possible
        or v_item.gradebook_category_id is distinct from p_gradebook_category_id
        or v_item.gradebook_weight is distinct from p_gradebook_weight
        or v_item.include_in_final is distinct from p_include_in_final then
        raise exception using errcode = '23505', message = 'gradebook_item_create_conflict';
      end if;
    end if;
    return jsonb_build_object('ok',true,'item',to_jsonb(v_item));
  end if;
  select * into v_item from public.gradebook_items where id = p_item_id and classroom_id = p_classroom_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'gradebook_item_not_found'; end if;
  if p_action = 'delete' then
    delete from public.gradebook_items where id = p_item_id;
    return jsonb_build_object('ok',true,'deleted',true);
  elsif p_action = 'return_marks' then
    update public.gradebook_item_scores set returned_at = now()
    where item_id = p_item_id and returned_at is null;
    get diagnostics v_returned = row_count;
    return jsonb_build_object('ok',true,'returned_count',v_returned);
  elsif p_action = 'weight' then
    if v_item.gradebook_weight is distinct from p_gradebook_weight then
      update public.gradebook_items set gradebook_weight = p_gradebook_weight where id = p_item_id returning * into v_item;
    end if;
  elsif p_action = 'update' then
    if row(v_item.title,v_item.points_possible,v_item.gradebook_category_id,v_item.gradebook_weight,v_item.include_in_final)
      is distinct from row(btrim(p_title),p_points_possible,p_gradebook_category_id,p_gradebook_weight,p_include_in_final) then
      update public.gradebook_items set title=btrim(p_title),points_possible=p_points_possible,
        gradebook_category_id=p_gradebook_category_id,gradebook_weight=p_gradebook_weight,include_in_final=p_include_in_final
      where id = p_item_id returning * into v_item;
    end if;
  end if;
  return jsonb_build_object('ok',true,'item',to_jsonb(v_item));
end;
$$;
