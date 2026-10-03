import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as proofHelpers from '../../scripts/shared-assignment-write-proof'
import {
  ACK, API, CLEANUP_PASS, FORCED, NORMAL_PASS, cleanupSql, containedFetch,
  fingerprintSql, newFixture, ownedTables, validateLaunch,
} from '../../scripts/shared-assignment-write-proof'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const helper = source('scripts/shared-assignment-write-proof.ts')
const wrapper = source('scripts/rehearse-local-shared-assignment-writes.sh')
const integration = source('tests/api/integration/shared-assignment-writes.local.test.ts')
function launch(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  // Constructed claims exercise the pure launch parser only; they are not SDK
  // evidence or a credential usable by the actual wrapper.
  const claims = Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')
  return { PIKA_SHARED_ASSIGNMENT_WRITE_ACK: ACK, PIKA_SHARED_ASSIGNMENT_WRITE_WRAPPER: 'local-status-v1',
    PIKA_SHARED_ASSIGNMENT_WRITE_MODE: 'normal', PIKA_SHARED_ASSIGNMENT_WRITE_API: API,
    PIKA_SHARED_ASSIGNMENT_WRITE_DB: 'postgresql://postgres:local@127.0.0.1:54322/postgres',
    PIKA_SHARED_ASSIGNMENT_WRITE_SECRET: `test.${claims}.test`, PIKA_SHARED_ASSIGNMENT_WRITE_PUBLIC: 'parser-only', ...overrides }
}

describe('shared Assignment proof offline safety controls (no database execution)', () => {
  it('formats only allowlisted operation/category and bounded numeric statuses', () => {
    const format = (proofHelpers as unknown as { safeProofDiagnostic?: (stage: unknown, category: unknown, actual?: unknown, expected?: unknown) => string }).safeProofDiagnostic
    expect(typeof format).toBe('function')
    if (!format) return
    expect(format('unsubmit', 'status', 400, 409)).toBe('DIAG shared-assignment stage=unsubmit category=status actual=400 expected=409')
    expect(format('https://secret.invalid/row-id', 'sb_secret_sensitive', 'credential', 600)).toBe('DIAG shared-assignment stage=unknown category=unexpected actual=none expected=none')
    expect(format('save\ncredential', 'status', Number.NaN, 200.5)).not.toMatch(/credential|NaN|200\.5/)
    expect(format('cleanup', 'cleanup', 99, 999)).toBe('DIAG shared-assignment stage=cleanup category=cleanup actual=none expected=none')
  })

  it('prints only one exact allowlisted diagnostic on unexpected wrapper outcomes', () => {
    const pattern = wrapper.match(/^diagnostic_pattern='([^'\n]+)'$/m)?.[1]
    expect(pattern).toBeDefined()
    if (!pattern) return
    const safe = new RegExp(pattern)
    expect(safe.test('DIAG shared-assignment stage=grade category=status actual=403 expected=200')).toBe(true)
    for (const unsafe of ['DIAG shared-assignment stage=https-secret category=status actual=403 expected=200',
      'DIAG shared-assignment stage=save category=credential actual=403 expected=200',
      'DIAG shared-assignment stage=save category=status actual=200 expected=200 secret',
      'DIAG shared-assignment stage=save category=status actual=999 expected=200',
      'DIAG shared-assignment stage=save category=status actual=403 expected=200\nraw row',
    ]) expect(safe.test(unsafe)).toBe(false)
    expect(wrapper).toContain('rg -m 1 -x "$diagnostic_pattern"')
    expect(wrapper).not.toMatch(/cat .*runner\.log|echo .*error\.message/)
  })

  it('preserves returned-doc clearing and exact400 unsubmit refusal with unchanged rows', () => {
    expect(integration).toContain("returnedUnsubmit.error_code, 'assignment_doc_not_submitted'")
    expect(integration).toContain("same(readDoc().is_submitted, false, 'Returned document was not cleared')")
    expect(integration).toContain("same(db.fingerprint(), beforeReturnedUnsubmit, 'Returned unsubmit rejection changed database state')")
    expect(integration).toContain("'Stored return and clear markers missing'")
    expect(integration).toContain("statusForProof(response.status, status)")
    expect(integration).toContain('safeProofDiagnostic(stage,')
    expect(integration).not.toMatch(/process\.stdout\.write\([^\n]*(?:error\.message|JSON\.stringify\(error)/)
  })

  it('requires explicit acknowledgement, wrapper provenance and a supported deterministic mode', () => {
    expect(validateLaunch(launch()).mode).toBe('normal')
    for (const mode of ['after-fixture', 'before-capture']) expect(validateLaunch(launch({ PIKA_SHARED_ASSIGNMENT_WRITE_MODE: mode })).mode).toBe(mode)
    for (const override of [
      { PIKA_SHARED_ASSIGNMENT_WRITE_ACK: undefined }, { PIKA_SHARED_ASSIGNMENT_WRITE_ACK: 'yes' },
      { PIKA_SHARED_ASSIGNMENT_WRITE_WRAPPER: undefined }, { PIKA_SHARED_ASSIGNMENT_WRITE_MODE: 'arbitrary-failure' },
    ]) expect(() => validateLaunch(launch(override))).toThrow()
  })

  it('rejects hosted and wrong-port endpoints and non-demo/non-service credentials', () => {
    for (const value of ['https://project.supabase.co', 'http://localhost:54321', 'http://127.0.0.1:54322', `${API}/rest/v1`]) {
      expect(() => validateLaunch(launch({ PIKA_SHARED_ASSIGNMENT_WRITE_API: value }))).toThrow()
    }
    for (const value of ['postgresql://remote:54322/postgres', 'postgresql://127.0.0.1:54321/postgres', 'postgresql://127.0.0.1:54322/other', 'postgresql://127.0.0.1:54322/postgres?host=remote']) {
      expect(() => validateLaunch(launch({ PIKA_SHARED_ASSIGNMENT_WRITE_DB: value }))).toThrow()
    }
    for (const claims of [{ iss: 'hosted', role: 'service_role' }, { iss: 'supabase-demo', role: 'anon' }]) {
      const jwt = `test.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test`
      expect(() => validateLaunch(launch({ PIKA_SHARED_ASSIGNMENT_WRITE_SECRET: jwt }))).toThrow()
    }
    expect(() => validateLaunch(launch({ PIKA_SHARED_ASSIGNMENT_WRITE_SECRET: 'sb_secret_unusable' }))).toThrow()
  })

  it('permits only exact local REST fetches and rejects redirects, Storage and every provider', async () => {
    const original = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const paths: string[] = [], guarded = containedFetch(original, paths)
    for (const url of ['https://api.github.com/repos/a/b', 'https://example.invalid/work', 'http://127.0.0.1:54322/rest/v1/users',
      `${API}/storage/v1/object/private/bytes`, 'http://localhost:54321/rest/v1/users', 'http://user:pass@127.0.0.1:54321/rest/v1/users']) {
      await expect(guarded(url)).rejects.toThrow('Proof blocked')
    }
    expect(original).not.toHaveBeenCalled()
    await guarded(`${API}/rest/v1/rpc/save_assignment_doc_for_member_v1`, { method: 'POST', redirect: 'follow' })
    expect(original).toHaveBeenCalledOnce()
    expect(original.mock.calls[0][1]?.redirect).toBe('error')
    expect(original.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(paths).toEqual(['/rest/v1/rpc/save_assignment_doc_for_member_v1'])
  })

  it('allocates all roots, generations, doc/session/requirement identities before setup', () => {
    const fixture = newFixture()
    const ids = [...fixture.people.map(p => p.id), ...fixture.classes.map(c => c.id), ...fixture.enrollments.map(e => e.id),
      ...fixture.grants.map(g => g.operation), ...fixture.docIds, ...fixture.sessionIds, ...fixture.requirementIds]
    expect(new Set(ids).size).toBe(ids.length)
    expect(fixture.people.map(p => p.role)).toEqual(['teacher', 'student', 'teacher'])
    expect(fixture.enrollments).toContainEqual(expect.objectContaining({ classroom: fixture.classes[1].id, student: fixture.people[1].id }))
    expect(helper).toContain("same(residue(), {}, 'Preallocated identities or tag already exist')")
    expect(fingerprintSql()).toContain("n.nspname in ('public','private','storage')")
    expect(fingerprintSql()).toContain('md5(to_jsonb(r)::text)')
  })

  it('locks every eligible candidate before snapshots/scans and rejects foreign/unknown dependencies before deletion', () => {
    const fixture = newFixture(), sql = cleanupSql(fixture, {}, {})
    const operation = sql.indexOf('classroom_purge_try_lock'), lock = sql.indexOf('access exclusive mode nowait')
    const snapshot = sql.indexOf('insert into proof_rows'), scan = sql.indexOf('do $closure$')
    const deletion = sql.indexOf('delete from public.assignment_doc_save_operations')
    expect(operation).toBeGreaterThan(0)
    expect(lock).toBeGreaterThan(operation)
    expect(snapshot).toBeGreaterThan(sql.lastIndexOf('FOR UPDATE NOWAIT'))
    expect(scan).toBeGreaterThan(snapshot)
    expect(deletion).toBeGreaterThan(scan)
    for (const [table] of ownedTables(fixture)) expect(sql).toContain(`from ${table} r where`)
    expect(sql).toContain('Unexpected dependency or foreign fixture reference')
    expect(sql).toContain('not exists(select 1 from proof_rows s where s.tbl=%L and s.row=to_jsonb(r))')
    expect(ownedTables(fixture).some(([table]) => table.startsWith('storage.') || /outbox|cleanup_jobs|attendance|roster/.test(table))).toBe(false)
    expect(sql).toContain('on conflict do nothing')
    expect(sql).toContain('position(')
    expect(sql).toContain('Synthetic generation binding changed')
    expect(sql).toContain('Enrollment binding changed')
  })

  it('validates exact default categories and audit operation/subject pairs without broad cleanup', () => {
    const fixture = newFixture(), sql = cleanupSql(fixture, {}, {})
    expect(sql).toContain("('Attendance'::text,10::numeric,10,0,false),('Term',65::numeric,10,1,true),('Final',25::numeric,10,2,false)")
    expect(sql).toContain('g.created_at is distinct from c.created_at')
    expect(sql).toContain('g.updated_at is distinct from g.created_at')
    expect(sql).toContain('primary key(operation_id,subject_user_id)')
    expect(sql).toContain("previous_plan_key is null and new_plan_key='free'")
    expect(sql).toContain("actor_ref='system:user-provisioning'")
    for (const grant of fixture.grants) expect(sql).toContain(`'${grant.operation}'::uuid,'${grant.subject}'::uuid`)
    expect(sql).toContain(`a.reason_code='${fixture.tag}'`)
    expect(sql).toContain('and to_jsonb(r)=s.row')
    expect(sql).not.toMatch(/truncate|session_replication_role|disable trigger all|delete from storage\./i)
  })

  it('contains168 suppression inside one locked cleanup transaction and checks complete pre/postcommit row equality', () => {
    const sql = cleanupSql(newFixture(), { 'public.users': { count: 1, digest: 'untouched' } }, {})
    const suppress = sql.indexOf('disable trigger guard_pal_membership_evidence')
    const enable = sql.indexOf('enable trigger guard_pal_membership_evidence')
    expect(sql.trim().startsWith('begin;')).toBe(true)
    expect(sql.trim().endsWith('commit;')).toBe(true)
    expect(suppress).toBeGreaterThan(sql.indexOf('do $generation$'))
    expect(enable).toBeGreaterThan(suppress)
    expect(sql.indexOf('Whole-row global baseline differs before commit')).toBeGreaterThan(enable)
    expect(sql).toContain("pg_temp.shared_write_residue()<>'{}'::jsonb")
    expect(helper).toContain('Whole-row global baseline differs after cleanup')
    expect(helper).toContain('Synthetic residual state after commit')
    expect(helper).toContain("demand(sql(`select ${guardSql};`) === 'O'")
    expect(helper).toContain('application_name=${q(appName)}')
    expect(helper).not.toContain('application_name like')
    expect(helper).toContain("select not private.pal_classroom_signals_enabled();")
    expect(helper).toContain('Persisted Pal classroom capture must be OFF')
    expect(helper).toContain('private.pal_classroom_signal_settings where singleton for share nowait')
    expect(helper).not.toMatch(/update private\.pal_.*settings|set enabled\s*=/)
  })

  it('uses actual NextRequest handlers and only auth mocks; no GET/open or bytes claim', () => {
    expect(integration.match(/vi\.mock\(/g)).toHaveLength(1)
    expect(integration).toContain("vi.mock('@/lib/auth'")
    expect(integration).toContain("(await import('@/app/api/assignment-docs/[id]/route')).PATCH")
    expect(integration).not.toContain("(await import('@/app/api/assignment-docs/[id]/route')).GET")
    expect(integration).toContain('new NextRequest(')
    expect(integration).toContain('PIKA_CLASSROOM_EXPERIENCE_ADMISSION = JSON.stringify')
    expect(integration).toContain("process.env[key] = 'false'")
    expect(integration).toContain('Shared config consumed forbidden params')
    expect(integration).toContain('Denied route changed database state')
    expect(integration).toContain('Foreign return target was not classified as unenrolled')
    expect(integration).toContain('not_enrolled_student_ids')
    expect(integration).toContain("undefined, params, 404))")
    expect(integration).not.toMatch(/\.storage\.|\.upload\(|validatePublicGitHubRepo\(/)
  })

  it('always attempts exact cleanup after setup, including forced uncaptured COMMIT failures', () => {
    const setup = integration.indexOf('db.setup()'), capture = integration.indexOf('captured = db.capture()')
    expect(integration.lastIndexOf('try {', setup)).toBeGreaterThan(integration.indexOf('const baseline = db.prepare()'))
    expect(integration.indexOf("launch.mode === 'before-capture'")).toBeGreaterThan(setup)
    expect(capture).toBeGreaterThan(integration.indexOf("launch.mode === 'before-capture'"))
    expect(integration.indexOf("launch.mode === 'after-fixture'")).toBeGreaterThan(capture)
    expect(integration).toContain('finally {\n      try { await db.cleanup(baseline, captured) }')
    expect(integration).toContain("failure = 'FAIL shared-assignment cleanup (captured data withheld)'")
  })

  it('requires exact normal/forced receipts, cleanup PASS and mode-specific exit status; no arbitrary FAIL accepted', () => {
    for (const marker of [CLEANUP_PASS, NORMAL_PASS, ...Object.values(FORCED)]) expect(wrapper).toContain(marker)
    expect(wrapper.indexOf('Explicit local synthetic')).toBeLessThan(wrapper.indexOf('supabase status'))
    expect(wrapper).toContain('status_value SERVICE_ROLE_KEY')
    expect(wrapper).not.toContain('.env.local"')
    expect(wrapper).toContain('rg -F -x "$cleanup"')
    expect(wrapper).toContain('"$rc" == 0')
    expect(wrapper).toContain('"$rc" == 1')
    expect(wrapper).toContain('rg -F -x "$forced"')
    expect(wrapper).not.toMatch(/rg[^\n]*['"]\^?FAIL['"]|cat .*runner\.log/)
    expect(wrapper).toContain('runner output withheld')
  })
})
