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
const admissionContention = readFileSync('scripts/check-classroom-admission-registry-contention.mjs', 'utf8')
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

  it.each([['233', false], ['234', true], ['292', true], ['293', true], ['294', true], ['295', false], ['0293', false], ['293+0', false]] as const)('executes the closed source-version guard for %s', (version, accepted) => {
    const start = runner.indexOf('[[ "$source_version" =~')
    const end = runner.indexOf('registry=', start)
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start)
    const result = spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${runner.slice(start, end)}`], { encoding: 'utf8', env: { ...process.env, BASH_ENV: '', source_version: version } })
    expect(result.status === 0).toBe(accepted)
  })

  it('executes the complete current294 manifest and seals the exact reviewed extension', () => {
    const result = runManifest()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim().split('\n')).toHaveLength(301)
    expect(result.stdout).toContain(`${REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION.sha256}  supabase/migrations/${REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION.name}`)
  })

  it.each(['tampered293', 'renamed293', 'renamed294', 'unknown295', 'historicalDirtyTree', 'tampered294', 'tamperedAdmissionProof', 'tamperedBuilder'] as const)('executes manifest compatibility rules for %s', defect => {
    const repository = mkdtempSync(join(tmpdir(), 'pika-home-reviewed-profile-'))
    try {
      mkdirSync(join(repository, 'supabase')); mkdirSync(join(repository, 'scripts'))
      const migrations = join(repository, 'supabase/migrations')
      cpSync('supabase/migrations', migrations, { recursive: true })
      for (const proof of ['check-classroom-home-visibility-database.sql', 'check-classroom-home-recovery-database.sql', 'check-classroom-home-visibility-contention.mjs', 'check-classroom-admission-registry-database.sql', 'check-classroom-admission-registry-contention.mjs', 'check-classroom-home-visibility-database.sh']) cpSync(join('scripts', proof), join(repository, 'scripts', proof))
      mkdirSync(join(repository, 'src/lib/server'), { recursive: true })
      cpSync('src/lib/server/classroom-admission-manifest.ts', join(repository, 'src/lib/server/classroom-admission-manifest.ts'))
      const before = runManifest(repository)
      const reviewed = join(migrations, REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION.name)
      if (defect === 'tampered293') appendFileSync(reviewed, '\n-- unreviewed source substitution\n')
      if (defect === 'renamed293') renameSync(reviewed, join(migrations, '293_unreviewed.sql'))
      if (defect === 'renamed294') renameSync(join(migrations, '294_classroom_experience_admission_registry.sql'), join(migrations, '294_unreviewed.sql'))
      if (defect === 'unknown295') writeFileSync(join(migrations, '295_unreviewed.sql'), 'select 1;\n')
      if (defect === 'tampered294') appendFileSync(join(migrations, '294_classroom_experience_admission_registry.sql'), '\n-- actual dirty-tree migration bytes\n')
      if (defect === 'tamperedAdmissionProof') appendFileSync(join(repository, 'scripts/check-classroom-admission-registry-contention.mjs'), '\n// actual dirty-tree proof bytes\n')
      if (defect === 'tamperedBuilder') appendFileSync(join(repository, 'src/lib/server/classroom-admission-manifest.ts'), '\n// actual dirty-tree builder bytes\n')
      if (defect === 'historicalDirtyTree') appendFileSync(join(migrations, readdirSync(migrations).find(name => name.startsWith('001_'))!), '\n-- historical dirty-tree manifest remains supported\n')
      const result = runManifest(repository)
      if (['historicalDirtyTree', 'tampered294', 'tamperedAdmissionProof', 'tamperedBuilder'].includes(defect)) {
        expect(result.status, result.stderr).toBe(0)
        expect(result.stdout).not.toBe(before.stdout)
      }
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

  it('validates a contiguous full294 inventory and seals SQL/proof bytes before and after execution', () => {
    for (const token of ["assert.equal(paths.length, 294", "String(index + 1).padStart(3, '0')", "createHash('sha256')", 'source-manifest.sha256', 'replay-manifest.sha256', 'final-manifest.sha256', 'check-classroom-home-visibility-database.sql', 'check-classroom-home-recovery-database.sql', 'check-classroom-home-visibility-contention.mjs']) {
      expect(runner).toContain(token)
    }
    expect(runner).not.toContain('validateLifecycleServicesReviewedMigrations')
  })

  it('runs recovery contracts only through the same owned offline clone and retained evidence', () => {
    expect(runner).toContain('sql < "$root/scripts/check-classroom-home-recovery-database.sql" > "$scratch/recovery.log" 2>&1')
    expect(runner.indexOf("echo 'PASS isolated replay001–294.'")).toBeLessThan(runner.indexOf('sql < "$root/scripts/check-classroom-home-recovery-database.sql"'))
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

  it('runs admission rollback and committed contention on the same sealed clone before genuine metadata generation', () => {
    const fixture = 'sql < "$root/scripts/check-classroom-admission-registry-database.sql"'
    const contention = 'node --import tsx "$root/scripts/check-classroom-admission-registry-contention.mjs" --container-id "$clone_id" --owner "$owner"'
    expect(runner).toContain(fixture)
    expect(runner).toContain(contention)
    expect(runner.indexOf(fixture)).toBeLessThan(runner.indexOf(contention))
    expect(runner.indexOf(contention)).toBeLessThan(runner.indexOf('docker start -a "$meta_id"'))
    for (const token of ['admission-before-normalized.sql', 'admission-after-normalized.sql',
      'src/lib/server/classroom-admission-manifest.ts', 'scripts/check-classroom-home-visibility-database.sh',
      'read_classroom_experience_admission_v2:', 'commit_classroom_experience_admission_batch_v2:',
      'read_classroom_experience_admission_operation_v2:']) expect(runner).toContain(token)
  })

  it('loads and executes the actual TypeScript builder through the contention script module loader without Docker', () => {
    // Execute its real import/require header under the same node/tsx invocation,
    // stopping before the clone argument guard and every Docker operation.
    const imports = admissionContention.slice(0, admissionContention.indexOf('// This proof accepts'))
    expect(imports).toContain('createRequire(import.meta.url)')
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-'], {
      cwd: join(process.cwd(), 'scripts'), encoding: 'utf8', timeout: 5000,
      env: { ...process.env, NODE_OPTIONS: '' },
      input: `${imports}\nconst request = prepareClassroomAdmissionManifest({
        operationId: 'f294d000-0000-4000-8000-000000000001', expectedRevision: 1,
        kind: 'growth_on', userIds: [], excludedUserIds: [], approvalRef: 'fixture/module-interop',
      });
      assert.equal(request.p_kind, 'growth_on');
      assert.equal(request.p_manifest_sha256, createHash('sha256').update('classroom-admission-v2\\ngrowth_on\\n\\n--excluded--\\n').digest('hex'));
      console.log('actual TypeScript manifest import and digest PASS');`,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('actual TypeScript manifest import and digest PASS')
  })

  it.each(['valid', 'identity', 'owner', 'canonicalSource', 'network', 'portBinding', 'publishedPort', 'stopped'] as const)(
    'executes the actual admission contention clone guard for %s', defect => {
      const source = admissionContention.match(/function verifyTarget\(\) \{([\s\S]*?)\n\}\nverifyTarget\(\)/)?.[0]
      expect(source).toBeDefined()
      const containerId = 'a'.repeat(64)
      const owner = '123:fixture'
      const target = {
        Id: defect === 'identity' ? 'b'.repeat(64) : containerId,
        Config: { Labels: { 'pika.home-visibility.owner': defect === 'owner' ? '123:foreign' : owner,
          'com.supabase.cli.project': defect === 'canonicalSource' ? 'pika' : undefined } },
        HostConfig: { NetworkMode: defect === 'network' ? 'bridge' : 'none',
          PortBindings: defect === 'portBinding' ? { '5432/tcp': [{}] } : {} },
        NetworkSettings: { Ports: { '5432/tcp': defect === 'publishedPort' ? [{ HostPort: '54322' }] : null } },
        State: { Running: defect !== 'stopped' },
      }
      let calls = 0
      const execute = () => runInNewContext(source!, {
        assert, containerId, owner, deadline: Date.now() + 30_000, MAX_STREAM_BYTES: 262_144,
        remaining: () => 5000,
        execFileSync: (command: string, args: string[]) => {
          expect(command).toBe('docker'); expect(args).toEqual(['inspect', containerId]); calls++
          return JSON.stringify([target])
        },
      })
      if (defect === 'valid') expect(execute).not.toThrow()
      else expect(execute).toThrow()
      expect(calls).toBe(1)
    })

  it('keeps native admission evidence separate from source contracts and restores only its guarded fixture scope', () => {
    // These assertions exercise harness source safety. PostgreSQL replay is the
    // independent evidence for actual row locking and transactional behavior.
    for (const token of ['prepareClassroomAdmissionManifest', 'Actual offline TypeScript manifest must match PostgreSQL digest',
      'assert.notEqual(holderPid, waiterPid', "wait_event_type='Lock'", 'any(pg_blocking_pids(pid))',
      "'40001', 'classroom_admission_revision_conflict'", "'55000', 'classroom_admission_growth_stopped'",
      'assert.deepEqual(replay, first)', 'assert.deepEqual(await queryJson(waiter, unknown), reconciled)',
      'read_classroom_experience_admission_operation_v2', 'read_classroom_experience_admission_v2',
      'Admission cleanup found foreign state', 'disable trigger classroom_admission_policy_guard',
      'enable trigger classroom_admission_policy_guard', 'where operation_id=any(',
      'where user_id=any(', 'assert.equal(fingerprint(), before', 'closures.filter', 'new AggregateError',
      'MAX_STREAM_BYTES', '30_000', "set lock_timeout='2s'"]) expect(admissionContention).toContain(token)
    expect(admissionContention).not.toMatch(/^\s*truncate\s|disable trigger all|session_replication_role|shell:\s*true|docker[^\n]*(?:create|run|rm)/im)
    expect(admissionContention.indexOf('verifyTarget()\nconst sqlArgs')).toBeLessThan(admissionContention.indexOf("const holder = connection('holder')"))
    expect(admissionContention.lastIndexOf("console.log('PASS admission fixture cleanup:")).toBeGreaterThan(admissionContention.indexOf('if (errors.length) throw'))
  })
})
