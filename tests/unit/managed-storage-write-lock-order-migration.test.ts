import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url)
const migrationName = '245_managed_storage_write_lock_order.sql'
const readMigration = (name: string) => readFileSync(new URL(name, migrationDirectory), 'utf8')
const remediation = readMigration(migrationName)
const foundation = readMigration('117_managed_storage_ownership_foundation.sql')
const harness = readFileSync(new URL('../../scripts/check-managed-storage-write-lock-order.sh', import.meta.url), 'utf8')
const functionBody = (sql: string, name: string) => {
  const definition = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0]
  if (!definition) throw new Error(`Missing function ${name}`)
  return definition
}
const functions = [
  'begin_managed_storage_upload', 'register_legacy_managed_storage_object',
  'resolve_managed_storage_blueprint_copy_source', 'enforce_managed_storage_object_write',
]

describe('managed Storage row/path lock contract', () => {
  it('uses forward replacements without changing public RPC signatures or unrelated authority owners', () => {
    expect([...remediation.matchAll(/create or replace function public\.([a-z_]+)/g)].map(match => match[1]))
      .toEqual(functions)
    for (const name of functions.slice(0, 3)) {
      expect(functionBody(remediation, name).split('as $$')[0])
        .toBe(functionBody(foundation, name).split('as $$')[0])
    }
    expect(remediation).not.toMatch(/create table|alter table|create trigger|set mode =|queue_managed_storage_cleanup\(|verify_managed_storage_upload\(/)
    expect(remediation).not.toContain('enforce_managed_storage_object_delete')
    for (const name of functions) {
      const latest = readdirSync(migrationDirectory).filter(file => /^\d+_.*\.sql$/.test(file))
        .sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]))
        .filter(file => readMigration(file).includes(`create or replace function public.${name}(`)).at(-1)
      expect(latest).toBe(migrationName)
    }
  })

  it('prelocks both Storage UPDATE identities by UUID before locking paths in a stable order', () => {
    const body = functionBody(remediation, 'enforce_managed_storage_object_write')
    const firstPath = body.indexOf('perform public.managed_storage_exact_lock(')
    expect(body.slice(0, firstPath)).toMatch(/order by object\.id\s+for update/)
    expect(body.slice(0, firstPath)).toContain('object.storage_bucket = v_old_bucket and object.storage_path = v_old_path')
    expect(body.slice(0, firstPath)).toContain('values (new.bucket_id, new.name), (v_old_bucket, v_old_path)')
    expect(body.slice(0, firstPath)).toContain('order by identity.storage_bucket, identity.storage_path')
    // No blocking row lock is allowed after the first path lock, even when a
    // registry identity becomes visible while waiting for that lock.
    expect(body.slice(firstPath)).not.toMatch(/for (?:update|share)|on conflict/i)
    expect(body.slice(firstPath)).toContain('and not (object.id = any(v_locked_object_ids))')
    expect(body.slice(firstPath)).toContain("errcode = '40001', message = 'managed_storage_write_retry'")
  })

  it('prevents absent upload/legacy reservations from taking an ON CONFLICT row lock after a newly appeared identity', () => {
    for (const name of functions.slice(0, 2)) {
      const body = functionBody(remediation, name)
      const path = body.indexOf('perform public.managed_storage_exact_lock(')
      const retry = body.indexOf("errcode = '40001', message = 'managed_storage_write_retry'")
      expect(path).toBeGreaterThan(body.indexOf('for update;'))
      expect(retry).toBeGreaterThan(path)
      expect(retry).toBeLessThan(body.indexOf('insert into public.managed_storage_objects'))
      expect(body.slice(path, retry)).toContain('if v_object.id is null and exists (')
      expect(body.slice(path, retry)).toContain('object.id = p_object_id')
      expect(body.slice(path, retry)).toContain('object.storage_path = p_storage_path')
      expect(body.slice(path, retry)).not.toContain('for update')
      // Every original ownership, retry, checksum, status and lease predicate
      // remains byte-for-byte present outside the small lock recheck block.
      const withoutRecheck = body.replace(/\n  if v_object\.id is null and exists \([\s\S]*?\n  end if;/, '')
      expect(withoutRecheck).toBe(functionBody(foundation, name))
    }
  })

  it('never re-locks a newly appeared Blueprint source row after the absent-path lock', () => {
    const body = functionBody(remediation, 'resolve_managed_storage_blueprint_copy_source')
    const absent = body.slice(body.indexOf('  if not found then'), body.indexOf("  perform public.managed_storage_exact_lock('test-documents', p_storage_path);", body.indexOf('      return v_object;')))
    expect(absent).toContain("errcode = '40001', message = 'managed_storage_write_retry'")
    expect(absent).not.toContain('for update;')
    expect(absent).toContain('managed_storage_blueprint_copy_source_ambiguous')
    expect(absent).toContain('public.register_legacy_managed_storage_object(')
    expect(body).toContain("or v_object.status <> 'ready'")
    expect(body).toContain('or v_object.provisional_owner_id is not null')
  })

  it('preserves tombstones, cleanup/status fences, service-role boundary and enforced identity immutability', () => {
    const body = functionBody(remediation, 'enforce_managed_storage_object_write')
    for (const fence of [
      'public.classroom_purge_objects', 'public.managed_storage_identity_sha256(',
      'classroom_purge_path_reserved', 'managed_storage_cleanup_in_progress',
      'managed_storage_reservation_required', 'managed_storage_identity_immutable',
      "('cleanup_pending', 'cleanup_processing', 'deleted')", "('reserved', 'verified', 'ready')",
    ]) expect(body).toContain(fence)
    expect(body.indexOf('managed_storage_identity_immutable')).toBeLessThan(body.indexOf('for v_object_id in'))
    expect(remediation).toContain('from public, anon, authenticated;')
    expect(remediation).toContain('to service_role;')
    expect(body).toContain('security definer\nset search_path = public, storage')
    expect(remediation).not.toMatch(/(?:revoke|grant)[^;]*public\.enforce_managed_storage_object_write/)
  })

  it('provides a separately authorized two-session harness with actual wait barriers and exact fixture cleanup', () => {
    expect(harness).toContain('--allow-fixture-writes')
    expect(harness).toContain('MANAGED_STORAGE_DB_CONTAINER')
    expect(harness).not.toContain('docker ps')
    expect(harness).toContain('wait_event_type = \'Lock\'')
    expect(harness).toContain('mkfifo')
    expect(harness).toContain('psql_db <&0')
    expect(harness).toContain('trap cleanup EXIT')
    for (const scenario of ['queue', 'verify', 'fence', 'absent', 'rename']) {
      expect(harness).toContain(`start_holder ${scenario}`)
      expect(harness).toContain(`start_writer ${scenario}`)
    }
    expect(harness).toContain("exception when sqlstate '40001'")
    expect(harness).toContain("exception when sqlstate '55000'")
    expect(harness).toContain('rollback;')
    expect(harness).not.toMatch(/supabase db (?:push|reset)|drop table|alter table/)
  })

  it('arms setup recovery before execution and forces lost acknowledgement only after committed setup', () => {
    expect(harness).toContain('randomBytes(32).toString("hex")')
    expect(harness).toContain('fixture_email="managed-lock-245-$run_marker@example.invalid"')
    expect(harness).toContain('fixture_title="Managed storage lock fixture $run_marker"')
    const setup = harness.indexOf('setup_attempted=true')
    const execute = harness.indexOf("psql_db <<'SQL'", setup)
    const forcedFailure = harness.indexOf('MANAGED_STORAGE_FORCE_SETUP_ACK_FAILURE', execute)
    const ready = harness.indexOf('fixture_ready=true', forcedFailure)
    expect(setup).toBeGreaterThan(harness.indexOf('trap cleanup EXIT'))
    expect(execute).toBeGreaterThan(setup)
    expect(forcedFailure).toBeGreaterThan(harness.indexOf('commit;\nSQL', execute))
    expect(ready).toBeGreaterThan(forcedFailure)
    expect(harness.slice(forcedFailure, ready)).toContain('exit 1')
    expect(harness).toContain('Forced failure after fixture setup COMMIT before acknowledgement (teardown control)')
  })

  it('uses a read-only complete run-signature probe instead of treating setup acknowledgement as ownership', () => {
    const probe = harness.split('fixture_state_sql="$(cat <<\'SQL\'\n')[1]?.split('\nSQL\n)"')[0]
    expect(probe).toBeDefined()
    expect(probe).not.toMatch(/\b(insert|update|delete|create|alter|drop)\b/i)
    for (const table of ['public.users', 'public.classrooms', 'public.managed_storage_objects', 'storage.objects']) {
      expect(probe).toContain(table)
    }
    expect(probe).toContain("email=:'fixture_email' and role='teacher'")
    expect(probe).toContain("title=:'fixture_title' and class_code='MSL245'")
    expect(probe).toContain("object.resource_type is distinct from :'fixture_resource'")
    expect(probe).toContain("metadata->>'managed_lock_run' is distinct from :'run_marker'")
    expect(probe).toContain("then 'owned'")
    expect(probe).toContain("then 'empty'")
    expect(probe).toContain("else 'unknown'")
    expect(probe?.match(/'a2450000-0000-4000-8000-00000000001[0-5]'::uuid/g)).toHaveLength(6)
    expect(probe).toContain("'managed-lock-245/absent.pdf',false")
    expect(harness).toContain("null,:'fixture_resource',null,'application/pdf',4")
    expect(harness).toContain("jsonb_build_object('size',4,'managed_lock_run',:'run_marker')")
  })

  it('refuses every fixture identity/path collision before inserting and catches identities at unrelated paths', () => {
    const preflight = harness.slice(harness.indexOf('do $preflight$'), harness.indexOf('insert into public.users'))
    for (const suffix of ['010', '011', '012', '013', '014', '015']) {
      expect(preflight).toContain(`a2450000-0000-4000-8000-000000000${suffix}`)
    }
    expect(preflight).toContain("class_code='MSL245'")
    expect(preflight).toContain("email like 'managed-lock-245-%@example.invalid'")
    expect(preflight).toContain("storage_path like 'managed-lock-245/%'")
    expect(preflight).toContain("name like 'managed-lock-245/%'")
    expect(preflight).toContain("metadata->>'managed_lock_run'=current_setting('pika.managed_lock_run')")
    expect(preflight).toContain("resource_type='managed-lock-245-' || current_setting('pika.managed_lock_run')")
  })

  it('cleans only proved ownership, rechecks under locks, and acknowledges only confirmed zero residue', () => {
    const cleanup = harness.slice(harness.indexOf('cleanup() {'), harness.indexOf('trap cleanup EXIT'))
    expect(cleanup).toContain('if [[ "$setup_attempted" == true ]]')
    expect(cleanup).toContain('if ! state="$(fixture_state)"')
    expect(cleanup).toContain('elif [[ "$state" == \'owned\' ]]')
    const recheck = cleanup.indexOf("select :'fixture_state' = 'owned' as fixture_owned")
    const deletion = cleanup.indexOf('delete from public.managed_storage_objects')
    expect(recheck).toBeGreaterThan(cleanup.indexOf('order by name for update;'))
    expect(deletion).toBeGreaterThan(recheck)
    expect(cleanup.slice(recheck, deletion)).toContain('\\if :fixture_owned')
    const empty = cleanup.indexOf("select :'fixture_state' = 'empty' as fixture_empty")
    const commit = cleanup.indexOf('commit;', deletion)
    const success = cleanup.indexOf('Exact managed-storage fixture teardown: PASS')
    expect(empty).toBeGreaterThan(deletion)
    expect(commit).toBeGreaterThan(empty)
    expect(success).toBeGreaterThan(cleanup.indexOf('elif ! state="$(fixture_state)" || [[ "$state" != \'empty\' ]]'))
    expect(cleanup).toContain('Fixture ownership changed; refusing cleanup.')
    expect(cleanup).toContain('Partial, colliding or changed fixture ownership; refusing cleanup.')
    expect(cleanup).toContain('Fixture setup/ownership outcome unknown; refusing cleanup.')
    expect(harness.match(/Exact managed-storage fixture teardown: PASS/g)).toHaveLength(1)
  })
})
