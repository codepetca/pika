-- Maximum overrides stay with their assessment, so archive/restore and deletion
-- retain the existing resource ownership. Original scoring sources stay intact.
alter table public.assignments
  add column gradebook_maximum_override numeric,
  add column gradebook_score_scale numeric not null default 1,
  add constraint assignments_gradebook_maximum_valid check (gradebook_maximum_override is null or (gradebook_maximum_override between 0.1 and 999999.9 and gradebook_maximum_override = round(gradebook_maximum_override, 1))),
  add constraint assignments_gradebook_scale_valid check (gradebook_score_scale between 0.000000000001 and 1000000000000);
alter table public.tests
  add column gradebook_maximum_override numeric,
  add column gradebook_score_scale numeric not null default 1,
  add constraint tests_gradebook_maximum_valid check (gradebook_maximum_override is null or (gradebook_maximum_override between 0.1 and 999999.9 and gradebook_maximum_override = round(gradebook_maximum_override, 1))),
  add constraint tests_gradebook_scale_valid check (gradebook_score_scale between 0.000000000001 and 1000000000000);
alter table public.gradebook_items
  add column gradebook_maximum_override numeric,
  add column gradebook_score_scale numeric not null default 1,
  add constraint gradebook_items_maximum_valid check (gradebook_maximum_override is null or (gradebook_maximum_override between 0.1 and 999999.9 and gradebook_maximum_override = round(gradebook_maximum_override, 1))),
  add constraint gradebook_items_scale_valid check (gradebook_score_scale between 0.000000000001 and 1000000000000);
-- Normalize newly entered marks by the current scale without losing fractions.
alter table public.gradebook_score_overrides alter column earned type numeric;
alter table public.gradebook_item_scores alter column earned type numeric;

create function public.read_gradebook_maximum_state(p_classroom_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
 select coalesce(jsonb_agg(to_jsonb(state)), '[]'::jsonb) from (
  select 'assignment'::text assessment_type, id assessment_id, gradebook_maximum_override maximum, gradebook_score_scale score_scale from public.assignments where classroom_id = p_classroom_id
  union all select 'test', id, gradebook_maximum_override, gradebook_score_scale from public.tests where classroom_id = p_classroom_id
  union all select 'item', id, gradebook_maximum_override, gradebook_score_scale from public.gradebook_items where classroom_id = p_classroom_id
 ) state;
$$;
revoke all on function public.read_gradebook_maximum_state(uuid) from public, anon, authenticated;
grant execute on function public.read_gradebook_maximum_state(uuid) to service_role;

create function public.set_gradebook_maximum_override(
 p_teacher_id uuid, p_classroom_id uuid, p_assessment_type text, p_assessment_id uuid,
 p_maximum numeric, p_mode text, p_expected_maximum numeric, p_expected_scale numeric
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 v_classroom public.classrooms;
 v_source numeric; v_override numeric; v_scale numeric; v_current numeric;
begin
 select * into v_classroom from public.classrooms where id = p_classroom_id for update;
 if not found or v_classroom.teacher_id is distinct from p_teacher_id then
  raise exception using errcode='42501', message='gradebook_classroom_forbidden';
 end if;
 if v_classroom.archived_at is not null then raise exception using errcode='55000', message='gradebook_classroom_archived'; end if;
 if p_mode is null or p_mode not in ('keep_marks', 'preserve_percentages', 'reset') then
  raise exception using errcode='22023', message='invalid_maximum_mode';
 end if;
 if p_mode <> 'reset' and (p_maximum is null or not (p_maximum between 0.1 and 999999.9) or p_maximum <> round(p_maximum,1)) then
  raise exception using errcode='22023', message='invalid_maximum';
 end if;
 if p_assessment_type = 'assignment' then
  select points_possible,gradebook_maximum_override,gradebook_score_scale into v_source,v_override,v_scale from public.assignments where id=p_assessment_id and classroom_id=p_classroom_id for update;
 elsif p_assessment_type = 'test' then
  select gradebook_maximum_override,gradebook_score_scale into v_override,v_scale from public.tests where id=p_assessment_id and classroom_id=p_classroom_id for update;
  if found then select coalesce(sum(points),0) into v_source from public.test_questions where test_id=p_assessment_id; end if;
 elsif p_assessment_type = 'item' then
  select points_possible,gradebook_maximum_override,gradebook_score_scale into v_source,v_override,v_scale from public.gradebook_items where id=p_assessment_id and classroom_id=p_classroom_id for update;
 else raise exception using errcode='22023', message='invalid_assessment_type';
 end if;
 if v_scale is null then raise exception using errcode='P0002', message='assessment_not_found'; end if;
 v_current := coalesce(v_override,v_source);
 if v_current is distinct from p_expected_maximum or p_expected_scale is null or p_expected_scale <= 0
  or abs(v_scale-p_expected_scale) > greatest(abs(v_scale),abs(p_expected_scale))*0.000000000001 then
  raise exception using errcode='40001', message='maximum_changed_refresh';
 end if;
 if p_mode='reset' then p_maximum:=null; v_scale:=1;
 elsif p_mode='preserve_percentages' then
  if v_current <= 0 then raise exception using errcode='22023', message='cannot_preserve_percentage_without_maximum'; end if;
  v_scale:=v_scale*p_maximum/v_current;
 end if;
 if not (v_scale between 0.000000000001 and 1000000000000) then
  raise exception using errcode='22003', message='maximum_scale_out_of_range';
 end if;
 if p_assessment_type='assignment' then update public.assignments set gradebook_maximum_override=p_maximum,gradebook_score_scale=v_scale where id=p_assessment_id;
 elsif p_assessment_type='test' then update public.tests set gradebook_maximum_override=p_maximum,gradebook_score_scale=v_scale where id=p_assessment_id;
 else update public.gradebook_items set gradebook_maximum_override=p_maximum,gradebook_score_scale=v_scale where id=p_assessment_id; end if;
 return jsonb_build_object('saved',true);
end;
$$;
revoke all on function public.set_gradebook_maximum_override(uuid,uuid,text,uuid,numeric,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.set_gradebook_maximum_override(uuid,uuid,text,uuid,numeric,text,numeric,numeric) to service_role;

-- Record teacher-entered effective marks in the original assessment coordinate
-- system. The classroom lock serializes this with maximum changes and archiving.
create function public.save_gradebook_effective_mark(
 p_teacher_id uuid,p_classroom_id uuid,p_assessment_type text,p_assessment_id uuid,p_student_id uuid,p_earned numeric
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_classroom public.classrooms; v_scale numeric;
begin
 select * into v_classroom from public.classrooms where id=p_classroom_id for update;
 if not found or v_classroom.teacher_id is distinct from p_teacher_id then raise exception using errcode='42501',message='gradebook_classroom_forbidden'; end if;
 if v_classroom.archived_at is not null then raise exception using errcode='55000',message='gradebook_classroom_archived'; end if;
 if not exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id) then raise exception using errcode='P0002',message='student_not_enrolled'; end if;
 if p_earned is not null and (not (p_earned between 0 and 999999.9) or p_earned <> round(p_earned,1)) then raise exception using errcode='22023',message='invalid_mark'; end if;
 if p_assessment_type='assignment' then select gradebook_score_scale into v_scale from public.assignments where id=p_assessment_id and classroom_id=p_classroom_id;
 elsif p_assessment_type='test' then select gradebook_score_scale into v_scale from public.tests where id=p_assessment_id and classroom_id=p_classroom_id;
 elsif p_assessment_type='item' then select gradebook_score_scale into v_scale from public.gradebook_items where id=p_assessment_id and classroom_id=p_classroom_id;
 else raise exception using errcode='22023',message='invalid_assessment_type'; end if;
 if v_scale is null then raise exception using errcode='P0002',message='assessment_not_found'; end if;
 if p_assessment_type='item' then
  if p_earned is null then delete from public.gradebook_item_scores where item_id=p_assessment_id and student_id=p_student_id;
  else insert into public.gradebook_item_scores(classroom_id,item_id,student_id,earned) values(p_classroom_id,p_assessment_id,p_student_id,p_earned/v_scale)
   on conflict(item_id,student_id) do update set earned=excluded.earned,returned_at=case when gradebook_item_scores.earned is not distinct from excluded.earned then gradebook_item_scores.returned_at else null end;
  end if;
 else
  if p_earned is null then raise exception using errcode='22023',message='mark_required'; end if;
  insert into public.gradebook_score_overrides(classroom_id,student_id,assessment_type,assessment_id,earned,created_by) values(p_classroom_id,p_student_id,p_assessment_type,p_assessment_id,p_earned/v_scale,p_teacher_id)
   on conflict(classroom_id,student_id,assessment_type,assessment_id) do update set earned=excluded.earned,created_by=excluded.created_by;
 end if;
 return jsonb_build_object('saved',true);
end;
$$;
revoke all on function public.save_gradebook_effective_mark(uuid,uuid,text,uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.save_gradebook_effective_mark(uuid,uuid,text,uuid,uuid,numeric) to service_role;

-- Extend the existing restore compatibility chain for pre-209 cold archives.
alter function public.normalize_classroom_archive_restore_row(uuid,text,jsonb)
 rename to normalize_classroom_archive_restore_row_pre_v209;
revoke all on function public.normalize_classroom_archive_restore_row_pre_v209(uuid,text,jsonb) from public,anon,authenticated;
create function public.normalize_classroom_archive_restore_row(p_operation_id uuid,p_table_name text,p_row jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
 p_row := public.normalize_classroom_archive_restore_row_pre_v209(p_operation_id,p_table_name,p_row);
 if p_table_name in ('assignments','tests','gradebook_items') then
  if not (p_row ? 'gradebook_maximum_override') then p_row := p_row || jsonb_build_object('gradebook_maximum_override',null); end if;
  if not (p_row ? 'gradebook_score_scale') then p_row := p_row || jsonb_build_object('gradebook_score_scale',1); end if;
 end if;
 return p_row;
end;
$$;
revoke all on function public.normalize_classroom_archive_restore_row(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid,text,jsonb) to service_role;
