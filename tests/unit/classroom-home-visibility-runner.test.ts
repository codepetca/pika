import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const runner = readFileSync('scripts/check-classroom-home-visibility-database.sh', 'utf8')
const contention = readFileSync('scripts/check-classroom-home-visibility-contention.mjs', 'utf8')

describe('isolated home visibility proof runner source contracts', () => {
  it('resolves and freezes the exact project source with installed images, without pulling or shared migration writes', () => {
    for (const token of ['source_container=supabase_db_pika', 'source_id="$(docker inspect "$source_container" --format', '"$source_id" =~ ^[a-f0-9]{64}$', 'com.supabase.cli.project', 'docker port "$source_id" 5432/tcp', '*:54322', 'public.ecr.aws/supabase/postgres:17.6.1.044|ghcr.io/supabase/postgres:17.6.1.044', 'postgres-meta:v0.96.6', '--pull=never', '--network none', '--schema-only --no-owner --no-privileges', '--schema=public --schema=private --schema=auth --schema=storage']) {
      expect(runner).toContain(token)
    }
    expect(runner).not.toMatch(/source_id=[a-f0-9]{64}/)
    expect(runner).not.toMatch(/docker (?:pull|restart|stop)|supabase (?:db|migration)|pg_dump[^\n]*--data-only/)
    expect(runner).toContain('drop schema public cascade; drop schema private cascade; create schema public;')
  })

  it('validates a contiguous full292 inventory and seals SQL/proof bytes before and after execution', () => {
    for (const token of ["assert.equal(paths.length, 292", "String(index + 1).padStart(3, '0')", "createHash('sha256')", 'source-manifest.sha256', 'replay-manifest.sha256', 'final-manifest.sha256', 'check-classroom-home-visibility-database.sql', 'check-classroom-home-visibility-contention.mjs']) {
      expect(runner).toContain(token)
    }
    expect(runner).not.toContain('validateLifecycleServicesReviewedMigrations')
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
