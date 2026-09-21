-- Allow an exact current Assignment owner to return feedback without relying on
-- the account's global role. The public wrappers remain service-role only.

begin;

create or replace function public.return_assignment_feedback_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_feedback text,
  p_expected_doc_updated_at timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_archived_at timestamptz;
  v_assignment_classroom_id uuid;
  v_blueprint_archived_at timestamptz;
  v_initial_classroom_id uuid;
  v_owner_id uuid;
begin
  if p_actor_id is null or p_assignment_id is null or p_student_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment feedback return request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select assignment.classroom_id into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    p_student_id
  );

  select assignment.classroom_id, assignment.blueprint_archived_at,
    classroom.teacher_id, classroom.archived_at
  into v_assignment_classroom_id, v_blueprint_archived_at, v_owner_id, v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found or v_assignment_classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null or v_blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_feedback_return_archived';
  end if;

  return public.return_assignment_feedback_atomic(
    p_assignment_id,
    p_student_id,
    p_actor_id,
    p_feedback,
    p_expected_doc_updated_at,
    p_now
  );
end;
$function$;

create or replace function public.return_assignment_docs_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_archived_at timestamptz;
  v_assignment_classroom_id uuid;
  v_blueprint_archived_at timestamptz;
  v_initial_classroom_id uuid;
  v_owner_id uuid;
  v_student_id uuid;
begin
  if p_actor_id is null or p_assignment_id is null
    or cardinality(coalesce(p_student_ids, array[]::uuid[])) = 0
    or exists (select 1 from unnest(p_student_ids) as requested(student_id) where student_id is null)
  then
    raise exception using errcode = '22023', message = 'Invalid assignment return request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  select assignment.classroom_id into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  for v_student_id in
    select distinct requested.student_id
    from unnest(p_student_ids) as requested(student_id)
    order by requested.student_id
  loop
    perform private.try_lock_classroom_membership_change(
      v_initial_classroom_id,
      v_student_id
    );
  end loop;

  select assignment.classroom_id, assignment.blueprint_archived_at,
    classroom.teacher_id, classroom.archived_at
  into v_assignment_classroom_id, v_blueprint_archived_at, v_owner_id, v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found or v_assignment_classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null or v_blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_feedback_return_archived';
  end if;

  return public.return_assignment_docs_with_feedback_atomic(
    p_assignment_id,
    p_student_ids,
    p_actor_id,
    p_now
  );
end;
$function$;

revoke all on function public.return_assignment_feedback_for_owner_v1(
  uuid, uuid, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.return_assignment_feedback_for_owner_v1(
  uuid, uuid, uuid, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.return_assignment_docs_for_owner_v1(
  uuid, uuid, uuid[], timestamptz
) from public, anon, authenticated;
grant execute on function public.return_assignment_docs_for_owner_v1(
  uuid, uuid, uuid[], timestamptz
) to service_role;

comment on function public.return_assignment_feedback_for_owner_v1(
  uuid, uuid, uuid, text, timestamptz, timestamptz
) is 'Fences owner and learner lifecycle before one feedback-only return.';
comment on function public.return_assignment_docs_for_owner_v1(
  uuid, uuid, uuid[], timestamptz
) is 'Fences owner and learner lifecycle before one selected-student return.';

commit;
