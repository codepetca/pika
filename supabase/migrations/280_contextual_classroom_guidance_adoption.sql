-- Dormant dual-owner source/save-and-adopt flow. No application or activation.
-- DEFINER is constrained to these service-only entrypoints so their narrow raw
-- projection remains inaccessible to service_role and all browser roles.
begin;
create function private.classroom_guidance_adoption_source_v1(p_blueprint_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare
 v_blueprint jsonb;v_counts jsonb:='{}';v_source jsonb;v_result jsonb;v_raw_bytes bigint;v_count bigint;v_bytes bigint;
 v_assignments jsonb;v_assessments jsonb;v_lesson_templates jsonb;v_materials jsonb;v_surveys jsonb;
begin
 select pg_catalog.jsonb_build_object('id',b.id,'teacher_id',b.teacher_id,'content_revision',b.content_revision,'title',b.title,'subject',b.subject,'grade_level',b.grade_level,'course_code',b.course_code,'term_template',b.term_template,'overview_markdown',b.overview_markdown,'outline_markdown',b.outline_markdown,'resources_markdown',b.resources_markdown,'authoring_guidance',b.authoring_guidance,'gradebook_use_weights',b.gradebook_use_weights,'gradebook_assignments_weight',b.gradebook_assignments_weight,'gradebook_tests_weight',b.gradebook_tests_weight,'planned_site_slug',b.planned_site_slug,'planned_site_published',b.planned_site_published,'planned_site_config',b.planned_site_config) into v_blueprint from public.course_blueprints b where b.id=p_blueprint_id;
 if not found then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 v_raw_bytes:=pg_catalog.octet_length(pg_catalog.convert_to(v_blueprint::text,'UTF8'))::bigint;
 select count(*),coalesce(sum(pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'instructions_markdown',r.instructions_markdown,'submission_requirements_json',r.submission_requirements_json,'default_due_days',r.default_due_days,'default_due_time',r.default_due_time,'points_possible',r.points_possible,'gradebook_weight',r.gradebook_weight,'include_in_final',r.include_in_final,'is_draft',r.is_draft,'track_authenticity',r.track_authenticity,'position',r.position)::text,'UTF8'))::bigint),0)
 into v_count,v_bytes from public.course_blueprint_assignments r where r.course_blueprint_id=p_blueprint_id;
 v_counts:=v_counts||pg_catalog.jsonb_build_object('assignments',v_count);v_raw_bytes:=v_raw_bytes+v_bytes;
 select count(*),coalesce(sum(pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'assessment_type',r.assessment_type,'title',r.title,'content',r.content,'documents',r.documents,'points_possible',r.points_possible,'gradebook_weight',r.gradebook_weight,'include_in_final',r.include_in_final,'position',r.position)::text,'UTF8'))::bigint),0)
 into v_count,v_bytes from public.course_blueprint_assessments r where r.course_blueprint_id=p_blueprint_id;
 v_counts:=v_counts||pg_catalog.jsonb_build_object('assessments',v_count);v_raw_bytes:=v_raw_bytes+v_bytes;
 select count(*),coalesce(sum(pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'content_markdown',r.content_markdown,'position',r.position)::text,'UTF8'))::bigint),0)
 into v_count,v_bytes from public.course_blueprint_lesson_templates r where r.course_blueprint_id=p_blueprint_id;
 v_counts:=v_counts||pg_catalog.jsonb_build_object('lesson_templates',v_count);v_raw_bytes:=v_raw_bytes+v_bytes;
 select count(*),coalesce(sum(pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'content_markdown',r.content_markdown,'position',r.position)::text,'UTF8'))::bigint),0)
 into v_count,v_bytes from public.course_blueprint_materials r where r.course_blueprint_id=p_blueprint_id;
 v_counts:=v_counts||pg_catalog.jsonb_build_object('materials',v_count);v_raw_bytes:=v_raw_bytes+v_bytes;
 select count(*),coalesce(sum(pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'show_results',r.show_results,'dynamic_responses',r.dynamic_responses,'questions_json',r.questions_json,'position',r.position)::text,'UTF8'))::bigint),0)
 into v_count,v_bytes from public.course_blueprint_surveys r where r.course_blueprint_id=p_blueprint_id;
 v_counts:=v_counts||pg_catalog.jsonb_build_object('surveys',v_count);v_raw_bytes:=v_raw_bytes+v_bytes;
 -- Operational UTF8 bound, not an editor/item/plan quota; before any array aggregate.
 if v_raw_bytes > 8388608 then raise exception using errcode='PT503',message='class_guidance_adoption_too_large'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'instructions_markdown',r.instructions_markdown,'submission_requirements_json',r.submission_requirements_json,'default_due_days',r.default_due_days,'default_due_time',r.default_due_time,'points_possible',r.points_possible,'gradebook_weight',r.gradebook_weight,'include_in_final',r.include_in_final,'is_draft',r.is_draft,'track_authenticity',r.track_authenticity,'position',r.position) order by r.position,r.id),'[]'::jsonb)
 into v_assignments from public.course_blueprint_assignments r where r.course_blueprint_id=p_blueprint_id;
 if pg_catalog.jsonb_array_length(v_assignments)::bigint is distinct from (v_counts->>'assignments')::bigint then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'assessment_type',r.assessment_type,'title',r.title,'content',r.content,'documents',r.documents,'points_possible',r.points_possible,'gradebook_weight',r.gradebook_weight,'include_in_final',r.include_in_final,'position',r.position) order by r.position,r.id),'[]'::jsonb)
 into v_assessments from public.course_blueprint_assessments r where r.course_blueprint_id=p_blueprint_id;
 if pg_catalog.jsonb_array_length(v_assessments)::bigint is distinct from (v_counts->>'assessments')::bigint then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'content_markdown',r.content_markdown,'position',r.position) order by r.position,r.id),'[]'::jsonb)
 into v_lesson_templates from public.course_blueprint_lesson_templates r where r.course_blueprint_id=p_blueprint_id;
 if pg_catalog.jsonb_array_length(v_lesson_templates)::bigint is distinct from (v_counts->>'lesson_templates')::bigint then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'content_markdown',r.content_markdown,'position',r.position) order by r.position,r.id),'[]'::jsonb)
 into v_materials from public.course_blueprint_materials r where r.course_blueprint_id=p_blueprint_id;
 if pg_catalog.jsonb_array_length(v_materials)::bigint is distinct from (v_counts->>'materials')::bigint then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'course_blueprint_id',r.course_blueprint_id,'artifact_id',r.artifact_id,'title',r.title,'show_results',r.show_results,'dynamic_responses',r.dynamic_responses,'questions_json',r.questions_json,'position',r.position) order by r.position,r.id),'[]'::jsonb)
 into v_surveys from public.course_blueprint_surveys r where r.course_blueprint_id=p_blueprint_id;
 if pg_catalog.jsonb_array_length(v_surveys)::bigint is distinct from (v_counts->>'surveys')::bigint then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 v_source:=pg_catalog.jsonb_build_object('blueprint',v_blueprint,'assignments',v_assignments,'assessments',v_assessments,'lesson_templates',v_lesson_templates,'materials',v_materials,'surveys',v_surveys);
 if pg_catalog.octet_length(pg_catalog.convert_to(v_source::text,'UTF8'))>8388608 then raise exception using errcode='PT503',message='class_guidance_adoption_too_large'; end if;
 v_result:=pg_catalog.jsonb_build_object('source',v_source,'counts',v_counts,'source_sha256',
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source::text,'UTF8')),'hex'));
 if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text,'UTF8'))>8388608 then raise exception using errcode='PT503',message='class_guidance_adoption_too_large'; end if;
 return v_result;
end;
$function$;
alter function private.classroom_guidance_adoption_source_v1(uuid) owner to postgres;
revoke all on function private.classroom_guidance_adoption_source_v1(uuid) from public,anon,authenticated,service_role;

create function public.read_classroom_guidance_adoption_source_v1(
 p_actor_id uuid,p_classroom_id uuid,p_blueprint_id uuid,
 p_expected_content_version_id uuid,p_expected_guidance_version_id uuid,p_expected_draft_revision bigint)
returns jsonb language plpgsql stable security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare v_classroom record;v_blueprint record;v_content record;v_guidance record;v_projection jsonb;v_result jsonb;
begin
 if p_actor_id is null or p_classroom_id is null or p_blueprint_id is null
 or p_expected_content_version_id is null or p_expected_guidance_version_id is null
 or p_expected_draft_revision is null or p_expected_draft_revision<1 or p_expected_draft_revision>9007199254740991
 then raise exception using errcode='PT400',message='class_guidance_adoption_invalid_argument'; end if;
 select c.id,c.teacher_id,c.archived_at,c.source_blueprint_id,c.source_blueprint_version_id,c.authoring_guidance_version_id
 into v_classroom from public.classrooms c where c.id=p_classroom_id;
 if not found then raise exception using errcode='PT404',message='class_guidance_adoption_classroom_missing'; end if;
 if v_classroom.teacher_id is distinct from p_actor_id then raise exception using errcode='PT403',message='class_guidance_adoption_forbidden'; end if;
 if v_classroom.archived_at is not null then raise exception using errcode='PT403',message='class_guidance_adoption_archived'; end if;
 if v_classroom.source_blueprint_id is null or v_classroom.source_blueprint_version_id is null then raise exception using errcode='PT409',message='class_guidance_adoption_unlinked'; end if;
 select b.id,b.teacher_id into v_blueprint from public.course_blueprints b where b.id=v_classroom.source_blueprint_id;
 if not found then raise exception using errcode='PT404',message='class_guidance_adoption_blueprint_missing'; end if;
 if v_blueprint.teacher_id is distinct from p_actor_id then raise exception using errcode='PT403',message='class_guidance_adoption_forbidden'; end if;
 if v_blueprint.id is distinct from p_blueprint_id then raise exception using errcode='PT409',message='class_guidance_adoption_changed'; end if;
 if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
 or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
 or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off')='on'
 or exists(select 1 from public.classroom_purge_fences f where f.classroom_id=p_classroom_id)
 or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id=p_classroom_id)
 or exists(select 1 from public.course_blueprint_purge_fences f where f.course_blueprint_id=p_blueprint_id)
 then raise exception using errcode='PT503',message='class_guidance_adoption_fenced'; end if;

 select b.id,b.teacher_id,b.content_revision into v_blueprint from public.course_blueprints b where b.id=p_blueprint_id;
 if v_classroom.source_blueprint_id is distinct from p_blueprint_id
 or v_classroom.source_blueprint_version_id is distinct from p_expected_content_version_id
 or coalesce(v_classroom.authoring_guidance_version_id,v_classroom.source_blueprint_version_id) is distinct from p_expected_guidance_version_id
 or v_blueprint.content_revision is distinct from p_expected_draft_revision then raise exception using errcode='PT409',message='class_guidance_adoption_changed'; end if;
 select v.id,v.course_blueprint_id,pg_catalog.jsonb_typeof(v.snapshot_json) snapshot_type into v_content
 from public.course_blueprint_versions v where v.id=p_expected_content_version_id;
 if not found then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 select v.id,v.course_blueprint_id,v.version_number,pg_catalog.jsonb_typeof(v.snapshot_json) snapshot_type into v_guidance
 from public.course_blueprint_versions v where v.id=p_expected_guidance_version_id;
 if not found then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 if v_content.course_blueprint_id is distinct from p_blueprint_id or v_guidance.course_blueprint_id is distinct from p_blueprint_id
 or v_content.snapshot_type is distinct from 'object' or v_guidance.snapshot_type is distinct from 'object'
 or v_guidance.version_number<1 or v_guidance.version_number>9007199254740991
 or v_blueprint.content_revision<1 or v_blueprint.content_revision>9007199254740991 then raise exception using errcode='PT503',message='class_guidance_adoption_invalid'; end if;

 v_projection:=private.classroom_guidance_adoption_source_v1(p_blueprint_id);
 v_result:=pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,'classroom',pg_catalog.to_jsonb(v_classroom),
 'versions',pg_catalog.jsonb_build_object('content',pg_catalog.jsonb_build_object('id',v_content.id,'course_blueprint_id',v_content.course_blueprint_id),
 'guidance',pg_catalog.jsonb_build_object('id',v_guidance.id,'course_blueprint_id',v_guidance.course_blueprint_id,'version_number',v_guidance.version_number)))||v_projection;
 if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text,'UTF8'))>8388608 then raise exception using errcode='PT503',message='class_guidance_adoption_too_large'; end if;
 return v_result;
end;
$function$;
alter function public.read_classroom_guidance_adoption_source_v1(uuid,uuid,uuid,uuid,uuid,bigint) owner to postgres;
revoke all on function public.read_classroom_guidance_adoption_source_v1(uuid,uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.read_classroom_guidance_adoption_source_v1(uuid,uuid,uuid,uuid,uuid,bigint) to service_role;

create function public.save_and_adopt_classroom_guidance_for_owner_v1(
 p_actor_id uuid,p_classroom_id uuid,p_blueprint_id uuid,
 p_expected_content_version_id uuid,p_expected_guidance_version_id uuid,p_expected_draft_revision bigint,
 p_source_sha256 text,p_snapshot_canonical text,p_snapshot_sha256 text)
returns jsonb language plpgsql volatile security definer
set search_path = ''
set lock_timeout = '1s'
set statement_timeout = '8s'
as $function$
declare
 v_classroom record;v_blueprint record;v_content record;v_guidance record;v_projection jsonb;
 v_snapshot jsonb;v_snapshot_bytes bigint;v_saved public.course_blueprint_versions%rowtype;
 v_adopted jsonb;v_after public.classrooms%rowtype;v_message text;
begin
 if p_actor_id is null or p_classroom_id is null or p_blueprint_id is null
 or p_expected_content_version_id is null or p_expected_guidance_version_id is null
 or p_expected_draft_revision is null or p_expected_draft_revision<1 or p_expected_draft_revision>9007199254740991
 then raise exception using errcode='PT400',message='class_guidance_adoption_invalid_argument'; end if;
 select c.id,c.teacher_id,c.archived_at,c.source_blueprint_id,c.source_blueprint_version_id,c.authoring_guidance_version_id
 into v_classroom from public.classrooms c where c.id=p_classroom_id;
 if not found then raise exception using errcode='PT404',message='class_guidance_adoption_classroom_missing'; end if;
 if v_classroom.teacher_id is distinct from p_actor_id then raise exception using errcode='PT403',message='class_guidance_adoption_forbidden'; end if;
 if v_classroom.archived_at is not null then raise exception using errcode='PT403',message='class_guidance_adoption_archived'; end if;
 if v_classroom.source_blueprint_id is null or v_classroom.source_blueprint_version_id is null then raise exception using errcode='PT409',message='class_guidance_adoption_unlinked'; end if;
 select b.id,b.teacher_id into v_blueprint from public.course_blueprints b where b.id=v_classroom.source_blueprint_id;
 if not found then raise exception using errcode='PT404',message='class_guidance_adoption_blueprint_missing'; end if;
 if v_blueprint.teacher_id is distinct from p_actor_id then raise exception using errcode='PT403',message='class_guidance_adoption_forbidden'; end if;
 if v_blueprint.id is distinct from p_blueprint_id then raise exception using errcode='PT409',message='class_guidance_adoption_changed'; end if;

 if p_source_sha256 is null or p_source_sha256!~'^[a-f0-9]{64}$' or p_snapshot_sha256 is null or p_snapshot_sha256!~'^[a-f0-9]{64}$'
 or p_snapshot_canonical is null then raise exception using errcode='PT400',message='class_guidance_adoption_invalid_argument'; end if;
 if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
 or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
 or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off')='on'
 or exists(select 1 from public.classroom_purge_fences f where f.classroom_id=p_classroom_id)
 or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id=p_classroom_id)
 or exists(select 1 from public.course_blueprint_purge_fences f where f.course_blueprint_id=p_blueprint_id)
 then raise exception using errcode='PT503',message='class_guidance_adoption_fenced'; end if;

 --118 and120 lifecycle try-locks, then112/222 parent order. No invented lock.
 perform public.guard_classroom_purge_lifecycle(p_classroom_id);
 perform public.guard_course_blueprint_purge_lifecycle(p_blueprint_id);
 select b.id,b.teacher_id,b.content_revision into v_blueprint from public.course_blueprints b where b.id = p_blueprint_id for update nowait;
 if not found then raise exception using errcode='PT404',message='class_guidance_adoption_blueprint_missing'; end if;
 select c.id,c.teacher_id,c.archived_at,c.source_blueprint_id,c.source_blueprint_version_id,c.authoring_guidance_version_id
 into v_classroom from public.classrooms c where c.id = p_classroom_id for update nowait;
 if not found then raise exception using errcode='PT404',message='class_guidance_adoption_classroom_missing'; end if;
 if v_classroom.teacher_id is distinct from p_actor_id then raise exception using errcode='PT403',message='class_guidance_adoption_forbidden'; end if;
 if v_blueprint.teacher_id is distinct from p_actor_id then raise exception using errcode='PT403',message='class_guidance_adoption_forbidden'; end if;
 if v_classroom.archived_at is not null then raise exception using errcode='PT403',message='class_guidance_adoption_archived'; end if;
 if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
 or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
 or coalesce(pg_catalog.current_setting('pika.identity_mapping',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
 or coalesce(pg_catalog.current_setting('pika.student_purge_finalize',true),'off')='on'
 or exists(select 1 from public.classroom_purge_fences f where f.classroom_id=p_classroom_id)
 or exists(select 1 from public.cold_classroom_purge_fences f where f.classroom_id=p_classroom_id)
 or exists(select 1 from public.course_blueprint_purge_fences f where f.course_blueprint_id=p_blueprint_id)
 then raise exception using errcode='PT503',message='class_guidance_adoption_fenced'; end if;
 if v_classroom.source_blueprint_id is distinct from p_blueprint_id
 or v_classroom.source_blueprint_version_id is distinct from p_expected_content_version_id
 or coalesce(v_classroom.authoring_guidance_version_id,v_classroom.source_blueprint_version_id) is distinct from p_expected_guidance_version_id
 or v_blueprint.content_revision is distinct from p_expected_draft_revision then raise exception using errcode='PT409',message='class_guidance_adoption_changed'; end if;
 select v.id,v.course_blueprint_id,pg_catalog.jsonb_typeof(v.snapshot_json) snapshot_type into v_content
 from public.course_blueprint_versions v where v.id=p_expected_content_version_id;
 if not found then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 select v.id,v.course_blueprint_id,v.version_number,pg_catalog.jsonb_typeof(v.snapshot_json) snapshot_type into v_guidance
 from public.course_blueprint_versions v where v.id=p_expected_guidance_version_id;
 if not found then raise exception using errcode='PT503',message='class_guidance_adoption_unavailable'; end if;
 if v_content.course_blueprint_id is distinct from p_blueprint_id or v_guidance.course_blueprint_id is distinct from p_blueprint_id
 or v_content.snapshot_type is distinct from 'object' or v_guidance.snapshot_type is distinct from 'object'
 or v_guidance.version_number<1 or v_guidance.version_number>9007199254740991
 or v_blueprint.content_revision<1 or v_blueprint.content_revision>9007199254740991 then raise exception using errcode='PT503',message='class_guidance_adoption_invalid'; end if;

 v_projection:=private.classroom_guidance_adoption_source_v1(p_blueprint_id);
 if v_projection->>'source_sha256' is distinct from p_source_sha256 then raise exception using errcode='PT409',message='class_guidance_adoption_changed'; end if;
 v_snapshot_bytes:=pg_catalog.octet_length(pg_catalog.convert_to(p_snapshot_canonical,'UTF8'));
 if v_snapshot_bytes>8388608 then raise exception using errcode='PT503',message='class_guidance_adoption_too_large'; end if;
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_snapshot_canonical,'UTF8')),'hex') is distinct from p_snapshot_sha256
 then raise exception using errcode='PT400',message='class_guidance_adoption_invalid_argument'; end if;
 begin v_snapshot:=p_snapshot_canonical::jsonb;
 exception when invalid_text_representation then raise exception using errcode='PT400',message='class_guidance_adoption_invalid_argument'; end;
 if pg_catalog.octet_length(pg_catalog.convert_to(v_snapshot::text,'UTF8'))>8388608 then raise exception using errcode='PT503',message='class_guidance_adoption_too_large'; end if;
 if pg_catalog.jsonb_typeof(v_snapshot) is distinct from 'object'
 or v_snapshot->>'blueprint_id' is distinct from p_blueprint_id::text
 or pg_catalog.jsonb_typeof(v_snapshot->'draft_revision') is distinct from 'number'
 or v_snapshot->>'draft_revision' is distinct from p_expected_draft_revision::text
 or pg_catalog.jsonb_typeof(v_snapshot->'schema_version') is distinct from 'number'
 or v_snapshot->>'schema_version' is distinct from '3'
 or not coalesce(public.is_course_blueprint_authoring_guidance(v_snapshot->'authoring_guidance'),false)
 then raise exception using errcode='PT400',message='class_guidance_adoption_invalid_argument'; end if;
 --No handler converts a failure into committed JSON. Existing immutable rows
 --may deduplicate with another original source_kind/source_metadata: retain them.
 select * into v_saved from public.save_course_blueprint_version_atomic(p_actor_id,p_blueprint_id,p_expected_draft_revision,
 3,v_snapshot,p_snapshot_sha256,'pika','{}'::jsonb);
 if v_saved.id is null or v_saved.course_blueprint_id is distinct from p_blueprint_id
 or v_saved.source_draft_revision is distinct from p_expected_draft_revision
 or v_saved.snapshot_sha256 is distinct from p_snapshot_sha256 or v_saved.snapshot_json is distinct from v_snapshot
 or v_saved.version_number<1 or v_saved.version_number>9007199254740991 then raise exception using errcode='PT503',message='class_guidance_adoption_invalid'; end if;
 v_adopted:=public.adopt_classroom_authoring_guidance_v1(p_actor_id,p_classroom_id,p_blueprint_id,
 p_expected_content_version_id,p_expected_guidance_version_id,p_expected_draft_revision,v_saved.id);
 select c.* into v_after from public.classrooms c where c.id=p_classroom_id;
 if not found or v_after.teacher_id is distinct from p_actor_id or v_after.archived_at is not null
 or v_after.source_blueprint_id is distinct from p_blueprint_id or v_after.source_blueprint_version_id is distinct from p_expected_content_version_id
 or v_after.authoring_guidance_version_id is distinct from v_saved.id
 or v_adopted->>'guidance_version_id' is distinct from v_saved.id::text
 or v_adopted->>'guidance_version_number' is distinct from v_saved.version_number::text
 then raise exception using errcode='PT503',message='class_guidance_adoption_invalid'; end if;
 return pg_catalog.jsonb_build_object('actor_id',p_actor_id,'classroom_id',p_classroom_id,'blueprint_id',p_blueprint_id,
 'content_version_id',p_expected_content_version_id,'previous_guidance_version_id',p_expected_guidance_version_id,'source_sha256',p_source_sha256,
 'guidance_version',pg_catalog.jsonb_build_object('id',v_saved.id,'course_blueprint_id',v_saved.course_blueprint_id,'version_number',v_saved.version_number,
 'source_draft_revision',v_saved.source_draft_revision,'snapshot_sha256',v_saved.snapshot_sha256));
exception
 when lock_not_available then raise exception using errcode='PT409',message='class_guidance_adoption_busy';
 when sqlstate '40001' or sqlstate '55000' then
  get stacked diagnostics v_message=message_text;
  if sqlstate='40001' and v_message in ('classroom_operation_busy','course_blueprint_purge_lock_busy') then raise exception using errcode='PT409',message='class_guidance_adoption_busy';
  elsif sqlstate='40001' and v_message in ('Blueprint Draft changed; rebuild the Version','Blueprint guidance changed; review and retry','Guidance Version is unavailable or stale') then raise exception using errcode='PT409',message='class_guidance_adoption_changed';
  elsif sqlstate='55000' and v_message in ('classroom_purge_active','course_blueprint_purge_in_progress') then raise exception using errcode='PT503',message='class_guidance_adoption_fenced';
  else raise; end if;
end;
$function$;
alter function public.save_and_adopt_classroom_guidance_for_owner_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,text,text) owner to postgres;
revoke all on function public.save_and_adopt_classroom_guidance_for_owner_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.save_and_adopt_classroom_guidance_for_owner_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,text,text) to service_role;

commit;
