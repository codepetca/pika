-- Persist the student Grades navigation/disclosure control off by default.
-- Apply only with approval naming this file and target.

alter table public.classrooms
  alter column feature_visibility set default '{
    "attendance": true,
    "classwork": true,
    "tests": true,
    "gradebook": true,
    "student_grades": false,
    "calendar": true,
    "syllabus": true,
    "announcements": true,
    "achievements": true
  }'::jsonb;

alter table public.classrooms
  drop constraint classrooms_feature_visibility_shape_check;

update public.classrooms
set feature_visibility = jsonb_set(
  feature_visibility,
  '{student_grades}',
  case
    when jsonb_typeof(feature_visibility -> 'student_grades') = 'boolean'
      then feature_visibility -> 'student_grades'
    else 'false'::jsonb
  end,
  true
);

alter table public.classrooms
  add constraint classrooms_feature_visibility_shape_check
  check (
    jsonb_typeof(feature_visibility) = 'object'
    and jsonb_typeof(feature_visibility -> 'attendance') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'classwork') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'tests') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'gradebook') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'student_grades') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'calendar') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'syllabus') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'announcements') = 'boolean'
    and jsonb_typeof(feature_visibility -> 'achievements') = 'boolean'
  );

comment on column public.classrooms.feature_visibility is
  'Classroom-scoped navigation and student Grades disclosure preferences. Hidden features preserve their content.';

-- Cold archives can contain the pre-201 visibility object. Extend the current
-- adapter chain so every later compatibility layer remains active.
alter function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  rename to normalize_classroom_archive_restore_row_pre_v201;

revoke all on function public.normalize_classroom_archive_restore_row_pre_v201(uuid, text, jsonb)
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
  p_row := public.normalize_classroom_archive_restore_row_pre_v201(
    p_operation_id,
    p_table_name,
    p_row
  );

  if p_table_name = 'classrooms' then
    p_row := jsonb_set(
      p_row,
      '{feature_visibility,student_grades}',
      case
        when jsonb_typeof(p_row -> 'feature_visibility' -> 'student_grades') = 'boolean'
          then p_row -> 'feature_visibility' -> 'student_grades'
        else 'false'::jsonb
      end,
      true
    );
  end if;

  return p_row;
end;
$$;

revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  to service_role;
