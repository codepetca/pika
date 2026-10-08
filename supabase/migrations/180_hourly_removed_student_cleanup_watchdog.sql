-- Keep immediate removal-triggered cleanup unchanged while reducing the
-- recovery watchdog from every five minutes to the top of each hour.
begin;
set local lock_timeout = '5s';

select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname = 'pika-removed-student-cleanup-watchdog'
  ),
  schedule := '0 * * * *'
);

commit;
