-- Dormant shared-admission date writer. The application authenticates the actor;
-- this service-only transaction rechecks the current owner and archive state.
create function public.save_lesson_plan_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_content_markdown text,
  p_content jsonb,
  p_delete boolean,
  p_client_id uuid default null,
  p_sequence bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_ordered_result jsonb;
  v_applied boolean := true;
  v_plan public.lesson_plans%rowtype;
  v_plan_json jsonb;
begin
  if p_actor_id is null or p_classroom_id is null or p_date is null
    or not isfinite(p_date)
    or p_date < date '0001-01-01' or p_date > date '9999-12-31'
    or p_content_markdown is null or p_content is null or p_delete is null
    or pg_catalog.jsonb_typeof(p_content) is distinct from 'object'
    or p_content->>'type' is distinct from 'doc'
    or pg_catalog.jsonb_typeof(p_content->'content') is distinct from 'array'
    or (p_client_id is null) <> (p_sequence is null)
    or p_sequence < 1 or p_sequence > 9007199254740991
  then
    raise exception using errcode = '22023', message = 'Invalid lesson-plan save request';
  end if;

  begin
    -- Match the classroom lifecycle operation protocol before inspecting rows.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'pika-classroom-operation:' || p_classroom_id::text, 0
    ));
    perform public.guard_classroom_purge_lifecycle(p_classroom_id);

    select classroom.teacher_id, classroom.archived_at
    into v_teacher_id, v_archived_at
    from public.classrooms as classroom
    where classroom.id = p_classroom_id
    for update nowait;
    if not found then
      raise exception using errcode = 'P0002', message = 'Classroom not found';
    end if;
    if v_teacher_id is distinct from p_actor_id or v_archived_at is not null then
      raise exception using errcode = '42501', message = 'Forbidden';
    end if;

    -- Legacy writers can hold either row before reaching their trigger fences.
    -- Lock in head-then-plan order, and fail promptly rather than form a cycle.
    if p_client_id is not null then
      perform 1 from public.lesson_plan_mutation_heads as head
      where head.classroom_id = p_classroom_id and head.date = p_date
        and head.client_id = p_client_id
      for update nowait;
    end if;
    select * into v_plan from public.lesson_plans as plan
    where plan.classroom_id = p_classroom_id and plan.date = p_date
    for update nowait;

    if p_client_id is not null then
      v_ordered_result := public.apply_ordered_lesson_plan_mutation(
        p_classroom_id, p_date, p_content_markdown, p_content,
        p_delete, p_client_id, p_sequence
      );
      if pg_catalog.jsonb_typeof(v_ordered_result) is distinct from 'object'
        or pg_catalog.jsonb_typeof(v_ordered_result->'applied') is distinct from 'boolean'
      then
        raise exception using errcode = 'PT409', message = 'Lesson-plan result changed';
      end if;
      v_applied := (v_ordered_result->>'applied')::boolean;
    elsif p_delete then
      delete from public.lesson_plans as plan
      where plan.classroom_id = p_classroom_id and plan.date = p_date;
    else
      insert into public.lesson_plans (
        classroom_id, date, content_markdown, content, updated_at
      ) values (
        p_classroom_id, p_date, p_content_markdown, p_content, pg_catalog.now()
      )
      on conflict (classroom_id, date) do update
      set content_markdown = excluded.content_markdown,
          content = excluded.content,
          updated_at = excluded.updated_at;
    end if;

    select * into v_plan from public.lesson_plans as plan
    where plan.classroom_id = p_classroom_id and plan.date = p_date;
    if found then
      if v_plan.classroom_id is distinct from p_classroom_id
        or v_plan.date is distinct from p_date
        or v_plan.id is null or v_plan.artifact_id is null
        or pg_catalog.jsonb_typeof(v_plan.content) is distinct from 'object'
        or v_plan.content->>'type' is distinct from 'doc'
      then
        raise exception using errcode = 'PT409', message = 'Lesson-plan binding changed';
      end if;
      v_plan_json := pg_catalog.jsonb_build_object(
        'id', v_plan.id,
        'classroom_id', v_plan.classroom_id,
        'date', v_plan.date,
        'content', v_plan.content,
        'content_markdown', v_plan.content_markdown,
        'artifact_id', v_plan.artifact_id,
        'source_artifact_id', v_plan.source_artifact_id,
        'source_blueprint_version_id', v_plan.source_blueprint_version_id,
        'blueprint_archived_at', v_plan.blueprint_archived_at,
        'created_at', v_plan.created_at,
        'updated_at', v_plan.updated_at
      );
    else
      v_plan_json := 'null'::jsonb;
    end if;
    if v_applied and (
      (p_delete and v_plan_json <> 'null'::jsonb)
      or (not p_delete and v_plan_json = 'null'::jsonb)
    ) then
      raise exception using errcode = 'PT409', message = 'Lesson-plan result changed';
    end if;
    return pg_catalog.jsonb_build_object('applied', v_applied, 'lesson_plan', v_plan_json);
  exception
    when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03'
      or sqlstate '55000' then
      raise exception using errcode = 'PT409', message = 'Lesson-plan operation busy';
  end;
end;
$function$;

revoke all on function public.save_lesson_plan_for_owner_v1(
  uuid, uuid, date, text, jsonb, boolean, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.save_lesson_plan_for_owner_v1(
  uuid, uuid, date, text, jsonb, boolean, uuid, bigint
) to service_role;
comment on function public.save_lesson_plan_for_owner_v1(
  uuid, uuid, date, text, jsonb, boolean, uuid, bigint
) is 'Dormant actor-bound single-date lesson-plan save with current owner and archive fencing.';
