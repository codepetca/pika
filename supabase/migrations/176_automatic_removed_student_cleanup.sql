-- Queue only future removals for automatic live-data cleanup. The database
-- callback is asynchronous and the five-minute watchdog calls Vercel only
-- while due work exists. Activation and Vault configuration remain off.
begin;
set local lock_timeout = '5s';

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table private.student_provider_cleanup_settings
  add column automatic_enabled boolean not null default false,
  add column automatic_last_kicked_at timestamptz;

create table private.removed_student_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  teacher_id uuid references public.users(id) on delete restrict,
  classroom_id uuid references public.classrooms(id) on delete restrict,
  student_id uuid references public.users(id) on delete restrict,
  generation_id uuid unique references private.pal_membership_generations(generation_id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued','processing','retry_wait','completed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((status='processing')=(lease_token is not null and lease_expires_at is not null)),
  check ((status='completed')=(completed_at is not null)),
  check (status='completed' or (teacher_id is not null and classroom_id is not null
    and student_id is not null and generation_id is not null)),
  check (status<>'completed' or (teacher_id is null and classroom_id is null
    and student_id is null and generation_id is null))
);
create index removed_student_cleanup_jobs_due
  on private.removed_student_cleanup_jobs(next_attempt_at,created_at)
  where status in ('queued','retry_wait');
create index removed_student_cleanup_jobs_expired_lease
  on private.removed_student_cleanup_jobs(lease_expires_at)
  where status='processing';
alter table private.removed_student_cleanup_jobs enable row level security;
revoke all on private.removed_student_cleanup_jobs from public,anon,authenticated,service_role;

create function private.kick_removed_student_cleanup(p_source text)
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
  -- Removal is authoritative. A missing extension, Vault value or network
  -- queue must never roll it back; the next watchdog run retries the kick.
  return null;
end;
$$;
revoke all on function private.kick_removed_student_cleanup(text)
  from public,anon,authenticated,service_role;

create function private.enqueue_removed_student_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_teacher_id uuid;
begin
  if old.removed_at is not null or new.removed_at is null
    or new.removed_student_id is null or new.removed_enrollment_id is null
    or not coalesce((select automatic_enabled from private.student_provider_cleanup_settings
      where singleton),false) then
    return new;
  end if;
  select teacher_id into v_teacher_id from public.classrooms where id=new.classroom_id;
  if v_teacher_id is null then return new; end if;
  insert into private.removed_student_cleanup_jobs(
    operation_id,teacher_id,classroom_id,student_id,generation_id)
  values(gen_random_uuid(),v_teacher_id,new.classroom_id,new.removed_student_id,new.removed_enrollment_id)
  on conflict(generation_id) do nothing;
  perform private.kick_removed_student_cleanup('removal');
  return new;
end;
$$;
revoke all on function private.enqueue_removed_student_cleanup()
  from public,anon,authenticated,service_role;
create trigger enqueue_removed_student_cleanup
  after update of removed_at,removed_student_id,removed_enrollment_id
  on public.classroom_roster for each row
  execute function private.enqueue_removed_student_cleanup();

create function public.claim_removed_student_cleanup_job(p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job private.removed_student_cleanup_jobs;
begin
  if p_lease_token is null then
    raise exception using errcode='22023',message='removed_student_cleanup_lease_required';
  end if;
  if not coalesce((select automatic_enabled and enabled and live_enabled
    from private.student_provider_cleanup_settings where singleton for share),false) then
    raise exception using errcode='55000',message='removed_student_cleanup_disabled';
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
revoke all on function public.claim_removed_student_cleanup_job(uuid)
  from public,anon,authenticated;
grant execute on function public.claim_removed_student_cleanup_job(uuid) to service_role;

create function public.release_removed_student_cleanup_job(
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
      lease_expires_at=null,last_error_code=null,completed_at=clock_timestamp(),
      updated_at=clock_timestamp() where id=p_job_id;
  else
    update private.removed_student_cleanup_jobs set
      status='retry_wait',lease_token=null,lease_expires_at=null,
      last_error_code=coalesce(p_error_code,'cleanup_pending'),
      next_attempt_at=clock_timestamp()+make_interval(secs=>p_retry_delay_seconds),
      updated_at=clock_timestamp() where id=p_job_id;
  end if;
  return true;
end;
$$;
revoke all on function public.release_removed_student_cleanup_job(uuid,uuid,boolean,text,integer)
  from public,anon,authenticated;
grant execute on function public.release_removed_student_cleanup_job(uuid,uuid,boolean,text,integer)
  to service_role;

create function private.run_removed_student_cleanup_watchdog()
returns bigint language sql security definer set search_path=''
as $$ select private.kick_removed_student_cleanup('watchdog') $$;
revoke all on function private.run_removed_student_cleanup_watchdog()
  from public,anon,authenticated,service_role;

select cron.schedule(
  'pika-removed-student-cleanup-watchdog',
  '*/5 * * * *',
  $job$select private.run_removed_student_cleanup_watchdog()$job$
);

comment on table private.removed_student_cleanup_jobs is
  'Private durable queue for future automatic pika-live-v1 cleanup; completed rows redact user identity.';
comment on function private.kick_removed_student_cleanup(text) is
  'Conditionally queues one asynchronous Vercel callback only when cleanup work is due.';
comment on function public.claim_removed_student_cleanup_job(uuid) is
  'Service-only bounded claim for one automatic removed-membership cleanup job.';

commit;
