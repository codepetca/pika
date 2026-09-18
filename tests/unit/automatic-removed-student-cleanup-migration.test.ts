import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/176_automatic_removed_student_cleanup.sql'), 'utf8')
const hardening = readFileSync(join(process.cwd(), 'supabase/migrations/177_harden_automatic_removed_student_cleanup.sql'), 'utf8')
const eligibilityGuard = readFileSync(join(process.cwd(), 'supabase/migrations/178_guard_automatic_cleanup_eligibility.sql'), 'utf8')
const hourlyWatchdog = readFileSync(join(process.cwd(), 'supabase/migrations/180_hourly_removed_student_cleanup_watchdog.sql'), 'utf8')
const harness = readFileSync(join(process.cwd(), 'scripts/check-automatic-removed-student-cleanup-database.sql'), 'utf8')
const runner = readFileSync(join(process.cwd(), 'scripts/check-automatic-removed-student-cleanup-database.sh'), 'utf8')
const concurrencyRunner = readFileSync(join(process.cwd(), 'scripts/check-automatic-removed-student-cleanup-concurrency.sh'), 'utf8')
const palConcurrencyRunner = readFileSync(join(process.cwd(), 'scripts/check-pal-outbox-concurrency.sh'), 'utf8')
const purgeFailureConcurrencyRunner = readFileSync(join(process.cwd(), 'scripts/check-individual-student-purge-failure-concurrency.sh'), 'utf8')

describe('automatic removed-student cleanup migration', () => {
  it('keeps automatic deletion disabled and limits enrollment to future removals', () => {
    expect(sql).toContain('automatic_enabled boolean not null default false')
    expect(sql).toContain('old.removed_at is not null or new.removed_at is null')
    expect(sql).toContain('after update of removed_at,removed_student_id,removed_enrollment_id')
    expect(sql).not.toMatch(/insert into private\.removed_student_cleanup_jobs[\s\S]*select[\s\S]*from public\.classroom_roster/i)
  })

  it('queues only exact post-activation provider-bound membership generations', () => {
    expect(eligibilityGuard).toContain('v_settings.enabled,false')
    expect(eligibilityGuard).toContain('v_settings.live_enabled,false')
    expect(eligibilityGuard).toContain('v_settings.automatic_enabled,false')
    expect(eligibilityGuard).toContain('new.removed_at<v_settings.eligible_after')
    expect(eligibilityGuard).toMatch(/student_provider_cleanup_settings[\s\S]*where singleton[\s\S]*for update;/)
    expect(eligibilityGuard).toContain('attendance.generation_id=new.removed_enrollment_id')
    expect(eligibilityGuard).toContain('attendance.scope_digest=v_scope')
    expect(eligibilityGuard).toContain('participant.participant_ref=attendance.participant_ref')
    expect(eligibilityGuard).toContain('participant.classroom_id=new.classroom_id')
    expect(eligibilityGuard).toContain('participant.student_id=new.removed_student_id')
    expect(eligibilityGuard).toContain('join public.attendance_roster_mappings roster')
    expect(eligibilityGuard).toContain('join public.attendance_principal_mappings actor')
    expect(eligibilityGuard).not.toMatch(/insert into private\.attendance_membership_generations/i)
  })

  it('stores work privately and redacts completed identities', () => {
    expect(sql).toContain('alter table private.removed_student_cleanup_jobs enable row level security')
    expect(sql).toContain('revoke all on private.removed_student_cleanup_jobs from public,anon,authenticated,service_role')
    expect(sql).toMatch(/status='completed',teacher_id=null,classroom_id=null,student_id=null,generation_id=null/)
    expect(sql).toContain("check (status<>'completed' or (teacher_id is null and classroom_id is null")
  })

  it('uses a leased, service-only claim and rejects stale completion', () => {
    expect(sql).toContain('for update skip locked limit 1')
    expect(sql).toContain("lease_expires_at=clock_timestamp()+interval '2 minutes'")
    expect(sql).toContain("message='removed_student_cleanup_lease_stale'")
    expect(sql).toContain('grant execute on function public.claim_removed_student_cleanup_job(uuid) to service_role')
    expect(sql).not.toMatch(/grant execute on function public\.claim_removed_student_cleanup_job\(uuid\) to (anon|authenticated)/)
  })

  it('defines a conditional watchdog without embedding secrets or student data', () => {
    expect(sql).toContain("'*/5 * * * *'")
    expect(sql).toContain("name='pika_removed_student_cleanup_worker_url'")
    expect(sql).toContain("name='pika_removed_student_cleanup_worker_secret'")
    expect(sql).toContain("body=>jsonb_build_object('source',p_source)")
    expect(sql).toContain("not exists (\n      select 1 from private.removed_student_cleanup_jobs")
    expect(sql).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/)
  })

  it('moves the recovery watchdog to hourly without changing its command', () => {
    expect(hourlyWatchdog).toContain('select cron.alter_job(')
    expect(hourlyWatchdog).toContain("where jobname = 'pika-removed-student-cleanup-watchdog'")
    expect(hourlyWatchdog).toContain("schedule := '0 * * * *'")
    expect(hourlyWatchdog).not.toMatch(/update\s+cron\.job|cron\.unschedule/i)
    expect(hourlyWatchdog).not.toContain('private.run_removed_student_cleanup_watchdog()')
  })

  it('registers a rollback-only synthetic queue and lease lifecycle', () => {
    expect(harness.trimEnd()).toMatch(/rollback;$/)
    expect(harness).not.toMatch(/^commit;/m)
    expect(harness).toContain('Active lease was claimed twice')
    expect(harness).toContain('Stale lease release was accepted')
    expect(harness).toContain('Completed job retained student identity')
    expect(harness).toContain('Generation eligibility capture boundary is incorrect')
    expect(harness).toContain('Eligible incomplete removal was not durably quarantined')
    expect(runner).not.toMatch(/db (push|reset)|migration (up|repair)|create database/)
    expect(concurrencyRunner).toContain('pika_automatic_cleanup_concurrency_')
    expect(concurrencyRunner).toContain('dropdb -U postgres --if-exists "$TMP_DB"')
    expect(concurrencyRunner).toContain("180_hourly_removed_student_cleanup_watchdog.sql' ]]; then")
    expect(palConcurrencyRunner).toContain('180_hourly_removed_student_cleanup_watchdog.sql" ]]; then')
    expect(purgeFailureConcurrencyRunner).toContain('180_hourly_removed_student_cleanup_watchdog.sql" ]]; then')
    expect(concurrencyRunner).toContain('automatic_cleanup_removal_after_gate_off Lock')
    expect(concurrencyRunner).toContain('automatic_cleanup_gate_after_removal Lock')
    expect(concurrencyRunner).not.toMatch(/--linked|db push|db reset/)
  })

  it('requires academic and storage readiness before callbacks or claims', () => {
    expect(hardening).toContain('private.removed_student_academic_settings')
    expect(hardening).toContain("mode='enforced'")
    expect(hardening).toContain("message='removed_student_cleanup_academic_disabled'")
    expect(hardening).toContain("message='removed_student_cleanup_storage_not_enforced'")
    expect(hardening).toContain('create or replace function public.authorize_student_provider_cleanup(')
    expect(hardening).toContain("message='student_live_cleanup_prerequisite_paused'")
  })

  it('adds a terminal quarantine excluded from due claims', () => {
    expect(hardening).toContain("'queued','processing','retry_wait','quarantined','completed'")
    expect(hardening).toContain("p_error_code='cleanup_quarantined'")
    expect(hardening).toContain("status='quarantined'")
    expect(hardening).not.toMatch(/job\.status in \([^)]*quarantined/)
  })
})
