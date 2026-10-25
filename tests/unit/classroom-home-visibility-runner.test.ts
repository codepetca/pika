import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION } from '../../scripts/repolight-report-service-reviewed-migration'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const runner = readFileSync('scripts/check-classroom-home-visibility-database.sh', 'utf8')
const contention = readFileSync('scripts/check-classroom-home-visibility-contention.mjs', 'utf8')
const recovery = readFileSync('scripts/check-classroom-home-recovery-database.sql', 'utf8')

function runManifest(repository = process.cwd()) {
  const code = runner.match(/manifest\(\) \{\n  node - "\$root" <<'NODE'\n([\s\S]*?)\nNODE\n\}/)?.[1]
  expect(code, 'exercise the exact embedded manifest before any Docker activity').toBeDefined()
  return spawnSync(process.execPath, ['-', repository], { input: code, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } })
}

describe('isolated home visibility proof runner source contracts', () => {
  it.each([
    ['public.ecr.aws/supabase/postgres:17.6.1.044', true],
    ['ghcr.io/supabase/postgres:17.6.1.044', true],
    ['public.ecr.aws/supabase/postgres:17.6.1.132', true],
    ['ghcr.io/supabase/postgres:17.6.1.132', true],
    ['ghcr.io/supabase/postgres:17.6.1.133', false],
    ['ghcr.io/supabase/postgres:17.6.1.132-extra', false],
    ['ghcr.io/supabase/postgres:latest', false],
    ['docker.io/supabase/postgres:17.6.1.132', false],
    ['unreviewed.example/supabase/postgres:17.6.1.132', false],
    ['ghcr.io/other/postgres:17.6.1.132', false],
    ['', false],
  ] as const)('executes the actual pinned source-image guard for %j', (sourceImage, accepted) => {
    const guard = runner.match(/^case "\$source_image" in\n[\s\S]*?^esac$/m)?.[0]
    expect(guard).toBeDefined()
    const result = spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${guard}`], {
      encoding: 'utf8', env: { ...process.env, BASH_ENV: '', source_image: sourceImage },
    })
    expect(result.status === 0).toBe(accepted)
  })

  it.each([['233', false], ['234', true], ['292', true], ['293', true], ['294', false], ['0293', false], ['293+0', false]] as const)('executes the closed source-version guard for %s', (version, accepted) => {
    const start = runner.indexOf('[[ "$source_version" =~')
    const end = runner.indexOf('registry=', start)
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start)
    const result = spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${runner.slice(start, end)}`], { encoding: 'utf8', env: { ...process.env, BASH_ENV: '', source_version: version } })
    expect(result.status === 0).toBe(accepted)
  })

  it('executes the complete current293 manifest and seals the exact reviewed extension', () => {
    const result = runManifest()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim().split('\n')).toHaveLength(296)
    expect(result.stdout).toContain(`${REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION.sha256}  supabase/migrations/${REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION.name}`)
  })

  it.each(['tampered293', 'renamed293', 'unknown294', 'historicalDirtyTree'] as const)('executes manifest compatibility rules for %s', defect => {
    const repository = mkdtempSync(join(tmpdir(), 'pika-home-reviewed-profile-'))
    try {
      mkdirSync(join(repository, 'supabase')); mkdirSync(join(repository, 'scripts'))
      const migrations = join(repository, 'supabase/migrations')
      cpSync('supabase/migrations', migrations, { recursive: true })
      for (const proof of ['check-classroom-home-visibility-database.sql', 'check-classroom-home-recovery-database.sql', 'check-classroom-home-visibility-contention.mjs']) cpSync(join('scripts', proof), join(repository, 'scripts', proof))
      const reviewed = join(migrations, REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION.name)
      if (defect === 'tampered293') appendFileSync(reviewed, '\n-- unreviewed source substitution\n')
      if (defect === 'renamed293') renameSync(reviewed, join(migrations, '293_unreviewed.sql'))
      if (defect === 'unknown294') writeFileSync(join(migrations, '294_unreviewed.sql'), 'select 1;\n')
      if (defect === 'historicalDirtyTree') appendFileSync(join(migrations, readdirSync(migrations).find(name => name.startsWith('001_'))!), '\n-- historical dirty-tree manifest remains supported\n')
      const result = runManifest(repository)
      if (defect === 'historicalDirtyTree') expect(result.status, result.stderr).toBe(0)
      else { expect(result.status).not.toBe(0); expect(result.stderr).toContain('AssertionError') }
    } finally { rmSync(repository, { recursive: true, force: true }) }
  })

  it.each([true, false])('retains exact cached-versus-running image identity checks: match=%s', matches => {
    const guard = runner.split('\n').find(line => line.startsWith('[[ "$(docker inspect "$source_id" --format \'{{.Image}}\')"'))
    expect(guard).toBeDefined()
    const result = spawnSync('/bin/bash', ['-c', `set -euo pipefail
docker() { printf '%s\\n' "$FIXTURE_RUNNING_IMAGE"; }
${guard}`], {
      encoding: 'utf8', env: { ...process.env, BASH_ENV: '', source_id: 'synthetic-source',
        image: `sha256:${'a'.repeat(64)}`, FIXTURE_RUNNING_IMAGE: `sha256:${(matches ? 'a' : 'b').repeat(64)}` },
    })
    expect(result.status === 0).toBe(matches)
  })

  it('resolves and freezes the exact project source with installed images, without pulling or shared migration writes', () => {
    for (const token of ['source_container=supabase_db_pika', 'source_id="$(docker inspect "$source_container" --format', '"$source_id" =~ ^[a-f0-9]{64}$', 'com.supabase.cli.project', 'docker port "$source_id" 5432/tcp', '*:54322', 'public.ecr.aws/supabase/postgres:17.6.1.044|ghcr.io/supabase/postgres:17.6.1.044', 'postgres-meta:v0.96.6', '--pull=never', '--network none', '--schema-only --no-owner --no-privileges', '--schema=public --schema=private --schema=auth --schema=storage']) {
      expect(runner).toContain(token)
    }
    expect(runner).not.toMatch(/source_id=[a-f0-9]{64}/)
    expect(runner).not.toMatch(/docker (?:pull|restart|stop)|supabase (?:db|migration)|pg_dump[^\n]*--data-only/)
    expect(runner).toContain('drop schema public cascade; drop schema private cascade; create schema public;')
  })

  it('validates a contiguous full293 inventory and seals SQL/proof bytes before and after execution', () => {
    for (const token of ["assert.equal(paths.length, 293", "String(index + 1).padStart(3, '0')", "createHash('sha256')", 'source-manifest.sha256', 'replay-manifest.sha256', 'final-manifest.sha256', 'check-classroom-home-visibility-database.sql', 'check-classroom-home-recovery-database.sql', 'check-classroom-home-visibility-contention.mjs']) {
      expect(runner).toContain(token)
    }
    expect(runner).not.toContain('validateLifecycleServicesReviewedMigrations')
  })

  it('runs recovery contracts only through the same owned offline clone and retained evidence', () => {
    expect(runner).toContain('sql < "$root/scripts/check-classroom-home-recovery-database.sql" > "$scratch/recovery.log" 2>&1')
    expect(runner.indexOf("echo 'PASS isolated replay001–293.'")).toBeLessThan(runner.indexOf('sql < "$root/scripts/check-classroom-home-recovery-database.sql"'))
    expect(runner.indexOf('sql < "$root/scripts/check-classroom-home-recovery-database.sql"')).toBeLessThan(runner.lastIndexOf('verify_source ||'))
    expect(runner).not.toMatch(/recovery.*(?:source_id|supabase_db_pika).*psql/)
  })

  it.each([
    ['ok\n{"version":1,"scope":"classroom-home-recovery-v1","outcome":"passed","stage":"rolled-back","nativeVerified":false}\n', true],
    ['', false],
    ['ok\n{}', false],
    ['ok\n{"version":1,"scope":"classroom-home-recovery-v1","outcome":"passed","stage":"rolled-back","nativeVerified":true}', false],
    ['WARNING unexpected\nok\n{}', false],
    ['x'.repeat(1025), false],
  ])('executes the closed recovery verdict parser: case %# accepted=%s', (output, accepted) => {
    const parser = runner.match(/node - "\$scratch\/recovery.log" <<'NODE'\n([\s\S]*?)\nNODE/)?.[1]
    expect(parser).toBeDefined()
    const execute = () => runInNewContext(parser!, {
      require: (name: string) => {
        if (name === 'node:assert/strict') return assert
        if (name === 'node:fs') return { readFileSync: () => Buffer.from(output) }
        throw new Error('Unexpected verdict parser dependency')
      }, process: { argv: ['node', '-', 'inert-fixture'] },
    })
    if (accepted) expect(execute).not.toThrow()
    else expect(execute).toThrow()
  })

  it('retains explicit real-role failure/restoration and complete graph rollback assertions', () => {
    // Source contracts only. Native execution, not these string checks, proves
    // PostgreSQL semantics and complete rollback behavior.
    for (const token of ["n.nspname in ('public','private')", "c.relkind in ('r','p')", 'pg_get_functiondef',
      'p.proacl::text', 'create_classroom_atomic_v1', 'set_effective_feature_entitlement_v1',
      'classroom_creation_entitlement_disabled', 'permission denied for function get_classroom_creation_access_v1',
      'revoke execute on function public.get_classroom_creation_access_v1(uuid,timestamptz) from service_role;',
      'grant execute on function public.get_classroom_creation_access_v1(uuid,timestamptz) to service_role;',
      'read_classroom_home_visibility_v1', 'Recovery fixture rollback did not restore original graph/catalog']) {
      expect(recovery).toContain(token)
    }
    expect(recovery).not.toMatch(/^commit\s*;/im)
    expect(recovery.indexOf('rollback;')).toBeLessThan(recovery.indexOf('do $rolled_back$'))
    expect(recovery).toContain('Recovery submitted-work sentinel')
  })

  it('seeds submitted work as the current assignment_docs JSONB document, not legacy plain text', () => {
    const content = recovery.match(/insert into public\.assignment_docs[\s\S]*?values\s*\n\s*\('[^']+','[^']+','[^']+','((?:''|[^'])*)'(?:\s*::jsonb)?,true,/)?.[1]
    expect(content).toBeDefined()
    expect(JSON.parse(content!.replaceAll("''", "'"))).toEqual({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Recovery submitted-work sentinel' }] },
    ] })
  })

  it('preserves source schemas/version/image and removes only owned exact clone identities on success and failure', () => {
    for (const token of ['verify_source', 'schema-after-normalized.sql', 'source_version', 'source_preserved', 'pika.home-visibility.owner', 'docker rm -fv "$expected"', 'trap cleanup EXIT', 'Private home visibility proof evidence:']) {
      expect(runner).toContain(token)
    }
    expect(runner).toContain('[[ -n "$expected"')
    expect(runner).toContain('Canonical source preservation unresolved')
  })

  it('compares generated types by default and only emits a private artifact in explicit generation mode', () => {
    for (const token of ['--generate-artifact-only', 'Generated types artifact: $scratch/normalized.ts', 'cmp -s "$scratch/normalized.ts" "$root/src/types/database.generated.ts"', 'read_classroom_home_visibility_v1:', 'set_classroom_home_visibility_v1:']) {
      expect(runner).toContain(token)
    }
    expect(runner).not.toMatch(/(?:cp|mv|tee).*database\.generated\.ts|>\s*"\$root\/src\/types\/database\.generated\.ts"/)
  })

  it('observes actual independent-session lock waits for removal/rejoin, ownership and archive mutations', () => {
    for (const token of ["'remove-rejoin'", "'owner'", "'archive'", "wait_event_type='Lock'", 'observed', 'Mutation crossed visibility transaction', 'No actual lock wait', "set lock_timeout='2s'", '30000', "assert.equal(target.HostConfig.NetworkMode, 'none')", "assert.equal(target.Config.Labels?.['pika.home-visibility.owner'], owner)"]) {
      expect(contention).toContain(token)
    }
  })
})
