-- Explicit live-policy adoption. All application and database activation remains off.
-- Existing strict operations retain their immutable version/policy and semantics.
begin;
set local lock_timeout = '5s';
alter table private.student_provider_cleanup_bindings
  add column pal_schema_version integer not null default 1,
  add column pal_policy text not null default 'strict-v1',
  add constraint student_provider_pal_policy check (
    (pal_schema_version=1 and pal_policy='strict-v1') or
    (pal_schema_version=2 and pal_policy='pika-live-v1'));
alter table private.student_provider_cleanup_settings add column live_enabled boolean not null default false;


create or replace function public.get_student_provider_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.student_purge_operations; v_binding private.student_provider_cleanup_bindings;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='student_cleanup_isolation_required';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  select * into v_op from public.student_purge_operations where id=p_operation_id;
  select * into v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
  if v_op.teacher_id is distinct from p_teacher_id or v_op.classroom_id is distinct from p_classroom_id
    or (v_op.status<>'completed' and v_op.student_id is distinct from p_student_id) or v_binding.generation_id is distinct from p_generation_id
    or v_binding.scope_digest is distinct from private.pal_membership_scope(p_classroom_id,p_student_id)
    or not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id)
    or (v_op.status<>'completed' and not exists(select 1 from public.student_purge_fences where operation_id=p_operation_id
      and classroom_id=p_classroom_id and student_id=p_student_id and teacher_id=p_teacher_id))
    or v_op.status not in ('provider_pending','completed') then
    raise exception using errcode='42501',message='student_provider_cleanup_forbidden';
  end if;
  return jsonb_build_object('schema_version',1,'operation_id',v_binding.operation_id,
    'generation_id',v_binding.generation_id,'status',v_op.status,

    'pal_origin',v_binding.pal_origin,'pal_integration_id',v_binding.pal_integration_id,
    'pal_reference',v_binding.pal_reference,'bara_origin',v_binding.bara_origin,
    'installation_ref',v_binding.installation_ref,'roster_ref',v_binding.roster_ref,
    'participant_ref',v_binding.participant_ref,'actor_principal_ref',v_binding.actor_principal_ref,
    'pal_receipt',v_binding.pal_receipt,'bara_receipt',v_binding.bara_receipt) || case when v_binding.pal_schema_version=2 then
      jsonb_build_object('pal_schema_version',2,'pal_policy',v_binding.pal_policy,
        'local_status',coalesce(v_op.local_academic_cleanup->>'status','not_started'),
        'blockers',case when v_op.status='completed' then '[]'::jsonb else
          to_jsonb(private.removed_academic_blockers(p_operation_id) || case when private.live_student_attendance_blockers(p_operation_id)
            then array['attendance_delivery_ownership_unknown'] else array[]::text[] end) end) else '{}'::jsonb end;
end;
$$;

create or replace function private.reserve_live_student_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_settings private.student_provider_cleanup_settings;
  v_generation private.pal_membership_generations;
  v_existing public.student_purge_operations;
  v_binding private.student_provider_cleanup_bindings;
  v_scope text;
  v_participant text; v_roster text; v_actor text;
begin
  if p_operation_id is null or p_generation_id is null or p_teacher_id is null
    or p_classroom_id is null or p_student_id is null then
    raise exception using errcode='22023',message='invalid_provider_cleanup_request';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  select * into v_settings from private.student_provider_cleanup_settings where singleton for share;
  if not coalesce(v_settings.enabled,false) then raise exception using errcode='55000',message='student_provider_cleanup_disabled'; end if;
  v_scope:=private.pal_membership_scope(p_classroom_id,p_student_id);
  select * into v_existing from public.student_purge_operations where id=p_operation_id for update;
  if found then
    select * into v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
    if v_existing.teacher_id is distinct from p_teacher_id or v_existing.classroom_id is distinct from p_classroom_id
      or (v_existing.status<>'completed' and v_existing.student_id is distinct from p_student_id) or v_binding.generation_id is distinct from p_generation_id
      or v_binding.scope_digest is distinct from v_scope or v_binding.pal_schema_version is distinct from 2 then
      raise exception using errcode='55000',message='student_provider_binding_conflict';
    end if;
    return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  end if;
  if not coalesce((select live_enabled from private.student_provider_cleanup_settings where singleton for share),false) then
    raise exception using errcode='55000',message='student_live_cleanup_disabled';
  end if;
  if not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id)
    or not exists(select 1 from public.users where id=p_student_id and role='student') then
    raise exception using errcode='42501',message='student_provider_cleanup_forbidden';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  if not exists(select 1 from public.classroom_roster where classroom_id=p_classroom_id
    and removed_student_id=p_student_id and removed_enrollment_id=p_generation_id
    and removed_at >= v_settings.eligible_after)
    or exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id) then
    raise exception using errcode='55000',message='student_provider_removed_generation_required';
  end if;
  select * into v_generation from private.pal_membership_generations where generation_id=p_generation_id for update;
  if not found or v_generation.state<>'removed' or v_generation.scope_digest<>v_scope then
    raise exception using errcode='55000',message='student_provider_removed_generation_required';
  end if;
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  if public.classroom_purge_conflict(p_classroom_id) is not null
    or exists(select 1 from public.classroom_cold_tombstones where classroom_id=p_classroom_id)
    or exists(select 1 from public.classroom_archive_operations where classroom_id=p_classroom_id
      and status<>'completed' and (status<>'failed' or coalesce(retryable,false)))
    or exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id) then
    raise exception using errcode='55000',message='student_provider_operation_conflict';
  end if;
  -- A whole-class copy cannot be erased to settle an individual prerequisite.
  if exists(select 1 from public.managed_storage_objects object
      left join public.managed_storage_provisional_owners provisional on provisional.id=object.provisional_owner_id
      where (object.classroom_id=p_classroom_id or provisional.target_classroom_id=p_classroom_id)
        and (object.purpose in ('classroom_archive','gradex_extract') and not (
          exists(select 1 from public.classroom_archives archive join public.classroom_archive_operations operation
            on operation.id=archive.operation_id and operation.status='completed' where archive.managed_object_id=object.id)
          or exists(select 1 from public.classroom_gradex_extracts artifact join public.classroom_archive_operations operation
            on operation.id=artifact.operation_id and operation.status='completed' where artifact.managed_object_id=object.id))))
    or exists(select 1 from public.managed_storage_provisional_owners
      where target_classroom_id=p_classroom_id and adopted_at is null) then
    raise exception using errcode='55000',message='student_provider_copy_policy_required';
  end if;
  select mapping.participant_ref into v_participant from public.attendance_participant_mappings mapping
    join private.attendance_membership_generations generation on generation.participant_ref=mapping.participant_ref
    where mapping.classroom_id=p_classroom_id and mapping.student_id=p_student_id and not mapping.active
      and generation.generation_id=p_generation_id and generation.scope_digest=v_scope;
  select roster_ref into v_roster from public.attendance_roster_mappings where classroom_id=p_classroom_id;
  select principal_ref into v_actor from public.attendance_principal_mappings where user_id=p_teacher_id;
  if v_participant is null or v_roster is null or v_actor is null then
    raise exception using errcode='55000',message='student_provider_mapping_unverified';
  end if;
  insert into private.student_provider_cleanup_bindings(operation_id,generation_id,scope_digest,pal_reference,
    pal_origin,pal_integration_id,bara_origin,installation_ref,roster_ref,participant_ref,actor_principal_ref,pal_schema_version,pal_policy)
    values(p_operation_id,p_generation_id,v_scope,v_generation.pal_reference,v_settings.pal_origin,
      v_settings.pal_integration_id,v_settings.bara_origin,v_settings.installation_ref,v_roster,v_participant,v_actor,2,'pika-live-v1');
  insert into public.student_purge_operations(id,teacher_id,classroom_id,student_id,student_binding_sha256,
    request_sha256,status,source_revision) values(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,
      encode(extensions.digest(p_operation_id::text||':'||p_student_id::text,'sha256'),'hex'),
      encode(extensions.digest('provider-v1:'||p_operation_id::text||':'||p_generation_id::text||':'||v_scope,'sha256'),'hex'),
      'provider_pending',1);
  insert into public.student_purge_fences(classroom_id,student_id,operation_id,teacher_id)
    values(p_classroom_id,p_student_id,p_operation_id,p_teacher_id);
  return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
end;
$$;

create function private.live_student_cleanup_instant(p_value text)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  return coalesce(p_value ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$'
    and to_char(p_value::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=p_value,false);
exception when others then return false;
end;
$$;
revoke all on function private.live_student_cleanup_instant(text) from public,anon,authenticated,service_role;

create or replace function public.record_student_provider_cleanup_receipt(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid,
  p_provider text,p_receipt jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_binding private.student_provider_cleanup_bindings; v_keys text[];
begin
  perform public.authorize_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id for update;
  if jsonb_typeof(p_receipt) is distinct from 'object' then
    raise exception using errcode='22023',message='student_provider_receipt_invalid';
  end if;
  select array_agg(key order by key) into v_keys from jsonb_object_keys(p_receipt) key;
  if p_provider='pal' then
    if (v_binding.pal_schema_version=1 and (v_keys is distinct from
        array['begun_at','completed_at','learner_id','operation_id','schema_version','status']
        or p_receipt->'schema_version' is distinct from '1'::jsonb))
      or (v_binding.pal_schema_version=2 and (v_keys is distinct from
        array['backup_retention','begun_at','completed_at','historical_backups','learner_id','operation_id','policy','schema_version','status']
        or p_receipt->'schema_version' is distinct from '2'::jsonb
        or p_receipt->>'policy' is distinct from v_binding.pal_policy
        or p_receipt->>'historical_backups' is distinct from 'excluded'
        or p_receipt->>'backup_retention' is distinct from 'not_attested'
        or not private.live_student_cleanup_instant(p_receipt->>'begun_at')
        or (p_receipt->>'status'='completed' and not private.live_student_cleanup_instant(p_receipt->>'completed_at'))))
      or p_receipt->>'operation_id' is distinct from p_operation_id::text
      or p_receipt->>'learner_id' is distinct from v_binding.pal_reference
      or coalesce(p_receipt->>'status','') not in ('pending','completed')
      or jsonb_typeof(p_receipt->'begun_at') is distinct from 'string'
      or p_receipt->>'begun_at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$'
      or (p_receipt->>'status'='pending' and p_receipt->'completed_at' is distinct from 'null'::jsonb)
      or (p_receipt->>'status'='completed' and (jsonb_typeof(p_receipt->'completed_at') is distinct from 'string'
        or p_receipt->>'completed_at' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$'
        or (p_receipt->>'completed_at')::timestamptz < (p_receipt->>'begun_at')::timestamptz)) then
      raise exception using errcode='22023',message='student_provider_receipt_invalid';
    end if;
    perform (p_receipt->>'begun_at')::timestamptz;
    update private.student_provider_cleanup_bindings set pal_receipt=p_receipt where operation_id=p_operation_id;
  elsif p_provider='bara' then
    if v_keys is distinct from array['absence_verified','deleted_count','installation_ref','ok','operation_ref','participant_ref','roster_ref','schema_version','state']
      or p_receipt->'schema_version' is distinct from '1'::jsonb or p_receipt->'ok' is distinct from 'true'::jsonb
      or p_receipt->>'installation_ref' is distinct from v_binding.installation_ref
      or p_receipt->>'roster_ref' is distinct from v_binding.roster_ref
      or p_receipt->>'participant_ref' is distinct from v_binding.participant_ref
      or p_receipt->>'operation_ref' is distinct from 'erase_participant_'||replace(p_operation_id::text,'-','')
      or coalesce(p_receipt->>'state','') not in ('deleting','blocked','deleted')
      or p_receipt->'absence_verified' is distinct from to_jsonb(p_receipt->>'state'='deleted')
      or jsonb_typeof(p_receipt->'deleted_count') is distinct from 'number'
      or p_receipt->>'deleted_count' !~ '^[0-9]+$'
      or (p_receipt->>'deleted_count')::numeric > 9007199254740991 then
      raise exception using errcode='22023',message='student_provider_receipt_invalid';
    end if;
    update private.student_provider_cleanup_bindings set bara_receipt=p_receipt where operation_id=p_operation_id;
  else
    raise exception using errcode='22023',message='student_provider_unknown';
  end if;
  -- Receipts never invoke finalization, erase mappings, clear fences, or rotate.
  return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
end;
$$;

revoke all on function private.reserve_live_student_cleanup(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

alter table private.removed_academic_mutations drop constraint removed_academic_mutations_action_check;
alter table private.removed_academic_mutations add constraint removed_academic_mutations_action_check
  check(action in ('inventory','claim','acknowledge','fail','finalize','live_finalize'));

create function private.live_student_finalizing(p_classroom_id uuid,p_student_id uuid,p_generation_id uuid default null)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from private.removed_academic_mutations capability
    join public.student_purge_operations operation on operation.id=capability.operation_id
    join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
    where capability.transaction_id=txid_current() and capability.action='live_finalize'
      and operation.classroom_id=p_classroom_id and operation.student_id=p_student_id
      and binding.pal_schema_version=2 and binding.pal_policy='pika-live-v1'
      and (p_generation_id is null or binding.generation_id=p_generation_id));
$$;
revoke all on function private.live_student_finalizing(uuid,uuid,uuid) from public,anon,authenticated,service_role;


create or replace function private.removed_academic_delete_allowed(p_table text,p_row jsonb,p_new jsonb default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_operation uuid;
begin
  if p_new is null and p_table='classroom_roster' then
    return private.live_student_finalizing((p_row->>'classroom_id')::uuid,
      (p_row->>'removed_student_id')::uuid,(p_row->>'removed_enrollment_id')::uuid);
  end if;
  if p_new is null and p_table='attendance_participant_mappings' then
    return exists(select 1 from private.student_provider_cleanup_bindings binding
      where binding.participant_ref=p_row->>'participant_ref'
        and private.live_student_finalizing((p_row->>'classroom_id')::uuid,
          (p_row->>'student_id')::uuid,binding.generation_id));
  end if;
  if p_new is null and p_table='pal_event_outbox' then
    return exists(select 1 from private.pal_membership_outbox binding where binding.outbox_id=(p_row->>'id')::uuid
      and private.live_student_finalizing(binding.classroom_id,binding.student_id,binding.generation_id));
  end if;
  select operation_id into v_operation from private.removed_academic_mutations
    where transaction_id=txid_current() and action='finalize';
  if v_operation is null then return false; end if;
  if p_table='classroom_roster' then
    return p_new is not null and p_new->'retained_manual_attendance_marks'='{}'::jsonb
      and (p_new-'retained_manual_attendance_marks')=(p_row-'retained_manual_attendance_marks')
      and exists(select 1 from public.student_purge_resources where operation_id=v_operation
        and table_name='retained_manual_attendance_marks' and row_id=(p_row->>'id')::uuid);
  end if;
  if p_new is not null then return false; end if;
  if p_table='managed_storage_objects' then
    return exists(select 1 from public.student_purge_objects where operation_id=v_operation
      and managed_storage_object_id=(p_row->>'id')::uuid and status='deleted'
      and owner_sha256=encode(extensions.digest(p_row::text,'sha256'),'hex'));
  end if;
  return exists(select 1 from public.student_purge_resources where operation_id=v_operation
    and table_name=p_table and row_id=(p_row->>'id')::uuid and disposition='delete');
end;
$$;

create or replace function private.guard_student_provider_operation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := case when tg_op='DELETE' then old.id else new.id end;
  if exists(select 1 from private.student_provider_cleanup_bindings where operation_id=v_id) then
    if tg_op='UPDATE' and old.status='provider_pending' and new.status='completed'
      and new.student_id is null and new.student_email is null
      and (to_jsonb(new)-array['status','completed_at','updated_at','student_id','student_email'])=
        (to_jsonb(old)-array['status','completed_at','updated_at','student_id','student_email'])
      and private.removed_academic_capability(v_id,array['live_finalize']) then return new; end if;
    if tg_op='DELETE' then raise exception using errcode='55000',message='student_provider_stage_required'; end if;
    if tg_op='UPDATE' and (to_jsonb(new)-'local_academic_cleanup')=(to_jsonb(old)-'local_academic_cleanup')
      and private.removed_academic_capability(v_id,array['inventory','claim','finalize']) then return new; end if;
    if new.status <> 'provider_pending' or (tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old)) then
      raise exception using errcode='55000',message='student_provider_stage_required';
    end if;
  elsif tg_op <> 'DELETE' and new.status='provider_pending' then
    raise exception using errcode='55000',message='student_provider_binding_required';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function private.guard_student_provider_purge_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select distinct id from unnest(array[
    case when tg_op<>'DELETE' then new.operation_id end,
    case when tg_op<>'INSERT' then old.operation_id end]) id where id is not null loop
    if exists(select 1 from private.student_provider_cleanup_bindings where operation_id=v_id) then
      if tg_table_name='student_purge_fences' and tg_op='DELETE'
        and private.removed_academic_capability(v_id,array['live_finalize']) then continue; end if;
      -- Only our transaction-scoped RPC may stage or mutate local ledgers.
      if tg_table_name='student_purge_resources' and tg_op='INSERT'
        and private.removed_academic_capability(v_id,array['inventory']) then continue; end if;
      if tg_table_name='student_purge_objects' and (
        (tg_op='INSERT' and private.removed_academic_capability(v_id,array['inventory']))
        or (tg_op='UPDATE' and private.removed_academic_capability(v_id,array['claim','acknowledge','fail','finalize']))
      ) then continue; end if;
      -- Reservation installs one fence; no local action can modify/remove it.
      if tg_table_name <> 'student_purge_fences' or tg_op <> 'INSERT' then
        raise exception using errcode='55000',message='student_provider_stage_required';
      end if;
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function private.guard_provider_generation_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.state='removed' and new.state='purged' and new.scope_digest is null
    and exists(select 1 from private.student_provider_cleanup_bindings binding
      where binding.generation_id=old.generation_id
        and private.removed_academic_capability(binding.operation_id,array['live_finalize'])) then return new; end if;
  if exists(select 1 from private.student_provider_cleanup_bindings where generation_id=old.generation_id)
    and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception using errcode='55000',message='student_provider_stage_required';
  end if;
  return new;
end;
$$;

create or replace function private.guard_attendance_closed_subject()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_scope text; v_row jsonb;
begin
  if tg_op='DELETE' and private.removed_academic_delete_allowed(tg_table_name,to_jsonb(old)) then return old; end if;
  if tg_table_name='attendance_participant_mappings' and tg_op<>'INSERT'
    and exists(select 1 from private.attendance_membership_generations where participant_ref=to_jsonb(old)->>'participant_ref') then
    if tg_op='DELETE' or to_jsonb(new)->'participant_ref' is distinct from to_jsonb(old)->'participant_ref'
      or new.classroom_id is distinct from old.classroom_id or new.student_id is distinct from old.student_id then
      raise exception using errcode='55000',message='attendance_membership_generation_immutable';
    end if;
  end if;
  for v_row in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op<>'DELETE' then to_jsonb(new) end,
    case when tg_op<>'INSERT' then to_jsonb(old) end)) where jsonb_typeof(value)='object' loop
    perform private.try_lock_classroom_membership_change((v_row->>'classroom_id')::uuid,(v_row->>'student_id')::uuid);
    if tg_table_name='attendance_participant_mappings' and tg_op='UPDATE'
      and to_jsonb(new)->'active'='false'::jsonb and to_jsonb(old)->'active'='true'::jsonb
      and (to_jsonb(new)-'active'-'updated_at')=(to_jsonb(old)-'active'-'updated_at') then return new; end if;
    if private.attendance_participant_generation_closed(v_row->>'participant_ref') then
      raise exception using errcode='55000',message='attendance_membership_generation_closed';
    end if;
    v_scope:=private.pal_membership_scope((v_row->>'classroom_id')::uuid,(v_row->>'student_id')::uuid);
    if exists(select 1 from private.attendance_membership_generations attendance
      join private.pal_membership_generations generation using(generation_id)
      where attendance.scope_digest=v_scope and generation.state='removed') then
      -- The retained-roster trigger closes Pal before removal deactivates Bara.
      if tg_table_name='attendance_participant_mappings' and tg_op='UPDATE'
        and to_jsonb(new)->'active'='false'::jsonb and to_jsonb(old)->'active'='true'::jsonb
        and (to_jsonb(new)-'active'-'updated_at')=(to_jsonb(old)-'active'-'updated_at') then return new; end if;
      raise exception using errcode='55000',message='attendance_membership_generation_closed';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function private.attendance_payload_generation_closed(p_classroom_id uuid,p_payload jsonb)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists(select 1 from private.attendance_membership_generations attendance
    join private.pal_membership_generations generation using(generation_id)
    left join public.attendance_participant_mappings mapping on mapping.participant_ref=attendance.participant_ref
    left join private.student_provider_cleanup_bindings binding on binding.generation_id=attendance.generation_id
    left join public.student_purge_operations operation on operation.id=binding.operation_id
    where coalesce(mapping.classroom_id,operation.classroom_id)=p_classroom_id and generation.state<>'active'
      and private.attendance_payload_targets_participant(p_classroom_id,p_payload,attendance.participant_ref));
$$;

create or replace function private.removed_academic_blockers(p_operation_id uuid)
returns text[] language plpgsql volatile set search_path = '' as $$
declare v_op public.student_purge_operations; v_binding private.student_provider_cleanup_bindings;
  v_blockers text[] := array[]::text[];
begin
  select * into strict v_op from public.student_purge_operations where id=p_operation_id;
  select * into strict v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
  if v_binding.pal_receipt->>'status' is distinct from 'completed'
    or v_binding.pal_receipt->>'operation_id' is distinct from p_operation_id::text
    or v_binding.pal_receipt->>'learner_id' is distinct from v_binding.pal_reference
    or v_binding.bara_receipt->>'state' is distinct from 'deleted'
    or v_binding.bara_receipt->'absence_verified' is distinct from 'true'::jsonb
    or v_binding.bara_receipt->>'installation_ref' is distinct from v_binding.installation_ref
    or v_binding.bara_receipt->>'roster_ref' is distinct from v_binding.roster_ref
    or v_binding.bara_receipt->>'participant_ref' is distinct from v_binding.participant_ref
    or v_binding.bara_receipt->>'operation_ref' is distinct from 'erase_participant_'||replace(p_operation_id::text,'-','') then
    v_blockers:=array_append(v_blockers,'provider_completion_required');
  end if;
  if not coalesce((select mode='enforced' from public.managed_storage_settings where singleton),false) then
    v_blockers:=array_append(v_blockers,'managed_storage_enforcement_required');
  end if;
  -- V2 excludes retained verified historical artifacts. Unfinished producers and
  -- unbound objects are live/unknown and remain blocked. Never delete shared copies.
  if v_binding.pal_schema_version=1 then
  -- Any archive/extract ledger, pending intent or provisional object is unknown copy
  -- evidence. Never clean up whole-class copies to settle this individual operation.
  if exists(select 1 from public.classroom_archives where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.classroom_gradex_extracts where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.classroom_archive_operations where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.classroom_cold_tombstones where classroom_id=v_op.classroom_id)
    or exists(select 1 from public.managed_storage_provisional_owners where target_classroom_id=v_op.classroom_id)
    or exists(select 1 from public.managed_storage_objects where classroom_id=v_op.classroom_id
      and purpose in ('classroom_archive','gradex_extract')) then
    v_blockers:=array_append(v_blockers,'copy_policy_required');
  end if;
  else
    if exists(select 1 from public.classroom_archive_operations where classroom_id=v_op.classroom_id
        and status<>'completed' and (status<>'failed' or coalesce(retryable,false)))
      or exists(select 1 from public.classroom_cold_tombstones where classroom_id=v_op.classroom_id)
      or exists(select 1 from public.managed_storage_provisional_owners where target_classroom_id=v_op.classroom_id and adopted_at is null)
      or exists(select 1 from public.managed_storage_objects object where object.classroom_id=v_op.classroom_id
        and object.purpose in ('classroom_archive','gradex_extract') and not (
          exists(select 1 from public.classroom_archives archive join public.classroom_archive_operations operation
            on operation.id=archive.operation_id and operation.status='completed' where archive.managed_object_id=object.id)
          or exists(select 1 from public.classroom_gradex_extracts artifact join public.classroom_archive_operations operation
            on operation.id=artifact.operation_id and operation.status='completed' where artifact.managed_object_id=object.id))) then
      v_blockers:=array_append(v_blockers,'live_copy_work_pending');
    end if;
  end if;
  if exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id)
    where disposition='collateral_delete' or (disposition='redact' and table_name<>'retained_manual_attendance_marks')) then
    v_blockers:=array_append(v_blockers,'shared_resource_policy_required');
  end if;
  -- Events carry independent scope columns; the legacy FK alone permits mixed
  -- children. Either selected side must agree exactly before any deletion claim.
  if exists(select 1 from public.attendance_status_override_events event
    join public.attendance_status_overrides parent on parent.id=event.override_id
    where ((parent.classroom_id=v_op.classroom_id and parent.student_id=v_op.student_id)
      or (event.classroom_id=v_op.classroom_id and event.student_id=v_op.student_id))
      and (event.classroom_id,event.student_id,event.occurrence_ref) is distinct from
        (parent.classroom_id,parent.student_id,parent.occurrence_ref)) then
    v_blockers:=array_append(v_blockers,'attendance_ownership_unknown');
  end if;
  if exists(select 1 from public.attendance_override_requests where classroom_id=v_op.classroom_id) then
    v_blockers:=array_append(v_blockers,'shared_attendance_request_policy_required');
  end if;
  -- Grading history can imply remote copies even after its job has finished.
  if exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id)
      where table_name in ('assignment_ai_grading_runs','assignment_ai_grading_run_items',
        'test_ai_grading_runs','test_ai_grading_run_items','assignment_repo_review_results','assignment_repo_targets'))
    or exists(select 1 from public.assignment_repo_review_runs run join public.assignments assignment
      on assignment.id=run.assignment_id where assignment.classroom_id=v_op.classroom_id)
    or exists(select 1 from public.assignment_docs doc join public.assignments assignment on assignment.id=doc.assignment_id
      where assignment.classroom_id=v_op.classroom_id and doc.student_id=v_op.student_id
        and (doc.ai_feedback_model is not null or doc.ai_feedback_suggested_at is not null
          or doc.ai_grading_provenance is not null or doc.ai_grading_review is not null))
    or exists(select 1 from public.test_responses response join public.tests test on test.id=response.test_id
      where test.classroom_id=v_op.classroom_id and response.student_id=v_op.student_id
        and (response.ai_model is not null or response.ai_grading_basis is not null
          or response.ai_grading_provenance is not null or response.ai_grading_review is not null)) then
    v_blockers:=array_append(v_blockers,'remote_grading_policy_required');
  end if;
  if exists(select 1 from public.assignment_feedback_entries feedback
    join public.assignments assignment on assignment.id=feedback.assignment_id
    where assignment.classroom_id=v_op.classroom_id and feedback.student_id=v_op.student_id and feedback.author_type='ai') then
    v_blockers:=array_append(v_blockers,'remote_grading_policy_required');
  end if;
  if exists(select 1 from public.classroom_retired_assessment_record_actors actor
    join public.classroom_retired_assessment_records record on record.id=actor.record_id
    where record.classroom_id=v_op.classroom_id and actor.actor_id=v_op.student_id) then
    v_blockers:=array_append(v_blockers,'retired_assessment_policy_required');
  end if;
  if exists(select 1 from private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
    where object.classroom_id is distinct from v_op.classroom_id
      or object.data_subject_user_id is distinct from v_op.student_id
      or object.provisional_owner_id is not null or object.course_blueprint_id is not null
      or object.status<>'ready' or object.purpose not in ('student_assignment_artifact','student_inline_image')
      or object.storage_bucket not in ('assignment-artifacts','submission-images')
      or object.resource_type is distinct from 'assignment_doc'
      or not exists(select 1 from public.assignment_docs doc join public.assignments assignment on assignment.id=doc.assignment_id
        where doc.id=object.resource_id and doc.student_id=v_op.student_id and assignment.classroom_id=v_op.classroom_id)) then
    v_blockers:=array_append(v_blockers,'object_ownership_unknown');
  end if;
  if exists(select 1 from public.assignment_submission_artifacts artifact
    join public.assignment_docs doc on doc.id=artifact.assignment_doc_id
    join public.assignments assignment on assignment.id=doc.assignment_id
    join public.assignment_submission_requirements requirement on requirement.id=artifact.requirement_id
    where assignment.classroom_id=v_op.classroom_id and (doc.student_id=v_op.student_id or artifact.student_id=v_op.student_id)
      and (doc.student_id is distinct from artifact.student_id or requirement.assignment_id<>doc.assignment_id
        or (artifact.storage_path is not null and artifact.managed_object_id is null))) then
    v_blockers:=array_append(v_blockers,'artifact_ownership_unknown');
  end if;
  -- Every reference to a selected object must be an exact target resource.
  if exists(select 1 from private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
    join public.managed_storage_json_references reference on reference.managed_object_id=object.id
    where not exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id) resource
      where resource.table_name='managed_storage_json_references' and resource.row_id=reference.id))
    or exists(select 1 from private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      join public.assignment_submission_artifacts artifact on artifact.managed_object_id=object.id
      where not exists(select 1 from private.removed_academic_resources(v_op.classroom_id,v_op.student_id) resource
        where resource.table_name='assignment_submission_artifacts' and resource.row_id=artifact.id)) then
    v_blockers:=array_append(v_blockers,'shared_object_policy_required');
  end if;
  if exists(select 1 from public.student_purge_objects where operation_id=p_operation_id
    and status='failed' and attempt_count>=12) then
    v_blockers:=array_append(v_blockers,'object_retry_exhausted');
  end if;
  if exists(select 1 from public.assignment_artifact_storage_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:assignment_artifact_storage_cleanup');
  end if;
  if exists(select 1 from public.test_document_snapshot_storage_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:test_document_snapshot_storage_cleanup');
  end if;
  if exists(select 1 from public.classroom_archive_operations reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_operations');
  end if;
  if exists(select 1 from public.classroom_archives reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archives');
  end if;
  if exists(select 1 from public.classroom_archive_object_upload_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_object_upload_cleanup');
  end if;
  if exists(select 1 from public.classroom_archive_restore_expected_objects reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_restore_expected_objects');
  end if;
  if exists(select 1 from public.classroom_archive_source_object_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_archive_source_object_cleanup');
  end if;
  if exists(select 1 from public.classroom_gradex_extracts reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_gradex_extracts');
  end if;
  if exists(select 1 from public.classroom_gradex_extract_cleanup reference
    join private.removed_academic_objects(v_op.classroom_id,v_op.student_id) object
      on object.id=reference.managed_object_id) then
    v_blockers:=array_append(v_blockers,'pending_or_copy_reference:classroom_gradex_extract_cleanup');
  end if;
  return v_blockers;
end;
$$;

create or replace function private.guard_provider_whole_class_copy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_classroom uuid;
begin
  for v_row in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op<>'DELETE' then to_jsonb(new) end,
    case when tg_op<>'INSERT' then to_jsonb(old) end)) where jsonb_typeof(value)='object' loop
    if tg_table_name='managed_storage_objects' then
      if v_row->>'purpose' not in ('classroom_archive','gradex_extract') then continue; end if;
      v_classroom:=(v_row->>'classroom_id')::uuid;
      if v_classroom is null and v_row->>'provisional_owner_id' is not null then
        select target_classroom_id into v_classroom from public.managed_storage_provisional_owners
          where id=(v_row->>'provisional_owner_id')::uuid for share;
      end if;
    else
      v_classroom:=(v_row->>'target_classroom_id')::uuid;
    end if;
    if v_classroom is null then continue; end if;
    perform private.try_lock_classroom_membership_change(v_classroom);
    if exists(select 1 from private.student_provider_cleanup_bindings binding
      join public.student_purge_operations operation on operation.id=binding.operation_id
      where operation.classroom_id=v_classroom and operation.status<>'completed') then
      raise exception using errcode='55000',message='student_provider_copy_policy_required';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function public.advance_removed_student_academic_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid,
  p_action text,p_revision integer default null,p_object_id uuid default null,p_lease_token uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.student_purge_operations; v_fingerprint jsonb; v_object public.student_purge_objects;
  v_resource record; v_token uuid; v_result jsonb; v_actual integer; v_blockers text[];
begin
  if p_action='live_reserve' then
    return private.reserve_live_student_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  elsif p_action='live_complete' then
    return private.complete_live_student_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  end if;
  if p_action is null or p_action not in ('inventory','claim','acknowledge','fail') then
    raise exception using errcode='22023',message='academic_cleanup_action_invalid';
  end if;
  v_op:=private.authorize_removed_academic_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  perform public.lock_managed_storage_protocol();
  insert into private.removed_academic_mutations(transaction_id,operation_id,action)
    values(txid_current(),p_operation_id,p_action);
  if v_op.local_academic_cleanup is null then
    if p_action<>'inventory' then raise exception using errcode='55000',message='academic_cleanup_inventory_required'; end if;
    v_fingerprint:=private.removed_academic_fingerprint(p_operation_id);
    insert into public.student_purge_resources(operation_id,table_name,row_id,disposition,row_sha256)
      select p_operation_id,table_name,row_id,disposition,private.removed_academic_row_hash(table_name,row_id)
      from private.removed_academic_resources(p_classroom_id,p_student_id);
    insert into public.student_purge_objects(operation_id,managed_storage_object_id,storage_bucket,
      storage_path,storage_path_sha256,owner_sha256)
      select p_operation_id,object.id,object.storage_bucket,object.storage_path,
        public.managed_storage_identity_sha256(object.storage_bucket,object.storage_path),
        encode(extensions.digest(to_jsonb(object)::text,'sha256'),'hex')
      from private.removed_academic_objects(p_classroom_id,p_student_id) object;
    update public.student_purge_operations set local_academic_cleanup=v_fingerprint||jsonb_build_object(
      'status','inventoried','revision',1,'inventoried_at',clock_timestamp(),'completed_at',null)
      where id=p_operation_id returning * into v_op;
  end if;
  if v_op.local_academic_cleanup->>'status'='local_completed' then
    v_result:=private.removed_academic_receipt(p_operation_id);
    delete from private.removed_academic_mutations where transaction_id=txid_current();
    return v_result;
  end if;
  v_fingerprint:=private.removed_academic_fingerprint(p_operation_id);
  if v_fingerprint is distinct from (v_op.local_academic_cleanup-
    array['status','revision','inventoried_at','completed_at']) then
    raise exception using errcode='40001',message='academic_cleanup_inventory_drift';
  end if;
  v_blockers:=private.removed_academic_blockers(p_operation_id);
  if p_action='inventory' or cardinality(v_blockers)>0 then
    v_result:=private.removed_academic_receipt(p_operation_id);
    delete from private.removed_academic_mutations where transaction_id=txid_current();
    return v_result;
  end if;
  -- Exact saved provider completion and all local no-copy proofs were checked
  -- above, after authorization and before any object/row deletion authority.
  if p_action in ('acknowledge','fail') then
    if p_revision is distinct from (v_op.local_academic_cleanup->>'revision')::integer
      or p_object_id is null or p_lease_token is null then
      raise exception using errcode='22023',message='academic_cleanup_callback_invalid';
    end if;
    select * into v_object from public.student_purge_objects
      where operation_id=p_operation_id and id=p_object_id for update;
    if not found then raise exception using errcode='55000',message='academic_cleanup_lease_lost'; end if;
    if v_object.status<>'deleted' then
      if v_object.status<>'processing' or v_object.lease_token is distinct from p_lease_token
        or v_object.lease_expires_at<=clock_timestamp() then
        raise exception using errcode='55000',message='academic_cleanup_lease_lost';
      end if;
      if p_action='acknowledge' then
        perform public.managed_storage_exact_lock(v_object.storage_bucket,v_object.storage_path);
        if exists(select 1 from storage.objects where bucket_id=v_object.storage_bucket and name=v_object.storage_path) then
          raise exception using errcode='55000',message='academic_cleanup_object_still_present';
        end if;
        update public.student_purge_objects set status='deleted',deleted_at=clock_timestamp(),storage_path=null,
          lease_token=null,lease_expires_at=null,last_error_code=null,updated_at=clock_timestamp() where id=p_object_id;
      else
        update public.student_purge_objects set status='failed',lease_token=null,lease_expires_at=null,
          last_error_code='storage_delete_failed',updated_at=clock_timestamp(),
          next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,(2^least(attempt_count,8))::integer))
          where id=p_object_id;
      end if;
    end if;
  elsif p_action='claim' then
    update public.student_purge_objects set status='failed',lease_token=null,lease_expires_at=null,
      next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
      where operation_id=p_operation_id and status='processing' and lease_expires_at<=clock_timestamp();
    select * into v_object from public.student_purge_objects where operation_id=p_operation_id
      and status in ('pending','failed') and attempt_count<12 and next_attempt_at<=clock_timestamp()
      order by created_at,id for update skip locked limit 1;
    if found then
      v_token:=gen_random_uuid();
      update public.student_purge_objects set status='processing',attempt_count=attempt_count+1,
        lease_token=v_token,lease_expires_at=clock_timestamp()+interval '60 seconds',
        last_error_code=null,updated_at=clock_timestamp() where id=v_object.id;
      update public.student_purge_operations set local_academic_cleanup=jsonb_set(local_academic_cleanup,
        '{status}','"deleting"'::jsonb) where id=p_operation_id;
      v_result:=private.removed_academic_receipt(p_operation_id,jsonb_build_object('id',v_object.id,
        'storage_bucket',v_object.storage_bucket,'storage_path',v_object.storage_path,'lease_token',v_token));
      delete from private.removed_academic_mutations where transaction_id=txid_current();
      return v_result;
    end if;
    if not exists(select 1 from public.student_purge_objects where operation_id=p_operation_id and status<>'deleted') then
      update private.removed_academic_mutations set action='finalize' where transaction_id=txid_current();
      -- Reauthorize finalization explicitly; preserve every retained identity field.
      perform private.authorize_removed_academic_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
      for v_resource in select * from public.student_purge_resources where operation_id=p_operation_id
        order by case table_name when 'managed_storage_json_references' then 0
          when 'assignment_doc_history' then 10 when 'assignment_doc_save_operations' then 11
          when 'assignment_submission_artifacts' then 12 when 'test_attempt_history' then 15
          when 'attendance_status_override_events' then 20 when 'attendance_status_overrides' then 70
          when 'assignment_docs' then 80 when 'test_attempts' then 81 else 30 end,table_name,row_id loop
        if v_resource.table_name='retained_manual_attendance_marks' then
          update public.classroom_roster set retained_manual_attendance_marks='{}'::jsonb where id=v_resource.row_id;
        elsif v_resource.disposition='delete' then
          execute format('delete from public.%I where id=$1',v_resource.table_name) using v_resource.row_id;
        else raise exception using errcode='55000',message='academic_cleanup_shared_resource'; end if;
        get diagnostics v_actual=row_count;
        if v_actual<>1 then raise exception using errcode='40001',message='academic_cleanup_inventory_drift'; end if;
      end loop;
      -- Pending cleanup/copy ledgers are blockers, never collateral deletion targets.
      delete from public.managed_storage_objects object using public.student_purge_objects staged
        where staged.operation_id=p_operation_id and staged.managed_storage_object_id=object.id;
      if exists(select 1 from private.removed_academic_resources(p_classroom_id,p_student_id))
        or exists(select 1 from private.removed_academic_objects(p_classroom_id,p_student_id))
        or exists(select 1 from storage.objects stored join public.student_purge_objects staged
          on staged.storage_bucket=stored.bucket_id and staged.storage_path_sha256=
            public.managed_storage_identity_sha256(stored.bucket_id,stored.name)
          where staged.operation_id=p_operation_id) then
        raise exception using errcode='55000',message='academic_cleanup_absence_unverified';
      end if;
      update public.student_purge_operations set local_academic_cleanup=
        jsonb_set(jsonb_set(local_academic_cleanup,'{status}','"local_completed"'::jsonb),
          '{completed_at}',to_jsonb(clock_timestamp())) where id=p_operation_id;
    end if;
  end if;
  v_result:=private.removed_academic_receipt(p_operation_id);
  delete from private.removed_academic_mutations where transaction_id=txid_current();
  return v_result;
end;
$$;

-- Current stored replies are aggregate-only normalized adapter results. Unknown
-- shapes cannot be assumed to contain no student data merely for lacking a ref.
create function private.live_attendance_ack_known(p_type text,p_value jsonb,p_request jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare keys text[]; expected text[]; field text; positive_fields text[];
begin
  if p_value is null then return true; end if;
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(p_value) key;
  if p_type='roster.snapshot' then
    expected:=array['createdCount','deactivatedCount','outcome','revision','rosterRef','updatedCount'];
    positive_fields:=array['revision'];
  elsif p_type='schedule.snapshot' then
    expected:=array['cancelledCount','outcome','preservedCount','revision','rosterRef','scheduledCount','updatedCount'];
    positive_fields:=array['revision'];
  elsif p_type='session.command' then
    expected:=array['occurrenceRef','outcome','sessionRevision','status'];
    positive_fields:=array['sessionRevision'];
    if coalesce(p_value->>'status','') not in ('open','closed') then return false; end if;
  elsif p_type='check_in.invalidate' then
    expected:=array['appliedCount','occurrenceRef','outcome','sessionRevision','unchangedCount'];
    positive_fields:=array['sessionRevision'];
  else return false;
  end if;
  if keys is distinct from expected
    or coalesce(p_value->>'outcome','') not in ('applied','duplicate','unchanged')
    or (p_value->>'outcome'='unchanged' and p_type<>'session.command') then return false; end if;
  if p_type in ('roster.snapshot','schedule.snapshot') then
    if p_value->>'rosterRef' is distinct from p_request->>'roster_ref' then return false; end if;
  elsif p_value->>'occurrenceRef' is distinct from p_request->>'occurrence_ref' then return false;
  end if;
  foreach field in array keys loop
    if field in ('outcome','rosterRef','occurrenceRef','status') then
      if jsonb_typeof(p_value->field)<>'string' then return false; end if;
    else
      if jsonb_typeof(p_value->field) is distinct from 'number'
        or p_value->>field !~ '^[0-9]+$' or (p_value->>field)::numeric>9007199254740991
        or (field=any(positive_fields) and (p_value->>field)::numeric=0) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.live_attendance_ack_known(text,jsonb,jsonb) from public,anon,authenticated,service_role;

create function private.live_student_attendance_blockers(p_operation_id uuid)
returns boolean language sql volatile set search_path='' as $$
  select exists(select 1 from private.student_provider_cleanup_bindings binding
    join public.student_purge_operations operation on operation.id=binding.operation_id
    join public.attendance_integration_outbox outbox on outbox.classroom_id=operation.classroom_id
    where binding.operation_id=p_operation_id and (
      not private.live_attendance_ack_known(outbox.message_type,outbox.response_payload,outbox.payload)
      or
      -- Unknown/legacy invalidations lose their fact lookup during academic cleanup.
      (outbox.message_type='check_in.invalidate' and outbox.payload->>'participant_ref' is null)
      or exists(select 1 from jsonb_path_query(outbox.response_payload,'$.**.participant_ref') ref
        where ref #>> '{}' = binding.participant_ref)
      or (private.attendance_payload_targets_participant(operation.classroom_id,outbox.payload,binding.participant_ref)
        and not (
          (outbox.message_type='roster.snapshot' and jsonb_typeof(outbox.payload->'participants')='array'
            and not exists(select 1 from jsonb_path_query(outbox.payload-'participants','$.**.participant_ref') ref
              where ref #>> '{}' = binding.participant_ref))
          or (outbox.message_type='check_in.invalidate' and outbox.payload->>'participant_ref'=binding.participant_ref)
        ))));
$$;

create function private.complete_live_student_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_op public.student_purge_operations; v_binding private.student_provider_cleanup_bindings; v_read jsonb;
begin
  v_read:=public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into strict v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
  if v_binding.pal_schema_version<>2 or v_binding.pal_policy<>'pika-live-v1' then
    raise exception using errcode='55000',message='student_live_policy_required';
  end if;
  if v_read->>'status'='completed' then return v_read; end if;
  if not coalesce((select live_enabled from private.student_provider_cleanup_settings where singleton for share),false) then
    raise exception using errcode='55000',message='student_live_cleanup_disabled';
  end if;
  v_op:=private.authorize_removed_academic_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  perform public.lock_managed_storage_protocol();
  if v_op.local_academic_cleanup->>'status' is distinct from 'local_completed'
    or cardinality(private.removed_academic_blockers(p_operation_id))<>0
    or private.live_student_attendance_blockers(p_operation_id)
    or exists(select 1 from private.removed_academic_resources(p_classroom_id,p_student_id))
    or exists(select 1 from private.removed_academic_objects(p_classroom_id,p_student_id))
    or exists(select 1 from public.student_purge_objects where operation_id=p_operation_id and status<>'deleted')
    or exists(select 1 from storage.objects stored join public.student_purge_objects staged
      on staged.storage_bucket=stored.bucket_id and staged.storage_path_sha256=
        public.managed_storage_identity_sha256(stored.bucket_id,stored.name) where staged.operation_id=p_operation_id) then
    raise exception using errcode='55000',message='student_live_absence_unverified';
  end if;
  insert into private.removed_academic_mutations(transaction_id,operation_id,action)
    values(txid_current(),p_operation_id,'live_finalize');
  -- Delivery rows are live retained payloads, not backups. Preserve classmates in
  -- mixed snapshots and their shared acknowledgement. Replays stay superseded.
  update public.attendance_integration_outbox outbox set payload=jsonb_set(payload,'{participants}',
    coalesce((select jsonb_agg(participant order by ordinal) from jsonb_array_elements(payload->'participants')
      with ordinality parts(participant,ordinal) where participant->>'participant_ref'<>v_binding.participant_ref),'[]'::jsonb)),
    status='superseded',lease_token=null,lease_expires_at=null
    where classroom_id=p_classroom_id and message_type='roster.snapshot'
      and exists(select 1 from jsonb_array_elements(payload->'participants') participant
        where participant->>'participant_ref'=v_binding.participant_ref);
  delete from public.attendance_integration_outbox where classroom_id=p_classroom_id
    and message_type='check_in.invalidate' and payload->>'participant_ref'=v_binding.participant_ref;
  delete from public.attendance_integration_inbox where classroom_id=p_classroom_id
    and event_type in ('attendance.check_in.accepted','attendance.check_in.invalidated')
    and payload->'metadata'->>'participant_ref'=v_binding.participant_ref;
  delete from public.pal_event_outbox outbox using private.pal_membership_outbox binding
    where outbox.id=binding.outbox_id and binding.generation_id=p_generation_id
      and binding.classroom_id=p_classroom_id and binding.student_id=p_student_id;
  delete from private.pal_membership_week_configurations where generation_id=p_generation_id;
  if exists(select 1 from public.attendance_integration_inbox where classroom_id=p_classroom_id
      and private.attendance_payload_targets_participant(p_classroom_id,payload,v_binding.participant_ref))
    or exists(select 1 from public.attendance_integration_outbox where classroom_id=p_classroom_id
      and private.attendance_payload_targets_participant(p_classroom_id,payload,v_binding.participant_ref))
    or exists(select 1 from public.pal_event_outbox outbox join private.pal_membership_outbox binding
      on binding.outbox_id=outbox.id where binding.generation_id=p_generation_id) then
    raise exception using errcode='55000',message='student_live_delivery_absence_unverified';
  end if;
  delete from public.attendance_participant_mappings where classroom_id=p_classroom_id and student_id=p_student_id
    and participant_ref=v_binding.participant_ref and not active;
  if not found then raise exception using errcode='55000',message='student_live_mapping_changed'; end if;
  delete from public.classroom_roster where classroom_id=p_classroom_id and removed_student_id=p_student_id
    and removed_enrollment_id=p_generation_id and removed_at is not null;
  if not found then raise exception using errcode='55000',message='student_live_roster_changed'; end if;
  update private.pal_membership_generations set state='purged',scope_digest=null
    where generation_id=p_generation_id and state='removed';
  if not found then raise exception using errcode='55000',message='student_live_generation_changed'; end if;
  -- Preserve the existing public completion privacy constraint. The private
  -- immutable scope digest authenticates exact-subject replay after this clear.
  update public.student_purge_operations set status='completed',student_id=null,student_email=null,
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_operation_id;
  delete from public.student_purge_fences where operation_id=p_operation_id;
  delete from private.removed_academic_mutations where transaction_id=txid_current();
  return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
end;
$$;
revoke all on function private.live_student_attendance_blockers(uuid),
  private.complete_live_student_cleanup(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;


create or replace function private.guard_attendance_closed_payload()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='attendance_integration_outbox' and tg_op='UPDATE'
    and exists(select 1 from private.student_provider_cleanup_bindings binding
      join public.student_purge_operations operation on operation.id=binding.operation_id
      where operation.classroom_id=old.classroom_id
        and private.live_student_finalizing(operation.classroom_id,operation.student_id,binding.generation_id)
        and to_jsonb(old)->>'message_type'='roster.snapshot'
        and to_jsonb(new)->>'status'='superseded' and to_jsonb(new)->>'lease_token' is null and to_jsonb(new)->>'lease_expires_at' is null
        and (to_jsonb(new)-array['payload','status','lease_token','lease_expires_at'])=
          (to_jsonb(old)-array['payload','status','lease_token','lease_expires_at'])
        and new.payload=jsonb_set(old.payload,'{participants}',coalesce((select jsonb_agg(participant order by ordinal)
          from jsonb_array_elements(old.payload->'participants') with ordinality parts(participant,ordinal)
          where participant->>'participant_ref'<>binding.participant_ref),'[]'::jsonb))) then return new; end if;
  perform private.try_lock_classroom_membership_change(new.classroom_id);
  if (tg_op='UPDATE' and (new.classroom_id is distinct from old.classroom_id
    or new.payload is distinct from old.payload)) then
    perform private.try_lock_classroom_membership_change(old.classroom_id);
    if private.attendance_payload_generation_closed(old.classroom_id,old.payload) then
      raise exception using errcode='55000',message='attendance_membership_generation_closed';
    end if;
  end if;
  if private.attendance_payload_generation_closed(new.classroom_id,new.payload) then
    if tg_table_name='attendance_integration_outbox' and tg_op='UPDATE'
      and to_jsonb(new)->>'status'='superseded' and to_jsonb(new)->>'lease_token' is null
      and to_jsonb(new)->>'lease_expires_at' is null and new.payload=old.payload
      and to_jsonb(new)->'response_payload' is not distinct from to_jsonb(old)->'response_payload' then return new; end if;
    raise exception using errcode='55000',message='attendance_membership_generation_closed';
  end if;
  return new;
end;
$$;

create or replace function public.authorize_student_provider_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op jsonb; v_settings private.student_provider_cleanup_settings;
begin
  v_op:=public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into v_settings from private.student_provider_cleanup_settings where singleton for share;
  if (v_op->>'pal_schema_version'='2' and not v_settings.live_enabled)
    or not coalesce(v_settings.enabled,false) or v_settings.pal_origin is distinct from v_op->>'pal_origin'
    or v_settings.pal_integration_id::text is distinct from v_op->>'pal_integration_id'
    or v_settings.bara_origin is distinct from v_op->>'bara_origin'
    or v_settings.installation_ref is distinct from v_op->>'installation_ref' then
    raise exception using errcode='55000',message='student_provider_cleanup_disabled';
  end if;
  if exists(select 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id)
    or not exists(select 1 from private.pal_membership_generations where generation_id=p_generation_id and state='removed') then
    raise exception using errcode='55000',message='student_provider_removed_generation_required';
  end if;
  return v_op;
end;
$$;

create or replace function private.guard_closed_pal_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_binding private.pal_membership_outbox; v_state text;
begin
  if tg_op='INSERT' and exists(select 1 from private.pal_membership_generations
    where pal_reference=new.payload->>'learner_id' and state<>'active') then
    raise exception using errcode='55000',message='pal_membership_generation_closed';
  end if;
  if tg_op='INSERT' then return new; end if;
  select * into v_binding from private.pal_membership_outbox where outbox_id=new.id;
  if not found then return new; end if;
  perform private.try_lock_classroom_membership_change(v_binding.classroom_id,v_binding.student_id);
  select state into v_state from private.pal_membership_generations where generation_id=v_binding.generation_id;
  if v_state is distinct from 'active' and (new.status<>'non_retryable' or new.lease_token is not null
    or new.lease_expires_at is not null or new.payload is distinct from old.payload) then
    raise exception using errcode='55000',message='pal_membership_generation_closed';
  end if;
  return new;
end;
$$;

drop trigger guard_closed_pal_delivery on public.pal_event_outbox;
create trigger guard_closed_pal_delivery before insert or update on public.pal_event_outbox
  for each row execute function private.guard_closed_pal_delivery();

-- Completed row IDs and storage paths remain reserved. A delayed write cannot
-- resurrect a deleted document/attempt using its old identity after fresh rejoin.
create function private.guard_live_purged_resource_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare candidate record;
begin
  for candidate in select operation.classroom_id,operation.student_id from public.student_purge_resources resource
    join public.student_purge_operations operation on operation.id=resource.operation_id
    join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
    where resource.table_name=tg_table_name and resource.row_id=new.id and binding.pal_schema_version=2 loop
    perform private.try_lock_classroom_membership_change(candidate.classroom_id,candidate.student_id);
  end loop;
  if exists(select 1 from public.student_purge_resources resource
    join public.student_purge_operations operation on operation.id=resource.operation_id
    join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
    where resource.table_name=tg_table_name and resource.row_id=new.id
      and operation.status='completed' and binding.pal_schema_version=2) then
    raise exception using errcode='55000',message='student_purged_resource_identity_reserved';
  end if;
  return new;
end;
$$;
do $$ declare target text; begin
  foreach target in array array['announcement_reads','assignment_ai_grading_run_items','assignment_ai_grading_runs',
    'assignment_doc_history','assignment_doc_save_operations','assignment_submission_artifacts','assignment_docs',
    'assignment_feedback_entries','assignment_repo_review_results','assignment_repo_targets','entries',
    'report_card_rows','survey_responses','test_ai_grading_run_items','test_ai_grading_runs',
    'test_attempt_history','test_attempts','test_focus_events','test_responses','test_student_availability',
    'log_summaries','developer_feedback_candidates','gradebook_score_overrides','gradebook_item_scores',
    'managed_storage_json_references','attendance_check_in_facts','attendance_record_projection',
    'attendance_status_overrides','attendance_status_override_events'] loop
    execute format('create trigger guard_live_purged_resource_identity before insert or update on public.%I
      for each row execute function private.guard_live_purged_resource_identity()',target);
  end loop;
end $$;
revoke all on function private.guard_live_purged_resource_identity() from public,anon,authenticated,service_role;


create or replace function private.guard_removed_academic_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid;
begin
  for v_classroom in select distinct value from unnest(array[old.classroom_id,
    case when tg_op='UPDATE' then new.classroom_id end]) value where value is not null loop
    perform private.try_lock_classroom_membership_change(v_classroom);
    if exists(select 1 from public.student_purge_operations operation
      join private.student_provider_cleanup_bindings binding on binding.operation_id=operation.id
      where operation.classroom_id=v_classroom and operation.status<>'completed') then
      raise exception using errcode='55000',message='academic_cleanup_parent_fenced';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

commit;
