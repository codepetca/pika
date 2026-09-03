import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postBaraDecommission } from '@/lib/server/bara-attendance-client'
import { verifyV1RequestSignature } from '@/vendor/attendance-contract/v1/signing'
import { DECOMMISSION_PATH, type DecommissionRequest } from '@/vendor/attendance-contract/decommission'

const request: DecommissionRequest = {
  schema_version: 1, message_type: 'roster.decommission', action: 'begin',
  installation_ref: 'installation_one', roster_ref: 'roster_one',
  operation_ref: 'decommission_0123456789abcdef0123456789abcdef', actor_principal_ref: 'principal_teacher',
}
const receipt = { schema_version: 1, ok: true, installation_ref: request.installation_ref,
  roster_ref: request.roster_ref, operation_ref: request.operation_ref, state: 'deleted',
  absence_verified: true, deleted_count: 7 }
const secret = 'synthetic-only-decommission-signing-secret-123456'
beforeEach(() => {
  vi.stubEnv('BARA_ATTENDANCE_API_BASE_URL', 'https://bara.example.test')
  vi.stubEnv('BARA_ATTENDANCE_INSTALLATION_REF', request.installation_ref)
  vi.stubEnv('BARA_ATTENDANCE_INTEGRATION_SECRET', secret)
  vi.stubEnv('PIKA_BARA_ATTENDANCE_ENABLED', 'false')
  vi.stubEnv('PIKA_BARA_DECOMMISSION_MODE', 'canary')
  vi.stubEnv('PIKA_BARA_DECOMMISSION_CANARY_ROSTER_REF', request.roster_ref)
})
afterEach(() => vi.unstubAllEnvs())
describe('Bara decommission transport', () => {
  it('is independently gated and sends no request when disabled or out of scope', async () => {
    const fetcher = vi.fn()
    vi.stubEnv('PIKA_BARA_DECOMMISSION_MODE', 'disabled')
    await expect(postBaraDecommission(request, { fetcher })).rejects.toMatchObject({ code: 'disabled' })
    vi.stubEnv('PIKA_BARA_DECOMMISSION_MODE', 'canary')
    await expect(postBaraDecommission({ ...request, roster_ref: 'other' }, { fetcher })).rejects.toMatchObject({ code: 'disabled' })
    await expect(postBaraDecommission({ ...request, installation_ref: 'other' }, { fetcher })).rejects.toMatchObject({ code: 'resource_mismatch' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('signs the exact body and validates absence even when ordinary attendance is paused', async () => {
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe(`https://bara.example.test${DECOMMISSION_PATH}`)
      expect(init).toMatchObject({ redirect: 'error', cache: 'no-store', method: 'POST' })
      const headers = new Headers(init?.headers)
      expect(await verifyV1RequestSignature({ secret, method: 'POST', path: DECOMMISSION_PATH,
        timestamp: headers.get('X-Attendance-Timestamp')!, nonce: headers.get('X-Attendance-Nonce')!,
        body: init?.body as string }, headers.get('X-Attendance-Signature'))).toBe(true)
      return Response.json(receipt)
    })
    expect(await postBaraDecommission(request, { fetcher })).toEqual(receipt)
  })
  it.each([{ absence_verified: false }, { operation_ref: 'other' }, { roster_ref: 'other' },
    { installation_ref: 'other' }, { state: 'unknown' }, { deleted_count: -1 }])('rejects unverified receipts %j', async change => {
    await expect(postBaraDecommission(request, { fetcher: vi.fn(async () => Response.json({ ...receipt, ...change })) }))
      .rejects.toMatchObject({ code: 'invalid_response', retryable: true })
  })
  it('treats missing roster and network failures as errors, never deletion success', async () => {
    await expect(postBaraDecommission(request, { fetcher: vi.fn(async () => Response.json({ code: 'roster_not_found' }, { status: 404 })) }))
      .rejects.toMatchObject({ code: 'roster_not_found' })
    await expect(postBaraDecommission(request, { fetcher: vi.fn(async () => { throw new Error('timeout') }) }))
      .rejects.toMatchObject({ code: 'network_error', retryable: true })
  })
})
