-- A tenant-link recovery supersedes every unresolved message from the previous
-- entitlement epoch. Include that epoch in the internal source documents so
-- the next preparation advances both source revisions and produces fresh
-- idempotency keys that Bara can accept as strictly newer snapshots.
-- This field is Pika-internal and is not included in outbound contract payloads.

create or replace function public.attendance_roster_source_document_v1(p_classroom_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', classroom.title,
    'owner_principal_ref', owner_principal.principal_ref,
    'entitlement_revision', coalesce(entitlement.revision, 0),
    'enrolled_student_ids', coalesce((
      select jsonb_agg(enrollment.student_id order by enrollment.student_id)
      from public.classroom_enrollments enrollment
      where enrollment.classroom_id = classroom.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', mapping.student_id,
        'participant_ref', mapping.participant_ref,
        'active', exists (
          select 1 from public.classroom_enrollments enrollment
          where enrollment.classroom_id = mapping.classroom_id
            and enrollment.student_id = mapping.student_id
        ),
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'principal_ref', student_principal.principal_ref
      ) order by mapping.student_id)
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      left join public.attendance_principal_mappings student_principal
        on student_principal.user_id = student_user.id
      where mapping.classroom_id = classroom.id
    ), '[]'::jsonb)
  )
  from public.classrooms classroom
  join public.users owner_user on owner_user.id = classroom.teacher_id
  join public.attendance_principal_mappings owner_principal
    on owner_principal.user_id = owner_user.id
  left join public.attendance_teacher_entitlements entitlement
    on entitlement.teacher_id = classroom.teacher_id
  where classroom.id = p_classroom_id;
$$;

create or replace function public.attendance_schedule_source_document_v1(
  p_classroom_id uuid,
  p_window_start date,
  p_window_end date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', classroom.title,
    'window_start', p_window_start,
    'window_end', p_window_end,
    'entitlement_revision', coalesce(entitlement.revision, 0),
    'policy', jsonb_build_object(
      'timezone', policy.timezone,
      'session_starts_local', to_char(policy.opens_local, 'HH24:MI'),
      'session_ends_local', to_char(policy.closes_local, 'HH24:MI'),
      'session_end_day_offset', policy.close_day_offset,
      'entry_opens_minutes_before', policy.entry_opens_minutes_before,
      'present_grace_minutes', policy.present_grace_minutes,
      'entry_closes_minutes_before_end', policy.entry_closes_minutes_before_end,
      'absent_minutes_before_end', policy.absent_minutes_before_end,
      'enabled', policy.enabled,
      'policy_revision', policy.policy_revision
    ),
    'class_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', class_day.date,
        'is_class_day', class_day.is_class_day
      ) order by class_day.date)
      from public.class_days class_day
      where class_day.classroom_id = classroom.id
        and class_day.date between p_window_start and p_window_end
    ), '[]'::jsonb)
  )
  from public.classrooms classroom
  join public.attendance_window_policies policy on policy.classroom_id = classroom.id
  left join public.attendance_teacher_entitlements entitlement
    on entitlement.teacher_id = classroom.teacher_id
  where classroom.id = p_classroom_id;
$$;

revoke all on function public.attendance_roster_source_document_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.attendance_schedule_source_document_v1(uuid, date, date)
  from public, anon, authenticated, service_role;
