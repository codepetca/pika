import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/176_automatic_removed_student_cleanup.sql'), 'utf8')
const harness = readFileSync(join(process.cwd(), 'scripts/check-automatic-removed-student-cleanup-database.sql'), 'utf8')
const runner = readFileSync(join(process.cwd(), 'scripts/check-automatic-removed-student-cleanup-database.sh'), 'utf8')

describe('automatic removed-student cleanup migration', () => {
  it('keeps automatic deletion disabled and limits enrollment to future removals', () => {
    expect(sql).toContain('automatic_enabled boolean not null default false')
    expect(sql).toContain('old.removed_at is not null or new.removed_at is null')
    expect(sql).toContain('after update of removed_at,removed_student_id,removed_enrollment_id')
    expect(sql).not.toMatch(/insert into private\.removed_student_cleanup_jobs[\s\S]*select[\s\S]*from public\.classroom_roster/i)
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

  it('runs a conditional five-minute watchdog without embedding secrets or student data', () => {
    expect(sql).toContain("'*/5 * * * *'")
    expect(sql).toContain("name='pika_removed_student_cleanup_worker_url'")
    expect(sql).toContain("name='pika_removed_student_cleanup_worker_secret'")
    expect(sql).toContain("body=>jsonb_build_object('source',p_source)")
    expect(sql).toContain("not exists (\n      select 1 from private.removed_student_cleanup_jobs")
    expect(sql).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/)
  })

  it('registers a rollback-only synthetic queue and lease lifecycle', () => {
    expect(harness.trimEnd()).toMatch(/rollback;$/)
    expect(harness).not.toMatch(/^commit;/m)
    expect(harness).toContain('Active lease was claimed twice')
    expect(harness).toContain('Stale lease release was accepted')
    expect(harness).toContain('Completed job retained student identity')
    expect(runner).not.toMatch(/db (push|reset)|migration (up|repair)|create database/)
  })
})
