-- Dormant frozen classroom guidance read. No authoring, adoption or provider work.
begin;
--120 withheld this operational table. The invoker needs only fence identity.
grant select (course_blueprint_id) on public.course_blueprint_purge_fences to service_role;

create function public.read_classroom_authoring_guidance_for_owner_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare
  v_classroom record;
  v_content record;
  v_guidance record;
  v_snapshot_bytes bigint;
  v_title_items bigint;
  v_context jsonb := null;
  v_parents jsonb := null;
  v_result jsonb;
begin
  if p_actor_id is null or p_classroom_id is null then
    raise exception using errcode = 'PT400', message = 'class_authoring_guidance_invalid_argument';
  end if;
  select c.id,c.teacher_id,c.source_blueprint_id,c.source_blueprint_version_id,c.authoring_guidance_version_id
    into v_classroom from public.classrooms c where c.id = p_classroom_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'class_authoring_guidance_missing';
  end if;
  -- Authorization precedes every fence/immutable-version read. Archived owners
  -- retain their frozen context; no live Blueprint owner or Draft is consulted.
  if v_classroom.teacher_id is distinct from p_actor_id then
    raise exception using errcode = 'PT403', message = 'class_authoring_guidance_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off') = 'on'
    or exists(select 1 from public.classroom_purge_fences f where f.classroom_id = v_classroom.id)
    or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id = v_classroom.id)
    or exists(select 1 from public.course_blueprint_purge_fences f where f.course_blueprint_id = v_classroom.source_blueprint_id)
    then raise exception using errcode = 'PT503', message = 'class_authoring_guidance_fenced';
  end if;

  -- An unlinked or partial structural pair intentionally retains legacy null.
  if not (v_classroom.source_blueprint_id is null or v_classroom.source_blueprint_version_id is null) then
    select v.id,v.course_blueprint_id,v.version_number,v.source_draft_revision,v.snapshot_json
      into v_content from public.course_blueprint_versions v where v.id = v_classroom.source_blueprint_version_id
      and v.course_blueprint_id = v_classroom.source_blueprint_id;
    if not found then
      raise exception using errcode = 'PT503', message = 'class_authoring_guidance_unavailable';
    end if;
    select v.id,v.course_blueprint_id,v.version_number,v.source_draft_revision,v.snapshot_json
      into v_guidance from public.course_blueprint_versions v
      where v.id = coalesce(v_classroom.authoring_guidance_version_id,v_classroom.source_blueprint_version_id)
      and v.course_blueprint_id = v_classroom.source_blueprint_id;
    if not found then
      raise exception using errcode = 'PT503', message = 'class_authoring_guidance_unavailable';
    end if;
    if v_content.course_blueprint_id is distinct from v_classroom.source_blueprint_id
      or v_guidance.course_blueprint_id is distinct from v_classroom.source_blueprint_id
      or v_content.version_number is null or v_content.version_number < 1 or v_content.version_number > 9007199254740991
      or v_guidance.version_number is null or v_guidance.version_number < 1 or v_guidance.version_number > 9007199254740991
      or v_guidance.source_draft_revision is null or v_guidance.source_draft_revision < 0 or v_guidance.source_draft_revision > 9007199254740991
      or pg_catalog.jsonb_typeof(v_content.snapshot_json) is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_guidance.snapshot_json) is distinct from 'object'
      then raise exception using errcode = 'PT503', message = 'class_authoring_guidance_invalid';
    end if;
    -- Operational response/work bounds, not subscription quantities. Count each
    -- selected immutable snapshot once, even when guidance inherits content.
    v_snapshot_bytes := pg_catalog.octet_length(pg_catalog.convert_to(v_content.snapshot_json::text,'UTF8'))::bigint;
    if v_guidance.id is distinct from v_content.id then
      v_snapshot_bytes := v_snapshot_bytes + pg_catalog.octet_length(pg_catalog.convert_to(v_guidance.snapshot_json::text,'UTF8'))::bigint;
    end if;
    if v_snapshot_bytes > 8388608 then
      raise exception using errcode = 'PT503', message = 'class_authoring_guidance_too_large';
    end if;
    v_title_items := (case when pg_catalog.jsonb_typeof(v_content.snapshot_json->'assignments') = 'array'
      then pg_catalog.jsonb_array_length(v_content.snapshot_json->'assignments') else 0 end)::bigint
      + (case when pg_catalog.jsonb_typeof(v_content.snapshot_json->'assessments') = 'array'
      then pg_catalog.jsonb_array_length(v_content.snapshot_json->'assessments') else 0 end)::bigint;
    if v_title_items > 10000 then
      raise exception using errcode = 'PT503', message = 'class_authoring_guidance_too_large';
    end if;
    v_parents := pg_catalog.jsonb_build_object('content',v_content.course_blueprint_id,'guidance',v_guidance.course_blueprint_id);
    v_context := pg_catalog.jsonb_build_object(
      'blueprint_id',v_classroom.source_blueprint_id,
      'content_version_id',v_content.id,'content_version_number',v_content.version_number,
      'source_blueprint_version_id',v_guidance.id,'source_blueprint_version_number',v_guidance.version_number,
      'source_draft_revision',v_guidance.source_draft_revision,
      'guidance',v_guidance.snapshot_json->'authoring_guidance',
      'course',pg_catalog.jsonb_build_object(
        'title',case when pg_catalog.jsonb_typeof(v_content.snapshot_json#>'{metadata,title}') = 'string' then v_content.snapshot_json#>>'{metadata,title}' else '' end,
        'subject',case when pg_catalog.jsonb_typeof(v_content.snapshot_json#>'{metadata,subject}') = 'string' then v_content.snapshot_json#>>'{metadata,subject}' else '' end,
        'grade_level',case when pg_catalog.jsonb_typeof(v_content.snapshot_json#>'{metadata,grade_level}') = 'string' then v_content.snapshot_json#>>'{metadata,grade_level}' else '' end,
        'outline_markdown',case when pg_catalog.jsonb_typeof(v_content.snapshot_json#>'{sections,outline_markdown}') = 'string' then v_content.snapshot_json#>>'{sections,outline_markdown}' else '' end,
        'assignment_titles',coalesce((select pg_catalog.jsonb_agg(item->>'title' order by ordinal)
          from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_content.snapshot_json->'assignments') = 'array'
            then v_content.snapshot_json->'assignments' else '[]'::jsonb end) with ordinality r(item,ordinal)
          where pg_catalog.jsonb_typeof(item->'title') = 'string' and item->>'title' <> ''),'[]'::jsonb),
        'test_titles',coalesce((select pg_catalog.jsonb_agg(item->>'title' order by ordinal)
          from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_content.snapshot_json->'assessments') = 'array'
            then v_content.snapshot_json->'assessments' else '[]'::jsonb end) with ordinality r(item,ordinal)
          where pg_catalog.jsonb_typeof(item->'title') = 'string' and item->>'title' <> ''),'[]'::jsonb)
      )
    );
  end if;
  v_result := pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'classroom',pg_catalog.jsonb_build_object('id',v_classroom.id,'teacher_id',v_classroom.teacher_id,
      'source_blueprint_id',v_classroom.source_blueprint_id,'source_blueprint_version_id',v_classroom.source_blueprint_version_id,
      'authoring_guidance_version_id',v_classroom.authoring_guidance_version_id),
    'version_parents',v_parents,'context',v_context);
  if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text,'UTF8')) > 8388608 then
    raise exception using errcode = 'PT503', message = 'class_authoring_guidance_too_large';
  end if;
  return v_result;
end;
$function$;
alter function public.read_classroom_authoring_guidance_for_owner_v1(uuid,uuid) owner to postgres;
revoke all on function public.read_classroom_authoring_guidance_for_owner_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_classroom_authoring_guidance_for_owner_v1(uuid,uuid) to service_role;
comment on function public.read_classroom_authoring_guidance_for_owner_v1(uuid,uuid) is
  'Service-only current classroom owner frozen structural/adopted guidance snapshot; archived owners allowed, no live Draft/current Blueprint-owner dependency or side effects.';
commit;
