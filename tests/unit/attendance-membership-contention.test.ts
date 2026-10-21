import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const script = readFileSync('scripts/check-attendance-membership-adoption-contention.mjs', 'utf8')

describe('isolated attendance membership contention proof', () => {
  it('verifies immutable ownership and isolation before starting any SQL connection', () => {
    for (const guard of ['inspection.Id, containerId', 'pika.attendance-membership.owner',
      'com.supabase.cli.project', "inspection.HostConfig.NetworkMode, 'none'",
      'inspection.HostConfig.PortBindings', 'inspection.NetworkSettings.Ports']) expect(script).toContain(guard)
    expect(script.indexOf('function verifyTarget')).toBeLessThan(script.indexOf('function connection'))
    expect(script.indexOf('\nverifyTarget()\n')).toBeGreaterThan(0)
    expect(script.indexOf('\nverifyTarget()\n')).toBeLessThan(script.indexOf("const holder = connection('holder')"))
    expect(script).not.toContain("const container = 'supabase_db_pika'")
    expect(script).not.toMatch(/pg_advisory|try_lock_classroom_membership_change|docker[^\n]*(?:create|run|rm)/)
  })

  it('seals the source fixture and changes only its terminal rollback in memory', () => {
    const fixture = readFileSync('scripts/check-attendance-membership-adoption-database.sql', 'utf8')
    expect(script).toContain(createHash('sha256').update(fixture).digest('hex'))
    expect(script).toContain('attendance-membership-adoption-reviewed-migration.ts')
    expect(script).toContain('285_attendance_membership_adoption.sql')
    expect(script).toContain('286_attendance_learner_membership.sql')
    expect(script).toContain("fixture.replace(/rollback;\\s*$/i, 'commit;')")
    expect(script).not.toMatch(/writeFile|appendFile|execSync|shell:\s*true/)
  })

  it('bounds both streams, connection lifetime and exact expected database errors', () => {
    expect(script).toContain('30_000')
    expect(script).toContain('MAX_STREAM_BYTES')
    expect(script).toContain('stdoutBytes')
    expect(script).toContain('stderrBytes')
    expect(script).toContain("'ON_ERROR_STOP=1'")
    expect(script).toContain("'40001', 'classroom_operation_busy'")
    expect(script).toContain("'PT409', 'Roster operation busy'")
    expect(script).toContain('if sqlerrm is distinct from')
    expect(script).toContain('if (failure) throw failure')
    expect(script).toContain("closures.filter(result => result.status === 'rejected')")
    expect(script).toContain('new AggregateError([...new Set(errors)]')
    expect(script.lastIndexOf("console.log('PASS:")).toBeGreaterThan(script.indexOf('if (errors.length) throw'))
  })

  it('uses actual prepare/stage/removal RPCs and verifies committed state across connections', () => {
    for (const rpc of ['prepare_attendance_membership_snapshot_v1', 'stage_attendance_membership_roster_snapshot_v1',
      'resolve_attendance_membership_scan_generation', 'remove_classroom_students_for_owner_v1',
      'read_attendance_membership_status_v1', 'apply_attendance_membership_status_overrides_v1',
      'set_attendance_teacher_entitlement_v1']) expect(script).toContain(rpc)
    expect(script).toContain('assert.deepEqual(retried, baseline)')
    expect(script).toContain("await holder.run('commit;')")
    expect(script).toContain("await holder.run('rollback;')")
    expect(script).toContain("'attendance_roster_source_changed'")
    expect(script).toContain("status='superseded'")
    expect(script).toContain('private.attendance_pointer_mutations')
  })
})
