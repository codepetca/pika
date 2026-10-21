import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const runner = () => readFileSync('scripts/check-attendance-membership-adoption-database.sh', 'utf8')

describe('isolated attendance membership database proof', () => {
  it('keeps source access schema-only and all writes inside an offline owned clone', () => {
    const source = runner()
    expect(source).toContain('pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges')
    expect(source).toContain('--network none')
    expect(source).toContain('--pull=never')
    expect(source).toContain('--memory=2g --cpus=2 --pids-limit=256')
    expect(source).toContain('pika.attendance-membership.owner')
    expect(source).toContain('cleanup unresolved')
    expect(source).toContain('docker info --format')
    expect(source).toContain('validateLifecycleServicesReviewedMigrations')
    expect(source).toContain("assert.equal(migrations.length,285")
    expect(source).not.toMatch(/supabase (?:db push|db reset)|--linked|--publish|--privileged/)
  })
  it('requires both membership behavior and real metadata generation before accepting output', () => {
    const source = runner()
    expect(source).toContain('check-attendance-membership-adoption-database.sql')
    expect(source).toContain('check-attendance-membership-adoption-contention.mjs')
    expect(source).toContain('check-attendance-decommission-database.sh')
    expect(source).toContain('supabase_migrations.schema_migrations')
    expect(source).toContain('--container-id "$clone_id" --owner "$$:$token"')
    expect(source).toContain('PG_META_GENERATE_TYPES=typescript')
    expect(source).toContain('resolve_attendance_membership_scan_generation:')
    expect(source).toContain('prepare_attendance_membership_snapshot_v1:')
    expect(source).toContain('stage_attendance_membership_roster_snapshot_v1:')
    expect(source).toContain('cmp -s')
    expect(source).toContain('Baseline must remain unchanged')
    expect(source).toContain('drop schema public cascade; drop schema private cascade; create schema public;')
    expect(source).not.toContain('10#$number > 10#$source_version')
  })
})
