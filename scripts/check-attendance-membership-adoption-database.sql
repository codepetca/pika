-- Run only in the coordinator's isolated286 clone. All fixture writes roll back.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';

do $acl$
declare signature text; role_name text;
begin
  if (select enabled from private.student_provider_cleanup_settings where singleton) then
    raise exception 'Fixture requires provider cleanup disabled';
  end if;
  foreach signature in array array[
    'public.prepare_attendance_membership_snapshot_v1(uuid,uuid,date,date,text,uuid,uuid,timestamptz)',
    'public.stage_attendance_membership_roster_snapshot_v1(uuid,uuid,text,jsonb,text,uuid,uuid,timestamptz)',
    'public.resolve_attendance_membership_scan_generation(uuid,uuid)',
    'public.read_attendance_membership_status_v1(uuid,date,text,text,text,uuid,uuid)',
    'public.read_attendance_membership_session_for_owner_v1(uuid,uuid,date,text,text,text,uuid,uuid)',
    'public.apply_attendance_membership_status_overrides_v1(uuid,uuid,date,uuid,jsonb,text,uuid,uuid)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then raise exception 'Membership RPC ACL: %',signature; end if;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(role_name,'private.attendance_pointer_mutations','select,insert,update,delete,truncate,references,trigger')
      or has_table_privilege(role_name,'private.attendance_override_mutations','select,insert,update,delete,truncate,references,trigger')
      or has_function_privilege(role_name,'private.allocate_attendance_membership_participant(uuid,uuid,uuid)','execute')
      or has_function_privilege(role_name,'private.attendance_pointer_mutation_allowed(jsonb,jsonb)','execute') then
      raise exception 'Pointer capability exposed to %',role_name;
    end if;
  end loop;
  if exists(select 1 from private.attendance_pointer_mutations) then raise exception 'Leaked pointer capability'; end if;
end;
$acl$;

insert into public.users(id,email,role,workos_user_id) values
 ('f2850000-0000-4000-8000-000000000001','membership-owner-student@example.invalid','student','user_285_owner'),
 ('f2850000-0000-4000-8000-000000000002','membership-learner-teacher@example.invalid','teacher','user_285_learner'),
 ('f2850000-0000-4000-8000-000000000003','membership-peer@example.invalid','student','user_285_peer');
insert into public.student_profiles(user_id,first_name,last_name) values
 ('f2850000-0000-4000-8000-000000000002','Synthetic','Learner'),
 ('f2850000-0000-4000-8000-000000000003','Synthetic','Peer');
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('f2850000-0000-4000-8000-000000000010','f2850000-0000-4000-8000-000000000001','Membership adoption','MEM285');
insert into public.classroom_enrollments(id,classroom_id,student_id) values
 ('f2850000-0000-4000-8000-000000000020','f2850000-0000-4000-8000-000000000010','f2850000-0000-4000-8000-000000000002'),
 ('f2850000-0000-4000-8000-000000000021','f2850000-0000-4000-8000-000000000010','f2850000-0000-4000-8000-000000000003');
insert into public.attendance_window_policies(classroom_id,opens_local,closes_local) values
 ('f2850000-0000-4000-8000-000000000010','08:45','09:45');
insert into public.class_days(classroom_id,date,is_class_day) values
 ('f2850000-0000-4000-8000-000000000010','2026-10-21',true);
insert into public.attendance_teacher_entitlements(teacher_id,status,valid_from,revision,source) values
 ('f2850000-0000-4000-8000-000000000001','active','2026-10-01T00:00:00Z',1,'synthetic-test');

create function pg_temp.membership_message(p_prepared jsonb) returns jsonb language sql as $$
  select jsonb_build_object('schema_version',1,'message_type','roster.snapshot',
    'idempotency_key','fixture285:roster:'||(p_prepared->>'roster_revision'),
    'correlation_ref','fixture285','installation_ref','fixture285',
    'roster_ref',p_prepared->>'roster_ref','revision',(p_prepared->>'roster_revision')::bigint,
    'owner_principal_ref',p_prepared->>'owner_principal_ref','display_name',p_prepared->>'title',
    'owner_display_name','Pika teacher','participants',coalesce((select jsonb_agg(participant-'student_id')
      from jsonb_array_elements(p_prepared->'participants') participant),'[]'::jsonb));
$$;
create function pg_temp.membership_event(p_roster text,p_occurrence text,p_participant text,p_id text)
returns jsonb language sql as $$
  select jsonb_build_object('schema_version',1,'event_id',p_id,'idempotency_key',p_id,'correlation_ref','fixture285',
    'event_type','attendance.check_in.accepted','occurred_at','2026-10-21T13:00:00Z','installation_ref','fixture285',
    'roster_ref',p_roster,'occurrence_ref',p_occurrence,'session_revision',1,
    'metadata',jsonb_build_object('check_in_ref',p_id,'participant_ref',p_participant,'check_in_revision',1,
      'accepted_at','2026-10-21T13:00:00Z'));
$$;

do $allocation_and_delivery$
declare owner_id uuid:='f2850000-0000-4000-8000-000000000001'; learner uuid:='f2850000-0000-4000-8000-000000000002';
  peer uuid:='f2850000-0000-4000-8000-000000000003'; course uuid:='f2850000-0000-4000-8000-000000000010';
  generation_one uuid:='f2850000-0000-4000-8000-000000000020'; generation_two uuid:='f2850000-0000-4000-8000-000000000022';
  prepared jsonb; again jsonb; staged jsonb; message jsonb; old_message jsonb; old_event jsonb; snapshot jsonb;
  legacy_ref text; first_ref text; second_ref text; peer_ref text; occurrence text; roster text;
  baseline bigint; source_token text; before_pointer jsonb; n integer;
begin
  -- Legacy preparation is unchanged and cannot claim current-generation proof.
  prepared:=public.prepare_attendance_snapshot_v1(owner_id,course,'2026-10-21','2026-10-21');
  select participant_ref into legacy_ref from public.attendance_participant_mappings where classroom_id=course and student_id=learner;
  if legacy_ref is null or legacy_ref !~ '^participant_[a-f0-9]{32}$'
    or jsonb_typeof(prepared) is distinct from 'object'
    or coalesce(prepared->>'roster_source_token','') !~ '^[a-f0-9]{32}$'
    or public.resolve_attendance_membership_scan_generation(course,learner)->>'status' is distinct from 'forbidden'
    or exists(select 1 from private.attendance_membership_generations where generation_id=generation_one) then
    raise exception 'Legacy preparation fabricated a generation';
  end if;
  old_message:=pg_temp.membership_message(prepared);
  -- Existing unknown-generation override events stay unknown after adoption.
  perform public.apply_attendance_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('student_id',learner,'status','present','reason_code','staff_correction')));
  staged:=public.stage_attendance_roster_snapshot_v1(owner_id,course,prepared->>'roster_source_token',old_message);
  -- A283 association captured before an independent171 binding remains NULL.
  select participant_ref into peer_ref from public.attendance_participant_mappings where classroom_id=course and student_id=peer;
  perform private.capture_attendance_participant_association(course,peer,peer_ref);
  insert into private.attendance_membership_generations(generation_id,participant_ref,scope_digest)
    values('f2850000-0000-4000-8000-000000000021',peer_ref,private.pal_membership_scope(course,peer));
  -- Authorization failures roll back before allocation, including wrong canary.
  begin
    perform public.prepare_attendance_membership_snapshot_v1(owner_id,course,'2026-10-21','2026-10-21','exact_canary',learner,course);
    raise exception 'Wrong canary accepted';
  exception when insufficient_privilege then null; end;
  prepared:=public.prepare_attendance_membership_snapshot_v1(owner_id,course,'2026-10-21','2026-10-21','exact_canary',owner_id,course);
  select participant_ref into first_ref from public.attendance_participant_mappings where classroom_id=course and student_id=learner;
  if first_ref is null or first_ref !~ '^participant_[a-f0-9]{32}$' or first_ref=legacy_ref
    or coalesce(prepared->>'roster_source_token','') !~ '^[a-f0-9]{32}$'
    or not private.attendance_membership_pointer_valid(course,learner)
    or exists(select 1 from private.attendance_participant_associations where participant_ref in (legacy_ref,peer_ref) and generation_id is not null)
    or exists(select 1 from private.attendance_pointer_mutations) then raise exception 'Allocation proof/legacy preservation failed'; end if;
  if not exists(select 1 from public.attendance_integration_outbox where id=(staged->>'outbox_id')::uuid and status='superseded')
    or not private.attendance_payload_generation_closed(course,old_message) then raise exception 'Old legacy roster still deliverable'; end if;
  again:=public.prepare_attendance_membership_snapshot_v1(owner_id,course,'2026-10-21','2026-10-21','teacher_entitlements',null,null,'2026-10-21T12:00:00Z');
  if again->>'roster_source_token' is distinct from prepared->>'roster_source_token'
    or (select participant_ref from public.attendance_participant_mappings where classroom_id=course and student_id=learner) is distinct from first_ref then
    raise exception 'Same-generation retry rotated or changed source';
  end if;
  message:=pg_temp.membership_message(prepared);
  staged:=public.stage_attendance_membership_roster_snapshot_v1(owner_id,course,prepared->>'roster_source_token',message,'exact_canary',owner_id,course);
  if staged->>'status' is distinct from 'pending' or jsonb_typeof(staged->'outbox_id') is distinct from 'string' then
    raise exception 'Staging did not return exact durable pending intent'; end if;
  perform public.stage_attendance_membership_roster_snapshot_v1(owner_id,course,prepared->>'roster_source_token',message,'teacher_entitlements',null,null,'2026-10-21T12:00:00Z');
  select occurrence_ref into occurrence from public.attendance_occurrence_mappings where classroom_id=course and class_date='2026-10-21';
  roster:=prepared->>'roster_ref';
  if occurrence is null or roster is null then raise exception 'Prepared occurrence/roster missing'; end if;
  -- Retained unknown refs resolve owner history without being attributed to the
  -- current generation. Both facts are retained for the same day/subject.
  perform public.apply_attendance_event_v1(pg_temp.membership_event(roster,occurrence,legacy_ref,'fixture285_legacy'),'fixture285_nonce_legacy');
  old_event:=pg_temp.membership_event(roster,occurrence,first_ref,'fixture285_first');
  perform public.apply_attendance_event_v1(old_event,'fixture285_nonce_first');
  again:=public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object('student_id',learner,'expected_generation_id',generation_one,'status','present','reason_code','staff_correction')),
    'exact_canary',owner_id,course);
  if (again->>'applied_count')::integer<>1 or exists(select 1 from private.attendance_override_event_generations proof
    join public.attendance_status_override_events ev on ev.id=proof.event_id
    where ev.request_id='f2860000-0000-4000-8000-000000000001') then
    raise exception 'Same status across unknown generation was suppressed or history backfilled'; end if;
  if (select count(*) from public.attendance_check_in_facts where classroom_id=course and student_id=learner)<>2 then
    raise exception 'Historical fact lost or relabeled'; end if;
  select to_jsonb(mapping) into before_pointer from public.attendance_participant_mappings mapping where classroom_id=course and student_id=learner;
  begin
    update public.attendance_participant_mappings set participant_ref=legacy_ref where classroom_id=course and student_id=learner;
    raise exception 'Standalone pointer replacement accepted';
  exception when sqlstate '55000' then
    if sqlerrm<>'attendance_membership_generation_immutable' then raise; end if;
  end;
  if before_pointer is distinct from (select to_jsonb(mapping) from public.attendance_participant_mappings mapping where classroom_id=course and student_id=learner) then
    raise exception 'Denied pointer mutation persisted'; end if;
  source_token:=prepared->>'roster_source_token';
  -- Synthetic enrollment transition: this is not a new join/removal API or
  -- rollout claim.168's real trigger closes the old generation.
  delete from public.classroom_enrollments where id=generation_one;
  insert into public.classroom_enrollments(id,classroom_id,student_id) values(generation_two,course,learner);
  if public.resolve_attendance_membership_scan_generation(course,learner)->>'status' is distinct from 'forbidden' then
    raise exception 'Replacement enrollment reused old pointer authority'; end if;
  baseline:=(select count(*) from public.attendance_integration_inbox where classroom_id=course);
  begin
    perform public.apply_attendance_event_v1(old_event,'fixture285_nonce_late');
    raise exception 'Closed event replay accepted';
  exception when sqlstate '55000' then
    if sqlerrm<>'attendance_membership_generation_closed' then raise; end if;
  end;
  if baseline<>(select count(*) from public.attendance_integration_inbox where classroom_id=course) then
    raise exception 'Closed replay wrote inbox'; end if;
  begin
    perform public.stage_attendance_membership_roster_snapshot_v1(owner_id,course,source_token,message,'exact_canary',owner_id,course);
    raise exception 'Stale snapshot accepted';
  exception when serialization_failure then null; end;
  -- A failed transaction cannot leave a fresh binding/capability or pointer.
  begin
    perform public.prepare_attendance_membership_snapshot_v1(owner_id,course,'2026-10-21','2026-10-21','exact_canary',owner_id,course);
    raise exception 'fixture285 deliberate rollback';
  exception when raise_exception then
    if sqlerrm<>'fixture285 deliberate rollback' then raise; end if;
  end;
  if exists(select 1 from private.attendance_membership_generations where generation_id=generation_two)
    or exists(select 1 from private.attendance_pointer_mutations)
    or (select participant_ref from public.attendance_participant_mappings where classroom_id=course and student_id=learner) is distinct from first_ref then
    raise exception 'Failed allocation was not atomic'; end if;
  prepared:=public.prepare_attendance_membership_snapshot_v1(owner_id,course,'2026-10-21','2026-10-21','exact_canary',owner_id,course);
  select participant_ref into second_ref from public.attendance_participant_mappings where classroom_id=course and student_id=learner;
  if second_ref is null or second_ref !~ '^participant_[a-f0-9]{32}$' or second_ref in (legacy_ref,first_ref)
    or coalesce(prepared->>'roster_source_token','') !~ '^[a-f0-9]{32}$' or prepared->>'roster_source_token'=source_token
    or public.resolve_attendance_membership_scan_generation(course,learner)->>'status' is distinct from 'active'
    or public.resolve_attendance_membership_scan_generation(course,learner)->>'generation_id' is distinct from generation_two::text
    or not private.attendance_payload_generation_closed(course,old_event)
    or not private.attendance_payload_generation_closed(course,message) then raise exception 'New generation binding or closed-ref fence failed'; end if;
  perform public.apply_attendance_event_v1(pg_temp.membership_event(roster,occurrence,second_ref,'fixture285_second'),'fixture285_nonce_second');
  if (select count(*) from public.attendance_check_in_facts where classroom_id=course and student_id=learner)<>3 then
    raise exception 'Same-day current fact replaced retained history'; end if;
  begin
    perform private.assert_attendance_cleanup_reference_coverage(course,learner,second_ref);
    raise exception 'Uncovered historical refs permitted cleanup';
  exception when sqlstate '55000' then
    if sqlerrm<>'attendance_cleanup_reference_uncovered' then raise; end if;
  end;
  -- Closed historical refs in reconciliation are recognized then skipped;
  -- active current and unknown legacy refs resolve without public-row widening.
  update public.attendance_occurrence_mappings set opens_at='2026-10-21T12:00:00Z',closes_at='2026-10-21T14:00:00Z',
    session_starts_at='2026-10-21T12:00:00Z',session_ends_at='2026-10-21T14:00:00Z',
    present_through_at='2026-10-21T12:00:00Z',absent_at='2026-10-21T14:00:00Z',policy_revision=1,desired_state='scheduled'
    where occurrence_ref=occurrence;
  snapshot:=jsonb_build_object('schema_version',1,'roster_ref',roster,'occurrence_ref',occurrence,
    'session_revision',2,'status','open','accepts_at','2026-10-21T12:00:00Z','stops_accepting_at','2026-10-21T14:00:00Z',
    'check_ins',jsonb_build_array(old_event->'metadata',
      pg_temp.membership_event(roster,occurrence,second_ref,'fixture285_reconcile')->'metadata',
      pg_temp.membership_event(roster,occurrence,legacy_ref,'fixture285_legacy_reconcile')->'metadata'));
  again:=public.apply_attendance_session_snapshot_v1('fixture285',snapshot);
  if (again->>'check_in_projection_count')::integer is distinct from 2
    or (select count(*) from public.attendance_participant_mappings where classroom_id=course)<>2
    or exists(select 1 from private.attendance_pointer_mutations)
    or (select enabled from private.student_provider_cleanup_settings where singleton) then
    raise exception 'Reconciliation/cardinality/cleanup isolation failed'; end if;
end;
$allocation_and_delivery$;

create function pg_temp.membership_mark(p_generation uuid,p_status text,p_student uuid default 'f2850000-0000-4000-8000-000000000002')
returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('student_id',p_student,
  'expected_generation_id',p_generation,'status',p_status,'reason_code','staff_correction')); $$;

do $learner_and_override$
declare owner_id uuid:='f2850000-0000-4000-8000-000000000001'; learner uuid:='f2850000-0000-4000-8000-000000000002';
  course uuid:='f2850000-0000-4000-8000-000000000010'; old_generation uuid:='f2850000-0000-4000-8000-000000000020';
  generation uuid:='f2850000-0000-4000-8000-000000000022'; v_request_id uuid:='f2860000-0000-4000-8000-000000000003';
  value jsonb; row_value jsonb; result jsonb; initial_events integer; event_id uuid; cap_count integer; owner_snapshot jsonb; owner_label text;
begin
  value:=public.read_attendance_membership_status_v1(learner,'2026-10-21','ready','exact_canary','fixture285',owner_id,course);
  row_value:=value->'classrooms'->0;
  if jsonb_array_length(value->'classrooms')<>1 or row_value->>'generation_id' is distinct from generation::text
    or row_value->'check_in'->>'check_in_ref' not in ('fixture285_second','fixture285_reconcile')
    or row_value->'override' is distinct from 'null'::jsonb then raise exception 'Learner saw old/unknown evidence'; end if;
  owner_snapshot:=public.read_attendance_membership_session_for_owner_v1(owner_id,course,'2026-10-21','ready','exact_canary','fixture285',owner_id,course);
  if jsonb_array_length(owner_snapshot->'rows'->'check_ins')<>5
    or not (owner_snapshot->'membership_targets' @> jsonb_build_array(jsonb_build_object('student_id',learner,'generation_id',generation))) then
    raise exception 'Owner history/loaded target not preserved'; end if;
  initial_events:=(select count(*) from public.attendance_status_override_events where classroom_id=course);
  -- A stale duplicate is checked against current membership before receipt replay.
  begin
    perform public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000002',
      pg_temp.membership_mark(old_generation,'present'),'exact_canary',owner_id,course);
    raise exception 'Stale duplicate rebound to replacement generation';
  exception when check_violation then if sqlerrm<>'attendance_roster_changed' then raise; end if; end;
  -- Legacy direct/global writer remains conservative after an earlier removal.
  begin
    perform public.apply_attendance_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000099',
      jsonb_build_array(jsonb_build_object('student_id',learner,'status','late')));
    raise exception 'Legacy writer bypassed closed generation';
  exception when sqlstate '55000' then if sqlerrm<>'attendance_membership_generation_closed' then raise; end if; end;
  result:=public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21',v_request_id,
    pg_temp.membership_mark(generation,'present'),'exact_canary',owner_id,course);
  if (result->>'applied_count')::integer<>1 then raise exception 'New generation same-status event lost'; end if;
  result:=public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21',v_request_id,
    pg_temp.membership_mark(generation,'present'),'exact_canary',owner_id,course);
  if result->>'outcome'<>'duplicate' then raise exception 'Same operation did not deduplicate'; end if;
  begin
    perform public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21',v_request_id,
      pg_temp.membership_mark(generation,'absent'),'exact_canary',owner_id,course);
    raise exception 'Conflicting operation reused';
  exception when unique_violation then if sqlerrm<>'attendance_override_request_conflict' then raise; end if; end;
  result:=public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000004',
    pg_temp.membership_mark(generation,'present'),'exact_canary',owner_id,course);
  if (result->>'unchanged_count')::integer<>1 then raise exception 'Same generation no-op added revision'; end if;
  result:=public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000005',
    pg_temp.membership_mark(generation,'automatic'),'teacher_entitlements');
  value:=public.read_attendance_membership_status_v1(learner,'2026-10-21','ready','teacher_entitlements','fixture285');
  if value->'classrooms'->0->'override'->'active' is distinct from 'false'::jsonb
    or value->'classrooms'->0->'override'->'status' is distinct from 'null'::jsonb then raise exception 'Undo not projected from attributed event'; end if;
  result:=public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000006',
    pg_temp.membership_mark(generation,'automatic'),'exact_canary',owner_id,course);
  if (result->>'unchanged_count')::integer<>1 or (select count(*) from public.attendance_status_override_events where classroom_id=course)<>initial_events+2 then
    raise exception 'Undo no-op/history preservation failed'; end if;
  -- Batch validation happens before any row, even when a later target is stale.
  begin
    perform public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000007',
      pg_temp.membership_mark(generation,'late')||pg_temp.membership_mark(old_generation,'late','f2850000-0000-4000-8000-000000000003'),
      'exact_canary',owner_id,course);
    raise exception 'Partially stale batch accepted';
  exception when check_violation then if sqlerrm<>'attendance_roster_changed' then raise; end if; end;
  if exists(select 1 from public.attendance_override_requests where request_id='f2860000-0000-4000-8000-000000000007') then
    raise exception 'Rejected batch left request'; end if;
  select id into event_id from public.attendance_status_override_events where request_id='f2860000-0000-4000-8000-000000000001';
  begin
    insert into private.attendance_override_event_generations values(event_id,generation);
    raise exception 'Historical attribution accepted';
  exception when sqlstate '55000' then if sqlerrm<>'attendance_override_generation_writer_required' then raise; end if; end;
  begin
    update private.attendance_override_event_generations set generation_id=old_generation where generation_id=generation;
    raise exception 'Attribution retarget accepted';
  exception when sqlstate '55000' then if sqlerrm<>'attendance_override_generation_writer_required' then raise; end if; end;
  if exists(select 1 from private.attendance_override_mutations) then raise exception 'Writer capability leaked'; end if;
  value:=public.read_attendance_membership_status_v1(learner,'2026-10-21','disabled','exact_canary',null,owner_id,course);
  if value->'classrooms'->0->'generation_id'<>'null'::jsonb or value->'classrooms'->0->'occurrence'<>'null'::jsonb
    or value->'classrooms'->0->'override'<>'null'::jsonb then raise exception 'Runtime disabled disclosed evidence'; end if;
  value:=public.read_attendance_membership_status_v1(learner,'2026-10-21','ready','exact_canary','fixture285',learner,course);
  if value->'classrooms'->0->>'integration'<>'disabled' then raise exception 'Wrong canary disclosed evidence'; end if;
  begin
    update public.attendance_roster_mappings set integration_state='deactivating' where classroom_id=course;
    value:=public.read_attendance_membership_status_v1(learner,'2026-10-21','ready','exact_canary','fixture285',owner_id,course);
    owner_snapshot:=public.read_attendance_membership_session_for_owner_v1(owner_id,course,'2026-10-21','ready','exact_canary','fixture285',owner_id,course);
    if value->'classrooms'->0->>'integration'<>'disabled'
      or value->'classrooms'->0->'override'<>'null'::jsonb or owner_snapshot->'membership_targets'<>'[]'::jsonb then
      raise exception 'Exact canary bypassed roster deactivation'; end if;
    begin
      perform public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000009',
        pg_temp.membership_mark(generation,'late'),'exact_canary',owner_id,course);
      raise exception 'Deactivating roster accepted marks';
    exception when sqlstate '55000' then if sqlerrm<>'attendance_membership_operation_blocked' then raise; end if; end;
    raise exception 'fixture286 deactivation rollback';
  exception when raise_exception then if sqlerrm<>'fixture286 deactivation rollback' then raise; end if; end;
  begin
    update public.attendance_teacher_entitlements set status='revoked' where teacher_id=owner_id;
    value:=public.read_attendance_membership_status_v1(learner,'2026-10-21','ready','teacher_entitlements','fixture285');
    if value->'classrooms'->0->>'integration'<>'disabled' then raise exception 'Revoked entitlement disclosed evidence'; end if;
    begin
      perform public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000010',
        pg_temp.membership_mark(generation,'late'),'teacher_entitlements');
      raise exception 'Revoked entitlement accepted marks';
    exception when insufficient_privilege then if sqlerrm<>'attendance_classroom_forbidden' then raise; end if; end;
    raise exception 'fixture286 entitlement rollback';
  exception when raise_exception then if sqlerrm<>'fixture286 entitlement rollback' then raise; end if; end;
  -- Owner precedence must defeat an actually prepared valid self-membership,
  -- not merely an unbound enrollment. Roll back each synthetic label case so
  -- this check does not alter later contention or retained-history baselines.
  foreach owner_label in array array['student','teacher'] loop
    begin
      update public.users set role=owner_label where id=owner_id;
      insert into public.student_profiles(user_id,first_name,last_name) values(owner_id,'Synthetic','Owner');
      insert into public.classroom_enrollments(id,classroom_id,student_id)
        values('f2860000-0000-4000-8000-000000000020',course,owner_id);
      perform public.prepare_attendance_membership_snapshot_v1(owner_id,course,'2026-10-21','2026-10-21','exact_canary',owner_id,course);
      if not private.attendance_membership_pointer_valid(course,owner_id)
        or not exists(select 1 from private.attendance_membership_generations bound
          where bound.generation_id='f2860000-0000-4000-8000-000000000020') then
        raise exception 'Self-owner fixture did not prepare a valid exact pointer'; end if;
      if public.resolve_attendance_membership_scan_generation(course,owner_id) is distinct from jsonb_build_object('status','forbidden')
        or public.resolve_attendance_membership_scan_generation(course,learner)->>'status' is distinct from 'active'
        or public.resolve_attendance_membership_scan_generation(course,learner)->>'generation_id' is distinct from generation::text then
        raise exception 'Strict scan lost owner precedence or ordinary learner authority'; end if;
      value:=public.read_attendance_membership_status_v1(owner_id,'2026-10-21','ready','exact_canary','fixture285',owner_id,course);
      if value->'classrooms' is distinct from '[]'::jsonb then raise exception 'Owner was treated as learner'; end if;
      owner_snapshot:=public.read_attendance_membership_session_for_owner_v1(owner_id,course,'2026-10-21','ready','exact_canary','fixture285',owner_id,course);
      if jsonb_array_length(owner_snapshot->'rows'->'check_ins')<>5
        or exists(select 1 from jsonb_array_elements(owner_snapshot->'membership_targets') target where target->>'student_id'=owner_id::text) then
        raise exception 'Self-owner exclusion changed owner history or override authority'; end if;
      raise exception 'fixture286 owner precedence rollback';
    exception when raise_exception then if sqlerrm<>'fixture286 owner precedence rollback' then raise; end if; end;
  end loop;
  -- Check the exact transaction rollback boundary after event attribution.
  begin
    perform public.apply_attendance_membership_status_overrides_v1(owner_id,course,'2026-10-21','f2860000-0000-4000-8000-000000000008',
      pg_temp.membership_mark(generation,'late'),'exact_canary',owner_id,course);
    raise exception 'fixture286 rollback';
  exception when raise_exception then if sqlerrm<>'fixture286 rollback' then raise; end if; end;
  if exists(select 1 from private.attendance_override_mutations)
    or exists(select 1 from public.attendance_override_requests where request_id='f2860000-0000-4000-8000-000000000008')
    or (select count(*) from public.attendance_status_override_events where classroom_id=course)<>initial_events+2 then
    raise exception 'Failed transaction retained override/attribution/capability'; end if;
end;
$learner_and_override$;

rollback;
