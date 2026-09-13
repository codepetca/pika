-- Disabled provider prerequisite on the existing purge engine. No removal queue,
-- academic cleanup, receipt-to-completion transition, or re-add release exists.
begin;
set local lock_timeout = '5s';

alter table public.student_purge_operations drop constraint student_purge_operations_status_check;
alter table public.student_purge_operations add constraint student_purge_operations_status_check
  check (status in ('inventorying','deleting_objects','finalizing','completed','failed','provider_pending'));

create table private.student_provider_cleanup_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  eligible_after timestamptz,
  pal_origin text,
  pal_integration_id uuid,
  bara_origin text,
  installation_ref text check (installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
  check (not enabled or (eligible_after is not null and pal_origin is not null
    and pal_integration_id is not null and bara_origin is not null and installation_ref is not null))
);
insert into private.student_provider_cleanup_settings(singleton) values (true);

-- New mappings only: no attribution/backfill of legacy participant history.
create table private.attendance_membership_generations (
  generation_id uuid primary key references private.pal_membership_generations(generation_id) on delete restrict,
  participant_ref text not null unique check (participant_ref ~ '^participant_[a-f0-9]{32}$'),
  scope_digest text not null check (scope_digest ~ '^[a-f0-9]{64}$')
);
create table private.student_provider_cleanup_bindings (
  operation_id uuid primary key references public.student_purge_operations(id)
    on delete restrict deferrable initially deferred,
  generation_id uuid not null unique references private.pal_membership_generations(generation_id) on delete restrict,
  scope_digest text not null check (scope_digest ~ '^[a-f0-9]{64}$'),
  pal_reference text not null unique check (pal_reference ~ '^pika-membership-v1-[a-f0-9]{32}$'),
  pal_origin text not null,
  pal_integration_id uuid not null,
  bara_origin text not null,
  installation_ref text not null check (installation_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
  roster_ref text not null check (roster_ref ~ '^roster_[a-f0-9]{32}$'),
  participant_ref text not null unique check (participant_ref ~ '^participant_[a-f0-9]{32}$'),
  actor_principal_ref text not null check (actor_principal_ref ~ '^principal_[a-f0-9]{32}$'),
  pal_receipt jsonb,
  bara_receipt jsonb
);
create index student_provider_cleanup_scope on private.student_provider_cleanup_bindings(scope_digest);

alter table private.student_provider_cleanup_settings enable row level security;
alter table private.attendance_membership_generations enable row level security;
alter table private.student_provider_cleanup_bindings enable row level security;
revoke all on private.student_provider_cleanup_settings, private.attendance_membership_generations,
  private.student_provider_cleanup_bindings from public, anon, authenticated, service_role;

create function private.guard_student_provider_binding()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception using errcode='55000', message='student_provider_evidence_retained';
  end if;
  if (to_jsonb(new) - 'pal_receipt' - 'bara_receipt') is distinct from
    (to_jsonb(old) - 'pal_receipt' - 'bara_receipt') then
    raise exception using errcode='55000', message='student_provider_binding_immutable';
  end if;
  if (old.pal_receipt->>'status' = 'completed' and new.pal_receipt is distinct from old.pal_receipt)
    or (old.pal_receipt is not null and (new.pal_receipt is null
      or new.pal_receipt->>'begun_at' is distinct from old.pal_receipt->>'begun_at'))
    or (old.bara_receipt->>'state' = 'deleted' and new.bara_receipt is distinct from old.bara_receipt)
    or (old.bara_receipt is not null and (new.bara_receipt is null
      or (new.bara_receipt->>'deleted_count')::bigint < (old.bara_receipt->>'deleted_count')::bigint)) then
    raise exception using errcode='55000', message='student_provider_receipt_conflict';
  end if;
  return new;
end;
$$;
create trigger guard_student_provider_binding before update or delete
  on private.student_provider_cleanup_bindings for each row execute function private.guard_student_provider_binding();
create trigger retain_student_provider_binding before truncate
  on private.student_provider_cleanup_bindings for each statement execute function private.guard_student_provider_binding();

create function private.guard_attendance_membership_generation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode='55000', message='attendance_membership_generation_immutable';
end;
$$;
create trigger guard_attendance_membership_generation before update or delete
  on private.attendance_membership_generations for each row execute function private.guard_attendance_membership_generation();
create trigger retain_attendance_membership_generation before truncate
  on private.attendance_membership_generations for each statement execute function private.guard_attendance_membership_generation();

create function private.capture_attendance_membership_generation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_generation uuid; v_scope text;
begin
  if not coalesce((select enabled from private.student_provider_cleanup_settings where singleton),false) then return new; end if;
  perform private.try_lock_classroom_membership_change(new.classroom_id,new.student_id);
  v_scope := private.pal_membership_scope(new.classroom_id,new.student_id);
  select enrollment.id into v_generation from public.classroom_enrollments enrollment
    join private.pal_membership_generations generation on generation.generation_id=enrollment.id
    where enrollment.classroom_id=new.classroom_id and enrollment.student_id=new.student_id
      and generation.state='active' and generation.scope_digest=v_scope
      and enrollment.created_at >= (select eligible_after from private.student_provider_cleanup_settings where singleton);
  if v_generation is not null then
    insert into private.attendance_membership_generations(generation_id,participant_ref,scope_digest)
      values(v_generation,new.participant_ref,v_scope);
  end if;
  return new;
end;
$$;
create trigger capture_attendance_membership_generation after insert
  on public.attendance_participant_mappings for each row execute function private.capture_attendance_membership_generation();

-- Binding presence is the authority, not a mutable status or a session GUC.
-- Existing finalizers update status before deleting inventory; this trigger also
-- protects legacy renamed functions, retry callbacks, and direct service paths.
create function private.guard_student_provider_operation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  v_id := case when tg_op='DELETE' then old.id else new.id end;
  if exists(select 1 from private.student_provider_cleanup_bindings where operation_id=v_id) then
    if tg_op='DELETE' then raise exception using errcode='55000',message='student_provider_stage_required'; end if;
    if new.status <> 'provider_pending' or (tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old)) then
      raise exception using errcode='55000',message='student_provider_stage_required';
    end if;
  elsif tg_op <> 'DELETE' and new.status='provider_pending' then
    raise exception using errcode='55000',message='student_provider_binding_required';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger guard_student_provider_operation before insert or update or delete
  on public.student_purge_operations for each row execute function private.guard_student_provider_operation();

create function private.guard_student_provider_purge_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select distinct id from unnest(array[
    case when tg_op<>'DELETE' then new.operation_id end,
    case when tg_op<>'INSERT' then old.operation_id end]) id where id is not null loop
    if exists(select 1 from private.student_provider_cleanup_bindings where operation_id=v_id) then
      -- Reservation installs one fence, never objects or academic inventory.
      if tg_table_name <> 'student_purge_fences' or tg_op <> 'INSERT' then
        raise exception using errcode='55000',message='student_provider_stage_required';
      end if;
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger guard_student_provider_purge_objects before insert or update or delete
  on public.student_purge_objects for each row execute function private.guard_student_provider_purge_child();
create trigger guard_student_provider_purge_resources before insert or update or delete
  on public.student_purge_resources for each row execute function private.guard_student_provider_purge_child();
create trigger guard_student_provider_purge_fence before insert or update or delete
  on public.student_purge_fences for each row execute function private.guard_student_provider_purge_child();

create or replace function public.reject_attendance_student_purge_operation_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.student_purge_lock(new.classroom_id,new.student_id);
  if new.status='provider_pending' and exists(select 1 from private.student_provider_cleanup_bindings binding
    where binding.operation_id=new.id and binding.scope_digest=private.pal_membership_scope(new.classroom_id,new.student_id)) then
    return new;
  end if;
  if public.attendance_student_has_state_v1(new.classroom_id,new.student_id) then
    raise exception using errcode='55000',message='attendance_student_decommission_required';
  end if;
  return new;
end;
$$;

create function public.reserve_student_provider_cleanup(
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
      or v_existing.student_id is distinct from p_student_id or v_binding.generation_id is distinct from p_generation_id
      or v_binding.scope_digest is distinct from v_scope then
      raise exception using errcode='55000',message='student_provider_binding_conflict';
    end if;
    return public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
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
  if exists(select 1 from public.managed_storage_objects where classroom_id=p_classroom_id
      and purpose in ('classroom_archive','gradex_extract')) then
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
    pal_origin,pal_integration_id,bara_origin,installation_ref,roster_ref,participant_ref,actor_principal_ref)
    values(p_operation_id,p_generation_id,v_scope,v_generation.pal_reference,v_settings.pal_origin,
      v_settings.pal_integration_id,v_settings.bara_origin,v_settings.installation_ref,v_roster,v_participant,v_actor);
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

create function public.get_student_provider_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.student_purge_operations; v_binding private.student_provider_cleanup_bindings;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  select * into v_op from public.student_purge_operations where id=p_operation_id;
  select * into v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id;
  if v_op.teacher_id is distinct from p_teacher_id or v_op.classroom_id is distinct from p_classroom_id
    or v_op.student_id is distinct from p_student_id or v_binding.generation_id is distinct from p_generation_id
    or v_binding.scope_digest is distinct from private.pal_membership_scope(p_classroom_id,p_student_id)
    or not exists(select 1 from public.classrooms where id=p_classroom_id and teacher_id=p_teacher_id)
    or not exists(select 1 from public.student_purge_fences where operation_id=p_operation_id
      and classroom_id=p_classroom_id and student_id=p_student_id and teacher_id=p_teacher_id)
    or v_op.status is distinct from 'provider_pending' then
    raise exception using errcode='42501',message='student_provider_cleanup_forbidden';
  end if;
  return jsonb_build_object('schema_version',1,'operation_id',v_binding.operation_id,
    'generation_id',v_binding.generation_id,'status','provider_pending',
    'pal_origin',v_binding.pal_origin,'pal_integration_id',v_binding.pal_integration_id,
    'pal_reference',v_binding.pal_reference,'bara_origin',v_binding.bara_origin,
    'installation_ref',v_binding.installation_ref,'roster_ref',v_binding.roster_ref,
    'participant_ref',v_binding.participant_ref,'actor_principal_ref',v_binding.actor_principal_ref,
    'pal_receipt',v_binding.pal_receipt,'bara_receipt',v_binding.bara_receipt);
end;
$$;

create function public.authorize_student_provider_cleanup(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op jsonb; v_settings private.student_provider_cleanup_settings;
begin
  v_op:=public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into v_settings from private.student_provider_cleanup_settings where singleton for share;
  if not coalesce(v_settings.enabled,false) or v_settings.pal_origin is distinct from v_op->>'pal_origin'
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

create function public.record_student_provider_cleanup_receipt(
  p_operation_id uuid,p_teacher_id uuid,p_classroom_id uuid,p_student_id uuid,p_generation_id uuid,
  p_provider text,p_receipt jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op jsonb; v_binding private.student_provider_cleanup_bindings; v_keys text[];
begin
  v_op:=public.get_student_provider_cleanup(p_operation_id,p_teacher_id,p_classroom_id,p_student_id,p_generation_id);
  select * into v_binding from private.student_provider_cleanup_bindings where operation_id=p_operation_id for update;
  if jsonb_typeof(p_receipt) is distinct from 'object' then
    raise exception using errcode='22023',message='student_provider_receipt_invalid';
  end if;
  select array_agg(key order by key) into v_keys from jsonb_object_keys(p_receipt) key;
  if p_provider='pal' then
    if v_keys is distinct from array['begun_at','completed_at','learner_id','operation_id','schema_version','status']
      or p_receipt->'schema_version' is distinct from '1'::jsonb
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

-- A removed scoped Pal generation permanently stops its held delivery leases.
create function private.close_removed_pal_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.state='active' and new.state='removed' then
    update public.pal_event_outbox outbox set status='non_retryable',lease_token=null,lease_expires_at=null,
      last_error_code='membership_removed',last_error_detail=null
    from private.pal_membership_outbox binding
    where binding.outbox_id=outbox.id and binding.generation_id=new.generation_id
      and outbox.status in ('pending','processing');
  end if;
  return new;
end;
$$;
create trigger close_removed_pal_delivery after update on private.pal_membership_generations
  for each row execute function private.close_removed_pal_delivery();

create function private.guard_closed_pal_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_binding private.pal_membership_outbox; v_state text;
begin
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
create trigger guard_closed_pal_delivery before update on public.pal_event_outbox
  for each row execute function private.guard_closed_pal_delivery();

-- Closed generation metadata cannot be labelled purged using provider receipts.
create function private.guard_provider_generation_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from private.student_provider_cleanup_bindings where generation_id=old.generation_id)
    and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception using errcode='55000',message='student_provider_stage_required';
  end if;
  return new;
end;
$$;
create trigger guard_provider_generation_state before update on private.pal_membership_generations
  for each row execute function private.guard_provider_generation_state();

create function private.attendance_participant_generation_closed(p_participant_ref text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.attendance_membership_generations attendance
    join private.pal_membership_generations generation using(generation_id)
    where attendance.participant_ref=p_participant_ref and generation.state<>'active');
$$;

create function private.attendance_payload_generation_closed(p_classroom_id uuid,p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from private.attendance_membership_generations attendance
    join private.pal_membership_generations generation using(generation_id)
    join public.attendance_participant_mappings mapping on mapping.participant_ref=attendance.participant_ref
    where mapping.classroom_id=p_classroom_id and generation.state<>'active') then return false; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then return true; end if;
  if exists(select 1 from jsonb_path_query(p_payload,'$.**.participant_ref') ref
    where private.attendance_participant_generation_closed(ref #>> '{}')) then return true; end if;
  if p_payload->>'message_type'='check_in.invalidate' then
    -- The exact fact mapping must remain available until local inventory cleanup.
    if exists(select 1 from jsonb_path_query(p_payload,'$.**.check_in_ref') ref
      left join public.attendance_check_in_facts fact on fact.check_in_ref=ref #>> '{}'
        and fact.classroom_id=p_classroom_id
      where fact.check_in_ref is null or private.attendance_participant_generation_closed(fact.participant_ref)) then
      return true;
    end if;
  elsif coalesce(p_payload->>'message_type','') not in ('roster.snapshot','schedule.snapshot','session.command')
    and coalesce(p_payload->>'event_type','') not in ('attendance.check_in.accepted','attendance.check_in.invalidated',
      'attendance.session.scheduled','attendance.session.opened','attendance.session.closed','attendance.session.cancelled') then
    return true;
  end if;
  return false;
end;
$$;

create function private.guard_attendance_closed_subject()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_scope text; v_row jsonb;
begin
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
    v_scope:=private.pal_membership_scope((v_row->>'classroom_id')::uuid,(v_row->>'student_id')::uuid);
    if exists(select 1 from private.attendance_membership_generations attendance
      join private.pal_membership_generations generation using(generation_id)
      where attendance.scope_digest=v_scope and generation.state<>'active') then
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
create trigger guard_closed_participant_mapping before insert or update or delete on public.attendance_participant_mappings
  for each row execute function private.guard_attendance_closed_subject();
create trigger guard_closed_attendance_fact before insert or update on public.attendance_check_in_facts
  for each row execute function private.guard_attendance_closed_subject();
create trigger guard_closed_attendance_projection before insert or update on public.attendance_record_projection
  for each row execute function private.guard_attendance_closed_subject();
create trigger guard_closed_attendance_override before insert or update on public.attendance_status_overrides
  for each row execute function private.guard_attendance_closed_subject();
create trigger guard_closed_attendance_override_event before insert or update on public.attendance_status_override_events
  for each row execute function private.guard_attendance_closed_subject();

create function private.guard_attendance_closed_payload()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
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
create trigger guard_closed_attendance_outbox before insert or update on public.attendance_integration_outbox
  for each row execute function private.guard_attendance_closed_payload();
create trigger guard_closed_attendance_inbox before insert or update on public.attendance_integration_inbox
  for each row execute function private.guard_attendance_closed_payload();

create function private.close_removed_attendance_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid;
begin
  if old.state='active' and new.state='removed' then
    select mapping.classroom_id into v_classroom from public.attendance_participant_mappings mapping
      join private.attendance_membership_generations generation using(participant_ref)
      where generation.generation_id=new.generation_id;
    if v_classroom is not null then
      update public.attendance_integration_outbox set status='superseded',lease_token=null,lease_expires_at=null,
        last_error_code='membership_removed',last_error_detail=null
      where classroom_id=v_classroom and status in ('pending','processing','non_retryable')
        and private.attendance_payload_generation_closed(classroom_id,payload);
    end if;
  end if;
  return new;
end;
$$;
create trigger close_removed_attendance_delivery after update on private.pal_membership_generations
  for each row execute function private.close_removed_attendance_delivery();

-- Keep preparation, source hashes, and strict stage equality on one omission rule.
create or replace function public.attendance_roster_source_document_v1(p_classroom_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', classroom.title,
    'owner_principal_ref', owner_principal.principal_ref,
    'entitlement_revision', coalesce(entitlement.revision, 0),
    'enrolled_student_ids', coalesce((
      select jsonb_agg(enrollment.student_id order by enrollment.student_id)
      from public.classroom_enrollments enrollment
      where enrollment.classroom_id = classroom.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', mapping.student_id,
        'participant_ref', mapping.participant_ref,
        'active', exists (
          select 1 from public.classroom_enrollments enrollment
          where enrollment.classroom_id = mapping.classroom_id
            and enrollment.student_id = mapping.student_id
        ),
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'principal_ref', student_principal.principal_ref
      ) order by mapping.student_id)
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      left join public.attendance_principal_mappings student_principal
        on student_principal.user_id = student_user.id
      where mapping.classroom_id = classroom.id and not private.attendance_participant_generation_closed(mapping.participant_ref)
    ), '[]'::jsonb)
  )
  from public.classrooms classroom
  join public.users owner_user on owner_user.id = classroom.teacher_id
  join public.attendance_principal_mappings owner_principal
    on owner_principal.user_id = owner_user.id
  left join public.attendance_teacher_entitlements entitlement
    on entitlement.teacher_id = classroom.teacher_id
  where classroom.id = p_classroom_id;
$$;

create or replace function public.prepare_attendance_snapshot_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_window_start date,
  p_window_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_owner_principal_ref text;
  v_roster_document jsonb;
  v_schedule_document jsonb;
  v_roster_token text;
  v_schedule_token text;
  v_missing_profiles bigint;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  if p_teacher_id is null or p_classroom_id is null
    or p_window_start is null or p_window_end is null
    or p_window_end < p_window_start
    or p_window_end - p_window_start > 400 then
    raise exception using errcode = '22023', message = 'attendance_snapshot_window_invalid';
  end if;

  select * into v_classroom
  from public.classrooms
  where id = p_classroom_id
  for update;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_archived';
  end if;

  if not exists (
    select 1 from public.users
    where id = v_classroom.teacher_id and workos_user_id is not null
  ) then
    raise exception using errcode = '23514', message = 'attendance_owner_identity_not_linked';
  end if;

  select count(*) into v_missing_profiles
  from public.classroom_enrollments enrollment
  left join public.student_profiles profile on profile.user_id = enrollment.student_id
  where enrollment.classroom_id = p_classroom_id and profile.user_id is null;
  if v_missing_profiles > 0 then
    raise exception using errcode = '23514', message = 'attendance_student_profile_missing';
  end if;

  insert into public.attendance_roster_mappings (classroom_id)
  values (p_classroom_id)
  on conflict (classroom_id) do nothing;

  update public.attendance_participant_mappings mapping
  set active = exists (
        select 1 from public.classroom_enrollments enrollment
        where enrollment.classroom_id = mapping.classroom_id
          and enrollment.student_id = mapping.student_id
      ),
      updated_at = clock_timestamp()
  where mapping.classroom_id = p_classroom_id and not private.attendance_participant_generation_closed(mapping.participant_ref)
    and mapping.active is distinct from exists (
      select 1 from public.classroom_enrollments enrollment
      where enrollment.classroom_id = mapping.classroom_id
        and enrollment.student_id = mapping.student_id
    );

  insert into public.attendance_participant_mappings (
    classroom_id, student_id, active
  )
  select enrollment.classroom_id, enrollment.student_id, true
  from public.classroom_enrollments enrollment
  where enrollment.classroom_id = p_classroom_id
  on conflict (classroom_id, student_id) do update
    set active = true, updated_at = clock_timestamp();

  insert into public.attendance_principal_mappings (user_id)
  select candidate.user_id
  from (
    select v_classroom.teacher_id as user_id
    union
    select enrollment.student_id
    from public.classroom_enrollments enrollment
    join public.users student_user on student_user.id = enrollment.student_id
    where enrollment.classroom_id = p_classroom_id
      and student_user.workos_user_id is not null
  ) candidate
  on conflict (user_id) do nothing;

  select principal_ref into v_owner_principal_ref
  from public.attendance_principal_mappings
  where user_id = v_classroom.teacher_id;
  if v_owner_principal_ref is null then
    raise exception using errcode = '23514', message = 'attendance_owner_principal_missing';
  end if;

  insert into public.attendance_occurrence_mappings (
    classroom_id, class_date, opens_at, closes_at
  )
  select class_day.classroom_id, class_day.date, null, null
  from public.class_days class_day
  where class_day.classroom_id = p_classroom_id
    and class_day.date between p_window_start and p_window_end
    and class_day.is_class_day
  on conflict (classroom_id, class_date) do nothing;

  select * into v_roster
  from public.attendance_roster_mappings
  where classroom_id = p_classroom_id
  for update;

  v_roster_document := public.attendance_roster_source_document_v1(p_classroom_id);
  v_schedule_document := public.attendance_schedule_source_document_v1(
    p_classroom_id, p_window_start, p_window_end
  );
  if v_schedule_document is null then
    raise exception using errcode = '23514', message = 'attendance_window_policy_missing';
  end if;
  v_roster_token := md5(v_roster_document::text);
  v_schedule_token := md5(v_schedule_document::text);

  return jsonb_build_object(
    'classroom_id', p_classroom_id,
    'roster_ref', v_roster.roster_ref,
    'title', v_classroom.title,
    'owner_principal_ref', v_owner_principal_ref,
    'roster_source_token', v_roster_token,
    'roster_revision', case
      when v_roster.source_token = v_roster_token then greatest(v_roster.source_revision, 1)
      else v_roster.source_revision + 1
    end,
    'schedule_source_token', v_schedule_token,
    'schedule_revision', case
      when v_roster.schedule_source_token = v_schedule_token
        then greatest(v_roster.schedule_source_revision, 1)
      else v_roster.schedule_source_revision + 1
    end,
    'policy', v_schedule_document->'policy',
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', mapping.student_id,
        'participant_ref', mapping.participant_ref,
        'display_name', btrim(profile.first_name || ' ' || profile.last_name),
        'active', mapping.active,
        'principal_ref', student_principal.principal_ref
      ) order by profile.last_name, profile.first_name, mapping.student_id)
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      left join public.attendance_principal_mappings student_principal
        on student_principal.user_id = student_user.id
      where mapping.classroom_id = p_classroom_id and not private.attendance_participant_generation_closed(mapping.participant_ref)
    ), '[]'::jsonb),
    'class_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', class_day.date,
        'is_class_day', class_day.is_class_day,
        'occurrence_ref', occurrence.occurrence_ref
      ) order by class_day.date)
      from public.class_days class_day
      left join public.attendance_occurrence_mappings occurrence
        on occurrence.classroom_id = class_day.classroom_id
       and occurrence.class_date = class_day.date
      where class_day.classroom_id = p_classroom_id
        and class_day.date between p_window_start and p_window_end
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.stage_attendance_roster_snapshot_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_token text,
  p_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_current_token text;
  v_revision bigint;
  v_outbox public.attendance_integration_outbox%rowtype;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  if p_teacher_id is null or p_classroom_id is null
    or p_source_token !~ '^[a-f0-9]{32}$'
    or jsonb_typeof(p_message) <> 'object'
    or p_message->>'message_type' <> 'roster.snapshot'
    or jsonb_typeof(p_message->'revision') <> 'number'
    or p_message->>'revision' !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_message->'participants') <> 'array' then
    raise exception using errcode = '22023', message = 'attendance_roster_stage_invalid';
  end if;

  select * into v_classroom from public.classrooms
  where id = p_classroom_id for update;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id or v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;

  select * into v_roster from public.attendance_roster_mappings
  where classroom_id = p_classroom_id for update;
  if v_roster.classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_snapshot_not_prepared';
  end if;

  v_current_token := md5(public.attendance_roster_source_document_v1(p_classroom_id)::text);
  if v_current_token <> p_source_token then
    raise exception using errcode = '40001', message = 'attendance_roster_source_changed';
  end if;
  v_revision := case when v_roster.source_token = p_source_token
    then greatest(v_roster.source_revision, 1) else v_roster.source_revision + 1 end;

  if p_message->>'roster_ref' <> v_roster.roster_ref
    or (p_message->>'revision')::bigint <> v_revision
    or p_message->>'owner_principal_ref' <> (
      select principal_ref from public.attendance_principal_mappings
      where user_id = v_classroom.teacher_id
    )
    or p_message->>'display_name' <> v_classroom.title
    or p_message->>'owner_display_name' <> 'Pika teacher'
    or jsonb_array_length(p_message->'participants') <> (
      select count(*) from public.attendance_participant_mappings mapping
      where classroom_id = p_classroom_id and not private.attendance_participant_generation_closed(mapping.participant_ref)
    )
    or exists (
      select 1
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      left join public.attendance_principal_mappings student_principal
        on student_principal.user_id = student_user.id
      where mapping.classroom_id = p_classroom_id and not private.attendance_participant_generation_closed(mapping.participant_ref)
        and not exists (
          select 1 from jsonb_array_elements(p_message->'participants') participant
          where participant->>'participant_ref' = mapping.participant_ref
            and participant->>'display_name' = btrim(profile.first_name || ' ' || profile.last_name)
            and jsonb_typeof(participant->'active') = 'boolean'
            and (participant->>'active')::boolean = mapping.active
            and coalesce(participant->>'principal_ref', '') = coalesce(student_principal.principal_ref, '')
        )
    ) then
    raise exception using errcode = '22023', message = 'attendance_roster_message_mismatch';
  end if;

  select * into v_outbox from public.enqueue_attendance_outbound_message_v1(
    p_classroom_id, p_message
  );
  update public.attendance_roster_mappings
  set source_token = p_source_token,
      source_revision = v_revision,
      staged_revision = v_revision,
      updated_at = clock_timestamp()
  where classroom_id = p_classroom_id;

  return jsonb_build_object(
    'outbox_id', v_outbox.id,
    'idempotency_key', v_outbox.idempotency_key,
    'revision', v_revision,
    'status', v_outbox.status
  );
end;
$$;

create or replace function public.apply_attendance_event_v1(
  p_event jsonb,
  p_transport_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox_id uuid;
  v_classroom_id uuid;
  v_student_id uuid;
  v_existing_check_in public.attendance_check_in_facts%rowtype;
  v_incoming_revision bigint;
  v_incoming_invalidated_at timestamptz;
  v_projection_rows integer := 0;
begin
  if not public.attendance_event_v1_valid(p_event)
    or p_transport_nonce !~ '^[A-Za-z0-9._~-]{16,128}$' then
    raise exception using errcode = '22023', message = 'attendance_event_invalid';
  end if;

  select occurrence.classroom_id into v_classroom_id
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_event->>'occurrence_ref'
    and roster.roster_ref = p_event->>'roster_ref';
  if v_classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_event_mapping_mismatch';
  end if;

  perform private.try_lock_classroom_membership_change(v_classroom_id);
  if private.attendance_payload_generation_closed(v_classroom_id,p_event) then
    raise exception using errcode='55000',message='attendance_membership_generation_closed';
  end if;

  if p_event->>'event_type' in (
    'attendance.check_in.accepted', 'attendance.check_in.invalidated'
  ) then
    select participant.student_id into v_student_id
    from public.attendance_participant_mappings participant
    where participant.classroom_id = v_classroom_id
      and participant.participant_ref = p_event->'metadata'->>'participant_ref';
    if v_student_id is null then
      raise exception using errcode = '23514', message = 'attendance_event_participant_mismatch';
    end if;
  end if;

  insert into public.attendance_integration_inbox (
    classroom_id, installation_ref, transport_nonce, event_id,
    idempotency_key, correlation_ref, event_type, occurred_at,
    roster_ref, occurrence_ref, session_revision, payload
  ) values (
    v_classroom_id, p_event->>'installation_ref', p_transport_nonce,
    p_event->>'event_id', p_event->>'idempotency_key',
    p_event->>'correlation_ref', p_event->>'event_type',
    (p_event->>'occurred_at')::timestamptz, p_event->>'roster_ref',
    p_event->>'occurrence_ref', (p_event->>'session_revision')::bigint, p_event
  ) on conflict do nothing returning id into v_inbox_id;

  if v_inbox_id is null then
    if exists (
      select 1 from public.attendance_integration_inbox
      where installation_ref = p_event->>'installation_ref'
        and event_id = p_event->>'event_id' and payload = p_event
    ) then
      return jsonb_build_object(
        'accepted', true, 'duplicate', true, 'projection_applied', false
      );
    end if;
    raise exception using errcode = '23505', message = 'attendance_event_replay_conflict';
  end if;

  if p_event->>'event_type' in (
    'attendance.session.scheduled', 'attendance.session.opened',
    'attendance.session.closed', 'attendance.session.cancelled'
  ) then
    insert into public.attendance_session_projection (
      classroom_id, installation_ref, roster_ref, occurrence_ref,
      session_revision, status, opens_at, closes_at,
      last_event_id, last_event_at
    ) values (
      v_classroom_id, p_event->>'installation_ref', p_event->>'roster_ref',
      p_event->>'occurrence_ref', (p_event->>'session_revision')::bigint,
      case p_event->>'event_type'
        when 'attendance.session.scheduled' then 'scheduled'
        when 'attendance.session.opened' then 'open'
        when 'attendance.session.closed' then 'closed'
        else 'cancelled'
      end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'accepts_at')::timestamptz end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'stops_accepting_at')::timestamptz end,
      p_event->>'event_id', (p_event->>'occurred_at')::timestamptz
    ) on conflict (installation_ref, occurrence_ref) do update
      set roster_ref = excluded.roster_ref,
          classroom_id = excluded.classroom_id,
          session_revision = excluded.session_revision,
          status = excluded.status,
          opens_at = coalesce(excluded.opens_at, public.attendance_session_projection.opens_at),
          closes_at = coalesce(excluded.closes_at, public.attendance_session_projection.closes_at),
          last_event_id = excluded.last_event_id,
          last_event_at = excluded.last_event_at,
          updated_at = clock_timestamp()
      where excluded.session_revision > public.attendance_session_projection.session_revision;
    get diagnostics v_projection_rows = row_count;

    if p_event->>'event_type' in (
      'attendance.session.opened', 'attendance.session.closed',
      'attendance.session.cancelled'
    ) then
      update public.attendance_occurrence_mappings
      set policy_frozen_at = coalesce(
        policy_frozen_at, (p_event->>'occurred_at')::timestamptz
      )
      where occurrence_ref = p_event->>'occurrence_ref';
    end if;
  else
    v_incoming_revision := (p_event->'metadata'->>'check_in_revision')::bigint;
    v_incoming_invalidated_at := case
      when p_event->>'event_type' = 'attendance.check_in.invalidated'
      then (p_event->'metadata'->>'invalidated_at')::timestamptz end;
    perform pg_advisory_xact_lock(hashtextextended(
      (p_event->>'installation_ref') || ':' ||
        (p_event->'metadata'->>'check_in_ref'), 0
    ));
    select * into v_existing_check_in
    from public.attendance_check_in_facts
    where installation_ref = p_event->>'installation_ref'
      and check_in_ref = p_event->'metadata'->>'check_in_ref'
    for update;

    if v_existing_check_in.id is null then
      insert into public.attendance_check_in_facts (
        classroom_id, student_id, installation_ref, roster_ref,
        occurrence_ref, participant_ref, check_in_ref, check_in_revision,
        accepted_at, invalidated_at, reason_code, last_event_id, last_event_at
      ) values (
        v_classroom_id, v_student_id, p_event->>'installation_ref',
        p_event->>'roster_ref', p_event->>'occurrence_ref',
        p_event->'metadata'->>'participant_ref',
        p_event->'metadata'->>'check_in_ref', v_incoming_revision,
        (p_event->'metadata'->>'accepted_at')::timestamptz,
        v_incoming_invalidated_at, p_event->'metadata'->>'reason_code',
        p_event->>'event_id', (p_event->>'occurred_at')::timestamptz
      );
      v_projection_rows := 1;
    elsif v_existing_check_in.classroom_id <> v_classroom_id
      or v_existing_check_in.student_id <> v_student_id
      or v_existing_check_in.roster_ref <> p_event->>'roster_ref'
      or v_existing_check_in.occurrence_ref <> p_event->>'occurrence_ref'
      or v_existing_check_in.participant_ref <>
        p_event->'metadata'->>'participant_ref'
      or v_existing_check_in.accepted_at <>
        (p_event->'metadata'->>'accepted_at')::timestamptz then
      raise exception using errcode = '23514', message = 'attendance_check_in_identity_conflict';
    elsif v_incoming_revision < v_existing_check_in.check_in_revision then
      v_projection_rows := 0;
    elsif v_incoming_revision = v_existing_check_in.check_in_revision then
      if v_existing_check_in.invalidated_at is distinct from v_incoming_invalidated_at
        or v_existing_check_in.reason_code is distinct from
          p_event->'metadata'->>'reason_code' then
        raise exception using errcode = '23514', message = 'attendance_check_in_revision_conflict';
      end if;
      v_projection_rows := 0;
    elsif v_existing_check_in.invalidated_at is not null
      or v_incoming_invalidated_at is null
      or v_incoming_revision <> v_existing_check_in.check_in_revision + 1 then
      raise exception using errcode = '23514', message = 'attendance_check_in_transition_invalid';
    else
      update public.attendance_check_in_facts
      set check_in_revision = v_incoming_revision,
          invalidated_at = v_incoming_invalidated_at,
          reason_code = p_event->'metadata'->>'reason_code',
          last_event_id = p_event->>'event_id',
          last_event_at = (p_event->>'occurred_at')::timestamptz,
          updated_at = clock_timestamp()
      where id = v_existing_check_in.id;
      v_projection_rows := 1;
    end if;
    update public.attendance_occurrence_mappings
    set policy_frozen_at = coalesce(
      policy_frozen_at, (p_event->'metadata'->>'accepted_at')::timestamptz
    )
    where occurrence_ref = p_event->>'occurrence_ref';
  end if;

  update public.attendance_integration_inbox
  set projection_applied = v_projection_rows > 0 where id = v_inbox_id;
  return jsonb_build_object(
    'accepted', true, 'duplicate', false,
    'projection_applied', v_projection_rows > 0
  );
end;
$$;

create or replace function public.apply_attendance_session_snapshot_v1(
  p_installation_ref text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_in jsonb;
  v_classroom_id uuid;
  v_student_id uuid;
  v_existing_check_in public.attendance_check_in_facts%rowtype;
  v_incoming_revision bigint;
  v_incoming_invalidated_at timestamptz;
  v_session_rows integer := 0;
  v_check_in_rows integer := 0;
  v_current_rows integer := 0;
begin
  if p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$'
    or not public.attendance_session_snapshot_v1_valid(p_snapshot) then
    raise exception using errcode = '22023', message = 'attendance_snapshot_invalid';
  end if;

  select occurrence.classroom_id into v_classroom_id
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_snapshot->>'occurrence_ref'
    and roster.roster_ref = p_snapshot->>'roster_ref'
    and occurrence.desired_state = 'scheduled'
    and occurrence.opens_at = (p_snapshot->>'accepts_at')::timestamptz
    and occurrence.closes_at = (p_snapshot->>'stops_accepting_at')::timestamptz;
  if v_classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_snapshot_mapping_mismatch';
  end if;

  perform private.try_lock_classroom_membership_change(v_classroom_id);

  if exists (
    select 1 from jsonb_array_elements(p_snapshot->'check_ins') check_in
    where not exists (
      select 1 from public.attendance_participant_mappings participant
      where participant.classroom_id = v_classroom_id
        and participant.participant_ref = check_in->>'participant_ref'
    )
  ) then
    raise exception using errcode = '23514', message = 'attendance_snapshot_participant_mismatch';
  end if;

  insert into public.attendance_session_projection (
    classroom_id, installation_ref, roster_ref, occurrence_ref,
    session_revision, status, opens_at, closes_at, last_event_id, last_event_at
  ) values (
    v_classroom_id, p_installation_ref, p_snapshot->>'roster_ref',
    p_snapshot->>'occurrence_ref', (p_snapshot->>'session_revision')::bigint,
    p_snapshot->>'status', (p_snapshot->>'accepts_at')::timestamptz,
    (p_snapshot->>'stops_accepting_at')::timestamptz,
    'reconcile:' || (p_snapshot->>'occurrence_ref') || ':' ||
      (p_snapshot->>'session_revision'), clock_timestamp()
  ) on conflict (installation_ref, occurrence_ref) do update
    set roster_ref = excluded.roster_ref,
        classroom_id = excluded.classroom_id,
        session_revision = excluded.session_revision,
        status = excluded.status,
        opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        last_event_id = excluded.last_event_id,
        last_event_at = excluded.last_event_at,
        updated_at = clock_timestamp()
    where excluded.session_revision > public.attendance_session_projection.session_revision;
  get diagnostics v_session_rows = row_count;

  for v_check_in in select value from jsonb_array_elements(p_snapshot->'check_ins') loop
    if private.attendance_participant_generation_closed(v_check_in->>'participant_ref') then continue; end if;
    select student_id into v_student_id
    from public.attendance_participant_mappings
    where classroom_id = v_classroom_id
      and participant_ref = v_check_in->>'participant_ref';
    v_incoming_revision := (v_check_in->>'check_in_revision')::bigint;
    v_incoming_invalidated_at := case when v_check_in ? 'invalidated_at'
      then (v_check_in->>'invalidated_at')::timestamptz end;
    perform pg_advisory_xact_lock(hashtextextended(
      p_installation_ref || ':' || (v_check_in->>'check_in_ref'), 0
    ));
    select * into v_existing_check_in
    from public.attendance_check_in_facts
    where installation_ref = p_installation_ref
      and check_in_ref = v_check_in->>'check_in_ref'
    for update;

    if v_existing_check_in.id is null then
      insert into public.attendance_check_in_facts (
        classroom_id, student_id, installation_ref, roster_ref, occurrence_ref,
        participant_ref, check_in_ref, check_in_revision, accepted_at,
        invalidated_at, reason_code, last_event_id, last_event_at
      ) values (
        v_classroom_id, v_student_id, p_installation_ref, p_snapshot->>'roster_ref',
        p_snapshot->>'occurrence_ref', v_check_in->>'participant_ref',
        v_check_in->>'check_in_ref', v_incoming_revision,
        (v_check_in->>'accepted_at')::timestamptz, v_incoming_invalidated_at,
        v_check_in->>'reason_code',
        'reconcile:' || (v_check_in->>'check_in_ref') || ':' || v_incoming_revision,
        clock_timestamp()
      );
      v_current_rows := 1;
    elsif v_existing_check_in.classroom_id <> v_classroom_id
      or v_existing_check_in.student_id <> v_student_id
      or v_existing_check_in.roster_ref <> p_snapshot->>'roster_ref'
      or v_existing_check_in.occurrence_ref <> p_snapshot->>'occurrence_ref'
      or v_existing_check_in.participant_ref <> v_check_in->>'participant_ref'
      or v_existing_check_in.accepted_at <>
        (v_check_in->>'accepted_at')::timestamptz then
      raise exception using errcode = '23514', message = 'attendance_check_in_identity_conflict';
    elsif v_incoming_revision < v_existing_check_in.check_in_revision then
      v_current_rows := 0;
    elsif v_incoming_revision = v_existing_check_in.check_in_revision then
      if v_existing_check_in.invalidated_at is distinct from v_incoming_invalidated_at
        or v_existing_check_in.reason_code is distinct from v_check_in->>'reason_code' then
        raise exception using errcode = '23514', message = 'attendance_check_in_revision_conflict';
      end if;
      v_current_rows := 0;
    elsif v_existing_check_in.invalidated_at is not null
      or v_incoming_invalidated_at is null
      or v_incoming_revision <> v_existing_check_in.check_in_revision + 1 then
      raise exception using errcode = '23514', message = 'attendance_check_in_transition_invalid';
    else
      update public.attendance_check_in_facts
      set check_in_revision = v_incoming_revision,
          invalidated_at = v_incoming_invalidated_at,
          reason_code = v_check_in->>'reason_code',
          last_event_id = 'reconcile:' || (v_check_in->>'check_in_ref') || ':' ||
            v_incoming_revision,
          last_event_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where id = v_existing_check_in.id;
      v_current_rows := 1;
    end if;
    v_check_in_rows := v_check_in_rows + v_current_rows;
  end loop;

  update public.attendance_occurrence_mappings
  set last_reconciled_at = clock_timestamp(),
      policy_frozen_at = case
        when p_snapshot->>'status' in ('open', 'closed', 'cancelled')
          or jsonb_array_length(p_snapshot->'check_ins') > 0
        then coalesce(policy_frozen_at, clock_timestamp())
        else policy_frozen_at end
  where occurrence_ref = p_snapshot->>'occurrence_ref';

  return jsonb_build_object(
    'applied', true,
    'session_projection_applied', v_session_rows > 0,
    'check_in_projection_count', v_check_in_rows
  );
end;
$$;


create function public.authorize_attendance_generation_delivery(p_outbox_id uuid,p_lease_token uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.attendance_integration_outbox;
begin
  select * into v_row from public.attendance_integration_outbox where id=p_outbox_id;
  if not found then return false; end if;
  perform private.try_lock_classroom_membership_change(v_row.classroom_id);
  select * into v_row from public.attendance_integration_outbox where id=p_outbox_id;
  if v_row.payload is distinct from p_payload
    or private.attendance_payload_generation_closed(v_row.classroom_id,v_row.payload) then return false; end if;
  return (p_lease_token is null and v_row.status='delivered') or
    (v_row.status='processing' and v_row.lease_token=p_lease_token and v_row.lease_expires_at>clock_timestamp());
end;
$$;

-- Resolve a CURRENT exact generation before scan, retry, and response delivery.
-- No new participant mapping or enrollment is provisioned by this resolver.
create function public.resolve_attendance_scan_generation(p_classroom_id uuid,p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_generation uuid; v_participant text;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  if exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=p_student_id)
    or exists(select 1 from public.classroom_roster where classroom_id=p_classroom_id
      and removed_student_id=p_student_id and removed_at is not null)
    or exists(select 1 from public.attendance_decommission_operations where classroom_id=p_classroom_id) then
    return jsonb_build_object('status','forbidden');
  end if;
  select enrollment.id,mapping.participant_ref into v_generation,v_participant
    from public.classroom_enrollments enrollment
    join public.classrooms classroom on classroom.id=enrollment.classroom_id and classroom.archived_at is null
    join public.attendance_participant_mappings mapping on mapping.classroom_id=enrollment.classroom_id
      and mapping.student_id=enrollment.student_id and mapping.active
    join private.pal_membership_generations generation on generation.generation_id=enrollment.id and generation.state='active'
    where enrollment.classroom_id=p_classroom_id and enrollment.student_id=p_student_id
      and not private.attendance_participant_generation_closed(mapping.participant_ref);
  if v_generation is null then return jsonb_build_object('status','forbidden'); end if;
  return jsonb_build_object('status','active','generation_id',v_generation,'participant_ref',v_participant);
end;
$$;

-- Unknown historical payloads remain blocked. Ordinary no-fence functions retain
-- their original behavior; an exact-fence check precedes cached success replay.

create or replace function public.enqueue_attendance_outbound_message_v1(
  p_classroom_id uuid,
  p_message jsonb
)
returns public.attendance_integration_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_integration_outbox%rowtype;
  v_idempotency_key text := p_message->>'idempotency_key';
  v_message_type text := p_message->>'message_type';
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  if private.attendance_payload_generation_closed(p_classroom_id,p_message) then
    raise exception using errcode='55000',message='attendance_membership_generation_closed';
  end if;
  if p_classroom_id is null or p_message is null
    or jsonb_typeof(p_message) <> 'object'
    or pg_column_size(p_message) > 524288
    or p_message->>'schema_version' <> '1'
    or v_message_type not in (
      'roster.snapshot', 'schedule.snapshot', 'session.command', 'check_in.invalidate'
    )
    or v_idempotency_key !~ '^[A-Za-z0-9._~:-]{1,200}$'
    or p_message->>'correlation_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_message->>'installation_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_message->>'roster_ref' !~ '^[A-Za-z0-9._~-]{1,128}$' then
    raise exception using errcode = '22023', message = 'attendance_outbox_message_invalid';
  end if;
  if not exists (select 1 from public.classrooms where id = p_classroom_id) then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_classroom_id::text, 918273645));
  insert into public.attendance_integration_outbox (
    classroom_id, idempotency_key, message_type, payload
  ) values (p_classroom_id, v_idempotency_key, v_message_type, p_message)
  on conflict (idempotency_key) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.attendance_integration_outbox
    where idempotency_key = v_idempotency_key;
    if v_row.classroom_id <> p_classroom_id
      or v_row.message_type <> v_message_type or v_row.payload <> p_message then
      raise exception using errcode = '23505', message = 'attendance_outbox_idempotency_conflict';
    end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.get_student_purge_health_snapshot(
  p_stuck_minutes integer default 30, p_failed_minutes integer default 15
)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'captured_at', clock_timestamp(),
    'active_count', count(*) filter (where status in ('inventorying','deleting_objects','finalizing','provider_pending')),
    'stuck_count', count(*) filter (where status in ('inventorying','deleting_objects','finalizing','provider_pending')
      and updated_at < clock_timestamp() - make_interval(mins => greatest(p_stuck_minutes, 1))),
    'failed_count', count(*) filter (where status = 'failed'
      and updated_at < clock_timestamp() - make_interval(mins => greatest(p_failed_minutes, 1))),
    'orphan_fence_count', (select count(*) from public.student_purge_fences fence
      left join public.student_purge_operations operation on operation.id = fence.operation_id
      where operation.id is null or operation.status = 'completed'),
    'processing_lease_drift_count', (select count(*) from public.student_purge_objects
      where (status = 'processing') <> (lease_token is not null and lease_expires_at is not null))
  ) from public.student_purge_operations
$$;

revoke all on function private.guard_student_provider_binding(),private.guard_attendance_membership_generation(),
  private.capture_attendance_membership_generation(),private.guard_student_provider_operation(),
  private.guard_student_provider_purge_child(),private.close_removed_pal_delivery(),private.guard_closed_pal_delivery(),
  private.guard_provider_generation_state(),private.attendance_participant_generation_closed(text),
  private.attendance_payload_generation_closed(uuid,jsonb),private.guard_attendance_closed_subject(),
  private.guard_attendance_closed_payload(),private.close_removed_attendance_delivery()
  from public,anon,authenticated,service_role;
revoke all on function public.reserve_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid),
  public.get_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid),
  public.authorize_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid),
  public.record_student_provider_cleanup_receipt(uuid,uuid,uuid,uuid,uuid,text,jsonb),
  public.authorize_attendance_generation_delivery(uuid,uuid,jsonb),public.resolve_attendance_scan_generation(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid),
  public.get_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid),
  public.authorize_student_provider_cleanup(uuid,uuid,uuid,uuid,uuid),
  public.record_student_provider_cleanup_receipt(uuid,uuid,uuid,uuid,uuid,text,jsonb),
  public.authorize_attendance_generation_delivery(uuid,uuid,jsonb),public.resolve_attendance_scan_generation(uuid,uuid)
  to service_role;

comment on table private.student_provider_cleanup_bindings is
  'Provider prerequisite evidence only. Always blocks academic finalization and re-add in this increment; retained outside classroom archives.';
commit;
