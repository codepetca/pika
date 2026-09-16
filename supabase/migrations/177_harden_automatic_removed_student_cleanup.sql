-- Require the complete local-deletion safety envelope before any provider
-- request, and quarantine bounded terminal failures without starving later jobs.
begin;
set local lock_timeout = '5s';

alter table private.removed_student_cleanup_jobs
  drop constraint removed_student_cleanup_jobs_status_check;
alter table private.removed_student_cleanup_jobs
  add column quarantined_at timestamptz,
  add constraint removed_student_cleanup_jobs_status_check
    check (status in ('queued','processing','retry_wait','quarantined','completed')),
  add constraint removed_student_cleanup_jobs_quarantined_check
    check ((status='quarantined')=(quarantined_at is not null));

create or replace function private.kick_removed_student_cleanup(p_source text)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_settings private.student_provider_cleanup_settings;
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  if p_source not in ('removal','watchdog') then return null; end if;
  select * into v_settings from private.student_provider_cleanup_settings
    where singleton for update;
  if not coalesce(v_settings.automatic_enabled,false)
    or not coalesce(v_settings.enabled,false)
    or not coalesce(v_settings.live_enabled,false)
    or not coalesce((select enabled from private.removed_student_academic_settings
      where singleton),false)
    or not coalesce((select mode='enforced' from public.managed_storage_settings
      where singleton),false)
    or v_settings.automatic_last_kicked_at > clock_timestamp()-interval '30 seconds'
    or not exists (
      select 1 from private.removed_student_cleanup_jobs job
      where (job.status in ('queued','retry_wait') and job.next_attempt_at<=clock_timestamp())
         or (job.status='processing' and job.lease_expires_at<=clock_timestamp())
    ) then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name='pika_removed_student_cleanup_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name='pika_removed_student_cleanup_worker_secret';
  if v_url is null or v_url !~ '^https://[^[:space:]]+/api/cron/removed-student-cleanup$'
    or v_secret is null or length(v_secret)<32 then
    return null;
  end if;
  v_request_id:=net.http_post(
    url=>v_url,
    body=>jsonb_build_object('source',p_source),
    headers=>jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
    timeout_milliseconds=>5000);
  update private.student_provider_cleanup_settings
    set automatic_last_kicked_at=clock_timestamp() where singleton;
  return v_request_id;
exception when others then
  return null;
end;
$$;

create or replace function public.claim_removed_student_cleanup_job(p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job private.removed_student_cleanup_jobs;
begin
  if p_lease_token is null then
    raise exception using errcode='22023',message='removed_student_cleanup_lease_required';
  end if;
  perform 1 from private.student_provider_cleanup_settings
    where singleton and automatic_enabled and enabled and live_enabled for share;
  if not found then
    raise exception using errcode='55000',message='removed_student_cleanup_disabled';
  end if;
  perform 1 from private.removed_student_academic_settings
    where singleton and enabled for share;
  if not found then
    raise exception using errcode='55000',message='removed_student_cleanup_academic_disabled';
  end if;
  perform 1 from public.managed_storage_settings
    where singleton and mode='enforced' for share;
  if not found then
    raise exception using errcode='55000',message='removed_student_cleanup_storage_not_enforced';
  end if;
  select * into v_job from private.removed_student_cleanup_jobs job
  where (job.status in ('queued','retry_wait') and job.next_attempt_at<=clock_timestamp())
     or (job.status='processing' and job.lease_expires_at<=clock_timestamp())
  order by job.next_attempt_at,job.created_at,job.id
  for update skip locked limit 1;
  if not found then return null; end if;
  update private.removed_student_cleanup_jobs set
    status='processing',lease_token=p_lease_token,
    lease_expires_at=clock_timestamp()+interval '2 minutes',
    attempt_count=attempt_count+1,updated_at=clock_timestamp()
  where id=v_job.id returning * into v_job;
  return jsonb_build_object(
    'job_id',v_job.id,'operation_id',v_job.operation_id,
    'teacher_id',v_job.teacher_id,'classroom_id',v_job.classroom_id,
    'student_id',v_job.student_id,'generation_id',v_job.generation_id,
    'attempt_count',v_job.attempt_count);
end;
$$;

create or replace function public.release_removed_student_cleanup_job(
  p_job_id uuid,p_lease_token uuid,p_completed boolean,
  p_error_code text default null,p_retry_delay_seconds integer default 300)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_job private.removed_student_cleanup_jobs;
begin
  if p_job_id is null or p_lease_token is null or p_completed is null
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_]{1,64}$')
    or p_retry_delay_seconds<30 or p_retry_delay_seconds>3600 then
    raise exception using errcode='22023',message='removed_student_cleanup_release_invalid';
  end if;
  select * into v_job from private.removed_student_cleanup_jobs
    where id=p_job_id for update;
  if not found or v_job.status<>'processing' or v_job.lease_token<>p_lease_token
    or v_job.lease_expires_at<=clock_timestamp() then
    raise exception using errcode='40001',message='removed_student_cleanup_lease_stale';
  end if;
  if p_completed then
    update private.removed_student_cleanup_jobs set
      status='completed',teacher_id=null,classroom_id=null,student_id=null,generation_id=null,lease_token=null,
      lease_expires_at=null,last_error_code=null,completed_at=clock_timestamp(),quarantined_at=null,
      updated_at=clock_timestamp() where id=p_job_id;
  elsif p_error_code='cleanup_quarantined' then
    update private.removed_student_cleanup_jobs set
      status='quarantined',lease_token=null,lease_expires_at=null,
      last_error_code=p_error_code,quarantined_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_job_id;
  else
    update private.removed_student_cleanup_jobs set
      status='retry_wait',lease_token=null,lease_expires_at=null,quarantined_at=null,
      last_error_code=coalesce(p_error_code,'cleanup_pending'),
      next_attempt_at=clock_timestamp()+make_interval(secs=>p_retry_delay_seconds),
      updated_at=clock_timestamp() where id=p_job_id;
  end if;
  return true;
end;
$$;

comment on column private.removed_student_cleanup_jobs.quarantined_at is
  'Terminal automatic failure requiring operator investigation; the job is excluded from future claims.';

commit;
