-- Dormant shared-admission owner workflow. No inherited function, table, RLS,
-- runtime flag or managed cleanup worker is changed. Admission remains server-owned.
begin;

create function public.test_owner_workflow_v1(
  p_actor_id uuid, p_test_id uuid, p_classroom_id uuid, p_operation text,
  p_payload jsonb, p_expected_test jsonb, p_deadline timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '1s'
as $function$
declare
  v_classroom_id uuid;
  v_classroom public.classrooms%rowtype;
  v_test public.tests%rowtype;
  v_after public.tests%rowtype;
  v_object public.managed_storage_objects%rowtype;
  v_document jsonb;
  v_result jsonb := 'null'::jsonb;
  v_inner jsonb;
  v_ids uuid[];
  v_eligible uuid[];
  v_path text;
  v_document_id text;
  v_purpose text;
  v_object_id uuid;
  v_content_type text;
  v_phase_deadline timestamptz := least(p_deadline, pg_catalog.clock_timestamp() + interval '8 seconds');
begin
  if p_actor_id is null or p_test_id is null or p_deadline is null or not pg_catalog.isfinite(p_deadline)
    or p_operation is null or p_operation not in ('inspect','update','student-access','reserve','upload','verify','cancel','sync','document')
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or pg_catalog.octet_length(p_payload::text) > 2097152 then
    raise exception using errcode = 'PT400', message = 'test_owner_invalid_input';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then
    raise exception using errcode = 'PT503', message = 'test_owner_deadline';
  end if;
  if p_deadline > pg_catalog.clock_timestamp() + interval '30 seconds' then
    raise exception using errcode = 'PT400', message = 'test_owner_invalid_deadline';
  end if;
  -- Take the same protocol row before Classroom/Test and object locks, without
  -- advancing writer_revision for reads. Delegated writers call the existing
  -- lock_managed_storage_protocol themselves. Try locks bound legacy inversions.
  perform 1 from public.managed_storage_settings where singleton for share nowait;
  if not found then raise exception using errcode = 'PT503', message = 'test_owner_invalid_source'; end if;
  select classroom_id into v_classroom_id from public.tests where id = p_test_id;
  if not found then raise exception using errcode = 'PT404', message = 'test_owner_not_found'; end if;
  if (p_classroom_id is not null and p_classroom_id is distinct from v_classroom_id)
    or (p_operation <> 'inspect' and p_classroom_id is null) then
    raise exception using errcode = 'PT409', message = 'test_owner_parent_changed';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0))
    or not public.classroom_purge_try_lock(v_classroom_id) then
    raise exception using errcode = 'PT409', message = 'test_owner_busy';
  end if;
  perform private.try_lock_classroom_membership_change(v_classroom_id);
  select * into v_classroom from public.classrooms where id = v_classroom_id for update nowait;
  if not found then raise exception using errcode = 'PT404', message = 'test_owner_not_found'; end if;
  if v_classroom.teacher_id is distinct from p_actor_id then
    raise exception using errcode = 'PT403', message = 'test_owner_forbidden';
  end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'), false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'), false)
    or coalesce(pg_catalog.current_setting('pika.identity_mapping', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.classroom_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.course_blueprint_purge_finalize', true), 'off') = 'on'
    or coalesce(pg_catalog.current_setting('pika.student_purge_finalize', true), 'off') = 'on' then
    raise exception using errcode = 'PT403', message = 'test_owner_fenced';
  end if;
  perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  if exists(select 1 from public.student_purge_operations operation
    join private.student_provider_cleanup_bindings binding on binding.operation_id = operation.id
    where operation.classroom_id = v_classroom_id and operation.status <> 'completed') then
    raise exception using errcode = 'PT403', message = 'test_owner_fenced';
  end if;
  perform 1 from public.users where id = p_actor_id for key share nowait;
  if not found then raise exception using errcode = 'PT403', message = 'test_owner_forbidden'; end if;
  select * into v_test from public.tests where id = p_test_id and classroom_id = v_classroom_id for update nowait;
  if not found then raise exception using errcode = 'PT409', message = 'test_owner_parent_changed'; end if;
  if p_operation not in ('inspect','document') and (v_classroom.archived_at is not null or v_test.blueprint_archived_at is not null) then
    raise exception using errcode = 'PT403', message = 'test_owner_read_only';
  end if;
  if pg_catalog.octet_length(pg_catalog.to_jsonb(v_test)::text) > 2097152 then
    raise exception using errcode = 'PT503', message = 'test_owner_source_limit';
  end if;
  if p_operation in ('update','sync') and p_expected_test is distinct from pg_catalog.to_jsonb(v_test) then
    raise exception using errcode = 'PT409', message = 'test_owner_source_changed';
  end if;

  if p_operation = 'inspect' then
    if p_payload <> '{}'::jsonb then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;
  elsif p_operation = 'update' then
    if p_payload = '{}'::jsonb or p_payload - array['title','show_results','documents'] <> '{}'::jsonb
      or (p_payload ? 'title' and (pg_catalog.jsonb_typeof(p_payload->'title') <> 'string' or length(btrim(p_payload->>'title')) not between 1 and 10000))
      or (p_payload ? 'show_results' and pg_catalog.jsonb_typeof(p_payload->'show_results') <> 'boolean')
      or (p_payload ? 'documents' and pg_catalog.jsonb_typeof(p_payload->'documents') <> 'array') then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_input';
    end if;
    if v_test.status = 'draft' and (p_payload ? 'title' or p_payload ? 'show_results') then
      raise exception using errcode = 'PT400', message = 'test_owner_use_draft';
    end if;
    if p_payload ? 'documents' and (pg_catalog.jsonb_array_length(p_payload->'documents') > 20
      or exists(select 1 from pg_catalog.jsonb_array_elements(p_payload->'documents') document
        group by document->>'id' having count(*) > 1)) then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_documents';
    end if;
    -- Preserve imported/current references, but a new upload must have been
    -- reserved for this exact Test and current actor, even within one Classroom.
    for v_document in select value from pg_catalog.jsonb_array_elements(coalesce(p_payload->'documents',v_test.documents)) loop
      if v_document->>'source' = 'upload' and not exists(
        select 1 from pg_catalog.jsonb_array_elements(v_test.documents) existing
        where existing->>'id' = v_document->>'id' and existing->>'source' = 'upload'
          and existing->>'storage_path' is not distinct from v_document->>'storage_path'
          and existing->>'managed_object_id' is not distinct from v_document->>'managed_object_id'
      ) then
        select * into v_object from public.managed_storage_objects
          where id = (v_document->>'managed_object_id')::uuid for update nowait;
        if not found or v_object.classroom_id is distinct from v_classroom_id
          or v_object.storage_bucket <> 'test-documents' or v_object.storage_path is distinct from v_document->>'storage_path'
          or v_object.purpose <> 'teacher_test_material' or v_object.status not in ('verified','ready')
          or v_object.resource_type is distinct from 'test' or v_object.resource_id is distinct from p_test_id
          or v_object.created_by_user_id is distinct from p_actor_id then
          raise exception using errcode = 'PT403', message = 'test_owner_document_forbidden';
        end if;
      end if;
      if v_document->>'source' = 'link' and v_document ? 'snapshot_path' and not exists(
        select 1 from pg_catalog.jsonb_array_elements(v_test.documents) existing
        where existing->>'id' = v_document->>'id' and existing->>'source' = 'link' and existing->>'url' = v_document->>'url'
          and existing->>'snapshot_path' = v_document->>'snapshot_path'
          and existing->>'snapshot_managed_object_id' is not distinct from v_document->>'snapshot_managed_object_id'
      ) then raise exception using errcode = 'PT403', message = 'test_owner_document_forbidden'; end if;
    end loop;
    v_inner := public.update_test_documents_atomic(p_actor_id,p_test_id,v_test.status,v_test.documents,
      case when p_payload ? 'documents' then p_payload->'documents' else v_test.documents end,
      p_payload ? 'title',p_payload->>'title',false,v_test.status,p_payload ? 'show_results',(p_payload->>'show_results')::boolean);
    v_result := pg_catalog.jsonb_build_object('cleanup_paths',v_inner->'cleanup_paths');
  elsif p_operation = 'student-access' then
    if p_payload - array['state','student_ids'] <> '{}'::jsonb or p_payload->>'state' is null
      or p_payload->>'state' not in ('open','closed') or pg_catalog.jsonb_typeof(p_payload->'student_ids') is distinct from 'array' then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
    end if;
    if pg_catalog.jsonb_array_length(p_payload->'student_ids') not between 1 and 100 or v_test.status = 'draft' then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_selection';
    end if;
    select array_agg(distinct value::uuid order by value::uuid) into v_ids from pg_catalog.jsonb_array_elements_text(p_payload->'student_ids');
    select coalesce(array_agg(student_id order by student_id),array[]::uuid[]) into v_eligible from (
      select student_id from public.classroom_enrollments where classroom_id = v_classroom_id
        and student_id = any(v_ids) and student_id <> p_actor_id order by student_id for share nowait
    ) enrolled;
    if cardinality(v_eligible) = 0 then raise exception using errcode = 'PT400', message = 'test_owner_no_selected_members'; end if;
    v_inner := public.update_test_student_access_atomic(p_test_id,v_eligible,p_payload->>'state',p_actor_id);
    v_result := pg_catalog.jsonb_build_object('updated_count',cardinality(v_eligible),'skipped_count',cardinality(v_ids)-cardinality(v_eligible),
      'locked_count',v_inner->'locked_count','unlocked_count',v_inner->'unlocked_count','state',p_payload->>'state');
  elsif p_operation = 'reserve' then
    v_object_id := (p_payload->>'object_id')::uuid; v_document_id := p_payload->>'document_id';
    v_path := p_payload->>'storage_path'; v_purpose := p_payload->>'purpose'; v_content_type := p_payload->>'content_type';
    if v_object_id is null or v_document_id is null or v_path is null or v_content_type is null
      or v_purpose is null or v_purpose not in ('teacher_test_material','test_execution_snapshot')
      or p_payload->>'byte_size' is null or (p_payload->>'byte_size')::bigint not between 1 and 26214400 then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_reservation';
    end if;
    perform v_document_id::uuid;
    if v_purpose = 'test_execution_snapshot' then
      select document into v_document from pg_catalog.jsonb_array_elements(v_test.documents) document
        where document->>'id' = v_document_id and document->>'source' = 'link' and document->>'url' = p_payload->>'expected_url';
      if not found or v_path <> 'link-docs/'||p_actor_id::text||'/'||p_test_id::text||'/'||v_document_id||'/snapshots/'||v_object_id::text
        or v_content_type not in ('text/html','application/pdf','text/plain','text/markdown') then
        raise exception using errcode = 'PT409', message = 'test_owner_document_changed';
      end if;
    elsif v_path !~ ('^classrooms/'||v_classroom_id::text||'/tests/'||p_test_id::text||'/documents/'||v_document_id||'/(images/)?'||v_object_id::text||'\.[a-z0-9]+$')
      or v_content_type not in ('application/pdf','text/plain','text/markdown','text/csv','application/json','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg') then
      raise exception using errcode = 'PT400', message = 'test_owner_invalid_reservation';
    end if;
    select * into v_object from public.begin_managed_storage_upload(v_object_id,'test-documents',v_path,v_classroom_id,null,null,
      v_purpose,p_actor_id,null,'test',p_test_id,v_content_type,(p_payload->>'byte_size')::bigint);
  elsif p_operation in ('upload','verify','cancel','sync') then
    v_object_id := (p_payload->>'managed_object_id')::uuid;
    select * into v_object from public.managed_storage_objects where id = v_object_id for update nowait;
    if not found or v_object.storage_bucket <> 'test-documents' or v_object.classroom_id is distinct from v_classroom_id
      or v_object.course_blueprint_id is not null or v_object.provisional_owner_id is not null
      or v_object.resource_type is distinct from 'test' or v_object.resource_id is distinct from p_test_id
      or v_object.created_by_user_id is distinct from p_actor_id then
      raise exception using errcode = 'PT404', message = 'test_owner_upload_not_found';
    end if;
    if p_operation = 'cancel' then
      -- Under the object lock, never cancel a verified concurrent upload or an
      -- image reservation. Expiry retains durable cleanup authority for both.
      if v_object.purpose = 'teacher_test_material' and v_object.status = 'reserved'
        and v_object.content_type not in ('image/png', 'image/jpeg') then
        v_result := pg_catalog.to_jsonb(public.queue_managed_storage_cleanup(v_object.id,'test_document_client_upload_failed'));
      else v_result := 'false'::jsonb; end if;
    else
      v_document_id := p_payload->>'document_id';
      if v_document_id is null then raise exception using errcode = 'PT400', message = 'test_owner_invalid_input'; end if;
      perform v_document_id::uuid;
      if v_object.purpose = 'teacher_test_material' then
        if v_object.storage_path !~ ('^classrooms/'||v_classroom_id::text||'/tests/'||p_test_id::text||'/documents/'||v_document_id||'/(images/)?'||v_object.id::text||'\.[a-z0-9]+$') then
          raise exception using errcode = 'PT404', message = 'test_owner_upload_not_found';
        end if;
      elsif v_object.purpose = 'test_execution_snapshot' then
        select document into v_document from pg_catalog.jsonb_array_elements(v_test.documents) document
          where document->>'id' = v_document_id and document->>'source' = 'link' and document->>'url' = p_payload->>'expected_url';
        if not found or v_object.storage_path <> 'link-docs/'||p_actor_id::text||'/'||p_test_id::text||'/'||v_document_id||'/snapshots/'||v_object.id::text then
          raise exception using errcode = 'PT409', message = 'test_owner_document_changed';
        end if;
      else raise exception using errcode = 'PT404', message = 'test_owner_upload_not_found'; end if;
      if v_object.status not in ('reserved','verified') then raise exception using errcode = 'PT409', message = 'test_owner_upload_changed'; end if;
      if p_operation = 'verify' then select * into v_object from public.verify_managed_storage_upload(v_object.id); end if;
      if p_operation = 'sync' then
        if v_object.purpose <> 'test_execution_snapshot' or v_object.status <> 'verified' then
          raise exception using errcode = 'PT409', message = 'test_owner_upload_changed';
        end if;
        v_inner := public.sync_test_document_snapshot_managed_atomic(p_actor_id,p_test_id,v_document_id,p_payload->>'expected_url',
          v_object.storage_path,v_object.content_type,(p_payload->>'synced_at')::timestamptz,v_object.id);
        v_result := 'null'::jsonb;
      end if;
    end if;
  elsif p_operation = 'document' then
    v_document_id := p_payload->>'document_id';
    select document into v_document from pg_catalog.jsonb_array_elements(v_test.documents) document where document->>'id' = v_document_id;
    if not found or v_document->>'source' is distinct from p_payload->>'source' then
      raise exception using errcode = 'PT404', message = 'test_owner_document_not_found';
    end if;
    v_path := case when p_payload->>'source' = 'upload' then v_document->>'storage_path' else v_document->>'snapshot_path' end;
    v_object_id := (case when p_payload->>'source' = 'upload' then v_document->>'managed_object_id' else v_document->>'snapshot_managed_object_id' end)::uuid;
    if v_path is null then raise exception using errcode = 'PT404', message = 'test_owner_document_not_found'; end if;
    select * into v_object from public.managed_storage_objects where storage_bucket = 'test-documents' and storage_path = v_path
      and (v_object_id is null or id = v_object_id) for share nowait;
    if not found or v_object.status <> 'ready' or v_object.classroom_id is distinct from v_classroom_id
      or v_object.provisional_owner_id is not null or v_object.course_blueprint_id is not null
      or v_object.purpose is distinct from case when p_payload->>'source' = 'upload' then 'teacher_test_material' else 'test_execution_snapshot' end
      or not exists(select 1 from public.managed_storage_json_references reference
        where reference.test_id = p_test_id and reference.managed_object_id = v_object.id
          and reference.storage_bucket = 'test-documents' and reference.storage_path = v_path) then
      raise exception using errcode = 'PT404', message = 'test_owner_document_not_found';
    end if;
    v_result := pg_catalog.jsonb_build_object('document',v_document,'content_type',v_object.content_type);
  end if;

  if p_operation in ('reserve','upload','verify') then
    if v_object.classroom_id is distinct from v_classroom_id or v_object.created_by_user_id is distinct from p_actor_id
      or v_object.resource_type is distinct from 'test' or v_object.resource_id is distinct from p_test_id
      or v_object.storage_bucket <> 'test-documents' or v_object.status not in ('reserved','verified')
      or v_object.content_type is null or v_object.byte_size is null
      or (p_operation = 'reserve' and (v_object.storage_path is distinct from v_path or v_object.purpose is distinct from v_purpose
        or v_object.content_type is distinct from v_content_type or v_object.byte_size is distinct from (p_payload->>'byte_size')::bigint)) then
      raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
    end if;
    v_result := pg_catalog.jsonb_build_object('id',v_object.id,'classroom_id',v_object.classroom_id,'storage_bucket',v_object.storage_bucket,
      'storage_path',v_object.storage_path,'purpose',v_object.purpose,'created_by_user_id',v_object.created_by_user_id,
      'resource_type',v_object.resource_type,'resource_id',v_object.resource_id,'status',v_object.status,
      'content_type',v_object.content_type,'byte_size',v_object.byte_size);
  end if;
  select * into v_after from public.tests where id = p_test_id and classroom_id = v_classroom_id;
  if not found or not exists(select 1 from public.classrooms where id = v_classroom_id and teacher_id = p_actor_id)
    or (p_operation = 'update' and pg_catalog.to_jsonb(v_after) - array['title','show_results','documents','updated_at']
      is distinct from pg_catalog.to_jsonb(v_test) - array['title','show_results','documents','updated_at'])
    or (p_operation = 'update' and (v_after.title is distinct from case when p_payload ? 'title' then p_payload->>'title' else v_test.title end
      or v_after.show_results is distinct from case when p_payload ? 'show_results' then (p_payload->>'show_results')::boolean else v_test.show_results end
      or v_after.documents is distinct from case when p_payload ? 'documents' then p_payload->'documents' else v_test.documents end))
    or (p_operation = 'sync' and (pg_catalog.to_jsonb(v_after) - array['documents','updated_at']
      is distinct from pg_catalog.to_jsonb(v_test) - array['documents','updated_at']
      or v_after.documents is distinct from (
        select pg_catalog.jsonb_agg(case when document->>'id' = v_document_id then
          document || pg_catalog.jsonb_build_object('snapshot_path',v_object.storage_path,'snapshot_managed_object_id',v_object.id,
            'snapshot_content_type',v_object.content_type,'synced_at',(p_payload->>'synced_at')::timestamptz)
          else document end order by ordinal)
        from pg_catalog.jsonb_array_elements(v_test.documents) with ordinality documents(document,ordinal))))
    or (p_operation not in ('update','sync','student-access') and v_after is distinct from v_test) then
    raise exception using errcode = 'PT503', message = 'test_owner_postcondition';
  end if;
  if pg_catalog.clock_timestamp() >= v_phase_deadline then raise exception using errcode = 'PT503', message = 'test_owner_deadline'; end if;
  return pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',v_classroom_id,'test_id',p_test_id,
    'operation',p_operation,'test',pg_catalog.to_jsonb(v_after),'result',v_result);
exception
  when serialization_failure then raise exception using errcode = 'PT409', message = 'test_owner_source_changed';
  when lock_not_available or deadlock_detected then raise exception using errcode = 'PT409', message = 'test_owner_busy';
  when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range then
    raise exception using errcode = 'PT400', message = 'test_owner_invalid_input';
end;
$function$;
alter function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) owner to postgres;
revoke all on function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamptz) to service_role;
commit;
