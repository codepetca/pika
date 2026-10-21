-- Dormant live-guidance preview; current ownership of BOTH resources is required.
begin;
create function public.preview_classroom_authoring_guidance_for_owner_v1(p_actor_id uuid,p_classroom_id uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare
  v_classroom record;
  v_blueprint record;
  v_live record;
  v_content record;
  v_guidance record;
  v_snapshot_bytes bigint;
  v_result jsonb;
begin
  if p_actor_id is null or p_classroom_id is null then
    raise exception using errcode = 'PT400', message = 'class_guidance_preview_invalid_argument';
  end if;
  select c.id,c.teacher_id,c.archived_at,c.source_blueprint_id,c.source_blueprint_version_id,c.authoring_guidance_version_id
    into v_classroom from public.classrooms c where c.id = p_classroom_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'class_guidance_preview_classroom_missing';
  end if;
  if v_classroom.teacher_id is distinct from p_actor_id then
    raise exception using errcode = 'PT403', message = 'class_guidance_preview_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = 'PT403', message = 'class_guidance_preview_archived';
  end if;
  if v_classroom.source_blueprint_id is null or v_classroom.source_blueprint_version_id is null then
    raise exception using errcode = 'PT409', message = 'class_guidance_preview_unlinked';
  end if;
  -- Identity-only second-resource authorization. No live rules or immutable
  -- snapshots are read until BOTH actual owners have been checked.
  select b.id,b.teacher_id into v_blueprint from public.course_blueprints b where b.id = v_classroom.source_blueprint_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'class_guidance_preview_blueprint_missing';
  end if;
  if v_blueprint.teacher_id is distinct from p_actor_id then
    raise exception using errcode = 'PT403', message = 'class_guidance_preview_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off') = 'on'
    or exists(select 1 from public.classroom_purge_fences f where f.classroom_id = v_classroom.id)
    or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id = v_classroom.id)
    or exists(select 1 from public.course_blueprint_purge_fences f where f.course_blueprint_id = v_blueprint.id)
    then raise exception using errcode = 'PT503', message = 'class_guidance_preview_fenced';
  end if;
  -- All SELECTs in this STABLE call share the invoking statement's snapshot.
  select b.content_revision,b.authoring_guidance into v_live from public.course_blueprints b
    where b.id = v_blueprint.id and b.teacher_id = p_actor_id;
  if not found then
    raise exception using errcode = 'PT503', message = 'class_guidance_preview_unavailable';
  end if;
  select v.id,v.course_blueprint_id,v.snapshot_json into v_content from public.course_blueprint_versions v
    where v.id = v_classroom.source_blueprint_version_id and v.course_blueprint_id = v_classroom.source_blueprint_id;
  if not found then
    raise exception using errcode = 'PT503', message = 'class_guidance_preview_unavailable';
  end if;
  select v.id,v.course_blueprint_id,v.version_number,v.snapshot_json into v_guidance from public.course_blueprint_versions v
    where v.id = coalesce(v_classroom.authoring_guidance_version_id,v_classroom.source_blueprint_version_id)
    and v.course_blueprint_id = v_classroom.source_blueprint_id;
  if not found then
    raise exception using errcode = 'PT503', message = 'class_guidance_preview_unavailable';
  end if;
  if v_content.course_blueprint_id is distinct from v_blueprint.id or v_guidance.course_blueprint_id is distinct from v_blueprint.id
    or v_guidance.version_number is null or v_guidance.version_number < 1 or v_guidance.version_number > 9007199254740991
    or v_live.content_revision is null or v_live.content_revision < 1 or v_live.content_revision > 9007199254740991
    or pg_catalog.jsonb_typeof(v_content.snapshot_json) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_guidance.snapshot_json) is distinct from 'object'
    then raise exception using errcode = 'PT503', message = 'class_guidance_preview_invalid';
  end if;
  -- Operational read/response bound, not a plan quota. Count a fallback Version
  -- once, plus live rules. Never expand title arrays or unrelated live children.
  v_snapshot_bytes := pg_catalog.octet_length(pg_catalog.convert_to(v_content.snapshot_json::text,'UTF8'))::bigint;
  if v_guidance.id is distinct from v_content.id then
    v_snapshot_bytes := v_snapshot_bytes + pg_catalog.octet_length(pg_catalog.convert_to(v_guidance.snapshot_json::text,'UTF8'))::bigint;
  end if;
  v_snapshot_bytes := v_snapshot_bytes + pg_catalog.octet_length(pg_catalog.convert_to(coalesce(v_live.authoring_guidance,'null'::jsonb)::text,'UTF8'))::bigint;
  if v_snapshot_bytes > 8388608 then
    raise exception using errcode = 'PT503', message = 'class_guidance_preview_too_large';
  end if;
  v_result := pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,
    'classroom',pg_catalog.jsonb_build_object('id',v_classroom.id,'teacher_id',v_classroom.teacher_id,'archived_at',v_classroom.archived_at,
      'source_blueprint_id',v_classroom.source_blueprint_id,'source_blueprint_version_id',v_classroom.source_blueprint_version_id,
      'authoring_guidance_version_id',v_classroom.authoring_guidance_version_id),
    'blueprint',pg_catalog.jsonb_build_object('id',v_blueprint.id,'teacher_id',v_blueprint.teacher_id,'content_revision',v_live.content_revision),
    'versions',pg_catalog.jsonb_build_object('content',pg_catalog.jsonb_build_object('id',v_content.id,'course_blueprint_id',v_content.course_blueprint_id),
      'guidance',pg_catalog.jsonb_build_object('id',v_guidance.id,'course_blueprint_id',v_guidance.course_blueprint_id,'version_number',v_guidance.version_number)),
    'current_guidance',v_guidance.snapshot_json->'authoring_guidance','guidance',v_live.authoring_guidance);
  if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text,'UTF8')) > 8388608 then
    raise exception using errcode = 'PT503', message = 'class_guidance_preview_too_large';
  end if;
  return v_result;
end;
$function$;
alter function public.preview_classroom_authoring_guidance_for_owner_v1(uuid,uuid) owner to postgres;
revoke all on function public.preview_classroom_authoring_guidance_for_owner_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.preview_classroom_authoring_guidance_for_owner_v1(uuid,uuid) to service_role;
comment on function public.preview_classroom_authoring_guidance_for_owner_v1(uuid,uuid) is
  'Service-only same-statement current active classroom and live Blueprint owner guidance preview; frozen selected Version bindings, no writes, locks, live children or equality approximation.';
commit;
