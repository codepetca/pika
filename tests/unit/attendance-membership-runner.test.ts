import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const runner = (path = 'scripts/check-attendance-membership-adoption-database.sh') => readFileSync(path, 'utf8')

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

function sealedReplayPreflight(path: string, repository = process.cwd()) {
  const command = runner(path).match(/^pnpm --dir "\$root" exec tsx -e "([^"\n]+)"$/m)?.[1]
  expect(command, 'exercise the same preflight that runs before cloning').toBeDefined()
  return spawnSync('pnpm', ['exec', 'tsx', '-e', command!.replace('process.cwd()', 'process.env.FIXTURE_REPOSITORY ?? process.cwd()')], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', FIXTURE_REPOSITORY: repository },
  })
}

describe('isolated attendance membership database proof', () => {
  it.each([
    ['233', false], ['234', true], ['243', true], ['285', true], ['286', true],
    ['287', true], ['288', true], ['289', true], ['290', true], ['291', true], ['292', true], ['293', true], ['294', true], ['295', false], ['0286', false], ['286+0', false],
  ] as const)('admits only reviewed source profiles, including the actual CI target: %s', (version, accepted) => {
    for (const path of ['scripts/check-attendance-membership-adoption-database.sh', 'scripts/check-material-post-date-database.sh']) {
      const source = runner(path)
      const start = source.indexOf('[[ "$source_version" =~')
      const end = source.indexOf('pnpm --dir "$root" exec tsx')
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      const result = spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${source.slice(start, end)}`], {
        encoding: 'utf8', env: { ...process.env, BASH_ENV: '', source_version: version },
      })
      expect(result.status === 0, path).toBe(accepted)
    }
  })

  it.each(['scripts/check-attendance-membership-adoption-database.sh', 'scripts/check-material-post-date-database.sh'])(
    'executes %s sealed replay-target preflight against the complete current chain', path => {
      const result = sealedReplayPreflight(path)
      expect(result.status, result.stderr).toBe(0)
    })

  it.each(['tampered293', 'renamed293', 'tampered294', 'renamed294', 'missing294', 'unknown295'] as const)('rejects %s before any clone or replay using the actual runner preflight', defect => {
    const repository = mkdtempSync(join(tmpdir(), 'pika-attendance-reviewed-profile-'))
    try {
      mkdirSync(join(repository, 'supabase'))
      const migrations = join(repository, 'supabase/migrations')
      cpSync('supabase/migrations', migrations, { recursive: true })
      const reviewed = join(migrations, '293_repolight_report_service.sql')
      if (defect === 'tampered293') appendFileSync(reviewed, '\n-- unreviewed source substitution\n')
      if (defect === 'renamed293') renameSync(reviewed, join(migrations, '293_unreviewed.sql'))
      if (defect === 'tampered294') appendFileSync(join(migrations, '294_classroom_experience_admission_registry.sql'), '\n-- unreviewed\n')
      if (defect === 'renamed294') renameSync(join(migrations, '294_classroom_experience_admission_registry.sql'), join(migrations, '294_unreviewed.sql'))
      if (defect === 'missing294') rmSync(join(migrations, '294_classroom_experience_admission_registry.sql'))
      if (defect === 'unknown295') writeFileSync(join(migrations, '295_unreviewed.sql'), 'select 1;\n')
      for (const path of ['scripts/check-attendance-membership-adoption-database.sh', 'scripts/check-material-post-date-database.sh']) {
        const result = sealedReplayPreflight(path, repository)
        expect(result.status, `${path} must fail closed for ${defect}`).not.toBe(0)
        expect(result.stderr).toMatch(/AssertionError|Unreviewed|Expected/)
      }
    } finally { rmSync(repository, { recursive: true, force: true }) }
  })

  it('makes every top-level conditional safety gate explicit for macOS Bash3.2', () => {
    // Bash3.2 does not apply errexit to a standalone failed [[...]]/((...)).
    // Require explicit exits rather than accepting a successful later command.
    const gates = runner().split('\n').filter(line => line.startsWith('[[') || line.startsWith('(('))
    expect(gates).toHaveLength(10)
    for (const gate of gates) expect(gate).toMatch(/\|\| exit [12]$/)
  })

  it('forward-corrects only owner precedence while preserving every285 strict-scan fence', () => {
    const original = readFileSync('supabase/migrations/285_attendance_membership_adoption.sql', 'utf8')
      .match(/create function public\.resolve_attendance_membership_scan_generation\([\s\S]*?\n\$\$;/)?.[0]
    const forward = readFileSync('supabase/migrations/286_attendance_learner_membership.sql', 'utf8')
      .match(/create or replace function public\.resolve_attendance_membership_scan_generation\([\s\S]*?\n\$\$;/)?.[0]
    expect(original).toBeDefined()
    expect(forward).toContain('and classroom.teacher_id<>p_student_id')
    expect(forward?.replace('create or replace function', 'create function')
      .replace('\n      and classroom.teacher_id<>p_student_id', '')).toBe(original)
  })

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
    expect(source).toContain("assert.equal(migrations.length,294")
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


describe('isolated material and announcement post-date proof target', () => {
  it('requires scheduling, post-date, owner-write and image rollback proofs before exact metadata comparison', () => {
    const source = runner('scripts/check-material-post-date-database.sh')
    expect(source).toContain('assert.equal(migrations.length,294')
    expect(source).toContain('validateLifecycleServicesReviewedMigrations(migrations)')
    const proof = source.indexOf('check-material-release-scheduling-database.sql check-independent-calendar-post-dates-database.sql check-material-post-date-database.sql check-announcement-post-date-database.sql check-contextual-material-owner-writes-database.sql check-teacher-authoring-images-database.sql; do')
    expect(proof).toBeGreaterThan(-1)
    expect(proof).toBeLessThan(source.indexOf('meta_id="$(docker create'))
    expect(source).toContain('update_announcement_for_owner_v1:; do')
    expect(source).toContain('cmp -s "$scratch/normalized.ts" "$root/src/types/database.generated.ts"')
    expect(source).toContain('pika.material-post-date.owner')
    expect(source).not.toMatch(/supabase (?:db push|db reset)|--linked|--publish|--privileged/)
  })
})
