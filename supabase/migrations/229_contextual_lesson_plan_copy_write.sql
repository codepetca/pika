-- Dormant admitted-owner copy writer. One RPC call atomically fences the
-- classroom, reads a valid source, and changes only the target's content.
create function public.copy_lesson_plan_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_from_date date,
  p_to_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_source public.lesson_plans%rowtype;
  v_target public.lesson_plans%rowtype;
  v_content_valid boolean;
begin
  if p_actor_id is null or p_classroom_id is null
    or p_from_date is null or p_to_date is null
    or not pg_catalog.isfinite(p_from_date) or not pg_catalog.isfinite(p_to_date)
    or p_from_date < date '0001-01-01' or p_from_date > date '9999-12-31'
    or p_to_date < date '0001-01-01' or p_to_date > date '9999-12-31'
    or p_from_date = p_to_date
  then
    raise exception using errcode = '22023', message = 'Invalid lesson-plan copy request';
  end if;

  begin
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

    -- Legacy writers can already hold either plan. Lock both existing rows
    -- in date order and fail promptly on contention rather than form a cycle.
    perform 1 from public.lesson_plans as plan
    where plan.classroom_id = p_classroom_id
      and plan.date in (p_from_date, p_to_date)
    order by plan.date
    for update nowait;
    select * into v_source from public.lesson_plans as plan
    where plan.classroom_id = p_classroom_id and plan.date = p_from_date;
    if not found then
      raise exception using errcode = 'PT404', message = 'Source lesson plan not found';
    end if;

    -- A legacy row may predate current content validation. Reject it before
    -- writing: the app's strict response decoder must never discover invalid
    -- copied content after the transaction has committed. Root content may be
    -- absent, just as in isValidTiptapContent. PostgreSQL octet_length is a
    -- conservative UTF-16 bound for type/text: UTF-8 bytes are never fewer
    -- than JS string code units, so some valid non-ASCII extremes can fail.
    if pg_catalog.jsonb_typeof(v_source.content) is distinct from 'object'
      or v_source.content->>'type' is distinct from 'doc'
      or (v_source.content ? 'content'
        and pg_catalog.jsonb_typeof(v_source.content->'content') is distinct from 'array')
    then
      raise exception using errcode = 'PT503', message = 'Source lesson-plan content unavailable';
    end if;
    with recursive content_nodes(node, depth) as (
      select item.value, 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(v_source.content->'content') = 'array'
          then v_source.content->'content' else '[]'::jsonb end
      ) as item(value)
      union all
      select child.value, parent.depth + 1
      from content_nodes as parent
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(parent.node->'content') = 'array'
          then parent.node->'content' else '[]'::jsonb end
      ) as child(value)
      where parent.depth < 101
    )
    select pg_catalog.count(*) <= 10000
      and coalesce(pg_catalog.bool_and(bounded_nodes.node_valid), true)
    into v_content_valid
    from (
      select coalesce(depth <= 100
      and pg_catalog.jsonb_typeof(node) = 'object'
      and pg_catalog.jsonb_typeof(node->'type') = 'string'
      and pg_catalog.octet_length(node->>'type') between 1 and 100
      and (not (node ? 'text') or (
        pg_catalog.jsonb_typeof(node->'text') = 'string'
        and pg_catalog.octet_length(node->>'text') <= 1000000
      ))
      and (not (node ? 'attrs') or pg_catalog.jsonb_typeof(node->'attrs') = 'object')
      and (not (node ? 'content') or (
        pg_catalog.jsonb_typeof(node->'content') = 'array'
        and pg_catalog.jsonb_array_length(
          case when pg_catalog.jsonb_typeof(node->'content') = 'array'
            then node->'content' else '[]'::jsonb end
        ) <= 10000
      ))
      and (not (node ? 'marks') or (
        pg_catalog.jsonb_typeof(node->'marks') = 'array'
        and pg_catalog.jsonb_array_length(
          case when pg_catalog.jsonb_typeof(node->'marks') = 'array'
            then node->'marks' else '[]'::jsonb end
        ) <= 100
        and not exists (
          select 1 from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(node->'marks') = 'array'
              then node->'marks' else '[]'::jsonb end
          ) as mark(value)
          where pg_catalog.jsonb_typeof(mark.value) is distinct from 'object'
            or pg_catalog.jsonb_typeof(mark.value->'type') is distinct from 'string'
            or pg_catalog.octet_length(mark.value->>'type') = 0
            or (mark.value ? 'attrs'
              and pg_catalog.jsonb_typeof(mark.value->'attrs') is distinct from 'object')
        )
      )), false) as node_valid
      from content_nodes
      limit 10001
    ) as bounded_nodes;
    if not v_content_valid then
      raise exception using errcode = 'PT503', message = 'Source lesson-plan content unavailable';
    end if;

    insert into public.lesson_plans (
      classroom_id, date, content, content_markdown, updated_at
    ) values (
      p_classroom_id, p_to_date, v_source.content,
      v_source.content_markdown, pg_catalog.now()
    )
    on conflict (classroom_id, date) do update
    set content = excluded.content,
        content_markdown = excluded.content_markdown,
        updated_at = excluded.updated_at;

    select * into v_target from public.lesson_plans as plan
    where plan.classroom_id = p_classroom_id and plan.date = p_to_date;
    if not found or v_target.id is null or v_target.artifact_id is null
      or v_target.classroom_id is distinct from p_classroom_id
      or v_target.date is distinct from p_to_date
    then
      raise exception using errcode = 'PT409', message = 'Lesson-plan copy binding changed';
    end if;
    return pg_catalog.jsonb_build_object('lesson_plan', pg_catalog.jsonb_build_object(
      'id', v_target.id,
      'classroom_id', v_target.classroom_id,
      'date', v_target.date,
      'content', v_target.content,
      'content_markdown', v_target.content_markdown,
      'artifact_id', v_target.artifact_id,
      'source_artifact_id', v_target.source_artifact_id,
      'source_blueprint_version_id', v_target.source_blueprint_version_id,
      'blueprint_archived_at', v_target.blueprint_archived_at,
      'created_at', v_target.created_at,
      'updated_at', v_target.updated_at
    ));
  exception
    when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03'
      or sqlstate '55000' then
      raise exception using errcode = 'PT409', message = 'Lesson-plan operation busy';
  end;
end;
$function$;

revoke all on function public.copy_lesson_plan_for_owner_v1(
  uuid, uuid, date, date
) from public, anon, authenticated;
grant execute on function public.copy_lesson_plan_for_owner_v1(
  uuid, uuid, date, date
) to service_role;
comment on function public.copy_lesson_plan_for_owner_v1(
  uuid, uuid, date, date
) is 'Dormant actor-bound atomic same-classroom lesson-plan copy with current owner and archive fencing.';
