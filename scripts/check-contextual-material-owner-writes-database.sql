-- Standalone psql transaction harness; definitions/migrations are never applied here.
begin;
set local lock_timeout = '4s';
set local statement_timeout = '45s';
do $security$
declare v_signature text;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version = '234') then
    raise exception 'Reviewed migration234 must already be applied; this harness never applies it';
  end if;
  foreach v_signature in array array[
    'public.create_classwork_material_for_owner_v2(uuid,uuid,text,jsonb,boolean)',
    'public.update_classwork_material_for_owner_v1(uuid,uuid,uuid,jsonb)',
    'public.delete_classwork_material_for_owner_v1(uuid,uuid,uuid)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
      or not exists(select 1 from pg_proc where oid = to_regprocedure(v_signature)
        and prosecdef and proconfig @> array['search_path=""']::text[])
      or exists(select 1 from pg_proc procedure,
        lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
        where procedure.oid = to_regprocedure(v_signature) and acl.grantee = 0 and acl.privilege_type = 'EXECUTE') then
      raise exception 'Material owner security metadata failed: %', v_signature;
    end if;
  end loop;
  foreach v_signature in array array[
    'private.material_owner_write_title_v1(text)',
    'private.material_owner_write_utf16_length_v1(text)',
    'private.valid_material_owner_write_content_v1(jsonb)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'Private helper directly executable: %', v_signature;
    end if;
  end loop;
  if private.material_owner_write_utf16_length_v1('') <> 0
    or private.material_owner_write_utf16_length_v1('a😀汉') <> 4
    or private.material_owner_write_title_v1(chr(160) || chr(12288)) <> ''
    or private.valid_material_owner_write_content_v1('{"type":"doc","content":[{"type":""}]}')
    or private.valid_material_owner_write_content_v1('{"type":"doc","content":[{"type":"text","text":4}]}')
    or not private.valid_material_owner_write_content_v1('{"type":"doc","content":[{"type":"text","text":"汉😀"}]}') then
    raise exception 'SQL/TypeScript Unicode and content validation contract differs';
  end if;
end;
$security$;

insert into public.users(id,email,role) values
  ('c2340000-0000-4000-8000-000000000001','material-owner-234-student@example.invalid','student'),
  ('c2340000-0000-4000-8000-000000000002','material-owner-234-teacher@example.invalid','teacher'),
  ('c2340000-0000-4000-8000-000000000003','material-owner-234-member@example.invalid','teacher');
set local role service_role;
select public.set_effective_feature_entitlement_v1(gen_random_uuid(), owner_id, 'classrooms.create',
  'manual', true, clock_timestamp(), null, 10, 'test:material-owner-234', 'material_owner_rollback',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = owner_id and feature_key = 'classrooms.create'), 0))
from (values ('c2340000-0000-4000-8000-000000000001'::uuid),
  ('c2340000-0000-4000-8000-000000000002'::uuid)) owners(owner_id);
reset role;
insert into public.classrooms(id,teacher_id,title,class_code) values
  ('c2340000-0000-4000-8000-000000000010','c2340000-0000-4000-8000-000000000001','Material owner234','C234LIVE'),
  ('c2340000-0000-4000-8000-000000000011','c2340000-0000-4000-8000-000000000002','Material teacher234','C234OTHER');
insert into public.classroom_enrollments(classroom_id,student_id)
  values('c2340000-0000-4000-8000-000000000010','c2340000-0000-4000-8000-000000000003');
insert into public.course_blueprints(id,teacher_id,title)
  values('c2340000-0000-4000-8000-000000000020','c2340000-0000-4000-8000-000000000002','Material lineage234');
insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,
  source_draft_revision,snapshot_json,snapshot_sha256,created_by)
  select 'c2340000-0000-4000-8000-000000000021',id,1,content_revision,'{}',repeat('a',64),teacher_id
  from public.course_blueprints where id = 'c2340000-0000-4000-8000-000000000020';

create temp table material_owner_fixture(material_id uuid);
grant all on material_owner_fixture to service_role;
set local role service_role;
do $behavior$
declare
  v_actor uuid := 'c2340000-0000-4000-8000-000000000001';
  v_teacher uuid := 'c2340000-0000-4000-8000-000000000002';
  v_member uuid := 'c2340000-0000-4000-8000-000000000003';
  v_class uuid := 'c2340000-0000-4000-8000-000000000010';
  v_other uuid := 'c2340000-0000-4000-8000-000000000011';
  v_id uuid;
  v_row jsonb;
  v_before jsonb;
  v_patch jsonb;
  v_release timestamptz;
  v_archive bigint;
  v_blueprint bigint;
  v_operation uuid;
begin
  v_row := public.create_classwork_material_for_owner_v2(v_actor,v_class,'读 🐦 café',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"汉字 🐦"}]}]}',true);
  v_id := (v_row->'material'->>'id')::uuid;
  insert into material_owner_fixture values(v_id);
  if v_row->>'actor_id' <> v_actor::text or v_row->>'classroom_id' <> v_class::text
    or (select count(*) from jsonb_object_keys(v_row->'material')) <> 14
    or v_row->'material'->>'artifact_id' is null or v_row->'material'->>'created_by' <> v_actor::text
    or v_row->'material'->>'released_at' is not null
    or v_row->'material'->>'source_artifact_id' is not null
    or v_row->'material'->>'source_blueprint_version_id' is not null
    or v_row->'material'->>'blueprint_archived_at' is not null then
    raise exception 'Full creation/evidence/lineage contract failed';
  end if;
  perform public.create_classwork_material_for_owner_v2(v_teacher,v_other,'Teacher owner','{"type":"doc"}',false);
  -- Publish null release; repeat false, preserve a future release even on a draft,
  -- leave publication untouched when absent, and clear only for explicit true.
  v_row := public.update_classwork_material_for_owner_v1(v_actor,v_class,v_id,'{"is_draft":false}')->'material';
  v_release := (v_row->>'released_at')::timestamptz;
  if v_release is null or v_row->>'is_draft' <> 'false' then raise exception 'Publish null release failed'; end if;
  select revision into v_archive from public.classroom_archive_revisions where classroom_id = v_class;
  select blueprint_source_revision into v_blueprint from public.classrooms where id = v_class;
  perform public.update_classwork_material_for_owner_v1(v_actor,v_class,v_id,'{"is_draft":false}');
  if (select released_at from public.classwork_materials where id = v_id) is distinct from v_release
    or (select revision from public.classroom_archive_revisions where classroom_id = v_class) <= v_archive
    or (select blueprint_source_revision from public.classrooms where id = v_class) <> v_blueprint then
    raise exception 'Identical publication must UPDATE/archive-revise without Blueprint source revision';
  end if;
  update public.classwork_materials set is_draft = true, released_at = '2099-01-01T00:00:00Z',
    source_artifact_id = gen_random_uuid(), blueprint_archived_at = clock_timestamp(),
    source_blueprint_version_id = 'c2340000-0000-4000-8000-000000000021' where id = v_id;
  v_before := (select to_jsonb(material) from public.classwork_materials material where id = v_id);
  perform public.update_classwork_material_for_owner_v1(v_actor,v_class,v_id,'{"title":"Absent publication"}');
  if (select is_draft from public.classwork_materials where id = v_id) is distinct from true
    or (select released_at from public.classwork_materials where id = v_id) <> '2099-01-01T00:00:00Z'::timestamptz then
    raise exception 'Absent publication lost draft/future historical release';
  end if;
  perform public.update_classwork_material_for_owner_v1(v_actor,v_class,v_id,'{"is_draft":false}');
  if (select released_at from public.classwork_materials where id = v_id) <> '2099-01-01T00:00:00Z'::timestamptz then
    raise exception 'False publication replaced historical future release';
  end if;
  perform public.update_classwork_material_for_owner_v1(v_actor,v_class,v_id,'{"is_draft":true}');
  if (select released_at from public.classwork_materials where id = v_id) is not null then
    raise exception 'True publication retained release';
  end if;
  select revision into v_archive from public.classroom_archive_revisions where classroom_id = v_class;
  select blueprint_source_revision into v_blueprint from public.classrooms where id = v_class;
  v_row := public.update_classwork_material_for_owner_v1(v_actor,v_class,v_id,'{"is_draft":true}')->'material';
  if (select revision from public.classroom_archive_revisions where classroom_id = v_class) <= v_archive
    or (select blueprint_source_revision from public.classrooms where id = v_class) <> v_blueprint then
    raise exception 'Identical true publication omitted UPDATE or changed Blueprint';
  end if;
  -- Transfer and retain every immutable historical field, including negative positions.
  update public.classrooms set teacher_id = v_teacher where id = v_class;
  update public.classwork_materials set position = -5 where id = v_id;
  v_before := (select to_jsonb(material) from public.classwork_materials material where id = v_id);
  v_row := public.update_classwork_material_for_owner_v1(v_teacher,v_class,v_id,
    jsonb_build_object('title',repeat('😀',300)))->'material';
  if (v_row - array['title','updated_at']) is distinct from (v_before - array['title','updated_at']) then
    raise exception 'Transfer edit changed historical author/identity/position/lineage';
  end if;
  foreach v_patch in array array['{}'::jsonb,'{"created_by":"c2340000-0000-4000-8000-000000000003"}',
    '{"title":""}','{"title":" 　"}','{"is_draft":"false"}','{"content":{"type":"doc","content":[{}]}}',
    '{"released_at":null}','{"position":3}','{"artifact_id":null}','{"source_artifact_id":null}'] loop
    begin perform public.update_classwork_material_for_owner_v1(v_teacher,v_class,v_id,v_patch);
      raise exception 'Invalid/authority-bearing PATCH admitted'; exception when sqlstate '22023' then null; end;
  end loop;
  begin perform public.create_classwork_material_for_owner_v2(v_teacher,v_class,repeat('😀',251),'{}',true);
    raise exception 'Invalid UTF16 create admitted'; exception when sqlstate '22023' then null; end;
  begin perform public.update_classwork_material_for_owner_v1(v_actor,v_class,v_id,'{"title":"former owner"}');
    raise exception 'Former owner admitted'; exception when sqlstate '42501' then null; end;
  begin perform public.delete_classwork_material_for_owner_v1(v_member,v_class,v_id);
    raise exception 'Member admitted'; exception when sqlstate '42501' then null; end;
  begin perform public.update_classwork_material_for_owner_v1(v_teacher,v_other,v_id,'{"title":"crossclass"}');
    raise exception 'Crossclass resource admitted'; exception when sqlstate 'PT404' then null; end;
  begin perform public.delete_classwork_material_for_owner_v1(v_teacher,gen_random_uuid(),v_id);
    raise exception 'Missing parent admitted'; exception when sqlstate 'P0002' then null; end;
  update public.classrooms set archived_at = clock_timestamp() where id = v_class;
  begin perform public.delete_classwork_material_for_owner_v1(v_teacher,v_class,v_id);
    raise exception 'Archived owner admitted'; exception when sqlstate '42501' then null; end;
  update public.classrooms set archived_at = null where id = v_class;
  -- Real lifecycle rejection and transaction rollback without changing global settings.
  begin
    v_operation := gen_random_uuid();
    insert into public.classroom_purge_operations(id,teacher_id,classroom_id,classroom_title,
      request_sha256,status,source_revision,impact_summary,retryable,error_code)
      select v_operation,v_teacher,id,title,repeat('9',64),'failed',1,'{}',true,'database_finalize_failed'
      from public.classrooms where id = v_class;
    insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values(v_class,v_operation,v_teacher);
    begin perform public.update_classwork_material_for_owner_v1(v_teacher,v_class,v_id,'{"title":"fenced"}');
      raise exception 'Lifecycle fenced update admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.delete_classwork_material_for_owner_v1(v_teacher,v_class,v_id);
      raise exception 'Lifecycle fenced delete admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.create_classwork_material_for_owner_v2(v_teacher,v_class,'Fenced','{"type":"doc"}',true);
      raise exception 'Lifecycle fenced create admitted'; exception when sqlstate 'PT409' then null; end;
    raise exception using errcode = 'ZX001', message = 'Rollback synthetic lifecycle fence';
  exception when sqlstate 'ZX001' then null; end;
  begin
    insert into public.attendance_decommission_operations(id,classroom_id,teacher_id,
      installation_ref,roster_ref,actor_principal_ref)
      values(gen_random_uuid(),v_class,v_teacher,'material-rollback','material-roster','material-principal');
    begin perform public.update_classwork_material_for_owner_v1(v_teacher,v_class,v_id,'{"title":"decommission"}');
      raise exception 'Decommission update admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.delete_classwork_material_for_owner_v1(v_teacher,v_class,v_id);
      raise exception 'Decommission delete admitted'; exception when sqlstate 'PT409' then null; end;
    begin perform public.create_classwork_material_for_owner_v2(v_teacher,v_class,'Decommission','{"type":"doc"}',true);
      raise exception 'Decommission create admitted'; exception when sqlstate 'PT409' then null; end;
    raise exception using errcode = 'ZX001', message = 'Rollback synthetic decommission fence';
  exception when sqlstate 'ZX001' then null; end;
  begin
    v_operation := gen_random_uuid();
    insert into public.course_blueprint_purge_operations(id,course_blueprint_id,teacher_id,
      request_sha256,inventory_sha256,finalization_sha256,source_revision,status,retryable)
      values(v_operation,'c2340000-0000-4000-8000-000000000020',v_teacher,
        repeat('9',64),repeat('8',64),repeat('7',64),1,'failed',true);
    insert into public.course_blueprint_purge_fences(course_blueprint_id,operation_id)
      values('c2340000-0000-4000-8000-000000000020',v_operation);
    v_before := (select to_jsonb(material) from public.classwork_materials material where id = v_id);
    begin perform public.delete_classwork_material_for_owner_v1(v_teacher,v_class,v_id);
      raise exception 'Blueprint-fenced linked delete admitted'; exception when sqlstate 'PT409' then null; end;
    if (select to_jsonb(material) from public.classwork_materials material where id = v_id) is distinct from v_before then
      raise exception 'Blueprint fence rejection changed linked material';
    end if;
    -- UPDATE omits lineage columns, so ordinary copied content stays usable.
    v_row := public.update_classwork_material_for_owner_v1(v_teacher,v_class,v_id,
      '{"content":{"type":"doc","content":[]}}')->'material';
    if v_row->>'source_blueprint_version_id' is distinct from 'c2340000-0000-4000-8000-000000000021' then
      raise exception 'Content update under Blueprint fence changed lineage';
    end if;
    raise exception using errcode = 'ZX001', message = 'Rollback synthetic Blueprint fence';
  exception when sqlstate 'ZX001' then null; end;
end;
$behavior$;
reset role;

create function pg_temp.material_owner_state()
returns jsonb language sql as $function$
  select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(material) order by id)
      from public.classwork_materials material where classroom_id in
      ('c2340000-0000-4000-8000-000000000010','c2340000-0000-4000-8000-000000000011')),
    'archive',(select jsonb_agg(to_jsonb(revision) order by classroom_id) from public.classroom_archive_revisions revision
      where classroom_id in ('c2340000-0000-4000-8000-000000000010','c2340000-0000-4000-8000-000000000011')),
    'blueprint',(select jsonb_agg(jsonb_build_object('id',id,'revision',blueprint_source_revision) order by id)
      from public.classrooms where id in ('c2340000-0000-4000-8000-000000000010','c2340000-0000-4000-8000-000000000011')));
$function$;
create function pg_temp.material_owner_probe()
returns trigger language plpgsql as $function$
declare v_mode text := current_setting('pika.material_owner_probe',true);
begin
  if pg_trigger_depth() > 1 or coalesce(new.classroom_id,old.classroom_id)::text not in
    ('c2340000-0000-4000-8000-000000000010','c2340000-0000-4000-8000-000000000011') then
    return coalesce(new,old);
  end if;
  if tg_when = 'BEFORE' then
    if v_mode = 'suppress' then return null;
    elsif v_mode = 'before_rebind' and tg_op <> 'DELETE' then
      new.classroom_id := 'c2340000-0000-4000-8000-000000000011';
    elsif v_mode = 'immutable' and tg_op = 'UPDATE' then new.artifact_id := gen_random_uuid();
    end if;
    return coalesce(new,old);
  end if;
  if v_mode = 'late' then raise exception using errcode = '55000', message = 'Forced late retryable failure';
  elsif v_mode = 'after_rebind' and tg_op <> 'DELETE' then
    update public.classwork_materials set classroom_id = 'c2340000-0000-4000-8000-000000000011' where id = new.id;
  elsif v_mode = 'after_change' and tg_op <> 'DELETE' then
    update public.classwork_materials set title = 'After-trigger substitution' where id = new.id;
  elsif v_mode = 'resurrect' and tg_op = 'DELETE' then
    insert into public.classwork_materials select old.*;
  end if;
  return coalesce(new,old);
end;
$function$;
create trigger zz_material_owner_before_probe before insert or update or delete on public.classwork_materials
  for each row execute function pg_temp.material_owner_probe();
create trigger zz_material_owner_after_probe after insert or update or delete on public.classwork_materials
  for each row execute function pg_temp.material_owner_probe();
do $rollback$
declare
  v_mode text;
  v_operation text;
  v_before jsonb;
  v_id uuid := (select material_id from material_owner_fixture);
  v_owner uuid := 'c2340000-0000-4000-8000-000000000002';
  v_class uuid := 'c2340000-0000-4000-8000-000000000010';
begin
  foreach v_operation in array array['create','update','delete'] loop
    foreach v_mode in array case when v_operation = 'delete' then array['suppress','late','resurrect']
      when v_operation = 'update' then array['suppress','late','before_rebind','after_rebind','after_change','immutable']
      else array['suppress','late','before_rebind','after_rebind','after_change'] end loop
      v_before := pg_temp.material_owner_state();
      perform set_config('pika.material_owner_probe',v_mode,true);
      begin
        if v_operation = 'create' then
          perform public.create_classwork_material_for_owner_v2(v_owner,v_class,'Probe','{"type":"doc"}',true);
        elsif v_operation = 'update' then
          perform public.update_classwork_material_for_owner_v1(v_owner,v_class,v_id,'{"title":"Probe"}');
        else perform public.delete_classwork_material_for_owner_v1(v_owner,v_class,v_id);
        end if;
        raise exception 'Expected rollback for % %',v_operation,v_mode;
      exception when sqlstate 'PT409' then null; end;
      perform set_config('pika.material_owner_probe','',true);
      if pg_temp.material_owner_state() is distinct from v_before then
        raise exception 'Row/archive/Blueprint state escaped rollback for % %',v_operation,v_mode;
      end if;
    end loop;
  end loop;
  if public.delete_classwork_material_for_owner_v1(v_owner,v_class,v_id)
    <> jsonb_build_object('deleted',true,'actor_id',v_owner,'classroom_id',v_class,'material_id',v_id)
    or exists(select 1 from public.classwork_materials where id = v_id) then
    raise exception 'Exact final deletion contract failed';
  end if;
end;
$rollback$;
rollback;
do $cleanup$
begin
  if exists(select 1 from public.users where id in ('c2340000-0000-4000-8000-000000000001',
      'c2340000-0000-4000-8000-000000000002','c2340000-0000-4000-8000-000000000003'))
    or exists(select 1 from public.classrooms where id in
      ('c2340000-0000-4000-8000-000000000010','c2340000-0000-4000-8000-000000000011'))
    or exists(select 1 from public.course_blueprints where id = 'c2340000-0000-4000-8000-000000000020')
    or exists(select 1 from public.course_blueprint_versions where id = 'c2340000-0000-4000-8000-000000000021')
    or exists(select 1 from public.account_plan_audit where subject_user_id in
      ('c2340000-0000-4000-8000-000000000001','c2340000-0000-4000-8000-000000000002','c2340000-0000-4000-8000-000000000003'))
    or exists(select 1 from public.effective_feature_entitlement_audit where subject_user_id in
      ('c2340000-0000-4000-8000-000000000001','c2340000-0000-4000-8000-000000000002','c2340000-0000-4000-8000-000000000003')) then
    raise exception 'Rollback fixture left durable row/audit residue';
  end if;
end;
$cleanup$;
select 'PASS material owner publication/tenancy/security and row/both-revision rollback proofs';
