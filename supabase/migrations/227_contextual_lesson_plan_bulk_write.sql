-- Dormant admitted-owner bulk writer. One PostgREST call is one transaction:
-- an error on any date rolls back every earlier plan, head, and lineage change.
create function public.save_lesson_plans_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_plans jsonb,
  p_cleared_dates date[],
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
  v_dates date[] := array[]::date[];
  v_entry jsonb;
  v_date date;
  v_date_text text;
  v_result jsonb;
  v_row jsonb;
  v_save_results jsonb := '[]'::jsonb;
  v_clear_results jsonb := '[]'::jsonb;
  v_empty_doc jsonb := '{"type":"doc","content":[]}'::jsonb;
begin
  if p_actor_id is null or p_classroom_id is null
    or p_plans is null or pg_catalog.jsonb_typeof(p_plans) is distinct from 'array'
    or p_cleared_dates is null
    or (p_client_id is null) <> (p_sequence is null)
    or p_sequence < 1 or p_sequence > 9007199254740991
  then
    raise exception using errcode = '22023', message = 'Invalid lesson-plan bulk request';
  end if;
  if pg_catalog.jsonb_array_length(p_plans) > 250
    or pg_catalog.cardinality(p_cleared_dates) > 250
    or (pg_catalog.cardinality(p_cleared_dates) > 0
      and pg_catalog.array_ndims(p_cleared_dates) <> 1)
    or pg_catalog.jsonb_array_length(p_plans) + pg_catalog.cardinality(p_cleared_dates) = 0
  then
    raise exception using errcode = '22023', message = 'Invalid lesson-plan bulk size';
  end if;

  -- Reject every malformed or overlapping date before any lock or mutation.
  for v_entry in select value from pg_catalog.jsonb_array_elements(p_plans) loop
    if pg_catalog.jsonb_typeof(v_entry) is distinct from 'object'
      or not (v_entry ? 'date' and v_entry ? 'content_markdown' and v_entry ? 'content')
      or v_entry - 'date' - 'content_markdown' - 'content' <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_entry->'date') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_entry->'content_markdown') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_entry->'content') is distinct from 'object'
      or v_entry->'content'->>'type' is distinct from 'doc'
      or pg_catalog.jsonb_typeof(v_entry->'content'->'content') is distinct from 'array'
    then
      raise exception using errcode = '22023', message = 'Invalid lesson-plan bulk entry';
    end if;
    v_date_text := v_entry->>'date';
    if v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = '22023', message = 'Invalid lesson-plan bulk date';
    end if;
    begin
      v_date := v_date_text::date;
    exception when sqlstate '22007' or sqlstate '22008' then
      raise exception using errcode = '22023', message = 'Invalid lesson-plan bulk date';
    end;
    if not pg_catalog.isfinite(v_date)
      or v_date < date '0001-01-01' or v_date > date '9999-12-31'
      or pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> v_date_text
      or v_date = any(v_dates)
    then
      raise exception using errcode = '22023', message = 'Invalid or duplicate lesson-plan bulk date';
    end if;
    v_dates := pg_catalog.array_append(v_dates, v_date);
  end loop;
  foreach v_date in array p_cleared_dates loop
    if v_date is null or not pg_catalog.isfinite(v_date)
      or v_date < date '0001-01-01' or v_date > date '9999-12-31'
      or v_date = any(v_dates)
    then
      raise exception using errcode = '22023', message = 'Invalid or duplicate lesson-plan clear date';
    end if;
    v_dates := pg_catalog.array_append(v_dates, v_date);
  end loop;

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

    -- Lock all existing matching-client heads before any plan, independent of
    -- request order. Legacy ordered writers may already hold either row.
    if p_client_id is not null then
      perform 1 from public.lesson_plan_mutation_heads as head
      where head.classroom_id = p_classroom_id
        and head.client_id = p_client_id and head.date = any(v_dates)
      order by head.date, head.client_id
      for update nowait;
    end if;
    perform 1 from public.lesson_plans as plan
    where plan.classroom_id = p_classroom_id and plan.date = any(v_dates)
    order by plan.date
    for update nowait;

    -- Versioned saves precede clears. Unversioned clears precede saves,
    -- preserving the existing route's trigger and lineage order.
    if p_client_id is null then
      foreach v_date in array p_cleared_dates loop
        v_result := public.save_lesson_plan_for_owner_v1(
          p_actor_id, p_classroom_id, v_date, '', v_empty_doc, true
        );
        if pg_catalog.jsonb_typeof(v_result) is distinct from 'object'
          or v_result->'applied' is distinct from 'true'::jsonb
          or v_result->'lesson_plan' is distinct from 'null'::jsonb
        then
          raise exception using errcode = 'PT409', message = 'Lesson-plan bulk result changed';
        end if;
        v_clear_results := v_clear_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('date', v_date, 'operation', 'clear',
            'applied', true, 'lesson_plan', null)
        );
      end loop;
    end if;

    for v_entry in select value from pg_catalog.jsonb_array_elements(p_plans) loop
      v_date := (v_entry->>'date')::date;
      v_result := public.save_lesson_plan_for_owner_v1(
        p_actor_id, p_classroom_id, v_date, v_entry->>'content_markdown',
        v_entry->'content', false, p_client_id, p_sequence
      );
      v_row := v_result->'lesson_plan';
      if pg_catalog.jsonb_typeof(v_result) is distinct from 'object'
        or pg_catalog.jsonb_typeof(v_result->'applied') is distinct from 'boolean'
        or v_row is null
        or (v_row = 'null'::jsonb and v_result->'applied' = 'true'::jsonb)
        or (v_row <> 'null'::jsonb and (
          pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
          or v_row->>'classroom_id' is distinct from p_classroom_id::text
          or v_row->>'date' is distinct from v_date::text
        ))
      then
        raise exception using errcode = 'PT409', message = 'Lesson-plan bulk result changed';
      end if;
      v_save_results := v_save_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('date', v_date, 'operation', 'upsert',
          'applied', v_result->'applied', 'lesson_plan', v_row)
      );
    end loop;

    if p_client_id is not null then
      foreach v_date in array p_cleared_dates loop
        v_result := public.save_lesson_plan_for_owner_v1(
          p_actor_id, p_classroom_id, v_date, '', v_empty_doc, true,
          p_client_id, p_sequence
        );
        v_row := v_result->'lesson_plan';
        if pg_catalog.jsonb_typeof(v_result) is distinct from 'object'
          or pg_catalog.jsonb_typeof(v_result->'applied') is distinct from 'boolean'
          or v_row is null
          or (v_result->'applied' = 'true'::jsonb and v_row is distinct from 'null'::jsonb)
          or (v_row <> 'null'::jsonb and (
            pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
            or v_row->>'classroom_id' is distinct from p_classroom_id::text
            or v_row->>'date' is distinct from v_date::text
          ))
        then
          raise exception using errcode = 'PT409', message = 'Lesson-plan bulk result changed';
        end if;
        v_clear_results := v_clear_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('date', v_date, 'operation', 'clear',
            'applied', v_result->'applied', 'lesson_plan', v_row)
        );
      end loop;
    end if;
    return pg_catalog.jsonb_build_object('results', v_save_results || v_clear_results);
  exception
    when sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03'
      or sqlstate '55000' then
      raise exception using errcode = 'PT409', message = 'Lesson-plan operation busy';
  end;
end;
$function$;

revoke all on function public.save_lesson_plans_for_owner_v1(
  uuid, uuid, jsonb, date[], uuid, bigint
) from public, anon, authenticated;
grant execute on function public.save_lesson_plans_for_owner_v1(
  uuid, uuid, jsonb, date[], uuid, bigint
) to service_role;
comment on function public.save_lesson_plans_for_owner_v1(
  uuid, uuid, jsonb, date[], uuid, bigint
) is 'Dormant actor-bound atomic bulk lesson-plan save with current owner and archive fencing.';
