-- Dormant owner archive recovery projection. No mutation or storage access.
begin;

create function public.read_classroom_archive_recovery_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid default null,
  p_operation_id uuid default null
) returns jsonb
language sql stable security invoker
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
  with owned_hot as (
    select c.id, c.teacher_id, c.title, c.class_code, c.term_label, c.allow_enrollment, c.join_policy, c.archived_at, c.created_at, c.updated_at, c.start_date, c.end_date, c.position, c.theme_color, c.lesson_plan_visibility, c.blueprint_source_revision, c.source_blueprint_id, c.source_blueprint_origin, c.source_blueprint_version_id, c.authoring_guidance_version_id, c.actual_site_slug, c.actual_site_published, c.actual_site_config, c.feature_visibility, c.course_overview_markdown, c.course_outline_markdown, c.manual_attendance_revision, c.manual_attendance_session_starts_local, c.manual_attendance_session_ends_local, c.manual_attendance_source_mode, r.revision as current_revision
    from public.classrooms c
    left join public.classroom_archive_revisions r on r.classroom_id = c.id
    where c.teacher_id = p_actor_id and c.archived_at is not null
      and (p_classroom_id is null or c.id = p_classroom_id)
  ), hot as (
    select h.id, h.archived_at, pg_catalog.jsonb_build_object(
      'classroom', pg_catalog.jsonb_build_object(
        'id', h.id,
        'teacher_id', h.teacher_id,
        'title', h.title,
        'class_code', h.class_code,
        'term_label', h.term_label,
        'allow_enrollment', h.allow_enrollment,
        'join_policy', h.join_policy,
        'archived_at', h.archived_at,
        'created_at', h.created_at,
        'updated_at', h.updated_at,
        'start_date', h.start_date,
        'end_date', h.end_date,
        'position', h.position,
        'theme_color', h.theme_color,
        'lesson_plan_visibility', h.lesson_plan_visibility,
        'blueprint_source_revision', h.blueprint_source_revision,
        'source_blueprint_id', h.source_blueprint_id,
        'source_blueprint_origin', h.source_blueprint_origin,
        'source_blueprint_version_id', h.source_blueprint_version_id,
        'authoring_guidance_version_id', h.authoring_guidance_version_id,
        'actual_site_slug', h.actual_site_slug,
        'actual_site_published', h.actual_site_published,
        'actual_site_config', h.actual_site_config,
        'feature_visibility', h.feature_visibility,
        'course_overview_markdown', h.course_overview_markdown,
        'course_outline_markdown', h.course_outline_markdown,
        'manual_attendance_revision', h.manual_attendance_revision,
        'manual_attendance_session_starts_local', h.manual_attendance_session_starts_local,
        'manual_attendance_session_ends_local', h.manual_attendance_session_ends_local,
        'manual_attendance_source_mode', h.manual_attendance_source_mode
      ),
      'current_revision', h.current_revision,
      'latest_archive', (
        select pg_catalog.jsonb_build_object(
          'archive_id', a.id, 'operation_id', a.operation_id,
          'teacher_id', a.teacher_id, 'classroom_id', a.classroom_id,
          'source_revision', a.source_revision, 'created_at', a.created_at,
          'verified_at', a.verified_at, 'compressed_byte_size', a.compressed_byte_size,
          'retention', a.retention
        ) from public.classroom_archives a
        where a.classroom_id = h.id and a.teacher_id = p_actor_id
        order by a.created_at desc, a.operation_id desc limit 1
      ),
      'latest_operation', (
        select pg_catalog.jsonb_build_object(
          'operation_id', o.id, 'teacher_id', o.teacher_id, 'classroom_id', o.classroom_id,
          'source_revision', o.source_revision, 'status', o.status, 'retryable', o.retryable,
          'retention', o.retention, 'updated_at', o.updated_at
        ) from public.classroom_archive_operations o
        where o.classroom_id = h.id and o.teacher_id = p_actor_id
          and o.operation_type = 'export' and o.source_revision = h.current_revision
        order by o.snapshot_created_at desc, o.id desc limit 1
      )
    ) as evidence from owned_hot h
  ), cold as (
    select t.classroom_id, t.compacted_at, pg_catalog.jsonb_build_object(
      'classroom_id', t.classroom_id, 'archive_id', t.archive_id, 'title', t.title,
      'archived_at', t.archived_at, 'compacted_at', t.compacted_at,
      'teacher_id', t.teacher_id, 'source_revision', t.source_revision,
      'archive_teacher_id', a.teacher_id, 'archive_classroom_id', a.classroom_id,
      'archive_source_revision', a.source_revision
    ) as evidence
    from public.classroom_cold_tombstones t
    left join public.classroom_archives a on a.id = t.archive_id
    where t.teacher_id = p_actor_id
      and (p_classroom_id is null or t.classroom_id = p_classroom_id)
  ), payload as materialized (
  select pg_catalog.jsonb_build_object(
    'actor_id', p_actor_id,
    'hot_classrooms', coalesce((select pg_catalog.jsonb_agg(h.evidence order by h.archived_at desc, h.id) from hot h), '[]'::jsonb),
    'cold_archives', coalesce((select pg_catalog.jsonb_agg(c.evidence order by c.compacted_at desc, c.classroom_id) from cold c), '[]'::jsonb),
    'verified_export', (
      select pg_catalog.jsonb_build_object(
        'operation_id', o.id, 'archive_id', a.id, 'teacher_id', a.teacher_id,
        'classroom_id', a.classroom_id, 'source_revision', a.source_revision,
        'artifact_sha256', a.artifact_sha256, 'content_sha256', a.content_sha256,
        'compressed_byte_size', a.compressed_byte_size, 'uncompressed_byte_size', a.uncompressed_byte_size,
        'resource_counts', a.resource_counts, 'storage_object_counts', a.storage_object_counts,
        'verification', a.verification
      )
      from owned_hot h
      join public.classroom_archive_operations o on o.classroom_id = h.id
      join public.classroom_archives a on a.operation_id = o.id and a.id = o.archive_id
      where p_classroom_id is not null and p_operation_id is not null
        and h.id = p_classroom_id and o.id = p_operation_id
        and o.teacher_id = p_actor_id and a.teacher_id = p_actor_id and a.classroom_id = h.id
        and o.operation_type = 'export' and o.status = 'completed'
        and a.format = 'pika.classroom-archive' and a.format_version = 2
        and o.source_contract_version = 2 and o.archive_format_version = 2
        and o.source_revision = h.current_revision and a.source_revision = h.current_revision
        and a.storage_bucket = 'classroom-archives' and o.storage_bucket = a.storage_bucket
        and a.storage_path = o.storage_path and a.retention = o.retention
        and a.artifact_sha256 = o.artifact_sha256 and a.content_sha256 = o.content_sha256
        and a.compressed_byte_size = o.compressed_byte_size and a.uncompressed_byte_size = o.uncompressed_byte_size
        and a.resource_counts = o.resource_counts and a.storage_object_counts = o.storage_object_counts
        and a.verification = o.verification
    )
  ) as result
  )
  select case
    when pg_catalog.jsonb_array_length(result->'hot_classrooms') > 5000
      or pg_catalog.jsonb_array_length(result->'cold_archives') > 5000
      or pg_catalog.octet_length(pg_catalog.convert_to(result::text, 'UTF8')) > 16777216
    then null
    else result
  end from payload;
$function$;

alter function public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid) owner to postgres;
revoke all on function public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid) to service_role;
comment on function public.read_classroom_archive_recovery_for_owner_v1(uuid,uuid,uuid) is
  'Service-only single-snapshot current-owner archived hot/cold recovery and exact completed export evidence. Fresh server identity and strict DTO binding required. No storage paths returned.';
commit;
