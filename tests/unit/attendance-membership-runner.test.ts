import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const runner = () => readFileSync('scripts/check-attendance-membership-adoption-database.sh', 'utf8')

function resolveCachedMeta(registry: string, cachedRegistry = registry || 'public.ecr.aws', imageId = `sha256:${'a'.repeat(64)}`, inspectStatus = 0) {
  const definition = runner().match(/^resolve_attendance_meta_image\(\) \{\n[\s\S]*?^\}/m)?.[0]
  expect(definition, 'exercise the actual shell image resolver').toBeDefined()
  return spawnSync('/bin/bash', ['-c', `set -euo pipefail
docker() {
  printf 'docker:%s\\n' "$*" >&2
  [[ "$*" == "image inspect $FIXTURE_CACHED_IMAGE --format {{.Id}}" ]] || return 44
  [[ "$FIXTURE_INSPECT_STATUS" == 0 ]] || return "$FIXTURE_INSPECT_STATUS"
  printf '%s\\n' "$FIXTURE_IMAGE_ID"
}
${definition}
resolve_attendance_meta_image`], {
    encoding: 'utf8',
    env: { ...process.env, BASH_ENV: '', SUPABASE_INTERNAL_IMAGE_REGISTRY: registry,
      FIXTURE_CACHED_IMAGE: `${cachedRegistry}/supabase/postgres-meta:v0.96.6`,
      FIXTURE_IMAGE_ID: imageId, FIXTURE_INSPECT_STATUS: String(inspectStatus) },
  })
}

describe('isolated attendance membership database proof', () => {
  it.each(['', 'public.ecr.aws', 'ghcr.io'])('uses the pinned cached metadata image for registry %j without a pull', registry => {
    const result = resolveCachedMeta(registry)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe(`sha256:${'a'.repeat(64)}`)
    expect(result.stderr).not.toContain('pull')
    const source = runner()
    expect(source.indexOf('meta_image="$(resolve_attendance_meta_image)"')).toBeLessThan(source.indexOf('scratch="$(mktemp'))
    expect(source).toContain('"$meta_image")')
  })

  it('fails closed for an unreviewed registry before accessing Docker', () => {
    const result = resolveCachedMeta('unreviewed.invalid')
    expect(result.status).toBe(2)
    expect(result.stderr).not.toContain('docker:')
  })

  it('fails before replay when the configured registry image is not cached', () => {
    const result = resolveCachedMeta('ghcr.io', 'public.ecr.aws')
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('ghcr.io/supabase/postgres-meta:v0.96.6')
  })

  it('propagates inspection failure instead of launching or pulling a fallback', () => {
    const result = resolveCachedMeta('ghcr.io', 'ghcr.io', '', 42)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr.match(/docker:/g)).toHaveLength(1)
  })

  it.each(['', 'tag:latest', `sha256:${'a'.repeat(63)}`, `sha256:${'A'.repeat(64)}`])('rejects malformed image identity %j', id => {
    const result = resolveCachedMeta('ghcr.io', 'ghcr.io', id)
    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
  })

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
    expect(source).toContain("assert.equal(migrations.length,286")
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
    expect(source).toContain('read_attendance_membership_status_v1:')
    expect(source).toContain('read_attendance_membership_session_for_owner_v1:')
    expect(source).toContain('apply_attendance_membership_status_overrides_v1:')
    expect(source).toContain('cmp -s')
    expect(source).toContain('Baseline must remain unchanged')
    expect(source).toContain('drop schema public cascade; drop schema private cascade; create schema public;')
    expect(source).not.toContain('10#$number > 10#$source_version')
  })
})
