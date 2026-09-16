-- Synthetic rollback-only queue and lease lifecycle. Requires migrations176–177.
-- It never performs provider HTTP calls or durable cleanup.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$ begin
  if to_regprocedure('public.claim_removed_student_cleanup_job(uuid)') is null then
    raise exception 'Migration176 is required';
  end if;
  if not exists(select 1 from information_schema.columns
      where table_schema='private' and table_name='removed_student_cleanup_jobs'
        and column_name='quarantined_at') then
    raise exception 'Migration177 is required';
  end if;
  if (select enabled or live_enabled or automatic_enabled
      from private.student_provider_cleanup_settings where singleton) then
    raise exception 'Fixture requires disabled cleanup gates';
  end if;
  if has_function_privilege('anon','public.claim_removed_student_cleanup_job(uuid)','execute')
    or has_function_privilege('authenticated','public.claim_removed_student_cleanup_job(uuid)','execute')
    or has_function_privilege('anon','public.release_removed_student_cleanup_job(uuid,uuid,boolean,text,integer)','execute')
    or has_function_privilege('authenticated','public.release_removed_student_cleanup_job(uuid,uuid,boolean,text,integer)','execute') then
    raise exception 'Automatic cleanup queue authority leaked';
  end if;
end $$;

insert into public.users(id,email,role,workos_user_id) values
('c1760000-0000-4000-8000-000000000001','teacher-176@example.invalid','teacher','user_176_teacher'),
('c1760000-0000-4000-8000-000000000002','student-176@example.invalid','student','user_176_student'),
('c1760000-0000-4000-8000-000000000003','legacy-176@example.invalid','student','user_176_legacy'),
('c1760000-0000-4000-8000-000000000004','partial-176@example.invalid','student','user_176_partial');
insert into public.student_profiles(user_id,first_name,last_name)
values
('c1760000-0000-4000-8000-000000000002','Synthetic','Queue'),
('c1760000-0000-4000-8000-000000000003','Historical','Skipped'),
('c1760000-0000-4000-8000-000000000004','Partial','Skipped');
insert into public.classrooms(id,teacher_id,title,class_code)
values('c1760000-0000-4000-8000-000000000010','c1760000-0000-4000-8000-000000000001','Automatic cleanup fixture','C176Q');
insert into public.classroom_roster(id,classroom_id,email)
values
('c1760000-0000-4000-8000-000000000020','c1760000-0000-4000-8000-000000000010','student-176@example.invalid'),
('c1760000-0000-4000-8000-000000000021','c1760000-0000-4000-8000-000000000010','legacy-176@example.invalid'),
('c1760000-0000-4000-8000-000000000022','c1760000-0000-4000-8000-000000000010','partial-176@example.invalid');
insert into public.classroom_enrollments(id,classroom_id,student_id,created_at)
values('c1760000-0000-4000-8000-000000000031','c1760000-0000-4000-8000-000000000010',
  'c1760000-0000-4000-8000-000000000003',clock_timestamp()-interval '1 day');

update private.student_provider_cleanup_settings set
  enabled=true,live_enabled=true,automatic_enabled=true,
  eligible_after=clock_timestamp()-interval '1 second',
  pal_origin='https://pal.example.invalid',pal_integration_id='c1760000-0000-4000-8000-000000000040',
  bara_origin='https://bara.example.invalid',installation_ref='pika_synthetic_176'
where singleton;
insert into public.classroom_enrollments(id,classroom_id,student_id)
values
('c1760000-0000-4000-8000-000000000030','c1760000-0000-4000-8000-000000000010','c1760000-0000-4000-8000-000000000002'),
('c1760000-0000-4000-8000-000000000032','c1760000-0000-4000-8000-000000000010','c1760000-0000-4000-8000-000000000004');
insert into public.attendance_roster_mappings(classroom_id)
values('c1760000-0000-4000-8000-000000000010');
insert into public.attendance_principal_mappings(user_id)
values('c1760000-0000-4000-8000-000000000001');
insert into public.attendance_participant_mappings(classroom_id,student_id)
values
('c1760000-0000-4000-8000-000000000010','c1760000-0000-4000-8000-000000000002'),
('c1760000-0000-4000-8000-000000000010','c1760000-0000-4000-8000-000000000003');

do $$ begin
  if exists(select 1 from private.attendance_membership_generations
      where generation_id in ('c1760000-0000-4000-8000-000000000031',
        'c1760000-0000-4000-8000-000000000032'))
    or not exists(select 1 from private.attendance_membership_generations
      where generation_id='c1760000-0000-4000-8000-000000000030') then
    raise exception 'Generation eligibility capture boundary is incorrect';
  end if;
end $$;

select public.remove_classroom_students_preserving_data(
  'c1760000-0000-4000-8000-000000000001',
  'c1760000-0000-4000-8000-000000000010',
  array['c1760000-0000-4000-8000-000000000021'::uuid,
    'c1760000-0000-4000-8000-000000000022'::uuid]);
do $$ begin
  if exists(select 1 from private.removed_student_cleanup_jobs) then
    raise exception 'Ineligible historical or partial removal entered the automatic queue';
  end if;
end $$;

select public.remove_classroom_students_preserving_data(
  'c1760000-0000-4000-8000-000000000001',
  'c1760000-0000-4000-8000-000000000010',
  array['c1760000-0000-4000-8000-000000000020'::uuid]);

do $$ begin
  if (select count(*) from private.removed_student_cleanup_jobs)<>1 then
    raise exception 'Removal did not enqueue exactly one job';
  end if;
  if not exists(
    select 1 from private.removed_student_cleanup_jobs
    where teacher_id='c1760000-0000-4000-8000-000000000001'
      and classroom_id='c1760000-0000-4000-8000-000000000010'
      and student_id='c1760000-0000-4000-8000-000000000002'
      and generation_id='c1760000-0000-4000-8000-000000000030'
      and status='queued' and attempt_count=0) then
    raise exception 'Queued job identity is incorrect';
  end if;
end $$;

do $$ begin
  begin
    perform public.claim_removed_student_cleanup_job('c1760000-0000-4000-8000-000000000050');
    raise exception 'Claim ignored disabled academic cleanup';
  exception when sqlstate '55000' then
    if sqlerrm<>'removed_student_cleanup_academic_disabled' then raise; end if;
  end;
end $$;
update private.removed_student_academic_settings set enabled=true where singleton;
do $$ begin
  begin
    perform public.claim_removed_student_cleanup_job('c1760000-0000-4000-8000-000000000050');
    raise exception 'Claim ignored managed storage compatibility mode';
  exception when sqlstate '55000' then
    if sqlerrm<>'removed_student_cleanup_storage_not_enforced' then raise; end if;
  end;
end $$;
update public.managed_storage_settings set mode='enforced',activated_at=clock_timestamp(),
  readiness_verified_at=clock_timestamp(),readiness_digest=repeat('e',64) where singleton;

do $$
declare first_claim jsonb; second_claim jsonb; reclaimed jsonb; job_id uuid;
begin
  first_claim:=public.claim_removed_student_cleanup_job('c1760000-0000-4000-8000-000000000050');
  job_id:=(first_claim->>'job_id')::uuid;
  if job_id is null or (first_claim->>'attempt_count')::integer<>1 then
    raise exception 'First lease claim is incorrect';
  end if;
  second_claim:=public.claim_removed_student_cleanup_job('c1760000-0000-4000-8000-000000000051');
  if second_claim is not null then raise exception 'Active lease was claimed twice'; end if;
  if not public.release_removed_student_cleanup_job(job_id,
      'c1760000-0000-4000-8000-000000000050',false,'cleanup_pending',30) then
    raise exception 'Pending release was not recorded';
  end if;
  update private.removed_student_cleanup_jobs set next_attempt_at=clock_timestamp()-interval '1 second'
    where id=job_id;
  reclaimed:=public.claim_removed_student_cleanup_job('c1760000-0000-4000-8000-000000000052');
  if (reclaimed->>'job_id')::uuid is distinct from job_id
    or (reclaimed->>'attempt_count')::integer<>2 then
    raise exception 'Due retry was not reclaimed';
  end if;
  begin
    perform public.release_removed_student_cleanup_job(job_id,
      'c1760000-0000-4000-8000-000000000050',true,null,30);
    raise exception 'Stale lease release was accepted';
  exception when serialization_failure then null;
  end;
  if not public.release_removed_student_cleanup_job(job_id,
      'c1760000-0000-4000-8000-000000000052',false,'cleanup_quarantined',30) then
    raise exception 'Quarantine release was not recorded';
  end if;
  if not exists(select 1 from private.removed_student_cleanup_jobs
      where id=job_id and status='quarantined' and quarantined_at is not null
        and student_id='c1760000-0000-4000-8000-000000000002') then
    raise exception 'Quarantined job lost evidence or remained claimable';
  end if;
  if public.claim_removed_student_cleanup_job('c1760000-0000-4000-8000-000000000053') is not null then
    raise exception 'Quarantined job was reclaimed';
  end if;
  update private.removed_student_cleanup_jobs set status='processing',quarantined_at=null,
    lease_token='c1760000-0000-4000-8000-000000000052',
    lease_expires_at=clock_timestamp()+interval '1 minute' where id=job_id;
  if not public.release_removed_student_cleanup_job(job_id,
      'c1760000-0000-4000-8000-000000000052',true,null,30) then
    raise exception 'Completed release was not recorded';
  end if;
  if not exists(select 1 from private.removed_student_cleanup_jobs
      where id=job_id and status='completed' and completed_at is not null
        and teacher_id is null and classroom_id is null
        and student_id is null and generation_id is null) then
    raise exception 'Completed job retained student identity';
  end if;
end $$;

rollback;
