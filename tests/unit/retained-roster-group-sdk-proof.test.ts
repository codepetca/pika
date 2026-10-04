import { describe, expect, it, vi } from 'vitest'
import { runRetainedCleanupDiscoverySdkProof } from '../../scripts/check-retained-roster-group-discovery-sdk'

const classroom = '20000000-0000-4000-8000-000000000001', owner = '10000000-0000-4000-8000-000000000001'
function harness(options: { wrongTarget?: boolean; drift?: boolean; badAcl?: boolean; badPage?: boolean; emptyDatabase?: boolean } = {}) {
  const commands: { args: string[]; input?: string }[] = [], requests: URL[] = []
  let snapshots = 0
  const execute = vi.fn((file: string, args: string[], input?: string) => {
    commands.push({ args, input })
    if (args[0] === 'inspect') return options.wrongTarget ? 'other' : 'pika'
    if (args[0] === 'port') return '0.0.0.0:54322\n[::]:54322'
    if (file === 'supabase') return JSON.stringify({ API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgres://postgres:private@127.0.0.1:54322/postgres', SERVICE_ROLE_KEY: 'service-proof', ANON_KEY: 'anon-proof' })
    if (input?.includes('PROOF_FINGERPRINT:')) return JSON.stringify({ count: options.drift && ++snapshots > 1 ? 1 : 0 })
    if (input?.includes("jsonb_build_object('teacher_id'")) return JSON.stringify(options.emptyDatabase ? [] : [{ teacher_id: owner, classroom_id: classroom }])
    return ''
  })
  const localFetch: typeof fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input)); requests.push(url)
    expect(init?.redirect).toBe('error'); expect(init?.signal).toBeInstanceOf(AbortSignal)
    const args = JSON.parse(String(init?.body)), key = new Headers(init?.headers).get('apikey')
    if (args.p_teacher_id !== owner || key === 'anon-proof') return Response.json(options.badAcl ? {} : { code: '42501', message: 'Denied' }, { status: options.badAcl ? 200 : 403 })
    return Response.json({ schema_version: 1, teacher_id: owner, classroom_id: classroom, student_id: null,
      after_student_id: null, include_unreserved: false, targets: [], target_count: 0, next_student_id: null,
      snapshot_sha256: 'a'.repeat(64), ...(options.badPage ? { provider_ref: 'private' } : {}) })
  })
  return { execute, fetch: localFetch, commands, requests }
}
describe('retained cleanup installed SDK proof source', () => {
  it('rejects a wrong target before any SQL or HTTP', async () => {
    const h = harness({ wrongTarget: true })
    await expect(runRetainedCleanupDiscoverySdkProof(h)).rejects.toThrow()
    expect(h.commands.some(c => c.args.includes('psql'))).toBe(false)
    expect(h.requests).toHaveLength(0)
  })
  it('supports a fresh empty CI database without claiming a successful owner read', async () => {
    const h = harness({ emptyDatabase: true })
    expect(await runRetainedCleanupDiscoverySdkProof(h)).toEqual({ emptyOwnerRead: false })
    expect(h.requests).toHaveLength(3)
  })
  it('uses typed null arguments and observes owner/anonymous denial with no fixtures', async () => {
    const h = harness(), receipt = vi.fn()
    await runRetainedCleanupDiscoverySdkProof({ ...h, receipt })
    expect(h.requests).toHaveLength(3)
    expect(h.requests.every(u => u.origin === 'http://127.0.0.1:54321' && u.pathname === '/rest/v1/rpc/discover_retained_student_cleanup_groups')).toBe(true)
    expect(h.commands.filter(c => c.input?.includes('PROOF_FINGERPRINT:'))).toHaveLength(2)
    expect(h.commands.map(c => c.input ?? '').join('\n')).not.toMatch(/disable trigger|insert into|delete from|update public|drop index/i)
    expect(receipt).toHaveBeenCalledExactlyOnceWith('PASS retained cleanup SDK unchanged local baseline.')
  })
  it.each([{ badAcl: true }, { badPage: true }, { drift: true }])('fails closed for unexpected results %#', async options => {
    await expect(runRetainedCleanupDiscoverySdkProof(harness(options))).rejects.toThrow()
  })
  it('verifies the unchanged baseline before propagating its exact forced-failure marker', async () => {
    const h = harness(), receipt = vi.fn()
    await expect(runRetainedCleanupDiscoverySdkProof({ ...h, receipt, forceFailure: true })).rejects.toThrow('FORCED_RETAINED_SDK_PROOF_FAILURE')
    expect(h.requests).toHaveLength(1)
    expect(h.commands.filter(c => c.input?.includes('PROOF_FINGERPRINT:'))).toHaveLength(2)
    expect(receipt).toHaveBeenCalledExactlyOnceWith('PASS retained cleanup SDK unchanged local baseline.')
  })
})
