-- Original teacher-entered marks, independent of assignment/test/final overrides.
create table public.gradebook_items (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  points_possible numeric not null check (points_possible > 0 and points_possible <= 999999.9 and scale(points_possible) <= 1),
  gradebook_category_id uuid references public.gradebook_categories(id) on delete set null,
  gradebook_weight integer not null default 10 check (gradebook_weight between 1 and 999),
  include_in_final boolean not null default true,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, classroom_id)
);
create index gradebook_items_classroom_idx on public.gradebook_items(classroom_id, created_at, id);
create index gradebook_items_category_idx on public.gradebook_items(gradebook_category_id);
create table public.gradebook_item_scores (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  item_id uuid not null,
  student_id uuid not null references public.users(id) on delete cascade,
  earned numeric(8,1) not null check (earned >= 0),
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, student_id),
  foreign key (item_id, classroom_id) references public.gradebook_items(id, classroom_id) on delete cascade,
  foreign key (classroom_id, student_id) references public.classroom_enrollments(classroom_id, student_id)
    on delete no action deferrable initially deferred
);
create index gradebook_item_scores_classroom_student_idx on public.gradebook_item_scores(classroom_id, student_id);

create function public.guard_gradebook_item_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.classroom_id is distinct from old.classroom_id or new.id is distinct from old.id
    or new.created_by is distinct from old.created_by then
    raise exception using errcode = '55000', message = 'gradebook_item_identity_immutable';
  end if;
  -- Own retraction at the row boundary: FK-driven category removal and any
  -- future item writer must follow the same disclosure contract as the RPC.
  -- Maintenance must preserve the archived returned-score snapshot exactly.
  if public.is_classroom_archive_maintenance_mode('restore') is not true
    and public.is_classroom_archive_maintenance_mode('compaction') is not true
    and row(new.title,new.points_possible,new.gradebook_category_id,new.gradebook_weight,new.include_in_final)
      is distinct from row(old.title,old.points_possible,old.gradebook_category_id,old.gradebook_weight,old.include_in_final)
  then
    update public.gradebook_item_scores set returned_at=null
    where item_id=old.id and returned_at is not null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger guard_gradebook_item_identity before update on public.gradebook_items
  for each row execute function public.guard_gradebook_item_identity();
-- Validate category ownership without silently assigning a default to intentionally uncategorized items.
create function public.validate_gradebook_item_category()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.gradebook_category_id is not null and not exists (
    select 1 from public.gradebook_categories where id = new.gradebook_category_id and classroom_id = new.classroom_id
  ) then raise exception using errcode = '22023', message = 'gradebook_category_classroom_mismatch'; end if;
  return new;
end;
$$;
create trigger validate_gradebook_item_category before insert or update on public.gradebook_items
  for each row execute function public.validate_gradebook_item_category();

create function public.guard_gradebook_item_score()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.gradebook_item_scores;
begin
  if current_setting('pika.student_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' then
    if new.classroom_id is distinct from old.classroom_id or new.student_id is distinct from old.student_id
      or new.item_id is distinct from old.item_id or new.id is distinct from old.id then
      raise exception using errcode = '55000', message = 'gradebook_item_score_identity_immutable';
    end if;
    new.updated_at := now();
    if new.earned is distinct from old.earned then new.returned_at := null; end if;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  perform public.student_purge_lock(v_row.classroom_id, v_row.student_id);
  if exists (select 1 from public.student_purge_fences
    where classroom_id = v_row.classroom_id and student_id = v_row.student_id) then
    raise exception using errcode = '55000', message = 'student_purge_active';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger student_purge_guard_gradebook_item_scores before insert or update or delete on public.gradebook_item_scores
  for each row execute function public.guard_gradebook_item_score();

-- Every public write locks the classroom before reading authorization/archive state.
-- Archive, classroom deletion and roster removal share this serialization point.
create function public.mutate_gradebook_item(
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
  if p_action in ('create','update','weight') and (p_gradebook_weight is null or p_gradebook_weight not between 1 and 999) then
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

create function public.set_gradebook_item_score(
  p_teacher_id uuid,p_classroom_id uuid,p_item_id uuid,p_student_id uuid,p_earned numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_classroom public.classrooms; v_score public.gradebook_item_scores;
begin
  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  if not found or v_classroom.teacher_id is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'gradebook_classroom_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '55000', message = 'gradebook_classroom_archived';
  end if;
  perform 1 from public.gradebook_items where id = p_item_id and classroom_id = p_classroom_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'gradebook_item_not_found'; end if;
  perform public.student_purge_lock(p_classroom_id,p_student_id);
  if not exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id) then
    raise exception using errcode = '22023', message = 'gradebook_student_not_enrolled';
  end if;
  if p_earned is null then
    delete from public.gradebook_item_scores where item_id=p_item_id and student_id=p_student_id;
    return jsonb_build_object('ok',true,'score',null);
  end if;
  if p_earned < 0 or p_earned > 999999.9 or scale(p_earned) > 1 then
    raise exception using errcode = '22023', message = 'invalid_gradebook_item_score';
  end if;
  insert into public.gradebook_item_scores(classroom_id,item_id,student_id,earned)
  values(p_classroom_id,p_item_id,p_student_id,p_earned)
  on conflict(item_id,student_id) do update set earned=excluded.earned,returned_at=null
  returning * into v_score;
  return jsonb_build_object('ok',true,'score',to_jsonb(v_score));
end;
$$;

-- V1 is immutable. Extend both the live and version-2 inventory after enrollment.
do $$
declare v_catalog text; v_position integer;
begin
  foreach v_catalog in array array['classroom_archive_resource_contract','classroom_archive_resource_contract_versions'] loop
    execute format('select export_position from public.%I where table_name = ''gradebook_score_overrides'' %s',v_catalog,
      case when v_catalog like '%versions' then 'and format_version = 2' else '' end) into strict v_position;
    execute format('update public.%I set export_position=export_position+1000 where export_position>$1 %s',v_catalog,
      case when v_catalog like '%versions' then 'and format_version = 2' else '' end) using v_position;
    execute format('update public.%I set export_position=export_position-998 where export_position>$1+1000 %s',v_catalog,
      case when v_catalog like '%versions' then 'and format_version = 2' else '' end) using v_position;
    execute format('insert into public.%I (%s table_name,primary_key_columns,parent_table,parent_column,actor_columns,restore_after,export_position)
      values (%s ''gradebook_items'',array[''id''],''classrooms'',''classroom_id'',array[''created_by''],array[''classrooms'',''gradebook_categories''],$1+1),
             (%s ''gradebook_item_scores'',array[''id''],''classrooms'',''classroom_id'',array[''student_id''],array[''classrooms'',''classroom_enrollments'',''gradebook_items''],$1+2)',
      v_catalog,case when v_catalog like '%versions' then 'format_version,' else '' end,
      case when v_catalog like '%versions' then '2,' else '' end,
      case when v_catalog like '%versions' then '2,' else '' end) using v_position;
  end loop;
end;
$$;
create trigger car_gradebook_items before insert or update or delete on public.gradebook_items
  for each row execute function public.bump_classroom_archive_revision_from_resource('classrooms','classroom_id');
create trigger car_gradebook_item_scores before insert or update or delete on public.gradebook_item_scores
  for each row execute function public.bump_classroom_archive_revision_from_resource('classrooms','classroom_id');
create trigger classroom_purge_fence_gradebook_items before insert or update or delete on public.gradebook_items
  for each row execute function public.reject_classroom_resource_change_during_purge('classrooms','classroom_id');
create trigger classroom_purge_fence_gradebook_item_scores before insert or update or delete on public.gradebook_item_scores
  for each row execute function public.reject_classroom_resource_change_during_purge('classrooms','classroom_id');

alter function public.student_purge_inventory_resources(uuid,uuid) rename to student_purge_inventory_resources_pre_v161;
alter function public.student_purge_inventory_resources_pre_v161(uuid,uuid) set schema private;
revoke all on function private.student_purge_inventory_resources_pre_v161(uuid,uuid) from public,anon,authenticated,service_role;
create function public.student_purge_inventory_resources(p_classroom_id uuid,p_student_id uuid)
returns table(table_name text,row_id uuid,disposition text) language sql stable set search_path = '' as $$
  select * from private.student_purge_inventory_resources_pre_v161(p_classroom_id,p_student_id)
  union all select 'gradebook_item_scores',id,'delete' from public.gradebook_item_scores
  where classroom_id=p_classroom_id and student_id=p_student_id
$$;
revoke all on function public.student_purge_inventory_resources(uuid,uuid) from public,anon,authenticated,service_role;

-- Deferred enrollment FK allows the existing roster finalizer to own enrollment order.
alter function public.remove_classroom_roster_entries_atomic(uuid,uuid[]) rename to remove_classroom_roster_entries_pre_v161;
alter function public.remove_classroom_roster_entries_pre_v161(uuid,uuid[]) set schema private;
revoke all on function private.remove_classroom_roster_entries_pre_v161(uuid,uuid[]) from public,anon,authenticated,service_role;
create function public.remove_classroom_roster_entries_atomic(p_classroom_id uuid,p_roster_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_deleted integer;
begin
  perform 1 from public.classrooms where id=p_classroom_id for update;
  v_result := private.remove_classroom_roster_entries_pre_v161(p_classroom_id,p_roster_ids);
  delete from public.gradebook_item_scores score where score.classroom_id=p_classroom_id
    and not exists(select 1 from public.classroom_enrollments enrollment
      where enrollment.classroom_id=score.classroom_id and enrollment.student_id=score.student_id);
  get diagnostics v_deleted = row_count;
  return v_result || jsonb_build_object('deleted_gradebook_item_scores',v_deleted);
end;
$$;
revoke all on function public.remove_classroom_roster_entries_atomic(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.remove_classroom_roster_entries_atomic(uuid,uuid[]) to service_role;

alter table public.gradebook_items enable row level security;
alter table public.gradebook_item_scores enable row level security;
revoke all on public.gradebook_items,public.gradebook_item_scores from public,anon,authenticated;
grant select,insert,update,delete on public.gradebook_items,public.gradebook_item_scores to service_role;
revoke all on function public.guard_gradebook_item_identity(),public.validate_gradebook_item_category(),public.guard_gradebook_item_score() from public,anon,authenticated,service_role;
revoke all on function public.mutate_gradebook_item(uuid,uuid,text,uuid,text,numeric,uuid,integer,boolean),public.set_gradebook_item_score(uuid,uuid,uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.mutate_gradebook_item(uuid,uuid,text,uuid,text,numeric,uuid,integer,boolean),public.set_gradebook_item_score(uuid,uuid,uuid,uuid,numeric) to service_role;
comment on table public.gradebook_items is 'Standalone Gradebook columns; never create Classwork assignments or Tests.';
comment on table public.gradebook_item_scores is 'Original teacher marks. Blank marks have no row; student disclosure requires returned_at.';
