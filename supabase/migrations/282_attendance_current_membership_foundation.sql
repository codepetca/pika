-- Dormant membership metadata only. No installation-time capture, pointer
-- rotation, runtime adoption, provider configuration or activation.
begin;
set local lock_timeout='5s';

create table private.attendance_participant_associations (
  participant_ref text primary key check(participant_ref ~ '^participant_[a-f0-9]{32}$'),
  scope_digest text,
  generation_id uuid references private.pal_membership_generations(generation_id) on delete restrict,
  closed boolean not null default false,
  check((scope_digest is null and generation_id is null and closed)
    or (scope_digest is not null and scope_digest ~ '^[a-f0-9]{64}$'))
);
create unique index attendance_participant_association_generation
  on private.attendance_participant_associations(generation_id) where generation_id is not null;
create index attendance_participant_association_scope
  on private.attendance_participant_associations(scope_digest) where scope_digest is not null;
alter table private.attendance_participant_associations enable row level security;
revoke all on private.attendance_participant_associations from public,anon,authenticated,service_role;

create table private.attendance_override_event_generations (
  event_id uuid primary key references public.attendance_status_override_events(id) on delete cascade,
  generation_id uuid not null references private.pal_membership_generations(generation_id) on delete restrict
);
alter table private.attendance_override_event_generations enable row level security;
revoke all on private.attendance_override_event_generations from public,anon,authenticated,service_role;

-- The future atomic writer must establish event-time provenance before opening
-- this insert path. Existing events cannot be retroactively annotated.
create function private.guard_attendance_override_event_generation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='55000',message='attendance_override_generation_writer_required';
end;
$$;
create trigger guard_attendance_override_event_generation
  before insert or update on private.attendance_override_event_generations
  for each row execute function private.guard_attendance_override_event_generation();
revoke all on function private.guard_attendance_override_event_generation() from public,anon,authenticated,service_role;

-- Direct application writes are denied by ACL. The only erasure writer below
-- checks the existing operation capability after an actual public-row deletion.
-- Retained171 evidence is neither modified nor given a new erasure exception.
create function private.guard_attendance_participant_association()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception using errcode='55000',message='attendance_participant_association_immutable';
  end if;
  if new.participant_ref is distinct from old.participant_ref
    or (old.closed and not new.closed)
    or not (
      (new.scope_digest is not distinct from old.scope_digest
        and new.generation_id is not distinct from old.generation_id)
      or (old.scope_digest is not null and new.scope_digest is null
        and new.generation_id is null and new.closed)
    ) then
    raise exception using errcode='55000',message='attendance_participant_association_immutable';
  end if;
  return new;
end;
$$;
create trigger guard_attendance_participant_association
  before update or delete on private.attendance_participant_associations
  for each row execute function private.guard_attendance_participant_association();
create trigger retain_attendance_participant_associations
  before truncate on private.attendance_participant_associations
  for each statement execute function private.guard_attendance_participant_association();
revoke all on function private.guard_attendance_participant_association() from public,anon,authenticated,service_role;

create function private.capture_attendance_participant_association(
  p_classroom_id uuid,p_student_id uuid,p_participant_ref text
) returns void language plpgsql security definer set search_path='' as $$
declare v_scope text; v_generation uuid; v_closed boolean:=false;
  v_existing private.attendance_participant_associations;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='55000',message='attendance_membership_isolation_required';
  end if;
  if p_classroom_id is null or p_student_id is null or p_participant_ref is null then
    raise exception using errcode='22023',message='attendance_participant_association_invalid';
  end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  v_scope:=private.pal_membership_scope(p_classroom_id,p_student_id);
  perform 1 from public.attendance_participant_mappings mapping
    where mapping.classroom_id=p_classroom_id and mapping.student_id=p_student_id
      and mapping.participant_ref=p_participant_ref for update;
  if not found then
    raise exception using errcode='55000',message='attendance_participant_association_invalid';
  end if;
  -- Only171 is independent legacy attribution evidence. Current enrollment,
  -- dates, mutable projections and provider-active flags cannot establish it.
  select attendance.generation_id,generation.state<>'active' into v_generation,v_closed
    from private.attendance_membership_generations attendance
    join private.pal_membership_generations generation using(generation_id)
    where attendance.participant_ref=p_participant_ref
      and attendance.scope_digest=v_scope and generation.scope_digest=v_scope;
  if v_generation is null and exists(select 1 from private.attendance_membership_generations
    where participant_ref=p_participant_ref) then
    raise exception using errcode='55000',message='attendance_participant_association_invalid';
  end if;
  insert into private.attendance_participant_associations(participant_ref,scope_digest,generation_id,closed)
    values(p_participant_ref,v_scope,v_generation,coalesce(v_closed,false))
    on conflict(participant_ref) do nothing;
  select * into strict v_existing from private.attendance_participant_associations
    where participant_ref=p_participant_ref for update;
  if v_existing.scope_digest is distinct from v_scope
    or (v_existing.generation_id is not null and v_existing.generation_id is distinct from v_generation) then
    raise exception using errcode='55000',message='attendance_participant_association_conflict';
  end if;
  -- A previously unknown generation stays unknown. No UPDATE/backfill occurs.
end;
$$;
revoke all on function private.capture_attendance_participant_association(uuid,uuid,text)
  from public,anon,authenticated,service_role;

create function private.resolve_attendance_participant_subject(
  p_classroom_id uuid,p_participant_ref text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_scope text; v_subjects uuid[];
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='55000',message='attendance_membership_isolation_required';
  end if;
  if p_classroom_id is null or p_participant_ref is null then return null; end if;
  perform private.try_lock_classroom_membership_change(p_classroom_id);
  select association.scope_digest into v_scope
    from private.attendance_participant_associations association
    where association.participant_ref=p_participant_ref and not association.closed
      and association.scope_digest is not null
      and (association.generation_id is null or exists(
        select 1 from private.pal_membership_generations generation
        where generation.generation_id=association.generation_id
          and generation.state='active' and generation.scope_digest=association.scope_digest));
  if v_scope is null then return null; end if;
  select array_agg(distinct candidate.student_id) into v_subjects from (
    select student_id from public.attendance_participant_mappings where classroom_id=p_classroom_id
    union select student_id from public.classroom_enrollments where classroom_id=p_classroom_id
    union select removed_student_id from public.classroom_roster
      where classroom_id=p_classroom_id and removed_at is not null
  ) candidate where candidate.student_id is not null
    and private.pal_membership_scope(p_classroom_id,candidate.student_id)=v_scope;
  if v_subjects is null or cardinality(v_subjects)<>1 then return null; end if;
  return v_subjects[1];
end;
$$;
revoke all on function private.resolve_attendance_participant_subject(uuid,text)
  from public,anon,authenticated,service_role;

create function private.assert_attendance_cleanup_reference_coverage(
  p_classroom_id uuid,p_student_id uuid,p_participant_ref text
) returns void language plpgsql security definer set search_path='' as $$
declare v_scope text;
begin
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  v_scope:=private.pal_membership_scope(p_classroom_id,p_student_id);
  -- Empty dormant metadata does not change legacy cleanup behavior.
  if not exists(select 1 from private.attendance_participant_associations where scope_digest=v_scope) then return; end if;
  if p_participant_ref is null or exists(
    select 1 from (
      select participant_ref from private.attendance_participant_associations where scope_digest=v_scope
      union select participant_ref from private.attendance_membership_generations where scope_digest=v_scope
    ) reference where reference.participant_ref<>p_participant_ref and not exists(
      -- Retained171 proof can outlive an already completed exact erasure.
      select 1 from private.student_provider_cleanup_bindings binding
      join public.student_purge_operations operation on operation.id=binding.operation_id
      where operation.status='completed' and operation.classroom_id=p_classroom_id
        and binding.scope_digest=v_scope and binding.participant_ref=reference.participant_ref
        and binding.pal_receipt->>'status'='completed'
        and binding.pal_receipt->>'operation_id'=binding.operation_id::text
        and binding.pal_receipt->>'learner_id'=binding.pal_reference
        and binding.bara_receipt->>'state'='deleted'
        and binding.bara_receipt->'absence_verified'='true'::jsonb
        and binding.bara_receipt->>'installation_ref'=binding.installation_ref
        and binding.bara_receipt->>'roster_ref'=binding.roster_ref
        and binding.bara_receipt->>'participant_ref'=reference.participant_ref
        and binding.bara_receipt->>'operation_ref'='erase_participant_'||replace(binding.operation_id::text,'-','')
    )
  ) then
    raise exception using errcode='55000',message='attendance_cleanup_reference_uncovered';
  end if;
end;
$$;
revoke all on function private.assert_attendance_cleanup_reference_coverage(uuid,uuid,text)
  from public,anon,authenticated,service_role;

-- Same175 API and authorization. Every reservation returns through this read;
-- pending retries and239 completion also call it before external/destructive
-- work. Raising here rolls fresh reservation writes back atomically.
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
  if v_op.status<>'completed' then
    perform private.assert_attendance_cleanup_reference_coverage(p_classroom_id,p_student_id,v_binding.participant_ref);
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

create function private.scrub_deleted_attendance_participant_associations()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_scope text; v_allowed boolean;
begin
  perform private.try_lock_classroom_membership_change(old.classroom_id,old.student_id);
  v_scope:=private.pal_membership_scope(old.classroom_id,old.student_id);
  if not exists(select 1 from private.attendance_participant_associations where scope_digest=v_scope) then return old; end if;
  v_allowed:=private.attendance_decommission_delete_allowed('attendance_participant_mappings',to_jsonb(old));
  if not v_allowed then
    v_allowed:=private.removed_academic_delete_allowed('attendance_participant_mappings',to_jsonb(old))
      and exists(
        select 1 from private.student_provider_cleanup_bindings binding
        join public.student_purge_operations operation on operation.id=binding.operation_id
        join public.student_purge_fences fence on fence.operation_id=operation.id
        where binding.participant_ref=old.participant_ref and binding.scope_digest=v_scope
          and binding.pal_schema_version=2 and binding.pal_policy='pika-live-v1'
          and operation.status='provider_pending' and operation.classroom_id=old.classroom_id
          and operation.student_id=old.student_id
          and fence.classroom_id=old.classroom_id and fence.student_id=old.student_id
          and fence.teacher_id=operation.teacher_id
          and private.live_student_finalizing(old.classroom_id,old.student_id,binding.generation_id)
          and binding.pal_receipt->>'status'='completed'
          and binding.pal_receipt->>'operation_id'=binding.operation_id::text
          and binding.pal_receipt->>'learner_id'=binding.pal_reference
          and binding.bara_receipt->>'state'='deleted'
          and binding.bara_receipt->'absence_verified'='true'::jsonb
          and binding.bara_receipt->>'installation_ref'=binding.installation_ref
          and binding.bara_receipt->>'roster_ref'=binding.roster_ref
          and binding.bara_receipt->>'participant_ref'=old.participant_ref
          and binding.bara_receipt->>'operation_ref'='erase_participant_'||replace(binding.operation_id::text,'-','')
      );
    if v_allowed then
      perform private.assert_attendance_cleanup_reference_coverage(old.classroom_id,old.student_id,old.participant_ref);
    end if;
  end if;
  if not coalesce(v_allowed,false) then
    raise exception using errcode='55000',message='attendance_participant_association_erasure_forbidden';
  end if;
  update private.attendance_participant_associations
    set scope_digest=null,generation_id=null,closed=true where scope_digest=v_scope;
  if exists(select 1 from private.attendance_participant_associations where scope_digest=v_scope) then
    raise exception using errcode='55000',message='attendance_participant_association_erasure_unverified';
  end if;
  return old;
end;
$$;
create trigger scrub_deleted_attendance_participant_associations
  after delete on public.attendance_participant_mappings
  for each row execute function private.scrub_deleted_attendance_participant_associations();
revoke all on function private.scrub_deleted_attendance_participant_associations()
  from public,anon,authenticated,service_role;

comment on table private.attendance_participant_associations is
  'Dormant opaque attendance association; legacy unknown generations stay unknown. Authorized public mapping erasure scrubs scope and generation, retaining only a closed ref tombstone.';
comment on table private.attendance_override_event_generations is
  'Dormant exact per-event generation attribution. Insert/update closed pending an atomic generation-bound override writer; attribution cascades with authorized public event erasure.';
commit;
