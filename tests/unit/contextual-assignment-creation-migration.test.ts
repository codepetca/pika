import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = () => readFileSync(
  'supabase/migrations/192_contextual_assignment_creation.sql',
  'utf8',
)
const behaviorScript = () => readFileSync(
  'scripts/check-contextual-assignment-creation-database.sh',
  'utf8',
)
const concurrencyScript = () => readFileSync(
  'scripts/check-contextual-assignment-creation-concurrency.mjs',
  'utf8',
)
const workflow = () => readFileSync('.github/workflows/ci.yml', 'utf8')
const rolloutGuide = () => readFileSync(
  'docs/guidance/contextual-assignment-creation.md',
  'utf8',
)

describe('contextual Assignment creation migration', () => {
  it('adds one fixed-search-path service-only boundary', () => {
    const sql = migration()
    expect(sql).toContain('function public.create_assignment_for_owner_v1(')
    expect(sql).toContain('security definer')
    expect(sql).toContain("set search_path = ''")
    expect(sql).toMatch(/revoke all on function public\.create_assignment_for_owner_v1\([^;]+from public, anon, authenticated/s)
    expect(sql).toMatch(/grant execute on function public\.create_assignment_for_owner_v1\([^;]+to service_role/s)
  })

  it('locks in shared order before current owner and archive checks', () => {
    const sql = migration()
    const assignmentLock = sql.indexOf("'assignment_submission:'")
    const classroomLock = sql.indexOf("'pika-classroom-operation:'")
    const classroomRowLock = sql.indexOf('for update;')
    const ownerCheck = sql.indexOf('v_owner_id is distinct from p_actor_id')
    const archiveCheck = sql.indexOf('v_archived_at is not null')

    expect(assignmentLock).toBeGreaterThan(-1)
    expect(assignmentLock).toBeLessThan(classroomLock)
    expect(classroomLock).toBeLessThan(classroomRowLock)
    expect(classroomRowLock).toBeLessThan(ownerCheck)
    expect(ownerCheck).toBeLessThan(archiveCheck)
  })

  it('allocates mixed-classwork position and creates requirements atomically', () => {
    const sql = migration()
    expect(sql).toContain('from public.assignments as assignment')
    expect(sql).toContain('from public.classwork_materials as material')
    expect(sql).toContain('from public.surveys as survey')
    expect(sql).toContain('insert into public.assignments')
    expect(sql).toContain('public.replace_assignment_submission_requirements_atomic')
    expect(sql.indexOf('insert into public.assignments'))
      .toBeLessThan(sql.indexOf('public.replace_assignment_submission_requirements_atomic'))
  })

  it('has rollback-only behavior and multi-session concurrency coverage in CI', () => {
    const behavior = behaviorScript()
    const concurrency = concurrencyScript()
    const ci = workflow()

    expect(behavior).toContain('rollback;')
    expect(behavior).not.toContain('supabase db push')
    expect(concurrency).toContain('waitBlocked')
    expect(concurrency).toContain('owner_transfer_wins_assignment_creation')
    expect(concurrency).toContain('concurrent_assignment_creations_serialize_positions')
    expect(concurrency).not.toContain('supabase db push')
    expect(ci).toContain('bash scripts/check-contextual-assignment-creation-database.sh')
    expect(ci).toContain('node scripts/check-contextual-assignment-creation-concurrency.mjs')
  })

  it('keeps activation blocked until every mixed-classwork writer shares the position fence', () => {
    expect(rolloutGuide()).toContain('hard activation blocker')
    expect(rolloutGuide()).toMatch(/material and survey\s+creation must first share/)
  })
})
