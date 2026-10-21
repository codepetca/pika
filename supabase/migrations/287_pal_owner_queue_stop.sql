-- Membership-mode owner precedence. No history rewrite, provider operation,
-- token revocation, account-Pal change or rollout activation.
begin;
set local lock_timeout='5s';

-- A transition permanently stops only already captured, not-yet-settled facts.
-- No new identity directory: keep the disposition on the existing binding.
alter table private.pal_membership_outbox add column delivery_stopped_at timestamptz;
create index pal_membership_outbox_classroom_subject on private.pal_membership_outbox(classroom_id,student_id,outbox_id);

create function private.stop_pal_delivery_for_owner_v1(p_classroom_id uuid,p_owner_id uuid)
returns void language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $$
begin
  -- Ownership updates already hold their classroom row. Advisory/outbox locks
  -- must not wait in this reverse path: contention aborts the whole transition.
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_owner_id);
  perform event.id from public.pal_event_outbox event join private.pal_membership_outbox binding on binding.outbox_id=event.id
    where binding.classroom_id=p_classroom_id and binding.student_id=p_owner_id and event.status in ('pending','processing')
    order by event.id for update of event nowait;
  update private.pal_membership_outbox binding set delivery_stopped_at=coalesce(binding.delivery_stopped_at,clock_timestamp())
    from public.pal_event_outbox event where event.id=binding.outbox_id and binding.classroom_id=p_classroom_id
      and binding.student_id=p_owner_id and event.status in ('pending','processing');
  update public.pal_event_outbox event set status='non_retryable',lease_token=null,lease_expires_at=null,
    last_error_code='membership_owner',last_error_detail=null,updated_at=now()
    from private.pal_membership_outbox binding where binding.outbox_id=event.id
      and binding.classroom_id=p_classroom_id and binding.student_id=p_owner_id and event.status='pending';
  -- Processing leases/payloads are deliberately unchanged: a known2xx can settle.
end;
$$;
revoke all on function private.stop_pal_delivery_for_owner_v1(uuid,uuid) from public,anon,authenticated,service_role;
alter function private.stop_pal_delivery_for_owner_v1(uuid,uuid) owner to postgres;

create function private.stop_pal_delivery_on_owner_transition_v1()
returns trigger language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $$
begin
  perform private.stop_pal_delivery_for_owner_v1(new.id,new.teacher_id);
  return new;
end;
$$;
revoke all on function private.stop_pal_delivery_on_owner_transition_v1() from public,anon,authenticated,service_role;
alter function private.stop_pal_delivery_on_owner_transition_v1() owner to postgres;
create trigger stop_pal_delivery_on_owner_transition after update of teacher_id on public.classrooms
  for each row when (old.teacher_id is distinct from new.teacher_id)
  execute function private.stop_pal_delivery_on_owner_transition_v1();

-- Existing current owners receive the same bounded disposition, regardless of
-- dormant rollout settings. No delivered/terminal fact, payload or token changes.
do $$
declare v_class record;
begin
  for v_class in select classroom.id,classroom.teacher_id from public.classrooms classroom
    where exists(select 1 from private.pal_membership_outbox binding join public.pal_event_outbox event on event.id=binding.outbox_id
      where binding.classroom_id=classroom.id and binding.student_id=classroom.teacher_id and event.status in ('pending','processing'))
    order by classroom.id for update of classroom nowait loop
    perform private.stop_pal_delivery_for_owner_v1(v_class.id,v_class.teacher_id);
  end loop;
end;
$$;

-- Shared evidence stays private. New learner activity maps owner to forbidden;
-- the delivery boundary may identify owner ONLY after validating its old lease.
create function private.pal_membership_evidence_v1(p_student_id uuid,p_classroom_id uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $$
declare v_owner uuid; v_archived_at timestamptz; v_generation uuid; v_reference text; v_message text;
begin
  if not coalesce((select enabled from private.pal_membership_settings where singleton),false) then
    return jsonb_build_object('status','disabled');
  end if;
  if p_student_id is null or p_classroom_id is null then return jsonb_build_object('status','forbidden'); end if;
  if coalesce(public.is_classroom_archive_maintenance_mode('restore'),false)
    or coalesce(public.is_classroom_archive_maintenance_mode('compaction'),false)
    or coalesce(current_setting('pika.identity_mapping',true),'off')='on'
    or coalesce(current_setting('pika.classroom_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.course_blueprint_purge_finalize',true),'off')='on'
    or coalesce(current_setting('pika.student_purge_finalize',true),'off')='on' then
    return jsonb_build_object('status','forbidden');
  end if;
  -- Preserve164/272 class-operation -> subject -> pair -> classroom -> enrollment.
  -- These locks end with this RPC; they never cover the caller's HTTP request.
  perform private.try_lock_classroom_membership_change(p_classroom_id,p_student_id);
  perform public.guard_classroom_purge_lifecycle(p_classroom_id);
  select teacher_id,archived_at into v_owner,v_archived_at from public.classrooms
    where id=p_classroom_id for update nowait;
  if not found or v_archived_at is not null then return jsonb_build_object('status','forbidden'); end if;
  perform 1 from public.classroom_enrollments where classroom_id=p_classroom_id and student_id=p_student_id for share nowait;
  if not found or exists(select 1 from public.student_purge_fences where classroom_id=p_classroom_id and student_id=p_student_id)
    or exists(select 1 from public.classroom_roster where classroom_id=p_classroom_id
      and removed_student_id=p_student_id and removed_at is not null) then
    return jsonb_build_object('status','forbidden');
  end if;
  select g.generation_id,g.pal_reference into v_generation,v_reference
    from public.classroom_enrollments e join private.pal_membership_generations g
      on g.generation_id=e.id and g.scope_digest=private.pal_membership_scope(e.classroom_id,e.student_id) and g.state='active'
    where e.classroom_id=p_classroom_id and e.student_id=p_student_id;
  if v_reference is null then return jsonb_build_object('status','forbidden'); end if;
  return jsonb_build_object('status',case when v_owner=p_student_id then 'owner' else 'active' end,
    'generation_id',v_generation,'learner_id',v_reference);
exception when sqlstate '55000' then
  get stacked diagnostics v_message=message_text;
  if v_message not in ('classroom_purge_active','attendance_decommission_active') then raise; end if;
  return jsonb_build_object('status','forbidden');
end;
$$;
revoke all on function private.pal_membership_evidence_v1(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.resolve_pal_membership(p_student_id uuid,p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $$
declare v_evidence jsonb;
begin
  v_evidence:=private.pal_membership_evidence_v1(p_student_id,p_classroom_id);
  if v_evidence->>'status'='active' then
    return jsonb_build_object('status','active','learner_id',v_evidence->>'learner_id');
  end if;
  return jsonb_build_object('status',case when v_evidence->>'status'='disabled' then 'disabled' else 'forbidden' end);
end;
$$;
revoke all on function public.resolve_pal_membership(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_pal_membership(uuid,uuid) to service_role;

create or replace function public.authorize_pal_membership_delivery(p_outbox_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $$
declare v_binding private.pal_membership_outbox; v_evidence jsonb;
begin
  select * into v_binding from private.pal_membership_outbox where outbox_id=p_outbox_id;
  if not found then return jsonb_build_object('status','legacy'); end if;
  if not private.pal_classroom_signals_enabled() then return jsonb_build_object('status','disabled'); end if;
  v_evidence:=private.pal_membership_evidence_v1(v_binding.student_id,v_binding.classroom_id);
  if v_evidence->>'status'='disabled' then return jsonb_build_object('status','disabled'); end if;
  if v_evidence->>'status' not in ('active','owner')
    or v_evidence->>'generation_id' is distinct from v_binding.generation_id::text
    or v_evidence->>'learner_id' is distinct from v_binding.learner_id
    or not exists(select 1 from public.pal_event_outbox event where event.id=p_outbox_id
      and event.student_id=v_binding.student_id and event.source_kind='membership_v1'
      and event.source_id=v_binding.generation_id::text
      and event.status='processing' and event.lease_token=p_lease_token and event.lease_expires_at>now()
      and event.payload->>'learner_id'=v_binding.learner_id
      and event.payload->>'schema_version'='1'
      and event.payload->>'idempotency_key'=event.idempotency_key
      and event.idempotency_key like 'pika:membership:v1:%') then
    return jsonb_build_object('status','forbidden');
  end if;
  -- Only owner remains different after every binding/provenance/lease gate.
  -- Caller stops a future send, but can settle a known2xx using the old lease.
  -- Re-read the durable marker AFTER obtaining membership/classroom evidence:
  -- the initial binding read may predate a committed promotion+demotion.
  return jsonb_build_object('status',case when exists(select 1 from private.pal_membership_outbox binding
    where binding.outbox_id=p_outbox_id and binding.delivery_stopped_at is not null) then 'owner' else v_evidence->>'status' end);
end;
$$;
revoke all on function public.authorize_pal_membership_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_pal_membership_delivery(uuid,uuid) to service_role;
alter function private.pal_membership_evidence_v1(uuid,uuid) owner to postgres;
alter function public.resolve_pal_membership(uuid,uuid) owner to postgres;
alter function public.authorize_pal_membership_delivery(uuid,uuid) owner to postgres;

comment on function public.authorize_pal_membership_delivery(uuid,uuid) is
  'Service-only exact membership and lease snapshot: owner forbids a future send, not acknowledgement of an already accepted HTTP request. No lock covers HTTP.';
commit;
